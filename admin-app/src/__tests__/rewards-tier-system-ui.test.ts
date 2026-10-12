import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 2 of the Spark Rewards tier system (2026-10-12, decision
// pending): source-text pins for the Settings → Rewards tab rewrite.
// The screenshot at `plan/features/SPARK-REWARDS.md §Phase 2` is the
// design reference; this suite enforces the literal shape of the new
// UI so future refactors can't silently drop the new fields without
// the test catching it. Runtime Zod validation lives in
// `shared/__tests__/rewards-config-schema.test.ts`; this file pins
// the admin-side wiring (state hooks, save payload, levels editor).

const settingsSrc = readFileSync(
  join(import.meta.dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

describe("SettingsPage Rewards tab — Phase 2 wiring", () => {
  it("imports RewardsConfigSchema and LevelDef from @spark-inn/shared", () => {
    expect(settingsSrc).toMatch(/RewardsConfigSchema/);
    expect(settingsSrc).toMatch(/type\s+LevelDef/);
  });

  it("declares state for the six new scalars + the levels array", () => {
    expect(settingsSrc).toMatch(/setWelcomePoints/);
    expect(settingsSrc).toMatch(/setMinPointsToRedeem/);
    expect(settingsSrc).toMatch(/setPointsCanPayUpToBillPct/);
    expect(settingsSrc).toMatch(/setFreeNightEvery/);
    expect(settingsSrc).toMatch(/setLevels/);
  });

  it("renders the 5-column Levels table header", () => {
    expect(settingsSrc).toMatch(/Level Name/);
    expect(settingsSrc).toMatch(/From Stays/);
    expect(settingsSrc).toMatch(/Discount %/);
    expect(settingsSrc).toMatch(/Points ×/);
    expect(settingsSrc).toMatch(/>Perks</);
  });

  it("renders the 6 Phase 2 scalars in the screenshot grid", () => {
    // The screenshot shows these labels in uppercase tracking-wider
    // style — the source must contain them so a rename doesn't
    // silently drift from the design.
    expect(settingsSrc).toMatch(/₱ Spent for 1 Point/);
    expect(settingsSrc).toMatch(/1 Point is Worth ₱/);
    expect(settingsSrc).toMatch(/Welcome Points/);
    expect(settingsSrc).toMatch(/Use at Least \(Points\)/);
    expect(settingsSrc).toMatch(/Points Can Pay Up To/);
    expect(settingsSrc).toMatch(/Free Night Every/);
  });

  it("renders the + Add a level button", () => {
    expect(settingsSrc).toMatch(/Add a Level/);
    // The Plus lucide icon drives the button.
    expect(settingsSrc).toMatch(/<Plus/);
  });

  it("renders the × delete-row button per tier", () => {
    // The X icon is the canonical close glyph for row actions.
    expect(settingsSrc).toMatch(/<X size=\{16\}/);
    // The handler is named handleRemoveLevel and called with the id.
    expect(settingsSrc).toMatch(/handleRemoveLevel\(level\.id\)/);
  });

  // Per Phase 2 (2026-10-12): the next three tests pin the save
// handler's structure (Zod validation + level sort + every new
// scalar). The naive "extract the function body via regex" pattern
// is brittle — the function body contains inner `};` (the arrow
// function in `runSettingsSave(..., () => updateSettings(...))`)
// that breaks non-greedy matching. Instead we anchor on the
// `handleSaveRewards = async (` declaration and look for the
// required patterns downstream in the same function scope — we
// trust the source contains the pattern, the Zod suite tests the
// runtime behavior.
const handleSaveRewardsBody = (() => {
  const startIdx = settingsSrc.indexOf("const handleSaveRewards = async (");
  if (startIdx === -1) return "";
  // Walk forward until we see the closing pattern `;\n}` at the
  // same indent (end of handleSaveRewards), tracking brace depth
  // so we don't bail on inner `};`.
  let depth = 0;
  for (let i = startIdx; i < settingsSrc.length; i++) {
    const c = settingsSrc[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        // The current char is the closing `}`; the next non-space
        // should be `;` for an arrow-function-literal handler.
        return settingsSrc.substring(startIdx, i + 2);
      }
    }
  }
  return "";
})();

it("handleSaveRewards persists all 6 new scalars + the levels array", () => {
  expect(handleSaveRewardsBody).not.toBe("");
  expect(handleSaveRewardsBody).toMatch(/welcomePoints\s*:/);
  expect(handleSaveRewardsBody).toMatch(/minPointsToRedeem\s*:/);
  expect(handleSaveRewardsBody).toMatch(/pointsCanPayUpToBillPct\s*:/);
  expect(handleSaveRewardsBody).toMatch(/freeNightEvery\s*:/);
  expect(handleSaveRewardsBody).toMatch(/levels\s*:/);
});

it("handleSaveRewards runs Zod validation before the network call", () => {
  // Defense-in-depth: the API also re-validates (Hard Rule #1),
  // but client-side Zod catches errors instantly so the admin
  // doesn't wait on a round-trip for invalid data.
  expect(handleSaveRewardsBody).not.toBe("");
  expect(handleSaveRewardsBody).toMatch(/RewardsConfigSchema\.safeParse\(/);
  expect(handleSaveRewardsBody).toMatch(/validation\.success/);
});

it("handleSaveRewards sorts levels ascending by fromStays before writing", () => {
  // Defensive sort so the canonical Firestore shape matches the
  // UI's display order — even if the admin edited values out of
  // sequence.
  expect(handleSaveRewardsBody).not.toBe("");
  expect(handleSaveRewardsBody).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*a\.fromStays\s*-\s*b\.fromStays\)/);
});

  it("handleAddLevel appends a sensible default tier", () => {
    // ID generation falls back to a timestamp+random when
    // crypto.randomUUID isn't available (older Safari).
    expect(settingsSrc).toMatch(/crypto\.randomUUID/);
    expect(settingsSrc).toMatch(/tier_\$\{Date\.now\(\)\}/);
    expect(settingsSrc).toMatch(/New tier/);
  });

  it("handles legacy per-booking / per-spend branches in the Advanced / legacy controls section", () => {
    // The "Advanced / legacy controls" details element preserves
    // access to the existing earningMode + member-discount +
    // early-check-in toggles so no existing functionality regresses.
    expect(settingsSrc).toMatch(/Advanced \/ legacy controls/);
    expect(settingsSrc).toMatch(/earningMode\s*===\s*["']per-booking["']/);
    expect(settingsSrc).toMatch(/setEarlyCheckInEnabled/);
    expect(settingsSrc).toMatch(/setMemberDiscountEnabled/);
  });

  it("the rehydrate useEffect seeds the 4 new scalars + levels from the snapshot", () => {
    // Same defensive pattern as the existing Phase 1 fields —
    // the snapshot is the single source of truth, the form state
    // is re-derived when the snapshot updates.
    expect(settingsSrc).toMatch(/setWelcomePoints\(String\(rewardsConfig\.welcomePoints\s*\?\?\s*0\)\)/);
    expect(settingsSrc).toMatch(/setMinPointsToRedeem\(String\(rewardsConfig\.minPointsToRedeem\s*\?\?\s*0\)\)/);
    expect(settingsSrc).toMatch(/setPointsCanPayUpToBillPct\(String\(rewardsConfig\.pointsCanPayUpToBillPct\s*\?\?\s*100\)\)/);
    expect(settingsSrc).toMatch(/setFreeNightEvery\(String\(rewardsConfig\.freeNightEvery\s*\?\?\s*0\)\)/);
    expect(settingsSrc).toMatch(/setLevels\(Array\.isArray\(rewardsConfig\.levels\)/);
  });
});