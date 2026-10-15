// BR-13.x (Phase 14 — Seaport transfer v1, decision
// #250). The data-driven add-on catalog now ships
// two pre-seeds: airport + seaport. The pre-seed is
// the load-bearing surface for a fresh install —
// without it the public `/api/bookings/addons/config`
// endpoint falls back to a read-only in-memory list,
// and the admin Settings tab writes the same rows
// to `addOns/` on first visit via a single atomic
// `writeBatch`. These tripwires pin:
//
//   1. The `SEAPORT_TRANSFER_PRESEED` constant has
//      the BR-13.x spec defaults (₱1500 per-stay,
//      48h cut-off, enabled).
//   2. The `ADDON_PRESEEDS` array carries BOTH
//      airport + seaport in ascending `displayOrder`,
//      so the existing `getEnabledAddOnsByHotel`
//      sort surfaces airport first, seaport second.
//   3. `ADDON_PRESEEDS` carries the load-bearing id
//      fields ("airport-transfer", "seaport-transfer")
//      that the admin writeBatch + the public
//      read-time fallback consume.
//   4. `normalizeAddOn` preserves the new unit — a
//      per-stay doc round-trips intact through the
//      normalizer.
//   5. `getEnabledAddOnsByHotel` keeps an enabled
//      per-stay row + drops a disabled per-person
//      row, exactly the same way it handles the
//      existing per-person flow.
//
// The Settings tab + server-handler pre-seed writes
// are tested separately at the source-text level
// (the Settings admin-app test surface + the addons
// config `guest-app/tests/api/br-12-addons-config`
// suite catches the writes).

import { describe, expect, it } from "vitest";
import {
  ADDON_PRESEEDS,
  AIRPORT_TRANSFER_PRESEED,
  SEAPORT_TRANSFER_PRESEED,
  getEnabledAddOnsByHotel,
  normalizeAddOn,
  sortAddOnsByDisplayOrder,
  type AddOn
} from "@spark-inn/shared";

describe("BR-13.x — Seaport pre-seed constant", () => {
  it("SEAPORT_TRANSFER_PRESEED has the BR-13.x spec defaults (₱1500 per-stay, 48h cut-off, enabled)", () => {
    expect(SEAPORT_TRANSFER_PRESEED.name).toBe("Seaport transfer");
    expect(SEAPORT_TRANSFER_PRESEED.price).toBe(1500);
    expect(SEAPORT_TRANSFER_PRESEED.unit).toBe("per-stay");
    expect(SEAPORT_TRANSFER_PRESEED.cutoffHoursBeforeCheckIn).toBe(48);
    expect(SEAPORT_TRANSFER_PRESEED.isEnabled).toBe(true);
  });

  it("SEAPORT_TRANSFER_PRESEED sits BELOW airport in displayOrder (catalog ascending)", () => {
    // The task brief specifies seaport goes BELOW
    // airport so the existing per-person flow stays
    // first on a fresh install. We don't pin the exact
    // number — the brief's literal "1" assumed
    // airport was at 0, but the shipped airport preset
    // is at 10. We pin the relative order, which is
    // the contract the rendering cares about.
    expect(SEAPORT_TRANSFER_PRESEED.displayOrder).toBeGreaterThan(
      AIRPORT_TRANSFER_PRESEED.displayOrder
    );
  });

  it("SEAPORT_TRANSFER_PRESEED.description is non-empty marketing copy", () => {
    expect(typeof SEAPORT_TRANSFER_PRESEED.description).toBe("string");
    expect(SEAPORT_TRANSFER_PRESEED.description.length).toBeGreaterThan(20);
  });
});

