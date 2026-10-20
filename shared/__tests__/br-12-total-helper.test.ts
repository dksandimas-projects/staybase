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

  // Per OCT-L3 (2026-10-20, decision #299): the total rounds to 2
  // decimal places, NOT to whole pesos.
  //
  // This case used to assert `1000` — 333.33 × 3 = 999.99 was rounded
  // UP to a whole peso. That was the bug: the billed total (whole
  // pesos) and the refund liability for the SAME selection (full
  // precision) never reconciled, so a ₱499.99 add-on billed ₱500 and
  // refunded ₱499.99.
  //
  // The test name is inverted on purpose: a future agent who sees the
  // 2dp rule broken would most naturally "fix" it by restoring
  // `Math.round(total)` and re-pointing this assertion to 1000. The
  // name + comment below say what the rule IS, so the wrong direction
  // is obvious.
  it("rounds to 2 decimal places (never to whole pesos)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 333.33, 3)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(999.99);
  });

  it("absorbs floating-point drift at 2dp (0.1 + 0.2 style)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 0.1, 1), mkEntry("b", 0.2, 1)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(0.3);
  });

  it("keeps the breakdown subtotal on the SAME 2dp rule as the total", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 333.33, 3)]
    };
    const rows = otherAddOnBreakdownByDate(sel);
    expect(rows[0].subtotal).toBe(999.99);
    expect(rows[0].subtotal).toBe(recomputeOtherAddOnTotal(sel));
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