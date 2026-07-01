import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.8 PR 3 — Tier 1 hotel contact
// editability on the public site.
//
// Closes the contact-detail gaps from `AUDIT-PUBLIC-CONTENT-2026-07-01.md`:
//   - `settings/hotelConfig` exposes 6 new runtime-editable fields
//     (address, frontDeskPhone, supportEmail, dpoEmail, facebookUrl,
//     instagramUrl)
//   - The public hook (`usePublicSiteContent`) reads them with
//     `pickString` and falls back to the deploy-time
//     `hotel.config.ts` value when empty
//   - Footer / ContactPage / PrivacyPage consume the hook instead
//     of `config.*`
//   - The Settings → Hotel Info form has 7 new inputs (visionStatement
//     + the 6 contact details) and `handleSaveHotel` writes them all
//   - The cross-tab cache bust from PR 1 still triggers on the
//     `hotelConfig` save (already covered by the AdminContext
//     updateSettings gate, but re-asserted here for safety)
//
// Source-pattern test — locks the wiring so the audit gap cannot
// silently regress.

const hookSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
  "utf8"
);
const footerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/components/Footer.tsx"),
  "utf8"
);
const contactSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/ContactPage.tsx"),
  "utf8"
);
const privacySrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/PrivacyPage.tsx"),
  "utf8"
);
const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);
const typesDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/TYPES.md"),
  "utf8"
);
const backendDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/BACKEND.md"),
  "utf8"
);

