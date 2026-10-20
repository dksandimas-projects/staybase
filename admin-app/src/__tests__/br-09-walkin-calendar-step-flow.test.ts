// Per BR-09 (Phase 13 — Breakfast Redesign, decision
// #239, 2026-10-14): the walk-in modal + calendar-
// create modal render the same 5-step stepper as the
// public booking flow. The tripwires here pin the
// admin-side invariants:
//
//   1. The walk-in modal (BookingsPage.tsx) renders
//      a 5-step stepper with the new "Add-ons" step.
//   2. The walk-in breakfast grid is wrapped in a
//      `walkinStep === 2` conditional (the new
//      Add-ons surface).
//   3. The calendar-create modal (CalendarPage.tsx)
//      renders the same 5-step stepper.
//   4. The calendar breakfast grid is wrapped in a
//      `calendarStep === 2` conditional.
//   5. The admin-app StepIndicator exists + mirrors
//      the guest-app shape (no hardcoded 4-column
//      layout).
//
// All assertions are byte-stable source-text
// tripwires (no runtime fixtures, no JSDOM) so each
// test pin is reproducible across edits.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);
const stepIndicatorSrc = readFileSync(
  resolve(__dirname, "../components/StepIndicator.tsx"),
  "utf8"
);

describe("BR-09 — admin walk-in + calendar step-flow", () => {
  describe("BookingsPage.tsx — walk-in modal", () => {
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

    it("resets the walk-in step to Step 1 when the modal closes", () => {
      // The close handler resets the step state so
      // a fresh open starts at Step 1.
      expect(bookingsPageSrc).toMatch(/setWalkinStep\(1\)/);
    });
  });

  describe("CalendarPage.tsx — calendar-create modal", () => {
    it("introduces a calendar-step state with the 5-step model", () => {
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

  describe("StepIndicator — admin-app mirror", () => {
    it("exists as a shared admin-app component", () => {
      // The admin-app gains its own StepIndicator
      // (mirroring the guest-app shape) so the walk-
      // in + calendar modals can render the same
      // 5-step visual.
      expect(stepIndicatorSrc.length).toBeGreaterThan(0);
    });

    it("does not hardcode the legacy 4-column layout", () => {
      // The 5-step refactor requires a flexible
      // layout. The legacy `sm:grid-cols-4` is gone.
      expect(stepIndicatorSrc).not.toMatch(/sm:grid-cols-4/);
    });
  });
});