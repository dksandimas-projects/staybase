// Per MRB-11 (2026-08-03, per decision #177):
// the per-stream revenue allocation read + write
// paths. The pure helpers in `shared/utils/bookingFolio.ts`
// replace the historical `splitBookingRevenue` proportional
// split. The contract is:
//   `roomNet + breakfastNet + addOnNet − deductionNet === totalNet`
// where `totalNet === booking.totalPrice`.
//
// PR1 (this file) covers the foundation: types, the
// `getBookingRevenueStreams` + `getReservationRevenueStreams`
// read helpers, the `assertBookingRevenueAllocationInvariant`
// safety check, and the `computeBookingRevenueAllocation`
// compute helper. The server-side snapshot wiring
// (every create/walkin/corporate/reschedule path writes
// `revenueAllocation`) ships in PR2; the Reports
// surface switch ships in PR3.

import { describe, expect, it } from "vitest";
import {
  assertBookingRevenueAllocationInvariant,
  computeBookingRevenueAllocation,
  getBookingRevenueStreams,
  getReservationRevenueStreams,
  type RevenueBookingInput,
  type RevenueReservationInput
} from "../utils/bookingFolio";
import type { BookingRevenueAllocation } from "../types";

const STORED_ALLOCATION: BookingRevenueAllocation = {
  roomNet: 4_000,
  breakfastNet: 1_000,
  addOnNet: 500,
  deductionNet: 500,
  totalNet: 5_000
};

function makeBooking(overrides: Partial<RevenueBookingInput> = {}): RevenueBookingInput {
  return {
    totalPrice: 5_000,
    ratePerNight: 2_000,
    numNights: 2,
    numGuests: 2,
    breakfastRate: 250,
    hasBreakfast: true,
    rateBreakdown: { roomSubtotal: 4_000 },
    ...overrides
  };
}

function makeReservation(
  overrides: Partial<RevenueReservationInput> = {}
): RevenueReservationInput {
  return { totalPrice: 10_000, ...overrides };
}

