// Does a booking's money CLOSE?
//
// WHY THIS EXISTS
// ---------------
// The hotel's live cancellation policy is: "Cancellations made 48 hours
// or more before check-in are eligible for a full refund. Cancellations
// within 48 hours of check-in are non-refundable."
//
// So a CANCELLED booking can LEGITIMATELY still hold money — when the
// cancellation fell inside the 48-hour window, the hotel keeps what was
// paid. The nightly reconciliation used to warn on ANY cancelled
// booking holding money, with no way to tell a deliberate retention
// from money that was simply never refunded. Two findings sat open on
// exactly that ambiguity (F-A4, F-D4).
//
// The same ambiguity showed up in the Full Backup: a negative
// "Outstanding Balance" could be a legitimate over-collection or a
// data error, and the reader could not tell which.
//
// WHAT THIS DOES
// --------------
// It answers two questions with the PRODUCT'S OWN policy rule (the
// shared `evaluateCancellation` helper — the same one the cancellation
// handler calls), so there is exactly ONE implementation of "what does
// the policy say":
//
//   1. after a cancellation, how much SHOULD the hotel still hold?
//   2. is an over-collection explained by the policy retaining money,
//      or is it money that is owed back to the guest?
//
// Nothing here is a second copy of the policy: `evaluateCancellation`
// is the product's rule and this file only asks it a question.

import { evaluateCancellation, type CancellationPolicySnapshot } from "./cancellation";

/** The minimum a caller has to know about a booking's money. */
export interface BookingClosureInput {
  /** The booking's status. Only `cancelled` is judged against the policy. */
  status: string;
  /** When the booking was cancelled (epoch ms). Null when it never was. */
  cancelledAtMs: number | null;
  /** The check-in date, `YYYY-MM-DD`. Null when it is unknown. */
  checkInDateKey: string | null;
  /**
   * The money the guest PAID, before any refund. The policy's refund
   * percentage is a percentage of THIS figure.
   */
  grossCollected: number;
  /**
   * The money already refunded to the guest (settled refunds only — a
   * pending refund is a LIABILITY, money still owed, not money
   * returned).
   */
  refundedPaid: number;
  /** The booking's billed total. */
  totalPrice: number;
  /** The policy snapshot for this booking's check-in. */
  policySnapshot: CancellationPolicySnapshot | null;
  /** The hotel's standard check-in time, e.g. `14:00`. */
  checkInTime?: string;
  /** The hotel's timezone, e.g. `Asia/Manila`. */
  timeZone?: string;
}

export interface BookingClosure {
  /** The money the hotel actually holds. */
  held: number;
  /** The money the hotel SHOULD hold after the cancellation, per the policy. */
  expectedHeld: number;
  /** Does the booking's money close against the policy? */
  closes: boolean;
  /** The refund percentage the policy applied. Null when never cancelled. */
  refundPct: number | null;
  /**
   * How much MORE the hotel holds than the booking was worth. Zero
   * when the hotel holds less (or exactly what is owed).
   */
  overCollected: number;
  /**
   * Is the over-collection explained by the cancellation policy
   * retaining the money? When true, it is NOT money owed back — the
   * guest was charged, then cancelled inside the free-cancellation
   * window and keeps what they paid.
   */
  overCollectionRetained: boolean;
  /** A plain-language reason, for a report line. */
  reason: string;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The money a guest is owed back because they paid more than the stay. */
export function evaluateBookingClosure(input: BookingClosureInput): BookingClosure {
  const gross = r2(input.grossCollected);
  const refundedPaid = r2(input.refundedPaid);
  const held = r2(gross - refundedPaid);
  const total = r2(input.totalPrice);

  if (String(input.status) !== "cancelled") {
    // A live booking: the hotel holds what was paid, and anything
    // beyond the billed total is money owed back to the guest.
    const overCollected = r2(Math.max(0, held - total));
    return {
      held,
      expectedHeld: held,
      closes: true,
      refundPct: null,
      overCollected,
      overCollectionRetained: false,
      reason: overCollected > 0.01
        ? `over-collected by ${overCollected} — refund due to the guest`
        : "not over-collected"
    };
  }

  // A cancelled booking. Ask the PRODUCT'S policy rule what should
  // have been refunded.
  if (input.cancelledAtMs === null || !input.checkInDateKey) {
    return {
      held,
      expectedHeld: Number.NaN,
      closes: false,
      refundPct: null,
      overCollected: r2(Math.max(0, held - total)),
      overCollectionRetained: false,
      reason: "cancelled without a timestamp or a check-in date — the policy cannot be applied, so closure cannot be confirmed"
    };
  }

  const evaluation = evaluateCancellation(input.cancelledAtMs, input.policySnapshot, {
    checkInDateKey: input.checkInDateKey,
    checkInTime: input.checkInTime,
    timeZone: input.timeZone
  });
  const refundPct = evaluation.refundPct;
  const expectedPolicyRefund = r2((gross * refundPct) / 100);
  const expectedHeld = r2(gross - expectedPolicyRefund);
  const closes = Math.abs(held - expectedHeld) < 0.01;

  // When the policy refunded NOTHING (a cancellation inside the
  // free-cancellation window), the hotel keeps everything — so holding
  // more than the voided booking was worth is RETAINED, not owed back.
  const retained = refundPct === 0;
  const overCollected = r2(Math.max(0, held - total));

  return {
    held,
    expectedHeld,
    closes,
    refundPct,
    overCollected,
    overCollectionRetained: retained && overCollected > 0.01,
    reason: closes
      ? retained
        ? `cancelled inside the ${input.policySnapshot?.cutoffHours ?? 48}h window — the hotel retains the ${held} by policy`
        : `cancelled — the policy refunded ${refundPct}% (${expectedPolicyRefund}), so the hotel should hold ${expectedHeld} and does`
      : `cancelled — the policy says the hotel should hold ${expectedHeld} but it holds ${held} (Δ ${r2(held - expectedHeld)})`
  };
}
