import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Guest app audit SEV-4 fixes — 2026-07-07", () => {
  it("derives guest API production hosts and allowed origins from hotel config", () => {
    const apiRouter = read("guest-app/server/apiRouter.ts");

    expect(apiRouter).toContain("configuredGuestHost");
    expect(apiRouter).toContain("configuredAdminHost");
    expect(apiRouter).toContain("config.domain");
    expect(apiRouter).toContain("config.adminDomain");
    expect(apiRouter).not.toContain('"https://sparkinnbohol.com"');
    expect(apiRouter).not.toContain('"https://admin.sparkinnbohol.com"');
  });

  it("maps and renders member profile photos", () => {
    const authContext = read("guest-app/src/context/GuestAuthContext.tsx");
    const navbar = read("guest-app/src/components/Navbar.tsx");
    const profilePage = read("guest-app/src/pages/ProfilePage.tsx");

    expect(authContext).toContain("photoUrl: string");
    expect(authContext).toContain("photoUrl: data.photoUrl || user.photoURL || \"\"");
    expect(navbar).toContain("avatarUrl");
    expect(navbar).toContain("<img src={avatarUrl}");
    expect(profilePage).toContain("Profile photo");
    expect(profilePage).toContain("memberProfile?.photoUrl || user?.photoURL");
  });

  it("uses rewardsName and brand config for audited guest UI strings", () => {
    const app = read("guest-app/src/App.tsx");
    const homePage = read("guest-app/src/pages/HomePage.tsx");
    const signUp = read("guest-app/src/pages/SignUpPage.tsx");
    const confirm = read("guest-app/src/pages/BookingConfirmPage.tsx");
    const profile = read("guest-app/src/pages/ProfilePage.tsx");
    const stays = read("guest-app/src/pages/StaysPage.tsx");

    expect(app).toContain("config.rewardsName");
    expect(app).toContain("config.address.city");
    expect(homePage).toContain("`Join ${config.rewardsName}`");
    expect(signUp).toContain("joining ${config.rewardsName} with Google");
    expect(confirm).toContain("Join {config.rewardsName}");
    expect(profile).toContain("Manage your ${config.rewardsName} account details.");
    expect(stays).toContain("Your booking history at ${config.brandName}.");
    expect(stays).not.toContain("booking history at spark inn");
  });

  it("handles disabled members and live points history in the portal", () => {
    const accountLayout = read("guest-app/src/components/AccountLayout.tsx");
    const contactPage = read("guest-app/src/pages/ContactPage.tsx");
    const rewardsPage = read("guest-app/src/pages/RewardsPage.tsx");

    expect(accountLayout).toContain("memberProfile?.isActive === false");
    expect(accountLayout).toContain('/contact?member=disabled');
    expect(contactPage).toContain("showDisabledMemberMessage");
    expect(contactPage).toContain("Your account has been disabled");
    expect(rewardsPage).toContain("onSnapshot(");
    expect(rewardsPage).toContain("unsubscribeHistory?.()");
    expect(rewardsPage).not.toContain("getDocs(query(");
  });

  it("syncs guest app agent context with current routes and auth model", () => {
    const guestClaude = read("plan/guest-app/CLAUDE.md");

    expect(guestClaude).toContain("CorporateStaysPage.tsx");
    expect(guestClaude).toContain("RewardsLandingPage.tsx");
    expect(guestClaude).toContain("RewardsPage.tsx");
    expect(guestClaude).toContain("Guest auth is limited to Spark Rewards/member account pages");
    expect(guestClaude).toContain("`bookings` | none from guest client");
    expect(guestClaude).not.toContain("CorporatePage.tsx");
    expect(guestClaude).not.toContain("RewardsPortalPage.tsx");
    expect(guestClaude).not.toContain("No auth in guest-app");
  });
});
