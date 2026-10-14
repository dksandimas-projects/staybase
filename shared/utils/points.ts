// Per EC-02 (operator-requested 2026-08-21): the
// `earlyCheckInEnabled` flag joins the existing
// `pointsEnabled` / `memberDiscountEnabled` toggles in
// `settings/rewardsConfig`. When `false`, the booking flow
// hides the "Request Early Check-In" button, the
// `/api/email?action=early-checkin-request` handler rejects
// the write with 403 (defense-in-depth per Hard Rule #1),
// and the staff email is not sent. The flag is treated as
// `true` (the pre-EC-02 default) when absent — non-breaking
// for any deployment that hasn't explicitly turned it off.
//
// Per Phase 2 of the Spark Rewards tier system (2026-10-12,
// decision pending): the optional `levels[]`, `welcomePoints`,
// `minPointsToRedeem`, `pointsCanPayUpToBillPct`, and
// `freeNightEvery` fields join the existing scalars. All Phase 2
// fields default to "off / no-op" when absent so legacy reads
// continue to work unchanged — non-breaking for any deployment
// that hasn't yet tuned the new features.
export interface RewardsConfigLike {
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  pointsRedemptionRate: number;
  earlyCheckInEnabled?: boolean;
  // Phase 2 additions (all optional, safe defaults):
  welcomePoints?: number;
  minPointsToRedeem?: number;
  pointsCanPayUpToBillPct?: number;
  freeNightEvery?: number;
  levels?: Array<{
    id: string;
    name: string;
    fromStays: number;
    discountPct: number;
    pointsMultiplier: number;
    perks: string;
  }>;
  // Per PR #9 (2026-10-13): admin opt-in for member self-service
  // points redemption at booking Step 3. Default absent = off
  // (front-desk-mediated).
  allowMemberPointsRedemption?: boolean;
  // Existing legacy fallback used by tier-less members (per the
  // decision "Tier takes precedence; global is fallback only").
  memberDiscountPct?: number;
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

// Per Phase 2 (2026-10-12): resolve the tier a member belongs to
// given their completed-stay counter. The rules:
//   - `levels` is treated as unordered — we sort ascending by
//     `fromStays` defensively even though the Settings UI saves
//     in ascending order. Defense-in-depth so a hand-edited
//     config doesn't break the derivation.
//   - Return the tier with the HIGHEST `fromStays` that is still
//     ≤ `completedStays` — that's the member's current tier.
//   - `null` if `completedStays` is below every tier's threshold
//     OR if `levels` is absent / empty (legacy / off state).
//   - Defensive on missing or malformed rows: skips rows with
//     non-finite `fromStays` rather than throwing. The Zod
//     schema in `schemas/rewardsConfig.ts` validates at write
//     time, but a hand-edited doc shouldn't crash the booking
//     flow.
export function resolveCurrentLevel<
  T extends { fromStays: number; [k: string]: unknown }
>(levels: ReadonlyArray<T> | undefined | null, completedStays: number): T | null {
  if (!levels || levels.length === 0) return null;
  if (!Number.isFinite(completedStays) || completedStays < 0) return null;
  // Sort a copy ascending (callers may hold a frozen array).
  const sorted = [...levels]
    .filter((l) => Number.isFinite(l.fromStays) && l.fromStays >= 0)
    .sort((a, b) => a.fromStays - b.fromStays);
  let current: T | null = null;
  for (const level of sorted) {
    if (level.fromStays <= completedStays) current = level;
    else break; // array is ascending; no later row can match.
  }
  return current;
}

// Per Phase 2 (2026-10-12): apply a tier's points multiplier to the
// base points earned at checkout. Rounded to nearest integer so the
// `members/{uid}.rewardsPoints` field stays a clean whole number
// (matching the existing `pointsHistory.points` convention — see
// `guest-app/server/handlers/bookings.ts → calculateCheckoutPoints`).
// Multiplier ≤ 0 is coerced to 1 (defense-in-depth against a
// hand-edited config; the Zod schema rejects ≤ 0 at write time).
export function calculatePointsWithMultiplier(basePoints: number, multiplier: number | null | undefined): number {
  if (!Number.isFinite(basePoints) || basePoints <= 0) return 0;
  const m = Number.isFinite(multiplier) && (multiplier as number) > 0 ? (multiplier as number) : 1;
  return Math.max(0, Math.round(basePoints * m));
}
