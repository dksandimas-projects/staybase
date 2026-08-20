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
// bookings without the field render the same total.
//
// Per EXB-01 (2026-07-31): a sibling helper `calculateExtraBedAddOn`
// for the extra-bed add-on term. The math is
// `extraBedCount × extraBedRate × numNights` — no `hasBreakfast`-style
// gate (a count of 0 is the "off" state). Nullish / 0 inputs short-
// circuit to 0. Same defensive `Number(x) || 0` per operand.
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
  /**
   * Per EXB-12 (2026-08-06, per decision #199): the number of
   * extra beds the guest is renting in this room. Only counted
   * toward the breakfast total when `extraBedBreakfast` is truthy.
   * Nullish / zero short-circuits to 0. The `extraBedCount` is
   * the BED count, not the person count — the breakfast is per
   * person, but the extra bed is per bed. The user opts in
   * separately via the `extraBedBreakfast` toggle.
   */
  extraBedCount?: number | null;
  /**
   * Per EXB-12 (2026-08-06, per decision #199): whether the
   * guest wants breakfast for the extra-bed occupant(s). When
   * `true`, all extra beds in the room are counted toward the
   * breakfast total (priced as `breakfastRate × extraBedCount × nights`).
   * `undefined` / `false` → no extra-bed breakfast. The server
   * validates that `extraBedBreakfast` can only be `true` when
   * `extraBedCount > 0`.
   */
  extraBedBreakfast?: boolean | null;
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
  // Per EXB-12 (2026-08-06, per decision #199): when the user opts
  // in to breakfast for the extra beds, all `extraBedCount` beds
  // are counted toward the breakfast total. The extra bed is a
  // physical bed; the breakfast is per person. The user opts in
  // explicitly via the `extraBedBreakfast` toggle (no surprise
  // charges). When the toggle is off, the extra beds are NOT
  // counted — the user pays for the extra bed but not the
  // breakfast. Nullish / zero `extraBedCount` short-circuits to 0.
  if (input.extraBedBreakfast) {
    const extraBedCount = Number(input.extraBedCount) || 0;
    effectiveOccupancy += extraBedCount;
  }
  if (effectiveOccupancy === 0) return 0;
  return rate * effectiveOccupancy * nights;
}

// Per EXB-01 (2026-07-31): the extra-bed add-on term. Sibling to
// `calculateBreakfastAddOn` — same defensive coercion, no
// `hasBreakfast`-style gate (a count of 0 is the "off" state).
// The room type owns `maxExtraBeds` + `extraBedRate`; the booking
// snapshotted `extraBedRate` at create time so a later rate change
// never rewrites an existing bill. Per-night math
// (`rate × count × nights`) mirrors the breakfast helper.
export interface ExtraBedAddOnInput {
  /** Number of extra beds (0..maxExtraBeds). Nullish / 0 short-circuits to 0. */
  extraBedCount?: number | null;
  /** Per-bed-per-night rate. Nullish / 0 short-circuits to 0. */
  extraBedRate?: number | null;
  /** Number of nights. Nullish / 0 short-circuits to 0. */
  numNights?: number | null;
}

export function calculateExtraBedAddOn(input: ExtraBedAddOnInput): number {
  const count = Number(input.extraBedCount) || 0;
  const rate = Number(input.extraBedRate) || 0;
  const nights = Number(input.numNights) || 0;
  if (count === 0 || rate === 0 || nights === 0) return 0;
  return count * rate * nights;
}
