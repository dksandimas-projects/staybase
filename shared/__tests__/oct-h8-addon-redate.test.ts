// Per OCT-H8 (2026-10-20, decision #288): the re-dating /
// auto-cancel logic for a booking whose stay window moved (or was
// cancelled).
//
// THE BUG
//
// `handleRescheduleBooking` and `handleCancelBooking` contained ZERO
// references to `breakfastSelections` / `otherAddOnSelections`. The
// breakfast total simply carried forward and the selection keys
// kept the OLD dates.
//
// A guest booked Oct 14–17 with three paid breakfasts, then
// rescheduled to Oct 20–23: `breakfastTotal` carried forward (still
// charged), the selection keys still said `2026-10-14…`, and the
// kitchen list for Oct 20 showed nothing — the guest was charged
// for three breakfasts that were never served.
//
// THE SPEC
//
// `plan/features/BREAKFAST.md` §Edge cases 2 + 3:
//
//   2. Reschedule — "any `breakfastSelections[date-*]` whose date
//      falls outside the new date range is auto-cancelled; for paid
//      removals, a refund liability is opened; for unpaid removals,
//      the `breakfastTotal` decreases."
//
//   3. Cancel — "any unpaid `breakfastSelections` for future dates
//      is dropped; any paid selections for future dates generate
//      refund liabilities with `category: "breakfast"`. Past-date
//      selections are not refunded."

import { describe, expect, it } from "vitest";
import {
  enumerateStayServiceDates,
  isDateInStayWindow,
  redateBreakfastSelections,
  redateOtherAddOnSelections,
  serviceDateFromSlotKey,
  shouldAutoCancelSelection
} from "../utils/bookingAddOnReschedule";
import type {
  BreakfastSelectionEntry,
  OtherAddOnSelectionEntry
} from "../types/index";

function meal(
  overrides: Partial<BreakfastSelectionEntry> = {}
): BreakfastSelectionEntry {
  return {
    mealId: "meal-1",
    mealName: "Continental",
    price: 350,
    quantity: 1,
    addedAt: "2026-10-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    ...overrides
  } as BreakfastSelectionEntry;
}

function addOn(
  overrides: Partial<OtherAddOnSelectionEntry> = {}
): OtherAddOnSelectionEntry {
  return {
    addOnId: "airport-transfer",
    nameSnapshot: "Airport Transfer",
    priceSnapshot: 500,
    quantity: 1,
    unitSnapshot: "per-stay",
    addedAt: "2026-10-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    cutoffHoursBeforeCheckInSnapshot: 24,
    ...overrides
  } as OtherAddOnSelectionEntry;
}

describe("OCT-H8 — the stay window helpers", () => {
  it("enumerates the service dates [checkIn, checkOut)", () => {
    expect(enumerateStayServiceDates({ checkIn: "2026-10-14", checkOut: "2026-10-17" })).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16"
    ]);
  });

  it("returns an empty list for a malformed window", () => {
    expect(enumerateStayServiceDates({ checkIn: "nope", checkOut: "2026-10-17" })).toEqual([]);
  });

  it("caps the enumeration at 60 days", () => {
    expect(enumerateStayServiceDates({ checkIn: "2026-01-01", checkOut: "2026-12-31" })).toHaveLength(60);
  });

  it("tests the window membership", () => {
    const window = { checkIn: "2026-10-14", checkOut: "2026-10-17" };
    expect(isDateInStayWindow("2026-10-14", window)).toBe(true);
    expect(isDateInStayWindow("2026-10-16", window)).toBe(true);
    expect(isDateInStayWindow("2026-10-17", window)).toBe(false);
    expect(isDateInStayWindow("2026-10-13", window)).toBe(false);
    expect(isDateInStayWindow("garbage", window)).toBe(false);
  });

  it("reads the service date off a slot key", () => {
    expect(serviceDateFromSlotKey("2026-10-14-guest-1")).toBe("2026-10-14");
    expect(serviceDateFromSlotKey("garbage")).toBeNull();
  });

  describe("shouldAutoCancelSelection", () => {
    const window = { checkIn: "2026-10-20", checkOut: "2026-10-23" };

    it("reschedule: cancels anything outside the new window", () => {
      expect(shouldAutoCancelSelection("reschedule", "2026-10-14", window, "2026-10-10")).toBe(true);
      expect(shouldAutoCancelSelection("reschedule", "2026-10-22", window, "2026-10-10")).toBe(false);
    });

    it("cancel: cancels today and later, leaves the past alone", () => {
      expect(shouldAutoCancelSelection("cancel", "2026-10-20", window, "2026-10-20")).toBe(true);
      expect(shouldAutoCancelSelection("cancel", "2026-10-19", window, "2026-10-20")).toBe(false);
    });

    it("never cancels a malformed service date", () => {
      expect(shouldAutoCancelSelection("reschedule", null, window, "2026-10-10")).toBe(false);
    });
  });
});

