import { describe, it, expect } from "vitest";
import * as BookingAddOnsModule from "../utils/bookingAddOns";
import { calculateBreakfastMealsTotal, calculateExtraBedAddOn } from "../utils/bookingAddOns";

// Per BR-08 (decision #238, 2026-10-14 — close-out): the
// legacy flat-rate `calculateBreakfastAddOn` helper was deleted
// from `shared/utils/bookingAddOns.ts` and replaced by the
// new meal-based `calculateBreakfastMealsTotal(selections)`
// helper (BR-01, decision #231, 2026-10-12). The pre-BR-08
// characterization tests that pinned the old
// `breakfastRate × numGuests × numNights` math are kept here
// as an audit-trail stub — the EXB-02 / CHD-10 / EXB-12
// expectations were derived from the pre-refactor behavior
// of the 10 inline sites that the legacy helper replaced.
//
// Per the BR-08 close-out acceptance criteria, the new
// `calculateBreakfastMealsTotal` helper is the single source
// of truth for the breakfast add-on total; the tests below
// pin the new helper's contract (sums of
// `breakfastSelections[key].price` snapshots, with cancelled
// meals excluded). The historical flat-rate contract is
// preserved by `recomputeBreakfastTotal` in
// `shared/utils/breakfastTotal.ts` — the per-meal prices
// summed by the new helper produce the same numeric output
// as the legacy helper for any input where every meal has
// the same price (the common case in production).

const MEAL_KEY = (date: string, guest: number) => `${date}-guest-${guest}`;

describe("calculateBreakfastMealsTotal — empty + nullish inputs", () => {
  it("returns 0 for an empty selections map", () => {
    expect(calculateBreakfastMealsTotal({})).toBe(0);
  });

  it("returns 0 for null / undefined", () => {
    expect(calculateBreakfastMealsTotal(null)).toBe(0);
    expect(calculateBreakfastMealsTotal(undefined)).toBe(0);
  });
});

describe("calculateBreakfastMealsTotal — happy path (BR-01: per-meal price snapshots)", () => {
  it("sums the per-meal `price` snapshots across the selections map", () => {
    // Two guests × 3 days × ₱250/meal = ₱1500.
    const selections = {
      [MEAL_KEY("2026-10-15", 1)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-15", 2)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-16", 1)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-16", 2)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-17", 1)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-17", 2)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null }
    };
    expect(calculateBreakfastMealsTotal(selections)).toBe(1500);
  });

  it("excludes cancelled meals (removedAt != null) from the total", () => {
    const selections: Record<string, any> = {
      [MEAL_KEY("2026-10-15", 1)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: "2026-10-15T00:00:00Z", removedBy: "guest", overrideCutoff: false, overrideReason: null },
      [MEAL_KEY("2026-10-15", 2)]: { mealId: "silog", mealName: "Silog", price: 250, addedAt: "2026-10-14", addedBy: "guest", lastModifiedAt: "2026-10-14", lastModifiedBy: "guest", removedAt: null, removedBy: null, overrideCutoff: false, overrideReason: null }
    };
    // 1 cancelled + 1 active × ₱250 = ₱250.
    expect(calculateBreakfastMealsTotal(selections)).toBe(250);
  });
});

describe("calculateBreakfastMealsTotal — BR-08 close-out tripwire", () => {
  it("exports calculateBreakfastMealsTotal but NOT the legacy calculateBreakfastAddOn (BR-08 close-out)", () => {
    const exports = Object.keys(BookingAddOnsModule);
    expect(exports).toContain("calculateBreakfastMealsTotal");
    expect(exports).not.toContain("calculateBreakfastAddOn");
    expect(exports).not.toContain("BreakfastAddOnInput");
  });
});

// Per EXB-01 (2026-07-31): the extra-bed add-on term. Sibling
// to the deleted `calculateBreakfastAddOn` — same defensive
// coercion, no `hasBreakfast`-style gate (a count of 0 is the
// "off" state). The extra-bed math is NOT affected by BR-08
// (the EXB flow is independent of the breakfast meal model).
describe("calculateExtraBedAddOn (EXB-01, 2026-07-31)", () => {
  describe("happy path — `count × rate × nights`", () => {
    it("returns the product for a positive count, rate, and nights", () => {
      // 1 bed × ₱500 × 2 nights = ₱1000.
      expect(
        calculateExtraBedAddOn({
          extraBedCount: 1,
          extraBedRate: 500,
          numNights: 2
        })
      ).toBe(1000);
    });

    it("matches the historical inline pattern byte-equivalently", () => {
      const cases: Array<[number, number, number]> = [
        [1, 500, 2],
        [2, 300, 3],
        [0, 500, 2],
        [1, 0, 2],
        [1, 500, 0]
      ];
      for (const [count, rate, nights] of cases) {
        expect(calculateExtraBedAddOn({ extraBedCount: count, extraBedRate: rate, numNights: nights }))
          .toBe(count * rate * nights);
      }
    });
  });

  describe("defensive coercion — nullish / NaN / 0 inputs", () => {
    it("returns 0 when count is 0 (the 'no extra bed' case)", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: 0, extraBedRate: 500, numNights: 3 })).toBe(0);
    });

    it("returns 0 when rate is 0 (the 'free' case — should not happen with a real rate)", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: 0, numNights: 3 })).toBe(0);
    });

    it("returns 0 when nights is 0", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: 500, numNights: 0 })).toBe(0);
    });

    it("treats nullish count as 0", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: null as any, extraBedRate: 500, numNights: 3 })).toBe(0);
      expect(calculateExtraBedAddOn({ extraBedCount: undefined, extraBedRate: 500, numNights: 3 })).toBe(0);
    });

    it("treats nullish rate as 0", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: null as any, numNights: 3 })).toBe(0);
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: undefined, numNights: 3 })).toBe(0);
    });

    it("treats nullish nights as 0", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: 500, numNights: null as any })).toBe(0);
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: 500, numNights: undefined })).toBe(0);
    });

    it("treats NaN inputs as 0", () => {
      expect(calculateExtraBedAddOn({ extraBedCount: NaN, extraBedRate: 500, numNights: 3 })).toBe(0);
      expect(calculateExtraBedAddOn({ extraBedCount: 1, extraBedRate: NaN, numNights: 3 })).toBe(0);
    });
  });

  describe("realistic chain scenarios", () => {
    it("matches the server's extra-bed line for a 1-bed, 3-night stay at ₱500/night", () => {
      expect(
        calculateExtraBedAddOn({
          extraBedCount: 1,
          extraBedRate: 500,
          numNights: 3
        })
      ).toBe(1500);
    });

    it("matches the server's extra-bed line for a 2-bed, 2-night stay at ₱300/night", () => {
      expect(
        calculateExtraBedAddOn({
          extraBedCount: 2,
          extraBedRate: 300,
          numNights: 2
        })
      ).toBe(1200);
    });
  });
});