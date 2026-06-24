import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 12 — Settings page Rewards tab
// (audit launch gate SEV-2: "SettingsPage does not read settings/rewardsConfig
// for the rewards form — admins cannot edit earning mode, points-per-booking,
// points-per-₱100, redemption rate, program name, tagline").
//
// The server already honors every field on `settings/rewardsConfig` (see
// `guest-app/api/handlers/bookings.ts` for `earningMode` / `pointsPerHundred`
// / `pointsPerBooking` and `guest-app/api/handlers/members.ts` for
// `pointsRedemptionRate`). This batch closes the admin-side write path so
// the existing server reads actually have something to read.
//
// This is a source-pattern test. The form is React + admin-app only; the
// behavioral contract is the snapshot subscribe in `AdminContext.tsx` and
// the form-state sync useEffect in `SettingsPage.tsx`.

const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);
const adminCtxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const membersSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/members.ts"),
  "utf8"
);

describe("Phase 11.6 Batch 12 — Rewards tab is wired to settings/rewardsConfig", () => {
  describe("AdminContext exposes the full rewardsConfig shape", () => {
    it("includes earningMode in the default state", () => {
      // The switch on settings doc IDs reads `rewardsConfig` as a whole;
      // the default state has to include the same shape so the form never
      // crashes before the first snapshot lands.
      const blockMatch = adminCtxSrc.match(
        /const\s+\[rewardsConfig,\s*setRewardsConfig\]\s*=\s*useState\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(blockMatch, "expected to find the rewardsConfig useState default").toBeTruthy();
      expect(blockMatch![0]).toMatch(/earningMode\s*:\s*["']per-spend["']/);
    });

    it("includes pointsPerBooking in the default state", () => {
      const blockMatch = adminCtxSrc.match(
        /const\s+\[rewardsConfig,\s*setRewardsConfig\]\s*=\s*useState\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(blockMatch).toBeTruthy();
      expect(blockMatch![0]).toMatch(/pointsPerBooking\s*:/);
    });

    it("includes pointsRedemptionRate in the default state", () => {
      const blockMatch = adminCtxSrc.match(
        /const\s+\[rewardsConfig,\s*setRewardsConfig\]\s*=\s*useState\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(blockMatch).toBeTruthy();
      expect(blockMatch![0]).toMatch(/pointsRedemptionRate\s*:/);
    });

    it("subscribes to settings/rewardsConfig and writes it into the hook state", () => {
      expect(adminCtxSrc).toMatch(/case\s+["']rewardsConfig["']\s*:\s*setRewardsConfig\(data\s+as\s+typeof\s+rewardsConfig\)/);
    });
  });

  describe("SettingsPage Rewards tab renders all the missing fields", () => {
    it("renders an earningMode radio group (per-booking vs per-spend)", () => {
      // Two radio inputs with values "per-spend" and "per-booking".
      expect(settingsSrc).toMatch(/name="earningMode"\s+value="per-spend"/);
      expect(settingsSrc).toMatch(/name="earningMode"\s+value="per-booking"/);
    });

    it("renders a pointsPerBooking input (shown when earningMode = per-booking)", () => {
      expect(settingsSrc).toMatch(
        /earningMode\s*===\s*["']per-booking["']\s*\?\s*pointsPerBooking\s*:\s*pointsPerHundred/
      );
    });

    it("renders a pointsRedemptionRate input", () => {
      expect(settingsSrc).toMatch(/setPointsRedemptionRate\(/);
    });

    it("renders the program name + tagline inputs", () => {
      expect(settingsSrc).toMatch(/setRewardsName\(/);
      expect(settingsSrc).toMatch(/setRewardsTagline\(/);
    });

    it("uses the dynamic program name in the tab heading instead of a hard-coded 'Spark Rewards Modifiers'", () => {
      expect(settingsSrc).toMatch(/\{rewardsName\}\s+Modifiers/);
      expect(settingsSrc).not.toMatch(/>Spark Rewards Modifiers</);
    });
  });

  describe("SettingsPage form state stays in sync with the live rewardsConfig snapshot", () => {
    it("the sync useEffect includes rewardsConfig in its dependency array", () => {
      // Locate the useEffect that re-syncs the Rewards form when the
      // snapshot updates. The previous version watched only
      // [storeConfig, hotelConfig, websiteContent] and silently dropped
      // the snapshot value once the component mounted with the default
      // useState.
      const effectMatch = settingsSrc.match(
        /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?setRewardsName\([\s\S]*?\}\s*,\s*\[[^\]]*rewardsConfig[^\]]*\]\s*\)/
      );
      expect(effectMatch, "expected a useEffect with rewardsName setter and rewardsConfig dep").toBeTruthy();
    });

    it("the sync useEffect seeds pointsPerBooking, pointsRedemptionRate, rewardsName, and rewardsTagline from the snapshot", () => {
      const effectMatch = settingsSrc.match(
        /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?setRewardsTagline\([\s\S]*?\}\s*,\s*\[[^\]]*rewardsConfig[^\]]*\]\s*\)/
      );
      expect(effectMatch).toBeTruthy();
      const body = effectMatch![0];
      expect(body).toMatch(/setPointsPerBooking\(/);
      expect(body).toMatch(/setPointsRedemptionRate\(/);
      expect(body).toMatch(/setRewardsName\(/);
      expect(body).toMatch(/setRewardsTagline\(/);
    });
  });

  describe("handleSaveRewards persists every field to updateSettings", () => {
    it("posts earningMode, pointsPerBooking, pointsRedemptionRate to the rewardsConfig doc", () => {
      const handleMatch = settingsSrc.match(
        /const\s+handleSaveRewards\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(handleMatch, "expected to find handleSaveRewards").toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/earningMode\s*,/);
      expect(body).toMatch(/pointsPerBooking\s*:/);
      expect(body).toMatch(/pointsRedemptionRate\s*:/);
    });

    it("posts rewardsName and rewardsTagline to the rewardsConfig doc", () => {
      const handleMatch = settingsSrc.match(
        /const\s+handleSaveRewards\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(handleMatch).toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/rewardsName\s*:/);
      expect(body).toMatch(/rewardsTagline\s*:/);
    });
  });

  describe("Server honors every field the form now writes", () => {
    it("bookings handler reads earningMode + pointsPerHundred + pointsPerBooking from rewardsConfig", () => {
      expect(bookingsSrc).toMatch(/rewardsConfig\.earningMode\s*\|\|\s*["']per-spend["']/);
      expect(bookingsSrc).toMatch(/rewardsConfig\.pointsPerHundred\s*\|\|\s*0/);
      expect(bookingsSrc).toMatch(/rewardsConfig\.pointsPerBooking\s*\|\|\s*0/);
    });

    it("members handler reads pointsRedemptionRate from rewardsConfig for redemption", () => {
      expect(membersSrc).toMatch(/rewardsConfigDoc\.data\(\)\?\.pointsRedemptionRate\s*\|\|\s*0/);
    });
  });
});
