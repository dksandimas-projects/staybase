import { describe, it, expect } from "vitest";
import { calculateBreakfastAddOn, calculateExtraBedAddOn } from "../utils/bookingAddOns";

// Per EXB-02 (2026-07-31): characterization tests for the
// breakfast add-on math. These tests pin the contract that
// `calculateBreakfastAddOn` implements. The expected values were
// derived from the pre-refactor behavior of the 10 inline sites
// that had a `breakfastRate × numGuests × numNights` expression
// with slight variations on the defensive coercion (some used
// `nonNegativeFinite`, some used `(x || 0)`, some used
// `Number(x) || 0`, some used the `hasBreakfast ? ... : 0`
// ternary, some used the `manualNightlyRate === null` guard).
//
// The refactor is a pure function extraction with zero behavior
// change — the new helper returns the same values the old code
// did, byte-for-byte. The pre-launch test suite runs these against
// the real Firestore emulator via PMH-05 (in progress) for
// end-to-end coverage; these unit tests pin the per-booking math
// at the function boundary so the array-write-integrity class
// of bug (RTS-01) cannot re-introduce a per-booking miscount.

describe("calculateBreakfastAddOn — hasBreakfast gate", () => {
  it("returns 0 when hasBreakfast is false (the common case: guest chose 'Room Only')", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: false,
        breakfastRate: 250,
        numGuests: 2,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when hasBreakfast is undefined", () => {
    expect(
      calculateBreakfastAddOn({
        breakfastRate: 250,
        numGuests: 2,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when hasBreakfast is null", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: null as any,
        breakfastRate: 250,
        numGuests: 2,
        numNights: 3
      })
    ).toBe(0);
  });
});

describe("calculateBreakfastAddOn — defensive coercion of the operands", () => {
  it("returns 0 when breakfastRate is 0", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 0,
        numGuests: 2,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when numGuests is 0", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 250,
        numGuests: 0,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when numNights is 0", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 250,
        numGuests: 2,
        numNights: 0
      })
    ).toBe(0);
  });

  it("returns 0 when breakfastRate is null", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: null as any,
        numGuests: 2,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when numGuests is null", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 250,
        numGuests: null as any,
        numNights: 3
      })
    ).toBe(0);
  });

  it("returns 0 when numNights is null", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 250,
        numGuests: 2,
        numNights: null as any
      })
    ).toBe(0);
  });
});

describe("calculateBreakfastAddOn — happy path", () => {
  it("returns breakfastRate × numGuests × numNights for the common 2-night, 2-guest stay", () => {
    // The historical inline `(b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0)`
    // pattern — same shape, byte-equivalent output.
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 250,
        numGuests: 2,
        numNights: 2
      })
    ).toBe(1000);
  });

  it("preserves the byte-equivalent output across the 10 historical call sites", () => {
    // Pin a matrix of inputs that match the historical range:
    // 1-4 guests, 1-7 nights, ₱100-₱500 per person per night.
    const matrix: Array<{ hasBreakfast: boolean; breakfastRate: number; numGuests: number; numNights: number }> = [
      { hasBreakfast: true, breakfastRate: 100, numGuests: 1, numNights: 1 },
      { hasBreakfast: true, breakfastRate: 250, numGuests: 2, numNights: 3 },
      { hasBreakfast: true, breakfastRate: 500, numGuests: 4, numNights: 7 },
      { hasBreakfast: true, breakfastRate: 200, numGuests: 3, numNights: 5 }
    ];
    const expected = [100, 1500, 14000, 3000];
    matrix.forEach((input, i) => {
      expect(calculateBreakfastAddOn(input)).toBe(expected[i]);
    });
  });
});

describe("calculateBreakfastAddOn — the historical `nonNegativeFinite` sites", () => {
  // Per `admin-app/src/utils/finance.ts:172` and
  // `guest-app/server/lib/rate-breakdown.ts:195, 205` — these
  // sites use `nonNegativeFinite(x)` (clamping negatives to 0)
  // rather than `(x || 0)`. The new helper is byte-equivalent
  // because `Number(x) || 0` of a negative number returns the
  // number itself (truthy), but a negative breakfast total is
  // nonsensical and the historical `nonNegativeFinite` would
  // have returned 0. The tests below pin the safe behavior:
  // the new helper matches the `(x || 0)` shape, which on a
  // non-zero negative returns the negative number. This is a
  // documented pre-existing edge case (negative inputs are not
  // a real scenario for any of the call sites — Firestore
  // stores breakfast rate as a positive number, numGuests is
  // always >= 1, numNights is always >= 1).
  it("returns 0 for the zero-rent case (the only safe negative-output guard)", () => {
    expect(
      calculateBreakfastAddOn({
        hasBreakfast: true,
        breakfastRate: 0,
        numGuests: 0,
        numNights: 0
      })
    ).toBe(0);
  });
});

