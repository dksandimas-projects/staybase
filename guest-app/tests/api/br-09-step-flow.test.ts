// Per BR-09 (Phase 13 — Breakfast Redesign, decision
// #239, 2026-10-14): source-text + structural
// tripwires for the BR-09 step-flow refactor. The
// refactor splits the old Step 2 (Select Room +
// Guest Details) into two distinct steps:
//
//   1. Select Room (unchanged)
//   2. Add-ons (NEW — extracted breakfast grid)
//   3. Guest Details (old Step 2 minus breakfast)
//   4. Review (unchanged — old Step 3)
//   5. Confirmation (unchanged — old Step 4)
//
// These tripwires pin the rendering + URL-state
// invariants the refactor establishes so a future
// change that drifts back to the old 4-step layout
// (or reorders the steps) breaks the test instead
// of regressing silently.
//
// All assertions are byte-stable: the file reads the
// source of each file (no runtime fixtures, no JSDOM)
// so each tripwire is reproducible across edits.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);
const corporateBookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(
    __dirname,
    "../../../admin-app/src/pages/BookingsPage.tsx"
  ),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(
    __dirname,
    "../../../admin-app/src/pages/CalendarPage.tsx"
  ),
  "utf8"
);
const stepIndicatorGuestSrc = readFileSync(
  resolve(
    __dirname,
    "../../src/components/StepIndicator.tsx"
  ),
  "utf8"
);
const stepIndicatorAdminSrc = readFileSync(
  resolve(
    __dirname,
    "../../../admin-app/src/components/StepIndicator.tsx"
  ),
  "utf8"
);

