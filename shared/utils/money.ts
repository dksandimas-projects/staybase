// The single shared money-rounding rule.
//
// Per OCT-L3 (2026-10-20, decision #299): the other-add-on money path
// had drifted onto `Math.round(total)` (whole pesos) while breakfast
// used 2dp and the refund liability for the SAME selection was computed
// unrounded. A ₱499.99 add-on billed ₱500 but refunded ₱499.99.
//
// This module exists so that rule lives in ONE place. Before it, the
// 2dp pattern was inlined in three spots in `breakfastTotal.ts` and
// once more in `bookingFolio.ts`, which is exactly the shape that let
// the other-add-on path drift in the first place.
//
// **Store at 2dp, display at 0dp.** Both apps' `formatPrice` uses
// `maximumFractionDigits: 0`, so a ₱499.99 total has always rendered
// as "₱500" on screen. Rounding the STORED value to 2dp therefore
// changes no displayed amount — it only makes the stored total match
// the refund the guest is owed.

/**
 * Round a money amount to 2 decimal places.
 *
 * Non-finite input (NaN, Infinity, a non-numeric string) returns `0`
 * rather than propagating — a money path must never write NaN into a
 * booking doc.
 *
 * @example
 * roundToTwoDecimals(499.99)      // 499.99
 * roundToTwoDecimals(499.995)     // 500
 * roundToTwoDecimals(0.1 + 0.2)   // 0.3
 */
export function roundToTwoDecimals(value: number | string | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}
