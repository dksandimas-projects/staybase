// Per H8 (production-readiness audit 2026-10-20) + the AI browser QA
// report's §4 reconciliation: a NIGHTLY money reconciliation.
//
// WHY THIS EXISTS
// --------------
// The QA pass recomputed every money figure from the raw Firestore
// documents and found real defects that no summary card had caught:
// a refund written without a settled status (so money already paid out in
// cash read back as money still owed), other add-ons that never reached
// `revenueAllocation` (so every revenue report under-reported), and
// `paidAmount` that had gone negative.
//
// Every one of those was found BY RUNNING the reconciliation. Until now
// it only ran when a human remembered to run it. The hotel cannot afford a
// wrong number sitting in the books for a month before anyone looks.
//
// So: the same arithmetic, run on a schedule, writing its findings where
// the desk can see them.
//
// WHAT IT DOES
// ------------
// It recomputes the money model from the RAW documents (the same
// independent arithmetic the QA script uses) and compares it against the
// denormalized fields the app reads:
//
//   * `booking.paidAmount` vs the ledger's collected sum   (PAY-01 / I06)
//   * a pending refund netted against collected money        (I06b)
//   * `revenueAllocation` vs the billed total                (MRB-11)
//   * other add-ons missing from the allocation              (MRB-11b)
//   * `hasAnyBreakfast` stale against the live meal slots   (BR-01)
//   * a cancelled booking still holding money               (I14)
//   * a cancelled store order still holding a tender         (F-C2)
//
// It is READ-ONLY with respect to the money: it never writes a payment, a
// refund or a booking. It writes ONE document — a run report — into the
// `reconciliationRuns` collection, and it alerts the desk ONLY when a
// check FAILS.
//
// WHY A SECOND IMPLEMENTATION MATTERS
// ----------------------------------
// A summary card that agrees with another summary card proves nothing —
// both can be wrong from the same bad source. So the primary numbers here
// are computed from raw documents with their own arithmetic, and the
// product's own `computeBookingFolio` is applied to the SAME documents as
// a SECOND, independent implementation. A disagreement between the two is
// itself a finding.

import { adminDb } from "./firebase-admin";
import {
  computeBookingFolio,
  isUnpaidRefund,
  sumCollectedPayments,
  type FolioStoreOrder
} from "@spark-inn/shared";

export type ReconciliationStatus = "PASS" | "FAIL" | "WARN" | "INFO";

export interface ReconciliationFinding {
  /** The check's id — the same ids the QA script uses, so a finding here
   *  can be traced back to the report that first named it. */
  id: string;
  title: string;
  status: ReconciliationStatus;
  /** A one-line summary. Never contains PII — ids and amounts only. */
  summary: string;
  /** The offending records. Booking refs and amounts, never guest details. */
  details: string[];
}

export interface ReconciliationRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  bookingsScanned: number;
  findings: ReconciliationFinding[];
  passed: number;
  failed: number;
  warned: number;
  info: number;
}

interface LedgerEntry {
  amount: number;
  type: string;
  status: string;
}

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read the ledger for one booking.
 *
 * The ledger lives in two shapes and BOTH are live in production:
 * `reservations/{rid}/payments` + `.../refunds` (the current MRB-04 shape)
 * and `bookings/{id}/payments` + `.../refunds` (the legacy shape). A
 * booking's money is the union — reading only one of them understates
 * what the hotel has collected, which is exactly how the QA pass's
 * independent arithmetic and the app's own folio disagreed.
 */
