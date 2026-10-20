import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 3 of the Spark Rewards tier system (2026-10-12,
// decision pending): source-text pins for the member-side
// counter wiring. The checkout handler increments
// `members.{uid}.completedStays` + refreshes `currentLevel`
// inside the same transaction as the points credit (both
// immediate + deferred-credit paths). The registration handler
// initializes `completedStays: 0` + `currentLevel` from the base
// tier. This suite pins the surface so a refactor can't silently
// drop either write. Runtime behavior is covered by the booking
// flow integration tests; the schema surface by
// `shared/__tests__/rewards-config-schema.test.ts`.

const bookingsSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const membersSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/members.ts"),
  "utf8"
);

describe("bookings.ts — Spark Rewards Phase 3 checkout wiring", () => {
  it("imports resolveCurrentLevel + calculatePointsWithMultiplier from @spark-inn/shared", () => {
    expect(bookingsSrc).toMatch(/import\s*\{[^}]*\bresolveCurrentLevel\s*,\s*calculatePointsWithMultiplier\s*[^}]*\}\s*from\s*"@spark-inn\/shared"/);
  });

  it("derives the member's current tier BEFORE entering the checkout transaction", () => {
    // Defense-in-depth: read `completedStays` + `rewardsConfig.levels`
    // pre-transaction so the multiplier is known BEFORE the points
    // math runs. The post-transaction path can't safely call
    // `resolveCurrentLevel` because the `get()` calls are
    // required to complete before any `update()` (FOL-03).
    expect(bookingsSrc).toMatch(/resolveCurrentLevel\(\s*rewardsConfig\?\.levels/);
    expect(bookingsSrc).toMatch(/memberTierMultiplier\s*=/);
  });

  it("applies the tier multiplier to baseEligiblePoints to get the credited value", () => {
    // `eligiblePoints` becomes `calculatePointsWithMultiplier(baseEligiblePoints, memberTierMultiplier)`
    // so the credit (and the `pendingLoyaltyPoints` snapshot) carries
    // the tier's bonus.
    expect(bookingsSrc).toMatch(/calculatePointsWithMultiplier\(\s*baseEligiblePoints\s*,\s*memberTierMultiplier\s*\)/);
  });

  it("increments members.{uid}.completedStays inside the checkout transaction", () => {
    // The increment is atomic with the points credit — both share
    // the same `transaction.update` call so a retry can't
    // double-count.
    expect(bookingsSrc).toMatch(/priorCompletedStays\s*\+\s*1/);
    expect(bookingsSrc).toMatch(/completedStays:\s*nextCompletedStays/);
  });

  it("refreshes members.{uid}.currentLevel cache to the post-increment tier", () => {
    // `currentLevel` is re-derived using the post-increment
    // `completedStays` so the cached snapshot reflects what the
    // next booking will see — not the pre-increment tier.
    expect(bookingsSrc).toMatch(/resolveCurrentLevel\(\s*rewardsConfig\?\.levels\s*,\s*nextCompletedStays\s*\)/);
    expect(bookingsSrc).toMatch(/currentLevel:\s*nextCurrentLevel/);
  });

  it("runs the completedStays++ on BOTH the immediate-credit AND the pending-payment paths", () => {
    // The stay IS completed regardless of payment status; the
    // points credit just lags when the guest has an outstanding
    // balance. The increment lives outside the
    // `if (awardNow)` branch so both paths increment.
    expect(bookingsSrc).toMatch(/canAwardPoints\s*&&\s*memberId\s*&&\s*memberRef\s*&&\s*memberDocInTransaction\?\.exists/);
    // Inside the `else` branch (deferred credit), the tier bump
    // also runs (no rewardsPoints mutation).
    expect(bookingsSrc).toMatch(/Deferred-credit path/);
  });
});

describe("members.ts — Spark Rewards Phase 3 register wiring", () => {
  it("imports resolveCurrentLevel from @spark-inn/shared", () => {
    expect(membersSrc).toMatch(/import\s*\{[^}]*\bresolveCurrentLevel\s*[^}]*\}\s*from\s*"@spark-inn\/shared"/);
  });

  it("reads settings/rewardsConfig pre-transaction to find the base tier", () => {
    // Same pre-transaction read pattern as the checkout handler.
    // The `resolveCurrentLevel(rewardsCfg?.levels, 0)` call returns
    // the base tier (the level with `fromStays === 0`).
    expect(membersSrc).toMatch(/adminDb\.collection\("settings"\)\.doc\("rewardsConfig"\)/);
    expect(membersSrc).toMatch(/resolveCurrentLevel\(\s*rewardsCfg\?\.levels\s*,\s*0\s*\)/);
  });

  it("initializes the new member doc with completedStays + currentLevel", () => {
    // `completedStays` defaults to 0 on first registration;
    // `currentLevel` is the base tier (or null for pre-Phase-2
    // deployments that haven't configured levels yet).
    expect(membersSrc).toMatch(/completedStays:\s*Number\(existingMember\?\.completedStays\s*\|\|\s*0\)/);
    expect(membersSrc).toMatch(/currentLevel:\s*existingMember\?\.currentLevel\s*\?\?\s*baseCurrentLevel/);
  });
});