import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 6 of the Spark Rewards tier system (2026-10-13,
// decision pending): source-text pins for the welcome bonus
// on registration. `handleRegisterMember` reads
// `rewardsConfig.welcomePoints` pre-transaction, checks the
// idempotent `pointsHistory/welcome` row (deterministic doc
// ID), and credits the member when both `welcomePoints > 0`
// and the welcome row doesn't already exist. The credit + the
// history row write share the same `runTransaction` so a retry
// can't double-credit. Runtime behavior is covered by
// `members-register.test.ts` (the existing test mock was
// extended in this PR to include the `settings/rewardsConfig`
// collection so the pre-transaction read resolves).

const membersSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/members.ts"),
  "utf8"
);

describe("members.ts — Spark Rewards Phase 6 welcome bonus", () => {
  it("reads rewardsConfig.welcomePoints pre-transaction", () => {
    // Same pattern as Phase 3's `baseCurrentLevel` derivation —
    // the read happens before the `runTransaction` block so the
    // `welcomePoints` value is known before any writes (FOL-03).
    expect(membersSrc).toMatch(/rewardsDoc\s*=\s*await\s+adminDb\.collection\(\s*["']settings["']\s*\)\.doc\(\s*["']rewardsConfig["']\s*\)\.get\(\)/);
    expect(membersSrc).toMatch(/welcomePoints\s*=\s*Math\.max\(0,\s*Math\.floor\(Number\(rewardsCfg\?\.welcomePoints\s*\|\|\s*0\)\)\)/);
  });

  it("uses a deterministic welcome history doc ID for idempotency", () => {
    // Single `.get()` for `pointsHistory/welcome` inside the
    // transaction (no query needed). The doc ID `welcome` is
    // reserved for the first-credit event — if it exists, the
    // bonus was already credited (re-registration path).
    expect(membersSrc).toMatch(/adminDb\.collection\(\s*`members\/\$\{uid\}\/pointsHistory`\s*\)\.doc\(\s*["']welcome["']\s*\)/);
  });

  it("credits welcomePoints only when the row doesn't already exist", () => {
    // The boolean `welcomeAlreadyCredited` gates the credit — a
    // second registration (e.g. email-verification retry per
    // HIGH-1 audit) skips the credit.
    expect(membersSrc).toMatch(/welcomeAlreadyCredited\s*=\s*welcomeDocSnap\.exists/);
    expect(membersSrc).toMatch(/if\s*\(\s*!welcomeAlreadyCredited\s*\)\s*\{[\s\S]*?welcomeAmount\s*=\s*welcomePoints/);
  });

  it("increments rewardsPoints atomically with the history row write", () => {
    // Both writes share the same `runTransaction` block so a
    // retry can't end up with rewardsPoints incremented but no
    // history row (or vice versa). The reward invariant is
    // `rewardsPoints === sum(pointsHistory.points)`.
    expect(membersSrc).toMatch(/initialRewardsPoints\s*=\s*\(Number\(existingMember\?\.rewardsPoints\)\s*\|\|\s*0\)\s*\+\s*welcomeAmount/);
    expect(membersSrc).toMatch(/rewardsPoints:\s*initialRewardsPoints/);
    expect(membersSrc).toMatch(/transaction\.set\(welcomeHistoryRef,\s*\{[\s\S]*?type:\s*["']welcome["']/);
  });

  it("writes the welcome history row with the canonical Phase 6 shape", () => {
    // The row matches the `PointsHistoryEntry` interface from
    // Phase 1: `type: "welcome"`, `points: welcomeAmount`,
    // `memberId: uid`, `note: "Welcome bonus (N points)"`,
    // `createdBy: "system"`. Member-side portal reads the note
    // for the "You earned a welcome bonus!" message.
    expect(membersSrc).toMatch(/type:\s*["']welcome["']/);
    expect(membersSrc).toMatch(/points:\s*welcomeAmount/);
    expect(membersSrc).toMatch(/memberId:\s*uid/);
    expect(membersSrc).toMatch(/note:\s*`Welcome bonus\s*\(\$\{welcomeAmount\}\s*points\)`/);
    expect(membersSrc).toMatch(/createdBy:\s*["']system["']/);
  });

  it("only credits on first registration — the existingMember short-circuit branch is unchanged", () => {
    // Decision (2026-10-13): the welcome bonus is one-shot.
    // The existingMember.memberNumber short-circuit (line 261-268)
    // does NOT touch the welcome path — re-registration just
    // refreshes isMember + memberSince. The welcome credit lives
    // only in the new-member branch (after `if (existingMember?.memberNumber) { return; }`).
    expect(membersSrc).toMatch(/if\s*\(existingMember\?\.memberNumber\)\s*\{[\s\S]*?return;\s*\}/);
  });
});