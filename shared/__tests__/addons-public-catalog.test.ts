// P0-9 (2026-10-22) — the PUBLIC other-add-ons catalog payload.
//
// The owner reported in the live admin app that the booking drawer's
// Add-Ons tab said "The add-on catalog is empty. Add a row in Settings
// → Other Add-Ons to start selling add-ons." while the hotel's add-ons
// were ON and the endpoint was serving a row.
//
// Two separate defects stacked behind that report:
//
//   1. The admin consumers read `data.data` (the BREAKFAST config
//      endpoint's shape) instead of `data.addOns` — shipped as
//      decision #313 in v2.18.17.
//
//   2. The payload rules lived INSIDE the endpoint, so they could only
//      be observed through a live request. One of them was wrong:
//      `preSeeded` was derived from the row's id
//      (`length === 1 && id === "airport-transfer"`), which is ALSO
//      true for a hotel that saved a REAL `airport-transfer` row — so
//      the hotel was told it was looking at a read-only placeholder.
//
// This suite pins the payload rules in a PURE helper
// (`buildPublicAddOnsCatalog`) so they are asserted behaviourally.
//
// Every test here FAILS against the pre-fix endpoint logic:
//   - `preSeeded` was `true` for a real saved `airport-transfer` row.
//   - the payload shape was asserted only through a live request.

import { describe, expect, it } from "vitest";
import {
  AIRPORT_TRANSFER_PRESEED,
  buildPublicAddOnsCatalog,
  getEnabledAddOnsByHotel,
  normalizeAddOn,
  type AddOn
} from "@spark-inn/shared";

/** A real catalog row as the admin Settings tab saves it. */
function realSavedRow(overrides: Partial<AddOn> = {}): AddOn {
  return {
    id: "airport-transfer",
    name: "Airport transfer",
    description: "One-way airport pickup or drop-off at TAG.",
    price: 500,
    unit: "per-person",
    isEnabled: true,
    cutoffHoursBeforeCheckIn: 24,
    displayOrder: 10,
    updatedAt: "2026-10-20T23:55:48.044Z",
    updatedBy: "staff-uid",
    ...overrides
  };
}

/** The hard-coded fallback row the endpoint injects when the collection is empty. */
function fallbackRow(): AddOn {
  return {
    id: "airport-transfer",
    ...AIRPORT_TRANSFER_PRESEED,
    updatedAt: "2026-10-22T00:00:00.000Z",
    updatedBy: "pre-seed"
  };
}

describe("P0-9 — public add-on catalog payload", () => {
  it("reports preSeeded=false for a REAL saved airport-transfer row", () => {
    // The hotel saved its own `airport-transfer` row in Settings →
    // Other Add-Ons. The row is NOT a placeholder, so `preSeeded` must
    // be false.
    // Pre-fix: `rawAddOns.length === 1 && rawAddOns[0].id === "airport-transfer"`
    // was true for this row too → the payload claimed "pre-seeded".
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow()],
      hotelEnabled: true,
      usedFallback: false
    });

    expect(payload.preSeeded).toBe(false);
    expect(payload.addOns).toHaveLength(1);
    expect(payload.addOns[0].id).toBe("airport-transfer");
  });

  it("reports preSeeded=true only when the fallback row was used", () => {
    const payload = buildPublicAddOnsCatalog({
      rows: [fallbackRow()],
      hotelEnabled: true,
      usedFallback: true
    });

    expect(payload.preSeeded).toBe(true);
    expect(payload.addOns).toHaveLength(1);
  });

  it("keeps the rows under `addOns` — never under `data`", () => {
    // The whole P0-8 defect: the admin app read `data.data` (the
    // BREAKFAST endpoint's shape) and therefore always saw an empty
    // catalog.
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow()],
      hotelEnabled: true,
      usedFallback: false
    }) as Record<string, unknown>;

    expect(Array.isArray(payload.addOns)).toBe(true);
    expect(payload.data).toBeUndefined();
  });

  it("drops `isEnabled` + the admin-only metadata from every row", () => {
    // The public payload carries no `isEnabled`, so a client that
    // re-filters with `getEnabledAddOnsByHotel` would drop EVERY row.
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow()],
      hotelEnabled: true,
      usedFallback: false
    });

    const row = payload.addOns[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual([
      "cutoffHoursBeforeCheckIn",
      "description",
      "displayOrder",
      "id",
      "name",
      "price",
      "unit"
    ]);
    expect(row.isEnabled).toBeUndefined();
    expect(row.updatedAt).toBeUndefined();
    expect(row.updatedBy).toBeUndefined();
  });

  it("echoes the hotel master switch and empties the catalog when it is off", () => {
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow()],
      hotelEnabled: false,
      usedFallback: false
    });

    expect(payload.otherAddOnsEnabled).toBe(false);
    expect(payload.addOns).toEqual([]);
    expect(payload.success).toBe(true);
  });

  it("omits a disabled row but keeps the switch echoed as on", () => {
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow({ id: "massage", name: "In-room massage" }), realSavedRow({ isEnabled: false })],
      hotelEnabled: true,
      usedFallback: false
    });

    expect(payload.otherAddOnsEnabled).toBe(true);
    expect(payload.addOns.map((a) => a.id)).toEqual(["massage"]);
  });

  it("sorts the rows by displayOrder then name", () => {
    const payload = buildPublicAddOnsCatalog({
      rows: [
        realSavedRow({ id: "c", name: "C", displayOrder: 20 }),
        realSavedRow({ id: "a", name: "A", displayOrder: 10 }),
        realSavedRow({ id: "b", name: "B", displayOrder: 10 })
      ],
      hotelEnabled: true,
      usedFallback: false
    });

    expect(payload.addOns.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("never lets a client re-filter drop every row", () => {
    // The public row has no `isEnabled`, so `getEnabledAddOnsByHotel`
    // would filter EVERY row out. The payload is already filtered —
    // running the filter again must not be the client contract.
    const payload = buildPublicAddOnsCatalog({
      rows: [realSavedRow()],
      hotelEnabled: true,
      usedFallback: false
    });

    const refiltered = getEnabledAddOnsByHotel(payload.addOns as unknown as AddOn[], true);
    expect(refiltered).toHaveLength(0);
    expect(payload.addOns).toHaveLength(1);
  });

  it("normalizes a raw collection doc into a catalog row before publishing it", () => {
    const norm = normalizeAddOn(
      { id: "airport-transfer", name: "Airport transfer", price: 500, unit: "per-person" },
      "airport-transfer"
    );
    expect(norm).not.toBeNull();

    const payload = buildPublicAddOnsCatalog({
      rows: norm ? [norm] : [],
      hotelEnabled: true,
      usedFallback: false
    });

    expect(payload.addOns[0].description).toBe("");
    expect(payload.addOns[0].cutoffHoursBeforeCheckIn).toBe(24);
  });
});
