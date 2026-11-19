/**
 * Per VPM-01 (2026-11-19, decision #322): the single source of
 * truth for the "did the payment I just recorded settle this
 * booking?" verdict that the admin verify flow renders.
 *
 * ## Why this module exists
 *
 * The admin verify flow ended up with TWO different answers to the
 * same question, and the answer depended on which screen the staff
 * was standing on:
 *
 *  - The **dashboard** pending-payments card compared the
 *    cumulative collected against the scope's `totalPrice` (the
 *    room + the booking-time add-ons).
 *  - The **booking drawer** compared the same cumulative against
 *    the *folio* grand total — `totalPrice` + the BR-12 other
 *    add-ons + the store/incidental charges
 *    (`shared/utils/bookingFolio.ts`).
 *
 * The server (`handleVerifyAndRecordPayment`) uses the FIRST rule
 * for its status flip (`totalCollected >= data.totalPrice`) and the
 * SECOND rule for the threshold gate on a confirm-with-balance
 * (`readTransactionalFolioSnapshot` → `totalPrice + incidental +
 * add-to-bill + otherAddOns`). So the two halves of the server
 * already disagreed with each other, and each admin surface had
 * picked a different one.
 *
 * The visible damage: a booking whose room total was paid in full
 * but which carried an unpaid ₱2,000 airport transfer (a BR-12
 * "other add-on", which is added ON TOP of `totalPrice`) reported
 * "Payment confirmed" from the dashboard and "Partial payment
 * recorded — ₱2,000 still owing" from the drawer — for the same
 * payment. Worse, the dashboard's "Confirm Booking" CTA had no
 * balance gate at all, so that ₱2,000 was banked with no reason
 * recorded and no four-eyes approval.
 *
 * ## The rule this module encodes
 *
 * Two DIFFERENT questions, answered separately:
 *
 *  1. **Is the booking's money covered?** (`bookingTotalCovered`)
 *     The server's status rule: `collectedAfter >= bookingTotal`.
 *     This drives the headline — the desk should see "Payment
 *     confirmed" exactly when the server flipped the booking to
 *     `payment-confirmed`.
 *  2. **Is anything still owed on the folio?** (`folioSettled` /
 *     `remainingBalance`) The folio rule: `collectedAfter >=
 *     folioTotal`, where `folioTotal = bookingTotal +
 *     otherAddOnTotal + chargesTotal`. This drives the CTA — money
 *     that is still owed must go through the confirm-with-balance
 *     flow (reason + four-eyes threshold), never a one-tap
 *     confirm.
 *
 * The two answers are NOT the same number, and that is the point:
 * a booking can have its room total covered (question 1 = yes)
 * while still owing an add-on (question 2 = no). Before this
 * module, each surface silently picked one of the two questions
 * and called it "the" answer.
 */

/** The money inputs the resolver needs. All amounts are PHP. */
export interface VerifyPaymentOutcomeInput {
  /**
   * Money already collected for this scope BEFORE the payment the
   * staff just recorded. Scope-scoped: for a multi-room
   * reservation this is the reservation's collected total, not the
   * lead room's.
   */
  collectedBefore: number;
  /** The payment the staff just recorded. */
  amount: number;
  /**
   * The scope's booking total — the room + the add-ons charged at
   * booking time. This is `totalPrice` (per room) or the
   * reservation header's `totalPrice` (per reservation). It does
   * NOT include the BR-12 other add-ons.
   */
  bookingTotal: number;
  /**
   * The scope's BR-12 "other add-ons" total (e.g. an airport
   * transfer added on top of the room bill). NOT inside
   * `bookingTotal`.
   */
  otherAddOnTotal: number;
  /**
   * Store + incidental charges already on the folio. Zero for a
   * pre-check-in verification (charges accrue during the stay).
   */
  chargesTotal: number;
}

export interface VerifyPaymentOutcome {
  /** `collectedBefore + amount` — the scope's collected total after this payment. */
  collectedAfter: number;
  /** What the folio says is owed: `bookingTotal + otherAddOnTotal + chargesTotal`. */
  folioTotal: number;
  /**
   * True iff the scope's BOOKING total is covered. Mirrors the
   * server's `fullyPaid` rule in `handleVerifyAndRecordPayment`
   * (`totalPrice > 0 && totalCollected >= totalPrice`) — including
   * the `totalPrice > 0` guard, so a zero-total booking reads as
   * NOT covered exactly as the server does. This drives the
   * success modal's headline.
   */
  bookingTotalCovered: boolean;
  /**
   * True iff nothing is outstanding on the folio. This drives the
   * success modal's CTA: settled → "Confirm Booking"; outstanding
   * → "Confirm with Balance" (reason + four-eyes threshold).
   */
  folioSettled: boolean;
  /**
   * What is still owed on the folio, floored at 0. This is the
   * number the confirm-with-balance flow previews and the number
   * the server's threshold gate will measure.
   */
  remainingBalance: number;
}

/** Coerce to a finite, non-negative number. NaN / Infinity /
 *  negatives collapse to 0 — the safe direction for money the
 *  hotel is owed (never inflate a balance from bad data). */
function toAmount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 0 ? numeric : 0;
}

/**
 * Resolve the post-verification money state for one scope.
 *
 * Pure — no React, no Firestore, no clock. Both admin surfaces
 * (the dashboard's pending-payments card and the booking drawer)
 * call this with their own scope, so the two can never disagree
 * again.
 */
export function resolveVerifyPaymentOutcome(
  input: VerifyPaymentOutcomeInput
): VerifyPaymentOutcome {
  const collectedBefore = toAmount(input.collectedBefore);
  const amount = toAmount(input.amount);
  const bookingTotal = toAmount(input.bookingTotal);
  const otherAddOnTotal = toAmount(input.otherAddOnTotal);
  const chargesTotal = toAmount(input.chargesTotal);

  const collectedAfter = collectedBefore + amount;
  const folioTotal = bookingTotal + otherAddOnTotal + chargesTotal;

  // The server's status rule, verbatim. `bookingTotal > 0` mirrors
  // the server's `totalPrice > 0` guard so the headline never
  // claims "Payment confirmed" for a booking the server left
  // untouched.
  const bookingTotalCovered = bookingTotal > 0 && collectedAfter >= bookingTotal;
  // The folio rule. A zero-total folio is settled by definition
  // (nothing is owed).
  const folioSettled = collectedAfter >= folioTotal;
  const remainingBalance = Math.max(0, folioTotal - collectedAfter);

  return {
    collectedAfter,
    folioTotal,
    bookingTotalCovered,
    folioSettled,
    remainingBalance
  };
}
