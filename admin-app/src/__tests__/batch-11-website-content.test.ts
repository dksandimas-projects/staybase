import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 11 — Settings-driven content on
// the public site (audit item S6.2):
//   * HomePage    — hero, amenities, featured rooms, services, sparkRewards
//   * AboutPage   — hero photo, mission, vision, hotel story
//   * CorporateStaysPage — hero heading, hero subtext, hero photo, perks
//
// This is a source-pattern test. The behavior of the underlying Firestore
// reads and the hide-when-empty logic lives in
// `guest-app/src/hooks/usePublicSiteContent.ts`; this test just locks the
// wiring so the same regression (Settings updates silently ignored by
// public pages) cannot sneak back in.

const homeSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/HomePage.tsx"),
  "utf8"
);
const aboutSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/AboutPage.tsx"),
  "utf8"
);
const corpSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateStaysPage.tsx"),
  "utf8"
);
const hookSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
  "utf8"
);

describe("Phase 11.6 Batch 11 — public pages read settings", () => {
  describe("S6.2 — usePublicSiteContent hook exists and reads Firestore", () => {
    it("exports a usePublicSiteContent hook", () => {
      expect(hookSrc).toMatch(/export\s+function\s+usePublicSiteContent\s*\(/);
    });

    it("reads settings/websiteContent and settings/hotelConfig", () => {
      expect(hookSrc).toMatch(/getDoc\(doc\(db,\s*["']settings["'],\s*["']websiteContent["']\)/);
      expect(hookSrc).toMatch(/getDoc\(doc\(db,\s*["']settings["'],\s*["']hotelConfig["']\)/);
    });

    it("exposes homepage, about, and corporate sections", () => {
      expect(hookSrc).toMatch(/homepage\s*:\s*PublicHomepageContent/);
      expect(hookSrc).toMatch(/about\s*:\s*PublicAboutContent/);
      expect(hookSrc).toMatch(/corporate\s*:\s*PublicCorporateContent/);
    });

    it("hides services when all entries are disabled (filter on isEnabled)", () => {
      // The hook stores services with isEnabled and the public page filters
      // out isEnabled === false before rendering.
      expect(hookSrc).toMatch(/isEnabled\s*:\s*entry\.isEnabled\s*===\s*undefined\s*\?\s*true\s*:\s*Boolean\(entry\.isEnabled\)/);
    });
  });

  describe("S6.2 — HomePage consumes websiteContent.homepage", () => {
    it("imports usePublicSiteContent", () => {
      expect(homeSrc).toMatch(/import\s*\{\s*usePublicSiteContent\s*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("reads hero heading and hero subtext from settings, not hard-coded", () => {
      expect(homeSrc).toMatch(/homepage\.heroHeading/);
      expect(homeSrc).toMatch(/homepage\.heroSubtext/);
      expect(homeSrc).toMatch(/homepage\.heroPhotoUrl/);
      expect(homeSrc).not.toMatch(/>Your sanctuary in Bohol</);
    });

    it("renders amenities from settings array", () => {
      expect(homeSrc).toMatch(/homepage\.amenities\.map\(/);
      // The old hard-coded amenities import must be gone.
      expect(homeSrc).not.toMatch(/import\s*\{[^}]*\bamenities\b[^}]*\}\s*from\s*["']\.\.\/data\/homepage["']/);
    });

    it("derives featured rooms from settings.featuredRoomIds (not hard-coded ids)", () => {
      expect(homeSrc).toMatch(/homepage\.featuredRoomIds/);
      // The hard-coded `const ids = ["room-201", "room-204", "room-301"]`
      // block must be gone.
      expect(homeSrc).not.toMatch(/const\s+ids\s*=\s*\[\s*["']room-201["']/);
    });

    it("hides Services section when all services disabled or empty", () => {
      // Wraps the entire <section> in a `visibleServices.length > 0 &&`
      // guard per the BACKEND.md spec.
      expect(homeSrc).toMatch(/visibleServices\.length\s*>\s*0\s*&&\s*\(/);
      expect(homeSrc).toMatch(/homepage\.services\.filter\(\(s\)\s*=>\s*s\.isEnabled\s*!==\s*false\)/);
    });

    it("hides Spark Rewards block entirely when isEnabled: false, hides disabled perks otherwise", () => {
      expect(homeSrc).toMatch(/sparkRewardsVisible\s*=\s*homepage\.sparkRewards\.isEnabled\s*!==\s*false/);
      expect(homeSrc).toMatch(/homepage\.sparkRewards\.perks\.filter\(\(p\)\s*=>\s*p\.isEnabled\s*!==\s*false\)/);
      expect(homeSrc).toMatch(/sparkRewardsVisible\s*&&\s*visibleRewards\.length\s*>\s*0\s*&&\s*\(/);
      // The hard-coded rewardPerks import must be gone.
      expect(homeSrc).not.toMatch(/import\s*\{[^}]*\brewardPerks\b[^}]*\}\s*from\s*["']\.\.\/data\/homepage["']/);
    });
  });

  describe("S6.2 — AboutPage consumes websiteContent.about and hotelConfig", () => {
    it("imports usePublicSiteContent", () => {
      expect(aboutSrc).toMatch(/import\s*\{\s*usePublicSiteContent\s*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("uses dynamic hero photo URL from settings (no hard-coded Unsplash link)", () => {
      expect(aboutSrc).toMatch(/about\.heroPhotoUrl/);
      expect(aboutSrc).not.toMatch(/photo-1542314831-068cd1dbfeeb/);
    });

    it("renders mission, vision, and hotel story from hotelConfig", () => {
      expect(aboutSrc).toMatch(/about\.missionStatement/);
      expect(aboutSrc).toMatch(/about\.visionStatement/);
      expect(aboutSrc).toMatch(/about\.hotelStory/);
      // The hard-coded mission and vision paragraphs must be gone.
      expect(aboutSrc).not.toMatch(/To deliver peaceful, consistent stays shaped by genuine/);
      expect(aboutSrc).not.toMatch(/gold standard of boutique lodging in Bohol/);
    });
  });

  describe("S6.2 — CorporateStaysPage consumes websiteContent.corporate", () => {
    it("imports usePublicSiteContent", () => {
      expect(corpSrc).toMatch(/import\s*\{\s*usePublicSiteContent\b[^}]*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("uses dynamic corporate hero photo, heading, and subtext from settings", () => {
      expect(corpSrc).toMatch(/corporate\.heroPhotoUrl/);
      expect(corpSrc).toMatch(/corporate\.heroHeading/);
      expect(corpSrc).toMatch(/corporate\.heroSubtext/);
      // Hard-coded Unsplash URL and copy must be gone.
      expect(corpSrc).not.toMatch(/photo-1497366216548-37526070297c/);
      expect(corpSrc).not.toMatch(/>Elevated Stays for Modern Business</);
    });

    it("renders perks from corporate.perks (not 6 hard-coded <motion.div> blocks)", () => {
      expect(corpSrc).toMatch(/corporate\.perks\.map\(/);
      // Only the 6 stub motion.divs that USED to hard-code the perks are
      // gone; the surrounding container grid is still expected to exist.
      // The "{/* Perk 1 */}" comment marker is the canary.
      expect(corpSrc).not.toMatch(/\{\/\*\s*Perk\s+1\s*\*\/\}/);
      expect(corpSrc).not.toMatch(/Negotiated Rates/);
      expect(corpSrc).not.toMatch(/Group Bookings/);
      expect(corpSrc).not.toMatch(/Premium Security/);
    });
  });
});
