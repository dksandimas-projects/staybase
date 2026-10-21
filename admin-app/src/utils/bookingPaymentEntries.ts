// Per RPT-01 (QA pass 2026-10-21): the canonical payment ledger for
// the admin bookings list.
//
// THE BUG THIS FILE FIXES
// -----------------------
// The admin bookings mapper (`AdminContext.tsx`) hydrates
// `booking.onsitePayments` — the DENORMALIZED array that the booking
// doc is supposed to carry — and four separate admin surfaces read it:
//
//   1. `BookingsPage.tsx` — the row's "Paid" pill
//      (`isBookingPaid`, line ~2477).
//   2. `BookingsPage.tsx` — the advanced filter's "Payment state"
//      (`getBookingFolio` → `persistedPayments`, line ~2100).
//   3. `DashboardPage.tsx` — the "pending payments" card
//      (lines 483 / 942 / 2040).
//   4. `BookingsPage.tsx` — the advanced filter's "Reference" search
//      (line ~2165).
//
// The server NEVER writes that denormalized array. Measured against
// production on 2026-10-21: 0 of 67 bookings carried an
// `onsitePayments` field. Every one of those surfaces therefore read
// "₱0 paid" for every booking: no row ever showed the "Paid" pill,
// the "paid" / "partial" payment-state filters matched NOTHING, the
// dashboard's pending-payments card claimed every guest owed the full
// amount, and the reference search could never match.
//
// The money is not missing — it lives in the payment/refund
// subcollections:
//
//   reservations/{reservationId}/payments/{paymentId}   (canonical)
//   reservations/{reservationId}/refunds/{refundId}     (canonical)
//   bookings/{bookingId}/payments/{paymentId}           (legacy)
//   bookings/{bookingId}/refunds/{refundId}             (legacy)
//
// and the server stamps `bookingId` on every canonical payment
// (`guest-app/server/handlers/bookings.ts:10498` — "stamp the
// `reservationId` + `bookingId` on the record so the new
// subcollection is self-describing (per-room attribution possible via
// `bookingId`)"). Measured against production: 20 of 20 payment docs
// and 3 of 3 refund docs carry a `bookingId`.
//
// This module turns those docs back into the per-booking ledger the
// mapper was supposed to read. It is PURE (no Firestore import, no
// React) so it can be unit-tested directly.
//
// WHY THE DRAWER'S SOURCES, AND ONLY THOSE
// ----------------------------------------
// The booking drawer's own live listener (`BookingsPage.tsx:1522`)
// subscribes to EXACTLY four collections: the reservation's
// `payments` + `refunds`, and each folio booking's legacy
// `payments`. If the row pill used a different source, the table and
// the drawer would disagree about the same booking — which is worse
// than either being consistently wrong. So this module mirrors that
// source set exactly.
//
// `storeOrders/{orderId}/payments/{tenderId}` is deliberately
// EXCLUDED. Those are direct store tenders (a guest paying cash for a
// snack). The store's own comment says they live "under the order
// (not the linked booking), so they participate in the collection-group
// reconciliation without reducing the room folio". Counting them
// against the room folio would double-charge the guest: the folio
// already adds a delivered + billed add-to-bill store order to the
// grand total via `computeBookingFolio`'s `storeTotal`.

/**
 * The paths this module reads. A ledger entry is only ever a folio
 * entry when it sits under a reservation's or a booking's `payments` /
 * `refunds` subcollection.
 *
 * Anchored at both ends so a deeper path (e.g. a hypothetical
 * `storeOrders/{id}/payments/{id}/meta`) cannot slip through.
 */
const FOLIO_LEDGER_PATH = /^(reservations|bookings)\/[^/]+\/(payments|refunds)\/[^/]+$/;

/**
 * A single ledger entry, normalized from a Firestore doc. `bookingId`
 * is the attribution key: the booking the entry was recorded against.
 */
export interface PaymentLedgerDoc {
  /** The Firestore doc path — the stable identity of the entry. */
  path: string;
  /** The booking the entry belongs to (`null` when unattributable). */
  bookingId: string | null;
  /** The reservation the entry belongs to, when known. */
  reservationId: string | null;
  /** "refund" for a negative amount or an explicit `type: "refund"`. */
  type: "payment" | "refund";
  /** Signed amount. Refunds are negative (CRL-01 convention). */
  amount: number;
  method: string;
  note: string;
  transactionReference: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  /** ISO string. */
  recordedAt: string;
  /** BR-01 refund category discriminator (`null` on the payment side). */
  category?: "cancellation" | "breakfast" | null;
  /** BR-01 breakfast refund context, when the refund was meal-driven. */
  breakfastRefundContext?: import("@spark-inn/shared").BreakfastRefundContext | null;
}

/**
 * The resolved per-booking ledger entry. Structurally assignable to
 * the admin app's `OnsitePayment` interface (which adds the BR-01
 * `category` / `breakfastRefundContext` fields — carried here too).
 */
export interface LedgerPayment {
  id: string;
  type: "payment" | "refund";
  amount: number;
  method: string;
  note: string;
  /**
   * Optional (not required) so this type stays mutually assignable
   * with the admin app's `OnsitePayment` interface, which declares
   * it optional.
   */
  transactionReference?: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: string;
  category?: "cancellation" | "breakfast" | null;
  breakfastRefundContext?: import("@spark-inn/shared").BreakfastRefundContext | null;
}

/**
 * Is this path a folio ledger path (as opposed to a store-order
 * tender, or anything else)?
 */
export function isFolioLedgerPath(path: string): boolean {
  return FOLIO_LEDGER_PATH.test(path);
}

