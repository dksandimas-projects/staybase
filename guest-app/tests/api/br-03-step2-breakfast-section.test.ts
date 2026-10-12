// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the source-text tripwires for
// the guest-app Step 2 breakfast section. Pins:
//
//   1. The Step 1 form no longer has the "Room +
//      Breakfast" toggle.
//   2. The `BookingPage` no longer sends the
//      per-room `hasBreakfast` /
//      `breakfastIncludesChildren` fields in the
//      create payload (the new
//      `breakfastSelections` rich shape replaces
//      them).
//   3. The Step 2 form has a `<select>` per
//      breakfast date × per-guest slot.
//   4. The Step 2 sidebar shows a per-date
//      breakfast breakdown.
//   5. The Step 3 review renders the new
//      `breakfastSelections` shape (same sidebar).
//   6. The new `GET /api/bookings/breakfast/config`
//      route is registered in `apiRouter.ts`.
//   7. `recomputeBreakfastTotal` is imported and
//      used in the sidebar.
//   8. `computeBreakfastCutoffState` is imported
//      and used in the per-date locked state.
//
// The data model in `shared/types/index.ts` is
// locked per BR-01 — the `PublicRoomSelection` type
// still has the legacy `hasBreakfast` /
// `breakfastIncludesChildren` fields (back-compat for
// the walk-in modal + reschedule), but the
// `BookingPage` no longer reads them. Tripwire #2
// pins the BookingPage's create-payload builder, not
// the type.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

