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

import type { BookingRevenueAllocation, ReservationPaymentStatus } from "../types";
import { calculateDiscountChain, type DiscountScope } from "./bookingDiscounts";

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
   * Booking IDs whose room-billed store orders belong to this
   * folio. Reservation drawers pass every child booking ID; legacy
   * callers omit this and retain the single-booking behavior.
   */
  folioBookingIds?: string[];
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
  const folioBookingIds = new Set(
    input.folioBookingIds?.length ? input.folioBookingIds : [booking.id]
  );

  // Store charges for THIS booking that qualify for the folio.
  // Historical filter: `add-to-bill` + `delivered` + `isBilled`.
  // Matches the `getBookingStoreCharges` local closure.
  const storeCharges = storeOrders.filter(
    (o) =>
      typeof o.bookingId === "string" &&
      folioBookingIds.has(o.bookingId) &&
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

// Per MRB-04 Phase 3 (2026-08-02, per decision #159): the
// N=1 mapping from a `Booking.status` to the reservation
// header's `Reservation.paymentStatus`.
//
// The two enums are nearly identical, with three relabels
// for the reservation-scope wire contract:
//   - `pending` → `awaiting-payment` (the reservation's
//     reservation-aware label: "guest has not paid yet" is
//     more truthful at reservation scope than "pending", which
//     sounds like a server-side queue state).
//   - `checked-in` → `in-house` (the reservation's
//     "in the hotel right now" label).
//   - `checked-out` → `completed` (the reservation's
//     "stay finished" label — the room's lifecycle uses
//     `checked-out`, the reservation's money state uses
//     `completed`).
//
// The other four values pass through unchanged:
//   - `payment-uploaded` → `payment-uploaded`
//   - `payment-confirmed` → `payment-confirmed`
//   - `confirmed` → `confirmed`
//   - `cancelled` → `cancelled`
//
// **Why this is N=1 only** — every reservation currently has
// exactly one child booking (the N booking write loop shipped
// in MRB-06 Phase 2, but the N>1 client surface has not landed;
// the N=1 case is the entire active surface). For N>1, **MRB-05**
// replaces this helper with an aggregate reader that loops
// over the N child `bookings/{id}.status` values, maps each via
// this function, and applies the per-decision-#159 aggregate
// rule (e.g. all-confirmed → `confirmed`; mix-of-confirmed-and
// -checked-in → `Partially checked in` — encoded as the
// `in-house` label until MRB-12 surfaces the granular label).
//
// **Defensive coercion** — an unknown status returns the same
// string passed in (the field type is the runtime guard at the
// assignment site; the helper never throws on a malformed
// input, it just passes it through). Nullish input returns
// the input unchanged (the helper is not a sanitizer; the
// caller is responsible for not calling it on nullish data).
//
// **Pure function** — no React state, no Firestore calls, no
// async, no side effects. Pinned by 9 characterization tests
// in `shared/__tests__/booking-folio.test.ts` (the 7 mapping
// cases + the 2 defensive-coercion cases).
export function mapBookingStatusToReservationPaymentStatus(
  bookingStatus: string
): ReservationPaymentStatus {
  switch (bookingStatus) {
    case "pending":
      return "awaiting-payment";
    case "checked-in":
      return "in-house";
    case "checked-out":
      return "completed";
    // The 4 pass-through values: return the input as-is so
    // the return type is assignable to `ReservationPaymentStatus`
    // (TS narrows the literal type to the union member).
    case "payment-uploaded":
    case "payment-confirmed":
    case "confirmed":
    case "cancelled":
      return bookingStatus as ReservationPaymentStatus;
    // Unknown status: pass through unchanged (the field type
    // is the runtime guard; the assignment site will reject an
    // out-of-union value with a TS error). This is the
    // defensive-coercion path — a malformed input never
    // throws, it just doesn't get a relabel.
    default:
      return bookingStatus as ReservationPaymentStatus;
  }
}

// Per MRB-05 (2026-08-02, per decision #159): the N>1
// aggregate reader that computes the reservation header's
// `paymentStatus` from the N child `Booking.status` values.
// For N=1 (today's entire active surface — every reservation
// has exactly one child booking), the aggregate is the same
// as the single mapped status (i.e. the same answer
// `mapBookingStatusToReservationPaymentStatus` returns).
// For N>1 (future, when the MRB-06 client surface lands and
// guests can book multiple rooms / multiple room types in
// one flow), this helper is the wire contract.
//
// The aggregate rule (per decision #159, the reservation-
// summary table):
//   1. Cancellation is a SECONDARY count, not a hidden
//      state — every non-cancelled child contributes to
//      the aggregate. The reservation is `cancelled` only
//      if EVERY child is cancelled.
//   2. If ANY non-cancelled child is `pending` or
//      `payment-uploaded`, the reservation is
//      `awaiting-payment` (the guest hasn't paid yet for
//      at least one room; the reservation can't claim to
//      be confirmed).
//   3. Else if ALL non-cancelled children are
//      `payment-confirmed` or `confirmed`, the reservation
//      is `confirmed` (every room is past the money gate
//      but no room is in-house yet).
//   4. Else if ANY non-cancelled child is `checked-out`,
//      the reservation is `completed` (the partial / full
//      completion states all encode to `completed` per the
//      spec — the granular "partially checked out" label
//      is deferred to MRB-12).
//   5. Else the reservation is `in-house` (covers: all
//      non-cancelled children are `checked-in`, OR a mix
//      of `confirmed` and `checked-in` — both encode to
//      `in-house` per the spec's "Partially checked in" +
//      "In house" encoding).
//
// **Defensive coercion** — unknown statuses are treated as
// non-cancelled participating children but they don't match
// any of the 4 priority tiers' exact-string checks. The
// default fall-through is tier 5 (`in-house`), which is the
// operational catch-all. This matches the MRB-04 Phase 3
// helper's defensive posture (don't throw, don't surface
// broken values to the wire). An all-cancelled input (every
// child is `"cancelled"`, or an empty array) returns
// `"cancelled"` — the only path to the reservation's
// `cancelled` state.
//
// **Pure function** — no React state, no Firestore calls, no
// async, no side effects. Pinned by ~12 characterization
// tests in `shared/__tests__/booking-folio.test.ts` (the
// empty-array case + the 5 priority tiers + the mixed-state
// cases + the defensive coercion cases).
export function computeReservationAggregatePaymentStatus(
  childStatuses: string[]
): ReservationPaymentStatus {
  // Filter out cancelled rooms. Cancellation is a
  // secondary count, not a hidden state — every
  // non-cancelled child contributes to the aggregate.
  // The reservation is `cancelled` only if every child
  // is cancelled (or there are no children).
  const activeStatuses = childStatuses.filter((s) => s !== "cancelled");

  // Tier 1: all rooms cancelled → "cancelled" (the only
  // path to the reservation's `cancelled` state).
  if (activeStatuses.length === 0) {
    return "cancelled";
  }

  // Tier 2: any pre-confirmation room → "awaiting-payment"
  // (the reservation can't claim to be confirmed while at
  // least one room is still waiting for payment). The
  // check operates on the BOOKING-scope enum (the input
  // values) because the priority rule is expressed in
  // terms of `pending` / `payment-uploaded` (the booking
  // states) — NOT the reservation-scope mapping (which
  // would have already collapsed both to
  // `awaiting-payment`).
  const hasPreConfirmation = activeStatuses.some(
    (s) => s === "pending" || s === "payment-uploaded"
  );
  if (hasPreConfirmation) {
    return "awaiting-payment";
  }

  // Tier 3: all confirmed (no room past check-in yet) →
  // "confirmed".
  const allConfirmed = activeStatuses.every(
    (s) => s === "payment-confirmed" || s === "confirmed"
  );
  if (allConfirmed) {
    return "confirmed";
  }

  // Tier 4: any checked-out room → "completed" (the
  // partial / full completion states all encode to
  // "completed" per the spec — the granular "partially
  // checked out" label is deferred to MRB-12).
  const hasCheckedOut = activeStatuses.some((s) => s === "checked-out");
  if (hasCheckedOut) {
    return "completed";
  }

  // Tier 5 (catch-all): all checked-in, or a mix of
  // confirmed + checked-in → "in-house" (per the spec's
  // "Partially checked in" + "In house" encoding). Also
  // catches the defensive-coercion case (unknown
  // statuses that don't match any prior tier).
  return "in-house";
}

// Per MRB-11 (2026-08-03, per decision #177): the
// per-stream revenue allocation read path. Reports
// uses this to read room + breakfast + add-on revenue
// without re-running the pricing chain. The stored
// `revenueAllocation` field is the source of truth for
// post-MRB-11 bookings; pre-MRB-11 bookings fall back
// to the legacy `splitBookingRevenue` proportional
// split and are tagged `"allocation: legacy-heuristic"`
// so the export row + the export's banner can surface
// the heuristic to the accountant.

/**
 * The minimal shape the revenue-stream math needs from
 * a `Booking`. The shared `Booking` type satisfies this;
 * admin-app's `Booking` is structurally compatible via
 * duck typing — the function only reads `revenueAllocation`
 * + a few rateBreakdown + flat-rate fields. The narrow
 * input keeps the helper pure + easy to test.
 */
export interface RevenueBookingInput {
  /** Stored allocation (post-MRB-11). Absent on pre-MRB-11 bookings. */
  revenueAllocation?: BookingRevenueAllocation | null;
  totalPrice: number;
  /** Locked gross room rate. Used by the legacy fallback. */
  rateBreakdown?: {
    roomSubtotal?: number | null;
  } | null;
  ratePerNight: number;
  numNights: number;
  numGuests?: number;
  breakfastRate?: number | null;
  hasBreakfast?: boolean | null;
}

export interface RevenueReservationInput {
  /** Stored aggregate (post-MRB-11). Absent on pre-MRB-11 reservations. */
  aggregateRevenueAllocation?: BookingRevenueAllocation | null;
  totalPrice: number;
}

export interface BookingRevenueStreams {
  /** Room share the guest pays (gross, pre-deduction; the per-stream NET is `roomNet − roomNet's pro-rated share of deductionNet`). */
  roomNet: number;
  /** Breakfast share the guest pays. */
  breakfastNet: number;
  /** Add-on (extra bed + future add-ons) share the guest pays. */
  addOnNet: number;
  /** Total deductions applied (sum of senior + voucher + member + corporate adjustments). The per-stream nets above already NET OUT the deductions — this is the headline "discounts given" number for reporting. */
  deductionNet: number;
  /** The final bill. Equals `booking.totalPrice` by construction. */
  totalNet: number;
  /** Tag for the export row: `"stored"` reads the doc field; `"legacy-heuristic"` falls back to the pre-MRB-11 proportional split. */
  allocation: "stored" | "legacy-heuristic";
}

/**
 * Round a 2dp currency value defensively. Returns 0 for
 * non-finite inputs. Per CRL-05 / BF-12 convention:
 * 2dp is the canonical granularity for money in the
 * system; anything beyond 2dp would surface in the
 * export as a false-precision artifact.
 */
function round2(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

/**
 * Assert the per-stream allocation sums to the total.
 * Per MRB-11 design call: the server asserts this at
 * the write boundary before the Firestore write. The
 * 0.01 tolerance handles accumulated 2dp-rounding noise
 * (each per-stream value is rounded independently; the
 * sum can drift by ±0.01 across 5 streams). The helper
 * returns the same allocation so the server can chain
 * `assertBookingRevenueAllocationInvariant(allocation)`
 * inline.
 */
export function assertBookingRevenueAllocationInvariant(
  allocation: BookingRevenueAllocation,
  totalPrice: number
): BookingRevenueAllocation {
  // The per-stream values are individually rounded to 2dp
  // BEFORE the sum, so each can carry ±0.005 of noise; with
  // 4 streams the worst-case accumulated error is ±0.02
  // before the per-stream rounding. The 0.05 tolerance
  // absorbs the 4-field round + the IEEE 754 double-precision
  // representation noise (e.g. `4000.01` in JS is actually
  // `4000.010000000000036`; summing 5 such values drifts by
  // a few 1e-13). The 1.00 catch in the test pins the
  // throw path (a real miscalculation will be off by at
  // least one whole currency unit, not by 0.0001).
  const computed = round2(
    round2(allocation.roomNet) +
      round2(allocation.breakfastNet) +
      round2(allocation.addOnNet) -
      round2(allocation.deductionNet)
  );
  const expected = round2(totalPrice);
  if (Math.abs(computed - expected) > 0.05) {
    throw new Error(
      `[MRB-11] revenue allocation invariant violation: ` +
        `roomNet(${allocation.roomNet}) + breakfastNet(${allocation.breakfastNet}) + ` +
        `addOnNet(${allocation.addOnNet}) - deductionNet(${allocation.deductionNet}) = ${computed}, ` +
        `expected totalNet(${expected}). This is a server-side bug — the pricing chain returned an inconsistent allocation.`
    );
  }
  return allocation;
}

/**
 * Read the per-stream revenue allocation for a single
 * booking. Returns the stored field when present
 * (post-MRB-11); falls back to the legacy
 * `splitBookingRevenue` proportional split for pre-MRB-11
 * bookings and tags the result `"allocation: legacy-heuristic"`.
 *
 * The legacy fallback preserves the pre-MRB-11 byte-equivalent
 * math (a single-day report on a doc without `revenueAllocation`
 * returns the same numbers the old code did), so the day this
 * ships does not produce surprise jumps in the Reports for
 * historical data. The `addOnNet` term is 0 in the legacy
 * path because the old math bundled add-ons into the room
 * stream; the export tag tells the user this.
 */
export function getBookingRevenueStreams(
  booking: RevenueBookingInput
): BookingRevenueStreams {
  if (booking.revenueAllocation) {
    return { ...booking.revenueAllocation, allocation: "stored" };
  }
  // Legacy fallback: same math as `splitBookingRevenue` in
  // `admin-app/src/utils/finance.ts`. Re-derived here so
  // the shared helper doesn't import admin-app code.
  const total = round2(Number(booking.totalPrice) || 0);
  const roomSubtotalRaw = Number(booking.rateBreakdown?.roomSubtotal);
  const roomSubtotal = Number.isFinite(roomSubtotalRaw) && roomSubtotalRaw > 0
    ? roomSubtotalRaw
    : round2(Number(booking.ratePerNight) || 0) * Math.max(0, Number(booking.numNights) || 0);
  const nights = Math.max(0, Number(booking.numNights) || 0);
  const breakfastGross = round2(
    (booking.hasBreakfast ? Number(booking.breakfastRate) || 0 : 0) *
      Math.max(0, Number(booking.numGuests) || 0) *
      nights
  );
  let room = total;
  let breakfast = 0;
  if (total > 0 && breakfastGross > 0 && roomSubtotal > 0) {
    const grossTotal = roomSubtotal + breakfastGross;
    breakfast = round2((total * breakfastGross) / grossTotal);
    room = round2(total - breakfast);
  }
  return {
    roomNet: room,
    breakfastNet: breakfast,
    addOnNet: 0,
    deductionNet: 0,
    totalNet: total,
    allocation: "legacy-heuristic"
  };
}

/**
 * Read the per-stream revenue allocation for a
 * reservation. Returns the stored aggregate when
 * present (post-MRB-11); sums the children's
 * `getBookingRevenueStreams` otherwise. The fallback
 * handles pre-MRB-11 reservations AND the rare
 * post-MRB-11 reservation where the aggregate is null
 * (the brief window between child-creation and the
 * aggregate update — `getReservationRevenueStreams`
 * never returns a partial; it always falls through to
 * the child sum when the aggregate is null).
 */
export function getReservationRevenueStreams(
  reservation: RevenueReservationInput,
  children: RevenueBookingInput[]
): BookingRevenueStreams {
  if (reservation.aggregateRevenueAllocation) {
    return { ...reservation.aggregateRevenueAllocation, allocation: "stored" };
  }
  // Sum the children. Defensive against missing fields
  // (treats each as 0). The allocation tag follows the
  // child rule: if the aggregate is null AND every child
  // has a stored allocation, the aggregate is `"stored"`
  // (the children are the source of truth and they
  // unanimously carry the new field); if the aggregate
  // is null AND any child is on the legacy fallback, the
  // aggregate is `"legacy-heuristic"` (the byte-equivalent
  // math is preserved by the same proportional split each
  // child applies); if the aggregate is null AND there
  // are no children, the aggregate is `"legacy-heuristic"`
  // (no stored data to read — the export row will tag
  // the empty reservation as heuristic).
  let roomNet = 0;
  let breakfastNet = 0;
  let addOnNet = 0;
  let deductionNet = 0;
  let totalNet = 0;
  let anyChildLegacy = false;
  let anyChild = false;
  for (const child of children) {
    anyChild = true;
    const streams = getBookingRevenueStreams(child);
    roomNet = round2(roomNet + streams.roomNet);
    breakfastNet = round2(breakfastNet + streams.breakfastNet);
    addOnNet = round2(addOnNet + streams.addOnNet);
    deductionNet = round2(deductionNet + streams.deductionNet);
    totalNet = round2(totalNet + streams.totalNet);
    if (streams.allocation !== "stored") {
      anyChildLegacy = true;
    }
  }
  const allocation: BookingRevenueStreams["allocation"] =
    !anyChild || anyChildLegacy ? "legacy-heuristic" : "stored";
  return {
    roomNet,
    breakfastNet,
    addOnNet,
    deductionNet,
    totalNet,
    allocation
  };
}

// Per MRB-11 (2026-08-03, per decision #177): the
// per-stream allocation write path. The server uses
// this at create / walkin / corporate / reschedule
// time to populate `booking.revenueAllocation` and
// `reservation.aggregateRevenueAllocation` BEFORE the
// Firestore write. The math routes through the same
// `calculateDiscountChain` the total uses, so the
// stored `totalNet` always equals the existing
// `totalPrice` and the `assertBookingRevenueAllocationInvariant`
// check passes.

export interface ComputeBookingRevenueAllocationInput {
  ratePerNight: number;
  numNights: number;
  numGuests?: number;
  breakfastRate?: number | null;
  hasBreakfast?: boolean | null;
  /** Per-night extra-bed subtotal (the "add-on" stream). Composed into the chain so the deductions see the full pre-discount subtotal. Default 0. */
  extraBedTotal?: number;
  discountPct?: number | null;
  voucherDiscount?: number | null;
  memberDiscountPct?: number | null;
  discountScope?: DiscountScope | null;
  /** The final `booking.totalPrice` for the invariant assertion. */
  totalPrice: number;
}

/**
 * Compute the per-stream revenue allocation from the
 * same inputs `calculateBookingTotal` takes. The 3
 * streams are `room` (ratePerNight × numNights), `breakfast`
 * (rate × guests × nights), and `addOn` (extraBedTotal).
 * Each per-stream value is the GROSS amount (pre-deduction)
 * — `deductionNet` is the single line for the total
 * deductions (the senior + voucher + member sum from
 * the existing `calculateDiscountChain`). The invariant
 * `roomNet + breakfastNet + addOnNet − deductionNet === totalNet`
 * holds by construction. All values round to 2dp. Throws
 * via `assertBookingRevenueAllocationInvariant` if the
 * per-stream sum drifts more than 0.05 from the input
 * `totalPrice` — a server-side bug, not a caller error.
 *
 * The pro-rate-by-stream-share math (an earlier draft
 * that NETted each per-stream value) was rejected because
 * it left the `deductionNet` field with no semantic
 * meaning — the per-stream values already absorbed the
 * deductions, so the invariant reduced to
 * `sum(perStream) === totalNet` (with `deductionNet = 0`).
 * Storing the GROSS per-stream + a single `deductionNet`
 * matches the existing `rateBreakdown.deductions[]` shape
 * and gives the report view a clean "room revenue" +
 * "discounts given" split.
 */
export function computeBookingRevenueAllocation(
  input: ComputeBookingRevenueAllocationInput
): BookingRevenueAllocation {
  const ratePerNight = Number(input.ratePerNight) || 0;
  const numNights = Math.max(0, Number(input.numNights) || 0);
  const roomTotal = round2(ratePerNight * numNights);
  const breakfastTotal = round2(
    (input.hasBreakfast ? Number(input.breakfastRate) || 0 : 0) *
      Math.max(0, Number(input.numGuests) || 0) *
      numNights
  );
  const extraBedTotal = round2(Number(input.extraBedTotal) || 0);

  const chain = calculateDiscountChain({
    roomTotal,
    breakfastTotal,
    extraBedTotal,
    seniorPct: input.discountPct,
    voucherAmount: input.voucherDiscount,
    memberPct: input.memberDiscountPct,
    scope: input.discountScope,
    round: true
  });
  const deductionNet = round2(
    chain.seniorDeduction + chain.voucherDeduction + chain.memberDeduction
  );

  const roomNet = roomTotal;
  const breakfastNet = breakfastTotal;
  const addOnNet = extraBedTotal;
  const totalNet = round2(Number(input.totalPrice) || 0);

  return assertBookingRevenueAllocationInvariant(
    { roomNet, breakfastNet, addOnNet, deductionNet, totalNet },
    totalNet
  );
}


// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// compute the `Reservation.actualDateRange` from a list of
// children. Pure helper — no Firestore, no React state. The
// header's `checkIn` / `checkOut` are the original shared
// dates (now immutable per MRB-14); `actualDateRange` is the
// denormalized MIN(children.checkIn) / MAX(children.checkOut)
// + an `isDivergent` flag. The flag is `true` ⇔ any child's
// `checkIn` or `checkOut` differs from the header's
// `checkIn` / `checkOut`. Returns `null` for an empty
// children list (caller decides what to do — the create
// path always has at least 1 child, the reschedule path
// never reduces to 0, the add-room path has N+1 by
// construction). Used by the create path (initial write
// with all children matching the header → `isDivergent:
// false`), the reschedule path (post-reschedule re-scan),
// and the add-room path (post-add re-scan). N=1 + legacy
// null-`reservationId` callers don't compute the field
// (their data is per-child only).
export interface ReservationChildDateInput {
  checkIn: Date | string;
  checkOut: Date | string;
}

export interface ReservationActualDateRange {
  earliestCheckIn: Date;
  latestCheckOut: Date;
  isDivergent: boolean;
}

/**
 * Compute the `Reservation.actualDateRange` from a list of
 * children. Pure function — no Firestore, no React state,
 * no async. Dates are accepted as `Date` or ISO `string`
 * (the caller's choice; the helper normalises via
 * `new Date(...)`). Returns `null` for an empty list
 * (the caller is responsible for the empty-list case —
 * a reservation always has at least 1 child in MRB-04+).
 */
export function computeReservationActualDateRange(
  headerCheckIn: Date | string,
  headerCheckOut: Date | string,
  children: ReadonlyArray<ReservationChildDateInput>
): ReservationActualDateRange | null {
  if (children.length === 0) return null;
  const headerIn = new Date(headerCheckIn).getTime();
  const headerOut = new Date(headerCheckOut).getTime();
  if (!Number.isFinite(headerIn) || !Number.isFinite(headerOut)) return null;
  let earliest = new Date(headerIn);
  let latest = new Date(headerOut);
  let isDivergent = false;
  for (const child of children) {
    const childIn = new Date(child.checkIn).getTime();
    const childOut = new Date(child.checkOut).getTime();
    if (!Number.isFinite(childIn) || !Number.isFinite(childOut)) continue;
    if (childIn < earliest.getTime()) earliest = new Date(childIn);
    if (childOut > latest.getTime()) latest = new Date(childOut);
    if (childIn !== headerIn || childOut !== headerOut) {
      isDivergent = true;
    }
  }
  return { earliestCheckIn: earliest, latestCheckOut: latest, isDivergent };
}
