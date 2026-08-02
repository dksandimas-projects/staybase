// Per PMH-02 (2026-07-31): single source of truth for booking folio
// math. The historical shape had three independent implementations:
//   - `getBookingFolio` was a local closure inside `BookingsPage.tsx`
//     (not exported; 8 call sites, all in that one file).
//   - The server's `handleCreateBooking` / `handleConfirmWithBalance`
//     transactions computed `folioTotal` and `computedBalance`
//     inline (different shape — just the totals, not the full
//     folio object).
//   - `summarizeFolioSnapshot` in `admin-app/src/utils/finance.ts`
//     aggregated the same math across many bookings.
//
// The client and server currently agreed by discipline, not by
// construction. MRB-04 (the group folio) would have meant changing
// money math in three independent places and hoping they stayed in
// step. This file is the single source of truth — pure refactor,
// zero behavior change, pinned by `shared/__tests__/booking-folio.test.ts`.

/**
 * The minimal shape the folio math needs from a `Booking`. The
 * shared `Booking` type satisfies this; admin-app's `Booking` (which
 * adds `updatedAt`, `earlyCheckIn`, etc.) is structurally compatible
 * via duck typing — the function only reads `id` and `totalPrice`.
 * Defining the input as a minimal type keeps the shared utility
 * independent of the admin-app Booking extension.
 */
export interface FolioBooking {
  id: string;
  totalPrice: number;
}

/**
 * A single store order as relevant to folio computation. The shape
 * is intentionally narrow (just the fields the function reads) so
 * server-side and client-side code can both pass a filtered slice
 * without dragging in the full StoreOrder type. `orderRef` and
 * `label` are optional display fields the admin receipt uses; the
 * shared function ignores them.
 */
export interface FolioStoreOrder {
  bookingId?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  isBilled?: boolean | null;
  totalAmount?: number | null;
  /** Optional display field — admin receipt uses `Store order ${orderRef}`. */
  orderRef?: string | null;
}

/**
 * A single incidental charge as relevant to folio computation. The
 * `label` is an optional display field the admin receipt uses; the
 * shared function ignores it.
 */
export interface FolioCharge {
  amount?: number | null;
  /** Optional display field — admin receipt uses this for the row label. */
  label?: string | null;
}

/**
 * The selected booking's "live" payments — used by the booking
 * drawer to show optimistic updates before the server snapshot
 * arrives. Pass `undefined` to fall back to `persistedPayments`.
 * The structural type keeps the shared utility independent of the
 * admin-app `OnsitePayment` interface (which carries more fields
 * than the folio math needs).
 */
export interface FolioLivePayment {
  amount: number;
}
export type FolioLivePayments = FolioLivePayment[];

/**
 * The booking's persisted payments. The shared `Booking` type does
 * not declare `onsitePayments` (it lives in `admin-app`'s
 * `AdminContext.Booking` extension), so the folio input takes the
 * array separately. Caller decides which slice to pass.
 */
export interface FolioPersistedPayment {
  amount: number;
}
export type FolioPersistedPayments = FolioPersistedPayment[];

export interface BookingFolioInput {
  booking: FolioBooking;
  /**
   * Live in-memory payments for the selected booking (the booking
   * drawer keeps a local copy that updates as the staff records a
   * payment, before the Firestore snapshot lands). When provided,
   * this REPLACES `persistedPayments` in the computation (the
   * optimistic-update path). When `undefined`, the function falls
   * back to `persistedPayments` (the booking doc's snapshot).
   */
  selectedBookingPayments?: FolioLivePayments;
  /**
   * The booking's persisted payments (read from `booking.onsitePayments`
   * by the client, or supplied by the server from the snapshot). The
   * shared `Booking` type does not declare this field, so the caller
   * must read it off the booking and pass it explicitly.
   */
  persistedPayments?: FolioPersistedPayments;
  /**
   * Live in-memory charges for the selected booking (the booking
   * drawer keeps a local copy that updates as the staff adds a
   * charge). `undefined` for the offline / non-selected case.
   */
  selectedBookingCharges?: FolioCharge[];
  /**
   * All store orders; the function filters to those that match
   * this booking and qualify for the folio (paymentMethod ===
   * "add-to-bill" + status === "delivered" + isBilled === true).
   * Caller decides which subset to pass.
   */
  storeOrders: FolioStoreOrder[];
}

