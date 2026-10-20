// Per OCT-M1 (2026-10-20, decision #295): the hotel-wide
// "Add-ons enabled" master switch.
//
// The bug: the Settings → Other Add-Ons tab has shown a hotel-wide
// toggle since BR-12.1 (2026-10-15), but it was a bare
// `useState(true)` — no Firestore read, no write, no localStorage
// mirror — while the copy under it told the admin that turning it
// off would empty every `getEnabledAddOnsByHotel` call.
//
// The impact: an admin flips the switch off, believes add-ons are
// off sale, and guests keep buying the airport transfer.
//
// The fix: the switch persists to `settings/hotelConfig.otherAddOnsEnabled`
// and the public catalog endpoint + the guest Manage page + the guest
// save path all read it.
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// shared helpers) and the WIRING (source-text guards — the admin
// component and the server handlers cannot be mounted here because
// the repo has no jsdom/RTL harness for them).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getEnabledAddOnsByHotel,
  normalizeOtherAddOnsEnabled,
  OTHER_ADD_ONS_ENABLED_DEFAULT,
  type AddOn
} from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const settingsPageSrc = read("admin-app/src/pages/SettingsPage.tsx");
const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const addonsConfigSrc = read("guest-app/server/handlers/addons-config.ts");
const addonsManageSrc = read("guest-app/server/handlers/addons-manage.ts");
const addonsManageSaveSrc = read("guest-app/server/handlers/addons-manage-save.ts");
const settingsLibSrc = read("guest-app/server/lib/otherAddOns-settings.ts");

function addOn(overrides: Partial<AddOn> & { id: string }): AddOn {
  return {
    name: "Airport transfer",
    description: "",
    price: 500,
    unit: "per-person",
    isEnabled: true,
    cutoffHoursBeforeCheckIn: 24,
    displayOrder: 10,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "test",
    ...overrides
  } as AddOn;
}

describe("OCT-M1 — the master switch normalizer (runtime behaviour)", () => {
  it("defaults to ENABLED — a legacy doc without the field must not switch a hotel's revenue stream off", () => {
    expect(OTHER_ADD_ONS_ENABLED_DEFAULT).toBe(true);
    expect(normalizeOtherAddOnsEnabled(undefined)).toBe(true);
    expect(normalizeOtherAddOnsEnabled(null)).toBe(true);
    expect(normalizeOtherAddOnsEnabled({})).toBe(true);
  });

  it("an explicit false disables", () => {
    expect(normalizeOtherAddOnsEnabled(false)).toBe(false);
  });

  it("an explicit true enables", () => {
    expect(normalizeOtherAddOnsEnabled(true)).toBe(true);
  });

  it("a hand-edited string is read as the boolean it spells", () => {
    expect(normalizeOtherAddOnsEnabled("false")).toBe(false);
    expect(normalizeOtherAddOnsEnabled("False")).toBe(false);
    expect(normalizeOtherAddOnsEnabled("true")).toBe(true);
  });

  it("a nonsense value falls back to the safe default", () => {
    expect(normalizeOtherAddOnsEnabled("banana")).toBe(true);
    expect(normalizeOtherAddOnsEnabled(42)).toBe(true);
  });
});

describe("OCT-M1 — the master switch empties the catalog (runtime behaviour)", () => {
  const catalog = [
    addOn({ id: "airport-transfer", name: "Airport transfer", displayOrder: 10 }),
    addOn({ id: "seaport", name: "Seaport transfer", displayOrder: 20 })
  ];

  it("with the switch on, the enabled rows come through", () => {
    expect(getEnabledAddOnsByHotel(catalog, true)).toHaveLength(2);
  });

  it("with the switch OFF, the catalog is EMPTY even though every row is isEnabled", () => {
    const result = getEnabledAddOnsByHotel(catalog, false);
    expect(result).toEqual([]);
    // The regression: the rows ARE `isEnabled: true`, so a
    // per-row-only filter would have returned both.
    expect(catalog.every((a) => a.isEnabled === true)).toBe(true);
  });

  it("with the switch off, a per-row disabled row makes no difference", () => {
    const mixed = [addOn({ id: "on" }), addOn({ id: "off", isEnabled: false })];
    expect(getEnabledAddOnsByHotel(mixed, true)).toHaveLength(1);
    expect(getEnabledAddOnsByHotel(mixed, false)).toHaveLength(0);
  });

  it("the pre-OCT-M1 call shape (no second argument) keeps the old per-row-only behaviour", () => {
    // Every existing caller passes one argument — they must not
    // silently start seeing an empty catalog.
    expect(getEnabledAddOnsByHotel(catalog)).toHaveLength(2);
    expect(getEnabledAddOnsByHotel([addOn({ id: "off", isEnabled: false })])).toHaveLength(0);
  });
});

