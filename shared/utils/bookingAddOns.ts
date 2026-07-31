// Per EXB-02 (2026-07-31): single source of truth for the breakfast
// add-on math. The historical shape had the `breakfastRate × numGuests × numNights`
// expression duplicated across at least 10 sites (admin + server +
// Reports + rate-breakdown + pricing.ts), each with slightly
// different defensive patterns (`(x || 0)`, `nonNegativeFinite`,
// `Number(x) || 0`, the `hasBreakfast ? ... : 0` ternary, the
// `manualNightlyRate === null` guard). Client and server agreed
// by discipline, not by construction.
//
// Per CHD-10 (2026-07-31, per CVQ-01): the helper now accepts an
// optional `numAdults` + `numChildren` split + a `breakfastIncludesChildren`
// flag. When the split is provided, the math is
// `rate × (numAdults + (breakfastIncludesChildren ? numChildren : 0)) × nights`.
// When only `numGuests` is provided (the historical shape), the helper
// falls back to `rate × numGuests × nights` — byte-equivalent to today.
// `breakfastIncludesChildren` defaults to `true` when undefined, matching
// the historical "children pay the full rate" default so existing
// bookings without the field render the same total. EXB-01..10 (extra
// bed) will extend the add-on stack with a third term; the math lives
// in one place here, so the change is one PR instead of ten.
//
// Pinned by `shared/__tests__/booking-addons.test.ts`.

export interface BreakfastAddOnInput {
  /** `false` (or undefined / null) short-circuits to 0. */
  hasBreakfast?: boolean | null;
  /** Per-person-per-night rate; nullish / zero short-circuits to 0. */
  breakfastRate?: number | null;
  /**
   * Total occupancy. Used when `numAdults` is not provided (the
   * historical shape). Nullish / zero short-circuits to 0. When
   * `numAdults` IS provided, this is ignored and the helper uses
   * `(numAdults + (breakfastIncludesChildren ? numChildren : 0))`.
   */
  numGuests?: number | null;
  /**
   * Per CHD-10 (2026-07-31): the number of adult guests (12+). When
   * provided, takes precedence over `numGuests` for the math —
   * children are counted separately via `numChildren`. Nullish /
   * zero falls back to `numGuests` (the historical path).
   */
  numAdults?: number | null;
  /**
   * Per CHD-10 (2026-07-31): the number of child guests (0–11).
   * Only counted toward the breakfast total when `breakfastIncludesChildren`
   * is truthy AND `numAdults` is provided. Ignored when `numAdults`
   * is nullish (the historical path uses `numGuests`).
   */
  numChildren?: number | null;
  /**
   * Per CHD-10 (2026-07-31, per CVQ-01): whether children are included
   * in the breakfast charge. Snapshotted from the admin default
   * (`settings/breakfastConfig.breakfastIncludesChildrenDefault`) at
   * booking time. `undefined` defaults to `true` for back-compat with
   * the historical "children pay the full rate" math.
   */
  breakfastIncludesChildren?: boolean | null;
  /** Number of nights; nullish / zero short-circuits to 0. */
  numNights?: number | null;
}

/**
 * Compute the breakfast add-on total for a booking. Returns 0
 * unless the booking actually has breakfast, the rate + nights
 * are positive, and the effective occupancy is positive.
 *
 * **Per CHD-10 (2026-07-31, per CVQ-01)**: when `numAdults` is
 * provided, the effective occupancy is
 * `(numAdults + (breakfastIncludesChildren ? numChildren : 0))`.
 * Otherwise the helper falls back to `numGuests` (the historical
 * shape, byte-equivalent to the pre-CHD-10 inline patterns).
 * `breakfastIncludesChildren` defaults to `true` when undefined,
 * matching the historical "children pay the full rate" default.
 */
export function calculateBreakfastAddOn(input: BreakfastAddOnInput): number {
  if (!input.hasBreakfast) return 0;
  const rate = Number(input.breakfastRate) || 0;
  const nights = Number(input.numNights) || 0;
  if (rate === 0 || nights === 0) return 0;
  // Per CHD-10: when the adult/child split is provided, count only
  // adults + (optionally) children. Otherwise fall back to numGuests
  // (the historical path). `breakfastIncludesChildren` defaults to
  // `true` when undefined so existing callers keep producing the
  // same byte-equivalent output.
  const numAdults = Number(input.numAdults);
  const useSplit = Number.isFinite(numAdults) && numAdults > 0;
  let effectiveOccupancy: number;
  if (useSplit) {
    const numChildren = Number(input.numChildren) || 0;
    const includesChildren = input.breakfastIncludesChildren !== false; // nullish defaults to true
    effectiveOccupancy = numAdults + (includesChildren ? numChildren : 0);
  } else {
    effectiveOccupancy = Number(input.numGuests) || 0;
  }
  if (effectiveOccupancy === 0) return 0;
  return rate * effectiveOccupancy * nights;
}