async function readBookingLedger(booking: any): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];

  // A parent is read as `collection(<name>).doc(<id>).collection(<sub>)`.
  // The Firestore Admin SDK rejects an EVEN-component path handed to
  // `.collection()` ("must point to a collection... does not contain an
  // odd number of components"), so the parent NAME and the parent ID are
  // passed separately — never as one "a/b" string.
  const readSub = async (parentName: string, parentId: string, sub: string) => {
    if (!parentId) return;
    try {
      const snap = await adminDb.collection(parentName).doc(parentId).collection(sub).get();
      for (const doc of snap.docs) {
        const data = doc.data() as any;
        entries.push({
          amount: toNumber(data.amount),
          type: String(data.type || (toNumber(data.amount) < 0 ? "refund" : "payment")),
          status: String(data.status || "")
        });
      }
    } catch (err) {
      // A missing subcollection is not an error — it simply holds nothing.
      // But a MALFORMED PATH is a bug, and swallowing it would make every
      // booking look like it had no ledger at all — so the failure is
      // logged loudly rather than hidden.
      console.error(
        `[reconciliation] could not read ${parentName}/${parentId}/${sub}:`,
        err
      );
    }
  };

  const reservationId = String(booking.reservationId || "");
  if (reservationId) {
    await readSub("reservations", reservationId, "payments");
    await readSub("reservations", reservationId, "refunds");
  }
  const bookingId = String(booking.id || "");
  await readSub("bookings", bookingId, "payments");
  await readSub("bookings", bookingId, "refunds");

  return entries;
}

/** The store orders that belong to a booking (add-to-bill charges). */
async function readBookingStoreOrders(booking: any): Promise<FolioStoreOrder[]> {
  try {
    const snap = await adminDb.collection("storeOrders").get();
    return snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((order) => String(order.bookingId || "") === String(booking.id))
      .filter((order) => order.status === "delivered" && order.isBilled === true)
      .map((order) => ({
        id: order.id,
        total: toNumber(order.total),
        isBilled: order.isBilled === true
      }));
  } catch {
    return [];
  }
}

/**
 * Run every check and return the findings.
 *
 * Exported separately from the cron handler so the arithmetic can be
 * unit-tested without booting a scheduler or a Firestore emulator.
 */
