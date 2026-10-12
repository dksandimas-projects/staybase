import { describe, expect, test } from "vitest";
import {
  RewardsConfigSchema,
  LevelDefSchema,
} from "../schemas/rewardsConfig";
import {
  resolveCurrentLevel,
  calculatePointsWithMultiplier,
} from "../utils/points";

// Per Phase 2 of the Spark Rewards tier system (2026-10-12, decision
// pending). The Settings → Rewards tab writes a `levels[]` array via
// `updateSettings("rewardsConfig", …)`; this suite pins both the
// Zod schema validation AND the new shared helpers so the booking
// engine (Phase 4) and member portal (Phase 7) can build on a
// stable contract.

const baseConfig = {
  pointsEnabled: true,
  earningMode: "per-spend" as const,
  pointsPerBooking: 100,
  pointsPerHundred: 10,
  memberDiscountEnabled: false,
  memberDiscountPct: 0,
  pointsRedemptionRate: 100,
};

const baseTier = {
  id: "tier_default_member",
  name: "Member",
  fromStays: 0,
  discountPct: 5,
  pointsMultiplier: 1,
  perks: "5% off room rates. Earn 1 point for every ₱100.",
};

describe("RewardsConfigSchema", () => {
  test("accepts a minimal Phase 1 config (no Phase 2 fields)", () => {
    // Backward-compat — pre-Phase 2 deployments carry only Phase 1
    // fields. The schema must accept those without forcing the
    // admin to "complete" the Phase 2 fields before saving.
    const result = RewardsConfigSchema.safeParse(baseConfig);
    expect(result.success).toBe(true);
  });

  test("accepts a full Phase 2 config with 3 default tiers", () => {
    const config = {
      ...baseConfig,
      welcomePoints: 50,
      minPointsToRedeem: 100,
      pointsCanPayUpToBillPct: 50,
      freeNightEvery: 5,
      levels: [
        baseTier,
        {
          id: "tier_default_silver",
          name: "Silver",
          fromStays: 3,
          discountPct: 7,
          pointsMultiplier: 1.25,
          perks: "7% off. Early check-in.",
        },
        {
          id: "tier_default_gold",
          name: "Gold",
          fromStays: 8,
          discountPct: 10,
          pointsMultiplier: 1.5,
          perks: "10% off. Late check-out until 2 PM.",
        },
      ],
    };
    const result = RewardsConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("rejects duplicate fromStays thresholds across tiers", () => {
    const result = RewardsConfigSchema.safeParse({
      ...baseConfig,
      levels: [
        baseTier,
        { ...baseTier, id: "dup", name: "Dup", fromStays: 0 }, // duplicate threshold
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Duplicate threshold/);
    }
  });

  test("rejects a levels array with no 0-stay base tier", () => {
    const result = RewardsConfigSchema.safeParse({
      ...baseConfig,
      levels: [
        { ...baseTier, id: "tier_silver", name: "Silver", fromStays: 3 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          /at least one tier must have a 0-stay threshold/i.test(i.message)
        )
      ).toBe(true);
    }
  });

  test("rejects negative welcomePoints", () => {
    const result = RewardsConfigSchema.safeParse({
      ...baseConfig,
      welcomePoints: -10,
    });
    expect(result.success).toBe(false);
  });

  test("rejects bill cap > 100%", () => {
    const result = RewardsConfigSchema.safeParse({
      ...baseConfig,
      pointsCanPayUpToBillPct: 150,
    });
    expect(result.success).toBe(false);
  });

  test("rejects tier discount > 100%", () => {
    const result = LevelDefSchema.safeParse({
      ...baseTier,
      discountPct: 150,
    });
    expect(result.success).toBe(false);
  });

  test("rejects tier with pointsMultiplier = 0", () => {
    const result = LevelDefSchema.safeParse({
      ...baseTier,
      pointsMultiplier: 0,
    });
    expect(result.success).toBe(false);
  });

  test("rejects tier with empty name", () => {
    const result = LevelDefSchema.safeParse({
      ...baseTier,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts empty levels array (legacy / off state)", () => {
    // Empty array is a valid state — booking engine falls back to
    // the legacy `memberDiscountPct` for tier-less members. This
    // keeps the schema aligned with the seed default of 3 tiers
    // while still allowing admin to clear the array entirely.
    const result = RewardsConfigSchema.safeParse({
      ...baseConfig,
      levels: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("resolveCurrentLevel", () => {
  const tiers = [
    { id: "member", name: "Member", fromStays: 0, discountPct: 5, pointsMultiplier: 1, perks: "" },
    { id: "silver", name: "Silver", fromStays: 3, discountPct: 7, pointsMultiplier: 1.25, perks: "" },
    { id: "gold", name: "Gold", fromStays: 8, discountPct: 10, pointsMultiplier: 1.5, perks: "" },
  ];

  test("returns null when levels is undefined or empty", () => {
    expect(resolveCurrentLevel(undefined, 10)).toBeNull();
    expect(resolveCurrentLevel(null, 10)).toBeNull();
    expect(resolveCurrentLevel([], 10)).toBeNull();
  });

  test("returns the base tier for 0 stays", () => {
    expect(resolveCurrentLevel(tiers, 0)?.id).toBe("member");
  });

  test("returns Silver for 3..7 stays", () => {
    expect(resolveCurrentLevel(tiers, 3)?.id).toBe("silver");
    expect(resolveCurrentLevel(tiers, 5)?.id).toBe("silver");
    expect(resolveCurrentLevel(tiers, 7)?.id).toBe("silver");
  });

  test("returns Gold for 8+ stays", () => {
    expect(resolveCurrentLevel(tiers, 8)?.id).toBe("gold");
    expect(resolveCurrentLevel(tiers, 99)?.id).toBe("gold");
  });

  test("defensively sorts unsorted input ascending", () => {
    // Hand-edited config could be in any order; the helper must
    // still pick the right tier.
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(resolveCurrentLevel(shuffled, 5)?.id).toBe("silver");
  });

  test("skips rows with non-finite fromStays instead of throwing", () => {
    const dirty = [
      { ...tiers[0], fromStays: Number.NaN },
      tiers[1],
    ];
    // The NaN row is dropped; Silver still resolves for 5 stays.
    expect(resolveCurrentLevel(dirty, 5)?.id).toBe("silver");
  });

  test("returns null for non-finite completedStays", () => {
    expect(resolveCurrentLevel(tiers, Number.NaN)).toBeNull();
    expect(resolveCurrentLevel(tiers, -1)).toBeNull();
  });
});

describe("calculatePointsWithMultiplier", () => {
  test("applies multiplier and rounds to nearest integer", () => {
    expect(calculatePointsWithMultiplier(100, 1.25)).toBe(125);
    expect(calculatePointsWithMultiplier(100, 1.5)).toBe(150);
    expect(calculatePointsWithMultiplier(101, 1.25)).toBe(126); // 126.25 → 126
  });

  test("falls back to 1× when multiplier is null / undefined / zero", () => {
    expect(calculatePointsWithMultiplier(100, null)).toBe(100);
    expect(calculatePointsWithMultiplier(100, undefined)).toBe(100);
    expect(calculatePointsWithMultiplier(100, 0)).toBe(100); // coerced to 1
    expect(calculatePointsWithMultiplier(100, -1)).toBe(100); // coerced to 1
  });

  test("returns 0 for non-positive base points", () => {
    expect(calculatePointsWithMultiplier(0, 1.5)).toBe(0);
    expect(calculatePointsWithMultiplier(-10, 1.5)).toBe(0);
    expect(calculatePointsWithMultiplier(Number.NaN, 1.5)).toBe(0);
  });
});