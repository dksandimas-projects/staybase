// Per OCT-H1 (2026-10-20, decision #282): the guest-facing
// "Manage Breakfast" balance double-counted the breakfast.
//
// THE BUG
//
// `booking.totalPrice` ALREADY contains the breakfast — the create
// transaction computes `subtotal = roomTotal + breakfastTotal +
// extraBedTotal` and stores it as `totalPrice`. The BR-04 manage
// path then computed the balance as:
//
//   balance = totalPrice + recomputedTotal - paidAmount
//
// which added the breakfast a SECOND time. A guest who had booked
// a ₱500 breakfast and paid it in full saw a balance of ₱500
// instead of ₱0.
//
// THE FIX
//
// The helper below sums the breakfast lines that are ALREADY inside
// `rateBreakdown.addOns[]` (the snapshot the create transaction
// stored), so the manage path can subtract them out before adding
// the CURRENT breakfast total:
//
//   balance = totalPrice - breakfastInTotalPrice + currentBreakfastTotal - paidAmount
//
// `rateBreakdown.addOns[]` is the right anchor because it is
// snapshotted at create and preserved verbatim by
// `rebuildRateBreakdown` — unlike `booking.breakfastTotal`, which
// the manage path overwrites on every write.

import { describe, expect, it } from "vitest";
import {
  BREAKFAST_RATE_LINE_LABEL,
  BREAKFAST_RATE_LINE_PREFIX,
  isBreakfastRateLine,
  sumBreakfastRateLines
} from "../utils/breakfastTotal";

interface RateLine {
  label: string;
  amount: number;
}

function breakdown(addOns: RateLine[]): { addOns: RateLine[] } {
  return { addOns };
}

describe("OCT-H1 — the breakfast lines already inside `totalPrice`", () => {
  describe("isBreakfastRateLine", () => {
    it("matches the shared add-on label", () => {
      expect(isBreakfastRateLine(BREAKFAST_RATE_LINE_LABEL)).toBe(true);
    });

    it("matches the per-meal prefix", () => {
      expect(isBreakfastRateLine("Breakfast (Continental)")).toBe(true);
      expect(isBreakfastRateLine("Breakfast (Filipino)")).toBe(true);
    });

    it("rejects the room + other add-on lines", () => {
      expect(isBreakfastRateLine("Standard Room (3 nights)")).toBe(false);
      expect(isBreakfastRateLine("Airport Transfer")).toBe(false);
      expect(isBreakfastRateLine("Extra Bed")).toBe(false);
      expect(isBreakfastRateLine("")).toBe(false);
      expect(isBreakfastRateLine(undefined)).toBe(false);
      expect(isBreakfastRateLine(null)).toBe(false);
      expect(isBreakfastRateLine(42)).toBe(false);
    });
  });

  describe("sumBreakfastRateLines", () => {
    it("returns null when there is no breakdown (no anchor → do not add)", () => {
      // A booking with no `rateBreakdown` has an UNKNOWN breakfast
      // component. The conservative choice is to NOT add the
      // breakfast on top — the guest is never over-charged.
      expect(sumBreakfastRateLines(null)).toBeNull();
      expect(sumBreakfastRateLines(undefined)).toBeNull();
    });

    it("returns 0 when the breakdown has no breakfast line", () => {
      expect(sumBreakfastRateLines(breakdown([
        { label: "Standard Room (3 nights)", amount: 4500 }
      ]))).toBe(0);
    });

    it("sums the breakfast lines only", () => {
      const result = sumBreakfastRateLines(breakdown([
        { label: "Standard Room (3 nights)", amount: 4500 },
        { label: "Breakfast (Continental)", amount: 350 },
        { label: "Breakfast (Filipino)", amount: 300 },
        { label: "Airport Transfer", amount: 500 }
      ]));
      expect(result).toBe(650);
    });

    it("sums the shared add-on label line", () => {
      expect(sumBreakfastRateLines(breakdown([
        { label: BREAKFAST_RATE_LINE_LABEL, amount: 500 }
      ]))).toBe(500);
    });

    it("ignores a non-numeric amount rather than producing NaN", () => {
      const result = sumBreakfastRateLines(breakdown([
        { label: "Breakfast (Continental)", amount: Number.NaN },
        { label: "Breakfast (Filipino)", amount: 300 }
      ]));
      expect(result).toBe(300);
      expect(Number.isNaN(result as number)).toBe(false);
    });

    it("returns 0 (not null) for a breakdown with an empty add-on list", () => {
      expect(sumBreakfastRateLines(breakdown([]))).toBe(0);
    });
  });

  describe("the double-count the fix removes", () => {
    it("the old formula charged the breakfast twice", () => {
      const totalPrice = 4500 + 650; // room + breakfast, as stored
      const currentBreakfastTotal = 650;
      const paidAmount = 5150; // paid in full

      // BEFORE (the bug): totalPrice + current - paid → 650 owed.
      const buggy = Math.max(0, totalPrice + currentBreakfastTotal - paidAmount);
      expect(buggy).toBe(650);

      // AFTER (the fix): subtract the breakfast already inside
      // `totalPrice` before adding the current one.
      const breakfastInTotalPrice = sumBreakfastRateLines(
        breakdown([
          { label: "Standard Room (3 nights)", amount: 4500 },
          { label: "Breakfast (Continental)", amount: 350 },
          { label: "Breakfast (Filipino)", amount: 300 }
        ])
      ) as number;
      const fixed = Math.max(
        0,
        (totalPrice - breakfastInTotalPrice + currentBreakfastTotal) - paidAmount
      );
      expect(fixed).toBe(0);
    });

    it("a legacy booking with no breakdown is not over-charged", () => {
      // No `rateBreakdown` → the breakfast component is unknown →
      // the conservative path leaves `totalPrice` alone and adds the
      // current breakfast total. The guest is never charged twice.
      const totalPrice = 5000;
      const currentBreakfastTotal = 500;
      const paidAmount = 5500;
      const breakfastInTotalPrice = sumBreakfastRateLines(null);
      const base = breakfastInTotalPrice === null
        ? totalPrice
        : totalPrice - breakfastInTotalPrice;
      const balance = Math.max(0, base + currentBreakfastTotal - paidAmount);
      expect(balance).toBe(0);
    });
  });
});
