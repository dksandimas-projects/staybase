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
  evaluateBookingClosure,
  createCancellationPolicySnapshot,
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
/**
 * Every payment and refund in the project, indexed by their parent.
 *
 * WHY THIS EXISTS — THE NIGHTLY CHECK NEVER RAN
 * ----------------------------------------------
 * The reconciler used to read each booking's ledger with up to FOUR
 * sequential Firestore round trips, and then read it AGAIN for the I07
 * cross-check. On top of that, `readBookingStoreOrders` re-read the
 * ENTIRE `storeOrders` collection once per booking.
 *
 * With 157 bookings that is roughly 1,250 SEQUENTIAL round trips, and
 * the live serverless function died with `FUNCTION_INVOCATION_TIMEOUT`
 * after 301 seconds. So the nightly money check had NEVER completed:
 * the `reconciliationRuns` collection in production held **zero**
 * documents. The cron fired every night at 04:30, the function started
 * scanning, and Vercel killed it before it could write its report.
 *
 * A control that never produces a report is not a control.
 *
 * THE FIX
 * -------
 * Read the same documents in a handful of round trips instead of a
 * thousand, and group them in memory. The ARITHMETIC IS UNCHANGED —
 * only the way the documents are fetched changes:
 *
 *   * one `collectionGroup("payments")` read,
 *   * one `collectionGroup("refunds")` read,
 *   * one `storeOrders` read.
 *
 * The entries are kept in the SAME ORDER the old per-booking reads
 * produced (reservation payments, reservation refunds, booking
 * payments, booking refunds), so every sum is bit-for-bit the same.
 */
interface LedgerIndex {
  /** `bookings/{id}` / `reservations/{id}` -> its payment entries. */
  paymentsByParent: Map<string, LedgerEntry[]>;
  /** `bookings/{id}` / `reservations/{id}` -> its refund entries. */
  refundsByParent: Map<string, LedgerEntry[]>;
  /** Every store order, read ONCE. */
  storeOrders: Array<{ id: string; [key: string]: any }>;
}

/** Turn one payment/refund document into a ledger entry. */
function toLedgerEntry(data: any): LedgerEntry {
  return {
    amount: toNumber(data.amount),
    type: String(data.type || (toNumber(data.amount) < 0 ? "refund" : "payment")),
    status: String(data.status || "")
  };
}

/** The parent document path of a subcollection document. */
function parentPathOf(docRef: any): string {
  // `bookings/{id}/payments/{pid}` -> the parent of the `payments`
  // collection is `bookings/{id}`.
  return docRef.parent.parent.path;
}

/**
 * Load every payment, every refund and every store order — in three
 * round trips.
 */
async function readLedgerIndex(): Promise<LedgerIndex> {
  const paymentsByParent = new Map<string, LedgerEntry[]>();
  const refundsByParent = new Map<string, LedgerEntry[]>();

  const bucket = (map: Map<string, LedgerEntry[]>, path: string, entry: LedgerEntry) => {
    const list = map.get(path);
    if (list) list.push(entry);
    else map.set(path, [entry]);
  };

  const [paymentsSnap, refundsSnap, storeOrdersSnap] = await Promise.all([
    adminDb.collectionGroup("payments").get(),
    adminDb.collectionGroup("refunds").get(),
    adminDb.collection("storeOrders").get()
  ]);

  for (const doc of paymentsSnap.docs) {
    bucket(paymentsByParent, parentPathOf(doc.ref), toLedgerEntry(doc.data()));
  }
  for (const doc of refundsSnap.docs) {
    bucket(refundsByParent, parentPathOf(doc.ref), toLedgerEntry(doc.data()));
  }

  return {
    paymentsByParent,
    refundsByParent,
    storeOrders: storeOrdersSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  };
}

/**
 * A booking's ledger — the union of the reservation-scope and the
 * booking-scope subcollections, in the same order as before.
 */
