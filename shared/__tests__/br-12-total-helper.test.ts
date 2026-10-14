// BR-12 total-helper tripwires. Per BR-12 spec §Shared Helpers.

import { describe, expect, it } from "vitest";
import {
  buildOtherAddOnSelectionKey,
  hasAnyOtherAddOns,
  otherAddOnBreakdownByDate,
  parseOtherAddOnSelectionKey,
  recomputeOtherAddOnTotal,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";

function mkEntry(
  addOnId: string,
  priceSnapshot: number,
  quantity: number,
  removed = false
): OtherAddOnSelectionEntry {
  return {
    addOnId,
    nameSnapshot: addOnId,
    priceSnapshot,
    quantity,
    unitSnapshot: "per-person",
    addedAt: new Date().toISOString(),
    addedBy: "guest",
    lastModifiedAt: new Date().toISOString(),
    lastModifiedBy: "guest",
    removedAt: removed ? new Date().toISOString() : null,
    removedBy: removed ? "guest" : null,
    cutoffHoursBeforeCheckInSnapshot: 24
  };
}

describe("BR-12 — recomputeOtherAddOnTotal", () => {
  it("sums priceSnapshot × quantity across dates", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 500, 2)],
      "2026-12-02": [mkEntry("b", 300, 3)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(500 * 2 + 300 * 3);
  });

  it("ignores removed entries (removedAt !== null)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 500, 2), mkEntry("b", 300, 1, true)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(500 * 2);
  });

  it("ignores entries with quantity 0", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 500, 0)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(0);
  });

  it("returns 0 for null / undefined input", () => {
    expect(recomputeOtherAddOnTotal(null)).toBe(0);
    expect(recomputeOtherAddOnTotal(undefined)).toBe(0);
  });

  it("rounds to integer (no floating-point noise)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 333.33, 3)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(1000);
  });

  it("clamps negative price to 0 (defensive)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", -100, 2)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(0);
  });
});

describe("BR-12 — otherAddOnBreakdownByDate", () => {
  it("groups rows by date asc with subtotal + itemCount", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-03": [mkEntry("a", 500, 1)],
      "2026-12-01": [mkEntry("a", 500, 1), mkEntry("b", 300, 2)]
    };
    const rows = otherAddOnBreakdownByDate(sel);
    expect(rows.map((r) => r.date)).toEqual(["2026-12-01", "2026-12-03"]);
    expect(rows[0].subtotal).toBe(500 + 300 * 2);
    expect(rows[0].itemCount).toBe(2);
    expect(rows[1].subtotal).toBe(500);
    expect(rows[1].itemCount).toBe(1);
  });

  it("skips dates whose entries are all removed or quantity 0", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 500, 1, true)]
    };
    expect(otherAddOnBreakdownByDate(sel)).toEqual([]);
  });
});

describe("BR-12 — hasAnyOtherAddOns", () => {
  it("returns true when any live entry has quantity > 0", () => {
    expect(hasAnyOtherAddOns({ "2026-12-01": [mkEntry("a", 500, 1)] })).toBe(true);
  });
  it("returns false when all entries are removed or quantity 0", () => {
    expect(hasAnyOtherAddOns({ "2026-12-01": [mkEntry("a", 500, 0)] })).toBe(false);
    expect(hasAnyOtherAddOns({ "2026-12-01": [mkEntry("a", 500, 1, true)] })).toBe(false);
  });
});

describe("BR-12 — selection-key round-trip", () => {
  it("buildOtherAddOnSelectionKey + parseOtherAddOnSelectionKey are inverses for ASCII addOnIds", () => {
    const k = buildOtherAddOnSelectionKey("2026-12-01", "airport-transfer");
    expect(parseOtherAddOnSelectionKey(k)).toEqual({
      date: "2026-12-01",
      addOnId: "airport-transfer"
    });
  });
  it("preserves dashes inside the addOnId portion", () => {
    const k = buildOtherAddOnSelectionKey("2026-12-01", "seaport-transfer-v1");
    expect(parseOtherAddOnSelectionKey(k)?.addOnId).toBe("seaport-transfer-v1");
  });
});