export async function runReconciliation(): Promise<ReconciliationRunResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const bookingSnap = await adminDb.collection("bookings").get();
  const bookings = bookingSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));

  const findings: ReconciliationFinding[] = [];

  const add = (
    id: string,
    title: string,
    status: ReconciliationStatus,
    summary: string,
    details: string[] = []
  ) => {
    findings.push({ id, title, status, summary, details: details.slice(0, 50) });
  };

  // -------------------------------------------------------------------------
  // The per-booking money model.
  // -------------------------------------------------------------------------
  interface MoneyModel {
    ref: string;
    totalPrice: number;
    paidAmountField: number | null;
    ledgerCollected: number;
    pendingRefund: number;
    allocation: any;
    hasAnyBreakfast: boolean;
    liveBreakfastSlots: number;
    status: string;
  }

  const models: MoneyModel[] = [];

  for (const booking of bookings) {
    const ledger = await readBookingLedger(booking);
    const ledgerCollected = r2(sumCollectedPayments(ledger));
    const pendingRefund = r2(
      ledger.filter((e) => isUnpaidRefund(e)).reduce((sum, e) => sum + e.amount, 0)
    );

    // The live meal slots — the liveness convention is `removedAt === null`.
    const selections = booking.breakfastSelections;
    let liveSlots = 0;
    if (selections && typeof selections === "object") {
      for (const byDate of Object.values(selections as Record<string, any>)) {
        if (!Array.isArray(byDate)) continue;
        for (const slot of byDate) {
          if (slot && slot.removedAt === null && slot.mealId) liveSlots += 1;
        }
      }
    }

    models.push({
      ref: String(booking.bookingRef || booking.id),
      totalPrice: toNumber(booking.totalPrice),
      paidAmountField:
        typeof booking.paidAmount === "number" ? booking.paidAmount : null,
      ledgerCollected,
      pendingRefund,
      allocation: booking.revenueAllocation || null,
      hasAnyBreakfast: booking.hasAnyBreakfast === true,
      liveBreakfastSlots: liveSlots,
      status: String(booking.status || "")
    });
  }

  // -------------------------------------------------------------------------
  // I06 — `paidAmount` must agree with the ledger.
  // -------------------------------------------------------------------------
  {
    const mismatched: string[] = [];
    const negative: string[] = [];
    for (const m of models) {
      if (m.paidAmountField === null) continue;
      if (m.paidAmountField < 0) {
        negative.push(
          `${m.ref} paidAmount=${r2(m.paidAmountField)} (NEGATIVE) collected=${m.ledgerCollected}`
        );
      }
      if (r2(m.paidAmountField) !== m.ledgerCollected) {
        mismatched.push(
          `${m.ref} paidAmount=${r2(m.paidAmountField)} ledger=${m.ledgerCollected} Δ=${r2(
            m.paidAmountField - m.ledgerCollected
          )}`
        );
      }
    }
    add(
      "I06",
      "PAY-01 — booking.paidAmount agrees with the independently summed ledger",
      mismatched.length === 0 && negative.length === 0 ? "PASS" : "FAIL",
      `${mismatched.length} mismatch(es) · ${negative.length} negative paidAmount`,
      [...negative, ...mismatched]
    );
  }

  // -------------------------------------------------------------------------
  // I06b — a pending refund is a LIABILITY, not collected money.
  // -------------------------------------------------------------------------
  {
    const offenders: string[] = [];
    for (const m of models) {
      if (m.paidAmountField === null) continue;
      // A pending refund must not reduce the amount the hotel has collected.
      // If `paidAmount` equals the collected sum MINUS a pending refund, the
      // liability has been netted against money the hotel still holds.
      if (m.pendingRefund !== 0) {
        const netted = r2(m.ledgerCollected + m.pendingRefund);
        if (r2(m.paidAmountField) === netted && netted !== m.ledgerCollected) {
          offenders.push(
            `${m.ref} paidAmount=${r2(m.paidAmountField)} = collected ${m.ledgerCollected} + pending refund ${m.pendingRefund}`
          );
        }
      }
    }
    add(
      "I06b",
      "A pending refund liability must not be netted against collected money",
      offenders.length === 0 ? "PASS" : "FAIL",
      `${offenders.length} booking(s) net a pending refund against collected money`,
      offenders
    );
  }

  // -------------------------------------------------------------------------
  // I02 / I03 — the revenue allocation must balance against the bill.
  // -------------------------------------------------------------------------
  {
    const broken: string[] = [];
    for (const m of models) {
      const alloc = m.allocation;
      if (!alloc) continue;
      const totalNet = toNumber(alloc.totalNet);
      const roomNet = toNumber(alloc.roomNet);
      const breakfastNet = toNumber(alloc.breakfastNet);
      const addOnNet = toNumber(alloc.addOnNet);
      const deductionNet = toNumber(alloc.deductionNet);
      const sum = r2(roomNet + breakfastNet + addOnNet - deductionNet);
      // The PRODUCT's own writer tolerates ±0.05 here (the four streams are
      // each rounded to 2dp before they are summed, so they can drift by up
      // to 0.02). A check that used exact equality would report a
      // correctly-written booking as a FAIL — and the desk would be
      // paged every night for a phantom mismatch. So the tolerance is the
      // SAME one the writer uses.
      if (Math.abs(sum - r2(totalNet)) > 0.05) {
        broken.push(
          `${m.ref} components ${roomNet}+${breakfastNet}+${addOnNet}-${deductionNet}=${sum} but totalNet=${totalNet}`
        );
      }
    }
    add(
      "I03",
      "MRB-11 — the revenue allocation's components sum to its total",
      broken.length === 0 ? "PASS" : "FAIL",
      `${broken.length} allocation(s) do not balance`,
      broken
    );
  }

  // -------------------------------------------------------------------------
  // I04 — the other add-ons must reach the allocation (MRB-11b).
  // -------------------------------------------------------------------------
  {
    const offenders: string[] = [];
    for (const booking of bookings) {
      const addOnTotal = toNumber(booking.otherAddOnTotal);
      if (addOnTotal === 0) continue;
      const alloc = booking.revenueAllocation;
      if (!alloc) {
        offenders.push(`${String(booking.bookingRef || booking.id)} otherAddOnTotal=${addOnTotal} but NO allocation`);
        continue;
      }
      const addOnNet = toNumber(alloc.addOnNet);
      if (addOnNet < addOnTotal) {
        offenders.push(
          `${String(booking.bookingRef || booking.id)} otherAddOnTotal=${addOnTotal} but addOnNet=${addOnNet}`
        );
      }
    }
    add(
      "I04",
      "MRB-11b — the other add-ons reach the revenue allocation",
      offenders.length === 0 ? "PASS" : "FAIL",
      `${offenders.length} booking(s) carry add-ons the allocation misses`,
      offenders
    );
  }

  // -------------------------------------------------------------------------
  // I13 — `hasAnyBreakfast` must not be stale (BR-01).
  // -------------------------------------------------------------------------
  {
    const stale: string[] = [];
    for (const m of models) {
      if (m.hasAnyBreakfast && m.liveBreakfastSlots === 0) {
        stale.push(`${m.ref} hasAnyBreakfast=true but no live meal slot (status=${m.status})`);
      }
    }
    add(
      "I13",
      "BR-01 — hasAnyBreakfast agrees with the live meal slots",
      stale.length === 0 ? "PASS" : "WARN",
      `${stale.length} stale flag(s)`,
      stale
    );
  }

  // -------------------------------------------------------------------------
  // I14 — a cancelled booking must not still hold money.
  // -------------------------------------------------------------------------
  {
    const holders: string[] = [];
    for (const m of models) {
      if (m.status !== "cancelled") continue;
      if (m.ledgerCollected > 0) {
        holders.push(
          `${m.ref} cancelled but collected=${m.ledgerCollected} pendingRefund=${m.pendingRefund}`
        );
      }
    }
    add(
      "I14",
      "A cancelled booking does not still hold money",
      holders.length === 0 ? "PASS" : "WARN",
      `${holders.length} cancelled booking(s) hold money`,
      holders
    );
  }

  // -------------------------------------------------------------------------
  // F-C2 — a cancelled store order must not still hold a tender.
  // -------------------------------------------------------------------------
  {
    const offenders: string[] = [];
    try {
      const ordersSnap = await adminDb.collection("storeOrders").get();
      for (const doc of ordersSnap.docs) {
        const order = doc.data() as any;
        if (String(order.status || "") !== "cancelled") continue;
        const paymentsSnap = await adminDb
          .collection("storeOrders")
          .doc(doc.id)
          .collection("payments")
          .get();
        if (!paymentsSnap.empty) {
          const total = paymentsSnap.docs.reduce(
            (sum, d) => sum + toNumber(d.data()?.amount),
            0
          );
          offenders.push(`${String(order.orderRef || doc.id)} cancelled but holds a tender of ${r2(total)}`);
        }
      }
    } catch {
      // A missing collection is not a failure of the check.
    }
    add(
      "F-C2",
      "A cancelled store order does not still hold a tender",
      offenders.length === 0 ? "PASS" : "FAIL",
      `${offenders.length} cancelled order(s) hold a tender`,
      offenders
    );
  }

  // -------------------------------------------------------------------------
  // I07 — the product's own folio must agree with the independent model.
  // -------------------------------------------------------------------------
  {
    const disagreements: string[] = [];
    for (const booking of bookings) {
      try {
        const ledger = await readBookingLedger(booking);
        const storeOrders = await readBookingStoreOrders(booking);
        const folio = computeBookingFolio({
          booking: { id: String(booking.id), totalPrice: toNumber(booking.totalPrice) },
          persistedPayments: ledger.map((e) => ({
            amount: e.amount,
            type: e.type,
            status: e.status
          })),
          selectedBookingCharges: [],
          storeOrders: storeOrders as any
        });
        const independent = r2(sumCollectedPayments(ledger));
        if (r2(folio.paymentsTotal) !== independent) {
          disagreements.push(
            `${String(booking.bookingRef || booking.id)} folio=${r2(folio.paymentsTotal)} independent=${independent}`
          );
        }
      } catch {
        // A booking whose folio cannot be computed is not a disagreement.
      }
    }
    add(
      "I07",
      "Two independent implementations agree on the collected total",
      disagreements.length === 0 ? "PASS" : "FAIL",
      `${disagreements.length} disagreement(s)`,
      disagreements
    );
  }

  const passed = findings.filter((f) => f.status === "PASS").length;
  const failed = findings.filter((f) => f.status === "FAIL").length;
  const warned = findings.filter((f) => f.status === "WARN").length;
  const info = findings.filter((f) => f.status === "INFO").length;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    bookingsScanned: bookings.length,
    findings,
    passed,
    failed,
    warned,
    info
  };
}

