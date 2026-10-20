// Per OCT-M4 (2026-10-20, decision #297): the guest Step 2
// "Other Add-Ons" grid + the create path's persistence.
//
// The bug: BR-12 shipped the other-add-ons catalog, the staff
// walk-in grid and the post-booking "Manage Other Add-Ons" page —
// but the GUEST booking flow never had one. `BookingPage.tsx`
// contained ZERO occurrences of "otherAddOn", so a guest could not
// order an airport transfer at booking time at all. Combined with
// OCT-C5 (the create path never persisted `otherAddOnSelections`
// even if it did), other add-ons were only purchasable
// post-booking — the spec's headline BR-12 flow was unreachable.
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// shared helper) and the WIRING (source-text guards — the guest
// component and the server transaction cannot be mounted here
// because the repo has no jsdom/RTL harness for them).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildOtherAddOnDraftSelections,
  countOtherAddOnDraftSelections,
  clampOtherAddOnQuantity,
  otherAddOnDraftKey,
  recomputeOtherAddOnTotal,
  type OtherAddOnDraftCatalogRow
} from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const sectionSrc = read("guest-app/src/components/OtherAddOnsStep2Section.tsx");
const hookSrc = read("guest-app/src/hooks/useOtherAddOnsCatalog.ts");
const bookingsHandlerSrc = read("guest-app/server/handlers/bookings.ts");

const CATALOG: OtherAddOnDraftCatalogRow[] = [
  {
    id: "airport-transfer",
    name: "Airport transfer",
    description: "One way, Mactan airport.",
    price: 500,
    unit: "per-person",
    isEnabled: true,
    cutoffHoursBeforeCheckIn: 24
  }
];

const DATES = ["2026-11-02", "2026-11-03"];

describe("OCT-M4 — the guest draft builder (runtime behaviour)", () => {
  it("a quantity of 0 produces NO rows", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: { [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 0 },
      guestCount: 2
    });
    expect(selections).toEqual({});
  });

  it("a quantity produces one row per date that has one", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: { [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 2 },
      guestCount: 2
    });
    expect(Object.keys(selections)).toEqual([DATES[0]]);
    expect(selections[DATES[0]]).toHaveLength(1);
    expect(selections[DATES[0]][0].quantity).toBe(2);
  });

  it("the entry snapshots the catalog price / name / unit", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: { [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 1 },
      guestCount: 2
    });
    const entry = selections[DATES[0]][0];
    expect(entry.priceSnapshot).toBe(500);
    expect(entry.nameSnapshot).toBe("Airport transfer");
    expect(entry.unitSnapshot).toBe("per-person");
    expect(entry.addedBy).toBe("guest");
    expect(entry.removedAt).toBeNull();
  });

  it("the quantity is clamped to the guest count", () => {
    expect(clampOtherAddOnQuantity(99, 2)).toBe(2);
    expect(clampOtherAddOnQuantity(-5, 2)).toBe(0);
    expect(clampOtherAddOnQuantity("3", 2)).toBe(2);
    expect(clampOtherAddOnQuantity(1.9, 2)).toBe(1);
  });

  it("a quantity above the guest count is clamped in the built map too", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: { [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 50 },
      guestCount: 2
    });
    expect(selections[DATES[0]][0].quantity).toBe(2);
  });

  it("the total is price × quantity across every row", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: {
        [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 2,
        [otherAddOnDraftKey(DATES[1], "airport-transfer")]: 2
      },
      guestCount: 2
    });
    expect(recomputeOtherAddOnTotal(selections)).toBe(2000);
  });

  it("the count is the number of (date × add-on) rows with a quantity", () => {
    const selections = buildOtherAddOnDraftSelections({
      catalog: CATALOG,
      dates: DATES,
      quantities: {
        [otherAddOnDraftKey(DATES[0], "airport-transfer")]: 2,
        [otherAddOnDraftKey(DATES[1], "airport-transfer")]: 1
      },
      guestCount: 2
    });
    expect(countOtherAddOnDraftSelections(selections)).toBe(2);
    expect(countOtherAddOnDraftSelections({})).toBe(0);
    expect(countOtherAddOnDraftSelections(null)).toBe(0);
  });

  it("an empty catalog produces an empty draft", () => {
    expect(
      buildOtherAddOnDraftSelections({
        catalog: [],
        dates: DATES,
        quantities: {},
        guestCount: 2
      })
    ).toEqual({});
  });
});