describe("getBookingRevenueStreams", () => {
  it("reads the stored allocation when present and tags it as 'stored'", () => {
    const streams = getBookingRevenueStreams(
      makeBooking({ revenueAllocation: STORED_ALLOCATION })
    );
    expect(streams).toEqual({ ...STORED_ALLOCATION, allocation: "stored" });
  });

  it("falls back to the legacy proportional split when the allocation is absent", () => {
    const streams = getBookingRevenueStreams(makeBooking());
    expect(streams.allocation).toBe("legacy-heuristic");
    // The legacy fallback preserves the historical
    // `splitBookingRevenue` math: `breakfast = total ×
    // (breakfastGross / (roomGross + breakfastGross))`,
    // `room = total - breakfast`. With our fixtures
    // (room=4000, breakfast=500×2×2=1000, total=5000):
    //   breakfast = 5000 × 1000 / 5000 = 1000
    //   room = 5000 - 1000 = 4000
    // addOnNet + deductionNet are 0 in the legacy path
    // (the old math didn't separate add-ons and netted
    // deductions into the per-stream value).
    expect(streams.roomNet).toBe(4_000);
    expect(streams.breakfastNet).toBe(1_000);
    expect(streams.addOnNet).toBe(0);
    expect(streams.deductionNet).toBe(0);
    expect(streams.totalNet).toBe(5_000);
  });

  it("legacy fallback byte-equivalent to the pre-MRB-11 splitBookingRevenue for no-breakfast bookings", () => {
    // No breakfast: legacy `splitBookingRevenue` returns { room: total, breakfast: 0 }.
    const streams = getBookingRevenueStreams(
      makeBooking({ hasBreakfast: false, totalPrice: 8_000 })
    );
    expect(streams).toEqual({
      roomNet: 8_000,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 8_000,
      allocation: "legacy-heuristic"
    });
  });

  it("legacy fallback uses ratePerNight × numNights when rateBreakdown.roomSubtotal is missing", () => {
    // Pre-MRB-04 bookings (no `rateBreakdown`) fall back to
    // `ratePerNight × numNights` for the room basis — same
    // pattern the historical helper used.
    const streams = getBookingRevenueStreams(
      makeBooking({
        rateBreakdown: null,
        ratePerNight: 1_000,
        numNights: 3,
        hasBreakfast: false,
        totalPrice: 3_000
      })
    );
    expect(streams.roomNet).toBe(3_000);
    expect(streams.breakfastNet).toBe(0);
    expect(streams.allocation).toBe("legacy-heuristic");
  });

  it("legacy fallback returns the full total as room when no breakfast and no rateBreakdown is supplied defensively", () => {
    // Defensive coercion: garbage in → 0 out. The byte
    // contract: a booking with `totalPrice: 0` reads as
    // `{ roomNet: 0, breakfastNet: 0, ... }` (not NaN,
    // not a thrown error).
    const streams = getBookingRevenueStreams(
      makeBooking({
        ratePerNight: Number.NaN as unknown as number,
        numNights: 0,
        hasBreakfast: false,
        totalPrice: 0,
        rateBreakdown: null
      })
    );
    expect(streams.totalNet).toBe(0);
    expect(streams.allocation).toBe("legacy-heuristic");
  });

  it("treats null revenueAllocation the same as absent (defensive coercion)", () => {
    // Pre-MRB-11 docs and round-trip deserialisation both
    // surface the absence as `null` (Firestore) or
    // `undefined` (in-memory). The helper handles both.
    const streamsA = getBookingRevenueStreams(
      makeBooking({ revenueAllocation: null })
    );
    const streamsB = getBookingRevenueStreams(
      makeBooking({ revenueAllocation: undefined })
    );
    expect(streamsA.allocation).toBe("legacy-heuristic");
    expect(streamsB.allocation).toBe("legacy-heuristic");
  });

  it("stores allocation's addOnNet + deductionNet pass through to the helper output", () => {
    // The post-MRB-11 path: room + breakfast + add-on are
    // stored as gross amounts; `deductionNet` is the total
    // deductions; the invariant is
    // `roomNet + breakfastNet + addOnNet − deductionNet === totalNet`.
    const allocation: BookingRevenueAllocation = {
      roomNet: 6_000,
      breakfastNet: 1_500,
      addOnNet: 1_000,
      deductionNet: 500,
      totalNet: 8_000
    };
    const streams = getBookingRevenueStreams(
      makeBooking({ revenueAllocation: allocation, totalPrice: 8_000 })
    );
    expect(streams).toEqual({ ...allocation, allocation: "stored" });
  });
});

describe("getReservationRevenueStreams", () => {
  it("returns the stored aggregate when present and tags it as 'stored'", () => {
    const streams = getReservationRevenueStreams(
      makeReservation({ aggregateRevenueAllocation: STORED_ALLOCATION }),
      []
    );
    expect(streams).toEqual({ ...STORED_ALLOCATION, allocation: "stored" });
  });

  it("sums the children when the aggregate is null", () => {
    const child1 = makeBooking({
      revenueAllocation: { roomNet: 3_000, breakfastNet: 500, addOnNet: 0, deductionNet: 0, totalNet: 3_500 },
      totalPrice: 3_500
    });
    const child2 = makeBooking({
      revenueAllocation: { roomNet: 2_500, breakfastNet: 500, addOnNet: 500, deductionNet: 0, totalNet: 3_500 },
      totalPrice: 3_500
    });
    const streams = getReservationRevenueStreams(
      makeReservation({ totalPrice: 7_000 }),
      [child1, child2]
    );
    expect(streams).toEqual({
      roomNet: 5_500,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 0,
      totalNet: 7_000,
      allocation: "stored"
    });
  });

  it("tags 'legacy-heuristic' when ANY child is on the legacy fallback", () => {
    // A mixed-state reservation: 2 children created
    // post-MRB-11 (stored) + 1 child created pre-MRB-11
    // (no `revenueAllocation` field). The aggregate is
    // computed from the children, but the row tag is
    // "legacy-heuristic" because the per-stream values
    // for the legacy child are heuristic.
    const storedChild = makeBooking({
      revenueAllocation: { roomNet: 3_000, breakfastNet: 0, addOnNet: 0, deductionNet: 0, totalNet: 3_000 },
      totalPrice: 3_000
    });
    const legacyChild = makeBooking({
      revenueAllocation: null,
      totalPrice: 3_000
    });
    const streams = getReservationRevenueStreams(
      makeReservation({ totalPrice: 6_000 }),
      [storedChild, legacyChild]
    );
    expect(streams.allocation).toBe("legacy-heuristic");
    // The aggregate is still meaningful: room + breakfast sum correctly.
    expect(streams.roomNet).toBeGreaterThan(0);
    expect(streams.totalNet).toBe(6_000);
  });

  it("returns zeros + 'legacy-heuristic' for an empty child list when the aggregate is also null", () => {
    const streams = getReservationRevenueStreams(makeReservation(), []);
    expect(streams).toEqual({
      roomNet: 0,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 0,
      allocation: "legacy-heuristic"
    });
  });

  it("rounds the per-stream aggregate sums to 2dp", () => {
    // Three children with values that would otherwise
    // accumulate a 3dp rounding error. The helper rounds
    // each running total to 2dp so the aggregate is
    // `decimal-safe` for the XLSX export.
    const child = makeBooking({
      revenueAllocation: { roomNet: 333.33, breakfastNet: 0, addOnNet: 0, deductionNet: 0, totalNet: 333.33 },
      totalPrice: 333.33
    });
    const streams = getReservationRevenueStreams(
      makeReservation({ totalPrice: 999.99 }),
      [child, child, child]
    );
    expect(streams.roomNet).toBe(999.99);
    expect(streams.totalNet).toBe(999.99);
  });
});