describe("Phase 11.8 PR 3 — Tier 1 hotel contact editability", () => {
  describe("usePublicSiteContent — PublicContactContent interface + chain", () => {
    it("exports a PublicContactContent interface with all 6 contact fields", () => {
      expect(hookSrc).toMatch(/export\s+interface\s+PublicContactContent\s*\{[^}]*address:\s*string;[^}]*frontDeskPhone:\s*string;[^}]*supportEmail:\s*string;[^}]*dpoEmail:\s*string;[^}]*facebookUrl:\s*string;[^}]*instagramUrl:\s*string;/s);
    });

    it("PublicSiteContent exposes a contact section", () => {
      expect(hookSrc).toMatch(/contact:\s*PublicContactContent/);
    });

    it("buildFallback seeds contact from hotel.config.ts so the public site never goes blank", () => {
      // The fallback uses the deploy-time config values as the
      // safe default for the public hook — the consumer pages
      // layer a `|| config.X` on top of the hook value at render
      // time as belt-and-suspenders.
      expect(hookSrc).toMatch(/contact:\s*\{[\s\S]*?address:\s*config\.address/);
      expect(hookSrc).toMatch(/frontDeskPhone:\s*config\.frontDeskPhone/);
      expect(hookSrc).toMatch(/supportEmail:\s*config\.supportEmail/);
      expect(hookSrc).toMatch(/dpoEmail:\s*config\.dpoEmail/);
      expect(hookSrc).toMatch(/facebookUrl:\s*config\.facebookUrl/);
      expect(hookSrc).toMatch(/instagramUrl:\s*config\.instagramUrl/);
    });

    it("hook reads the 6 contact fields via pickString from hotelConfig", () => {
      expect(hookSrc).toMatch(/address:\s*pickString\(hc,\s*["']address["'],\s*fb\.contact\.address\)/);
      expect(hookSrc).toMatch(/frontDeskPhone:\s*pickString\(hc,\s*["']frontDeskPhone["'],\s*fb\.contact\.frontDeskPhone\)/);
      expect(hookSrc).toMatch(/supportEmail:\s*pickString\(hc,\s*["']supportEmail["'],\s*fb\.contact\.supportEmail\)/);
      expect(hookSrc).toMatch(/dpoEmail:\s*pickString\(hc,\s*["']dpoEmail["'],\s*fb\.contact\.dpoEmail\)/);
      expect(hookSrc).toMatch(/facebookUrl:\s*pickString\(hc,\s*["']facebookUrl["'],\s*fb\.contact\.facebookUrl\)/);
      expect(hookSrc).toMatch(/instagramUrl:\s*pickString\(hc,\s*["']instagramUrl["'],\s*fb\.contact\.instagramUrl\)/);
    });
  });

  describe("Footer.tsx — reads from hook, falls back to config.*", () => {
    it("imports usePublicSiteContent and destructures contact", () => {
      expect(footerSrc).toMatch(/const\s*\{\s*branding,\s*contact\s*\}\s*=\s*usePublicSiteContent\(\)/);
    });

    it("renders address / phone / email / facebook / instagram from the hook with config.* fallback", () => {
      // Each of the 5 contact reads must use the `||` fallback to
      // the deploy-time config value when the hook returns "".
      expect(footerSrc).toMatch(/contact\.address\s*\|\|/);
      expect(footerSrc).toMatch(/contact\.frontDeskPhone\s*\|\|/);
      expect(footerSrc).toMatch(/contact\.supportEmail\s*\|\|/);
      expect(footerSrc).toMatch(/contact\.facebookUrl\s*\|\|/);
      expect(footerSrc).toMatch(/contact\.instagramUrl\s*\|\|/);
    });
  });

  describe("ContactPage.tsx — reads from hook, falls back to config.*", () => {
    it("imports usePublicSiteContent and destructures contact", () => {
      expect(contactSrc).toMatch(/const\s*\{\s*contact\s*\}\s*=\s*usePublicSiteContent\(\)/);
    });

    it("renders address / phone / email / facebook / instagram from the hook with config.* fallback", () => {
      expect(contactSrc).toMatch(/contact\.address\s*\|\|/);
      expect(contactSrc).toMatch(/contact\.frontDeskPhone\s*\|\|/);
      expect(contactSrc).toMatch(/contact\.supportEmail\s*\|\|/);
      expect(contactSrc).toMatch(/contact\.facebookUrl\s*\|\|/);
      expect(contactSrc).toMatch(/contact\.instagramUrl\s*\|\|/);
    });
  });

  describe("PrivacyPage.tsx — reads address + dpoEmail from hook", () => {
    it("imports usePublicSiteContent and destructures contact", () => {
      expect(privacySrc).toMatch(/const\s*\{\s*contact\s*\}\s*=\s*usePublicSiteContent\(\)/);
    });

    it("uses contact.dpoEmail with config.* fallback", () => {
      expect(privacySrc).toMatch(/const\s+dpoEmail\s*=\s*contact\.dpoEmail\s*\|\|/);
    });

    it("uses contact.address with config.* fallback (replaces the previous config.address.* lines)", () => {
      expect(privacySrc).toMatch(/contact\.address\s*\?\s*contact\.address\s*:/);
    });
  });

  describe("Settings → Hotel Info — 7 new form inputs + handleSaveHotel", () => {
    it("initializes state for the 6 new contact fields from hotelConfig", () => {
      expect(settingsSrc).toMatch(/const\s*\[address,\s*setAddress\]\s*=\s*useState\(hotelConfig\.address\)/);
      expect(settingsSrc).toMatch(/const\s*\[frontDeskPhone,\s*setFrontDeskPhone\]\s*=\s*useState\(hotelConfig\.frontDeskPhone\)/);
      expect(settingsSrc).toMatch(/const\s*\[supportEmail,\s*setSupportEmail\]\s*=\s*useState\(hotelConfig\.supportEmail\)/);
      expect(settingsSrc).toMatch(/const\s*\[dpoEmail,\s*setDpoEmail\]\s*=\s*useState\(hotelConfig\.dpoEmail\)/);
      expect(settingsSrc).toMatch(/const\s*\[facebookUrl,\s*setFacebookUrl\]\s*=\s*useState\(hotelConfig\.facebookUrl\)/);
      expect(settingsSrc).toMatch(/const\s*\[instagramUrl,\s*setInstagramUrl\]\s*=\s*useState\(hotelConfig\.instagramUrl\)/);
    });

    it("initializes visionStatement state (already read by the hook — was missing from the form)", () => {
      expect(settingsSrc).toMatch(/const\s*\[visionStatement,\s*setVisionStatement\]\s*=\s*useState\(hotelConfig\.visionStatement\)/);
    });

    it("exposes 7 new form inputs in the JSX", () => {
      // The 6 contact inputs + 1 visionStatement textarea.
      expect(settingsSrc).toMatch(/value=\{address\}/);
      expect(settingsSrc).toMatch(/value=\{frontDeskPhone\}/);
      expect(settingsSrc).toMatch(/value=\{supportEmail\}/);
      expect(settingsSrc).toMatch(/value=\{dpoEmail\}/);
      expect(settingsSrc).toMatch(/value=\{facebookUrl\}/);
      expect(settingsSrc).toMatch(/value=\{instagramUrl\}/);
      expect(settingsSrc).toMatch(/value=\{visionStatement\}/);
    });

    it("handleSaveHotel writes all 7 new fields to settings/hotelConfig", () => {
      // Single handleSaveHotel call, all 7 new fields included
      // alongside the existing fields.
      expect(settingsSrc).toMatch(/handleSaveHotel\s*=\s*async[\s\S]*?updateSettings\(\s*["']hotelConfig["'],\s*\{[\s\S]*?address,[\s\S]*?frontDeskPhone,[\s\S]*?supportEmail,[\s\S]*?dpoEmail,[\s\S]*?facebookUrl,[\s\S]*?instagramUrl,[\s\S]*?visionStatement,[\s\S]*?hotelStory[\s\S]*?\}\)/);
    });
  });

  describe("Docs — TYPES.md + BACKEND.md reflect the new fields", () => {
    it("TYPES.md HotelConfig lists supportEmail + dpoEmail", () => {
      expect(typesDocSrc).toMatch(/HotelConfig\s*\{[\s\S]*?supportEmail:\s*string[\s\S]*?dpoEmail:\s*string/);
    });

    it("TYPES.md HotelConfig notes the admin-editable contract (PR 3 comment)", () => {
      expect(typesDocSrc).toMatch(/Phase 11\.8 PR 3[\s\S]*?admin-editable[\s\S]*?Settings → Hotel Info/);
    });

    it("BACKEND.md settings/hotelConfig list includes the new contact fields", () => {
      expect(backendDocSrc).toMatch(/frontDeskPhone[\s\S]*?supportEmail[\s\S]*?dpoEmail[\s\S]*?facebookUrl[\s\S]*?instagramUrl/);
    });
  });
});