export interface BookingFolio {
  storeCharges: FolioStoreOrder[];
  storeTotal: number;
  charges: FolioCharge[];
  chargesTotal: number;
  paymentsTotal: number;
  grandTotal: number;
  balance: number;
}

/**
 * Compute the folio for a single booking. Pure function — no React
 * state, no side effects, no async. The two optional "live"
 * parameters (selectedBookingPayments / selectedBookingCharges) let
 * the booking drawer show optimistic updates: when the staff
 * records a payment or adds a charge, the drawer's local state
 * changes immediately, and the drawer's `useMemo` re-derives the
 * folio from the new state. The function preserves the historical
 * behavior: pass the live state only when the booking is the
 * currently selected one (the same condition the old closure used).
 */
export function computeBookingFolio(input: BookingFolioInput): BookingFolio {
  const { booking, storeOrders } = input;

  // Store charges for THIS booking that qualify for the folio.
  // Historical filter: `add-to-bill` + `delivered` + `isBilled`.
  // Matches the `getBookingStoreCharges` local closure.
  const storeCharges = storeOrders.filter(
    (o) =>
      o.bookingId === booking.id &&
      o.paymentMethod === "add-to-bill" &&
      o.status === "delivered" &&
      o.isBilled === true
  );
  const storeTotal = storeCharges.reduce(
    (sum, o) => sum + (Number(o.totalAmount) || 0),
    0
  );

  // Live charges — only when this booking is the currently selected
  // one (the drawer's local optimistic state). Otherwise the folio
  // uses zero live charges; the server has the authoritative copy.
  const charges = input.selectedBookingCharges ?? [];
  const chargesTotal = charges.reduce(
    (sum, c) => sum + (Number(c.amount) || 0),
    0
  );

  // Payments — prefer the live (selected) copy when present, else
  // fall back to the persisted payments the caller supplies from
  // `booking.onsitePayments`. The shared `Booking` type does not
  // declare `onsitePayments` (it lives in `admin-app`), so the
  // caller passes the slice explicitly.
  const payments = input.selectedBookingPayments
    ? input.selectedBookingPayments
    : (input.persistedPayments || []);
  const paymentsTotal = payments.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );

  const totalPrice = Number(booking.totalPrice) || 0;
  const grandTotal = totalPrice + storeTotal + chargesTotal;
  const balance = grandTotal - paymentsTotal;

  return {
    storeCharges,
    storeTotal,
    charges,
    chargesTotal,
    paymentsTotal,
    grandTotal,
    balance
  };
}

/**
 * Server-side shorthand — same math as the inline
 * `folioTotal = data.totalPrice + incidentalTotal + addToBillTotal; computedBalance = max(folioTotal - collectedTotal, 0)`
 * that lived in the server's booking handlers. Exposed as a
 * separate function so the server can call it with a minimal input
 * shape (no per-booking booking doc) and not pull in the full
 * FolioStoreOrder[] / FolioCharge[] types.
 */
export interface ServerFolioTotals {
  totalPrice: number;
  incidentalTotal: number;
  addToBillTotal: number;
  collectedTotal: number;
}

export interface ServerFolioTotalsResult {
  folioTotal: number;
  computedBalance: number;
}

export function computeServerFolioTotals(
  input: ServerFolioTotals
): ServerFolioTotalsResult {
  const totalPrice = Number(input.totalPrice) || 0;
  const incidentalTotal = Number(input.incidentalTotal) || 0;
  const addToBillTotal = Number(input.addToBillTotal) || 0;
  const collectedTotal = Number(input.collectedTotal) || 0;
  const folioTotal = totalPrice + incidentalTotal + addToBillTotal;
  const computedBalance = Math.max(folioTotal - collectedTotal, 0);
  return { folioTotal, computedBalance };
}

