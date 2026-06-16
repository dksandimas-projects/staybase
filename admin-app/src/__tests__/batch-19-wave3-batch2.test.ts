import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 19 — Wave 3 batch 2 (W3.7,
// W3.8, W3.9, W3.10, W3.11, W3.12). These are UI/UX spec closures; the
// batch ships:
//
//   * W3.7 — CorporateStaysPage "Integration Process" + "Retreat CTA"
//     sections are kept (already shipped).
//   * W3.8 — PrivacyPage + TermsPage now use the global <Navbar />
//     instead of a custom thin header. The custom `Link to="/"`
//     "Return to Homepage" chrome is gone.
//   * W3.9 — PrivacyPage §3 heading renamed from
//     "Data Retention Policy" to "How Long We Keep It".
//   * W3.10 — config.rewardsName added; the RewardsLandingPage hero
//     chip now interpolates {config.rewardsName}.
//   * W3.11 — config.termsLastUpdated added; TermsPage now
//     interpolates it instead of a hard-coded "June 13, 2026".
//   * W3.12 — NotFoundPage renders a tiny <p>v{VERSION}</p> badge to
//     resolve the spec contradiction.

const privacyPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/PrivacyPage.tsx"),
  "utf8"
);
const termsPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/TermsPage.tsx"),
  "utf8"
);
const notFoundPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/NotFoundPage.tsx"),
  "utf8"
);
const rewardsLandingSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/RewardsLandingPage.tsx"),
  "utf8"
);
const hotelConfigSrc = readFileSync(
  resolve(__dirname, "../../../hotel.config.ts"),
  "utf8"
);

describe("Phase 11.6 Batch 19 — Wave 3 batch 2 (chrome + wording)", () => {
  describe("W3.7 — CorporateStaysPage keeps Integration Process + Retreat CTA", () => {
    it("CorporateStaysPage still renders both sections", () => {
      const corpSrc = readFileSync(
        resolve(__dirname, "../../../guest-app/src/pages/CorporateStaysPage.tsx"),
        "utf8"
      );
      expect(corpSrc).toMatch(/Simple Integration, Superior Results|Integration Process/i);
      expect(corpSrc).toMatch(/Partner with us for your next team retreat/);
    });
  });

  describe("W3.8 — Privacy/Terms use the global Navbar", () => {
    it("PrivacyPage imports the Navbar", () => {
      expect(privacyPageSrc).toMatch(/import\s*\{\s*Navbar\s*\}\s*from\s*["']\.\.\/components\/Navbar["']/);
    });

    it("PrivacyPage renders the Navbar in both the custom-body + fallback branches", () => {
      // Count <Navbar /> occurrences: should be 2 (one per branch).
      const matches = privacyPageSrc.match(/<Navbar\s*\/>/g) || [];
      expect(matches.length, "expected PrivacyPage to render Navbar in 2 branches").toBeGreaterThanOrEqual(2);
    });

    it("PrivacyPage no longer renders the custom thin header chrome", () => {
      // Strip comments to avoid false positives on the migration note.
      const stripped = privacyPageSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(stripped).not.toMatch(/Navigation Bar Header/);
      expect(stripped).not.toMatch(/Return to Homepage/);
    });

    it("TermsPage imports the Navbar and renders it once", () => {
      expect(termsPageSrc).toMatch(/import\s*\{\s*Navbar\s*\}\s*from\s*["']\.\.\/components\/Navbar["']/);
      expect(termsPageSrc).toMatch(/<Navbar\s*\/>/);
    });

    it("TermsPage no longer renders the custom Return to Homepage chrome", () => {
      expect(termsPageSrc).not.toMatch(/Return to Homepage/);
      expect(termsPageSrc).not.toMatch(/ArrowLeft/);
    });
  });

  describe("W3.9 — PrivacyPage §3 heading is 'How Long We Keep It'", () => {
    it("the heading text was renamed", () => {
      expect(privacyPageSrc).toMatch(/3\.\s*How Long We Keep It/);
    });

    it("the legacy 'Data Retention Policy' text is gone", () => {
      // Strip the comment that references the rename.
      const stripped = privacyPageSrc.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(stripped).not.toMatch(/3\.\s*Data Retention Policy/);
    });
  });

  describe("W3.10 — config.rewardsName + sweep", () => {
    it("hotel.config.ts exposes rewardsName: 'Spark Rewards'", () => {
      expect(hotelConfigSrc).toMatch(/rewardsName:\s*["']Spark Rewards["']/);
    });

    it("RewardsLandingPage hero chip interpolates {config.rewardsName}", () => {
      expect(rewardsLandingSrc).toMatch(/\{config\.rewardsName\}\s+Loyalty Program/);
    });
  });

  describe("W3.11 — config.termsLastUpdated", () => {
    it("hotel.config.ts exposes termsLastUpdated", () => {
      expect(hotelConfigSrc).toMatch(/termsLastUpdated:\s*["']/);
    });

    it("TermsPage renders config.termsLastUpdated (not a hard-coded date)", () => {
      expect(termsPageSrc).toMatch(/Last Updated:\s*\{config\.termsLastUpdated\}/);
      expect(termsPageSrc).not.toMatch(/Last Updated:\s*June 13, 2026/);
    });
  });

  describe("W3.12 — NotFoundPage renders a tiny v{VERSION} badge", () => {
    it("NotFoundPage imports VERSION from @spark-inn/shared", () => {
      expect(notFoundPageSrc).toMatch(/import\s*\{[^}]*\bVERSION\b[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
    });

    it("NotFoundPage renders <p>v{VERSION}</p>", () => {
      expect(notFoundPageSrc).toMatch(/<p[^>]*>\s*v\{VERSION\}\s*<\/p>/);
    });
  });
});
