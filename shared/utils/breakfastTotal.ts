// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): the new meal-based breakfast
// model replaces the legacy flat-rate toggle. Each
// `breakfastSelections[key]` entry carries a snapshotted
// `price`; the total is the sum of every non-cancelled
// entry's snapshot price, rounded to 2 decimal places.
//
// This helper is the SINGLE SOURCE OF TRUTH for the
// `breakfastTotal` denormalization. The server calls it
// inside the same Firestore transaction as the
// `breakfastSelections` update (per GOTCHAS §Firebase —
// the client never writes `breakfastTotal`, and the
// server recompute happens at the write boundary).
//
// Defensive coercion matches the existing
// `calculateBookingTotal` / `calculateDiscountChain`
// pattern: nullish / non-finite / negative prices are
// skipped (the same permissive shape used for the EXB
// / CHD / DSC surface flags). Per BR-08 / Open Item #9
// the read path also tolerates a missing
// `breakfastSelections` field — `recomputeBreakfastTotal`
// returns 0 in that scenario so legacy / empty bookings
// render the same total.

import type { BreakfastSelectionEntry } from "../types";

/**
 * Recompute the denormalized `breakfastTotal` for a booking.
 *
 * Iterates every entry in `selections`, skips entries whose
 * `removedAt` is non-null (cancelled meals per the spec),
 * skips entries whose `price` is not a finite non-negative
 * number, then sums the rest and rounds to 2 decimal places
 * (`Math.round(x * 100) / 100`, matching the existing 2dp
 * rounding pattern in `shared/utils/bookingFolio.ts`).
 *
 * Returns `0` for `null` / `undefined` / empty input —
 * legacy / never-had-breakfast bookings land at 0 so the
 * balance math (`totalPrice + breakfastTotal - paidAmount`)
 * stays byte-equivalent to the pre-BR-01 path.
 *
 * @param selections The `breakfastSelections` map from a
 *   booking doc (or `null` / `undefined` for legacy bookings).
 * @returns The 2dp-rounded sum of every non-cancelled
 *   snapshot price. Never negative.
 */
export function recomputeBreakfastTotal(
  selections: Record<string, BreakfastSelectionEntry> | undefined | null
): number {
  if (!selections) return 0;
  let total = 0;
  for (const key in selections) {
    if (!Object.prototype.hasOwnProperty.call(selections, key)) continue;
    const entry = selections[key];
    if (!entry) continue;
    // Cancelled selections (a guest / staff removed the meal
    // before the cutoff) are excluded from the total. The
    // removal may have opened a refund liability (BR-06) but
    // it does NOT count toward the running balance.
    if (entry.removedAt !== null && entry.removedAt !== undefined) continue;
    const price = entry.price;
    // Defensive coercion: nullish / NaN / Infinity / negative
    // prices are skipped (matches the per-class permissive
    // pattern used for EXB / CHD / DSC). A 0 price is
    // allowed (a free promotional meal still occupies the
    // slot but contributes nothing to the total).
    if (typeof price !== "number") continue;
    if (!Number.isFinite(price)) continue;
    if (price < 0) continue;
    total += price;
  }
  // Round to 2dp to absorb floating-point drift across many
  // summed entries. Same rounding as
  // `roundToTwoDecimals` in `shared/utils/bookingFolio.ts`.
  return Math.round(total * 100) / 100;
}