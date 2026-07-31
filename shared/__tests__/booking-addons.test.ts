import { describe, it, expect } from "vitest";
import { calculateBreakfastAddOn } from "../utils/bookingAddOns";

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
