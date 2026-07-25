import { describe, expect, test } from "vitest";
import { calculatePointsRedemptionValue, validatePointsRedemption } from "../utils/points";

// Per Spark Rewards audit 2026-07-18 LOW-4: `calculateEarnedPoints`
// was deleted from `../utils/points` because it diverged from
// the live checkout-time formula in
// `guest-app/server/handlers/bookings.ts → calculateCheckoutPoints`
// (proportional crediting vs per-₱100-block). The shared helper
// had no production call site, so the divergence was a trap
// rather than an active bug. Tests that exercised the divergent
// helper are removed; the canonical formula lives in
// `calculateCheckoutPoints` and is covered by the booking-flow
// integration tests.

describe("points utilities", () => {
  test("calculates points redemption value", () => {
    // 500 points at 10 rate (10 php per 100 points) = 50 php
    expect(calculatePointsRedemptionValue(500, 10)).toBe(50);
  });

  test("validates points redemption", () => {
    // Valid redemption
    const valid = validatePointsRedemption(500, 1000, 10);
    expect(valid.valid).toBe(true);
    expect(valid.value).toBe(50);
    expect(valid.error).toBe("");

    // Insufficient points
    const insufficient = validatePointsRedemption(1500, 1000, 10);
    expect(insufficient.valid).toBe(false);
    expect(insufficient.error).toBe("Insufficient points balance.");

    // Negative points
    const negative = validatePointsRedemption(-100, 1000, 10);
    expect(negative.valid).toBe(false);
    expect(negative.error).toBe("Points to redeem must be greater than zero.");
  });
});