// Per MRB-04 (2026-08-02, per decision #159): the
// behavior-frozen reservation folio summary. The
// reservation header is the single source of truth
// for the reservation's money state; this helper is
// the canonical resolver that reads from the new
// subcollections for reservations with a
// `reservationId` (post-MRB-01), and falls back to the
// legacy `bookings/{id}/payments` + `bookings/{id}/charges`
// for null-`reservationId` bookings (pre-MRB-01, i.e.
// created before 2026-08-02). The `source` flag on
// the returned summary records which subcollection
// the data came from, so the caller can branch on
// legacy vs new (the admin UI uses this to render a
// "legacy booking" badge; the receipt path renders
// the same shape regardless of source).
//
// Per MRB-04 Phase 2.x (2026-08-02, per decision #159):
// refunds are now read from BOTH `reservations/{id}/payments`
// (for any negative-amount entries — belt-and-suspenders,
// catches edge cases like a CRL-01 backfill or an admin
// pre-recording) AND `reservations/{id}/refunds` (the
// canonical refund source written by `handleAddRefund`).
// The helper sums both arrays into `paymentsTotal`; the
// writer only writes to `refunds/`, so the two arrays are
// disjoint in normal operation. Legacy null-`reservationId`
// bookings keep the historical behavior — refunds are
// negative-amount entries on `bookings/{id}/payments`, and
// the legacy adapter passes `refunds: []` (the caller's
// `payments` array carries the refund entries).
//
// The balance invariant is the canonical money rule:
// `reservation balance == reservationTotal +
// chargesTotal − paymentsTotal`. The helper enforces
// this with a single-pass sign-aware sum so the
// invariant is preserved at the math level (no
// separate derivation that could drift).

/**
 * Minimal shape for a payment entry on the reservation folio.
 * Sign-aware: positive for a payment collected, negative for a
 * refund. The shared `ReservationPayment` type satisfies this;
 * the existing `OnsitePayment` + `PaymentEntry` shapes are
 * structurally compatible via duck typing (both carry `amount`).
 */
export interface FolioReservationPayment {
  amount: number;
}

/**
 * Minimal shape for a charge entry on the reservation folio.
 * The shared `ReservationCharge` type satisfies this; the
 * existing `IncidentalCharge` shape is structurally compatible
 * (both carry `amount`).
 */
export interface FolioReservationCharge {
  amount: number;
}

export interface ReservationFolioSummaryInput {
  reservationId: string;
  /** The reservation's total — the sum of per-room `totalPrice`. Set at create time; recomputed transactionally in MRB-04's payment write paths. */
  reservationTotal: number;
  /**
   * The reservation's payment entries. For new reservations
   * (post-MRB-01), from `reservations/{id}/payments` (which
   * carries positive-amount payment entries per the Phase 2
   * `handleAddPayment` refactor). For legacy null-`reservationId`
   * bookings, from `bookings/{id}/payments` (which carries both
   * positive-amount payments AND negative-amount refunds per the
   * historical CRL-01 convention).
   *
   * Per MRB-04 Phase 2.x: the helper ALSO reads `reservations/{id}/refunds`
   * via the `refunds` field below. The two arrays are summed into
   * `paymentsTotal`; in normal operation the writer only writes to
   * `refunds/`, so the arrays are disjoint. The "belt-and-suspenders"
   * is a defensive read of the `payments` array for any negative-amount
   * entries (catches edge cases like legacy CRL-01 backfills or admin
   * pre-recordings). Callers fetching from new subcollections pass BOTH
   * arrays; the legacy adapter passes `refunds: []` and supplies the
   * negative-amount entries via `payments`.
   */
  payments: FolioReservationPayment[];
  /**
   * The reservation's refund entries (canonical source — from
   * `reservations/{id}/refunds` for new reservations per MRB-04
   * Phase 2.x). The legacy null-`reservationId` adapter passes
   * `refunds: []` (the negative-amount refund entries live on
   * `bookings/{id}/payments` per the historical CRL-01 convention).
   * Default `[]` keeps the Phase 1 callers backward-compatible.
   */
  refunds?: FolioReservationPayment[];
  /** The reservation's charge entries (from `reservations/{id}/charges` for new reservations, or `bookings/{id}/charges` for legacy null-`reservationId` bookings). */
  charges: FolioReservationCharge[];
  /**
   * Whether the data came from the new reservation subcollections
   * or the legacy `bookings/{id}/payments` +
   * `bookings/{id}/charges`. The caller decides (the booking has
   * a `reservationId` for the new subcollections; null for the
   * legacy adapter). The flag is echoed on the returned summary.
   */
  source: "reservation-subcollection" | "booking-subcollection-legacy";
}