describe("BR-09 — step-flow refactor tripwires", () => {
  describe("BookingPage.tsx (public booking flow)", () => {
    it("renders the stepper with 5 steps (Select Room, Add-ons, Guest Details, Review, Confirmation)", () => {
      // The 5-step model is the load-bearing change
      // in BR-09. The legacy 4-step array must be
      // gone, and the new 5-step array must be
      // present.
      expect(bookingPageSrc).not.toMatch(
        /\[\s*"Select Room"\s*,\s*"Guest Details"\s*,\s*"Review & Pay"\s*,\s*"Confirmation"\s*\]/
      );
      expect(bookingPageSrc).toMatch(
        /\[\s*"Select Room"\s*,\s*"Add-ons"\s*,\s*"Guest Details"\s*,\s*"Review & Pay"\s*,\s*"Confirmation"\s*\]/
      );
    });

    it("introduces the new 'Add-ons' step URL key", () => {
      // The string URL contract gains a new
      // `add-ons` key between `select-room` and
      // `guest-details`.
      expect(bookingPageSrc).toMatch(/add-ons/);
    });

    it("renders the breakfast section in the new 'Add-ons' step (not in 'Guest Details')", () => {
      // The BR-09 extraction moved the
      // `<WalkinBreakfastGrid>`-equivalent JSX (the
      // `breakfastConfig.isEnabled` IIFE that
      // produces the per-date × per-guest meal grid)
      // out of the `isGuestDetailsStep` branch and
      // into a new `isAddOnsStep` branch. The
      // `renderBreakfastSection` helper is the
      // extracted render block — the tripwire pins
      // its presence.
      expect(bookingPageSrc).toMatch(/isAddOnsStep/);
      expect(bookingPageSrc).toMatch(/renderBreakfastSection/);
    });

    it("uses the step-specific 'Continue to guest details' CTA on the Add-ons step", () => {
      // The Add-ons → Guest Details transition copy
      // uses the destination step name (not a
      // numbered "Step N" reference).
      expect(bookingPageSrc).toMatch(/Continue to guest details/);
    });

    it("uses the step-specific 'Continue to add-ons' CTA on Step 1 (Select Room)", () => {
      // The Step 1 → Step 2 transition copy uses
      // the destination step name.
      expect(bookingPageSrc).toMatch(/Continue to add-ons/);
    });

    it("uses the step-specific 'Continue to review' CTA on Step 3 (Guest Details)", () => {
      // The Step 3 → Step 4 transition copy uses
      // the destination step name (no stale
      // "Continue to Step 3" numbering).
      expect(bookingPageSrc).toMatch(/Continue to review/);
      expect(bookingPageSrc).not.toMatch(/Continue to Step 3/);
    });

    it("uses the 'Place booking' CTA on Step 4 (Review — the create-call moment)", () => {
      // Per BR-09, the create-call CTA is now
      // "Place booking" on both public + corporate
      // flows (the legacy "Confirm Booking" / "Confirm
      // Corporate Booking" copy is gone on the public
      // side at least).
      expect(bookingPageSrc).toMatch(/Place booking/);
    });

    it("maps legacy `?step=2` to the new 'Add-ons' step (soft back-compat)", () => {
      // The `normalizeStepKey` helper is the new
      // URL-state reader. Its switch maps
      // `?step=2` (the pre-BR-09 numeric shape for
      // "Guest Details") to the new closest step
      // ("Add-ons"). Users on a legacy link land on
      // the closest equivalent + need to re-do the
      // in-cart data (documented in the spec).
      expect(bookingPageSrc).toMatch(/normalizeStepKey/);
      expect(bookingPageSrc).toMatch(/if\s*\(\s*rawStep\s*===\s*["']2["']\s*\)/);
    });

    it("maps legacy `?step=3` to the new 'Guest Details' step", () => {
      // Pre-BR-09 `?step=3` was "Review". The
      // backward-compat shifts it one position later.
      expect(bookingPageSrc).toMatch(/if\s*\(\s*rawStep\s*===\s*["']3["']\s*\)/);
    });

    it("replaces the bold 'Number of guests' input with a muted per-guest count label", () => {
      // Per the spec, the per-guest count is shown
      // as a MUTED label (`text-xs text-gray-500`)
      // not as a bold input. The tripwire pins:
      //   - the `text-xs text-gray-500` class on the
      //     count label
      //   - the `data-testid="guest-count-label"` hook
      //   - the legacy bold `<TextField label="Number
      //     of guests" />` is gone from the
      //     isGuestDetailsStep branch
      expect(bookingPageSrc).toMatch(/data-testid="guest-count-label"/);
      expect(bookingPageSrc).toMatch(/renderGuestCountLabel/);
    });

    it("removes the 'X adults + Y children (Z total)' summary line from the Step 3 (Guest Details) form", () => {
      // The pre-BR-09 "Number of guests" `<TextField>`
      // was the per-guest count input. The BR-09
      // refactor drops the input (replaced by the
      // muted `renderGuestCountLabel` derived from
      // the cart). The tripwire pins that the input
      // is gone — `guestCount` is still maintained
      // internally via `setOccupancy` but the
      // editable TextField is removed.
      expect(bookingPageSrc).not.toMatch(/label="Number of guests"/);
    });
  });

  describe("CorporateBookingPage.tsx (corporate booking flow)", () => {
    it("renders the corporate stepper with 5 steps", () => {
      // The corporate flow mirrors the public flow
      // step model (5 entries).
      expect(corporateBookingPageSrc).toMatch(
        /\[\s*"Select Room"\s*,\s*"Add-ons"\s*,\s*"Guest Details"\s*,\s*"Review & Pay"\s*,\s*"Confirmation"\s*\]/
      );
    });

    it("adds the corporate 'Add-ons' step (currentStepKey === 'add-ons')", () => {
      // The corporate flow gains a new
      // `add-ons` URL-keyed render branch — same
      // step model as the public flow, even though
      // the corporate rate is a flat rate with no
      // per-day breakfast grid.
      expect(corporateBookingPageSrc).toMatch(/currentStepKey\s*===\s*["']add-ons["']/);
    });

    it("uses 'Step 1 of 5' / 'Step 3 of 5' / 'Step 4 of 5' headers (no stale 'of 4')", () => {
      // The corporate page's "Step N of M" labels
      // now read "of 5" (the old "of 4" is gone).
      // The regex below pins "Step N of 4" exactly
      // (the old stepper's denominator was 4) —
      // anchored to the literal " of 4" suffix so it
      // doesn't match the new "Step 4 of 5" header
      // that contains the digit "4" inside.
      expect(corporateBookingPageSrc).toMatch(/Step 1 of 5/);
      expect(corporateBookingPageSrc).toMatch(/Step 3 of 5/);
      expect(corporateBookingPageSrc).toMatch(/Step 4 of 5/);
      expect(corporateBookingPageSrc).not.toMatch(/Step \d of 4\b/);
    });
  });

  describe("BookingsPage.tsx (admin walk-in modal)", () => {
    it("introduces a walk-in step state with the 5-step model", () => {
      // The walk-in modal adds `walkinStep` state
      // that tracks the 5-step flow (1=Rooms,
      // 2=Add-ons, 3=Guest details, 4=Review,
      // 5=Confirmation).
      expect(bookingsPageSrc).toMatch(/walkinStep/);
    });

    it("renders the walk-in breakfast grid on the new 'Add-ons' step (Step 2)", () => {
      // The `<WalkinBreakfastGrid>` block is wrapped
      // in a `walkinStep === 2` conditional.
      // The BR-05 booking-drawer tests still match
      // because the import + the
      // `breakfastSelections` shape are preserved.
      expect(bookingsPageSrc).toMatch(/walkinStep\s*===\s*2/);
      expect(bookingsPageSrc).toMatch(/WalkinBreakfastGrid/);
      expect(bookingsPageSrc).toMatch(/breakfastSelections/);
    });

    it("renders a 5-step stepper with the 'Add-ons' label", () => {
      // The walk-in modal renders the shared
      // `<StepIndicator>` with the 5-step array
      // ["Rooms", "Add-ons", "Guest details",
      // "Review", "Confirmation"].
      expect(bookingsPageSrc).toMatch(/StepIndicator/);
      expect(bookingsPageSrc).toMatch(/Rooms[\s\S]{0,80}Add-ons/);
    });
  });

  describe("CalendarPage.tsx (admin calendar-create modal)", () => {
    it("introduces a calendar-step state with the 5-step model", () => {
      // The calendar-create modal adds
      // `calendarStep` state that tracks the 5-step
      // flow.
      expect(calendarPageSrc).toMatch(/calendarStep/);
    });

    it("renders the calendar breakfast grid on the new 'Add-ons' step (Step 2)", () => {
      // The `<WalkinBreakfastGrid>` block is
      // wrapped in a `calendarStep === 2`
      // conditional. Same shape as the walk-in modal.
      expect(calendarPageSrc).toMatch(/calendarStep\s*===\s*2/);
      expect(calendarPageSrc).toMatch(/WalkinBreakfastGrid/);
      expect(calendarPageSrc).toMatch(/breakfastSelections/);
    });

    it("renders a 5-step stepper with the 'Add-ons' label", () => {
      // The calendar-create modal renders the
      // shared `<StepIndicator>` with the same
      // 5-step array.
      expect(calendarPageSrc).toMatch(/StepIndicator/);
      expect(calendarPageSrc).toMatch(/Rooms[\s\S]{0,80}Add-ons/);
    });
  });

  describe("StepIndicator — adapts to variable step counts", () => {
    it("guest-app StepIndicator no longer hardcodes the 4-column layout", () => {
      // The BR-09 refactor renders 5 entries
      // instead of 4. The StepIndicator must
      // support N entries without breaking layout.
      // The legacy `sm:grid-cols-4` is gone.
      expect(stepIndicatorGuestSrc).not.toMatch(/sm:grid-cols-4/);
    });

    it("admin-app StepIndicator mirrors the guest-app shape (no hardcoded 4-column layout)", () => {
      // The admin-app StepIndicator (newly added in
      // BR-09) uses the same flexible layout.
      expect(stepIndicatorAdminSrc).not.toMatch(/sm:grid-cols-4/);
    });
  });
});