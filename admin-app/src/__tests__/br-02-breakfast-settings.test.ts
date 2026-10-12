import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Per BR-02 / decision #231 (2026-10-12, breakfast redesign):
// the Breakfast & Dining tab on `admin-app/src/pages/SettingsPage.tsx`
// is extended to carry the new `BreakfastConfig` shape from BR-01.
// This is a source-text tripwire suite that pins:
//
//   1. The save handler writes the new payload (no legacy fields)
//   2. The save handler Zod-validates against `BreakfastConfigSchema`
//   3. The new UI fields (cutoff time, timezone, override, instructions,
//      served-grace minutes, meals table) are wired correctly
//   4. The cutoff-change audit subcollection is written after save
//   5. The state hooks no longer reference the removed
//      `silogItems` / `breakfastRate` / `breakfastIncludesChildrenDefault`
//      legacy fields
//
// A regression that re-introduces the legacy fields, drops the Zod
// gate, or breaks the meals table contract will fail one of these.

const settingsPage = read("admin-app/src/pages/SettingsPage.tsx");

// Capture the save handler body so the tests can grep for specific
// payload keys + the Zod-validation call site without false positives
// from the unrelated `handleSaveDiscounts` / `handleSaveVat` /
// `handleSaveHolds` save handlers. We anchor on `handleSaveBreakfast`
// and read until the next `};` at the same brace depth.
const extractSaveHandler = (): string => {
  const startMatch = settingsPage.match(/const\s+handleSaveBreakfast\s*=\s*async/);
  if (!startMatch || startMatch.index === undefined) return "";
  const startIdx = startMatch.index;
  let depth = 0;
  let i = startIdx;
  while (i < settingsPage.length) {
    const ch = settingsPage[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return settingsPage.slice(startIdx, i + 1);
      }
    }
    i++;
  }
  return settingsPage.slice(startIdx);
};

const saveHandler = extractSaveHandler();

