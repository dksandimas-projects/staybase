// The money-closure rule: a cancelled booking closes against the
// HOTEL'S POLICY, not against a hardcoded "must hold nothing".
//
// WHY THIS EXISTS
// ---------------
// The hotel's live policy is "Cancellations within 48 hours of
// check-in are non-refundable" — so a cancelled booking can LEGITIMATELY
// still hold money. The reconciliation used to warn on any cancelled
// booking holding money, which produced two findings (F-A4, F-D4) that
// sat open because nobody could tell a deliberate retention from money
// that was simply never refunded.
//
// These tests pin the rule, in both directions: a cancellation INSIDE
// the window must be accepted, and one OUTSIDE it must be rejected.
//
// The policy rule itself is NOT re-implemented here — `evaluateBookingClosure`
// calls the product's own `evaluateCancellation`.

import { describe, it, expect } from "vitest";
import { evaluateBookingClosure } from "../../shared/utils/bookingClosure";
import { createCancellationPolicySnapshot } from "../../shared/utils/cancellation";

const websiteContent = {
  cancellationCutoffHours: 48,
  cancellationRefundPctBefore: 100,
  cancellationRefundPctAfter: 0,
  cancellationPolicy: "Cancellations made 48 hours or more before check-in are eligible for a full refund."
};
const hotelConfig = { checkInTime: "14:00", timezone: "Asia/Manila" };

/** A policy snapshot for a check-in date, exactly as the product builds it. */
function policyFor(checkInDateKey: string) {
  return createCancellationPolicySnapshot({
    websiteContent,
    hotelConfig,
    checkInDateKey,
    corporateCodeData: null
  });
}

// 2026-10-22 14:00 Asia/Manila == 2026-10-22T06:00:00.000Z
const CHECK_IN = "2026-10-22";
const CHECK_IN_MS = Date.parse("2026-10-22T06:00:00.000Z");

const HOUR = 3600 * 1000;

describe("a cancellation INSIDE the free-cancellation window", () => {
  // Cancelled 19 hours before check-in → 0% refund → the hotel keeps it.
  const cancelledAtMs = CHECK_IN_MS - 19 * HOUR;

  it("says the hotel should keep everything, and that is correct", () => {
    const result = evaluateBookingClosure({
      status: "cancelled",
      cancelledAtMs,
      checkInDateKey: CHECK_IN,
      grossCollected: 2800,
      refundedPaid: 0,
      totalPrice: 2800,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.refundPct).toBe(0);
    expect(result.expectedHeld).toBe(2800);
    expect(result.held).toBe(2800);
    expect(result.closes).toBe(true);
  });

  it("treats the retained over-collection as RETAINED, not as money owed back", () => {
    // The guest paid 100 more than the booking was worth, then
    // cancelled inside the window. The hotel keeps it — so it is NOT a
    // refund due. This is the ambiguity F-A4 was about.
    const result = evaluateBookingClosure({
      status: "cancelled",
      cancelledAtMs,
      checkInDateKey: CHECK_IN,
      grossCollected: 2800,
      refundedPaid: 0,
      totalPrice: 2700,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.overCollected).toBe(100);
    expect(result.overCollectionRetained).toBe(true);
  });
});

describe("a cancellation OUTSIDE the free-cancellation window", () => {
  // Cancelled 10 days before check-in → 100% refund.
  const cancelledAtMs = CHECK_IN_MS - 10 * 24 * HOUR;

  it("says the hotel should keep nothing, and that is correct", () => {
    const result = evaluateBookingClosure({
      status: "cancelled",
      cancelledAtMs,
      checkInDateKey: CHECK_IN,
      grossCollected: 6300,
      refundedPaid: 6300,
      totalPrice: 6300,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.refundPct).toBe(100);
    expect(result.expectedHeld).toBe(0);
    expect(result.held).toBe(0);
    expect(result.closes).toBe(true);
  });

  it("REJECTS a cancelled booking that still holds money it should have refunded", () => {
    const result = evaluateBookingClosure({
      status: "cancelled",
      cancelledAtMs,
      checkInDateKey: CHECK_IN,
      grossCollected: 6300,
      refundedPaid: 0,
      totalPrice: 6300,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.closes).toBe(false);
    expect(result.held).toBe(6300);
    expect(result.expectedHeld).toBe(0);
  });
});

describe("a live booking", () => {
  it("treats money collected beyond the total as a REFUND DUE", () => {
    const result = evaluateBookingClosure({
      status: "confirmed",
      cancelledAtMs: null,
      checkInDateKey: CHECK_IN,
      grossCollected: 2800,
      refundedPaid: 0,
      totalPrice: 2600,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.overCollected).toBe(200);
    expect(result.overCollectionRetained).toBe(false);
    expect(result.reason).toContain("refund due");
  });

  it("reports nothing when the money is exactly right", () => {
    const result = evaluateBookingClosure({
      status: "confirmed",
      cancelledAtMs: null,
      checkInDateKey: CHECK_IN,
      grossCollected: 2600,
      refundedPaid: 0,
      totalPrice: 2600,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.overCollected).toBe(0);
  });
});

describe("a cancelled booking with no usable cancellation stamp", () => {
  it("cannot confirm closure — and says so rather than guessing", () => {
    const result = evaluateBookingClosure({
      status: "cancelled",
      cancelledAtMs: null,
      checkInDateKey: CHECK_IN,
      grossCollected: 2800,
      refundedPaid: 0,
      totalPrice: 2800,
      policySnapshot: policyFor(CHECK_IN),
      checkInTime: hotelConfig.checkInTime,
      timeZone: hotelConfig.timezone
    });
    expect(result.closes).toBe(false);
    expect(result.reason).toContain("cannot be applied");
  });
});
