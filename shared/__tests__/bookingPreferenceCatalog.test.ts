// Per SR-01 follow-up (2026-11-18): the booking-preference catalogs
// must tell ABSENT from EXPLICITLY EMPTY.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The admin's Booking Preferences tab could not delete entries: the
// deleted row came back on the next page load, and the guest booking
// form kept offering options the hotel had removed.
//
// Two independent causes:
//   1. The ADMIN tab never hydrated from the live snapshot (the
//      `bedSetupsLoaded` / `bookingPreferencesLoaded` flags only flipped
//      after an admin write), so it rendered the SEED catalog and every
//      delete wrote the seed-derived list over the hotel's real one.
//      Pinned in
//      `admin-app/src/__tests__/sr-01-booking-preferences-catalog-hydration.test.ts`.
//   2. "EMPTY" was indistinguishable from "NOT CONFIGURED": the guest
//      client AND the public projection collapsed both states into
//      `[]`, and the client then fell back to the shipped defaults. So
//      deleting every entry was a no-op on the public booking form.
//
// THE RULE
// --------
//   ABSENT  (the field is not on the doc)  -> the shipped defaults
//   EMPTY   (`[]` on the doc)               -> nothing
//
// The SERVER resolver stays PERMISSIVE for an empty catalog — it must
// never reject a key a guest could have ticked from a stale page,
// because that rejection happens inside the create transaction and
// surfaces as a 500 (NO-ID-A68). The client hides what the hotel
// removed; the server accepts a stale key rather than failing a live
// booking. The last two tests pin that asymmetry on purpose.

import { describe, expect, test } from "vitest";
import {
  DEFAULT_BED_SETUPS,
  DEFAULT_BOOKING_PREFERENCES
} from "../constants";
import {
  resolveBedSetupOptions,
  resolveBookingPreferenceOptions,
  resolveBookingPreferenceValues
} from "../utils/bookingPreferences";

describe("resolveBookingPreferenceOptions — the DISPLAY catalog", () => {
  test("an ABSENT catalog falls back to the shipped defaults", () => {
    // A fresh project has no `bookingPreferences` field at all.
    expect(resolveBookingPreferenceOptions(undefined)).toEqual(
      DEFAULT_BOOKING_PREFERENCES.map((o) => ({ ...o }))
    );
  });

  test("an EXPLICITLY EMPTY catalog renders NOTHING", () => {
    // This is the case the defect made impossible: the hotel deleted
    // every entry, and the nine shipped chips came back.
    expect(resolveBookingPreferenceOptions([])).toEqual([]);
  });

  test("the admin's configured catalog is used verbatim", () => {
    const configured = [
      { value: "quiet-room", label: "I'd like a quiet room" },
      { value: "car-parking", label: "I'd like car parking", surchargeNote: "(extra)" }
    ];
    expect(resolveBookingPreferenceOptions(configured)).toEqual(configured);
  });

  test("a malformed entry is skipped, the usable ones survive", () => {
    const mixed = [
      { value: "quiet-room", label: "Quiet room" },
      { label: "No value" },
      { value: 7, label: "Numeric value" },
      null,
      "nope"
    ];
    expect(resolveBookingPreferenceOptions(mixed)).toEqual([
      { value: "quiet-room", label: "Quiet room", icon: undefined, surchargeNote: undefined }
    ]);
  });

  test("an array that holds no usable entry renders NOTHING (it is not 'absent')", () => {
    expect(resolveBookingPreferenceOptions([null, undefined, 42])).toEqual([]);
  });
});

describe("resolveBedSetupOptions — the DISPLAY catalog", () => {
  test("an ABSENT catalog falls back to the shipped defaults", () => {
    expect(resolveBedSetupOptions(undefined)).toEqual(
      DEFAULT_BED_SETUPS.map((o) => ({ ...o }))
    );
  });

  test("an EXPLICITLY EMPTY catalog renders NOTHING", () => {
    // Production on 2026-11-18: `hotelConfig.bedSetups` was `[]` (the
    // admin had deleted both set-ups) and the guest Step 3 still
    // offered "I'd like a large bed" / "I'd like twin beds".
    expect(resolveBedSetupOptions([])).toEqual([]);
  });

  test("the admin's configured catalog is used verbatim", () => {
    const configured = [{ value: "large-bed", label: "Large bed", icon: "bed" }];
    expect(resolveBedSetupOptions(configured)).toEqual(configured);
  });
});

describe("the server resolver stays PERMISSIVE (deliberate asymmetry)", () => {
  test("resolveBookingPreferenceValues([]) still falls back to the defaults", () => {
    // The server must never reject a chip the guest could have rendered
    // from a stale page. RPT-03 pinned this: the rejection happens
    // INSIDE the create transaction and surfaces as a 500.
    expect(resolveBookingPreferenceValues([])).toEqual(
      DEFAULT_BOOKING_PREFERENCES.map((o) => o.value)
    );
  });

  test("resolveBookingPreferenceValues(undefined) still falls back to the defaults", () => {
    expect(resolveBookingPreferenceValues(undefined)).toEqual(
      DEFAULT_BOOKING_PREFERENCES.map((o) => o.value)
    );
  });
});
