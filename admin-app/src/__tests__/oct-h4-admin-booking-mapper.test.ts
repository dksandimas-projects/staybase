// Per OCT-H4 (2026-10-20, decision #285): the admin booking mapper
// silently dropped the October add-on fields.
//
// THE BUG
//
// The admin `Booking` type DECLARED `breakfastTotal`,
// `otherAddOnSelections`, `otherAddOnTotal`, `hasAnyOtherAddOns`
// and `otherAddOnServed` — but the snapshot mapper never READ them
// from Firestore. The same bug class the mapper's own `reservationId`
// comment (FOL-02, MRB-01) documents for those four fields,
// reintroduced for the October add-on fields.
//
// Consequences (all read-side misreporting — the write path is
// field-scoped, so nothing was destroyed):
//
//   1. `ReportsPage.tsx` read `booking.breakfastTotal` → `0`, so
//      "total breakfast revenue" showed ₱0 (and the CSV export
//      carried ₱0) while "Top meals" — computed from the per-entry
//      `price` — showed real money. The report contradicted
//      itself.
//   2. `bookingFolio.ts` could not see the stored
//      `revenueAllocation`, so the revenue-stream split fell back
//      to the legacy proportional heuristic with
//      `breakfastGross = 0` and the room KPI silently absorbed the
//      breakfast revenue.
//   3. `ReportsPage.tsx` filtered `b.hasAnyOtherAddOns === true`
//      to build the whole BR-12.1 Add-Ons sub-tab — with the
//      field always `false`, the sub-tab showed ZERO for every
//      booking.
//   4. `BookingDrawerWorkspace.tsx` read
//      `booking.otherAddOnSelections || {}` → the drawer's Other
//      Add-Ons tab showed "no add-ons" (and "Total: ₱0") for a
//      booking that had them.
//
// THE FIX
//
// The mapper hydrates all of them, DERIVING the mirrors from the
// server's own helpers when the doc does not carry the explicit
// flag (so a booking written before the field existed still reads
// honestly).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = codeOnly(adminContextSrc);

describe("OCT-H4 — the admin booking mapper hydrates the add-on fields", () => {
  it("hydrates `breakfastTotal`", () => {
    expect(code).toMatch(/breakfastTotal: breakfastTotalHydrated,/);
  });

  it("hydrates `hasAnyBreakfast`", () => {
    expect(code).toMatch(/hasAnyBreakfast: hasAnyBreakfastHydrated,/);
  });

  it("hydrates `revenueAllocation` (the MRB-11 snapshot)", () => {
    expect(code).toMatch(/revenueAllocation: data\.revenueAllocation/);
    expect(code).toMatch(/roomNet: Number\(data\.revenueAllocation\.roomNet \|\| 0\)/);
    expect(code).toMatch(/breakfastNet: Number\(data\.revenueAllocation\.breakfastNet \|\| 0\)/);
    expect(code).toMatch(/totalNet: Number\(data\.revenueAllocation\.totalNet \|\| 0\)/);
  });

  it("hydrates the other add-on map + total + mirror", () => {
    expect(code).toMatch(/otherAddOnSelections: otherAddOnSelectionsHydrated,/);
    expect(code).toMatch(/otherAddOnTotal: otherAddOnTotalHydrated,/);
    expect(code).toMatch(/hasAnyOtherAddOns: hasAnyOtherAddOnsHydrated,/);
  });

  it("hydrates the other add-on served map", () => {
    expect(code).toMatch(/otherAddOnServed: data\.otherAddOnServed \|\| \{\},/);
  });

  it("derives the mirrors with the SERVER's own helpers (one source of truth)", () => {
    expect(code).toMatch(/recomputeBreakfastTotal\(breakfastSelectionsHydrated\)/);
    expect(code).toMatch(/recomputeOtherAddOnTotal\(otherAddOnSelectionsHydrated\)/);
    expect(code).toMatch(/hasAnyOtherAddOns\(otherAddOnSelectionsHydrated\)/);
  });

  it("the mirrors fall back to the derived value when the doc has no explicit flag", () => {
    expect(code).toMatch(
      /data\.hasAnyBreakfast === true \|\|\s*\(data\.hasAnyBreakfast === undefined &&/
    );
    expect(code).toMatch(
      /data\.hasAnyOtherAddOns === true \|\|\s*\(data\.hasAnyOtherAddOns === undefined &&/
    );
  });

  it("declares the fields on the admin `Booking` interface", () => {
    expect(adminContextSrc).toMatch(/breakfastTotal\?: number;/);
    expect(adminContextSrc).toMatch(/hasAnyBreakfast\?: boolean;/);
    expect(adminContextSrc).toMatch(/revenueAllocation\?: BookingRevenueAllocation \| null;/);
    expect(adminContextSrc).toMatch(/hasAnyOtherAddOns\?: boolean;/);
  });

  it("the report + drawer read sites are now backed by real data", () => {
    // The read sites themselves are unchanged — they were always
    // correct; the mapper was the broken half. This pins that the
    // report still filters on the mirror the mapper now hydrates.
    const reportsSrc = readFileSync(
      resolve(__dirname, "../pages/ReportsPage.tsx"),
      "utf8"
    );
    expect(reportsSrc).toMatch(/b\.hasAnyOtherAddOns === true/);
    expect(reportsSrc).toMatch(/booking\.breakfastTotal/);
  });
});
