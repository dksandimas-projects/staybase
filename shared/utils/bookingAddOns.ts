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
//
// Per BR-08 (decision #238, 2026-10-14 — close-out): the
// legacy flat-rate `calculateBreakfastAddOn` helper +
// `BreakfastAddOnInput` type are deleted. The new meal-based
// model is the single source of truth —
// `calculateBreakfastMealsTotal` (below) sums the
// snapshotted per-meal prices from
// `booking.breakfastSelections[key].price`. See
// `plan/features/BREAKFAST.md §Decisions Locked` (decision
// 1 — "no migration, the old fields are deleted from the
// create path") + (decision 5 — Step 1 carries no breakfast
// data). The 71 unit tests that targeted the legacy helper
// are migrated to the new helper in `shared/__tests__/`.

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

// Per BR-01 (Phase 13 — Breakfast Redesign, decision #231,
// 2026-10-12): the new meal-based model. Wraps
// `recomputeBreakfastTotal` for callers that have a
// `breakfastSelections` map on hand (the booking-create path
// in BR-03, the rate breakdown rebuilder, the email view).
// Internal-only — the public Step 2 + Manage Booking pages
// call this directly with the snapshot map returned by
// `/api/bookings/breakfast/config` or the booking doc read.
//
// Defensive coercion is delegated to
// `recomputeBreakfastTotal`; this wrapper exists so the
// `bookingAddOns.ts` import surface (the legacy "what's
// the breakfast term in the pricing chain" entry point)
// stays the single call site for both pre- and
// post-redesign helpers. The two helpers will converge
// in BR-08 (when BR-03's create path lands and the
// `@deprecated` `calculateBreakfastAddOn` is removed).
import type { BreakfastSelectionEntry } from "../types";
import { recomputeBreakfastTotal } from "./breakfastTotal";

/**
 * Sum the snapshotted prices in a `breakfastSelections`
 * map. Thin wrapper around `recomputeBreakfastTotal` for
 * the `bookingAddOns.ts` import surface.
 *
 * @param selections The `breakfastSelections` map (or
 *   null / undefined for legacy / never-had-breakfast
 *   bookings).
 * @returns 2dp-rounded sum of non-cancelled entries'
 *   `price` snapshots.
 */
export function calculateBreakfastMealsTotal(
  selections: Record<string, BreakfastSelectionEntry> | undefined | null
): number {
  return recomputeBreakfastTotal(selections);
}