// Capture the `activeTab === "breakfast"` JSX block so the form-body
// tests can grep for the UI elements without false positives from the
// other Settings tabs. Anchor on the literal `{activeTab === "breakfast"
// && (` and read to the closing `)}`.
const extractBreakfastUi = (): string => {
  const startMatch = settingsPage.match(/\{activeTab === "breakfast" && \(/);
  if (!startMatch || startMatch.index === undefined) return "";
  const startIdx = startMatch.index;
  // Walk forward and find the matching `)}` at brace depth 0.
  let depth = 0;
  let i = startIdx;
  while (i < settingsPage.length) {
    const ch = settingsPage[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Skip ahead past the closing `)` of the && short-circuit.
        const close = settingsPage.indexOf(")}", i);
        return close > -1 ? settingsPage.slice(startIdx, close + 2) : settingsPage.slice(startIdx);
      }
    }
    i++;
  }
  return settingsPage.slice(startIdx);
};

const breakfastUi = extractBreakfastUi();

// Capture the breakfast block of `useState` hooks. We anchor on
// `const [breakfastMeals, setBreakfastMeals]` (the last breakfast
// hook before the `// 5. Store Config states` block begins) and
// read backwards through the comment + every preceding
// `useState` line in the block.
const extractBreakfastStateBlock = (): string => {
  const mealsAnchor = settingsPage.indexOf("const [breakfastMeals, setBreakfastMeals] = useState");
  if (mealsAnchor === -1) return "";
  // Walk backward to the line that starts with "// 4. Breakfast Config states"
  const startComment = settingsPage.lastIndexOf("// 4. Breakfast Config states", mealsAnchor);
  if (startComment === -1) return "";
  // Walk forward until the line that starts with "// 5. Store Config states"
  const endComment = settingsPage.indexOf("// 5. Store Config states", mealsAnchor);
  if (endComment === -1) return settingsPage.slice(startComment);
  return settingsPage.slice(startComment, endComment);
};
const breakfastStateBlock = extractBreakfastStateBlock();

describe("BR-02 — Admin Settings: Breakfast & Dining tab", () => {
  describe("save handler — new payload shape only", () => {
    test("writes `meals`, `cutoffTime`, `cutoffTimezone`, `frontDeskOverrideEnabled`, `servedGraceMinutes`, `defaultMealInstructions`", () => {
      // The new payload keys must be present in the save handler.
      expect(saveHandler).toMatch(/\bmeals\s*:\s*breakfastMeals\b/);
      expect(saveHandler).toMatch(/\bcutoffTime\s*:\s*breakfastCutoffTime\b/);
      expect(saveHandler).toMatch(/\bcutoffTimezone\s*:\s*config\.timezone\b/);
      expect(saveHandler).toMatch(/\bfrontDeskOverrideEnabled\s*:\s*breakfastFrontDeskOverrideEnabled\b/);
      expect(saveHandler).toMatch(/\bservedGraceMinutes\s*:/);
      expect(saveHandler).toMatch(/\bdefaultMealInstructions\s*:\s*breakfastDefaultMealInstructions\b/);
    });

    test("does NOT write any of the removed legacy fields", () => {
      // The legacy flat-rate model is gone — `ratePerPersonPerNight` /
      // `breakfastIncludesChildrenDefault` / `silogItems` must not
      // appear in the save payload. They may still appear in
      // comments (e.g. the DEVIATION note at the top of the handler
      // explicitly calls them out), so we restrict the assertion to
      // the payload object literal.
      const payloadMatch = saveHandler.match(/const\s+payload\s*=\s*\{([\s\S]*?)\};/);
      expect(payloadMatch, "expected to find the save payload object literal").toBeTruthy();
      const payload = payloadMatch![1];
      expect(payload).not.toMatch(/ratePerPersonPerNight/);
      expect(payload).not.toMatch(/breakfastIncludesChildrenDefault/);
      expect(payload).not.toMatch(/silogItems/);
    });

    test("Zod-validates the payload via BreakfastConfigSchema.safeParse before updateSettings", () => {
      // The validation call site must come BEFORE the `runSettingsSave`
      // (and its inner `updateSettings` call) — a regression that
      // removes the Zod gate fires `updateSettings` with a possibly
      // invalid payload.
      const validationIdx = saveHandler.indexOf("BreakfastConfigSchema.safeParse(");
      const updateIdx = saveHandler.indexOf("updateSettings(");
      expect(validationIdx).toBeGreaterThan(-1);
      expect(updateIdx).toBeGreaterThan(-1);
      expect(validationIdx, "safeParse must come before updateSettings").toBeLessThan(updateIdx);

      // The success branch uses `parsed.data`, not the raw payload —
      // Zod's default-stripping of unknown keys is the contract.
      expect(saveHandler).toMatch(/updateSettings\(["']breakfastConfig["'],\s*parsed\.data\)/);
    });

    test("emits a toast when Zod validation fails (e.g. cutoffTime = '25:99')", () => {
      // The handler reads `parsed.error.issues[0]` to surface the
      // first failure as a human-readable message and short-circuits
      // (does NOT call `updateSettings`).
      expect(saveHandler).toMatch(/parsed\.error\.issues\[0\]/);
      expect(saveHandler).toMatch(/toast\.error\(/);
      expect(saveHandler).toMatch(/return;\s*$/m);
    });

    test("cutoffTimezone is sourced from config.timezone (NOT from a useState hook)", () => {
      // Per spec §Admin Settings: `cutoffTimezone` is derived from
      // the hotel config timezone (the only authoritative source —
      // `hotel.config.ts`). It must not be a `useState`.
      //
      // The codebase does not expose `hotelConfig.timezone` (the
      // hotel timezone lives at the top-level of `hotel.config.ts`
      // and is imported as `config`). The save handler must read it
      // from that constant, not a local React state.
      expect(saveHandler).toMatch(/cutoffTimezone\s*:\s*config\.timezone\b/);
      expect(saveHandler).not.toMatch(/cutoffTimezone\s*:\s*[a-zA-Z]+State\b/);
      expect(saveHandler).not.toMatch(/setCutoffTimezone/);
    });
  });

  describe("save handler — cutoff-change audit log", () => {
    test("writes a `breakfastConfigChangeLog` subcollection entry per changed CONFIG field", () => {
      // The audit ref is built under the existing
      // `settings/breakfastConfig` doc — a subcollection, NOT a new
      // top-level collection (the BR-02 ticket scope forbids new
      // top-level collections).
      expect(saveHandler).toMatch(
        /collection\(db,\s*["']settings["'],\s*["']breakfastConfig["'],\s*["']breakfastConfigChangeLog["']\)/
      );
      expect(saveHandler).toMatch(/addDoc\(auditRef,/);
    });

    test("audit entry carries field / before / after / changedBy / changedAt", () => {
      // Per spec §Admin Settings: the audit shape is
      // `{ field, before, after, changedBy, changedAt }`. The
      // `field` is a shorthand property (the loop key is also
      // named `field`); `changedAt` uses Firestore `serverTimestamp()`
      // (the canonical "trust the server" timestamp per
      // GOTCHAS §Firebase).
      expect(saveHandler).toMatch(/\bfield\b\s*,/);
      expect(saveHandler).toMatch(/\bbefore\b\s*:/);
      expect(saveHandler).toMatch(/\bafter\b\s*:/);
      expect(saveHandler).toMatch(/\bchangedBy\b\s*,/);
      expect(saveHandler).toMatch(/\bchangedAt\b\s*:\s*serverTimestamp\(\)/);
    });

    test("audit fires AFTER `updateSettings` succeeds (no log on rolled-back writes)", () => {
      // Per spec: "Place this call inside handleSaveBreakfast, AFTER
      // the updateSettings call succeeds (to avoid logging a change
      // that didn't actually persist)". The audit branch is gated on
      // `if (success)` after the `await updateSettings(...)` call.
      const updateIdx = saveHandler.indexOf("await updateSettings(");
      const auditIdx = saveHandler.indexOf("addDoc(auditRef,");
      expect(updateIdx).toBeGreaterThan(-1);
      expect(auditIdx).toBeGreaterThan(-1);
      expect(auditIdx, "audit must come after the updateSettings call").toBeGreaterThan(updateIdx);
      // The audit branch is inside an `if (success)` block — guard
      // for that too.
      const successGate = saveHandler.indexOf("if (success)", updateIdx);
      expect(successGate).toBeGreaterThan(-1);
      expect(successGate).toBeLessThan(auditIdx);
    });

    test("meal-row changes are NOT audited (audit loop walks a fixed config-field allowlist)", () => {
      // Per spec: "Meal-row changes (add/edit/remove meal) are NOT
      // audited — meals are content, not config". The audit loop
      // walks the config-field allowlist (cutoffTime /
      // frontDeskOverrideEnabled / defaultMealInstructions), not
      // the `meals` array.
      expect(saveHandler).not.toMatch(/audit.*meals/);
      expect(saveHandler).not.toMatch(/meals.*audit/);
      // The nextSnapshot keys must not include `meals`.
      const nextSnapMatch = saveHandler.match(/const\s+nextSnapshot[\s\S]*?\}\s*;/);
      expect(nextSnapMatch).toBeTruthy();
      expect(nextSnapMatch![0]).not.toMatch(/\bmeals\b\s*:/);
    });
  });

  describe("form body — UI elements", () => {
    test("renders a `<input type=\"time\">` for `cutoffTime`", () => {
      expect(breakfastUi).toMatch(/<input[^>]*\btype=["']time["'][^>]*\bvalue=\{breakfastCutoffTime\}/);
    });

    test("renders a read-only timezone display sourced from `config.timezone`", () => {
      // The timezone is a read-only field, not a `<input>`. It must
      // pull from `config.timezone` (the hotel config) and live
      // next to a helper line that says it can only be changed by a
      // developer.
      expect(breakfastUi).toMatch(/\{config\.timezone\}/);
      expect(breakfastUi).toMatch(/Contact the developer to change/);
    });

    test("renders a `<textarea>` for `defaultMealInstructions`", () => {
      expect(breakfastUi).toMatch(/<textarea[^>]*\bvalue=\{breakfastDefaultMealInstructions\}/);
    });

    test("renders a `<input type=\"number\">` for `servedGraceMinutes`", () => {
      // Per Open Item #5: the served-grace window input. The BR-01
      // data model patch added `servedGraceMinutes` to the shared
      // `BreakfastConfig` + `BreakfastConfigSchema`, so the value
      // is now persisted on save (see `handleSaveBreakfast`).
      expect(breakfastUi).toMatch(
        /<input[^>]*\btype=["']number["'][^>]*\bvalue=\{breakfastServedGraceMinutes\}/
      );
    });

    test("renders the new `frontDeskOverrideEnabled` toggle", () => {
      // The toggle replaces the legacy `breakfastIncludesChildrenDefault`
      // toggle (which is gone per decision #4: children are ordinary
      // meal slots).
      expect(breakfastUi).toMatch(/setBreakfastFrontDeskOverrideEnabled/);
      expect(breakfastUi).toMatch(/Front desk can override the cutoff/);
    });
  });

  describe("form body — meals table", () => {
    test("renders a `<table>` with one row per meal", () => {
      expect(breakfastUi).toMatch(/<table[^>]*>/);
      // The implementation spreads + sorts the array before mapping
      // so the rendered order matches `displayOrder` (matches the
      // up/down arrow handlers in `handleMoveBreakfastMeal`). The
      // span is wide enough to cover the intermediate
      // `.sort((a, b) => ...)` call between the spread and the
      // `.map(...)`.
      expect(breakfastUi).toMatch(/\[\.\.\.breakfastMeals\][\s\S]{0,400}?\.map\(/);
    });

    test("renders a `<input type=\"number\">` price input per row", () => {
      // Each row has a price input. The validation message shows
      // when the value is out of the 0..10,000 PHP range.
      expect(breakfastUi).toMatch(/<input[^>]*\btype=["']number["'][^>]*\bmax=\{10000\}/);
      expect(breakfastUi).toMatch(/Must be 0–10,000 PHP/);
    });

    test("renders a description input per row (max 200 chars with counter)", () => {
      // The description input has a `maxLength={200}` and the row
      // shows a `{length} / 200` counter.
      expect(breakfastUi).toMatch(/<input[^>]*\bmaxLength=\{200\}/);
      expect(breakfastUi).toMatch(/\/ 200/);
    });

    test("renders a display-order column with up/down arrow buttons", () => {
      // Per spec: "displayOrder: numeric, asc, drag-to-reorder".
      // The codebase's pattern is arrow buttons for room-type
      // ordering (no drag library). The column header reads "Order"
      // and each row exposes `<ArrowUp>` / `<ArrowDown>` controls.
      expect(breakfastUi).toMatch(/>Order</);
      expect(breakfastUi).toMatch(/handleMoveBreakfastMeal/);
      expect(breakfastUi).toMatch(/<ArrowUp\b/);
      expect(breakfastUi).toMatch(/<ArrowDown\b/);
    });

    test("renders an `isActive` toggle per row", () => {
      expect(breakfastUi).toMatch(/handleUpdateBreakfastMeal\([^)]*\{\s*isActive\s*:/);
    });

    test("renders a red \"Inactive\" pill for `isActive: false` rows (with tooltip)", () => {
      // Per spec: "Status pill for `isActive: false`: 'Inactive'
      // (red), with a tooltip showing how many bookings still
      // reference this meal". The pill is conditionally rendered
      // (`!meal.isActive`), styled with the red-bg / red-text
      // tokens, and carries a `title` attribute with the snapshot
      // immutability note.
      expect(breakfastUi).toMatch(/!meal\.isActive/);
      expect(breakfastUi).toMatch(/Inactive/);
      expect(breakfastUi).toMatch(/snapshot is immutable/);
    });

    test("renders a delete control per row", () => {
      expect(breakfastUi).toMatch(/handleDeleteBreakfastMeal\(/);
      expect(breakfastUi).toMatch(/Delete meal/);
    });

    test("renders an Add meal button that opens a new inline row", () => {
      expect(breakfastUi).toMatch(/handleAddBreakfastMeal/);
      expect(breakfastUi).toMatch(/Add meal/);
    });
  });

  describe("state hooks — no legacy symbols remain", () => {
    test("the breakfast block no longer references `silogItems` / `setSilogItems` / `breakfastRate` / `setBreakfastRate` / `breakfastIncludesChildrenDefault`", () => {
      // The hooks block at the top of the Breakfast tab was replaced
      // with the new shape. The legacy field names must NOT appear
      // as state identifiers in that block (they may appear in
      // comments documenting what was removed).
      expect(breakfastStateBlock).not.toMatch(/const\s+\[\s*silogItems\s*,\s*setSilogItems\s*\]/);
      expect(breakfastStateBlock).not.toMatch(/const\s+\[\s*breakfastRate\s*,\s*setBreakfastRate\s*\]/);
      expect(breakfastStateBlock).not.toMatch(
        /const\s+\[\s*breakfastIncludesChildrenDefault\s*,\s*setBreakfastIncludesChildrenDefault\s*\]/
      );
    });

    test("the breakfast block declares the new state hooks for the new shape", () => {
      // The new hooks must all be present (in some order). Each one
      // is a `useState` call on a `breakfastConfig.*` property OR
      // a derived default from `DEFAULT_BREAKFAST_*`.
      expect(breakfastStateBlock).toMatch(/breakfastEnabled/);
      expect(breakfastStateBlock).toMatch(/breakfastCutoffTime/);
      expect(breakfastStateBlock).toMatch(/breakfastFrontDeskOverrideEnabled/);
      expect(breakfastStateBlock).toMatch(/breakfastDefaultMealInstructions/);
      expect(breakfastStateBlock).toMatch(/breakfastServedGraceMinutes/);
      expect(breakfastStateBlock).toMatch(/breakfastMeals/);
    });

    test("`breakfastMeals` hydrates from the legacy `silogItems` when only the legacy shape is present", () => {
      // Back-compat acceptance criterion: if the `breakfastConfig`
      // prop has only the legacy `silogItems` field (no `meals`),
      // the form hydrates with the new `meals` array derived from
      // it. The hydration reads `breakfastConfig.silogItems` and
      // maps each `{ id, name, isActive }` to the new shape with
      // `price: 0`, `description: ""`, `displayOrder: <index>`,
      // and `createdAt`/`updatedAt` ISO strings.
      expect(breakfastStateBlock).toMatch(/const\s+\[breakfastMeals,\s*setBreakfastMeals\]\s*=\s*useState<BreakfastMeal\[\]>\(/);
      expect(breakfastStateBlock).toMatch(/Array\.isArray\(breakfastConfig\.meals\)/);
      expect(breakfastStateBlock).toMatch(/Array\.isArray\(breakfastConfig\.silogItems\)/);
      expect(breakfastStateBlock).toMatch(/\bprice\s*:\s*0\b/);
      expect(breakfastStateBlock).toMatch(/\bdescription\s*:\s*["']{2}/);
      expect(breakfastStateBlock).toMatch(/\bdisplayOrder\s*:\s*index\b/);
      expect(breakfastStateBlock).toMatch(/new Date\(\)\.toISOString\(\)/);
    });
  });

  describe("shared constants + Zod schema are imported (not duplicated)", () => {
    test("imports `DEFAULT_BREAKFAST_CUTOFF_TIME` + `DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES` from `@spark-inn/shared`", () => {
      // The two constants come from the same `@spark-inn/shared`
      // import block. Both names must appear + the closing `from
      // "@spark-inn/shared"` must follow. The span is wide enough
      // to tolerate the import block's other named exports in
      // between.
      expect(settingsPage).toMatch(/DEFAULT_BREAKFAST_CUTOFF_TIME/);
      expect(settingsPage).toMatch(/DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES/);
      // Find the import block that includes both constants, then
      // assert it ends at `from "@spark-inn/shared"`.
      const importBlock = settingsPage.match(
        /import\s*\{[\s\S]*?DEFAULT_BREAKFAST_CUTOFF_TIME[\s\S]*?DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES[\s\S]*?\}\s*from\s+["']@spark-inn\/shared["']/
      );
      expect(importBlock, "expected both constants in a single @spark-inn/shared import").toBeTruthy();
    });

    test("imports `BreakfastConfig` + `BreakfastMeal` types from `@spark-inn/shared`", () => {
      expect(settingsPage).toMatch(/type\s+BreakfastConfig/);
      expect(settingsPage).toMatch(/type\s+BreakfastMeal/);
    });

    test("imports `BreakfastConfigSchema` from `@spark-inn/shared/schemas/booking`", () => {
      expect(settingsPage).toMatch(
        /import\s*\{\s*BreakfastConfigSchema\s*\}\s*from\s+["']@spark-inn\/shared\/schemas\/booking["']/
      );
    });
  });
});