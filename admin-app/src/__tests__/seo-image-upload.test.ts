import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSource = readFileSync(resolve(__dirname, "../pages/SettingsPage.tsx"), "utf8");
const storageRules = readFileSync(resolve(__dirname, "../../../firebase/storage.rules"), "utf8");
const footerSource = readFileSync(resolve(__dirname, "../../../guest-app/src/components/Footer.tsx"), "utf8");
const publicContentSource = readFileSync(resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"), "utf8");

describe("SEO social image uploader", () => {
  it("uses the shared preview uploader instead of a raw URL input", () => {
    expect(settingsSource).toMatch(/label="Social preview image"/);
    expect(settingsSource).toMatch(/onUpload=\{handleUploadSeoImage\}/);
    expect(settingsSource).toMatch(/fallback=\{DEFAULT_OG_IMAGE_URL\}/);
  });

  it("compresses and uploads SEO images to their dedicated public path", () => {
    expect(settingsSource).toMatch(/maxWidth:\s*1200,\s*maxHeight:\s*630/);
    expect(settingsSource).toMatch(/assets\/seo\/og-image/);
    expect(storageRules).toMatch(/match \/assets\/seo\/\{allPaths=\*\*\}[\s\S]*allow read: if true;[\s\S]*allow write: if isStaff\(\);/);
  });

  it("normalizes the legacy relative default to the full public fallback", () => {
    expect(settingsSource).toMatch(/value === config\.ogImage/);
    expect(settingsSource).toMatch(/ogImage:\s*seoOgImage\.trim\(\) \|\| DEFAULT_OG_IMAGE_URL/);
  });

  it("owns the X handle in Hotel Settings and hides empty social icons", () => {
    expect(settingsSource).toMatch(/activeTab === "hotel"[\s\S]*X Handle[\s\S]*value=\{twitterHandle\}/);
    expect(settingsSource).not.toMatch(/activeTab === "seo"[\s\S]*X handle/);
    expect(footerSource).toMatch(/\{facebook && <a/);
    expect(footerSource).toMatch(/\{instagram && <a/);
    expect(footerSource).toMatch(/\{twitterUrl && <a/);
    expect(publicContentSource).toMatch(/twitterHandle:\s*pickOptionalString\(hc/);
  });

  it("persists an SEO publish reminder after schema-relevant Hotel Settings change", () => {
    expect(settingsSource).toMatch(/updateSettings\("seo", \{ sourceChangesPending: true \}\)/);
    expect(settingsSource).toMatch(/SEO has changes pending/);
    expect(settingsSource).toMatch(/seoSettings\.sourceChangesPending \? "SEO & Search •"/);
  });
});
