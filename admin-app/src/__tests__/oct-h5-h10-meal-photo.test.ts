// Per OCT-H5 + OCT-H10 (2026-10-20, decisions #283 + #284): the
// meal-photo upload / removal.
//
// OCT-H5 — removing a meal photo broke EVERY Dining settings save.
//
// Object spread copies own enumerable keys INCLUDING undefined-valued
// ones, so a `{ imageUrl: undefined }` patch left the meal object
// OWNING an `imageUrl` key with the value `undefined`. Zod's
// `.optional()` validates the VALUE, not the key's presence, so the
// bad payload passed schema validation and then threw
// `Unsupported field value: undefined` at the Firestore SDK
// boundary (the admin app never sets `ignoreUndefinedProperties`).
//
// The failure mode was not scoped to the field that caused it: the
// offending key sat inside one element of the
// `breakfastConfig.meals` array, so EVERY subsequent write of that
// section failed — the admin could not save the cut-off time, the
// breakfast toggle, a meal name or a price until they reloaded.
//
// OCT-H10 — the upload was never persisted.
//
// `handleUploadBreakfastMealImage` only mutated local state and
// toasted "Meal image uploaded". The guest-facing catalog still had
// no photo until the admin separately pressed Save, and navigating
// away orphaned the Storage object so the upload appeared lost.
//
// THE FIX
//
//   - `applyBreakfastMealPatch` is the ONE place a meal-row patch
//     is applied: it drops undefined-valued keys and REMOVES a
//     previously-set optional field when the patch clears it.
//   - `updateSettings` strips undefined-valued keys from every
//     payload (a safety net for the whole settings surface).
//   - The photo upload / removal persists the `meals` array
//     immediately, through the same schema validation the Save
//     button uses.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const settings = codeOnly(settingsSrc);
const adminContext = codeOnly(adminContextSrc);

describe("OCT-H5 — a removed meal photo cannot break the settings save", () => {
  it("the meal patch drops undefined-valued keys", () => {
    expect(settings).toMatch(
      /const cleanPatch = Object\.fromEntries\(\s*Object\.entries\(patch\)\.filter\(\(\[, value\]\) => value !== undefined\)/
    );
  });

  it("a cleared optional field is REMOVED (not left as `undefined`, not left stale)", () => {
    expect(settings).toMatch(
      /if \(patchKeys\.includes\("imageUrl"\) && cleanPatch\.imageUrl === undefined\) \{[\s\S]{0,400}?delete \(next as \{ imageUrl\?: string \}\)\.imageUrl;/
    );
  });

  it("every meal-row write routes through the shared patch helper", () => {
    expect(settings).toMatch(
      /const handleUpdateBreakfastMeal = \([\s\S]{0,300}?setBreakfastMeals\(\(prev\) => applyBreakfastMealPatch\(prev, id, patch\)\);/
    );
  });

  it("the settings write strips undefined-valued keys (the whole-surface safety net)", () => {
    expect(adminContext).toMatch(
      /await setDoc\(docRef, stripUndefinedValues\(data\), \{ merge: true \}\);/
    );
    expect(adminContextSrc).toMatch(/stripUndefinedValues/);
  });

  it("the shared strip helper is exported from `@spark-inn/shared`", () => {
    const sharedIndexSrc = readFileSync(
      resolve(__dirname, "../../../shared/index.ts"),
      "utf8"
    );
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/firestorePayload";/);
  });
});

describe("OCT-H10 — the photo upload is persisted immediately", () => {
  it("the upload persists the meals array", () => {
    expect(settings).toMatch(
      /const persistBreakfastMeals = async \(meals: BreakfastMeal\[\]\) => \{[\s\S]{0,900}?updateSettings\("breakfastConfig", \{/
    );
  });

  it("the persist path validates the meals against the shared schema", () => {
    expect(settings).toMatch(
      /const parsed = BreakfastMealSchema\.array\(\)\.safeParse\(meals\);/
    );
  });

  it("the upload calls the persist path and only toasts AFTER it succeeds", () => {
    expect(settings).toMatch(
      /const saved = await persistBreakfastMeals\(nextMeals\);[\s\S]{0,400}?if \(saved\) \{[\s\S]{0,400}?toast\.success\("Meal image uploaded"\);/
    );
  });

  it("the removal persists too, and deletes the Storage object only AFTER the row is safe", () => {
    expect(settings).toMatch(
      /const saved = await persistBreakfastMeals\(nextMeals\);\s*if \(!saved\) return;\s*await removeBreakfastMealImage\(mealId, previousUrl\);/
    );
  });

  it("the admin context no longer toasts the success BEFORE the write", () => {
    // The toast moved to the caller: the upload alone is not the
    // outcome the admin cares about — the catalog row must also be
    // persisted.
    expect(adminContext).not.toMatch(/notify\.success\("Meal image uploaded"\)/);
  });
});
