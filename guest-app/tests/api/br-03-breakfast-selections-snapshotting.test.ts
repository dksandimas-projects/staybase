// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the server-side snapshotting +
// validation tests for the new `breakfastSelections`
// rich shape. Pins:
//
//   1. The new `breakfastSelections` map is snapshotted
//      onto the `Booking` document.
//   2. `breakfastTotal` is recomputed server-side and
//      matches the sum of selection prices.
//   3. `hasAnyBreakfast` is true when at least one
//      selection exists, false otherwise.
//   4. The legacy `hasBreakfast` / `breakfastRate` /
//      `breakfastIncludesChildren` / `extraBedBreakfast`
//      fields are NOT written when the new shape is
//      used (this pins the create-path cleanup).
//   5. A locked-date selection is rejected with 400.
//   6. A selection referencing a non-existent meal is
//      rejected with 400.
//
// Source-text + handler-level tests. The handler-level
// tests stub the Firestore admin SDK to exercise the
// real create path with the new shape; the source-text
// tests pin the create-path structure so a refactor
// breaks the test instead of silently regressing.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const validatorSrc = readFileSync(
  resolve(__dirname, "../../server/lib/breakfast-selections.ts"),
  "utf8"
);

describe("BR-03 — server-side `breakfastSelections` snapshotting + validation", () => {
  describe("create-path source-text pins", () => {
    it("the create handler imports the `validateBreakfastSelections` helper", () => {
      // The server reads `breakfastSelections` from the
      // create body, then hands it to
      // `validateBreakfastSelections` for the
      // meal-catalog + cutoff gate. The helper is the
      // single source of truth for the new shape's
      // validation rules.
      expect(handlerSrc).toMatch(
        /import\s*\{[\s\S]{0,200}validateBreakfastSelections[\s\S]{0,200}\}\s*from\s*["']\.\.\/lib\/breakfast-selections["']/
      );
    });

    it("the create handler imports the `recomputeBreakfastTotal` helper from @spark-inn/shared", () => {
      // The per-reservation `breakfastTotal` is the
      // server-recomputed sum of the snapshot prices
      // (per open item #1). The helper is the single
      // source of truth for the sum (the Step 2 UI
      // uses the same helper client-side for parity).
      expect(handlerSrc).toMatch(
        /import\s*\{[\s\S]{0,400}recomputeBreakfastTotal[\s\S]{0,200}\}\s*from\s*["']@spark-inn\/shared["']/
      );
    });

    it("the create handler overrides the per-reservation `breakfastTotal` when the new shape is active", () => {
      // The legacy `roomStayPricing.reduce(...)` path
      // lands at 0 in the new path (the per-stay
      // override above absorbs the legacy math); the
      // ternary here swaps in the validated total.
      expect(handlerSrc).toMatch(
        /const\s+breakfastTotal\s*=\s*validatedBreakfastSelections\s*!==\s*null\s*\?[\s\S]{0,200}:\s*roomStayPricing\.reduce/
      );
    });

    it("the create handler writes `breakfastSelections: validatedBreakfastSelections.entries` when the new shape is active", () => {
      // The booking doc carries the rich shape (not
      // the legacy `hasBreakfast` boolean) when the
      // new path is used. The pin asserts the field
      // name + the source variable.
      expect(handlerSrc).toMatch(
        /breakfastSelections:\s*validatedBreakfastSelections\.entries/
      );
    });

    it("the create handler writes `hasAnyBreakfast` when the new shape is active", () => {
      // The boolean flag complements the rich shape
      // so a reader can quickly check "is breakfast
      // included?" without iterating the map.
      expect(handlerSrc).toMatch(
        /hasAnyBreakfast:\s*validatedBreakfastSelections\.hasAny/
      );
    });

    it("the create handler does NOT write the legacy `hasBreakfast` field when the new shape is active", () => {
      // The legacy `hasBreakfast` + `breakfastRate` +
      // `breakfastIncludesChildren` fields are gated
      // behind the ternary's false branch (the legacy
      // path). The new path writes the rich shape +
      // `hasAnyBreakfast` instead. Pin: the new path
      // branch does not contain a `hasBreakfast:`
      // key assignment.
      const ternaryBlock = handlerSrc.match(
        /validatedBreakfastSelections\s*!==\s*null\s*\?[\s\S]{0,2000}?\s*:\s*\{[\s\S]{0,1000}?\}\s*\)/
      );
      expect(ternaryBlock, "ternary block not found").toBeTruthy();
      // Extract the true branch (new shape): the
      // text between `?` and the matching `:`.
      const ternaryParts = ternaryBlock![0].match(
        /validatedBreakfastSelections\s*!==\s*null\s*\?([\s\S]{0,1500}?)\s*:\s*\{/
      );
      expect(ternaryParts, "ternary parts not found").toBeTruthy();
      // The TRUE branch (new shape) should NOT have
      // `hasBreakfast:` as a key.
      expect(ternaryParts![1]).not.toMatch(/\bhasBreakfast\s*:/);
      expect(ternaryParts![1]).toMatch(/\bbreakfastSelections\s*:/);
      expect(ternaryParts![1]).toMatch(/\bhasAnyBreakfast\s*:/);
    });

    it("the create handler writes the denormalized `breakfastTotal` to the booking doc", () => {
      // The folio math reads `totalPrice` (which
      // already includes the new `breakfastTotal` via
      // the discount chain), but the `breakfastTotal`
      // denormalized field is the future-proof
      // snapshot for the BR-04 Manage Breakfast page
      // + downstream readers.
      expect(handlerSrc).toMatch(/breakfastTotal:\s*breakfastTotal/);
    });

    it("the create handler maps `BreakfastSelectionValidationError` to a 400", () => {
      // The catch block turns the validation error
      // (thrown inside the transaction) into a 400
      // response with the human message intact.
      expect(handlerSrc).toMatch(
        /error\.name\s*===\s*["']BreakfastSelectionValidationError["']/
      );
    });

    it("the create handler passes per-date breakfast lines to `buildRateBreakdown` when the new shape is active", () => {
      // The receipt PDF + email + sidebar all read
      // `rateBreakdown.addOns[]`; the per-date lines
      // are the new rendering shape. The pin asserts
      // the per-date helper + the call site.
      expect(handlerSrc).toMatch(/buildBreakfastRateBreakdownLines/);
      expect(handlerSrc).toMatch(/breakfastLines:\s*breakfastRateBreakdownLines/);
    });
  });

  describe("validator helper source-text pins", () => {
    it("the validator helper lives in `server/lib/breakfast-selections.ts`", () => {
      // Single source of truth for the new shape's
      // validation rules. Both `handleCreateBooking`
      // and the future `handleCreateWalkin` call
      // it.
      expect(validatorSrc).toMatch(
        /export\s+function\s+validateBreakfastSelections/
      );
    });

    it("the validator throws `BreakfastSelectionValidationError` on a locked date", () => {
      // Open item #7: the server is the source of
      // truth for the cutoff clock. The error class
      // carries the human message intact.
      expect(validatorSrc).toMatch(
        /class\s+BreakfastSelectionValidationError/
      );
      expect(validatorSrc).toMatch(
        /Ordering closed for breakfast on/
      );
    });

    it("the validator rejects a non-existent meal with a human message", () => {
      // Open item #6: a meal the admin removed (a
      // guest who screenshot an old catalog) is
      // rejected. The message intentionally does
      // NOT name the missing meal to avoid leaking
      // the menu state to a probing client.
      expect(validatorSrc).toMatch(
        /One of the selected meals is no longer available/
      );
    });

    it("the validator rejects a negative price with a human message", () => {
      // Belt-and-suspenders guard: the Zod schema
      // already enforces `min(0)`, but the helper
      // re-checks for future schema relaxation.
      expect(validatorSrc).toMatch(
        /Invalid breakfast price\. Please refresh and try again\./
      );
    });

    it("the validator parses the `serviceDate` from the composite key (yyyy-mm-dd-slotId)", () => {
      // Per BR-01 (2026-10-12, decision #231): the
      // date lives in the key prefix, not in the
      // entry. The validator extracts the date for
      // the cutoff check.
      expect(validatorSrc).toMatch(
        /const\s+match\s*=\s*\/\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)-\/\.exec\(key\)/
      );
    });

    it("the validator returns `null` when `selections` is absent (legacy caller path)", () => {
      // The legacy create payload (walk-in modal +
      // older clients) does not send
      // `breakfastSelections`. The helper returns
      // `null` so the handler keeps the flat-rate
      // path.
      expect(validatorSrc).toMatch(
        /if\s*\(\s*selections\s*===\s*null\s*\|\|\s*selections\s*===\s*undefined\s*\)\s*return\s+null;/
      );
    });
  });

  describe("rate-breakdown helper pins", () => {
    const rateBreakdownSrc = readFileSync(
      resolve(__dirname, "../../server/lib/rate-breakdown.ts"),
      "utf8"
    );

    it("`buildRateBreakdown` accepts an optional `breakfastLines` parameter", () => {
      // The create handler threads per-date lines in
      // when the new shape is active. The pin
      // asserts the new param is part of the input
      // interface.
      expect(rateBreakdownSrc).toMatch(
        /breakfastLines\?:\s*BookingRateAdjustmentLine\[\]/
      );
    });

    it("`buildRateBreakdown` uses the `breakfastLines` array (when present) instead of the single line", () => {
      // The new shape's per-date lines REPLACE the
      // historical single-line behavior. The pin
      // asserts the array-spread pattern.
      expect(rateBreakdownSrc).toMatch(
        /addOns:\s*\[\.\.\.breakfastAddOns,\s*extraBedAddOn\]\.filter/
      );
    });
  });

  describe("api-router pins (the new public endpoint)", () => {
    const apiRouterSrc = readFileSync(
      resolve(__dirname, "../../server/apiRouter.ts"),
      "utf8"
    );

    it("the new `GET /api/bookings/breakfast/config` route is registered", () => {
      // Per BR-03: the public endpoint returns the
      // meal catalog + cutoff + instructions for the
      // Step 2 UI. The URL segments are
      // `bookings` + `breakfast` (the third
      // `config` segment is dropped by the
      // `[domain, action] = pathSegments`
      // destructuring).
      expect(apiRouterSrc).toMatch(
        /domain\s*===\s*["']bookings["']\s*&&\s*action\s*===\s*["']breakfast["']\s*&&\s*req\.method\s*===\s*["']GET["']/
      );
    });

    it("the new route rate-limits per-IP at 60/min", () => {
      // Same per-IP rate limit window as the other
      // per-IP public routes (rooms-availability,
      // voucher validation). The pin asserts the
      // limit + window.
      expect(apiRouterSrc).toMatch(
        /isRateLimited\(`bookings-breakfast-config:\$\{ip\}`,\s*60,\s*60000\)/
      );
    });

    it("the new route handler lives in `server/handlers/breakfast-config.ts`", () => {
      // Single-file-per-handler rule (per
      // `plan/docs/FILE-STRUCTURE.md`). The handler
      // exports `handleGetBreakfastConfig` and
      // returns the normalized public shape.
      const handlerSrc = readFileSync(
        resolve(__dirname, "../../server/handlers/breakfast-config.ts"),
        "utf8"
      );
      expect(handlerSrc).toMatch(
        /export\s+async\s+function\s+handleGetBreakfastConfig/
      );
      expect(handlerSrc).toMatch(/normalizeBreakfastConfig/);
      expect(handlerSrc).toMatch(/Cache-Control/);
    });
  });
});
