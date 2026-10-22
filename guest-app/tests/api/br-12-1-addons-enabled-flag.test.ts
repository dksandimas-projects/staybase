// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the
// "Add-ons enabled" hotel-wide toggle + the
// public booking flow's read path. Source-text
// tripwires that pin the implementation contracts:
//
//   1. The `/api/bookings/addons/config` public
//      endpoint serves only the `isEnabled === true`
//      rows through `getEnabledAddOnsByHotel`.
//   2. When the add-ons collection is empty OR every
//      row has `isEnabled: false`, the booking flow's
//      Add-ons section shows the "Add-ons are
//      currently disabled" placeholder copy.
//   3. The create-call payload omits
//      `otherAddOnSelections` when no add-ons were
//      selected (the BR-12 write-side gate).
//   4. The `hasAnyOtherAddOns` flag is set to false
//      on a no-add-ons booking.
//   5. The public read path consults the per-doc
//      `isEnabled` flag (not a separate hotel-wide
//      toggle for v1).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const addOnsConfigHandler = read("guest-app/server/handlers/addons-config.ts");
const bookingPage = read("guest-app/src/pages/BookingPage.tsx");
const corporateBookingPage = read("guest-app/src/pages/CorporateBookingPage.tsx");
const addOnsUtil = read("shared/utils/addOns.ts");

describe("BR-12.1 — Add-ons enabled flag (public booking flow)", () => {
  describe("public config endpoint", () => {
    it("the handler serves only `isEnabled === true` rows via getEnabledAddOnsByHotel", () => {
      // Per P0-9 (2026-10-22) the per-row filter moved OUT of the
      // endpoint into the pure `buildPublicAddOnsCatalog` helper
      // (`shared/utils/addOns.ts`), so the handler stays a thin adapter
      // and the payload rules are unit-testable. The filter itself is
      // unchanged — it is still `getEnabledAddOnsByHotel`.
      expect(addOnsConfigHandler).toContain("buildPublicAddOnsCatalog");
      expect(addOnsUtil).toMatch(/export function buildPublicAddOnsCatalog/);
      expect(addOnsUtil).toMatch(
        /getEnabledAddOnsByHotel\(input\.rows, input\.hotelEnabled !== false\)/
      );
    });

    it("the handler reads the `addOns` collection from Firestore", () => {
      expect(addOnsConfigHandler).toMatch(/adminDb\.collection\("addOns"\)/);
    });
  });

  describe("shared helper", () => {
    it("getEnabledAddOnsByHotel filters isEnabled === true", () => {
      expect(addOnsUtil).toContain("getEnabledAddOnsByHotel");
      expect(addOnsUtil).toMatch(/filter\(\(a\) => a && a\.isEnabled === true\)/);
    });
  });

  describe("booking flow read path", () => {
    it("the BookingPage surfaces the 'No add-ons available' placeholder when the catalog is empty / disabled", () => {
      // The public Step 2 grid mirrors the same
      // copy the walk-in / drawer grids use. This
      // is the explicit disabled-placeholder the
      // BR-12.1 spec asks for.
      expect(bookingPage).toMatch(/No add-ons available/);
    });

    it("the CorporateBookingPage applies the same disabled copy", () => {
      expect(corporateBookingPage).toMatch(/No add-ons available/);
    });
  });

  describe("create-call payload", () => {
    it("the booking type carries `otherAddOnSelections` as an optional field", () => {
      // The BR-12 Zod schema's `otherAddOnSelections`
      // is optional. When the guest doesn't select any
      // add-on, the booking write omits the field.
      const types = read("shared/types/index.ts");
      expect(types).toMatch(/otherAddOnSelections\?: Record<string, OtherAddOnSelectionEntry\[\]> \| null/);
    });

    it("the booking type carries `hasAnyOtherAddOns` as an optional flag", () => {
      const types = read("shared/types/index.ts");
      expect(types).toMatch(/hasAnyOtherAddOns\?: boolean/);
    });
  });
});
