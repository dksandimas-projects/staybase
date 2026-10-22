// Per OCT-H1 (2026-10-20, decision #282): the breakfast inside a
// booking's `totalPrice` must be SUBTRACTED before the current
// breakfast total is added.
//
// Per BR-01 / BR-03 the booking's `totalPrice` is the AS-BOOKED
// room bill (`roomTotal + breakfastTotal + extraBedTotal` minus
// discounts) — the breakfast is a COMPONENT of it, not an addition
// to it. The pre-fix staff update path computed
// `totalPrice + newBreakfastTotal - paidAmount`, so a booking that
// was created WITH breakfast was charged for it TWICE.
//
// `computeBreakfastAdjustedTotalPrice` is the SINGLE source of
// truth for that arithmetic — the guest Manage path and the staff
// update path both route through it, so the guest and the desk can
// never disagree about the same booking.

import { describe, expect, it } from "vitest";
import {
  computeBreakfastAdjustedTotalPrice,
  sumBreakfastRateLines
} from "../utils/breakfastTotal";

describe("computeBreakfastAdjustedTotalPrice", () => {
  it("does not double-count a breakfast that is already inside the total", () => {
    // A ₱5,200 room bill that already contains a ₱200 breakfast.
    // The guest swaps the breakfast for another ₱200 one — the
    // bill is unchanged. The pre-fix formula returned 5,400.
    expect(
      computeBreakfastAdjustedTotalPrice({
        totalPrice: 5_200,
        breakfastInTotalPrice: 200,
        breakfastTotal: 200
      })
    ).toBe(5_200);
  });

  it("moves the bill by the breakfast delta", () => {
    // The guest upgrades the breakfast from ₱200 to ₱500 — the
    // bill moves up by ₱300.
    expect(
      computeBreakfastAdjustedTotalPrice({
        totalPrice: 5_200,
        breakfastInTotalPrice: 200,
        breakfastTotal: 500
      })
    ).toBe(5_500);
  });

  it("adds a breakfast that was booked in after the room was booked", () => {
    // A booking created with no breakfast at all: the anchor is 0
    // (the rate breakdown has no breakfast line), so the first
    // breakfast selection moves the bill up by its full amount.
    expect(
      computeBreakfastAdjustedTotalPrice({
        totalPrice: 5_000,
        breakfastInTotalPrice: 0,
        breakfastTotal: 300
      })
    ).toBe(5_300);
  });

  it("keeps the total as-is when the anchor is unknown", () => {
    // A booking with no rate breakdown at all (pre-breakfast-
    // refactor). The conservative direction: never add the
    // breakfast on top of a total that may already contain it.
    expect(
      computeBreakfastAdjustedTotalPrice({
        totalPrice: 5_000,
        breakfastInTotalPrice: null,
        breakfastTotal: 300
      })
    ).toBe(5_000);
  });

  it("reads the anchor from the create-time rate breakdown", () => {
    const breakdown = {
      addOns: [
        { label: "Room rate — 3 nights", amount: 4_500 },
        { label: "Breakfast add-on", amount: 150 },
        { label: "Breakfast (Oct 14, 2 meals)", amount: 300 },
        { label: "Extra bed add-on", amount: 250 }
      ]
    };
    const anchor = sumBreakfastRateLines(breakdown);
    expect(anchor).toBe(450);
    expect(
      computeBreakfastAdjustedTotalPrice({
        totalPrice: 5_200,
        breakfastInTotalPrice: anchor,
        breakfastTotal: 450
      })
    ).toBe(5_200);
  });
});
