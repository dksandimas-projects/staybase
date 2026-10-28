/**
 * The PURE half of the finance integrity scanner (F-D3).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/finance-integrity-scan.ts` is a Node script: it reads
 * production through the Firebase Admin SDK and it loads `dotenv`.
 * Those two packages are NOT dependencies of the guest app or the
 * admin app, and they are not available in either app's Vercel build.
 *
 * That matters because of a REAL production outage. The F-D3 test
 * (`admin-app/src/__tests__/f-d3-finance-scanner-ledger.test.ts`)
 * imported the script directly, so `tsc -b` in the admin app pulled
 * the script into the admin app's TypeScript program, and the admin
 * build failed with:
 *
 *     error TS2307: Cannot find module 'firebase-admin/app'
 *     error TS2307: Cannot find module 'firebase-admin/firestore'
 *     error TS2307: Cannot find module 'dotenv'
 *
 * EVERY admin deployment since v2.21.15 failed with exactly that
 * error, so the production admin app stayed on v2.21.9 while the
 * guest app moved to v2.21.16 — the admin app was missing the
 * kitchen-list fix, the store-report CSV export and the F-A6
 * instruction fix for the whole period.
 *
 * The rule this file makes enforceable: an app's TypeScript program
 * must not reach into a package the app does not declare. The
 * scanning RULES are therefore in a module with NO imports at all —
 * they are pure functions over plain objects — and the script keeps
 * only the I/O (Firestore reads, CSV writing, the CLI).
 *
 * The unit tests import THIS file, so they can never drag a
 * server-only package into an app build again.
 */

// NOTE: deliberately NO imports. This module is pure.

export type FinanceIntegrityFinding = {
  findingId: string;
  cohort: "FL-02" | "FL-03" | "pre-FL-05" | "pricing-drift" | "non-finite" | "ledger";
  entityPath: string;
  issue: string;
  observedValue: string;
  expectedValue: string;
  proposedAction: "set-booking-total" | "append-store-delivery-tender" | "manual-review";
  proposedValue: string;
  approved: "NO" | "YES";
  reviewNotes: string;
};

export const CSV_COLUMNS: Array<keyof FinanceIntegrityFinding> = [
  "findingId",
  "cohort",
  "entityPath",
  "issue",
  "observedValue",
  "expectedValue",
  "proposedAction",
  "proposedValue",
  "approved",
  "reviewNotes"
];

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function money(value: number): string {
  return value.toFixed(2);
}

