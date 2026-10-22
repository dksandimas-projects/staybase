// Per the P1 revenue-reporting audit (2026-10-22): the MRB-11
// revenue allocation must track the booking's BILL.
//
// The create-time write paths (public create, walk-in, corporate
// conversion, reschedule, add-room) snapshot the allocation when
// the booking is created. The POST-CREATION money paths — a
// discount or voucher applied, a voucher removed, a government
// discount rejected — move `booking.totalPrice` and used to leave
// that snapshot untouched, so the Reports revenue streams read a
// total the guest was no longer billed.
//
// This file pins:
//   1. `rebuildBookingRevenueAllocation` — the shared helper the
//      post-create paths use to re-snapshot the allocation from
//      the same figures the new bill was computed from.
//   2. `getReservationFolioSummary` — the BR-12 other add-ons
//      term (per OCT-FOL-01, decision #298 the add-ons are NOT
//      inside `totalPrice`; they sit on top of the room bill).

import { describe, expect, it } from "vitest";
import {
  assertBookingRevenueAllocationInvariant,
  getReservationFolioSummary,
  rebuildBookingRevenueAllocation
} from "../utils/bookingFolio";
import type { BookingRevenueAllocation } from "../types";

describe("rebuildBookingRevenueAllocation — re-snapshot after a post-create money change", () => {
  it("re-derives the deduction when a senior discount is applied after the create write", () => {
    // The production shape: a walk-in created at the ₱4,800
    // gross rate, then a 20% senior discount applied from the
    // desk. The create-time allocation carried the gross; the
    // bill became 3,840.
    const createTimeAllocation: BookingRevenueAllocation = {
      roomNet: 4_800,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 4_800
    };

    const rebuilt = rebuildBookingRevenueAllocation({
      existingAllocation: createTimeAllocation,
      grossSubtotal: 4_800,
      totalPrice: 3_840
    });

    expect(rebuilt).toEqual({
      roomNet: 4_800,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 960,
      totalNet: 3_840
    });
    // The MRB-11 identity: the allocation's total IS the bill.
    expect(() =>
      assertBookingRevenueAllocationInvariant(rebuilt, 3_840)
    ).not.toThrow();
  });

  it("re-derives the deduction when a voucher is removed (the bill goes back up)", () => {
    const createTimeAllocation: BookingRevenueAllocation = {
      roomNet: 5_100,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 1_836,
      totalNet: 3_264
    };

    const rebuilt = rebuildBookingRevenueAllocation({
      existingAllocation: createTimeAllocation,
      grossSubtotal: 5_100,
      totalPrice: 4_284
    });

    expect(rebuilt.totalNet).toBe(4_284);
    expect(rebuilt.deductionNet).toBe(816);
    expect(rebuilt.roomNet).toBe(5_100);
    expect(() =>
      assertBookingRevenueAllocationInvariant(rebuilt, 4_284)
    ).not.toThrow();
  });

  it("keeps the gross per-stream split (breakfast and add-on are not folded into the room)", () => {
    const createTimeAllocation: BookingRevenueAllocation = {
      roomNet: 4_000,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 500,
      totalNet: 5_000
    };

    const rebuilt = rebuildBookingRevenueAllocation({
      existingAllocation: createTimeAllocation,
      grossSubtotal: 5_500,
      totalPrice: 4_000
    });

    expect(rebuilt).toEqual({
      roomNet: 4_000,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 1_500,
      totalNet: 4_000
    });
  });

  it("falls back to the gross subtotal for a pre-MRB-11 booking with no allocation", () => {
    // A legacy booking has no stored allocation — the gross is
    // attributed to the room stream (the same assumption the
    // legacy revenue heuristic makes) and the deduction is the
    // difference between the gross and the bill.
    const rebuilt = rebuildBookingRevenueAllocation({
      existingAllocation: null,
      grossSubtotal: 5_000,
      totalPrice: 4_000
    });

    expect(rebuilt).toEqual({
      roomNet: 5_000,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 1_000,
      totalNet: 4_000
    });
    expect(() =>
      assertBookingRevenueAllocationInvariant(rebuilt, 4_000)
    ).not.toThrow();
  });

  it("never throws when the stored gross disagrees with the new bill", () => {
    // A legacy booking whose stored gross is smaller than the
    // new bill must not make the write-boundary guard throw in
    // the middle of a desk workflow — the shortfall rides on the
    // room stream so the identity still holds.
    const rebuilt = rebuildBookingRevenueAllocation({
      existingAllocation: {
        roomNet: 1_000,
        breakfastNet: 0,
        addOnNet: 0,
        deductionNet: 0,
        totalNet: 1_000
      },
      grossSubtotal: 1_000,
      totalPrice: 1_500
    });

    expect(rebuilt.totalNet).toBe(1_500);
    expect(rebuilt.roomNet).toBe(1_500);
    expect(rebuilt.deductionNet).toBe(0);
    expect(() =>
      assertBookingRevenueAllocationInvariant(rebuilt, 1_500)
    ).not.toThrow();
  });
});

describe("getReservationFolioSummary — the BR-12 other add-ons term", () => {
  it("adds the other add-ons to the balance (they sit on top of the room bill)", () => {
    // Per OCT-FOL-01 (decision #298): a reservation with a
    // ₱1,500 airport transfer that was never paid reported a
    // ₱0 balance — the hotel was owed the money and every
    // balance surface said the guest was settled.
    const summary = getReservationFolioSummary({
      reservationId: "res_addons",
      reservationTotal: 8_100,
      otherAddOnTotal: 1_500,
      payments: [],
      charges: [],
      source: "reservation-subcollection"
    });

    expect(summary.otherAddOnTotal).toBe(1_500);
    expect(summary.balance).toBe(9_600);
  });

  it("is byte-equivalent to the pre-BR-12 shape when no other add-ons are supplied", () => {
    const summary = getReservationFolioSummary({
      reservationId: "res_legacy",
      reservationTotal: 5_000,
      payments: [{ amount: 3_000 }],
      charges: [],
      source: "reservation-subcollection"
    });

    expect(summary.otherAddOnTotal).toBe(0);
    expect(summary.balance).toBe(2_000);
  });
});