/**
 * Normalize a Firestore ledger doc into a `PaymentLedgerDoc`.
 *
 * Pure on purpose — the caller passes the doc path and the raw data
 * so this function stays unit-testable without a Firestore emulator.
 * `recordedAt` accepts a Firestore Timestamp (duck-typed via
 * `toDate()`), a `Date`, or an ISO string — the same three shapes the
 * booking mapper already tolerates.
 */
export function normalizeLedgerDoc(
  path: string,
  data: Record<string, unknown>
): PaymentLedgerDoc {
  const rawAmount = Number(data.amount);
  const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
  const rawRecordedAt = data.recordedAt as unknown;
  let recordedAt = "";
  if (rawRecordedAt && typeof (rawRecordedAt as { toDate?: unknown }).toDate === "function") {
    recordedAt = (rawRecordedAt as { toDate: () => Date }).toDate().toISOString();
  } else if (rawRecordedAt instanceof Date) {
    recordedAt = rawRecordedAt.toISOString();
  } else if (typeof rawRecordedAt === "string") {
    recordedAt = rawRecordedAt;
  }

  const bookingIdField =
    typeof data.bookingId === "string" && data.bookingId.trim() ? data.bookingId.trim() : null;
  // A legacy `bookings/{id}/payments/{pid}` doc is attributable from
  // its own path even if the field is missing.
  const pathBookingMatch = /^bookings\/([^/]+)\//.exec(path);
  const bookingId = bookingIdField ?? (pathBookingMatch ? pathBookingMatch[1] : null);

  const reservationIdField =
    typeof data.reservationId === "string" && data.reservationId.trim()
      ? data.reservationId.trim()
      : null;
  const pathReservationMatch = /^reservations\/([^/]+)\//.exec(path);
  const reservationId = reservationIdField ?? (pathReservationMatch ? pathReservationMatch[1] : null);

  const type =
    data.type === "refund" || amount < 0 ? ("refund" as const) : ("payment" as const);

  return {
    path,
    bookingId,
    reservationId,
    type,
    amount,
    method: typeof data.method === "string" ? data.method : "",
    note: typeof data.note === "string" ? data.note : "",
    transactionReference:
      typeof data.transactionReference === "string" && data.transactionReference
        ? data.transactionReference
        : null,
    reason: typeof data.reason === "string" && data.reason ? data.reason : null,
    approvedBy: typeof data.approvedBy === "string" && data.approvedBy ? data.approvedBy : null,
    recordedBy: typeof data.recordedBy === "string" && data.recordedBy ? data.recordedBy : "staff",
    recordedAt,
    category:
      data.category === "breakfast" || data.category === "cancellation" ? data.category : null,
    breakfastRefundContext:
      (data.breakfastRefundContext as PaymentLedgerDoc["breakfastRefundContext"]) ?? null
  };
}

/**
 * Build the per-booking ledger index from a flat list of ledger docs.
 *
 * Only folio paths are included (store-order tenders are excluded).
 * Entries are grouped by `bookingId` and sorted oldest-first by
 * `recordedAt`, matching the drawer's live listener ordering.
 *
 * A doc with no attributable `bookingId` is dropped from this index:
 * it is a reservation-scope entry with no room attribution, and
 * guessing a room would either double-count it across the
 * reservation's children or hide it from all of them. The
 * reservation-scope aggregate (`reservationPaidAmount`, which already
 * existed for the grouped reservation row) is the surface that
 * reports it.
 */
export function buildBookingPaymentIndex(
  docs: PaymentLedgerDoc[]
): Record<string, LedgerPayment[]> {
  const byBooking: Record<string, LedgerPayment[]> = {};
  for (const doc of docs) {
    if (!isFolioLedgerPath(doc.path)) continue;
    if (!doc.bookingId) continue;
    const entry: LedgerPayment = {
      id: doc.path,
      type: doc.type,
      amount: doc.amount,
      method: doc.method,
      note: doc.note,
      transactionReference: doc.transactionReference,
      reason: doc.reason,
      approvedBy: doc.approvedBy,
      recordedBy: doc.recordedBy,
      recordedAt: doc.recordedAt,
      category: doc.category ?? null,
      breakfastRefundContext: doc.breakfastRefundContext ?? null
    };
    (byBooking[doc.bookingId] = byBooking[doc.bookingId] || []).push(entry);
  }
  for (const bookingId of Object.keys(byBooking)) {
    byBooking[bookingId].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
  return byBooking;
}

/**
 * Resolve a booking's effective payment ledger.
 *
 * The canonical index WINS whenever it has entries for the booking;
 * the booking doc's own denormalized `onsitePayments[]` array is the
 * fallback for a booking whose payments are not in any subcollection
 * the index reads (a hand-written or pre-MRB-01 doc).
 *
 * The rule is deliberately "index wins, wholesale" rather than a
 * union: a union would double-count any entry that exists in BOTH
 * places (the denormalized array is a projection of the subcollection
 * entries), and it would not be idempotent — re-running the resolver
 * on its own output would keep growing the array.
 */
export function resolveBookingOnsitePayments(
  bookingId: string,
  legacyPayments: LedgerPayment[],
  index: Record<string, LedgerPayment[]>
): LedgerPayment[] {
  const indexed = index[bookingId];
  if (indexed && indexed.length > 0) return indexed;
  return legacyPayments ?? [];
}

/**
 * Do two ledgers describe the same set of entries? Used to decide
 * whether a re-hydration pass actually changed anything (so the
 * caller can skip a state write and avoid a render loop).
 */
export function sameLedgerPayments(
  a: LedgerPayment[] | undefined | null,
  b: LedgerPayment[] | undefined | null
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].id !== right[i].id) return false;
    if (left[i].amount !== right[i].amount) return false;
    if (left[i].recordedAt !== right[i].recordedAt) return false;
    if (left[i].type !== right[i].type) return false;
  }
  return true;
}