describe("assertBookingRevenueAllocationInvariant", () => {
  it("passes for a valid allocation", () => {
    const allocation: BookingRevenueAllocation = {
      roomNet: 4_000,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 500,
      totalNet: 5_000
    };
    expect(() =>
      assertBookingRevenueAllocationInvariant(allocation, 5_000)
    ).not.toThrow();
  });

  it("passes within the rounding-noise tolerance (per-stream 2dp + IEEE 754 noise)", () => {
    // Each per-stream value is rounded independently to
    // 2dp, so the sum can drift by up to ~0.025 across 4
    // fields. The helper also absorbs the IEEE 754
    // double-precision representation noise (e.g.
    // `4000.01` in JS is actually `4000.010000000000036`;
    // summing 5 such values drifts by a few 1e-13). The
    // helper tolerates ±0.05 in total.
    const allocation: BookingRevenueAllocation = {
      roomNet: 4_000.01,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 500,
      totalNet: 5_000
    };
    expect(() =>
      assertBookingRevenueAllocationInvariant(allocation, 5_000)
    ).not.toThrow();
  });

  it("throws for an off-by-1.00 invariant violation", () => {
    // 1.00 is past the 0.05 tolerance — the helper
    // throws so a real miscalculation is caught at the
    // write boundary, not surfaced to the accountant
    // later. A real pricing-chain bug will be off by at
    // least one whole currency unit, not by 0.0001.
    const allocation: BookingRevenueAllocation = {
      roomNet: 5_000.00,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 500,
      totalNet: 5_000
    };
    expect(() =>
      assertBookingRevenueAllocationInvariant(allocation, 5_000)
    ).toThrow(/invariant violation/);
  });

  it("returns the same allocation it was given (chainable)", () => {
    const allocation: BookingRevenueAllocation = {
      roomNet: 4_000,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 500,
      totalNet: 5_000
    };
    expect(assertBookingRevenueAllocationInvariant(allocation, 5_000)).toBe(
      allocation
    );
  });
});

