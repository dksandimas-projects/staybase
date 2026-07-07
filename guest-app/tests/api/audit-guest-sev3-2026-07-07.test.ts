import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Guest app audit SEV-3 fixes — 2026-07-07", () => {
  it("namespaces public booking and validation rate-limit buckets", () => {
    const apiRouter = read("guest-app/server/apiRouter.ts");

    expect(apiRouter).toContain("isRateLimited(`bookings-create:${ip}`, 5, 60000)");
    expect(apiRouter).toContain("isRateLimited(`validate-voucher:${ip}`, 20, 60000)");
    expect(apiRouter).toContain("isRateLimited(`validate-corporate-code:${ip}`, 10, 60000)");
    expect(apiRouter).not.toMatch(/domain === "validate"[\s\S]*?isRateLimited\(ip,/);
  });

  it("wires My Rewards to settings/rewardsConfig", () => {
    const rewardsPage = read("guest-app/src/pages/RewardsPage.tsx");

    expect(rewardsPage).toContain('doc(db, "settings", "rewardsConfig")');
    expect(rewardsPage).toContain("pointsEnabled");
    expect(rewardsPage).toContain("memberDiscountEnabled");
    expect(rewardsPage).toContain("pointsPerBooking");
    expect(rewardsPage).toContain("pointsPerHundred");
    expect(rewardsPage).toContain("You get {rewardsConfig.memberDiscountPct}% off every booking as a member.");
  });

  it("branches rewards marketing surfaces by member state", () => {
    const homePage = read("guest-app/src/pages/HomePage.tsx");
    const confirmPage = read("guest-app/src/pages/BookingConfirmPage.tsx");
    const landingPage = read("guest-app/src/pages/RewardsLandingPage.tsx");

    expect(homePage).toContain("useGuestAuth");
    expect(homePage).toContain("Welcome back, ${memberName}");
    expect(homePage).toContain("showStatusBadge={false}");
    expect(confirmPage).toContain("showRewardsJoinPrompt");
    expect(confirmPage).toContain("!isRewardsMember");
    expect(landingPage).toContain('navigate("/account/rewards", { replace: true })');
  });

  it("handles provider conflict errors without generic retry-only copy", () => {
    const signInPage = read("guest-app/src/pages/SignInPage.tsx");
    const signUpPage = read("guest-app/src/pages/SignUpPage.tsx");

    expect(signInPage).toContain("auth/account-exists-with-different-credential");
    expect(signInPage).toContain("Sign in with that method first");
    expect(signInPage).toContain("getAuthConflictMessage(err) ||");
    expect(signUpPage).toContain("auth/account-exists-with-different-credential");
    expect(signUpPage).toContain("Sign in with your existing method first");
  });

  it("renders a carousel and empty-photo fallback in the rooms detail modal", () => {
    const roomsPage = read("guest-app/src/pages/RoomsPage.tsx");

    expect(roomsPage).toContain("selectedPhotoIndex");
    expect(roomsPage).toContain("selectedPhotos.length > 1");
    expect(roomsPage).toContain("Previous room photo");
    expect(roomsPage).toContain("Next room photo");
    expect(roomsPage).toContain("Photo coming soon");
  });

  it("records SEV-3 product decisions in specs", () => {
    const homepageSpec = read("plan/features/HOMEPAGE.md");
    const rewardsSpec = read("plan/features/SPARK-REWARDS.md");
    const decisions = read("plan/docs/DECISIONS-FEATURES.md");

    expect(homepageSpec).toContain("do not show per-room operational status badges");
    expect(rewardsSpec).toContain("self-service linking is deferred to Phase 2");
    expect(decisions).toContain("Homepage featured room cards do not expose live per-room operational status");
    expect(decisions).toContain("Self-service cross-provider auth linking is deferred to Phase 2");
  });
});
