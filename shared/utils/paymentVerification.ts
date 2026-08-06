/**
 * Per FOL-01 (2026-08-06, off-roadmap bug fix, decision #197):
 * the single source of truth for "was this booking's payment
 * staff-verified". The previous UI read `status ===
 * "payment-confirmed"` directly — a transient state that
 * doesn't survive the `payment-confirmed` → `confirmed`
 * transition. So a booking the staff had already confirmed
 * (the common case after a `Verify & Record Payment` followed
 * by `Confirm Booking`) silently fell through to the "Pending"
 * label in the booking drawer's Folio + Overview sections.
 *
 * The server already stamps `paymentConfirmedAt: Date | null`
 * on the booking when `handleVerifyAndRecordPayment`
 * (and `handleMarkPaymentConfirmed` / `handleConfirmBookingWithBalance`)
 * runs the full-payment transition. Nothing in the lifecycle
 * clears it. So `paymentConfirmedAt` is the durable signal
 * — set exactly once, never unset, and present on every
 * booking whose payment has been verified at any point.
 *
 * The helper reads BOTH the timestamp and the current status
 * so it's robust to either signal being absent in odd
 * edge cases (legacy bookings where the timestamp wasn't
 * stamped but the status was; or pre-fix bookings that have
 * `status: "confirmed"` but were never staff-verified). The
 * rule is:
 *
 *   - `status === "payment-confirmed"` — verified right now
 *     (the transient state, the most recent verification).
 *   - `paymentConfirmedAt` set — verified at some point in
 *     the past (the durable signal).
 *
 * Either one is sufficient. The function is intentionally
 * permissive (a `confirmed` booking that somehow lost the
 * `paymentConfirmedAt` field but the lifecycle says it was
 * verified still reads as verified), but strict (an unknown
 * status with no timestamp does not). Future payment-confirmed
 * states (`in-house` / `checked-out` if a hotel ever verifies
 * a late-arrival payment) are not auto-included — add them
 * deliberately when the lifecycle lands.
 *
 * Pure function — no React state, no Firestore, no side
 * effects. Both N=1 and multi-room-reservation paths read
 * from the same per-child `booking` shape.
 */

export interface PaymentVerificationLookup {
  /**
   * The booking's current lifecycle status. The transient
   * "verified right now" signal — when the staff has just
   * verified the payment but the booking has not been
   * moved to `confirmed` yet. `payment-confirmed` and
   * only `payment-confirmed` is treated as a verified state
   * via this axis (the other verified-by-timestamp check
   * covers the post-`payment-confirmed` lifecycle).
   */
  status?: string | null;
  /**
   * The durable "verified at some point" signal. Server
   * writes a `Date`; the admin mapper hydrates it to an ISO
   * string; the guest lookup hydrates it as a `Date`. Both
   * are accepted by the helper. `null` / `undefined` / `""`
   * for legacy bookings and any booking whose payment has
   * not been staff-verified yet.
   */
  paymentConfirmedAt?: string | Date | null | undefined;
}

/**
 * Returns `true` when the booking's payment has been
 * staff-verified — either right now (`status ===
 * "payment-confirmed"`) or at some earlier point
 * (`paymentConfirmedAt` is set and non-empty). The two
 * signals are OR'd; the function is intentionally
 * permissive on either signal alone. The `null` /
 * `undefined` / `""` cases on `paymentConfirmedAt` are
 * all treated as "not set" — the helper never throws
 * and never reads `Date`-only or `string`-only fields.
 */
export function isPaymentVerified(
  booking: PaymentVerificationLookup | null | undefined
): boolean {
  if (!booking) return false;

  // The transient signal: status is exactly
  // "payment-confirmed" right now. We deliberately do
  // NOT extend this to `confirmed` / `checked-in` /
  // `checked-out` — those statuses are valid lifecycle
  // states that do NOT, by themselves, imply verification
  // (e.g. staff can `Confirm Booking` from a
  // `payment-uploaded` state via the confirm-with-balance
  // path or the legacy handleConfirmBooking shortcut).
  // The `paymentConfirmedAt` axis is the right one for the
  // "verified at some earlier point" read.
  if (booking.status === "payment-confirmed") return true;

  // The durable signal: `paymentConfirmedAt` is set.
  // Accept ISO string (admin), Date (guest lookup), and
  // reject empty strings / null / undefined.
  const stamp = booking.paymentConfirmedAt;
  if (stamp === null || stamp === undefined) return false;
  if (typeof stamp === "string") return stamp.trim().length > 0;
  if (stamp instanceof Date) return !Number.isNaN(stamp.getTime());
  return false;
}