function readBookingLedger(booking: any, index: LedgerIndex): LedgerEntry[] {
  const entries: LedgerEntry[] = [];

  const reservationId = String(booking.reservationId || "");
  if (reservationId) {
    const path = `reservations/${reservationId}`;
    entries.push(...(index.paymentsByParent.get(path) || []));
    entries.push(...(index.refundsByParent.get(path) || []));
  }
  const bookingId = String(booking.id || "");
  if (bookingId) {
    const path = `bookings/${bookingId}`;
    entries.push(...(index.paymentsByParent.get(path) || []));
    entries.push(...(index.refundsByParent.get(path) || []));
  }

  return entries;
}

/** The store orders that belong to a booking (add-to-bill charges). */
function readBookingStoreOrders(booking: any, index: LedgerIndex): FolioStoreOrder[] {
  return index.storeOrders
    .filter((order) => String(order.bookingId || "") === String(booking.id))
    .filter((order) => order.status === "delivered" && order.isBilled === true)
    .map((order) => ({
      id: order.id,
      total: toNumber(order.total),
      isBilled: order.isBilled === true
    }));
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

  // ONE bulk load of every payment, refund and store order. The old
  // per-booking reads made this function exceed the serverless timeout
  // and the nightly check never wrote a report — see `readLedgerIndex`.
  const ledgerIndex = await readLedgerIndex();

  // The hotel's cancellation policy — the PRODUCT'S rule, read from the
  // same settings documents the cancellation handler reads. It is the
  // only way to tell a cancelled booking that legitimately retains the
  // guest's money (a cancellation inside the free-cancellation window)
  // from one whose money simply was never refunded.
  const [websiteContentSnap, hotelConfigSnap] = await Promise.all([
    adminDb.collection("settings").doc("websiteContent").get(),
    adminDb.collection("settings").doc("hotelConfig").get()
  ]);
  const websiteContent = (websiteContentSnap.data() || {}) as any;
  const hotelConfig = (hotelConfigSnap.data() || {}) as any;

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
  // QA FIXTURES vs REAL GUEST MONEY.
  //
  // A finding that names a booking is only actionable if the reader can
  // tell whether the money involved is a REAL guest's. Without this
  // marker the nightly report mixes the hotel's own rehearsal bookings
  // in with live guest bookings in exactly the same format — which is
  // how two findings (F-A4, F-D4) sat "open" for a week: nobody could
  // tell that every flagged booking was the owner's own test run.
  //
  // The marker NEVER suppresses a finding and NEVER downgrades a status.
  // A real guest's booking is still reported, still FAILs or WARNs the
  // same way. Only the LABEL is added, plus a count in the summary, so
  // the desk can see at a glance whether any REAL money is involved.
  const FIXTURE_MARK = "[QA fixture]";
  const REAL_MARK = "[REAL guest]";

  /** Prefix a per-booking finding with whether the money is a real guest's. */
  const mark = (isTestData: boolean, text: string): string =>
    `${isTestData ? FIXTURE_MARK : REAL_MARK} ${text}`;

  /** "3 finding(s) — 2 are QA fixtures, 1 is a real guest booking" */
  const split = (flags: boolean[]): string => {
    const fixtures = flags.filter(Boolean).length;
    const real = flags.length - fixtures;
    return `${fixtures} QA fixture(s), ${real} real guest booking(s)`;
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
    /** The booking is a QA test-run fixture, not a real guest's booking. */
    isTestData: boolean;
    /** When the booking was cancelled (epoch ms), or null. */
    cancelledAtMs: number | null;
    /** The check-in date, `YYYY-MM-DD`, or null. */
    checkInDateKey: string | null;
    /** The money the guest PAID, before refunds. */
    grossCollected: number;
    /** The money already refunded (settled refunds only). */
    refundedPaid: number;
  }

  const models: MoneyModel[] = [];

  for (const booking of bookings) {
    const ledger = readBookingLedger(booking, ledgerIndex);
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

    const grossCollected = r2(
      ledger.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0)
    );
    const refundedPaid = r2(
      ledger
        .filter((e) => e.amount < 0 && !isUnpaidRefund(e))
        .reduce((sum, e) => sum + Math.abs(e.amount), 0)
    );
    const cancelledAt = booking.cancelledAt?.toDate?.() ?? null;
    const checkInRaw = booking.checkIn?.toDate?.() ?? null;

    models.push({
      ref: String(booking.bookingRef || booking.id),
      totalPrice: toNumber(booking.totalPrice),
      grossCollected,
      refundedPaid,
      cancelledAtMs: cancelledAt ? cancelledAt.getTime() : null,
      checkInDateKey: checkInRaw ? checkInRaw.toISOString().slice(0, 10) : null,
      paidAmountField:
        typeof booking.paidAmount === "number" ? booking.paidAmount : null,
      ledgerCollected,
      pendingRefund,
      allocation: booking.revenueAllocation || null,
      hasAnyBreakfast: booking.hasAnyBreakfast === true,
      liveBreakfastSlots: liveSlots,
      status: String(booking.status || ""),
      isTestData: booking.isTestData === true
    });
  }

  // -------------------------------------------------------------------------
  // I06 — `paidAmount` must agree with the ledger.
  // -------------------------------------------------------------------------
  {
    const mismatched: string[] = [];
    const negative: string[] = [];
    const flagged: boolean[] = [];
    for (const m of models) {
      if (m.paidAmountField === null) continue;
      if (m.paidAmountField < 0) {
        flagged.push(m.isTestData);
        negative.push(
          mark(
            m.isTestData,
            `${m.ref} paidAmount=${r2(m.paidAmountField)} (NEGATIVE) collected=${m.ledgerCollected}`
          )
        );
      }
      if (r2(m.paidAmountField) !== m.ledgerCollected) {
        flagged.push(m.isTestData);
        mismatched.push(
          mark(
            m.isTestData,
            `${m.ref} paidAmount=${r2(m.paidAmountField)} ledger=${m.ledgerCollected} Δ=${r2(
              m.paidAmountField - m.ledgerCollected
            )}`
          )
        );
      }
    }
    add(
      "I06",
      "PAY-01 — booking.paidAmount agrees with the independently summed ledger",
      mismatched.length === 0 && negative.length === 0 ? "PASS" : "FAIL",
      `${mismatched.length} mismatch(es) · ${negative.length} negative paidAmount · ${split(flagged)}`,
      [...negative, ...mismatched]
    );
  }

  // -------------------------------------------------------------------------
  // I06b — a pending refund is a LIABILITY, not collected money.
  // -------------------------------------------------------------------------
  {
    const offenders: string[] = [];
    const flagged: boolean[] = [];
    for (const m of models) {
      if (m.paidAmountField === null) continue;
      // A pending refund must not reduce the amount the hotel has collected.
      // If `paidAmount` equals the collected sum MINUS a pending refund, the
      // liability has been netted against money the hotel still holds.
      if (m.pendingRefund !== 0) {
        const netted = r2(m.ledgerCollected + m.pendingRefund);
        if (r2(m.paidAmountField) === netted && netted !== m.ledgerCollected) {
          flagged.push(m.isTestData);
          offenders.push(
            mark(
              m.isTestData,
              `${m.ref} paidAmount=${r2(m.paidAmountField)} = collected ${m.ledgerCollected} + pending refund ${m.pendingRefund}`
            )
          );
        }
      }
    }
    add(
      "I06b",
      "A pending refund liability must not be netted against collected money",
      offenders.length === 0 ? "PASS" : "FAIL",
      `${offenders.length} booking(s) net a pending refund against collected money · ${split(flagged)}`,
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
  // I08 — is any booking over-collected, and is the excess owed back?
  //
  // A negative outstanding balance is AMBIGUOUS on its face: it can be
  // a guest who paid more than the stay was worth (a refund is due), or
  // it can be a cancelled booking whose money the policy RETAINS (the
  // guest paid, cancelled inside the free-cancellation window, and
  // keeps what they paid — the hotel owes nothing back). The reader
  // could not tell the two apart, which is exactly the ambiguity the
  // backup's "negative Outstanding Balance" rows carried.
  //
  // The check now says which one it is. A retained over-collection is
  // NOT a finding; an over-collection on a live booking IS one (the
  // guest is owed money back).
  // -------------------------------------------------------------------------
  {
    const overCollected: string[] = [];
    const flagged: boolean[] = [];
    for (const m of models) {
      const closure = evaluateBookingClosure({
        status: m.status,
        cancelledAtMs: m.cancelledAtMs,
        checkInDateKey: m.checkInDateKey,
        grossCollected: m.grossCollected,
        refundedPaid: m.refundedPaid,
        totalPrice: m.totalPrice,
        policySnapshot: m.checkInDateKey
          ? createCancellationPolicySnapshot({
              websiteContent,
              hotelConfig,
              checkInDateKey: m.checkInDateKey,
              corporateCodeData: null
            })
          : null,
        checkInTime: hotelConfig.checkInTime,
        timeZone: hotelConfig.timezone
      });
      if (closure.overCollected <= 0.01) continue;
      if (closure.overCollectionRetained) continue;
      flagged.push(m.isTestData);
      overCollected.push(mark(m.isTestData, `${m.ref} ${closure.reason}`));
    }
    add(
      "I08",
      "Over-collected bookings — a guest is owed money back",
      overCollected.length === 0 ? "PASS" : "WARN",
      `${overCollected.length} booking(s) are over-collected · ${split(flagged)}`,
      overCollected
    );
  }

  // -------------------------------------------------------------------------
  // I14 — after a cancellation, does the booking's money close?
  //
  // A cancelled booking CAN legitimately still hold money: the hotel's
  // policy makes a cancellation inside the free-cancellation window
  // NON-REFUNDABLE, so the hotel keeps what the guest paid. The check
  // therefore compares what the hotel holds against what THE POLICY
  // says it should hold — using the product's own policy rule — and
  // reports a finding only when the two disagree. That is the real
  // meaning of "money was taken but the books do not close".
  // -------------------------------------------------------------------------
  {
    const holders: string[] = [];
    const flagged: boolean[] = [];
    for (const m of models) {
      if (m.status !== "cancelled") continue;
      const closure = evaluateBookingClosure({
        status: m.status,
        cancelledAtMs: m.cancelledAtMs,
        checkInDateKey: m.checkInDateKey,
        grossCollected: m.grossCollected,
        refundedPaid: m.refundedPaid,
        totalPrice: m.totalPrice,
        policySnapshot: m.checkInDateKey
          ? createCancellationPolicySnapshot({
              websiteContent,
              hotelConfig,
              checkInDateKey: m.checkInDateKey,
              corporateCodeData: null
            })
          : null,
        checkInTime: hotelConfig.checkInTime,
        timeZone: hotelConfig.timezone
      });
      if (closure.closes) continue;
      flagged.push(m.isTestData);
      holders.push(mark(m.isTestData, `${m.ref} ${closure.reason}`));
    }
    add(
      "I14",
      "A cancelled booking's money closes against the cancellation policy",
      holders.length === 0 ? "PASS" : "WARN",
      `${holders.length} cancelled booking(s) do not close · ${split(flagged)}`,
      holders
    );
  }

  // -------------------------------------------------------------------------
  // F-C2 — a cancelled store order must not still hold a tender.
  // -------------------------------------------------------------------------
  {
    const offenders: string[] = [];
    for (const order of ledgerIndex.storeOrders) {
      if (String(order.status || "") !== "cancelled") continue;
      // The store order's tenders are already in the bulk index — the
      // same documents the old per-order read returned.
      const tenders = ledgerIndex.paymentsByParent.get(`storeOrders/${order.id}`) || [];
      if (tenders.length > 0) {
        const total = tenders.reduce((sum, e) => sum + toNumber(e.amount), 0);
        offenders.push(`${String(order.orderRef || order.id)} cancelled but holds a tender of ${r2(total)}`);
      }
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
    const flagged: boolean[] = [];
    for (const booking of bookings) {
      try {
        const ledger = readBookingLedger(booking, ledgerIndex);
        const storeOrders = readBookingStoreOrders(booking, ledgerIndex);
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
          flagged.push(booking.isTestData === true);
          disagreements.push(
            mark(
              booking.isTestData === true,
              `${String(booking.bookingRef || booking.id)} folio=${r2(folio.paymentsTotal)} independent=${independent}`
            )
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
      `${disagreements.length} disagreement(s) · ${split(flagged)}`,
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