export function scanBookingRecord(bookingId: string, data: Record<string, any>): FinanceIntegrityFinding[] {
  const entityPath = `bookings/${bookingId}`;
  const totalPrice = finiteNumber(data.totalPrice);
  const breakdownFinal = finiteNumber(data.rateBreakdown?.finalTotal);
  const roomLines = Array.isArray(data.rateBreakdown?.roomLines) ? data.rateBreakdown.roomLines : [];
  const roomGross = roomLines.reduce((sum: number, line: any) => sum + (finiteNumber(line?.subtotal) || 0), 0);

  if (totalPrice === null) {
    return [{
      findingId: `${entityPath}:non-finite-total`,
      cohort: "non-finite",
      entityPath,
      issue: "Booking totalPrice is missing or non-finite.",
      observedValue: String(data.totalPrice),
      expectedValue: breakdownFinal === null ? "unknown" : money(breakdownFinal),
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  if (Math.abs(totalPrice) < 0.005 && roomGross > 0) {
    const canUseBreakdown = breakdownFinal !== null && breakdownFinal > 0;
    return [{
      findingId: `${entityPath}:zero-total-with-room-lines`,
      cohort: "FL-03",
      entityPath,
      issue: "Booking total is zero despite non-empty positive room lines.",
      observedValue: money(totalPrice),
      expectedValue: canUseBreakdown ? money(breakdownFinal) : "manual reconstruction required",
      proposedAction: canUseBreakdown ? "set-booking-total" : "manual-review",
      proposedValue: canUseBreakdown ? money(breakdownFinal) : "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  if (breakdownFinal !== null && Math.abs(breakdownFinal - totalPrice) >= 0.01) {
    const isRejectedPointsCohort = data.discountRejected === true && finiteNumber(data.pointsRedeemedValue) !== null
      && Number(data.pointsRedeemedValue) > 0;
    return [{
      findingId: `${entityPath}:breakdown-total-mismatch`,
      cohort: isRejectedPointsCohort ? "FL-02" : "pricing-drift",
      entityPath,
      issue: "rateBreakdown.finalTotal does not match totalPrice.",
      observedValue: money(totalPrice),
      expectedValue: money(breakdownFinal),
      proposedAction: "set-booking-total",
      proposedValue: money(breakdownFinal),
      approved: "NO",
      reviewNotes: ""
    }];
  }

  // Per MRB-11 (decision #177): the stored per-stream revenue
  // allocation is the snapshot the Reports revenue streams read.
  // The allocation's own `totalNet` MUST be the booking's billed
  // total — when a discount is applied, removed or rejected
  // AFTER the create write, a stale allocation keeps the old
  // figure and the Reports revenue no longer matches the bill.
  // The guard at the write boundary (`assertBookingRevenueAllocation
  // Invariant`) now enforces this, so a booking that trips it is a
  // doc written before the guard was tightened (or by a path that
  // never re-snapshots the allocation).
  //
  // Per MRB-11b (QA pass 2026-10-25): the billed total is the room
  // bill PLUS the BR-12 other add-ons — per OCT-FOL-01 they are NOT
  // inside `totalPrice`, they sit on top of it for the balance. The
  // allocation describes the WHOLE bill.
  const allocation = data.revenueAllocation;
  if (allocation && typeof allocation === "object") {
    const otherAddOnTotal = finiteNumber(data.otherAddOnTotal) ?? 0;
    const billedTotal = totalPrice + otherAddOnTotal;
    const allocationTotal = finiteNumber(allocation.totalNet);
    if (allocationTotal === null || Math.abs(allocationTotal - billedTotal) >= 0.01) {
      return [{
        findingId: `${entityPath}:allocation-total-mismatch`,
        cohort: "pricing-drift",
        entityPath,
        issue: "revenueAllocation.totalNet does not match the billed total (MRB-11 revenue identity).",
        observedValue: money(billedTotal),
        expectedValue: allocationTotal === null ? "finite allocation total required" : money(allocationTotal),
        proposedAction: "manual-review",
        proposedValue: "",
        approved: "NO",
        reviewNotes: ""
      }];
    }
  } else if (data.source === "corporate") {
    // A corporate-source booking with NO allocation at all is a
    // write-path defect (the corporate inquiry conversion wrote
    // `totalPrice` but never snapshotted the allocation), so the
    // Reports revenue streams fall back to the legacy heuristic
    // and the row is mis-attributed. Legacy pre-MRB-11 bookings
    // are NOT flagged — their missing allocation is legitimate.
    return [{
      findingId: `${entityPath}:corporate-missing-allocation`,
      cohort: "pricing-drift",
      entityPath,
      issue: "Corporate-source booking has no revenueAllocation snapshot (MRB-11 revenue identity).",
      observedValue: "absent",
      expectedValue: "revenueAllocation present",
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  // Per BR-12 / OCT-FOL-01 (decision #298): the other add-ons are
  // NOT inside `totalPrice` — they sit ON TOP of the room bill for
  // the balance. A booking that carries them therefore has a
  // `totalPrice` that (correctly) excludes the add-on money. The
  // finding is a REVIEW REMINDER, not a claim that the room bill
  // is wrong: the folio surfaces must add the term, otherwise the
  // hotel is owed money that every balance surface reports as
  // settled.
  const otherAddOnTotal = finiteNumber(data.otherAddOnTotal);
  if (otherAddOnTotal !== null && otherAddOnTotal > 0) {
    return [{
      findingId: `${entityPath}:other-addon-outside-room-bill`,
      cohort: "pricing-drift",
      entityPath,
      issue: "Booking carries BR-12 other add-ons that sit on top of totalPrice (decision #298) — confirm the folio surfaces add them.",
      observedValue: money(otherAddOnTotal),
      expectedValue: "added on top of totalPrice",
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  return [];
}

export function scanStoreOrderRecord(
  orderId: string,
  data: Record<string, any>,
  hasTender: boolean
): FinanceIntegrityFinding[] {
  const isDirectPaid = data.paymentMethod !== "add-to-bill";
  if (data.status !== "delivered" || !isDirectPaid || hasTender) return [];
  const totalAmount = finiteNumber(data.totalAmount);
  const entityPath = `storeOrders/${orderId}`;
  return [{
    findingId: `${entityPath}:missing-delivery-tender`,
    cohort: "pre-FL-05",
    entityPath,
    issue: "Delivered direct-paid store order has no settlement tender.",
    observedValue: "no tender",
    expectedValue: totalAmount === null ? "finite order total required" : money(totalAmount),
    proposedAction: totalAmount !== null && totalAmount > 0 ? "append-store-delivery-tender" : "manual-review",
    proposedValue: totalAmount !== null && totalAmount > 0 ? money(totalAmount) : "",
    approved: "NO",
    reviewNotes: ""
  }];
}

/**
 * Per F-D3 (2026-10-27): the scanner covered the PRICING invariants
 * and none of the LEDGER ones — it never read the `payments` /
 * `refunds` / `charges` collections, so running it gave false
 * confidence that the money was sound.
 *
 * These are the ledger invariants that are cheap to state and
 * decisive, and that no PRICING check can catch:
 *
 *   L1  a payment that names a booking which does not exist (an
 *       orphan: money recorded against a booking that is gone);
 *   L2  a charge that names a booking which does not exist;
 *   L3  a money amount that is not a finite number, or is negative;
 *   L4  a refund whose amount does not bring the collected total back
 *       to zero or below — i.e. a refund LARGER than what was
 *       collected, which is money leaving the hotel twice.
 *
 * L1-L4 are REPORT-ONLY (`manual-review`): this scanner's automatic
 * repair vocabulary (`set-booking-total`, `append-store-delivery-tender`)
 * is for pricing drift, and silently "repairing" a ledger is exactly
 * the kind of wide repair the audit rules forbid. Every ledger finding
 * is a decision for a human.
 *
 * The CONTINUOUS ledger coverage is the nightly reconciliation
 * (`scripts/qa/reconcile-production.ts`, checks I05/I06/I07/I08/I12/
 * I14/I17), which runs against production every night. This pass is
 * the offline counterpart for the one-off repair workflow.
 */
export function scanLedgerRecord(
  collectionName: "payments" | "refunds" | "charges",
  documentPath: string,
  data: Record<string, any>,
  knownBookingIds: Set<string>
): FinanceIntegrityFinding[] {
  const findings: FinanceIntegrityFinding[] = [];
  const entityPath = documentPath;

  const bookingId = String(data.bookingId ?? "").trim();
  if (bookingId && !knownBookingIds.has(bookingId)) {
    findings.push({
      findingId: `${entityPath}:orphan-booking-reference`,
      cohort: "ledger",
      entityPath,
      issue: `${collectionName} entry references a booking that does not exist.`,
      observedValue: `bookingId=${bookingId}`,
      expectedValue: "an existing booking id, or no bookingId at all",
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    });
  }

  const amount = finiteNumber(data.amount);
  if (amount === null) {
    findings.push({
      findingId: `${entityPath}:non-finite-amount`,
      cohort: "ledger",
      entityPath,
      issue: `${collectionName} entry has a non-finite amount.`,
      observedValue: String(data.amount),
      expectedValue: "a finite number",
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    });
  } else if (amount < 0 && collectionName !== "refunds") {
    findings.push({
      findingId: `${entityPath}:negative-amount`,
      cohort: "ledger",
      entityPath,
      issue: `${collectionName} entry has a negative amount.`,
      observedValue: money(amount),
      expectedValue: "zero or a positive amount",
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    });
  }

  return findings;
}

/**
 * L4: a refund larger than what was collected.
 *
 * The refunds live beside the payments they offset, so the caller
 * passes the two totals it already read.
 */
export function scanRefundCoverage(
  documentPath: string,
  collectedAmount: number,
  refundedAmount: number
): FinanceIntegrityFinding[] {
  if (!(refundedAmount > collectedAmount)) return [];
  return [{
    findingId: `${documentPath}:refund-exceeds-collected`,
    cohort: "ledger",
    entityPath: documentPath,
    issue: "Refunds exceed the money collected on this booking.",
    observedValue: `collected=${money(collectedAmount)} refunded=${money(refundedAmount)}`,
    expectedValue: "refunded <= collected",
    proposedAction: "manual-review",
    proposedValue: "",
    approved: "NO",
    reviewNotes: ""
  }];
}

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function findingsToCsv(findings: FinanceIntegrityFinding[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const finding of findings) {
    rows.push(CSV_COLUMNS.map((column) => csvEscape(String(finding[column] ?? ""))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function findingsFromCsv(csv: string): FinanceIntegrityFinding[] {
  const [header, ...rows] = parseCsvRows(csv);
  if (!header || header.join(",") !== CSV_COLUMNS.join(",")) {
    throw new Error("Unexpected finance integrity CSV columns.");
  }
  return rows.map((row) => Object.fromEntries(CSV_COLUMNS.map((column, index) => [column, row[index] || ""])) as FinanceIntegrityFinding);
}
