/**
 * One-off Finance Lifecycle historical integrity scanner (FLR-01).
 *
 * Report only:
 *   node --experimental-strip-types scripts/finance-integrity-scan.ts --output=/absolute/path/review.csv
 *
 * Apply only rows manually changed to approved=YES:
 *   node --experimental-strip-types scripts/finance-integrity-scan.ts --apply=/absolute/path/review.csv \
 *     --confirm=APPLY_APPROVED_FINANCE_REPAIRS
 *
 * Requires Firebase Admin variables in guest-app/.env. The default mode never
 * writes to Firestore. Apply mode revalidates every approved row transactionally.
 *
 * SCOPE (per F-D3, 2026-10-27)
 * ---------------------------
 * This scanner covers BOTH sides now:
 *
 *   * the PRICING invariants (the original FLR-01 scope): the booking
 *     total vs its rate breakdown, the revenue allocation, the
 *     corporate allocation, the other-add-on scope, and a delivered
 *     direct-paid store order's missing tender;
 *   * the LEDGER invariants: an orphan payment / refund / charge (one
 *     naming a booking that does not exist), a non-finite or negative
 *     money amount, and a refund larger than the money collected.
 *
 * The ledger findings are REPORT-ONLY (`manual-review`): this script's
 * automatic repairs are for pricing drift, and silently repairing a
 * ledger is the kind of wide repair the audit rules forbid.
 *
 * The CONTINUOUS coverage is the nightly reconciliation
 * (`scripts/qa/reconcile-production.ts` — checks I05, I06, I07, I08,
 * I12, I14, I17), which runs against production every night. This
 * script is the offline counterpart for the one-off repair workflow.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { config as dotenv } from "dotenv";

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

const CSV_COLUMNS: Array<keyof FinanceIntegrityFinding> = [
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

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value: number): string {
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

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function findingsToCsv(findings: FinanceIntegrityFinding[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const finding of findings) {
    rows.push(CSV_COLUMNS.map((column) => csvEscape(String(finding[column] ?? ""))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function parseCsvRows(csv: string): string[][] {
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

function initializeAdmin() {
  dotenv({ path: resolve(process.cwd(), "guest-app/.env") });
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing Firebase Admin variables in guest-app/.env.");
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return { db: getFirestore(), projectId: FIREBASE_PROJECT_ID };
}

async function scan(outputPath: string) {
  const { db, projectId } = initializeAdmin();
  const findings: FinanceIntegrityFinding[] = [];
  const bookings = await db.collection("bookings").get();
  for (const booking of bookings.docs) findings.push(...scanBookingRecord(booking.id, booking.data()));

  const orders = await db.collection("storeOrders").get();
  for (const order of orders.docs) {
    const deliveryTender = await order.ref.collection("payments").doc("delivery-tender").get();
    findings.push(...scanStoreOrderRecord(order.id, order.data(), deliveryTender.exists));
  }

  // Per F-D3 (2026-10-27): the LEDGER pass. The scanner previously
  // read only the pricing side, so running it gave false confidence
  // that the money was sound.
  //
  // `payments` and `refunds` live in SUBcollections (under a booking or
  // a reservation), so they are read with a collection group. `charges`
  // is a root collection.
  //
  // The store orders' own `payments/delivery-tender` documents are
  // included by the group query; a tender names no `bookingId`, so it
  // never trips the orphan check.
  const knownBookingIds = new Set(bookings.docs.map((b) => b.id));

  const paymentGroups = await db.collectionGroup("payments").get();
  for (const doc of paymentGroups.docs) {
    findings.push(
      ...scanLedgerRecord("payments", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  const refundGroups = await db.collectionGroup("refunds").get();
  for (const doc of refundGroups.docs) {
    findings.push(
      ...scanLedgerRecord("refunds", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  const chargeDocs = await db.collection("charges").get();
  for (const doc of chargeDocs.docs) {
    findings.push(
      ...scanLedgerRecord("charges", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  // L4: refunds larger than what was collected, per booking.
  const collectedByBooking = new Map<string, number>();
  for (const doc of paymentGroups.docs) {
    const d = doc.data() || {};
    const bookingId = String(d.bookingId ?? "").trim();
    const amount = finiteNumber(d.amount);
    if (!bookingId || amount === null) continue;
    collectedByBooking.set(
      bookingId,
      (collectedByBooking.get(bookingId) || 0) + amount
    );
  }
  const refundedByBooking = new Map<string, number>();
  for (const doc of refundGroups.docs) {
    const d = doc.data() || {};
    const bookingId = String(d.bookingId ?? "").trim();
    const amount = finiteNumber(d.amount);
    if (!bookingId || amount === null) continue;
    refundedByBooking.set(
      bookingId,
      (refundedByBooking.get(bookingId) || 0) + Math.abs(amount)
    );
  }
  for (const [bookingId, refunded] of refundedByBooking) {
    const collected = collectedByBooking.get(bookingId) || 0;
    findings.push(
      ...scanRefundCoverage(`bookings/${bookingId}`, collected, refunded)
    );
  }

  writeFileSync(outputPath, findingsToCsv(findings), { encoding: "utf8", flag: "wx" });
  console.log(`Finance integrity scan complete for project ${projectId}.`);
  console.log(
    `Reviewed ${bookings.size} bookings, ${orders.size} store orders, ` +
    `${paymentGroups.size} payment(s), ${refundGroups.size} refund(s) and ` +
    `${chargeDocs.size} charge(s); found ${findings.length} item(s).`
  );
  console.log(`Review CSV written to ${outputPath}. No Firestore writes were made.`);
}

function auditId(findingId: string): string {
  return createHash("sha256").update(findingId).digest("hex").slice(0, 32);
}

async function applyApproved(csvPath: string, confirmation: string) {
  if (confirmation !== "APPLY_APPROVED_FINANCE_REPAIRS") {
    throw new Error("Apply mode requires --confirm=APPLY_APPROVED_FINANCE_REPAIRS.");
  }
  const approved = findingsFromCsv(readFileSync(csvPath, "utf8")).filter((row) => row.approved === "YES");
  const { db, projectId } = initializeAdmin();
  let applied = 0;
  let skipped = 0;

  for (const finding of approved) {
    const [collectionName, documentId] = finding.entityPath.split("/");
    if (!collectionName || !documentId || finding.entityPath.split("/").length !== 2) {
      throw new Error(`Invalid entity path in approved row: ${finding.entityPath}`);
    }
    const entityRef = db.collection(collectionName).doc(documentId);
    const repairAuditRef = db.collection("financeIntegrityRepairs").doc(auditId(finding.findingId));

    const outcome = await db.runTransaction(async (transaction) => {
      const entityDoc = await transaction.get(entityRef);
      const existingAudit = await transaction.get(repairAuditRef);
      if (existingAudit.exists) return "skipped";
      if (!entityDoc.exists) throw new Error(`Approved entity no longer exists: ${finding.entityPath}`);
      const data = entityDoc.data()!;

      if (finding.proposedAction === "set-booking-total" && collectionName === "bookings") {
        const observed = finiteNumber(data.totalPrice);
        const expectedObserved = finiteNumber(finding.observedValue);
        const proposed = finiteNumber(finding.proposedValue);
        const currentBreakdownFinal = finiteNumber(data.rateBreakdown?.finalTotal);
        if (observed === null || expectedObserved === null || proposed === null
          || Math.abs(observed - expectedObserved) >= 0.01
          || currentBreakdownFinal === null || Math.abs(currentBreakdownFinal - proposed) >= 0.01) {
          throw new Error(`Booking changed after review; refusing repair: ${finding.entityPath}`);
        }
        transaction.update(entityRef, { totalPrice: proposed, updatedAt: FieldValue.serverTimestamp() });
        transaction.create(repairAuditRef, {
          findingId: finding.findingId,
          cohort: finding.cohort,
          entityPath: finding.entityPath,
          action: finding.proposedAction,
          before: observed,
          after: proposed,
          reviewNotes: finding.reviewNotes,
          appliedAt: FieldValue.serverTimestamp(),
          appliedBy: "finance-integrity-scan"
        });
        return "applied";
      }

      if (finding.proposedAction === "append-store-delivery-tender" && collectionName === "storeOrders") {
        const amount = finiteNumber(data.totalAmount);
        const proposed = finiteNumber(finding.proposedValue);
        if (data.status !== "delivered" || data.paymentMethod === "add-to-bill" || amount === null || proposed === null
          || amount <= 0 || Math.abs(amount - proposed) >= 0.01) {
          throw new Error(`Store order changed after review; refusing repair: ${finding.entityPath}`);
        }
        const tenderRef = entityRef.collection("payments").doc("delivery-tender");
        const tenderDoc = await transaction.get(tenderRef);
        if (tenderDoc.exists) return "skipped";
        const recordedAt = data.deliveredAt || data.createdAt || FieldValue.serverTimestamp();
        transaction.create(tenderRef, {
          type: "payment",
          amount,
          method: data.paymentMethod === "cod" ? "cash" : String(data.paymentMethod || "unknown"),
          note: `Historical direct store payment for ${String(data.orderRef || documentId)}`.slice(0, 500),
          reason: null,
          approvedBy: null,
          recordedBy: "finance-integrity-scan",
          recordedAt,
          source: "store-order",
          sourceId: documentId,
          orderRef: String(data.orderRef || documentId),
          roomNumber: String(data.roomNumber || ""),
          guestName: String(data.guestName || "")
        });
        transaction.create(repairAuditRef, {
          findingId: finding.findingId,
          cohort: finding.cohort,
          entityPath: finding.entityPath,
          action: finding.proposedAction,
          amount,
          reviewNotes: finding.reviewNotes,
          appliedAt: FieldValue.serverTimestamp(),
          appliedBy: "finance-integrity-scan"
        });
        return "applied";
      }

      throw new Error(`Approved row has no supported repair action: ${finding.findingId}`);
    });
    if (outcome === "applied") applied += 1;
    else skipped += 1;
  }

  console.log(`Finance integrity apply complete for project ${projectId}: ${applied} applied, ${skipped} already resolved.`);
}

function argValue(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

async function main() {
  const output = argValue("output");
  const apply = argValue("apply");
  if (Boolean(output) === Boolean(apply)) {
    throw new Error("Choose exactly one mode: --output=/absolute/review.csv or --apply=/absolute/review.csv.");
  }
  if (output) await scan(resolve(output));
  else await applyApproved(resolve(apply), argValue("confirm"));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
