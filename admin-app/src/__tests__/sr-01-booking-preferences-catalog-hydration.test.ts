// Per SR-01 follow-up (2026-11-18): the Booking Preferences tab must
// show the hotel's LIVE catalog, and its delete must actually stick.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The admin reported "I can't delete entries in Booking Preferences".
// Two independent causes shipped together:
//
//   1. THE TAB NEVER HYDRATED FROM THE LIVE SNAPSHOT.
//      `bedSetupsLoaded` / `bookingPreferencesLoaded` were flipped ONLY
//      inside `updateBedSetups` / `updateBookingPreferences` — i.e.
//      after the admin had ALREADY saved something. Nothing in the
//      `settings/hotelConfig` subscription ever flipped them, so the
//      hydration effect bailed out on every fresh page load and the tab
//      rendered the SEED catalogs instead of the hotel's lists.
//
//      Measured on production (2026-11-18): the live
//      `bookingPreferences` held 7 entries (two already deleted) and
//      `bedSetups` was `[]` (both already deleted), while the tab showed
//      the 9 seeded preferences and the 2 seeded bed set-ups.
//
//      Consequences: the delete filtered the SEED list, so the write
//      replaced the hotel's catalog with a seed-derived one — a
//      previously deleted entry RESURRECTED and any custom entry was
//      silently dropped. On the next page load the seed rendered again,
//      so the deleted row came back.
//
//   2. THE DELETE CONFIRM WAS A 3-SECOND "CLICK AGAIN" ARM.
//      RTS-05 (2026-08-01) already called this pattern out as a defect
//      in its own right for the room-type delete: "a user who clicks
//      Delete, reads the label change, hesitates past 3s, and clicks
//      again simply RE-ARMS it. Repeat indefinitely and nothing ever
//      deletes." The preferences tab still had it, and it routed BOTH
//      catalogs through one window event keyed by value — so a value
//      present in both catalogs armed the wrong one.
//
// THE FIX
// -------
//   1. The hydration follows the live snapshot, mirroring the RTS-06
//      room-types pattern (`roomTypesLoaded` flips INSIDE the sync
//      effect). An explicitly empty array means "the admin cleared it"
//      and renders the empty state; an absent field keeps the seed.
//      A write in flight owns the local state, so a stale snapshot echo
//      cannot resurrect the row that was just deleted.
//   2. The delete confirm is a Modal + ConfirmForm — the same pattern
//      the room-type delete already uses.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);
const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