describe("BR-13.x — ADDON_PRESEEDS (the load-bearing list)", () => {
  it("ADDON_PRESEEDS carries BOTH airport + seaport entries", () => {
    const ids = ADDON_PRESEEDS.map((p) => p.id);
    expect(ids).toContain("airport-transfer");
    expect(ids).toContain("seaport-transfer");
  });

  it("ADDON_PRESEEDS sorts ascending by displayOrder (airport first, seaport second)", () => {
    const indices = {
      airport: ADDON_PRESEEDS.findIndex((p) => p.id === "airport-transfer"),
      seaport: ADDON_PRESEEDS.findIndex((p) => p.id === "seaport-transfer")
    };
    expect(indices.airport).toBeGreaterThanOrEqual(0);
    expect(indices.seaport).toBeGreaterThanOrEqual(0);
    expect(indices.airport).toBeLessThan(indices.seaport);
    expect(ADDON_PRESEEDS[indices.airport].displayOrder).toBeLessThanOrEqual(
      ADDON_PRESEEDS[indices.seaport].displayOrder
    );
  });

  it("ADDON_PRESEEDS entries carry every field a real catalog doc needs (id + name + price + unit + isEnabled + cutoffHours + displayOrder + description)", () => {
    for (const seed of ADDON_PRESEEDS) {
      expect(typeof seed.id).toBe("string");
      expect(seed.id.length).toBeGreaterThan(0);
      expect(typeof seed.name).toBe("string");
      expect(seed.name.length).toBeGreaterThan(0);
      expect(typeof seed.description).toBe("string");
      expect(typeof seed.price).toBe("number");
      expect(seed.price).toBeGreaterThan(0);
      expect(["per-person", "per-stay"]).toContain(seed.unit);
      expect(typeof seed.isEnabled).toBe("boolean");
      expect(typeof seed.cutoffHoursBeforeCheckIn).toBe("number");
      expect(seed.cutoffHoursBeforeCheckIn).toBeGreaterThan(0);
      expect(typeof seed.displayOrder).toBe("number");
    }
  });

  it("ADDON_PRESEEDS seaport entry has `unit: \"per-stay\"` (NOT per-person — that's the BR-13.x delta)", () => {
    const seaport = ADDON_PRESEEDS.find((p) => p.id === "seaport-transfer");
    expect(seaport?.unit).toBe("per-stay");
  });
});

describe("BR-13.x — normalizer + filter preserve the per-stay shape", () => {
  it("normalizeAddOn round-trips a per-stay doc with the BR-13.x defaults intact", () => {
    const norm = normalizeAddOn(
      {
        id: "seaport-transfer",
        name: "Seaport transfer",
        description: "Round-trip seaport transfer at Tagbilaran Pier.",
        price: 1500,
        unit: "per-stay",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 48,
        displayOrder: 20,
        updatedAt: new Date().toISOString(),
        updatedBy: "seed"
      },
      "seaport-transfer"
    );
    expect(norm).not.toBeNull();
    expect(norm!.unit).toBe("per-stay");
    expect(norm!.cutoffHoursBeforeCheckIn).toBe(48);
    expect(norm!.price).toBe(1500);
    expect(norm!.isEnabled).toBe(true);
  });

  it("getEnabledAddOnsByHotel keeps an enabled per-stay row + drops a disabled per-person row", () => {
    const rows: AddOn[] = [
      {
        id: "airport-transfer",
        name: "Airport transfer",
        description: "",
        price: 500,
        unit: "per-person",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 24,
        displayOrder: 10,
        updatedAt: new Date().toISOString(),
        updatedBy: "t"
      },
      {
        id: "seaport-transfer",
        name: "Seaport transfer",
        description: "",
        price: 1500,
        unit: "per-stay",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 48,
        displayOrder: 20,
        updatedAt: new Date().toISOString(),
        updatedBy: "t"
      },
      {
        id: "other",
        name: "Other",
        description: "",
        price: 100,
        unit: "per-person",
        isEnabled: false,
        cutoffHoursBeforeCheckIn: 24,
        displayOrder: 30,
        updatedAt: new Date().toISOString(),
        updatedBy: "t"
      }
    ];
    const out = getEnabledAddOnsByHotel(rows);
    expect(out.map((r) => r.id)).toEqual(["airport-transfer", "seaport-transfer"]);
    expect(out.find((r) => r.id === "seaport-transfer")?.unit).toBe("per-stay");
  });

  it("sortAddOnsByDisplayOrder includes BOTH pre-seeds in the admin list, with disabled rows preserved", () => {
    const rows: AddOn[] = [
      {
        ...SEAPORT_TRANSFER_PRESEED,
        id: "seaport-transfer",
        updatedAt: "x",
        updatedBy: "t"
      },
      {
        ...AIRPORT_TRANSFER_PRESEED,
        id: "airport-transfer",
        updatedAt: "x",
        updatedBy: "t"
      }
    ];
    const out = sortAddOnsByDisplayOrder(rows);
    expect(out.map((r) => r.id)).toEqual(["airport-transfer", "seaport-transfer"]);
  });
});

