/**
 * Per 2026-07-24 (`refactor/unify-payment-reference-fields`):
 * the canonical payment reference for a booking lives on the
 * most recent entry in the booking's `onsitePayments[]` ledger
 * as `transactionReference`. This module is the single source
 * of truth for that lookup — every display surface (booking
 * drawer header, bookings table payment proof card, dashboard
 * pending-payment badge, reports exports, `payment-rejected`
 * email "Reference on file" callout) routes through
 * `getLatestPaymentReference` so they can never drift.
 *
 * The previous top-level `Booking.paymentReferenceNumber`
 * (guest-entered at booking time) is retired; new bookings
 * omit it and the field is no longer in the data model.
 */

export interface PaymentReferenceLookup {
  /**
   * The booking's onsite-payments ledger. May be `undefined`
   * when the booking has not had any staff-verified/recorded
   * payments yet (typical for `payment-uploaded` rows still
   * awaiting verification) — the helper returns `null` in
   * that case.
   */
  onsitePayments?: ReadonlyArray<{ transactionReference?: string | null }> | null;
}

/**
 * Returns the most recent non-empty `transactionReference`
 * from the booking's onsite-payments ledger, or `null` when
 * no payment has been recorded yet.
 *
 * Walks the array from the end so the most recent entry
 * (the one most likely to reflect the current state) wins
 * even if older entries are blank or invalid.
 */
export function getLatestPaymentReference(
  booking: PaymentReferenceLookup | null | undefined
): string | null {
  const payments = booking?.onsitePayments;
  if (!Array.isArray(payments) || payments.length === 0) return null;
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    const ref = payments[i]?.transactionReference;
    if (typeof ref === "string" && ref.trim().length > 0) return ref;
  }
  return null;
}
