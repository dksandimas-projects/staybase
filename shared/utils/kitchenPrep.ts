// Per F-B3 (2026-10-27): build the Daily Kitchen Prep counts.
//
// THE DEFECT
// ----------
//   The Reports → "Daily Kitchen Prep" panel derived its dates from
//   the booking's `checkIn + numNights` window and then kept only the
//   slots whose service date fell inside it:
//
//     for (let i = 0; i < b.numNights; i++) {
//       const dateStr = checkIn + i;
//       if (!dateMap[dateStr]) dateMap[dateStr] = {};   // creates an EMPTY date
//       for (const slot of normalized.slots.values()) {
//         if (slot.serviceDate !== dateStr) continue;   // DROPS other slots
//         ...count the meal...                          // no removedAt filter
//       }
//     }
//
//   Three wrong answers, all measured against production on
//   2026-10-27:
//
//     * a slot dated OUTSIDE the stay was dropped — the guest had a
//       breakfast the kitchen never saw;
//     * a slot CANCELLED before the cut-off (`removedAt`) was still
//       counted — the kitchen cooked meals nobody would eat;
//     * a date with no matching slot was listed as an EMPTY row.
//
//   The old logic counted 28 meals across 15 dates; the slot-driven
//   logic counts 23 meals across 13 dates.
//
//   The server's own kitchen list
//   (`/api/bookings/breakfast/kitchen-list`) ALREADY filtered
//   `removedAt` and read the slot keys, so the report contradicted the
//   list the kitchen actually works from.
//
// WHY A SHARED HELPER
// -------------------
//   The counting is pure presentation logic with no React and no
//   server dependency, so it lives in `shared/` where the test can
//   import the SAME code the panel runs. A test that re-implements
//   the logic proves nothing about the product.
//
//   The slot keys are the source of truth: the booking's `checkIn` and
//   `numNights` describe the STAY, while the slot keys describe the
//   MEALS the guest actually has.

import { normalizeBreakfastSelections } from "./breakfastSlotKey";

export interface DailyKitchenPrep {
  /** The service dates that have at least one meal, ascending. */
  dates: string[];
  /** Every meal name across every date. */
  items: string[];
  /** date -> meal name -> how many to prepare. */
  counts: Record<string, Record<string, number>>;
}

/**
 * Build the Daily Kitchen Prep counts from the bookings that carry
 * breakfast selections.
 *
 * @param bookings  The bookings to summarise. Each may carry
 *        `breakfastSelections` and `numGuests`.
 */
export function buildDailyKitchenPrep(bookings: any[]): DailyKitchenPrep {
  const dateMap: Record<string, Record<string, number>> = {};

  for (const b of bookings || []) {
    const selections = (b as any)?.breakfastSelections;
    if (!selections || typeof selections !== "object") continue;

    // Per BR-07-P1 (2026-10-22): the selections are resolved into the
    // CANONICAL 0-based slot space through the shared normaliser, so
    // the legacy bare (`<date>-N`) and legacy 1-based
    // (`<date>-guest-N`) key forms count too.
    const normalized = normalizeBreakfastSelections(
      selections as Record<string, any>,
      (b as any).numGuests
    );

    for (const slot of normalized.slots.values()) {
      // The cancellation gate: a slot removed before the cut-off is
      // not a meal to prepare. (The server's kitchen list applies the
      // same rule.)
      const raw: any = slot.entry;
      if (raw && typeof raw === "object" && raw.removedAt != null) continue;

      // The slot's own service date is the key — NOT the stay's
      // `checkIn + numNights` window.
      const dateStr = slot.serviceDate;
      if (!dateStr) continue;

      // Per BR-05 (2026-10-13): the entry may be the legacy
      // `Record<string, string>` shape (meal name as the value) or the
      // BR-01 rich shape (`{ mealId, mealName, price, ... }`).
      const mealName =
        typeof raw === "string"
          ? raw
          : typeof raw?.mealName === "string"
          ? raw.mealName
          : null;
      if (!mealName) continue;

      if (!dateMap[dateStr]) dateMap[dateStr] = {};
      dateMap[dateStr][mealName] = (dateMap[dateStr][mealName] || 0) + 1;
    }
  }

  const sortedDates = Object.keys(dateMap).sort();
  const allItems = new Set<string>();
  for (const date of sortedDates) {
    Object.keys(dateMap[date]).forEach((item) => allItems.add(item));
  }
  return { dates: sortedDates, items: Array.from(allItems), counts: dateMap };
}