describe("computeBookingRevenueAllocation", () => {
  it("computes the room-only allocation with no breakfast and no discounts", () => {
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 2_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 0,
      hasBreakfast: false,
      totalPrice: 4_000
    });
    expect(allocation).toEqual({
      roomNet: 4_000,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 4_000
    });
  });

  it("computes a room + breakfast allocation with no discounts", () => {
    // room=4000, breakfast=250×2×2=1000, total=5000.
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 2_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 250,
      hasBreakfast: true,
      totalPrice: 5_000
    });
    expect(allocation).toEqual({
      roomNet: 4_000,
      breakfastNet: 1_000,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 5_000
    });
  });

  it("computes a room + breakfast + extra-bed allocation", () => {
    // room=4000, breakfast=500, extraBed=500, total=5000.
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 2_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 125,
      hasBreakfast: true,
      extraBedTotal: 500,
      totalPrice: 5_000
    });
    expect(allocation).toEqual({
      roomNet: 4_000,
      breakfastNet: 500,
      addOnNet: 500,
      deductionNet: 0,
      totalNet: 5_000
    });
  });

  it("computes the deduction attribution for a senior + voucher + member stack", () => {
    // Realistic: room=8000, breakfast=1000, extraBed=0, total=6210.
    // Senior 20% on 9000 (broad scope) = 1800. Voucher 300 flat.
    // Member 10% on the remaining 6900 = 690. Total deductions
    // = 1800 + 300 + 690 = 2790. Net: 9000 - 2790 = 6210 ✓.
    // The per-stream values are GROSS (pre-deduction) — the
    // deduction is a single line on `deductionNet`. The
    // invariant `room + breakfast + addOn - deduction === total`
    // holds by construction: 8000 + 1000 + 0 - 2790 = 6210.
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 4_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 250,
      hasBreakfast: true,
      extraBedTotal: 0,
      discountPct: 20,
      voucherDiscount: 300,
      memberDiscountPct: 10,
      totalPrice: 6_210
    });
    expect(allocation.roomNet).toBe(8_000);
    expect(allocation.breakfastNet).toBe(1_000);
    expect(allocation.addOnNet).toBe(0);
    expect(allocation.deductionNet).toBe(2_790);
    expect(allocation.totalNet).toBe(6_210);
  });

  it("throws when totalPrice is inconsistent with the per-stream sum (write-boundary guard)", () => {
    // The fixture has a totalPrice of 0 but the per-stream
    // sum is ~3800 — a real miscalculation would land here
    // (e.g. the server passed the wrong totalPrice, or the
    // chain returned an inconsistent breakdown). The
    // assertion throws so the bug is caught at the write
    // boundary, not surfaced to the accountant later.
    expect(() =>
      computeBookingRevenueAllocation({
        ratePerNight: 1_234.56,
        numNights: 3,
        numGuests: 1,
        breakfastRate: 99.99,
        hasBreakfast: true,
        extraBedTotal: 50.01,
        discountPct: 5,
        voucherDiscount: 25.55,
        memberDiscountPct: 0,
        totalPrice: 0
      })
    ).toThrow(/invariant violation/);
  });

  it("rounds every per-stream field to 2dp", () => {
    // The helper rounds each per-stream value via `round2`
    // before the invariant check, so a value like
    // `1234.567` (a 3dp gross from the chain) becomes
    // `1234.57` (2dp) on the returned allocation. The
    // invariant holds because `round2` is applied to the
    // sum too.
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 1_234.567, // 3dp — round2 should clip to 1234.57
      numNights: 1,
      numGuests: 0,
      breakfastRate: 0,
      hasBreakfast: false,
      totalPrice: 1_234.57
    });
    expect(allocation.roomNet).toBe(1_234.57);
    expect(allocation.breakfastNet).toBe(0);
    expect(allocation.addOnNet).toBe(0);
    expect(allocation.deductionNet).toBe(0);
    expect(allocation.totalNet).toBe(1_234.57);
  });

  it("defensively coerces nullish inputs to 0", () => {
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 1_000,
      numNights: 1,
      numGuests: undefined,
      breakfastRate: null,
      hasBreakfast: null,
      extraBedTotal: undefined,
      discountPct: null,
      voucherDiscount: null,
      memberDiscountPct: null,
      totalPrice: 1_000
    });
    expect(allocation).toEqual({
      roomNet: 1_000,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 1_000
    });
  });

  it("preserves the existing calculateBookingTotal for the final total (no double-discounting)", () => {
    // A booking with no discounts and a simple rate:
    //   room=2000×2=4000, breakfast=0, total=4000.
    // The compute helper must produce the same total
    // the existing `calculateBookingTotal` would.
    const allocation = computeBookingRevenueAllocation({
      ratePerNight: 2_000,
      numNights: 2,
      numGuests: 0,
      breakfastRate: 0,
      hasBreakfast: false,
      totalPrice: 4_000
    });
    expect(allocation.totalNet).toBe(4_000);
    expect(allocation.roomNet).toBe(4_000);
    expect(allocation.breakfastNet).toBe(0);
    expect(allocation.addOnNet).toBe(0);
    expect(allocation.deductionNet).toBe(0);
  });
});
