import { describe, it, expect } from "vitest";
import { recomputeBreakfastTotal } from "../utils/breakfastTotal";
import { calculateBreakfastMealsTotal } from "../utils/bookingAddOns";
import type { BreakfastSelectionEntry } from "../types";

// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): characterization tests for the
// new meal-based breakfast total math. These tests pin
// the contract that `recomputeBreakfastTotal` (and its
// wrapper `calculateBreakfastMealsTotal`) implement.
//
// The expected values are derived from the spec rules
// (`plan/features/BREAKFAST.md §Data Model` + §Decisions
// Locked #9 — "snapshot is immutable"):
//   - sum the `price` of every entry whose
//     `removedAt === null` (cancelled meals are
//     excluded; the refund liability lives in BR-06)
//   - skip entries whose `price` is not a finite
//     non-negative number (defensive coercion matches
//     the EXB / CHD / DSC surface-flag rule)
//   - round to 2 decimal places (`Math.round(x * 100) / 100`)

const NOW_ISO = "2026-10-12T08:00:00.000Z";
const ACTOR_GUEST = "guest";
const ACTOR_STAFF = "staff-uid-1";

function makeEntry(overrides: Partial<BreakfastSelectionEntry> = {}): BreakfastSelectionEntry {
  return {
    mealId: "longsilog",
    mealName: "Longsilog",
    price: 350,
    addedAt: NOW_ISO,
    addedBy: ACTOR_GUEST,
    lastModifiedAt: NOW_ISO,
    lastModifiedBy: ACTOR_GUEST,
    removedAt: null,
    removedBy: null,
    overrideCutoff: false,
    overrideReason: null,
    ...overrides
  };
}

describe("recomputeBreakfastTotal — empty / null / undefined inputs", () => {
  it("returns 0 for an empty object", () => {
    expect(recomputeBreakfastTotal({})).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(recomputeBreakfastTotal(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(recomputeBreakfastTotal(undefined)).toBe(0);
  });

  it("returns 0 for an object whose only entry has a non-finite price", () => {
    expect(recomputeBreakfastTotal({ "2026-10-14-0": makeEntry({ price: NaN }) })).toBe(0);
  });
});

describe("recomputeBreakfastTotal — single + multiple active selections", () => {
  it("returns the single entry's price when one entry is active", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 350 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(350);
  });

  it("sums multiple active entries", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 350 }),
      "2026-10-14-1": makeEntry({ price: 250 }),
      "2026-10-15-0": makeEntry({ price: 400 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(1000);
  });

  it("treats a price of 0 as a free promotional meal (occupies a slot, contributes 0 to total)", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 0 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });
});

describe("recomputeBreakfastTotal — cancelled (removedAt !== null) entries", () => {
  it("excludes a single cancelled entry from the total", () => {
    const selections = {
      "2026-10-14-0": makeEntry({
        price: 350,
        removedAt: "2026-10-13T12:00:00.000Z",
        removedBy: ACTOR_GUEST
      })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });

  it("sums active entries only when a mix is present", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 350 }),
      "2026-10-14-1": makeEntry({
        price: 250,
        removedAt: "2026-10-13T12:00:00.000Z",
        removedBy: ACTOR_GUEST
      }),
      "2026-10-15-0": makeEntry({ price: 400 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(750);
  });

  it("returns 0 when every entry is cancelled", () => {
    const selections = {
      "2026-10-14-0": makeEntry({
        price: 350,
        removedAt: "2026-10-13T12:00:00.000Z",
        removedBy: ACTOR_GUEST
      }),
      "2026-10-14-1": makeEntry({
        price: 400,
        removedAt: "2026-10-13T13:00:00.000Z",
        removedBy: ACTOR_STAFF
      })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });
});

describe("recomputeBreakfastTotal — defensive price coercion", () => {
  it("skips an entry whose price is null", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: null as unknown as number })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });

  it("skips an entry whose price is undefined", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: undefined as unknown as number })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });

  it("skips an entry whose price is a negative number", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: -350 }),
      "2026-10-14-1": makeEntry({ price: 250 })
    };
    // Only the 250 entry counts; the -350 is excluded.
    expect(recomputeBreakfastTotal(selections)).toBe(250);
  });

  it("skips an entry whose price is NaN", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: NaN }),
      "2026-10-14-1": makeEntry({ price: 250 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(250);
  });

  it("skips an entry whose price is a string (defensive against legacy `Record<string,string>` shape)", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: "350" as unknown as number })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0);
  });
});

describe("recomputeBreakfastTotal — 2dp rounding", () => {
  it("rounds 0.005 + 0.005 to 0.01 (Math.round half-up behaviour)", () => {
    // 0.005 + 0.005 = 0.010000000000000002 in IEEE-754.
    // Math.round(0.010000000000000002 * 100) = 1.
    // 1 / 100 = 0.01. Pinned by the spec's 2dp rounding rule.
    const selections = {
      "2026-10-14-0": makeEntry({ price: 0.005 }),
      "2026-10-14-1": makeEntry({ price: 0.005 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0.01);
  });

  it("rounds a sum of 99.99 + 0.01 to 100.00 (no drift across many entries)", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 99.99 }),
      "2026-10-14-1": makeEntry({ price: 0.01 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(100);
  });

  it("rounds a sum of 0.1 + 0.2 to 0.30 (IEEE-754 drift absorption)", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 0.1 }),
      "2026-10-14-1": makeEntry({ price: 0.2 })
    };
    expect(recomputeBreakfastTotal(selections)).toBe(0.3);
  });
});

describe("calculateBreakfastMealsTotal — the bookingAddOns.ts wrapper", () => {
  it("returns 0 for null", () => {
    expect(calculateBreakfastMealsTotal(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(calculateBreakfastMealsTotal(undefined)).toBe(0);
  });

  it("sums multiple active entries identically to recomputeBreakfastTotal", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 350 }),
      "2026-10-14-1": makeEntry({ price: 250 })
    };
    expect(calculateBreakfastMealsTotal(selections)).toBe(
      recomputeBreakfastTotal(selections)
    );
  });

  it("excludes cancelled entries identically to recomputeBreakfastTotal", () => {
    const selections = {
      "2026-10-14-0": makeEntry({ price: 350 }),
      "2026-10-14-1": makeEntry({
        price: 250,
        removedAt: "2026-10-13T12:00:00.000Z",
        removedBy: ACTOR_GUEST
      })
    };
    expect(calculateBreakfastMealsTotal(selections)).toBe(350);
  });
});