// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the new
// `WalkinOtherAddOnGrid` component mounted in both
// the walk-in modal (`BookingsPage.tsx`) and the
// calendar-create modal (`CalendarPage.tsx`) Step 2.
// Source-text tripwires that pin the implementation
// contracts:
//
//   1. The new component file
//      `admin-app/src/components/otherAddOns/WalkinOtherAddOnGrid.tsx`
//      exists and exports `WalkinOtherAddOnGrid` + the
//      `WalkinOtherAddOnSelections` type.
//   2. The walk-in modal at `BookingsPage.tsx` imports
//      + mounts the new grid in the `walkinStep === 2`
//      step.
//   3. The calendar-create modal at `CalendarPage.tsx`
//      imports + mounts the new grid in the
//      `calendarStep === 2` step.
//   4. Both modals write the rich
//      `otherAddOnSelections` + `otherAddOnTotal` +
//      `hasAnyOtherAddOns` to the booking-create call.
//   5. The grid reads the public
//      `/api/bookings/addons/config` endpoint + filters
//      through `getEnabledAddOnsByHotel`.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const gridFile = "admin-app/src/components/otherAddOns/WalkinOtherAddOnGrid.tsx";
const grid = existsSync(resolve(repoRoot, gridFile)) ? read(gridFile) : "";
const bookingsPage = read("admin-app/src/pages/BookingsPage.tsx");
const calendarPage = read("admin-app/src/pages/CalendarPage.tsx");

describe("BR-12.1 — Walk-in Other Add-Ons grid (Surface 3)", () => {
  describe("component file", () => {
    it("the new WalkinOtherAddOnGrid.tsx file exists at the BR-12.1 path", () => {
      expect(existsSync(resolve(repoRoot, gridFile))).toBe(true);
    });

    it("the file exports `WalkinOtherAddOnGrid` as a named function", () => {
      expect(grid).toMatch(/export function WalkinOtherAddOnGrid\(/);
    });

    it("the file exports the `WalkinOtherAddOnSelections` type", () => {
      expect(grid).toMatch(/export interface WalkinOtherAddOnSelections/);
      expect(grid).toContain("otherAddOnSelections");
      expect(grid).toContain("otherAddOnTotal");
      expect(grid).toContain("hasAnyOtherAddOns");
    });
  });

  describe("catalog fetch + filter", () => {
    it("the grid fetches /api/bookings/addons/config on mount", () => {
      expect(grid).toContain("/api/bookings/addons/config");
      expect(grid).toContain("method: \"GET\"");
    });

    it("the grid filters through getEnabledAddOnsByHotel before rendering", () => {
      expect(grid).toContain("getEnabledAddOnsByHotel");
    });

    it("the grid renders the 'Add-ons are currently disabled' placeholder when the catalog is empty", () => {
      expect(grid).toContain("data-testid=\"walkin-addons-empty\"");
      expect(grid).toContain("Add-ons are currently disabled");
    });
  });

  describe("walk-in modal mount (BookingsPage.tsx)", () => {
    it("BookingsPage imports the new grid", () => {
      expect(bookingsPage).toMatch(/import \{ WalkinOtherAddOnGrid,/);
    });

    it("the walk-in modal mounts the grid in the `walkinStep === 2` step", () => {
      // The grid is rendered alongside the existing
      // breakfast grid on the same Step 2.
      const stepTwo = bookingsPage.match(/walkinStep === 2/);
      expect(stepTwo).toBeTruthy();
      expect(bookingsPage).toMatch(/walkinStep === 2[\s\S]{0,2000}<WalkinOtherAddOnGrid/);
    });

    it("the walk-in modal carries the `walkinOtherAddOns` state", () => {
      expect(bookingsPage).toMatch(/useState<WalkinOtherAddOnSelections \| null>/);
    });

    it("the walk-in modal create call writes the rich shape to the booking doc", () => {
      expect(bookingsPage).toContain("otherAddOnSelections: walkinOtherAddOns.otherAddOnSelections");
      expect(bookingsPage).toContain("otherAddOnTotal: walkinOtherAddOns.otherAddOnTotal");
      expect(bookingsPage).toContain("hasAnyOtherAddOns: true");
    });

    it("the walk-in modal resets the state on close", () => {
      expect(bookingsPage).toContain("setWalkinOtherAddOns(null)");
    });
  });

  describe("calendar-create modal mount (CalendarPage.tsx)", () => {
    it("CalendarPage imports the new grid", () => {
      expect(calendarPage).toMatch(/import \{ WalkinOtherAddOnGrid,/);
    });

    it("the calendar modal mounts the grid in the `calendarStep === 2` step", () => {
      expect(calendarPage).toMatch(/calendarStep === 2[\s\S]{0,2000}<WalkinOtherAddOnGrid/);
    });

    it("the calendar modal carries the `calendarOtherAddOns` state", () => {
      expect(calendarPage).toMatch(/useState<WalkinOtherAddOnSelections \| null>/);
    });

    it("the calendar modal create call writes the rich shape to the booking doc", () => {
      expect(calendarPage).toContain("otherAddOnSelections: calendarOtherAddOns.otherAddOnSelections");
      expect(calendarPage).toContain("otherAddOnTotal: calendarOtherAddOns.otherAddOnTotal");
      expect(calendarPage).toContain("hasAnyOtherAddOns: true");
    });

    it("the calendar modal resets the state on close", () => {
      expect(calendarPage).toContain("setCalendarOtherAddOns(null)");
    });
  });
});
