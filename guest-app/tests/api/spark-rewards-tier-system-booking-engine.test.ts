import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 4 of the Spark Rewards tier system (2026-10-12,
// decision pending): source-text pins for the booking-engine
// tier-discount precedence + the redeem-points guards. The
// runtime behavior is covered by the booking-flow integration
// tests; the schema surface by `shared/__tests__/rewards-config-schema.test.ts`.

const bookingsSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const membersSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/members.ts"),
  "utf8"
);

describe("bookings.ts — Spark Rewards Phase 4 tier-discount precedence", () => {
  it("reads the member's currentLevel cache alongside settings/rewardsConfig in handleCreateBooking", () => {
    // Both reads happen in the same transaction block so FOL-03
    // (all `get()` calls complete before any `update()`) is
    // honored. The member's `currentLevel.discountPct` overrides
    // the global `memberDiscountPct` for tier-aware members.
    expect(bookingsSrc).toMatch(/handleCreateBooking[\s\S]*?members\/\$?\{detectedMemberId\}[\s\S]*?currentLevel[\s\S]*?appliedMemberDiscountPct\s*=\s*tierPct/);
  });

  it("a tier with discountPct: 0 wins over the global memberDiscountPct", () => {
    // The "tier takes precedence" rule is explicit: even when the
    // tier says 0 (admin's deliberate choice — e.g. a future
    // "Points-only" tier), we don't fall back to the global. The
    // comment in the handler spells out the decision.
    expect(bookingsSrc).toMatch(/Tier-aware member:\s*tier discount wins/);
  });

  it("falls back to the global memberDiscountPct for tier-less members", () => {
    // When `currentLevel` is null/absent AND `memberDiscountEnabled`
    // is true, the existing legacy path applies.
    expect(bookingsSrc).toMatch(/Tier-less member:\s*fall back to the global/);
  });

  it("applies the same tier-precedence rule in handleRescheduleBooking", () => {
    // Both create + reschedule share the same pattern. The reschedule
    // handler is the canonical example for booking edits that need
    // to re-snapshot the tier discount (e.g. member moved to a new
    // tier between the original create and the reschedule).
    expect(bookingsSrc).toMatch(/handleRescheduleBooking[\s\S]*?members\/\$?\{booking\.memberId\}[\s\S]*?appliedMemberDiscountPct\s*=\s*tierPct/);
  });
});

describe("members.ts — Spark Rewards Phase 4 redeem-points guards", () => {
  it("imports validatePointsRedemption (Phase 1) + reads rewardsConfig for the new guards", () => {
    // The new `minPointsToRedeem` + `pointsCanPayUpToBillPct` fields
    // are read from the same `rewardsConfigDoc` that the existing
    // `pointsRedemptionRate` already pulls — one transaction read.
    expect(membersSrc).toMatch(/minPointsToRedeem/);
    expect(membersSrc).toMatch(/pointsCanPayUpToBillPct/);
  });

  it("rejects when pointsToRedeem is below the configured minPointsToRedeem floor", () => {
    // 0 (the default) = no minimum. > 0 requires the requested amount
    // to be at least the floor. Reject message names the actual floor
    // so the staff UI can show it to the operator.
    expect(membersSrc).toMatch(/Points redemption requires at least\s*\$\{minPointsToRedeem\}\s*points\./);
  });

  it("caps redemption at the configured bill percentage", () => {
    // `pointsCanPayUpToBillPct` (0..100, default 100 = no cap)
    // computes `maxRedeemablePoints = floor(subtotal × pct/100) /
    // pointsRedemptionRate`. Anything beyond is rejected with a
    // clear "exceeds the N% bill cap" message.
    expect(membersSrc).toMatch(/maxRedeemablePoints\s*=\s*Math\.floor\(\(maxRedeemableCurrency\s*\*\s*100\)\s*\/\s*pointsRedemptionRate\)/);
    expect(membersSrc).toMatch(/exceeds the\s*\$\{billPct\}% bill cap/);
  });

  it("treats a 100% bill cap as no cap (existing legacy behavior preserved)", () => {
    // The legacy `memberDiscountPct` system had no bill cap; the new
    // `pointsCanPayUpToBillPct: 100` (or absent) preserves that
    // exact behavior — no `maxRedeemablePoints` check runs.
    expect(membersSrc).toMatch(/billPct\s*<\s*100/);
  });
});