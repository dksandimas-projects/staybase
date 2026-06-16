import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 20 — Wave 4 (W4.2 + W4.3).
//
// W4.2: Vite build-time transform that substitutes the static <meta>
// tags in `index.html` with values from `hotel.config.ts` (brandName,
// domain, ogImage). The plugin is added to both apps.
//
// W4.3: WHITE-LABEL.md schema is synced to the actual fields in
// `hotel.config.ts` (rewardsName + termsLastUpdated added per W3.10
// + W3.11, roomTypes note about the Firestore migration per W3.3).

const guestViteConfigSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/vite.config.ts"),
  "utf8"
);
const adminViteConfigSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/vite.config.ts"),
  "utf8"
);
const guestIndexHtmlSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/index.html"),
  "utf8"
);
const adminIndexHtmlSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/index.html"),
  "utf8"
);
const hotelConfigSrc = readFileSync(
  resolve(__dirname, "../../../hotel.config.ts"),
  "utf8"
);
const whiteLabelSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/WHITE-LABEL.md"),
  "utf8"
);

describe("Phase 11.6 Batch 20 — Wave 4 (W4.2 Vite OG transform + W4.3 WHITE-LABEL.md)", () => {
  describe("W4.2 — Vite build-time index.html transform plugin", () => {
    it("guest-app vite.config.ts exports an indexHtmlTransformPlugin", () => {
      expect(guestViteConfigSrc).toMatch(/function\s+indexHtmlTransformPlugin\s*\(\)\s*:\s*Plugin/);
      expect(guestViteConfigSrc).toMatch(/spark-inn-index-html-transform/);
      expect(guestViteConfigSrc).toMatch(/indexHtmlTransformPlugin\(\)/);
    });

    it("the guest-app plugin transforms the og:title + og:description + og:image + og:url", () => {
      const pluginMatch = guestViteConfigSrc.match(
        /function\s+indexHtmlTransformPlugin\s*\(\)\s*:\s*Plugin\s*\{[\s\S]*?\}\s*\}/
      );
      expect(pluginMatch, "expected to find the plugin body").toBeTruthy();
      const body = pluginMatch![0];
      expect(body).toMatch(/og:title/);
      expect(body).toMatch(/og:description/);
      expect(body).toMatch(/og:image/);
      expect(body).toMatch(/og:url/);
      expect(body).toMatch(/config\.brandName/);
      expect(body).toMatch(/config\.domain/);
    });

    it("the plugin prepends https:// to ogImage when it's a relative path", () => {
      const pluginMatch = guestViteConfigSrc.match(
        /function\s+indexHtmlTransformPlugin\s*\(\)\s*:\s*Plugin\s*\{[\s\S]*?\}\s*\}/
      );
      expect(pluginMatch).toBeTruthy();
      const body = pluginMatch![0];
      expect(body).toMatch(/config\.ogImage/);
      expect(body).toMatch(/config\.ogImage\.startsWith\(["']http["']\)/);
      expect(body).toMatch(/https:\/\/\$\{config\.domain\}/);
    });

    it("admin-app vite.config.ts also has the plugin (per W4.2)", () => {
      expect(adminViteConfigSrc).toMatch(/function\s+indexHtmlTransformPlugin\s*\(\)\s*:\s*Plugin/);
      expect(adminViteConfigSrc).toMatch(/indexHtmlTransformPlugin\(\)/);
      expect(adminViteConfigSrc).toMatch(/config\.adminDomain/);
    });

    it("the guest-app index.html has the expected placeholder tags the plugin matches", () => {
      // The plugin uses regexes against the <title>, og:title,
      // og:description, og:image, og:url, twitter:title,
      // twitter:description, twitter:image tags. Some of them are
      // multi-line in the source HTML.
      expect(guestIndexHtmlSrc).toMatch(/<title>[\s\S]*?<\/title>/i);
      expect(guestIndexHtmlSrc).toMatch(/og:title/);
      expect(guestIndexHtmlSrc).toMatch(/og:description/);
      expect(guestIndexHtmlSrc).toMatch(/og:image/);
      expect(guestIndexHtmlSrc).toMatch(/og:url/);
      expect(guestIndexHtmlSrc).toMatch(/twitter:title/);
      expect(guestIndexHtmlSrc).toMatch(/twitter:description/);
      expect(guestIndexHtmlSrc).toMatch(/twitter:image/);
    });

    it("the admin-app index.html has at least a title + (the plugin adds og tags on build)", () => {
      expect(adminIndexHtmlSrc).toMatch(/<title>[\s\S]*?<\/title>/i);
    });
  });

  describe("W4.3 — WHITE-LABEL.md schema sync", () => {
    it("documents the rewardsName field added by W3.10", () => {
      expect(whiteLabelSrc).toMatch(/rewardsName:\s*string\s+.*per W3\.10/);
    });

    it("documents the termsLastUpdated field added by W3.11", () => {
      expect(whiteLabelSrc).toMatch(/termsLastUpdated:\s*string\s+.*per W3\.11/);
    });

    it("notes the roomTypes migration to settings/hotelConfig.roomTypes (per W3.3)", () => {
      expect(whiteLabelSrc).toMatch(/settings\/hotelConfig\.roomTypes\s+on\s+Firestore\s+\(per W3\.3\)/);
    });
  });

  describe("hotel.config.ts is in sync with WHITE-LABEL.md", () => {
    it("config has the rewardsName field", () => {
      expect(hotelConfigSrc).toMatch(/rewardsName:\s*["']Spark Rewards["']/);
    });

    it("config has the termsLastUpdated field", () => {
      expect(hotelConfigSrc).toMatch(/termsLastUpdated:\s*["']/);
    });

    it("config has the ogImage field (used by the Vite transform plugin)", () => {
      expect(hotelConfigSrc).toMatch(/ogImage:\s*["']/);
    });

    it("config has the domain + adminDomain fields", () => {
      expect(hotelConfigSrc).toMatch(/domain:\s*["']sparkinnbohol\.com["']/);
      expect(hotelConfigSrc).toMatch(/adminDomain:\s*["']admin\.sparkinnbohol\.com["']/);
    });
  });
});