describe("BR-03 — Step 2 breakfast section source-text tripwires", () => {
  describe("Step 1 — Room + Breakfast toggle is GONE", () => {
    it("the Step 1 room-type card no longer renders a `Room + Breakfast` rate option", () => {
      // The legacy flat-rate toggle was a
      // `<RateOption label="Room + Breakfast" ... />`
      // block in the per-type card. The new
      // per-guest × per-date `breakfastSelections`
      // rich shape replaces it (no rate option
      // in Step 1).
      expect(bookingPageSrc).not.toMatch(/<RateOption[\s\S]{0,500}?label="Room \+ Breakfast"/);
    });

    it("the Step 1 room-type card no longer calls `selectRoomType` with the `room-breakfast` rate choice", () => {
      // The `selectRoomType(type.value, "room-breakfast")`
      // call is gone with the toggle. The
      // function still exists (back-compat for
      // the type alias) but only `"room-only"` is
      // wired.
      expect(bookingPageSrc).not.toMatch(
        /selectRoomType\(\s*type\.value\s*,\s*["']room-breakfast["']/
      );
    });

    it("the create-payload builder no longer sends the per-room `hasBreakfast` field", () => {
      // The new path uses `breakfastSelections`
      // instead. The per-room `hasBreakfast` is
      // gone from the create payload.
      expect(bookingPageSrc).not.toMatch(
        /roomSelections:\s*[\s\S]{0,500}?hasBreakfast:\s*breakfastConfig\.isEnabled/
      );
    });

    it("the create-payload builder no longer sends the per-room `breakfastIncludesChildren` field", () => {
      // The new path uses `breakfastSelections`
      // instead. The per-room
      // `breakfastIncludesChildren` is gone from
      // the create payload.
      expect(bookingPageSrc).not.toMatch(
        /roomSelections:\s*[\s\S]{0,500}?breakfastIncludesChildren,/
      );
    });
  });

  describe("Step 2 — the new Breakfast section is present", () => {
    it("the Step 2 form imports the new helpers from @spark-inn/shared", () => {
      // The new shape requires
      // `computeBreakfastCutoffState` (per-date
      // locked state) +
      // `recomputeBreakfastTotal` (sidebar
      // total) + `buildBreakfastRateBreakdownLines`
      // (per-date lines) +
      // `BreakfastSelectionEntry` (the entry
      // type). The single import line carries
      // all four.
      expect(bookingPageSrc).toMatch(
        /import\s*\{[\s\S]{0,200}computeBreakfastCutoffState[\s\S]{0,200}\}\s*from\s*["']@spark-inn\/shared["']/
      );
      expect(bookingPageSrc).toMatch(
        /import\s*\{[\s\S]{0,200}recomputeBreakfastTotal[\s\S]{0,200}\}\s*from\s*["']@spark-inn\/shared["']/
      );
      expect(bookingPageSrc).toMatch(
        /import\s*\{[\s\S]{0,200}buildBreakfastRateBreakdownLines[\s\S]{0,200}\}\s*from\s*["']@spark-inn\/shared["']/
      );
      expect(bookingPageSrc).toMatch(
        /import\s*\{[\s\S]{0,200}BreakfastSelectionEntry[\s\S]{0,200}\}\s*from\s*["']@spark-inn\/shared["']/
      );
    });

    it("the Step 2 form renders a `<select>` per breakfast date × per-guest slot", () => {
      // The per-date × per-guest meal grid is the
      // core of the new shape. The pin asserts
      // the `<select>` is inside the Step 2 form
      // (after the breakfast section heading
      // and before the guest details).
      const breakfastSection = bookingPageSrc.match(
        /<motion\.div[^>]*>[\s\S]{0,200}?Breakfast[\s\S]{0,15000}?<\/motion\.div>/
      );
      expect(breakfastSection, "breakfast section not found").toBeTruthy();
      expect(breakfastSection![0]).toMatch(/<select/);
      expect(breakfastSection![0]).toMatch(/<option value="">No meal — skip breakfast for this guest on this day<\/option>/);
    });

    it("the Step 2 form uses `computeBreakfastCutoffState` for the per-date locked state", () => {
      // The locked state is the
      // `cutoff.isLocked` boolean. The select
      // is `disabled={cutoff.isLocked}` and
      // the row shows "Ordering closed".
      expect(bookingPageSrc).toMatch(/computeBreakfastCutoffState\(\{/);
      expect(bookingPageSrc).toMatch(/disabled=\{cutoff\.isLocked\}/);
      expect(bookingPageSrc).toMatch(/Ordering closed/);
    });

    it("the Step 2 form holds the `breakfastSelections` state", () => {
      // The new state is a
      // `Record<string, BreakfastSelectionEntry>`
      // — the guest picks the meals and the
      // state is the create payload.
      expect(bookingPageSrc).toMatch(
        /useState<Record<string,\s*BreakfastSelectionEntry>>\(\{\}\)/
      );
    });

    it("the Step 2 form's create-payload builder sends the new `breakfastSelections` field", () => {
      // The create body now carries the rich
      // shape (instead of the per-room
      // `hasBreakfast` boolean). The new field
      // is `breakfastSelections`.
      expect(bookingPageSrc).toMatch(
        /guests:\s*Number\(guestDetails\.guestCount\)[\s\S]{0,1500}?breakfastSelections,/
      );
    });
  });

  describe("Step 2 sidebar — per-date breakfast breakdown", () => {
    it("the sidebar accepts the new `breakfastSelections` prop", () => {
      // The sidebar thread now reads the
      // rich shape (instead of the
      // `hasBreakfast` boolean). The
      // `BookingReviewAsideProps` interface
      // carries the new prop.
      expect(bookingPageSrc).toMatch(
        /interface\s+BookingReviewAsideProps[\s\S]{0,3000}?breakfastSelections\?:\s*Record<string,\s*BreakfastSelectionEntry>\s*\|\s*null;/
      );
    });

    it("the sidebar uses `recomputeBreakfastTotal` for the live breakfast total", () => {
      // The new path recomputes from the
      // selections via the shared helper. The
      // sidebar's `breakfastTotal` variable
      // now uses the ternary.
      expect(bookingPageSrc).toMatch(
        /const\s+breakfastTotal\s*=\s*useNewBreakfastShape\s*\?\s*recomputeBreakfastTotal/
      );
    });

    it("the sidebar uses `buildBreakfastRateBreakdownLines` for the per-date lines", () => {
      // The sidebar renders the per-date
      // lines (one per date) instead of the
      // single "Breakfast add-on" line.
      expect(bookingPageSrc).toMatch(
        /const\s+perDateBreakfastLines\s*=\s*useNewBreakfastShape\s*\?\s*buildBreakfastRateBreakdownLines/
      );
    });

    it("the sidebar renders the per-date `Breakfast (Mon DD, N meals)` line", () => {
      // The label format is the spec's
      // example. The sidebar's
      // `perDateBreakfastLines.map(...)`
      // renders each line.
      expect(bookingPageSrc).toMatch(/perDateBreakfastLines\.map\(\(line, index\)/);
    });
  });

  describe("Step 3 review — the same sidebar shape is threaded through", () => {
    it("Step 3's `<BookingReviewAside>` call site threads the new `breakfastSelections` prop", () => {
      // The Step 3 review reads the same cart
      // state, so the per-date breakdown is
      // identical.
      // Both Step 2 and Step 3 call sites
      // must thread the prop.
      const matches = bookingPageSrc.match(
        /<BookingReviewAside[\s\S]{0,3000}?breakfastSelections=\{breakfastSelections\}/g
      );
      expect(matches, "BookingReviewAside call sites with breakfastSelections prop not found").toBeTruthy();
      // At minimum Step 2 + Step 3 both thread it.
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("api-router — the new public endpoint", () => {
    it("the new `GET /api/bookings/breakfast/config` route is registered", () => {
      // The route is `domain === "bookings" &&
      // action === "breakfast" && req.method ===
      // "GET"`. The third URL segment (`config`)
      // is dropped by the `[domain, action] =
      // pathSegments` destructuring.
      expect(apiRouterSrc).toMatch(
        /domain\s*===\s*["']bookings["']\s*&&\s*action\s*===\s*["']breakfast["']\s*&&\s*req\.method\s*===\s*["']GET["']/
      );
    });
  });
});
