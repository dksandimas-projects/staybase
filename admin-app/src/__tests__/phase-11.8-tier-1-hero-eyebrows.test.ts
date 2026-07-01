import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.8 PR 1 — Tier 1 hero eyebrow / subtext
// editability on the public site.
//
// Closes the launch-blocker from `AUDIT-PUBLIC-CONTENT-2026-07-01.md`:
//   - `homepage.heroEyebrow` — was hardcoded as `""` in the hook
//     and rendered as `config.tagline` in HomePage. Now
//     admin-editable from Settings → Branding, with `config.tagline`
//     as the deploy-time fallback.
//   - `about.heroEyebrow` + `about.heroSubtext` — were not in the
//     schema. Now admin-editable; the page falls back to its
//     deploy-time hardcoded copy when the admin hasn't set them.
//
// Source-pattern test — locks the wiring so the audit gap cannot
// silently regress.

const homeSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/HomePage.tsx"),
  "utf8"
);
const aboutSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/AboutPage.tsx"),
  "utf8"
);
const hookSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
  "utf8"
);
const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);
const schemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/websiteContent.ts"),
  "utf8"
);
const adminCtxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const constantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);
const publicCacheSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/publicSiteCache.ts"),
  "utf8"
);

describe("Phase 11.8 PR 1 — Tier 1 hero eyebrow / subtext editability", () => {
  describe("homepage.heroEyebrow — admin-editable override of config.tagline", () => {
    it("hook now reads homepage.heroEyebrow via pickString (not hardcoded empty string)", () => {
      // The hardcoded `""` on the homepage branch is gone; the
      // eyebrow is sourced from Firestore with config.tagline as
      // the fallback.
      expect(hookSrc).toMatch(
        /heroEyebrow:\s*pickString\(homepageRaw,\s*["']heroEyebrow["'],\s*config\.tagline\)/
      );
    });

    it("HomePage renders homepage.heroEyebrow with config.tagline fallback", () => {
      // The page must prefer the dynamic value and only fall back
      // to `config.tagline` when the dynamic value is empty.
      expect(homeSrc).toMatch(/\{homepage\.heroEyebrow\s*\|\|\s*config\.tagline\}/);
    });

    it("SettingsPage exposes a homepage hero eyebrow input", () => {
      // The state setter and the form input both exist; the input
      // is wired to the setter.
      expect(settingsSrc).toMatch(/const\s*\[homepageHeroEyebrow,\s*setHomepageHeroEyebrow\]/);
      expect(settingsSrc).toMatch(/value=\{homepageHeroEyebrow\}/);
      expect(settingsSrc).toMatch(/onChange=\{\(e\)\s*=>\s*setHomepageHeroEyebrow\(e\.target\.value\)\}/);
    });

    it("SettingsPage.handleSaveBranding writes homepage.heroEyebrow", () => {
      expect(settingsSrc).toMatch(/heroEyebrow:\s*homepageHeroEyebrow/);
    });
  });

  describe("about.heroEyebrow + about.heroSubtext — new editable fields", () => {
    it("shared/schemas/websiteContent.ts AboutContentSchema includes the new fields", () => {
      // The about schema now mirrors the homepage's `PublicHeroSchema`
      // shape (eyebrow + heading + subtext + photo) — previously
      // it had only heading + photo + the three text blocks.
      expect(schemaSrc).toMatch(/AboutContentSchema\s*=\s*z\.object\(\{[\s\S]*?heroEyebrow:\s*z\.string\(\)\.default\(["']["']\)[\s\S]*?heroSubtext:\s*z\.string\(\)\.default\(["']["']\)/);
    });

    it("PublicAboutContent interface exposes the new fields", () => {
      expect(hookSrc).toMatch(/export\s+interface\s+PublicAboutContent\s*\{[\s\S]*?heroEyebrow:\s*string;[\s\S]*?heroSubtext:\s*string;/);
    });

    it("hook reads about.heroEyebrow and about.heroSubtext via pickString", () => {
      expect(hookSrc).toMatch(/heroEyebrow:\s*pickString\(aboutRaw,\s*["']heroEyebrow["'],\s*fb\.about\.heroEyebrow\)/);
      expect(hookSrc).toMatch(/heroSubtext:\s*pickString\(aboutRaw,\s*["']heroSubtext["'],\s*fb\.about\.heroSubtext\)/);
    });

    it("AboutPage renders the new fields with deploy-time fallbacks", () => {
      expect(aboutSrc).toMatch(/\{aboutHeroEyebrow\s*\|\|\s*["']Our Story["']\}/);
      // The old hardcoded "Discover the vision and heart behind …"
      // is now gated on `aboutHeroSubtext` with the same string as
      // the fallback.
      expect(aboutSrc).toMatch(/aboutHeroSubtext\s*\|\|/);
      expect(aboutSrc).toMatch(/Discover the vision and heart behind/);
    });

    it("SettingsPage exposes an about hero eyebrow + heading + subtext card", () => {
      // State for the three new about fields.
      expect(settingsSrc).toMatch(/const\s*\[aboutHeroEyebrow,\s*setAboutHeroEyebrow\]/);
      expect(settingsSrc).toMatch(/const\s*\[aboutHeroSubtext,\s*setAboutHeroSubtext\]/);
      // All three inputs in the JSX.
      expect(settingsSrc).toMatch(/value=\{aboutHeroEyebrow\}/);
      expect(settingsSrc).toMatch(/value=\{aboutHeroSubtext\}/);
      // The new "About hero" card section.
      expect(settingsSrc).toMatch(/About hero/);
    });

    it("SettingsPage.handleSaveBranding writes about.heroEyebrow + about.heroSubtext", () => {
      expect(settingsSrc).toMatch(/heroEyebrow:\s*aboutHeroEyebrow/);
      expect(settingsSrc).toMatch(/heroSubtext:\s*aboutHeroSubtext/);
    });
  });

  describe("cache invalidation on admin save (closes the 5-min TTL demo gap)", () => {
    it("shared/constants/index.ts declares the bust key", () => {
      expect(constantsSrc).toMatch(
        /PUBLIC_SITE_CONTENT_CACHE_BUST_KEY\s*=\s*["']publicSiteContent:bust["']/
      );
    });

    it("shared/utils/publicSiteCache.ts exports the bust + subscribe helpers", () => {
      expect(publicCacheSrc).toMatch(/export\s+function\s+bustPublicSiteContentCache\s*\(/);
      expect(publicCacheSrc).toMatch(/export\s+function\s+subscribeToPublicSiteContentBust\s*\(/);
    });

    it("AdminContext.updateSettings calls bust after websiteContent or hotelConfig save", () => {
      expect(adminCtxSrc).toMatch(/import\s*\{[^}]*\bbustPublicSiteContentCache\b[^}]*\}/);
      // The bust call is gated on the two sections that affect the
      // public site content hook.
      expect(adminCtxSrc).toMatch(
        /section\s*===\s*["']websiteContent["']\s*\|\|\s*section\s*===\s*["']hotelConfig["']/
      );
      expect(adminCtxSrc).toMatch(/bustPublicSiteContentCache\(\)/);
    });

    it("usePublicSiteContent subscribes to bust events and unsubscribes in cleanup", () => {
      expect(hookSrc).toMatch(/subscribeToPublicSiteContentBust\(/);
      expect(hookSrc).toMatch(/unsubscribeBust\(\)/);
    });
  });
});
