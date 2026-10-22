// Per PAY-01 (P1 MONEY, 2026-10-22): the booking-scoped
// `paidAmount` — the money collected AGAINST a booking.
//
// THE DEFECT THIS MODULE FIXES
// ----------------------------
// `booking.paidAmount` was READ by six production surfaces and
// WRITTEN by none. The only writer was the refund path
// (`guest-app/server/lib/refunds.ts`), which DECREMENTS it. A
// booking that had money collected against it therefore carried NO
// `paidAmount` at all, and every read fell back to `0`.
//
// The visible damage was the refund-liability gate.
// `redateBreakfastSelections` (shared/utils/bookingAddOnReschedule.ts)
// uses `paidAmount` as the "was this meal paid for?" budget:
//
//   const wasPaid = amount > 0 && remainingPaid >= amount;
//
// With `paidAmount` always 0, `wasPaid` was always false, so
// cancelling a booking with a PAID breakfast opened ZERO refund
// rows — the hotel collected the money and never refunded it.
//
// This module owns the arithmetic. The write sites are the only two
// production payment-record paths in the codebase:
// `handleAddPayment` + `handleVerifyAndRecordPayment`
// (`guest-app/server/handlers/bookings.ts`).
//
// THE MONEY MODEL
// ---------------
// `paidAmount` is the booking-scoped counterpart of the folio's
// `collectedTotal`:
//
//   • It is INCREMENTAL. A new payment adds to the running value; a
//     paid refund subtracts from it. It is NOT recomputed from the
//     ledger on every write: the refund paths decrement the
//     BOOKING-scoped value (`markRefundPaid` writes
//     `bookings/{id}.paidAmount`), so a recompute would silently
//     resurrect money that was already refunded.
//
//   • A reservation-scope payment (`reservations/{rid}/payments/{pid}`)
//     is attributed to the booking it was RECORDED AGAINST — the
//     record carries that `bookingId` (per MRB-04 Phase 2.x). That
//     is the SAME attribution the admin app's canonical payment
//     ledger uses (RPT-01 — `admin-app/src/utils/bookingPaymentEntries.ts`),
//     so the denormalised field and the derived ledger agree.
//
//   • Store-order tenders (`storeOrders/{id}/payments/delivery-tender`)
//     are NOT room-folio payments and never count toward a booking's
//     `paidAmount`. The folio already adds a delivered + billed
//     add-to-bill order to the grand total via `storeTotal`, so
//     counting the tender as well would double-charge the guest.
//
//   • `totalPrice` is NOT touched. Per decision #298 + BR-01/BR-03
//     the other add-ons sit ON TOP of `totalPrice` for the balance
//     and `paidAmount` is a SEPARATE field.
//
//   • A booking with no `paidAmount` at all is a LEGACY booking (the
//     field was never written before this fix). The callers pass the
//     ledger seed so the first post-fix payment lands on the right
//     running total instead of restarting from zero.

import { roundToTwoDecimals } from "./money";

/**
 * A ledger entry as the payment paths see it: a payment / refund doc
 * from a booking's or a reservation's `payments` / `refunds`
 * subcollection.
 */
export interface PaidAmountLedgerEntry {
  /** The signed amount. Refunds are negative (CRL-01 convention). */
  amount?: number | string | null;
  /**
   * The booking the entry is attributed to. The canonical
   * reservation-scope payment records stamp it (per MRB-04 Phase 2.x);
   * the legacy `bookings/{id}/payments/{pid}` entries have no
   * `bookingId` field — they are attributed by their PATH.
   */
  bookingId?: string | null;
}

/**
 * Sum every ledger entry (the legacy `bookings/{id}/payments` scope,
 * where every entry belongs to the booking).
 *
 * @param entries The ledger entries to sum.
 * @returns The signed sum, rounded to 2dp.
 */
export function sumLedgerEntryAmounts(
  entries: PaidAmountLedgerEntry[] | null | undefined
): number {
  let sum = 0;
  for (const entry of entries || []) {
    if (!entry) continue;
    const amount = Number(entry.amount || 0);
    if (!Number.isFinite(amount)) continue;
    sum += amount;
  }
  return roundToTwoDecimals(sum);
}

/**
 * Sum only the ledger entries attributed to `bookingId` (the
 * reservation-scope case, where the subcollection holds the payments
 * of EVERY room in the reservation).
 *
 * An entry with no attributable `bookingId` is EXCLUDED: it is a
 * reservation-scope entry with no room attribution, and guessing a
 * room would either double-count it across the reservation's children
 * or hide it from all of them. This mirrors the admin app's canonical
 * ledger projection (RPT-01).
 *
 * @param entries The ledger entries to sum.
 * @param bookingId The booking the sum is attributed to.
 * @returns The signed sum, rounded to 2dp.
 */
export function sumAttributedLedgerEntryAmounts(
  entries: PaidAmountLedgerEntry[] | null | undefined,
  bookingId: string
): number {
  const target = String(bookingId || "").trim();
  if (!target) return 0;
  const attributed = (entries || []).filter((entry) => {
    if (!entry) return false;
    return String(entry.bookingId || "").trim() === target;
  });
  return sumLedgerEntryAmounts(attributed);
}

/**
 * The `paidAmount` a booking carries after a new payment of
 * `recordedAmount` is recorded against it.
 *
 * The base is:
 *
 *   • the booking doc's CURRENT `paidAmount` when it has one — the
 *     normal case, and the value the refund paths decrement; or
 *
 *   • the caller-supplied `legacyCollectedAmount` (the sum of the
 *     ledger entries already attributed to the booking) when the
 *     booking predates this fix and therefore carries no
 *     `paidAmount` at all. Without the seed, the first post-fix
 *     payment on a legacy booking would restart the running total
 *     from zero and UNDER-report the money already collected.
 *
 * The result is a plain sum — a negative value is possible only when
 * a refund exceeds the collected amount, which the refund paths guard
 * against with their own net-collected gate.
 *
 * @param params.currentPaidAmount The booking doc's current `paidAmount`.
 * @param params.recordedAmount The amount of the new payment (positive).
 * @param params.legacyCollectedAmount The ledger seed for a booking that
 *   carries no `paidAmount` yet.
 * @returns The new `paidAmount`, rounded to 2dp.
 */
export function computeNextBookingPaidAmount(params: {
  currentPaidAmount?: number | string | null;
  recordedAmount: number | string | null | undefined;
  legacyCollectedAmount?: number | string | null;
}): number {
  const current = Number(params.currentPaidAmount);
  const recorded = Number(params.recordedAmount);
  const legacy = Number(params.legacyCollectedAmount);

  const base = Number.isFinite(current)
    ? current
    : (Number.isFinite(legacy) ? legacy : 0);
  const increment = Number.isFinite(recorded) ? recorded : 0;

  return roundToTwoDecimals(base + increment);
}
