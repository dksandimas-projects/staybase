// BR-13.x (Phase 14 — Seaport transfer v1, decision
// #250). The render-time branch between per-person +
// per-stay add-ons lives in a single shared helper
// (`getSelectionKeysForAddOn`). The data model —
// `Record<dateKey, OtherAddOnSelectionEntry[]>` — is
// shared, so the UI surfaces (`WalkinOtherAddOnGrid`
// + `BookingDrawerOtherAddOnsTab`) stay data-driven;
// the rendering loop just hides the per-stay row on
// any non-check-in date.
//
// Tripwires:
//   1. `getSelectionKeysForAddOn` returns every stay
//      date for per-person, and `[checkIn]` only for
//      per-stay.
//   2. The helper handles edge cases: 1-night
//      per-person (1 key), single-day per-stay
//      (1 key, same date), zero-length range
//      (seaport semantics), missing add-on (seaport
//      fallback semantics).
//   3. The walk-in grid + the booking-drawer tab
//      BOTH source the key set from the same helper
//      — a divergent render path would surface as
//      "seaport shows on the wrong date in surface
//      A but correct in surface B".
//   4. The walk-in grid + the booking drawer "Add
//      Row" filter their available add-ons by the
//      helper's key set, so a per-stay row never
//      appears in the "add" select on a non-check-in
//      date.