describe("OCT-M4 — the guest Step 2 grid is wired (wiring)", () => {
  it("the BookingPage renders the other-add-ons section", () => {
    expect(bookingPageSrc).toContain("OtherAddOnsStep2Section");
    expect(bookingPageSrc).toMatch(/<OtherAddOnsStep2Section/);
  });

  it("the section renders BELOW the breakfast section (per the spec)", () => {
    const breakfastIdx = bookingPageSrc.indexOf("renderBreakfastSection()");
    const otherIdx = bookingPageSrc.indexOf("<OtherAddOnsStep2Section");
    expect(breakfastIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(breakfastIdx);
  });

  it("the catalog is read from the PUBLIC endpoint (the guest app never reads the collection)", () => {
    expect(hookSrc).toContain("/api/bookings/addons/config");
  });

  it("the CTA covers the UNION of breakfast + other add-ons", () => {
    expect(bookingPageSrc).toMatch(
      /const breakfastAddOnCount = Object\.keys\(breakfastSelections\)\.length/
    );
    expect(bookingPageSrc).toMatch(
      /const addOnCount = breakfastAddOnCount \+ otherAddOnCount/
    );
    expect(bookingPageSrc).toMatch(
      /const addOnsTotal = breakfastTotal \+ otherAddOnTotal/
    );
    expect(bookingPageSrc).toMatch(/formatPrice\(addOnsTotal\)/);
  });

  it("the grid renders a per-date quantity input", () => {
    expect(sectionSrc).toContain("other-addon-qty-");
    expect(sectionSrc).toMatch(/type="number"/);
  });

  it("the grid honours the cut-off (OCT-M5 — anchored on the booking's check-in)", () => {
    expect(sectionSrc).toContain("computeOtherAddOnCutoffState");
    expect(sectionSrc).toMatch(/checkInDate: checkIn/);
  });

  it("the grid renders NOTHING when the catalog is empty (the hotel turned add-ons off)", () => {
    expect(sectionSrc).toMatch(/if \(!addOns \|\| addOns\.length === 0\) return null/);
  });
});

describe("OCT-M4 — the create path persists the selections (wiring)", () => {
  it("the create schema accepts the other-add-on selections", () => {
    expect(bookingsHandlerSrc).toMatch(
      /otherAddOnSelections: z\.record\(z\.string\(\), z\.array\(z\.unknown\(\)\)\)\.optional\(\)/
    );
  });

  it("the selections are REBUILT from the live catalog (the price authority is the server)", () => {
    expect(bookingsHandlerSrc).toMatch(
      /const addOnsCatalogSnap = await transaction\.get\(adminDb\.collection\("addOns"\)\)/
    );
    expect(bookingsHandlerSrc).toMatch(/priceSnapshot: Math\.max\(0, Number\(live\.price\) \|\| 0\)/);
    expect(bookingsHandlerSrc).toMatch(/nameSnapshot: live\.name/);
  });

  it("an add-on that is not on sale is refused", () => {
    expect(bookingsHandlerSrc).toMatch(/if \(live\.isEnabled === false\) \{\s*throw new Error\(OTHER_ADDON_NOT_AVAILABLE_ERROR\)/);
  });

  it("the hotel-wide master switch is honoured on create (OCT-M1)", () => {
    expect(bookingsHandlerSrc).toMatch(
      /normalizeOtherAddOnsEnabled\(hotelConfig\.otherAddOnsEnabled\)/
    );
  });

  it("the quantity is clamped to the guest count", () => {
    expect(bookingsHandlerSrc).toMatch(
      /Math\.min\(\s*guests,\s*Math\.floor\(Number\(entry\.quantity\) \|\| 0\)\s*\)/
    );
  });

  it("the booking doc carries the selections + the total + the has-any flag", () => {
    expect(bookingsHandlerSrc).toMatch(
      /otherAddOnSelections: validatedOtherAddOnSelections,[\s\S]*?otherAddOnTotal: validatedOtherAddOnTotal,[\s\S]*?hasAnyOtherAddOns: hasAnyOtherAddOns\(validatedOtherAddOnSelections\)/
    );
  });

  it("the other add-ons are NOT folded into totalPrice (spec decision 2)", () => {
    // `plan/features/OTHER-ADD-ONS.md`: "The other add-ons are NOT
    // inside `totalPrice` (they are added on top of it for the
    // balance)". The create path must not change the room bill.
    const createIdx = bookingsHandlerSrc.indexOf("export async function handleCreateBooking");
    const walkinIdx = bookingsHandlerSrc.indexOf("handleWalkinBooking");
    const createBlock = bookingsHandlerSrc.slice(
      createIdx,
      walkinIdx > createIdx ? walkinIdx : createIdx + 200000
    );
    expect(createBlock).toMatch(/otherAddOnTotal: validatedOtherAddOnTotal/);
    // The total is written as its own field, never folded into the
    // chain's `totalPrice`.
    expect(createBlock).not.toMatch(/totalPrice: validatedOtherAddOnTotal/);
  });

  it("the client sends the draft in the create payload", () => {
    expect(bookingPageSrc).toMatch(/otherAddOnSelections: otherAddOnDraft/);
  });
});
