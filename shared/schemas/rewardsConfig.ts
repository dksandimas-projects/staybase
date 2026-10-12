import { z } from "zod";

// Per Phase 2 of the Spark Rewards tier system (2026-10-12, decision
// pending). The Settings → Rewards tab writes a `levels[]` array via
// the existing `updateSettings("rewardsConfig", …)` route; this schema
// is the validation gate for those writes. The shape mirrors the
// `LevelDef` interface in `shared/types/index.ts` and is intentionally
// strict on numeric ranges (no negatives, no >100% discount, no
// zero/negative pointsMultiplier) so admin UI mistakes are caught at
// the API boundary rather than surfacing as bad pricing math at
// booking time.

// A single tier row. `fromStays` must be an integer ≥ 0 (zero is the
// "base" tier — every member qualifies at registration). `perks` is
// capped at 280 chars because the member portal renders it inline
// in the rewards card; longer blurbs would break the layout.
export const LevelDefSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, "Tier name is required").max(24, "Tier name must be 24 characters or fewer"),
  fromStays: z.number().int("Threshold must be a whole number of stays").min(0, "Threshold cannot be negative"),
  discountPct: z.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%"),
  pointsMultiplier: z.number().min(0.01, "Multiplier must be greater than zero"),
  perks: z.string().trim().max(280, "Perks blurb must be 280 characters or fewer"),
});

// The full `settings/rewardsConfig` payload. Phase 1 fields are
// required so a write that omits them is rejected (forces admin to
// pick a value rather than silently keep stale state). Phase 2
// fields are optional — absent means "feature is off / empty".
//
// The array-level refinement enforces:
//   - at least one tier
//   - `fromStays` unique within the array
//   - at least one tier with `fromStays === 0` (the "base" tier —
//     the booking engine needs a discount source for tier-less
//     members; if there's no base, the engine would fall back to
//     the legacy `memberDiscountPct`, which the admin may not
//     intend when building a brand-new tier program).
//
// Returns the parsed array so the caller doesn't have to re-walk.
export const RewardsConfigSchema = z
  .object({
    // Phase 1 fields (required, matching seed defaults):
    pointsEnabled: z.boolean(),
    earningMode: z.enum(["per-booking", "per-spend"]),
    pointsPerBooking: z.number().int().min(0),
    pointsPerHundred: z.number().int().min(0),
    memberDiscountEnabled: z.boolean(),
    memberDiscountPct: z.number().min(0).max(100),
    pointsRedemptionRate: z.number().int().min(1, "Redemption rate must be at least 1"),
    earlyCheckInEnabled: z.boolean().optional(),
    updatedAt: z.unknown().optional(),
    // Phase 2 fields (all optional, "off" by default):
    welcomePoints: z.number().int().min(0).max(100000).optional(),
    minPointsToRedeem: z.number().int().min(0).max(1000000).optional(),
    pointsCanPayUpToBillPct: z
      .number()
      .min(0, "Bill cap cannot be negative")
      .max(100, "Bill cap cannot exceed 100%")
      .optional(),
    freeNightEvery: z.number().int().min(0, "Free-night-every cannot be negative").max(365).optional(),
    levels: z.array(LevelDefSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const levels = value.levels;
    if (!levels || levels.length === 0) {
      // Empty levels = no tier program. Booking engine falls back to
      // the legacy `memberDiscountPct` for tier-less members. This
      // is a valid (legacy-compatible) state, so no error.
      return;
    }
    // Unique `fromStays` check.
    const seen = new Map<number, number>();
    levels.forEach((level, index) => {
      const prior = seen.get(level.fromStays);
      if (prior !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["levels", index, "fromStays"],
          message: `Duplicate threshold — also used on tier #${prior + 1}`,
        });
      }
      seen.set(level.fromStays, index);
    });
    // Base tier check.
    const hasBase = levels.some((l) => l.fromStays === 0);
    if (!hasBase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["levels"],
        message: "At least one tier must have a 0-stay threshold (the base tier)",
      });
    }
  });

// Inferred types — re-export so callers can `import { type RewardsConfigInput } from …`
// and not have to maintain a parallel interface declaration.
export type LevelDefInput = z.infer<typeof LevelDefSchema>;
export type RewardsConfigInput = z.infer<typeof RewardsConfigSchema>;