export interface RewardsConfigLike {
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  pointsRedemptionRate: number;
}

export function calculateEarnedPoints(totalPrice: number, config: RewardsConfigLike) {
  if (config.earningMode === "per-booking") {
    return Math.max(Math.floor(config.pointsPerBooking), 0);
  }

  return Math.max(Math.floor(totalPrice / 100) * config.pointsPerHundred, 0);
}

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