describe("OCT-M1 — the admin switch persists to hotelConfig (wiring)", () => {
  it("the switch state is NOT a bare useState(true) any more", () => {
    expect(settingsPageSrc).not.toMatch(/const \[addOnsEnabled, setAddOnsEnabled\] = useState\(true\)/);
    expect(settingsPageSrc).toMatch(
      /const \[addOnsEnabled, setAddOnsEnabled\] = useState\(\s*normalizeOtherAddOnsEnabled\(hotelConfig\.otherAddOnsEnabled\)\s*\)/
    );
  });

  it("the toggle writes the flag to settings/hotelConfig", () => {
    expect(settingsPageSrc).toMatch(/updateSettings\(\s*"hotelConfig",\s*\{\s*otherAddOnsEnabled: next\s*\}\s*\)/);
  });

  it("a failed write reverts the switch so the UI never shows an unsaved value", () => {
    expect(settingsPageSrc).toMatch(/if \(!ok\) \{\s*setAddOnsEnabled\(!next\)/);
  });

  it("the switch re-syncs from the live snapshot (a direct load of /settings would otherwise show the pre-snapshot default)", () => {
    expect(settingsPageSrc).toMatch(/addOnsEnabledSyncRef/);
    expect(settingsPageSrc).toMatch(/useEffect\(\(\) => \{\s*const next = normalizeOtherAddOnsEnabled\(hotelConfig\.otherAddOnsEnabled\)/);
  });

  it("the AdminContext hydrates + normalizes the flag", () => {
    expect(adminContextSrc).toMatch(/otherAddOnsEnabled: true/);
    expect(adminContextSrc).toMatch(
      /otherAddOnsEnabled: normalizeOtherAddOnsEnabled\(\(data as Partial<typeof hotelConfig>\)\?\.otherAddOnsEnabled\)/
    );
  });

  it("the copy no longer claims the switch is unwired", () => {
    expect(settingsPageSrc).not.toMatch(/Not yet wired up/);
  });
});

describe("OCT-M1 — the server reads the switch (wiring)", () => {
  it("there is ONE loader for the flag and it reads settings/hotelConfig", () => {
    expect(settingsLibSrc).toMatch(/collection\("settings"\)/);
    expect(settingsLibSrc).toMatch(/doc\("hotelConfig"\)/);
    expect(settingsLibSrc).toMatch(/normalizeOtherAddOnsEnabled/);
  });

  it("the catalog endpoint applies the switch", () => {
    expect(addonsConfigSrc).toMatch(/loadOtherAddOnsHotelEnabled\(\)/);
    expect(addonsConfigSrc).toMatch(/getEnabledAddOnsByHotel\(rawAddOns, hotelEnabled\)/);
    // The flag is echoed so the guest UI can tell "the hotel turned
    // other add-ons off" apart from "the hotel has no other add-ons".
    expect(addonsConfigSrc).toMatch(/otherAddOnsEnabled: hotelEnabled/);
  });

  it("the guest Manage page applies the switch", () => {
    expect(addonsManageSrc).toMatch(/loadOtherAddOnsHotelEnabled\(\)/);
    expect(addonsManageSrc).toMatch(/getEnabledAddOnsByHotel\(enabledAddOns, hotelEnabled\)/);
  });

  it("the GUEST save path refuses a purchase while the switch is off", () => {
    // Without this the guest UI hides the catalog but a direct POST
    // could still buy — the exact gap OCT-M1 describes.
    expect(addonsManageSaveSrc).toMatch(/loadOtherAddOnsHotelEnabled\(\)/);
    expect(addonsManageSaveSrc).toMatch(/if \(!hotelEnabled\) \{/);
    expect(addonsManageSaveSrc).toMatch(/OTHER_ADD_ONS_UNAVAILABLE_ERROR/);
  });

  it("the STAFF path stays open — the front desk override is deliberate", () => {
    expect(read("guest-app/server/handlers/addons-staff-update.ts")).not.toMatch(
      /loadOtherAddOnsHotelEnabled/
    );
  });
});