describe("OCT-H8 — re-dating the breakfast selections", () => {
  const oldWindow = { checkIn: "2026-10-14", checkOut: "2026-10-17" };
  const newWindow = { checkIn: "2026-10-20", checkOut: "2026-10-23" };

  it("cancels every selection that fell out of the new window", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: {
        "2026-10-14-guest-1": meal(),
        "2026-10-15-guest-1": meal(),
        "2026-10-16-guest-1": meal()
      },
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(3);
    expect(result.total).toBe(0);
  });

  it("keeps the selections that are still inside the new window", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: { checkIn: "2026-10-14", checkOut: "2026-10-18" },
      today: "2026-10-10",
      selections: {
        "2026-10-14-guest-1": meal(),
        "2026-10-15-guest-1": meal(),
        "2026-10-20-guest-1": meal()
      },
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].key).toBe("2026-10-20-guest-1");
    expect(result.total).toBe(700);
  });

  it("marks the cancelled selections removed (they stay in the map for audit)", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: { "2026-10-14-guest-1": meal() },
      paidAmount: 0
    });
    const entry = result.selections["2026-10-14-guest-1"];
    expect(entry.removedAt).toBeTruthy();
    expect(entry.removedBy).toBe("system");
    // The BR-01 invariant: the total equals the recomputed sum.
    expect(result.total).toBe(0);
  });

  it("flags a PAID removal (the refund liability case)", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: { "2026-10-14-guest-1": meal({ price: 350 }) },
      paidAmount: 350
    });
    expect(result.removed[0].wasPaid).toBe(true);
    expect(result.paidRemoved).toHaveLength(1);
    expect(result.paidRemoved[0].amount).toBe(350);
  });

  it("does NOT flag an UNPAID removal (the charge simply comes off)", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: { "2026-10-14-guest-1": meal({ price: 350 }) },
      paidAmount: 0
    });
    expect(result.removed[0].wasPaid).toBe(false);
    expect(result.paidRemoved).toHaveLength(0);
  });

  it("consumes the paid budget across removals (no double liability)", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: {
        "2026-10-14-guest-1": meal({ price: 350 }),
        "2026-10-15-guest-1": meal({ price: 350 })
      },
      // Only enough paid for ONE of the two meals.
      paidAmount: 350
    });
    expect(result.removed[0].wasPaid).toBe(true);
    expect(result.removed[1].wasPaid).toBe(false);
    expect(result.paidRemoved).toHaveLength(1);
  });

  it("leaves an already-removed entry alone", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: {
        "2026-10-14-guest-1": meal({ removedAt: "2026-10-02T00:00:00.000Z" })
      },
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(0);
  });

  it("cancel: drops the future selections and keeps the past ones", () => {
    const result = redateBreakfastSelections({
      mode: "cancel",
      window: oldWindow,
      today: "2026-10-15",
      selections: {
        "2026-10-14-guest-1": meal({ price: 350 }),
        "2026-10-15-guest-1": meal({ price: 350 }),
        "2026-10-16-guest-1": meal({ price: 350 })
      },
      paidAmount: 0
    });
    // Oct 14 is in the PAST → not refunded, not dropped.
    expect(result.removed.map((r) => r.serviceDate)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(result.total).toBe(350);
  });

  it("cancel: a paid future selection becomes a liability", () => {
    const result = redateBreakfastSelections({
      mode: "cancel",
      window: oldWindow,
      today: "2026-10-15",
      selections: { "2026-10-16-guest-1": meal({ price: 350 }) },
      paidAmount: 350
    });
    expect(result.paidRemoved).toHaveLength(1);
    expect(result.paidRemoved[0].amount).toBe(350);
  });

  it("is a no-op when every selection is inside the window (the extend case)", () => {
    const result = redateBreakfastSelections({
      mode: "reschedule",
      window: { checkIn: "2026-10-14", checkOut: "2026-10-20" },
      today: "2026-10-10",
      selections: {
        "2026-10-14-guest-1": meal(),
        "2026-10-15-guest-1": meal()
      },
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(0);
    expect(result.total).toBe(700);
  });
});

describe("OCT-H8 — re-dating the other add-on selections", () => {
  const newWindow = { checkIn: "2026-10-20", checkOut: "2026-10-23" };

  it("cancels the add-ons on the dates that fell out of the window", () => {
    const result = redateOtherAddOnSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: {
        "2026-10-14": [addOn()],
        "2026-10-20": [addOn()]
      },
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].date).toBe("2026-10-14");
    expect(result.total).toBe(500);
  });

  it("computes the line total from the snapshot price × quantity", () => {
    const result = redateOtherAddOnSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: { "2026-10-14": [addOn({ priceSnapshot: 500, quantity: 3 })] },
      paidAmount: 1500
    });
    expect(result.removed[0].amount).toBe(1500);
    expect(result.removed[0].wasPaid).toBe(true);
  });

  it("marks the cancelled add-ons removed", () => {
    const result = redateOtherAddOnSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: { "2026-10-14": [addOn()] },
      paidAmount: 0
    });
    const entry = result.selections["2026-10-14"][0];
    expect(entry.removedAt).toBeTruthy();
    expect(entry.removedBy).toBe("system");
  });

  it("cancel: drops the future dates only", () => {
    const result = redateOtherAddOnSelections({
      mode: "cancel",
      window: { checkIn: "2026-10-14", checkOut: "2026-10-17" },
      today: "2026-10-15",
      selections: {
        "2026-10-14": [addOn()],
        "2026-10-16": [addOn()]
      },
      paidAmount: 0
    });
    expect(result.removed.map((r) => r.date)).toEqual(["2026-10-16"]);
  });

  it("tolerates a missing selections map", () => {
    const result = redateOtherAddOnSelections({
      mode: "reschedule",
      window: newWindow,
      today: "2026-10-10",
      selections: null,
      paidAmount: 0
    });
    expect(result.removed).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
