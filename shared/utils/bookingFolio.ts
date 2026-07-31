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