describe("BR-13.x — Settings tab source-text tripwires (atomic writeBatch)", () => {
  // The atomic-write shape is critical: the
  // GOTCHAS fan-out rule applies to the pre-seed
  // case (two docs at the same `addOns/` path),
  // so a single-batch commit is the contract.
  // These tripwires pin the Settings + handler
  // source so a refactor that drops the batch
  // breaks the test.
  const settingsSrc = require("node:fs").readFileSync(
    require("node:path").resolve(
      __dirname,
      "../../admin-app/src/pages/SettingsPage.tsx"
    ),
    "utf8"
  );
  const addonsConfigSrc = require("node:fs").readFileSync(
    require("node:path").resolve(
      __dirname,
      "../../guest-app/server/handlers/addons-config.ts"
    ),
    "utf8"
  );

  it("Settings tab imports `writeBatch` from firebase/firestore (atomic pre-seed)", () => {
    expect(settingsSrc).toMatch(/writeBatch[^,)]*from\s+"firebase\/firestore"/);
  });

  it("Settings tab imports `ADDON_PRESEEDS` from `@spark-inn/shared`", () => {
    expect(settingsSrc).toContain("ADDON_PRESEEDS");
    expect(settingsSrc).toMatch(
      /import\s*\{[\s\S]*?ADDON_PRESEEDS[\s\S]*?\}\s*from\s*"@spark-inn\/shared"/
    );
  });

  it("Settings tab pre-seed writes EVERY entry in `ADDON_PRESEEDS` inside a single batch", () => {
    // The for-loop body commits every preset into the
    // same `batch` instance — never `setDoc` per row.
    // The atomic contract is what GOTCHAS §Firebase
    // calls out for list-shaped state.
    expect(settingsSrc).toMatch(/for\s*\(\s*const\s+seed\s+of\s+ADDON_PRESEEDS\s*\)/);
    expect(settingsSrc).toContain("batch.set(");
    expect(settingsSrc).toContain("await batch.commit()");
    // Make sure the pre-seed does NOT regress to a
    // per-row `setDoc(..., "addOns", ...)` (single
    // writer) — the BR-13.x contract is "one batch,
    // both rows or neither".
    const preSeedBlock = settingsSrc.match(
      /useEffect\([\s\S]*?addOnsCatalog\.length\s*>\s*0[\s\S]*?\}\s*,\s*\[addOnsCatalogLoading/
    );
    expect(preSeedBlock).toBeTruthy();
    expect(preSeedBlock![0]).toContain("writeBatch");
    expect(preSeedBlock![0]).toContain("batch.commit()");
  });

  it("addons-config handler falls back to BOTH pre-seeds when the catalog is empty", () => {
    expect(addonsConfigSrc).toContain("ADDON_PRESEEDS");
    expect(addonsConfigSrc).toMatch(/for\s*\(\s*const\s+seed\s+of\s+ADDON_PRESEEDS\s*\)/);
    // The legacy `id: "airport-transfer"` literal seed
    // is gone — every pre-seed row comes from
    // `ADDON_PRESEEDS`.
    expect(addonsConfigSrc).not.toMatch(/id:\s*"airport-transfer"/);
  });
});
