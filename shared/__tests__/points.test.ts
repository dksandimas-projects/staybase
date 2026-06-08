import { describe, expect, test } from "vitest";
import { calculateEarnedPoints, calculatePointsRedemptionValue, validatePointsRedemption } from "../utils/points";

describe("points utilities", () => {
  const config = {
    earningMode: "per-spend" as const,
    pointsPerBooking: 50,
    pointsPerHundred: 5,
    pointsRedemptionRate: 10 // 100 points = 10 php
  };

  test("calculates earned points per spend", () => {
    // 5 points per 100 spend. Spend: 1050
    // floor(1050/100) * 5 = 10 * 5 = 50
    expect(calculateEarnedPoints(1050, config)).toBe(50);
  });

  test("calculates earned points per booking", () => {
    const perBookingConfig = {
      ...config,
      earningMode: "per-booking" as const
    };
    expect(calculateEarnedPoints(1050, perBookingConfig)).toBe(50);
  });

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
