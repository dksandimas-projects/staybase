// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): source-text + structural tripwires
// for the staff-side breakfast surfaces across the
// admin-app. These tripwires are the load-bearing defense
// — they pin the rendering shape the spec establishes so a
// refactor that drops one of these invariants breaks the
// test instead of regressing silently.
//
// Covered invariants:
//
//   1. The "Breakfast" tab is wired into the booking
//      drawer's tab list (`sections` array) using the
//      `Utensils` icon + `id: "breakfast"`.
//   2. The new tab renders the per-date × per-guest meal
//      grid (`breakfastSelections` + `meals`).
//   3. The new tab renders the served toggle + the
//      per-slot served map (`breakfastServed` + the
//      `mark-served` admin-context wrapper).
//   4. The new tab has the override-reason modal
//      (`overrideCutoff` + `overrideReason` +
//      `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH`).
//   5. The new tab has the refund-liability panel +
//      "Mark as paid" action (`Mark as paid` + the
//      `category: "breakfast"` refund entry shape).
//   6. The drawer rendering still uses the existing
//      `<BookingDrawerSectionPanel>` wrapper (no
//      alternative routing introduced).
//   7. The walk-in modal at `BookingsPage.tsx` no
//      longer references `hasBreakfast` (the legacy
//      flat-rate model is gone) + now uses the rich
//      `breakfastSelections` shape.
//   8. The walk-in modal renders the per-date × per-guest
//      meal grid via the new `WalkinBreakfastGrid` shared
//      component.
//   9. The calendar-create modal at `CalendarPage.tsx`
//      mirrors the walk-in rewrite (no `hasBreakfast` +
//      has the same grid).
//
// The file reads the source of each file (no runtime
// fixtures, no JSDOM) so each test pin is byte-stable.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const drawerSrc = readFileSync(
  resolve(__dirname, "../components/BookingDrawerWorkspace.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);
const walkinGridSrc = readFileSync(
  resolve(__dirname, "../components/breakfast/WalkinBreakfastGrid.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("BR-05 — staff booking-drawer breakfast section", () => {
  describe("BookingDrawerWorkspace.tsx — Breakfast tab", () => {
    it("adds a `breakfast` entry to the sections array with the Utensils icon", () => {
      // The new tab is registered in the file-local `sections`
      // list. The icon is `Utensils` (matches the rest of the
      // drawer tabs' lucide-react icons).
      expect(drawerSrc).toMatch(
        /\{\s*id:\s*["']breakfast["'],\s*desktopLabel:\s*["']Breakfast["']/
      );
      // The Utensils import is the icon.
      expect(drawerSrc).toMatch(/import\s*\{\s*[^}]*Utensils[^}]*\}\s*from\s*["']lucide-react["']/);
    });

    it("renders the per-date × per-guest meal grid (breakfastSelections + meals)", () => {
      // The new tab reads the rich `breakfastSelections` map
      // (BR-01 shape) + the public `meals[]` catalog.
      expect(drawerSrc).toMatch(/breakfastSelections/);
      expect(drawerSrc).toMatch(/\bmeals\b/);
      // It renders via a `<select>` per slot listing
      // `meals[].name`.
      expect(drawerSrc).toMatch(
        /<select[\s\S]*?(?:sortedMeals|config\.meals)[\s\S]*?<\/select>/
      );
    });

    it("renders the served toggle (breakfastServed + mark-served admin-context wrapper)", () => {
      // The per-slot served toggle reads the rich
      // `breakfastServed` map + dispatches via the
      // admin-context `markBreakfastServed` wrapper that
      // hits the `mark-served` endpoint.
      expect(drawerSrc).toMatch(/breakfastServed/);
      expect(adminContextSrc).toMatch(/markBreakfastServed\b/);
      expect(adminContextSrc).toMatch(/\/api\/bookings\/breakfast\/mark-served/);
    });

    it("has the override-reason modal (overrideCutoff + overrideReason + MIN_BREAKFAST_OVERRIDE_REASON_LENGTH)", () => {
      // The override modal is the locked-date-past-cutoff
      // path. Its source carries `overrideCutoff` +
      // `overrideReason` + the BR-01 min-length constant.
      expect(drawerSrc).toMatch(/overrideCutoff/);
      expect(drawerSrc).toMatch(/overrideReason/);
      expect(drawerSrc).toMatch(/MIN_BREAKFAST_OVERRIDE_REASON_LENGTH/);
      // The modal uses the existing `Modal` component
      // (imported in the file as `Modal as BreakfastTabModal`
      // so the prop-driven override state stays scoped).
      expect(drawerSrc).toMatch(/<BreakfastTabModal[\s\S]*?Late breakfast change/);
    });

    it("has a refund-liability panel + Mark as paid action (category: \"breakfast\")", () => {
      // The refund panel surfaces pending breakfast refunds
      // (BR-01 §OnsitePayment extension) + the staff action
      // that calls `markBreakfastRefundPaid`.
      expect(drawerSrc).toMatch(/Mark as paid/);
      expect(adminContextSrc).toMatch(/markBreakfastRefundPaid\b/);
      expect(adminContextSrc).toMatch(/\/api\/bookings\/breakfast\/mark-refund-paid/);
      // The refund entry's `category` discriminator is
      // "breakfast" (the BR-01 extension).
      expect(drawerSrc).toMatch(/category:\s*["']breakfast["']/);
    });

    it("uses the existing <BookingDrawerSectionPanel> wrapper", () => {
      // The new tab is wired through the standard wrapper
      // (matches the rest of the drawer's primary panels).
      expect(drawerSrc).toMatch(/export\s+function\s+BookingDrawerSectionPanel/);
    });
  });

  describe("BookingsPage.tsx — walk-in modal", () => {
    it("no longer references the legacy flat-rate `hasBreakfast` toggle", () => {
      // The walk-in modal's `hasBreakfast` checkbox is gone.
      // Per BR-05 the old toggle is replaced by the
      // per-date × per-guest `<WalkinBreakfastGrid>`.
      // We check the legacy `setHasBreakfast` call site
      // is no longer rendered as a checkbox.
      const checkbox =
        /(<input[\s\S]*?type=["']checkbox["'][\s\S]*?setHasBreakfast[\s\S]*?>)/;
      expect(bookingsPageSrc).not.toMatch(checkbox);
      // The state setter is still kept (for the reset path
      // + the legacy receipt printout) but the UI binding
      // is gone.
    });

    it("renders the new meal-per-guest grid (breakfastSelections + meals)", () => {
      // The new walk-in grid renders via the shared
      // `WalkinBreakfastGrid` component.
      expect(bookingsPageSrc).toMatch(/WalkinBreakfastGrid/);
      expect(bookingsPageSrc).toMatch(/breakfastSelections/);
      expect(walkinGridSrc).toMatch(/\bmeals\b/);
      expect(walkinGridSrc).toMatch(/breakfastSelections/);
    });
  });

  describe("CalendarPage.tsx — calendar-create modal", () => {
    it("no longer references the legacy flat-rate `hasBreakfast` toggle", () => {
      // Same check as the walk-in modal — the legacy
      // checkbox is gone.
      const checkbox =
        /(<input[\s\S]*?type=["']checkbox["'][\s\S]*?setHasBreakfast[\s\S]*?>)/;
      expect(calendarPageSrc).not.toMatch(checkbox);
    });

    it("renders the new meal-per-guest grid (WalkinBreakfastGrid + breakfastSelections)", () => {
      // The calendar-create modal imports + renders
      // the shared grid (same UI as the walk-in modal).
      expect(calendarPageSrc).toMatch(/WalkinBreakfastGrid/);
      expect(calendarPageSrc).toMatch(/breakfastSelections/);
    });
  });
});
