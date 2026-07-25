export interface RewardsConfigLike {
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  pointsRedemptionRate: number;
}

// Per Spark Rewards audit 2026-07-18 LOW-4: the previous
// `calculateEarnedPoints` helper used a per-₱100-block formula
// `Math.floor(totalPrice/100) * pointsPerHundred` that diverged
// from the live checkout-time formula in
// `guest-app/server/handlers/bookings.ts → calculateCheckoutPoints`
// which uses proportional crediting `Math.floor((totalPrice/100)
// * pointsPerHundred)`. The shared helper was only referenced
// by its own test (no production call site), so the divergence
// was a trap rather than an active bug. Deleted the helper —
// `calculateCheckoutPoints` is the single source of truth for
// points earning.

export function calculatePointsRedemptionValue(points: number, pointsRedemptionRate: number) {
  return Math.max((points / 100) * pointsRedemptionRate, 0);
}

export function validatePointsRedemption(pointsToRedeem: number, availablePoints: number, pointsRedemptionRate: number) {
  if (pointsToRedeem <= 0) {
    return { valid: false, value: 0, error: "Points to redeem must be greater than zero." };
  }

  if (pointsToRedeem > availablePoints) {
    return { valid: false, value: 0, error: "Insufficient points balance." };
  }

  return {
    valid: true,
    value: calculatePointsRedemptionValue(pointsToRedeem, pointsRedemptionRate),
    error: ""
  };
}
