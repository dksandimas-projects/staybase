// BR-12 data-model tripwires. Pins the additive shape
// extensions + the per-day × per-add-on invariants. The
// breakfast shape (BR-08 frozen) is NOT re-asserted here
// — these tests only cover the NEW fields.

import { describe, expect, it } from "vitest";
import {
  AIRPORT_TRANSFER_PRESEED,
  buildOtherAddOnSelectionKey,
  getEnabledAddOnsByHotel,
  hasAnyOtherAddOns,
  normalizeAddOn,
  parseOtherAddOnSelectionKey,
  recomputeOtherAddOnTotal,
  sortAddOnsByDisplayOrder,
  type AddOn,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";

describe("BR-12 — Other Add-Ons data model", () => {
  it("AddOn interface carries the BR-12 contract (id + name + price + unit + cutoffHours + displayOrder + updatedAt)", () => {
    const sample: AddOn = {
      id: "airport-transfer",
      name: "Airport transfer",
      description: "Per-guest one-way pickup",
      price: 500,
      unit: "per-person",
      isEnabled: true,
      cutoffHoursBeforeCheckIn: 24,
      displayOrder: 10,
      updatedAt: new Date().toISOString(),
      updatedBy: "test"
    };
    expect(sample.id).toBe("airport-transfer");
    expect(sample.unit).toBe("per-person");
    expect(sample.cutoffHoursBeforeCheckIn).toBe(24);
    expect(typeof sample.price).toBe("number");
  });

  it("AIRPORT_TRANSFER_PRESEED has the BR-12 spec defaults (₱500 per-person, 24h cutoff)", () => {
    expect(AIRPORT_TRANSFER_PRESEED.name).toBe("Airport transfer");
    expect(AIRPORT_TRANSFER_PRESEED.price).toBe(500);
    expect(AIRPORT_TRANSFER_PRESEED.unit).toBe("per-person");
    expect(AIRPORT_TRANSFER_PRESEED.cutoffHoursBeforeCheckIn).toBe(24);
    expect(AIRPORT_TRANSFER_PRESEED.isEnabled).toBe(true);
  });

  it("normalizeAddOn drops rows with missing id or name", () => {
    expect(normalizeAddOn({ name: "x" })).toBeNull();
    expect(normalizeAddOn({ id: "x" })).toBeNull();
    expect(normalizeAddOn(null)).toBeNull();
  });

  it("normalizeAddOn coerces unit, defaults isEnabled true, clamps cutoff to [0..168]", () => {
    const norm = normalizeAddOn(
      {
        id: "x",
        name: "X",
        unit: "per-stay",
        price: 1000,
        cutoffHoursBeforeCheckIn: 9999,
        isEnabled: false
      },
      "x"
    );
    expect(norm).not.toBeNull();
    expect(norm!.unit).toBe("per-stay");
    expect(norm!.cutoffHoursBeforeCheckIn).toBe(168);
    expect(norm!.isEnabled).toBe(false);
  });

  it("normalizeAddOn defaults isEnabled to true when undefined", () => {
    const norm = normalizeAddOn({ id: "x", name: "X" }, "x");
    expect(norm!.isEnabled).toBe(true);
  });

  it("getEnabledAddOnsByHotel excludes isEnabled === false rows", () => {
    const rows: AddOn[] = [
      mk("a", true),
      mk("b", false),
      mk("c", true)
    ];
    const out = getEnabledAddOnsByHotel(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("getEnabledAddOnsByHotel sorts by displayOrder then name", () => {
    const rows: AddOn[] = [
      mk("zeta", true, 20),
      mk("alpha", true, 10),
      mk("beta", true, 10)
    ];
    const out = getEnabledAddOnsByHotel(rows);
    expect(out.map((r) => r.id)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("sortAddOnsByDisplayOrder includes disabled rows in the admin list", () => {
    const rows: AddOn[] = [mk("b", false, 20), mk("a", true, 10)];
    const out = sortAddOnsByDisplayOrder(rows);
    expect(out.length).toBe(2);
    expect(out[0].id).toBe("a");
  });

  it("recomputeOtherAddOnTotal sums priceSnapshot × quantity, ignoring removedAt entries", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [
        mkEntry("a", 500, 2),
        mkEntry("b", 300, 1, true) // removed
      ]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(500 * 2);
  });

  it("recomputeOtherAddOnTotal returns 0 for null / undefined / empty", () => {
    expect(recomputeOtherAddOnTotal(null)).toBe(0);
    expect(recomputeOtherAddOnTotal(undefined)).toBe(0);
    expect(recomputeOtherAddOnTotal({})).toBe(0);
  });

  it("hasAnyOtherAddOns returns true only when at least one live entry has quantity > 0", () => {
    expect(hasAnyOtherAddOns(null)).toBe(false);
    expect(
      hasAnyOtherAddOns({
        "2026-12-01": [mkEntry("a", 500, 0)]
      })
    ).toBe(false);
    expect(
      hasAnyOtherAddOns({
        "2026-12-01": [mkEntry("a", 500, 2)]
      })
    ).toBe(true);
  });

  it("buildOtherAddOnSelectionKey + parseOtherAddOnSelectionKey round-trip", () => {
    const k = buildOtherAddOnSelectionKey("2026-12-01", "airport-transfer");
    expect(k).toBe("2026-12-01-airport-transfer");
    const p = parseOtherAddOnSelectionKey(k);
    expect(p).toEqual({ date: "2026-12-01", addOnId: "airport-transfer" });
  });

  it("parseOtherAddOnSelectionKey preserves dashes inside addOnId", () => {
    const k = buildOtherAddOnSelectionKey("2026-12-01", "seaport-transfer-v1");
    const p = parseOtherAddOnSelectionKey(k);
    expect(p).toEqual({ date: "2026-12-01", addOnId: "seaport-transfer-v1" });
  });

  it("parseOtherAddOnSelectionKey returns null for malformed input", () => {
    expect(parseOtherAddOnSelectionKey("")).toBeNull();
    expect(parseOtherAddOnSelectionKey("garbage")).toBeNull();
    expect(parseOtherAddOnSelectionKey("2026-12-01")).toBeNull();
  });
});

function mk(id: string, isEnabled: boolean, displayOrder = 10): AddOn {
  return {
    id,
    name: id,
    description: "",
    price: 500,
    unit: "per-person",
    isEnabled,
    cutoffHoursBeforeCheckIn: 24,
    displayOrder,
    updatedAt: new Date().toISOString(),
    updatedBy: "test"
  };
}

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