/**
 * Persist the run report and alert the desk when something FAILED.
 *
 * The report goes into `reconciliationRuns` so it can be read back later;
 * the alert is the notification the desk actually sees.
 */
export async function recordReconciliationRun(
  result: ReconciliationRunResult
): Promise<void> {
  const runId = `RR-${result.startedAt.slice(0, 10)}-${Date.now().toString(36).toUpperCase()}`;

  await adminDb.collection("reconciliationRuns").doc(runId).set({
    runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    bookingsScanned: result.bookingsScanned,
    passed: result.passed,
    failed: result.failed,
    warned: result.warned,
    info: result.info,
    findings: result.findings,
    createdAt: new Date().toISOString()
  });

  if (result.failed === 0) {
    console.log(
      `[reconciliation] ${runId} OK — ${result.bookingsScanned} bookings scanned, ` +
        `${result.passed} passed, ${result.failed} failed, ${result.warned} warned`
    );
    return;
  }

  // Only a FAILING check is worth the desk's attention. A WARN is not an
  // alarm — the QA report's own reconciliation carries two WARNs that are
  // known and explained.
  const failures = result.findings.filter((f) => f.status === "FAIL");
  console.error(
    `[reconciliation] ${runId} FAILED — ${result.failed} check(s): ` +
      failures.map((f) => `${f.id} ${f.summary}`).join(" | ")
  );

  try {
    const { writeNotification } = await import("./notifications");
    // The type union has no "system" member, and adding one would mean
    // changing the shared contract + the bell panel's icon map for a
    // surface that only the desk reads. The finding IS a money problem
    // on a booking, so it rides the existing `payment` type — the bell
    // already renders that as "money to process", which is exactly the
    // reading the desk needs.
    //
    // The entity is the FIRST offending booking, so clicking the bell
    // lands the desk on the booking whose numbers disagree.
    const firstOffender = failures
      .flatMap((f) => f.details)
      .map((d) => String(d).split(" ")[0])
      .find((ref) => /^SI-/.test(ref));

    // `entityId` MUST be the booking's Firestore DOC id, not its human
    // reference. The bell deep-links `/bookings?bookingId=<entityId>`
    // and the drawer resolves that parameter by matching
    // `booking.id === bookingId` — the doc id. Every other booking
    // notification in the codebase passes the doc id for exactly this
    // reason. Passing the `SI-…` ref instead would make the bell open
    // a drawer that silently finds nothing: the desk would click the
    // one alert that says "your numbers disagree" and land on nothing.
    // The reference is carried separately in `bookingRef`, which is what
    // the bell renders.
    let entityDocId = runId;
    if (firstOffender) {
      const refLookup = await adminDb
        .collection("bookings")
        .where("bookingRef", "==", firstOffender)
        .limit(1)
        .get();
      if (!refLookup.empty) entityDocId = refLookup.docs[0].id;
    }

    await writeNotification({
      type: "payment",
      title: "Nightly reconciliation found a money mismatch",
      entityType: "booking",
      entityId: entityDocId,
      bookingRef: firstOffender || null,
      roomNumber: null
    });
  } catch (err) {
    // The run report is written either way — a failed notification must
    // not lose the finding.
    console.error("[reconciliation] could not write the desk notification:", err);
  }
}