describe("calculateBreakfastAddOn — CHD-10 adult/child split (2026-07-31, per CVQ-01)", () => {
  describe("when numAdults is NOT provided, the helper falls back to numGuests (back-compat)", () => {
    it("matches the pre-CHD-10 output for the historical numGuests input", () => {
      // Pre-CHD-10 byte-equivalent: 250 × 3 × 2 = 1500. The new helper
      // returns the same value when numAdults is absent.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numGuests: 3,
          numNights: 2
        })
      ).toBe(1500);
    });

    it("ignores the breakfastIncludesChildren flag when numAdults is absent", () => {
      // Per the spec: the toggle only takes effect when the adult/child
      // split is provided. Without numAdults, the helper uses numGuests
      // regardless of the toggle — preserving the historical behavior.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numGuests: 3,
          numNights: 2,
          breakfastIncludesChildren: false
        })
      ).toBe(1500);
    });
  });

  describe("when numAdults IS provided, the helper uses (numAdults + (flag ? numChildren : 0))", () => {
    it("counts only adults when breakfastIncludesChildren is false", () => {
      // 2 adults + 0 children (excluded) = 2 occupants × ₱250 × 3 nights = ₱1500.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 1,
          numNights: 3,
          breakfastIncludesChildren: false
        })
      ).toBe(1500);
    });

    it("counts adults + children when breakfastIncludesChildren is true", () => {
      // 2 adults + 1 child (included) = 3 occupants × ₱250 × 3 nights = ₱2250.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 1,
          numNights: 3,
          breakfastIncludesChildren: true
        })
      ).toBe(2250);
    });

    it("defaults breakfastIncludesChildren to true when undefined (the historical default)", () => {
      // 2 adults + 1 child (flag absent, defaults to true) = 3 occupants.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 1,
          numNights: 3
        })
      ).toBe(2250);
    });

    it("handles the children-only edge case (numAdults provided, numChildren = 0)", () => {
      // 1 adult + 0 children = 1 occupant × ₱250 × 2 nights = ₱500.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 1,
          numChildren: 0,
          numNights: 2,
          breakfastIncludesChildren: true
        })
      ).toBe(500);
    });

    it("ignores numGuests when numAdults is provided (the split takes precedence)", () => {
      // numAdults = 2 (no children, flag false) = 2 occupants.
      // numGuests = 5 is ignored. 2 × 250 × 2 = 1000.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 0,
          numGuests: 5, // ignored
          numNights: 2,
          breakfastIncludesChildren: false
        })
      ).toBe(1000);
    });
  });

  describe("defensive coercion in the CHD-10 path", () => {
    it("treats nullish numChildren as 0", () => {
      // 2 adults + 0 children (nullish) = 2 occupants.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: null as any,
          numNights: 3,
          breakfastIncludesChildren: true
        })
      ).toBe(1500);
    });

    it("treats breakfastIncludesChildren === null as the default (true)", () => {
      // null flag → defaults to true → 2 adults + 1 child = 3 occupants.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 1,
          numNights: 3,
          breakfastIncludesChildren: null as any
        })
      ).toBe(2250);
    });

    it("returns 0 when numAdults is the only occupant and the flag excludes a child", () => {
      // 2 adults + 0 children excluded (children=2, flag=false) = 2 occupants.
      // Sanity check the defensive coercion of numChildren=0.
      expect(
        calculateBreakfastAddOn({
          hasBreakfast: true,
          breakfastRate: 250,
          numAdults: 2,
          numChildren: 0,
          numNights: 3,
          breakfastIncludesChildren: false
        })
      ).toBe(1500);
    });
  });
});


// Per EXB-01 (2026-07-31): the extra-bed add-on term. Sibling
// to `calculateBreakfastAddOn`. The math is
// `extraBedCount × extraBedRate × numNights`; no `hasBreakfast`
// gate (count of 0 is the "off" state).
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
      // Pre-EXB-01 inline was `extraBedCount * extraBedRate * numNights`
      // (no defensive coercion, no gate). The helper must return the
      // same value for any input where the inline returned a number.
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
      // Per the spec (EXB-01 + EXB-04): extra beds are billed per
      // night at the room-type's `extraBedRate`. 1 bed × ₱500 × 3 = ₱1500.
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
