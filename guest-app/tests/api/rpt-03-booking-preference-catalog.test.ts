// Per RPT-03 (QA pass 2026-10-21): ticking a single preference chip
// made the guest booking fail with a 500.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// Step 2 of the booking flow renders a grid of "additional
// preferences" chips. The client hydrates that grid from
// `hotelConfig.bookingPreferences` — but WITH A FALLBACK:
// `hydrateBookingPreferenceCatalog` in
// `guest-app/src/hooks/useRoomTypes.ts` returns
// `DEFAULT_BOOKING_PREFERENCES` (9 chips) when the live catalog is
// empty or holds no usable entry.
//
// The server had no such fallback. It built the allowed-value list
// straight off `hotelConfig.bookingPreferences` — EMPTY for every
// hotel that never configured it — and threw
// "Selected preferences are not configured: <key>" for every key the
// guest ticked. The throw happens INSIDE the create transaction, so
// the whole booking failed.
//
// Production on 2026-10-21: `settings/hotelConfig` had NO
// `bookingPreferences` field at all. So the client rendered nine
// chips and the server rejected all nine.
//
// THE FIX
// -------
// One shared resolver, `resolveBookingPreferenceValues`, used by the
// server. The client already falls back to the same
// `DEFAULT_BOOKING_PREFERENCES` constant, so the two now cannot
// disagree.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBookingPreferenceValues } from "@spark-inn/shared";
import { DEFAULT_BOOKING_PREFERENCES } from "../../../shared/constants";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const defaultValues = DEFAULT_BOOKING_PREFERENCES.map((option) => option.value);

describe("RPT-03 — the preference catalog resolver", () => {
  it("falls back to the shipped defaults when the hotel has NOT configured the list", () => {
    // This is production's exact state: `bookingPreferences` is
    // `undefined` on the hotelConfig doc.
    expect(resolveBookingPreferenceValues(undefined)).toEqual(defaultValues);
  });

  it("falls back to the shipped defaults for an empty array", () => {
    expect(resolveBookingPreferenceValues([])).toEqual(defaultValues);
  });

  it("falls back to the shipped defaults when the array holds no usable entry", () => {
    expect(resolveBookingPreferenceValues([null, undefined, 42, "nope"])).toEqual(defaultValues);
  });

  it("uses the admin's explicit catalog when one is configured", () => {
    const configured = [
      { value: "high-floor", label: "High floor" },
      { value: "quiet-room", label: "Quiet room" }
    ];
    expect(resolveBookingPreferenceValues(configured)).toEqual(["high-floor", "quiet-room"]);
  });

  it("does NOT fall back when the admin configured an empty-value list — an explicit list wins", () => {
    // A configured list with one entry must NOT silently expand to
    // the 9 defaults: that would let a guest tick a chip the admin
    // removed.
    expect(resolveBookingPreferenceValues([{ value: "car-parking", label: "Car parking" }]))
      .toEqual(["car-parking"]);
  });

  it("skips entries with no string `value` but keeps the usable ones", () => {
    const mixed = [
      { value: "high-floor", label: "High floor" },
      { label: "No value at all" },
      { value: 7, label: "Numeric value" }
    ];
    expect(resolveBookingPreferenceValues(mixed)).toEqual(["high-floor"]);
  });

  it("resolves to a non-empty list in every case (the server must never reject a rendered chip)", () => {
    const cases: unknown[] = [undefined, null, [], "nope", 42, {}, [{}], [null]];
    for (const input of cases) {
      expect(resolveBookingPreferenceValues(input).length).toBeGreaterThan(0);
    }
  });

  it("the shipped defaults are the ones the guest client renders", () => {
    // The client's fallback is `DEFAULT_BOOKING_PREFERENCES`; the
    // server's fallback must be the SAME list, or the two diverge
    // again.
    const clientHookSrc = readFileSync(
      resolve(__dirname, "../../src/hooks/useRoomTypes.ts"),
      "utf8"
    );
    expect(clientHookSrc).toMatch(/DEFAULT_BOOKING_PREFERENCES/);
    expect(defaultValues).toContain("baby-cot");
    expect(defaultValues).toContain("high-floor");
  });
});

describe("RPT-03 — the booking handler uses the shared resolver (tripwire)", () => {
  it("resolves the allowed-value catalog through the shared helper", () => {
    expect(bookingsHandlerSrc).toMatch(
      /bookingPreferencesCatalog:\s*string\[\]\s*=\s*resolveBookingPreferenceValues\(/
    );
  });

  it("imports the shared resolver", () => {
    expect(bookingsHandlerSrc).toMatch(/import\s*\{[^}]*resolveBookingPreferenceValues[^}]*\}\s*from\s*"@spark-inn\/shared"/);
  });

  it("no longer builds the catalog from the raw config field", () => {
    // The old form built the list inline with no fallback — that is
    // the defect.
    expect(bookingsHandlerSrc).not.toMatch(
      /bookingPreferencesCatalog:\s*string\[\]\s*=\s*Array\.isArray\(\s*hotelConfig\.bookingPreferences/
    );
  });
});