import { describe, expect, it } from "vitest";
import {
  getSelectionKeysForAddOn,
  recomputeOtherAddOnTotal,
  type AddOn,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const walkinGrid = existsSync(
  resolve(
    repoRoot,
    "admin-app/src/components/otherAddOns/WalkinOtherAddOnGrid.tsx"
  )
)
  ? read("admin-app/src/components/otherAddOns/WalkinOtherAddOnGrid.tsx")
  : "";
const drawerSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const preset = {
  unit: "per-stay",
  isEnabled: true,
  cutoffHoursBeforeCheckIn: 48,
  displayOrder: 20,
  price: 1500
} as Pick<AddOn, "unit" | "isEnabled" | "cutoffHoursBeforeCheckIn" | "displayOrder" | "price">;
const perPersonPreset = {
  unit: "per-person",
  isEnabled: true,
  cutoffHoursBeforeCheckIn: 24,
  displayOrder: 10,
  price: 500
} as Pick<AddOn, "unit" | "isEnabled" | "cutoffHoursBeforeCheckIn" | "displayOrder" | "price">;

const asAddOn = (p: Pick<AddOn, "unit">, id: string): AddOn => ({
  ...preset,
  id,
  name: id,
  description: ""
});
const perPersonAddOn = (id: string): AddOn => ({
  ...perPersonPreset,
  id,
  name: id,
  description: ""
});

describe("BR-13.x — getSelectionKeysForAddOn (the render-time branch)", () => {
  it("returns EVERY stay date for per-person (3-night booking = 3 keys)", () => {
    const keys = getSelectionKeysForAddOn(
      perPersonAddOn("airport-transfer"),
      "2026-12-01",
      "2026-12-04"
    );
    expect(keys).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
  });

  it("returns JUST checkIn for per-stay (1-night booking = 1 key)", () => {
    const keys = getSelectionKeysForAddOn(
      asAddOn(preset, "seaport-transfer"),
      "2026-12-01",
      "2026-12-02"
    );
    expect(keys).toEqual(["2026-12-01"]);
  });

  it("returns JUST checkIn for per-stay on a multi-night booking (still 1 key, attached to check-in)", () => {
    const keys = getSelectionKeysForAddOn(
      asAddOn(preset, "seaport-transfer"),
      "2026-12-01",
      "2026-12-08"
    );
    expect(keys).toEqual(["2026-12-01"]);
  });

  it("handles a 1-night per-person booking (returns 1 key)", () => {
    const keys = getSelectionKeysForAddOn(
      perPersonAddOn("airport-transfer"),
      "2026-12-01",
      "2026-12-02"
    );
    expect(keys).toEqual(["2026-12-01"]);
  });

  it("falls back to per-person semantics when the add-on is null / missing (defensive)", () => {
    // Per the helper's contract: the legacy per-person
    // surface is the safe fallback. A corrupted catalog
    // row MUST NOT blank the UI — it must fall back to
    // the same shape every prior BR-12 surface shipped.
    const keys = getSelectionKeysForAddOn(
      null,
      "2026-12-01",
      "2026-12-04"
    );
    expect(keys).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
  });

  it("returns an empty array when checkIn is missing (defensive)", () => {
    const keys = getSelectionKeysForAddOn(
      perPersonAddOn("airport-transfer"),
      "",
      "2026-12-04"
    );
    expect(keys).toEqual([]);
  });

  it("returns [checkIn] for per-stay when checkOut is missing (the safe default)", () => {
    const keys = getSelectionKeysForAddOn(
      asAddOn(preset, "seaport-transfer"),
      "2026-12-01",
      ""
    );
    expect(keys).toEqual(["2026-12-01"]);
  });

  it("the per-stay key set excludes checkout date (overnight stays don't double-count the last night)", () => {
    const keys = getSelectionKeysForAddOn(
      asAddOn(preset, "seaport-transfer"),
      "2026-12-01",
      "2026-12-04"
    );
    expect(keys).not.toContain("2026-12-04");
  });

  it("the per-stay helper result is identical for callers that DON'T pass an add-on vs a per-person add-on (legacy safety)", () => {
    const a = getSelectionKeysForAddOn(null, "2026-12-01", "2026-12-03");
    const b = getSelectionKeysForAddOn(
      perPersonAddOn("airport-transfer"),
      "2026-12-01",
      "2026-12-03"
    );
    expect(a).toEqual(b);
  });
});

describe("BR-13.x — data model still totals per-stay entries correctly", () => {
  it("recomputeOtherAddOnTotal sums per-stay entries attached to check-in only", () => {
    const checkIn: OtherAddOnSelectionEntry = {
      addOnId: "seaport-transfer",
      nameSnapshot: "Seaport transfer",
      priceSnapshot: 1500,
      quantity: 1,
      unitSnapshot: "per-stay",
      addedAt: "x",
      addedBy: "guest",
      lastModifiedAt: "x",
      lastModifiedBy: "guest",
      removedAt: null,
      removedBy: null,
      cutoffHoursBeforeCheckInSnapshot: 48
    };
    const selections = { "2026-12-01": [checkIn] };
    expect(recomputeOtherAddOnTotal(selections)).toBe(1500);
  });

  it("mixed per-person + per-stay booking totals both (airport ₱500×2×2 dates + seaport ₱1500 = ₱3500)", () => {
    const airport = {
      addOnId: "airport-transfer",
      nameSnapshot: "Airport transfer",
      priceSnapshot: 500,
      quantity: 2,
      unitSnapshot: "per-person" as const,
      addedAt: "x",
      addedBy: "guest",
      lastModifiedAt: "x",
      lastModifiedBy: "guest",
      removedAt: null,
      removedBy: null,
      cutoffHoursBeforeCheckInSnapshot: 24
    };
    const seaport = {
      addOnId: "seaport-transfer",
      nameSnapshot: "Seaport transfer",
      priceSnapshot: 1500,
      quantity: 1,
      unitSnapshot: "per-stay" as const,
      addedAt: "x",
      addedBy: "guest",
      lastModifiedAt: "x",
      lastModifiedBy: "guest",
      removedAt: null,
      removedBy: null,
      cutoffHoursBeforeCheckInSnapshot: 48
    };
    const selections = {
      "2026-12-01": [airport, seaport],
      "2026-12-02": [airport]
    };
    // 500*2 guests * 2 dates (airport) + 1500*1 (seaport, attached to check-in)
    // = 2000 + 1500 = 3500
    expect(recomputeOtherAddOnTotal(selections)).toBe(3500);
  });
});

describe("BR-13.x — WalkinOtherAddOnGrid branches on addOn.unit", () => {
  it("imports `getSelectionKeysForAddOn` from @spark-inn/shared", () => {
    // Multi-line named-import + `type AddOn` + closing
    // brace on its own line — the helper just has to
    // appear inside the import block for `@spark-inn/shared`.
    expect(walkinGrid).toMatch(
      /import\s*\{[\s\S]*?getSelectionKeysForAddOn[\s\S]*?\}\s*from\s*"@spark-inn\/shared"/
    );
  });

  it("computes a `keySetByAddOnId` memo (per-addOnId key set)", () => {
    expect(walkinGrid).toContain("keySetByAddOnId");
    expect(walkinGrid).toMatch(
      /keySetByAddOnId[^=]*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?getSelectionKeysForAddOn\(/
    );
  });

  it("filters the \"add\" select's `available` add-ons by the key set (so per-stay rows don't show on non-check-in dates)", () => {
    // The filter must intersect (catalog not on day)
    // AND (addOn is valid for this date). The original
    // BR-12.1 ship only had the first half.
    const block = walkinGrid.match(
      /const available\s*=\s*addOns\.filter\([\s\S]*?\);\s*$/m
    );
    expect(block).toBeTruthy();
    expect(block![0]).toContain("keySetByAddOnId");
    expect(block![0]).toMatch(/includes\(date\)/);
  });

  it("caps the per-row quantity input at 1 for per-stay entries (input `max` attribute)", () => {
    // The conditional qtyMax flow lives inside the
    // per-entry render map. We assert the literal
    // branch + the rendered numeric max.
    expect(walkinGrid).toMatch(/qtyMax\s*=\s*cat\.unit\s*===\s*"per-stay"\s*\?\s*1\s*:\s*maxGuests/);
    expect(walkinGrid).toContain("max={qtyMax}");
  });
});

describe("BR-13.x — BookingDrawerOtherAddOnsTab branches on addOn.unit", () => {
  it("imports `getSelectionKeysForAddOn` from @spark-inn/shared", () => {
    expect(drawerSrc).toMatch(
      /import\s*\{[\s\S]*?getSelectionKeysForAddOn[\s\S]*?\}\s*from\s*"@spark-inn\/shared"/
    );
  });

  it("computes a `keySetByAddOnId` memo inside BookingDrawerOtherAddOnsTab", () => {
    // Find the function body of the tab and assert the
    // memo is in the same scope as `dates`.
    const tabBody = drawerSrc.match(
      /BookingDrawerOtherAddOnsTab[\s\S]*?function OtherAddOnAddRow\(/
    );
    expect(tabBody).toBeTruthy();
    expect(tabBody![0]).toMatch(
      /keySetByAddOnId[^=]*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?getSelectionKeysForAddOn\(/
    );
  });

  it("threads `allowedAddOnIdsForDate` into `OtherAddOnAddRow`", () => {
    expect(drawerSrc).toContain("allowedAddOnIdsForDate={");
    expect(drawerSrc).toContain("allowed.has(a.id)");
    // The setter lives inside `OtherAddOnAddRow`.
    const idx = drawerSrc.indexOf("function OtherAddOnAddRow(");
    expect(idx).toBeGreaterThan(-1);
    const fnBody = drawerSrc.slice(idx);
    expect(fnBody).toContain("allowedAddOnIdsForDate");
    expect(fnBody).toContain("allowed.has(a.id)");
  });

  it("caps per-stay row quantity at 1 in the entry-render branch (handleQuantityChange)", () => {
    // The clamp inside `handleQuantityChange` reads the
    // add-on's unit, not a hard-coded 50.
    expect(drawerSrc).toMatch(
      /const\s+cap\s*=\s*addOn\.unit\s*===\s*"per-stay"\s*\?\s*1\s*:\s*50/
    );
  });

  it("caps per-stay add quantity at 1 in the handleAdd branch", () => {
    expect(drawerSrc).toMatch(
      /const\s+cap\s*=\s*cat\.unit\s*===\s*"per-stay"\s*\?\s*1\s*:\s*50/
    );
  });
});