describe("SR-01 follow-up — the catalogs follow the LIVE snapshot", () => {
  it("does NOT gate the hydration on the loaded flag", () => {
    // The historical bug: the effect bailed out unless the flag was
    // already true, and only an admin WRITE could set it.
    expect(adminContextSrc).not.toMatch(/if \(!bedSetupsLoaded\) return;/);
    expect(adminContextSrc).not.toMatch(/if \(!bookingPreferencesLoaded\) return;/);
  });

  it("flips the loaded flag INSIDE the snapshot effect (the RTS-06 pattern)", () => {
    expect(adminContextSrc).toMatch(
      /const \[bedSetupsLoaded, setBedSetupsLoaded\] = useState\(false\)/
    );
    expect(adminContextSrc).toMatch(
      /const \[bookingPreferencesLoaded, setBookingPreferencesLoaded\] = useState\(false\)/
    );
    // The flag must flip AFTER the catalog is written, in the same effect.
    const bedCatalogWrite = adminContextSrc.indexOf("setBedSetupsCatalog(");
    const bedFlag = adminContextSrc.indexOf("setBedSetupsLoaded(true)");
    expect(bedCatalogWrite).toBeGreaterThan(-1);
    expect(bedFlag).toBeGreaterThan(bedCatalogWrite);

    const prefCatalogWrite = adminContextSrc.indexOf("setBookingPreferencesCatalog(");
    const prefFlag = adminContextSrc.indexOf("setBookingPreferencesLoaded(true)");
    expect(prefCatalogWrite).toBeGreaterThan(-1);
    expect(prefFlag).toBeGreaterThan(prefCatalogWrite);
  });

  it("hydrates from the LIVE field, whatever its length", () => {
    // No `length > 0` guard: an explicitly empty array is a legitimate
    // state ("the admin cleared this catalog").
    expect(adminContextSrc).toMatch(
      /if \(!Array\.isArray\(liveBedSetups\)\) return;/
    );
    expect(adminContextSrc).toMatch(
      /if \(!Array\.isArray\(liveBookingPreferences\)\) return;/
    );
    expect(adminContextSrc).not.toMatch(
      /Array\.isArray\(liveBedSetups\) && liveBedSetups\.length > 0/
    );
    expect(adminContextSrc).not.toMatch(
      /Array\.isArray\(liveBookingPreferences\) && liveBookingPreferences\.length > 0/
    );
  });

  it("a write in flight owns the local state (no stale-snapshot resurrection)", () => {
    for (const name of ["bedSetups", "bookingPreferences"]) {
      const camel = name === "bedSetups" ? "bedSetups" : "bookingPreferences";
      expect(adminContextSrc).toMatch(
        new RegExp(`${camel}WriteInFlight\\.current = true`)
      );
      expect(adminContextSrc).toMatch(
        new RegExp(`if \\(${camel}WriteInFlight\\.current\\) return;`)
      );
      // The flag is released in a `finally`, so a FAILED write cannot
      // freeze the hydration forever.
      expect(adminContextSrc).toMatch(
        new RegExp(`finally \\{\\s*\\n\\s*${camel}WriteInFlight\\.current = false;`)
      );
    }
  });

  it("the seed is still the initial value (no blank first paint)", () => {
    expect(adminContextSrc).toMatch(
      /const \[bedSetupsCatalog, setBedSetupsCatalog\] = useState<BedSetupOption\[\]>\(\s*\n\s*\(\) => DEFAULT_BED_SETUPS\.map\(\(o\) => \(\{ \.\.\.o \}\)\)/
    );
    expect(adminContextSrc).toMatch(
      /DEFAULT_BOOKING_PREFERENCES\.map\(\(o\) => \(\{ \.\.\.o \}\)\)/
    );
  });
});

describe("SR-01 follow-up — the delete confirm is a Modal + ConfirmForm", () => {
  it("the 3-second click-again arm is gone", () => {
    // The arm state, its auto-disarm timer and the shared window event
    // are all removed.
    //
    // NOTE: the BOOKING SOURCES + PAYMENT METHODS editors in this same
    // file still carry the 3-second arm pattern (they are separate
    // features, out of scope for this fix). The assertions below are
    // scoped to the preferences catalogs — the strings they pin are
    // the ones only the preferences tab used.
    expect(settingsPageSrc).not.toMatch(/booking-preferences-arm-delete/);
    expect(settingsPageSrc).not.toMatch(/Click delete again within 3 seconds/);
    expect(settingsPageSrc).not.toMatch(/setBedSetupsPendingDelete/);
    expect(settingsPageSrc).not.toMatch(/setPrefsPendingDelete/);
  });

  it("both catalogs open a confirm modal", () => {
    expect(settingsPageSrc).toMatch(/testId="delete-bed-setup-confirm"/);
    expect(settingsPageSrc).toMatch(/testId="delete-booking-preference-confirm"/);
    expect(settingsPageSrc).toMatch(/variant="danger"/);
    expect(settingsPageSrc).toMatch(/onDelete=\{\(entry\) => setPendingDeleteBedSetup\(entry\)\}/);
    expect(settingsPageSrc).toMatch(/onDelete=\{\(entry\) => setPendingDeletePreference\(entry\)\}/);
  });

  it("the delete filters the LIVE catalog list", () => {
    expect(settingsPageSrc).toMatch(
      /onUpdateBookingPreferences\(bookingPreferences\.filter\(\(p\) => p\.value !== entry\.value\)\)/
    );
    expect(settingsPageSrc).toMatch(
      /onUpdateBedSetups\(bedSetups\.filter\(\(b\) => b\.value !== entry\.value\)\)/
    );
  });

  it("the modal closes only after the write succeeds", () => {
    expect(settingsPageSrc).toMatch(
      /await onUpdateBookingPreferences\([\s\S]{0,200}setPendingDeletePreference\(null\);/
    );
    expect(settingsPageSrc).toMatch(
      /await onUpdateBedSetups\([\s\S]{0,200}setPendingDeleteBedSetup\(null\);/
    );
  });
});
