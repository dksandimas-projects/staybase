// Per AI-BROWSER-QA (2026-10-25, scenario BF-03): a guest booking WITH
// breakfast must be creatable, and its revenue allocation must balance.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// Per BR-03 (2026-10-12, decision #232) the breakfast is a RESERVATION-level
// term — per date × per guest — and the per-STAY `breakfastTotal` is 0 in
// the create path. The MRB-11 allocation still read the per-STAY field:
//
//   breakfastNet: pricingForRoom.breakfastTotal   // → 0
//
// while the child's total DID carry the reservation's breakfast. The
// invariant `roomNet + breakfastNet + addOnNet − deductionNet === totalNet`
// therefore failed by exactly the breakfast amount, the assert threw, and
// the create handler answered HTTP 500:
//
//   [MRB-11] revenue allocation invariant violation: roomNet(2400) +
//   breakfastNet(0) + addOnNet(0) - deductionNet(0) = 2400, expected
//   totalNet(2600).
//
// A guest who picked breakfast could not book at all.
//
// THE FIX
// -------
// The child's share of the reservation's breakfast is allocated with the
// SAME weights the child's total is allocated with, so the two always
// balance:
//
//   childTotal = w_i/Σw · (Σw + breakfast − deductions)
//   room_i + extraBed_i = w_i
//   ⇒ breakfast_i = w_i/Σw · breakfast
//
// This file pins the ARITHMETIC (runtime assertions against the shared
// invariant helper) and the WIRING (source-text guards — the create
// handler is a 14k-line function with no injectable pricing seam).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertBookingRevenueAllocationInvariant } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");
const bookingsHandlerSrc = readFileSync(resolve(repoRoot, "guest-app/server/handlers/bookings.ts"), "utf8");

/**
 * The handler's own weighted allocation (a local copy of
 * `allocateRoundedAmount` in bookings.ts) — the test states the arithmetic
 * the handler must perform, and the shared invariant decides whether the
 * result balances.
 */
function allocateRoundedAmount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return safeWeights.map((_, index) => (index === 0 ? safeTotal : 0));
  const shares = safeWeights.map((weight) => (weight / weightTotal) * safeTotal);
  const floored = shares.map((share) => Math.floor(share));
  let remainder = safeTotal - floored.reduce((sum, share) => sum + share, 0);
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of order) {
    if (remainder <= 0) break;
    floored[entry.index] += 1;
    remainder -= 1;
  }
  return floored;
}

/** One child of a reservation, as the create path builds it. */
function childAllocation(input: {
  roomTotal: number;
  breakfastTotal: number;
  extraBedTotal: number;
  deduction: number;
  otherAddOnTotal: number;
}) {
  const weights = [input.roomTotal + input.extraBedTotal];
  const total = input.roomTotal + input.breakfastTotal + input.extraBedTotal - input.deduction;
  const allocatedTotals = allocateRoundedAmount(total, weights);
  const allocatedBreakfast = allocateRoundedAmount(input.breakfastTotal, weights);
  return {
    allocation: {
      roomNet: input.roomTotal,
      breakfastNet: allocatedBreakfast[0],
      addOnNet: input.extraBedTotal + input.otherAddOnTotal,
      deductionNet: input.deduction,
      totalNet: allocatedTotals[0] + input.otherAddOnTotal
    },
    expectedTotal: total + input.otherAddOnTotal
  };
}

describe("BF-03 — a booking with breakfast balances its allocation", () => {
  it("the single-room case balances (the shape that returned HTTP 500)", () => {
    const { allocation, expectedTotal } = childAllocation({
      roomTotal: 2_400,
      breakfastTotal: 200,
      extraBedTotal: 0,
      deduction: 0,
      otherAddOnTotal: 0
    });

    expect(allocation.breakfastNet).toBe(200);
    expect(() => assertBookingRevenueAllocationInvariant(allocation, expectedTotal)).not.toThrow();
  });

  it("balances with a discount in the chain", () => {
    const { allocation, expectedTotal } = childAllocation({
      roomTotal: 2_400,
      breakfastTotal: 200,
      extraBedTotal: 0,
      deduction: 260,
      otherAddOnTotal: 0
    });

    expect(() => assertBookingRevenueAllocationInvariant(allocation, expectedTotal)).not.toThrow();
  });

  it("balances with an extra bed and an other add-on", () => {
    const { allocation, expectedTotal } = childAllocation({
      roomTotal: 2_400,
      breakfastTotal: 300,
      extraBedTotal: 500,
      deduction: 0,
      otherAddOnTotal: 500
    });

    expect(() => assertBookingRevenueAllocationInvariant(allocation, expectedTotal)).not.toThrow();
  });

  it("the OLD shape — the per-stay breakfast — does NOT balance", () => {
    // This is the defect, stated as a test: the per-stay value is 0, so
    // the allocation is short by exactly the breakfast.
    const allocation = {
      roomNet: 2_400,
      breakfastNet: 0,
      addOnNet: 0,
      deductionNet: 0,
      totalNet: 2_600
    };
    expect(() => assertBookingRevenueAllocationInvariant(allocation, 2_600)).toThrow(/invariant violation/i);
  });
});

describe("BF-03 — the wiring (source-text tripwires)", () => {
  it("the create path allocates the breakfast with the room-stay weights", () => {
    expect(bookingsHandlerSrc).toMatch(
      /const allocatedBreakfastTotals = allocateRoundedAmount\(breakfastTotal, roomStayWeights\)/
    );
  });

  it("the per-child allocation reads the allocated breakfast", () => {
    expect(bookingsHandlerSrc).toMatch(/breakfastNet: round2\(allocatedBreakfastTotals\[bookingIdx\] \?\? 0\)/);
  });

  it("the aggregate sums the allocated breakfast", () => {
    expect(bookingsHandlerSrc).toMatch(
      /breakfastNet: allocatedBreakfastTotals\.reduce\(\(sum, value\) => sum \+ \(Number\(value\) \|\| 0\), 0\)/
    );
  });

  it("the per-stay breakfast is no longer the allocation's source", () => {
    expect(bookingsHandlerSrc).not.toMatch(/breakfastNet: pricingForRoom\.breakfastTotal/);
  });
});
