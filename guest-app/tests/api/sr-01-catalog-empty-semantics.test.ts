// Per SR-01 follow-up (2026-11-18): the PUBLIC projection must not
// flatten "the hotel never configured this catalog" into "the hotel
// cleared this catalog".
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `buildBedSetups` / `buildBookingPreferences` returned `[]` for an
// ABSENT field (the same value they return for an explicitly empty
// array). Downstream, the guest client treated an empty array as
// "not configured" and fell back to the shipped defaults — so a hotel
// that deleted every preference chip still saw the nine shipped chips
// on the public booking form. The two states have to survive the
// projection:
//
//   ABSENT (the field is not on `settings/hotelConfig`) -> undefined
//   EMPTY  (`[]` on the doc)                             -> []
//
// The guest client then renders the shipped defaults for the first
// and NOTHING for the second (see
// `shared/__tests__/bookingPreferenceCatalog.test.ts`).

import { describe, expect, it } from "vitest";

import { buildPublicHotelConfig } from "../../server/lib/publicHotelConfig";

describe("SR-01 follow-up — the public projection keeps absent-vs-empty", () => {
  it("an ABSENT catalog projects as undefined (the hotel never configured it)", () => {
    const projected = buildPublicHotelConfig({});
    expect(projected.bedSetups).toBeUndefined();
    expect(projected.bookingPreferences).toBeUndefined();
  });

  it("an EXPLICITLY EMPTY catalog projects as an empty array (the hotel cleared it)", () => {
    const projected = buildPublicHotelConfig({ bedSetups: [], bookingPreferences: [] });
    expect(projected.bedSetups).toEqual([]);
    expect(projected.bookingPreferences).toEqual([]);
  });

  it("a configured catalog projects verbatim", () => {
    const projected = buildPublicHotelConfig({
      bedSetups: [{ value: "large-bed", label: "Large bed", icon: "bed" }],
      bookingPreferences: [{ value: "quiet-room", label: "Quiet room" }]
    });
    expect(projected.bedSetups).toEqual([
      { value: "large-bed", label: "Large bed", icon: "bed" }
    ]);
    expect(projected.bookingPreferences).toEqual([
      { value: "quiet-room", label: "Quiet room" }
    ]);
  });

  it("the projection still strips the admin-only fields (F09 contract intact)", () => {
    const projected = buildPublicHotelConfig({
      roomTypes: [
        {
          value: "deluxe",
          label: "Deluxe",
          shortLabel: "Deluxe",
          pricePerNight: 4200,
          maxCapacity: 2,
          corporateRate: 3600
        }
      ]
    }) as unknown as { roomTypes: Array<Record<string, unknown>> };
    expect(projected.roomTypes[0].corporateRate).toBeUndefined();
  });
});
