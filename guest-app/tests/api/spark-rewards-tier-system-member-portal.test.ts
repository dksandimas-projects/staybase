import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 7 of the Spark Rewards tier system (2026-10-13,
// decision pending): source-text pins for the member portal
// tier badge + progress-to-next + free-night voucher card. The
// runtime behavior (Firestore subscriptions, tier derivation)
// is covered by the existing member portal e2e tests; this
// suite pins the new surface so a refactor can't silently
// drop the tier display or the free-night voucher list.

const rewardsSrc = readFileSync(
  join(import.meta.dirname, "../../src/pages/RewardsPage.tsx"),
  "utf8"
);

const profileSrc = readFileSync(
  join(import.meta.dirname, "../../src/pages/ProfilePage.tsx"),
  "utf8"
);

describe("RewardsPage — Phase 7 member portal tier display", () => {
  it("imports LevelDef from @spark-inn/shared", () => {
    expect(rewardsSrc).toMatch(/import type\s*\{\s*LevelDef\s*\}\s*from\s*["']@spark-inn\/shared["']/);
  });

  it("extends the local RewardsConfig interface with Phase 2 fields", () => {
    // The portal reads `welcomePoints`, `minPointsToRedeem`,
    // `pointsCanPayUpToBillPct`, `freeNightEvery`, and `levels`
    // from the settings/rewardsConfig snapshot — all optional
    // for backward compat with pre-Phase-2 deployments.
    expect(rewardsSrc).toMatch(/welcomePoints\?:\s*number/);
    expect(rewardsSrc).toMatch(/levels\?:\s*LevelDef\[\]/);
  });

  it("loads the new fields from the rewardsConfig snapshot", () => {
    expect(rewardsSrc).toMatch(/welcomePoints:\s*Number\(data\.welcomePoints\s*\?\?\s*0\)/);
    expect(rewardsSrc).toMatch(/levels:\s*Array\.isArray\(data\.levels\)\s*\?\s*data\.levels\s*:\s*\[\]/);
  });

  it("subscribes to the member's reward vouchers (kind=reward, memberId=current uid)", () => {
    // Per Phase 5 + Phase 7: the live subscription listens to
    // vouchers/{code} where kind=reward + memberId=current
    // uid. The filter is indexed by Firestore so the read is
    // O(owned vouchers), not O(all vouchers).
    expect(rewardsSrc).toMatch(/where\(\s*["']kind["']\s*,\s*["']==["']\s*,\s*["']reward["']\s*\)/);
    expect(rewardsSrc).toMatch(/where\(\s*["']memberId["']\s*,\s*["']==["']\s*,\s*user\.uid\s*\)/);
  });

  it("renders the tier badge from currentLevel.name (not the legacy `tier` field)", () => {
    // Phase 7 reads the tier name from the Phase 3 cache
    // (`currentLevel.name`), not the legacy `tier` field on
    // `MemberProfile`. The fallback "Member" handles pre-Phase-2
    // docs that haven't been touched by a checkout yet.
    expect(rewardsSrc).toMatch(/currentLevel\?\.name\s*\?\?\s*sortedLevels\.find/);
    expect(rewardsSrc).toMatch(/data-testid=["']member-tier-name["']/);
  });

  it("renders the progress-to-next bar between current and next tier", () => {
    // Progress % = (completedStays - current.fromStays) /
    // (next.fromStays - current.fromStays) × 100, capped at
    // 100 for the top tier. The bar uses an ARIA progressbar
    // role for a11y + the aria-valuenow/aria-valuemin/max
    // pattern.
    expect(rewardsSrc).toMatch(/role=["']progressbar["']/);
    expect(rewardsSrc).toMatch(/aria-valuenow=\{progressPct\}/);
    expect(rewardsSrc).toMatch(/aria-valuemin=\{0\}/);
    expect(rewardsSrc).toMatch(/aria-valuemax=\{100\}/);
    expect(rewardsSrc).toMatch(/Math\.min\(100,\s*Math\.round\(\(completed\s*\/\s*span\)\s*\*\s*100\)\)/);
  });

  it("shows a 'Top tier' message when no nextLevel exists", () => {
    expect(rewardsSrc).toMatch(/Top tier\s*—\s*enjoy your perks/);
  });

  it("shows a friendly 'stay with us to unlock perks' prompt when no currentLevel + levels exist", () => {
    expect(rewardsSrc).toMatch(/Stay with us to unlock tier perks/);
  });

  it("renders the free-night voucher card with the deterministic code + 100% off label", () => {
    // The card lists active reward vouchers with the code (e.g.
    // FREENIGHT-SR-10023-5), a 100% off label for valueType:
    // "free-night", and a "Free Night" pill badge.
    expect(rewardsSrc).toMatch(/data-testid=["']reward-voucher-row["']/);
    expect(rewardsSrc).toMatch(/font-mono font-bold text-amber-900 tracking-wider/);
    expect(rewardsSrc).toMatch(/v\.valueType === ["']free-night["']\s*\?\s*["']100% off["']/);
    expect(rewardsSrc).toMatch(/Free Night/);
  });

  it("filters out used / deactivated / expired reward vouchers before rendering", () => {
    // The portal only shows vouchers the member can ACTUALLY
    // apply — no "you have no usable vouchers" empty state. The
    // filter checks `isActive`, `usageCap`, and `expiresAt`
    // BEFORE the render map.
    expect(rewardsSrc).toMatch(/if\s*\(\s*!v\.isActive\s*\)\s*return\s*false/);
    expect(rewardsSrc).toMatch(/if\s*\(v\.usageCap\s*!==\s*null\s*&&\s*v\.usageCount\s*>=\s*v\.usageCap\)\s*return\s*false/);
    expect(rewardsSrc).toMatch(/if\s*\(v\.expiresAt\s*&&\s*new\s*Date\(v\.expiresAt\)\.getTime\(\)\s*<\s*now\)\s*return\s*false/);
  });
});

describe("ProfilePage — Phase 7 tier name in header card", () => {
  it("reads tier name from currentLevel.name (Phase 3 cache field)", () => {
    // The ProfilePage header card shows the tier name under the
    // points balance. Phase 7 reads from `currentLevel?.name`
    // (Phase 3 cache) with a "Member" fallback for pre-Phase-2
    // docs. This replaces the legacy "Standard Member" text
    // that was hardcoded.
    expect(profileSrc).toMatch(/memberProfile\.currentLevel\?\.name\s*\?\?\s*["']Member["']/);
    expect(profileSrc).toMatch(/data-testid=["']profile-tier-name["']/);
  });

  it("no longer shows the legacy 'Standard Member' hardcoded text", () => {
    // Phase 7 replaces the hardcoded text. The literal
    // "Standard Member" string should NOT appear in the header
    // card area.
    expect(profileSrc).not.toMatch(/opacity-60 mt-1["']\s*>\s*Standard Member/);
  });
});