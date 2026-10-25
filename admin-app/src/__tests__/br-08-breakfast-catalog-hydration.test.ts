// Per AI-BROWSER-QA (2026-10-25, §3.17): the Breakfast & Dining tab must
// show the hotel's LIVE breakfast catalogue — and saving it must not
// replace the live menu with the seeded defaults.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The Dining tab kept its own copy of the catalogue, initialised ONCE at
// mount from the AdminContext DEFAULT state and never re-hydrated when the
// live `settings/breakfastConfig` snapshot arrived. So the operator saw
// three seeded rows (`sl-1..sl-3`, a flat rate) instead of the hotel's
// live menu (six meals, each at its own price), and "Save Dining
// Settings" wrote those seeds over the live menu — three meals vanished
// from the guest's booking Step 2 and the survivors were re-priced.
//
// The live snapshot now wins, and the operator's own edit then wins over
// the snapshot.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(resolve(__dirname, "../pages/SettingsPage.tsx"), "utf8");

describe("BR-08 — the Dining tab follows the LIVE breakfast catalogue", () => {
  it("the tab re-hydrates when the live snapshot arrives", () => {
    expect(settingsSrc).toMatch(/const \[breakfastEdited, setBreakfastEdited\] = useState\(false\)/);
    expect(settingsSrc).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(breakfastEdited\) return;/);
    expect(settingsSrc).toMatch(/\[breakfastConfig, breakfastEdited\]/);
  });

  it("the live MEALS replace the seeded rows", () => {
    expect(settingsSrc).toMatch(/if \(Array\.isArray\(live\.meals\) && live\.meals\.length > 0\)/);
    // The hydration writes the rows the save then persists.
    expect(settingsSrc).toMatch(/setBreakfastMeals\(\s*\n\s*live\.meals\.map/);
    expect(settingsSrc).toMatch(/meals: breakfastMeals/);
  });

  it("the live cut-off + the other tab fields follow the snapshot too", () => {
    expect(settingsSrc).toMatch(/setBreakfastCutoffTime\(live\.cutoffTime\)/);
    expect(settingsSrc).toMatch(/setBreakfastCutoffsEnabled\(live\.cutoffsEnabled\)/);
    expect(settingsSrc).toMatch(/setBreakfastServedGraceMinutes\(String\(live\.servedGraceMinutes\)\)/);
    expect(settingsSrc).toMatch(/setBreakfastDefaultMealInstructions\(live\.defaultMealInstructions\)/);
  });

  it("the operator's own edit stops the hydration", () => {
    // Every editor marks the tab as edited, so a half-typed value is not
    // clobbered by the next snapshot.
    const edits = [
      "setBreakfastEdited(true); setBreakfastCutoffTime",
      "setBreakfastEdited(true); setBreakfastDefaultMealInstructions",
      "setBreakfastEdited(true); setBreakfastServedGraceMinutes",
      "setBreakfastEdited(true); setBreakfastCutoffsEnabled",
      "setBreakfastEdited(true); setBreakfastEnabled",
      "setBreakfastEdited(true); setBreakfastFrontDeskOverrideEnabled"
    ];
    for (const edit of edits) {
      expect(settingsSrc, `missing edit marker: ${edit}`).toContain(edit);
    }
    // The four meal-row editors mark it too.
    const mealEditors = [
      "const handleAddBreakfastMeal = () => {\n    setBreakfastEdited(true);",
      "setBreakfastEdited(true);\n    setBreakfastMeals((prev) => applyBreakfastMealPatch(prev, id, patch));",
      "setBreakfastEdited(true);\n    setBreakfastMeals((prev) => prev.filter((meal) => meal.id !== id));",
      "setBreakfastEdited(true);\n    setBreakfastMeals((prev) => {"
    ];
    for (const editor of mealEditors) {
      expect(settingsSrc, `missing edit marker: ${editor.split("\n")[0]}`).toContain(editor);
    }
  });
});
