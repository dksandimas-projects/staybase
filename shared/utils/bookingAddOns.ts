// Per EXB-02 (2026-07-31): single source of truth for the breakfast
// add-on math. The historical shape had the `breakfastRate × numGuests × numNights`
// expression duplicated across at least 10 sites (admin + server +
// Reports + rate-breakdown + pricing.ts), each with slightly
// different defensive patterns (`(x || 0)`, `nonNegativeFinite`,
// `Number(x) || 0`, the `hasBreakfast ? ... : 0` ternary, the
// `manualNightlyRate === null` guard). Client and server agreed
// by discipline, not by construction. The CHD-10 (children-in-breakfast
// per CVQ-01) and EXB-02 (extra-bed add-on) follow-up items will
// extend the add-on stack with a second term; the math lives in
// one place here, so the change is one PR instead of ten.
//
// Pure refactor with zero behavior change — pinned by
// `shared/__tests__/booking-addons.test.ts`.

export interface BreakfastAddOnInput {
  /** `false` (or undefined / null) short-circuits to 0. */
  hasBreakfast?: boolean | null;
  /** Per-person-per-night rate; nullish / zero short-circuits to 0. */
  breakfastRate?: number | null;
  /** Number of guests; nullish / zero short-circuits to 0. */
  numGuests?: number | null;
  /** Number of nights; nullish / zero short-circuits to 0. */
  numNights?: number | null;
}

/**
 * Compute the breakfast add-on total for a booking. Returns 0
 * unless the booking actually has breakfast, all three operands
 * are positive, and `hasBreakfast === true`. The function is
 * byte-equivalent to the historical inline patterns
 * (`(hasBreakfast ? breakfastRate * numGuests * numNights : 0)`,
 * `nonNegativeFinite(breakfastRate) * nonNegativeFinite(numGuests) * nights`,
 * etc.) — the defensive coercion is unified here.
 */
export function calculateBreakfastAddOn(input: BreakfastAddOnInput): number {
  if (!input.hasBreakfast) return 0;
  const rate = Number(input.breakfastRate) || 0;
  const guests = Number(input.numGuests) || 0;
  const nights = Number(input.numNights) || 0;
  if (rate === 0 || guests === 0 || nights === 0) return 0;
  return rate * guests * nights;
}
