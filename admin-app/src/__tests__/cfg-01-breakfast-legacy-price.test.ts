// Per CFG-01 (QA pass 2026-10-21): the admin Dining settings editor
// silently made breakfast FREE.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `SettingsPage.tsx` hydrates the meal catalog with a three-step
// fallback (per BR-02):
//
//   1. `breakfastConfig.meals[]` when it is populated — the new shape.
//   2. Otherwise derive a `meals[]` from the legacy `silogItems[]`.
//   3. Otherwise `[]`.
//
// Step 2 wrote `price: 0` for every derived meal. But BR-08 (decision
// #238) deleted the legacy `ratePerPersonPerNight` READ from the guest
// and server paths, so the legacy flat rate was the only surviving
// record of what breakfast cost.
//
// The consequence: a hotel whose `settings/breakfastConfig` doc still
// had the legacy shape and then saved Dining settings had its
// breakfast price overwritten to ₱0. Every guest thereafter booked a
// free breakfast, the booking snapshotted a ₱0 meal, and the hotel
// collected nothing — with nothing in the revenue report to show for
// it. The admin UI did show "₱0" on each meal row, but a row of
// ₱0-priced meals reads like a deliberate "complimentary" promotion
// rather than the data-loss bug it was.
//
// The fix carries the legacy `ratePerPersonPerNight` into the derived
// price (it IS the per-person-per-night equivalent of the new
// per-meal price), and the save handler warns when an ACTIVE meal is
// priced at ₱0.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

/** The `breakfastMeals` useState initializer — the legacy→new derivation. */
const derivation = (() => {
  const start = settingsPageSrc.indexOf("const [breakfastMeals, setBreakfastMeals]");
  expect(start, "expected to find the breakfastMeals state initializer").toBeGreaterThan(-1);
  const end = settingsPageSrc.indexOf("const [addOnsCatalog, setAddOnsCatalog]", start);
  expect(end, "expected to find the end of the derivation block").toBeGreaterThan(start);
  return settingsPageSrc.slice(start, end);
})();

/** The `handleSaveBreakfast` function body. */
const saveHandler = (() => {
  const start = settingsPageSrc.indexOf("const handleSaveBreakfast");
  expect(start, "expected to find handleSaveBreakfast").toBeGreaterThan(-1);
  const end = settingsPageSrc.indexOf("const handleSave", start + 10);
  return settingsPageSrc.slice(start, end === -1 ? start + 8000 : end);
})();

describe("CFG-01 — the legacy → meals derivation must not zero the price", () => {
  it("derives the price from the legacy `ratePerPersonPerNight`", () => {
    expect(derivation).toMatch(/breakfastConfig\.ratePerPersonPerNight/);
    expect(derivation).toMatch(/derivedPrice/);
  });

  it("does NOT hardcode `price: 0` for the derived meals", () => {
    // This is the exact line that made breakfast free.
    expect(derivation).not.toMatch(/price:\s*0\s*,/);
  });

  it("writes the derived price onto the meal row", () => {
    expect(derivation).toMatch(/price:\s*derivedPrice/);
  });

  it("still floors an absent / invalid legacy rate at 0 rather than NaN", () => {
    expect(derivation).toMatch(/Number\.isFinite\(legacyRate\)/);
    expect(derivation).toMatch(/legacyRate\s*>\s*0\s*\?\s*legacyRate\s*:\s*0/);
  });

  it("keeps the new-shape branch first — a populated `meals[]` is never overwritten", () => {
    const mealsBranch = derivation.indexOf("breakfastConfig.meals");
    const legacyBranch = derivation.indexOf("breakfastConfig.silogItems");
    expect(mealsBranch).toBeGreaterThan(-1);
    expect(legacyBranch).toBeGreaterThan(-1);
    expect(mealsBranch, "the meals[] branch must come first").toBeLessThan(legacyBranch);
  });
});

describe("CFG-01 — the save handler warns on an active ₱0 meal", () => {
  it("warns when an active meal carries a ₱0 price", () => {
    expect(saveHandler).toMatch(/freeActiveMeal/);
    expect(saveHandler).toMatch(/toast\.warning\(/);
  });

  it("only warns for an ACTIVE meal — an inactive ₱0 row is not sold", () => {
    expect(saveHandler).toMatch(/meal\.isActive\s*!==\s*false/);
  });

  it("the warning names the meal so the operator knows which row to fix", () => {
    expect(saveHandler).toMatch(/freeActiveMeal\.name/);
  });

  it("does NOT block the save — a complimentary promotion stays legal", () => {
    // The warning is advisory. If a future edit turns it into a hard
    // block, a hotel could never run a free-breakfast promotion.
    const warnIdx = saveHandler.indexOf("toast.warning(");
    const returnIdx = saveHandler.indexOf("return;", warnIdx);
    expect(warnIdx).toBeGreaterThan(-1);
    expect(returnIdx, "the warning must not early-return").toBeGreaterThan(warnIdx);
  });
});