/**
 * Compute the behavior-frozen reservation folio summary. Pure
 * function — no Firestore calls, no React state, no async. The
 * caller supplies the pre-fetched payments + refunds + charges;
 * the helper sums them and computes the balance.
 *
 * The balance invariant is `reservation balance == reservationTotal
 * + chargesTotal − paymentsTotal`. A single-pass sign-aware sum
 * preserves the invariant at the math level — no separate
 * derivation that could drift. For refunds, `paymentsTotal` is
 * negative (the `refunds` array entries are always negative per
 * the CRL-01 convention; the `payments` array may also carry
 * negative entries as a belt-and-suspenders fallback). For voids,
 * `chargesTotal` is zero (the void entry has a negative amount
 * that exactly cancels the original; the helper filters out the
 * void entry's contribution by treating the sum at the entry
 * level — the caller is responsible for supplying only the active
 * entries, not the void pair). For a single-pass implementation,
 * the caller should pre-filter the void pairs (the
 * `bookings/{id}/charges` query reads all entries; the legacy
 * adapter filters voids in `computeBookingFolio` above; the new
 * reservation adapter should do the same).
 */
export function getReservationFolioSummary(
  input: ReservationFolioSummaryInput
): {
  reservationId: string;
  reservationTotal: number;
  chargesTotal: number;
  paymentsTotal: number;
  balance: number;
  source: "reservation-subcollection" | "booking-subcollection-legacy";
} {
  const reservationTotal = Number(input.reservationTotal) || 0;
  // Sign-aware sums — `payments` + `refunds` are summed into
  // `paymentsTotal`. Refunds are negative entries on either
  // subcollection (per CRL-01's negative-amount convention);
  // positive payments are positive entries on `payments/`. A
  // single pass over the union preserves the balance invariant
  // at the math level. In normal operation the writer only
  // writes to `refunds/`, so the two arrays are disjoint — the
  // double-count risk only materializes if a refund lives in
  // BOTH subcollections (a writer bug, not a normal state).
  // `charges` includes adjustments (positive or negative per
  // the existing per-creator + bounds + void semantics); the
  // caller is expected to pre-filter the void pairs (see the
  // doc block above) so the sum is over the ACTIVE entries
  // only.
  const refunds = input.refunds ?? [];
  const paymentsTotal =
    input.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) +
    refunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const chargesTotal = input.charges.reduce(
    (sum, c) => sum + (Number(c.amount) || 0),
    0
  );
  // The canonical balance invariant: outstanding =
  // reservationTotal + chargesTotal − paymentsTotal. A
  // positive balance means the guest owes money; a negative
  // balance means the guest is overpaid (refund pending).
  const balance = reservationTotal + chargesTotal - paymentsTotal;
  return {
    reservationId: input.reservationId,
    reservationTotal,
    chargesTotal,
    paymentsTotal,
    balance,
    source: input.source
  };
}
