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
const rewardsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/RewardsLandingPage.tsx"),
  "utf8"
);
const navbarSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/components/Navbar.tsx"),
  "utf8"
);
const footerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/components/Footer.tsx"),
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

    it("exposes homepage, about, corporate, rewards, and branding sections", () => {
      expect(hookSrc).toMatch(/homepage\s*:\s*PublicHomepageContent/);
      expect(hookSrc).toMatch(/about\s*:\s*PublicAboutContent/);
      expect(hookSrc).toMatch(/corporate\s*:\s*PublicCorporateContent/);
      expect(hookSrc).toMatch(/rewards\s*:\s*PublicRewardsContent/);
      expect(hookSrc).toMatch(/branding\s*:\s*PublicBranding/);
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

    it("derives featured rooms from settings.featuredTypeValues (not hard-coded ids)", () => {
      // The new model is type-driven (featuredTypeValues) — see
      // `MAX_FEATURED_TYPES` in `shared/constants/index.ts` for
      // the full rationale.
      expect(homeSrc).toMatch(/homepage\.featuredTypeValues/);
      // The old per-room field must be gone from the page.
      expect(homeSrc).not.toMatch(/homepage\.featuredRoomIds/);
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

    it("renders mission, vision, and hotel story from website content", () => {
      expect(aboutSrc).toMatch(/about\.missionStatement/);
      expect(aboutSrc).toMatch(/about\.visionStatement/);
      expect(aboutSrc).toMatch(/about\.hotelStory/);
      // The hard-coded mission and vision paragraphs must be gone.
      expect(aboutSrc).not.toMatch(/To deliver peaceful, consistent stays shaped by genuine/);
      expect(aboutSrc).not.toMatch(/gold standard of boutique lodging in Bohol/);
    });
  });

  describe("Settings → Website Content — About page editor", () => {
    const settingsSrc = readFileSync(
      resolve(__dirname, "../../src/pages/SettingsPage.tsx"),
      "utf8"
    );
    const hookSrc = readFileSync(
      resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
      "utf8"
    );

    it("exposes mission, vision, and story fields in the Website Content tab", () => {
      expect(settingsSrc).toMatch(/aboutMissionStatement/);
      expect(settingsSrc).toMatch(/aboutVisionStatement/);
      expect(settingsSrc).toMatch(/aboutHotelStory/);
      expect(settingsSrc).toMatch(/About us page/);
    });

    it("saves the About body fields to settings\\/websiteContent.about", () => {
      expect(settingsSrc).toMatch(/about:\s*\{[\s\S]*?missionStatement:\s*aboutMissionStatement[\s\S]*?visionStatement:\s*aboutVisionStatement[\s\S]*?hotelStory:\s*aboutHotelStory/);
    });

    it("guest hook prefers websiteContent.about before hotelConfig fallback", () => {
      expect(hookSrc).toMatch(/missionStatement:\s*pickString\(\s*aboutRaw,\s*["']missionStatement["']/);
      expect(hookSrc).toMatch(/visionStatement:\s*pickString\(\s*aboutRaw,\s*["']visionStatement["']/);
      expect(hookSrc).toMatch(/hotelStory:\s*pickString\(\s*aboutRaw,\s*["']hotelStory["']/);
    });
  });

  describe("S6.2 — CorporateStaysPage consumes websiteContent.corporate", () => {
    it("imports usePublicSiteContent", () => {
      expect(corpSrc).toMatch(/import\s*\{\s*usePublicSiteContent\b[^}]*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("uses dynamic corporate hero photo, heading, subtext, and eyebrow from settings", () => {
      expect(corpSrc).toMatch(/corporate\.heroPhotoUrl/);
      expect(corpSrc).toMatch(/corporate\.heroHeading/);
      expect(corpSrc).toMatch(/corporate\.heroSubtext/);
      expect(corpSrc).toMatch(/corporate\.heroEyebrow/);
      // Hard-coded Unsplash URL and copy must be gone.
      expect(corpSrc).not.toMatch(/photo-1497366216548-37526070297c/);
      expect(corpSrc).not.toMatch(/>Elevated Stays for Modern Business</);
      expect(corpSrc).not.toMatch(/Curated hospitality for executive comfort/);
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

  describe("S6.2 — RewardsLandingPage consumes websiteContent.rewards", () => {
    it("imports usePublicSiteContent", () => {
      expect(rewardsSrc).toMatch(/import\s*\{\s*usePublicSiteContent\b[^}]*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("reads hero photo, eyebrow, heading, and subtext from settings", () => {
      expect(rewardsSrc).toMatch(/rewards\.heroPhotoUrl/);
      expect(rewardsSrc).toMatch(/rewards\.heroEyebrow/);
      expect(rewardsSrc).toMatch(/rewards\.heroHeading/);
      expect(rewardsSrc).toMatch(/rewards\.heroSubtext/);
    });

    it("the hard-coded Google image URL is gone", () => {
      expect(rewardsSrc).not.toMatch(/AB6AXuDxE3ob-vSO4zxT_VMu0OviqdIAMTOtgsJXzWeddVJ-6-QmLSHHkERJKmN_zfFFeGvMrFhzST6Xoc-MNtubwhDrYU3ZjBFSjACtuAwnlBaH4z6Ts-UB0kYlC38ol_42OAWXX2iUGuPhL2ZSvUac1bc6j0zvNGyAyCNMnyrg9X2dwyDXafz7n_EIfEX_xAI6S2D_XhfdiedtLyzdH-SxVWzm25SwLm9ovUul16TnLGbrr9fj2Jmezvw2N3x4T49eU2RDAchvC4pc-2UY/);
    });

    it("the hard-coded 'Earn Every Stay' heading is gone", () => {
      expect(rewardsSrc).not.toMatch(/>Earn Every Stay</);
    });
  });

  describe("S6.2 — AboutPage consumes about.heroHeading", () => {
    it("reads about.heroHeading from settings (not hard-coded 'about us')", () => {
      expect(aboutSrc).toMatch(/about\.heroHeading/);
      expect(aboutSrc).not.toMatch(/>\s*about us\s*</);
    });
  });

  describe("S6.2 — Navbar swaps logo by over-hero vs scrolled state", () => {
    it("imports resolveLogo and usePublicSiteContent", () => {
      expect(navbarSrc).toMatch(/import\s*\{\s*resolveLogo\s*\}\s*from\s*["']\.\.\/utils\/brand["']/);
      expect(navbarSrc).toMatch(/import\s*\{\s*usePublicSiteContent\s*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("derives a darkLogoSrc that uses logoNavbarOnDark when available", () => {
      expect(navbarSrc).toMatch(/logoNavbarOnDark/);
      // The `solid` state picks the light logo; non-solid picks the
      // dark-background variant.
      expect(navbarSrc).toMatch(/solid\s*\?\s*lightLogoSrc\s*:\s*darkLogoSrc/);
    });
  });

  describe("S6.2 — Footer uses branding.logoFooter override", () => {
    it("imports resolveLogo and usePublicSiteContent", () => {
      expect(footerSrc).toMatch(/import\s*\{\s*resolveLogo\s*\}\s*from\s*["']\.\.\/utils\/brand["']/);
      expect(footerSrc).toMatch(/import\s*\{\s*usePublicSiteContent\s*\}\s*from\s*["']\.\.\/hooks\/usePublicSiteContent["']/);
    });

    it("resolves logoFooter via resolveLogo (not brandAsset directly)", () => {
      expect(footerSrc).toMatch(/resolveLogo\(branding\.logoFooter/);
      expect(footerSrc).not.toMatch(/brandAsset\(config\.logos\.white\)/);
    });
  });
});

describe("Branding — admin app normalizes partial websiteContent docs", () => {
  const adminCtxSrc = readFileSync(
    resolve(__dirname, "../../src/context/AdminContext.tsx"),
    "utf8"
  );
  const settingsPageSrc = readFileSync(
    resolve(__dirname, "../../src/pages/SettingsPage.tsx"),
    "utf8"
  );

  it("AdminContext defines a mergeWebsiteContent helper for partial Firestore docs", () => {
    expect(adminCtxSrc).toMatch(/function\s+mergeWebsiteContent/);
    expect(adminCtxSrc).toMatch(/setWebsiteContent\(mergeWebsiteContent/);
  });

  it("SettingsPage defends every websiteContent.X.Y read with optional chaining", () => {
    // Bug: a partial doc that pre-dates the Branding feature would
    // set websiteContent = { homepage: {…}, corporate: {…} } without
    // the new `rewards` / `branding` / `about.heroHeading` /
    // `corporate.heroEyebrow` sub-fields, crashing any consumer that
    // reaches into them. The fix: every reach-in uses optional
    // chaining, and AdminContext normalizes the snapshot upstream.
    const reachInReads = settingsPageSrc.match(/websiteContent\.[a-zA-Z]+\.[a-zA-Z]+(?!\?)/g) || [];
    expect(reachInReads.length, "expected every websiteContent.X.Y read to use ?. (optional chaining)").toBe(0);
  });
});

describe("Website Content editors — list-shaped homepage content", () => {
  const settingsPageSrc = readFileSync(
    resolve(__dirname, "../../src/pages/SettingsPage.tsx"),
    "utf8"
  );
  const listEditorSrc = readFileSync(
    resolve(__dirname, "../../src/components/ListEditor.tsx"),
    "utf8"
  );
  const typePickerSrc = readFileSync(
    resolve(__dirname, "../../src/components/TypePicker.tsx"),
    "utf8"
  );
  const sharedConstantsSrc = readFileSync(
    resolve(__dirname, "../../../shared/constants/index.ts"),
    "utf8"
  );
  const adminCtxSrc = readFileSync(
    resolve(__dirname, "../../src/context/AdminContext.tsx"),
    "utf8"
  );

  it("SettingsPage uses ListEditor for amenities, services, and spark rewards perks", () => {
    expect(settingsPageSrc).toMatch(/import\s*\{[^}]*ListEditor[^}]*\}\s*from\s*["']\.\.\/components\/ListEditor["']/);
    expect(settingsPageSrc).toMatch(/<ListEditor[\s\S]*?value=\{homepageAmenities\}[\s\S]*?\/>/);
    expect(settingsPageSrc).toMatch(/<ListEditor[\s\S]*?value=\{homepageServices\}[\s\S]*?\/>/);
    expect(settingsPageSrc).toMatch(/<ListEditor[\s\S]*?value=\{sparkRewardsPerks\}[\s\S]*?\/>/);
  });

  it("SettingsPage uses TypePicker for featuredTypeValues (replaces RoomPicker)", () => {
    expect(settingsPageSrc).toMatch(/import\s*\{[^}]*TypePicker[^}]*\}\s*from\s*["']\.\.\/components\/TypePicker["']/);
    expect(settingsPageSrc).toMatch(/<TypePicker[\s\S]*?value=\{homepageFeaturedTypeValues\}[\s\S]*?\/>/);
    // The old RoomPicker must be gone.
    expect(settingsPageSrc).not.toMatch(/<RoomPicker/);
    expect(settingsPageSrc).not.toMatch(/from\s*["']\.\.\/components\/RoomPicker["']/);
  });

  it("SettingsPage persists all four sub-objects via a single handleSaveWebsiteContent", () => {
    expect(settingsPageSrc).toMatch(/handleSaveWebsiteContent\s*=\s*async/);
    expect(settingsPageSrc).toMatch(/amenities:\s*homepageAmenities/);
    expect(settingsPageSrc).toMatch(/services:\s*homepageServices/);
    expect(settingsPageSrc).toMatch(/featuredTypeValues:\s*homepageFeaturedTypeValues/);
    expect(settingsPageSrc).toMatch(/isEnabled:\s*sparkRewardsEnabled/);
  });

  it("Spark Rewards promo block has an enable/disable toggle wired to setSparkRewardsEnabled", () => {
    // The Settings page should own a toggle that flips the local
    // state and gets persisted with the rest of the form.
    expect(settingsPageSrc).toMatch(/setSparkRewardsEnabled\(!sparkRewardsEnabled\)/);
    expect(settingsPageSrc).toMatch(/Spark Rewards block on the homepage/);
  });

  it("The 'Coming soon' stub is gone", () => {
    expect(settingsPageSrc).not.toMatch(/Coming soon/);
    expect(settingsPageSrc).not.toMatch(/edit those values directly in.*Firestore/i);
  });

  it("Website Content sections are collapsible to keep the editor scannable", () => {
    expect(settingsPageSrc).toMatch(/function\s+WebsiteContentSection/);
    expect(settingsPageSrc).toMatch(/aria-expanded=\{isOpen\}/);
    expect(settingsPageSrc).toMatch(/aria-controls=\{panelId\}/);
    expect(settingsPageSrc).toMatch(/<WebsiteContentSection[\s\S]*?title="Homepage Section Headers"[\s\S]*?defaultOpen/);
    for (const title of [
      "Homepage Amenities",
      "Featured Room Types",
      "Homepage Services",
      "Spark Rewards Promo",
      "About us page",
      "Corporate page"
    ]) {
      expect(settingsPageSrc).toContain(`title="${title}"`);
    }
  });

  it("ListEditor supports add / remove / reorder + isEnabled toggle", () => {
    expect(listEditorSrc).toMatch(/function\s+add\s*\(/);
    expect(listEditorSrc).toMatch(/function\s+remove\s*\(/);
    expect(listEditorSrc).toMatch(/function\s+move\s*\(/);
    expect(listEditorSrc).toMatch(/patch\(index,\s*\{ isEnabled/);
  });

  it("ListEditor picks icons from KNOWN_CONTENT_ICONS", () => {
    expect(listEditorSrc).toMatch(/KNOWN_CONTENT_ICONS\.map\(/);
  });

  it("TypePicker caps selection at MAX_FEATURED_TYPES and emits the new array", () => {
    expect(typePickerSrc).toMatch(/MAX_FEATURED_TYPES/);
    expect(typePickerSrc).toMatch(/onChange\(next\)/);
  });

  it("TypePicker filters to types with at least one active room", () => {
    // The picker shows the count of active rooms per type and
    // disables the Add button when the count is zero. The new
    // model is type-driven, not room-driven.
    expect(typePickerSrc).toMatch(/activeCount/);
    expect(typePickerSrc).toMatch(/activeRoomCounts/);
    // The Add button is disabled when the type has no active
    // rooms OR the cap has been reached.
    expect(typePickerSrc).toMatch(/disabled=\{disabled \|\| value\.length >= maxItems\}/);
  });

  it("shared/constants exports KNOWN_CONTENT_ICONS + MAX_FEATURED_TYPES", () => {
    expect(sharedConstantsSrc).toMatch(/export const KNOWN_CONTENT_ICONS/);
    expect(sharedConstantsSrc).toMatch(/export const MAX_FEATURED_TYPES\s*=\s*3/);
    // Backward-compat alias for the migration window.
    expect(sharedConstantsSrc).toMatch(/export const MAX_FEATURED_ROOMS\s*=\s*MAX_FEATURED_TYPES/);
  });

  it("AdminContext seed includes the four list-based sub-objects", () => {
    // The seed (and the merge function) must default the four
    // sub-objects so a fresh admin session renders the editors
    // with example content instead of empty placeholders.
    expect(adminCtxSrc).toMatch(/amenities:\s*\[\s*\{[^}]*Consistent comfort/);
    expect(adminCtxSrc).toMatch(/services:\s*\[\s*\{[^}]*Tour Packages/);
    // The featured field is now type-driven (was `featuredRoomIds`).
    expect(adminCtxSrc).toMatch(/featuredTypeValues:\s*\["executive"/);
    expect(adminCtxSrc).not.toMatch(/featuredRoomIds:\s*\["room-201"/);
    expect(adminCtxSrc).toMatch(/sparkRewards:\s*\{[\s\S]*?Earn points on completed stays/);
  });

  it("AdminContext migrates the old featuredRoomIds to featuredTypeValues on read", () => {
    // Migration step in `mergeWebsiteContent`: if the doc still
    // carries the old `featuredRoomIds` array and no new
    // `featuredTypeValues`, derive the new field by mapping
    // each id to its room type via the `roomTypes` already in
    // context, dedupe, and return. The canonical migration
    // happens on the next admin save.
    expect(adminCtxSrc).toMatch(/homepageRaw\.featuredTypeValues/);
    expect(adminCtxSrc).toMatch(/homepageRaw\.featuredRoomIds/);
    expect(adminCtxSrc).toMatch(/derived\.push\(typeValue\)/);
  });
});

describe("Branding — logo uploads preserve transparency (W3.13)", () => {
  const settingsPageSrc = readFileSync(
    resolve(__dirname, "../../src/pages/SettingsPage.tsx"),
    "utf8"
  );
  const imagesSrc = readFileSync(
    resolve(__dirname, "../../../shared/utils/images.ts"),
    "utf8"
  );

  it("shared/compressImageFile accepts image/png in the mimeType union", () => {
    expect(imagesSrc).toMatch(/mimeType\?:\s*["']image\/jpeg["']\s*\|\s*["']image\/webp["']\s*\|\s*["']image\/png["']/);
  });

  it("shared/compressImageFile has a MIME-to-extension map that includes PNG", () => {
    expect(imagesSrc).toMatch(/MIME_TO_EXTENSION/);
    expect(imagesSrc).toMatch(/["']image\/png["']\s*:\s*["']png["']/);
  });

  it("shared/compressImageFile does NOT paint a white background for PNG output", () => {
    // The original bug: a transparent PNG drawn onto a 2D canvas
    // and then JPEG-encoded produced a non-deterministic white
    // box. The fix: only paint a white background when the target
    // format has no alpha channel. PNG output must skip the fill.
    expect(imagesSrc).toMatch(/outputSupportsAlpha\s*=\s*settings\.mimeType\s*!==\s*["']image\/jpeg["']/);
    expect(imagesSrc).toMatch(/if\s*\(!outputSupportsAlpha\)\s*\{[\s\S]*?fillRect/);
  });

  it("shared/compressImageFile renames the output to match the mime type, not always .jpg", () => {
    // The original bug: every output file was renamed to .jpg
    // regardless of the actual mime type. Now it should match.
    expect(imagesSrc).toMatch(/MIME_TO_EXTENSION\[settings\.mimeType\]/);
    expect(imagesSrc).not.toMatch(/file\.name\.replace\(\/\\\.\[\^\\.\]\+\$\/,?\s*["']\.jpg["']/);
  });

  it("All three logo uploaders in SettingsPage pass mimeType: 'image/png'", () => {
    // The bug: a transparent logo uploaded through the Branding
    // tab was JPEG-encoded, losing the alpha channel and showing
    // up with a white box. The three logo rows (navbar solid,
    // navbar over hero, footer) must opt into PNG.
    const settingsFile = readFileSync(
      resolve(__dirname, "../../src/pages/SettingsPage.tsx"),
      "utf8"
    );
    const pngUploads = settingsFile.match(/mimeType:\s*["']image\/png["']/g) || [];
    expect(pngUploads.length, "expected the three logo uploaders to pass mimeType: 'image/png'").toBeGreaterThanOrEqual(3);
  });

  it("Hero photo uploaders still default to JPEG (alpha not needed)", () => {
    // Hero photos cover the whole viewport and need smaller file
    // sizes — JPEG is the right default. The four hero photo
    // uploaders in the Branding tab (homepage, about, corporate,
    // rewards) should not pass mimeType: 'image/png' so they
    // keep the JPEG default.
    const heroUploaders = settingsPageSrc.match(
      /compressImageFile\(file, \{ maxWidth: 1920, maxHeight: (?:1080|600), quality: 0\.85 \}\)/g
    );
    expect(heroUploaders, "expected the four hero photo uploaders to keep the default JPEG mime type").not.toBeNull();
    expect(heroUploaders?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe("No hero fallback flash — initial state must not show the static image", () => {
  // Bug: a returning visitor who had the admin's custom hero image
  // would briefly see the static `homepageHeroImage` fallback
  // before the Firestore fetch resolved and the custom image
  // appeared. The fix: the hook seeds empty `heroPhotoUrl` fields
  // in the initial state, so the page renders a skeleton instead
  // of the fallback. After Firestore resolves, the hook applies
  // either the custom URL or the static fallback via `pickString`.

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
  const rewardsSrc = readFileSync(
    resolve(__dirname, "../../../guest-app/src/pages/RewardsLandingPage.tsx"),
    "utf8"
  );
  const hookSrc = readFileSync(
    resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
    "utf8"
  );
  const heroSkeletonSrc = readFileSync(
    resolve(__dirname, "../../../guest-app/src/components/HeroSkeleton.tsx"),
    "utf8"
  );
  const sharedCacheSrc = readFileSync(
    resolve(__dirname, "../../../shared/utils/cache.ts"),
    "utf8"
  );
  const sharedConstantsSrc = readFileSync(
    resolve(__dirname, "../../../shared/constants/index.ts"),
    "utf8"
  );

  it("shared/utils/cache.ts exports readCacheWithTtl + writeCache", () => {
    expect(sharedCacheSrc).toMatch(/export function readCacheWithTtl/);
    expect(sharedCacheSrc).toMatch(/export function writeCache/);
    expect(sharedCacheSrc).toMatch(/export function clearCache/);
  });

  it("shared/constants exports the cache key + 5-minute TTL", () => {
    // v3 — bumped from v2 because the `contact` section was added
    // (Phase 11.8 PR 3). v2 entries have no `contact` key and are
    // now shape-incompatible and fall through to the empty state.
    expect(sharedConstantsSrc).toMatch(/PUBLIC_SITE_CONTENT_CACHE_KEY\s*=\s*["']publicSiteContent:v3["']/);
    expect(sharedConstantsSrc).toMatch(/PUBLIC_SITE_CONTENT_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  });

  it("usePublicSiteContent reads the cache synchronously on mount", () => {
    // The call site uses a generic (readCacheWithTtl<CachedContent>...)
    // so the regex allows the optional generic in the source.
    expect(hookSrc).toMatch(/readCacheWithTtl(?:<[^>]+>)?\(\s*PUBLIC_SITE_CONTENT_CACHE_KEY,\s*PUBLIC_SITE_CONTENT_CACHE_TTL_MS/);
  });

  it("usePublicSiteContent writes to the cache after Firestore resolves", () => {
    expect(hookSrc).toMatch(/writeCache\(\s*PUBLIC_SITE_CONTENT_CACHE_KEY,\s*toCache/);
  });

  it("usePublicSiteContent seeds an EMPTY initial state (not the static fallback)", () => {
    // The fix: initial state must have empty heroPhotoUrl fields
    // so the page renders a skeleton instead of the static
    // fallback. Previously the initial state included
    // homepageHeroImage / aboutHeroImage / etc. — visible flash.
    expect(hookSrc).toMatch(/function buildEmptyState\s*\(/);
    expect(hookSrc).toMatch(/heroPhotoUrl:\s*""/);
  });

  it("All four hero pages render a HeroSkeleton when heroPhotoUrl is empty", () => {
    // Each hero site wraps the <img> in a ternary that falls
    // back to <HeroSkeleton /> when the URL is missing.
    for (const src of [homeSrc, aboutSrc, corpSrc, rewardsSrc]) {
      expect(src, "expected a HeroSkeleton fallback in the hero render").toMatch(/\{[a-zA-Z]+Photo \? \([\s\S]*?\) : \(\s*<HeroSkeleton\s*\/>\s*\)\}/);
    }
  });

  it("All four hero pages import HeroSkeleton", () => {
    for (const src of [homeSrc, aboutSrc, corpSrc, rewardsSrc]) {
      expect(src, "expected HeroSkeleton import").toMatch(/import\s*\{\s*HeroSkeleton\s*\}\s*from\s*["']\.\.\/components\/HeroSkeleton["']/);
    }
  });

  it("HeroSkeleton renders a neutral animate-pulse placeholder", () => {
    expect(heroSkeletonSrc).toMatch(/bg-section-bg/);
    expect(heroSkeletonSrc).toMatch(/animate-pulse/);
    expect(heroSkeletonSrc).toMatch(/aria-hidden="true"/);
  });

  it("None of the four hero pages do `homepage\\.heroPhotoUrl || homepageHeroImage` anymore", () => {
    // The OR-with-fallback was the source of the flash. The
    // hook now applies the fallback internally; pages just
    // read the value directly.
    for (const src of [homeSrc, aboutSrc, corpSrc, rewardsSrc]) {
      expect(src, "page must not OR the hero URL with a fallback constant").not.toMatch(/heroPhotoUrl\s*\|\|\s*homepageHeroImage/);
      expect(src, "page must not OR with any `homepage` fallback constant").not.toMatch(/heroPhotoUrl\s*\|\|\s*\w*HeroImage/);
    }
  });
});

describe("Hero text legibility — darker overlay + drop-shadow on all 4 heroes", () => {
  // Background: the original hero overlays (a flat
  // `bg-gray-950/45` on Home/About and a thin
  // `via-gray-950/65` gradient on Corporate/Rewards) failed on
  // light / high-contrast admin uploads — the white text
  // disappeared into the photo. The fix unifies all four
  // heroes with a stronger directional gradient plus a
  // `drop-shadow-*` glow on the text so it always reads.

  const sources: Record<"homepage" | "about" | "corporate" | "rewards", string> = {
    homepage: readFileSync(resolve(__dirname, "../../../guest-app/src/pages/HomePage.tsx"), "utf8"),
    about: readFileSync(resolve(__dirname, "../../../guest-app/src/pages/AboutPage.tsx"), "utf8"),
    corporate: readFileSync(resolve(__dirname, "../../../guest-app/src/pages/CorporateStaysPage.tsx"), "utf8"),
    rewards: readFileSync(resolve(__dirname, "../../../guest-app/src/pages/RewardsLandingPage.tsx"), "utf8")
  };

  for (const [name, src] of Object.entries(sources)) {
    it(`${name} uses a gradient overlay (not just a flat color)`, () => {
      expect(src, `${name} must use bg-gradient-`).toMatch(/bg-gradient-to-[bt]\b/);
    });

    it(`${name}'s h1 has a drop-shadow for legibility`, () => {
      // The h1 is the biggest text and most likely to collide
      // with a bright patch in the photo. A custom
      // drop-shadow blur keeps the headline readable without
      // hiding the photo behind an opaque black bar.
      expect(src, `${name}'s h1 must have a drop-shadow`).toMatch(/<h1[^>]*drop-shadow/);
    });

    it(`${name}'s hero text (subtext or eyebrow) has a drop-shadow-md or larger`, () => {
      // The subtext / eyebrow is smaller and the white color
      // tends to wash out on light photos. A `drop-shadow-md`
      // or arbitrary drop-shadow utility on the supporting copy
      // keeps it legible.
      const hasDropShadow = /drop-shadow-md|drop-shadow-lg|drop-shadow-xl|drop-shadow-\[/.test(src);
      expect(hasDropShadow, `${name} must have at least one drop-shadow-* utility on the hero text`).toBe(true);
    });
  }

  it("HomePage uses a top-to-bottom gradient (light top, heavy bottom)", () => {
    // The homepage text is centered, so a `to-b` gradient
    // darkens the lower half (where the text sits) more than
    // the upper half (where the navbar + photo read).
    expect(sources.homepage).toMatch(/bg-gradient-to-b/);
    expect(sources.homepage).toMatch(/from-black\/40[\s\S]*?via-black\/55[\s\S]*?to-black\/70/);
  });

  it("HomePage no longer uses the old flat bg-gray-950/45 overlay", () => {
    // The old flat overlay was a 45% black blanket that hid
    // the photo and still didn't help on light backgrounds.
    // Replaced by the gradient. Strip comments so the
    // migration note in the new code (which mentions the old
    // value) doesn't trip the assertion.
    const heroSection = sources.homepage
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .match(/<section[\s\S]*?<\/section>/);
    expect(heroSection, "homepage must have a hero <section>").toBeTruthy();
    expect(heroSection![0]).not.toMatch(/bg-gray-950\/45/);
  });

  it("CorporateStaysPage uses a lighter gradient than the home / about / rewards heroes", () => {
    // The corporate page sits on a `bg-gray-950` section, so
    // the photo only needs a modest dark wash to read — not
    // the heavier 40/75/90 gradient used on the other heroes.
    // Drop-shadow on the text carries the rest of the legibility
    // load (see `feat/hero-text-legibility`). Eased from
    // `to-gray-950/90` to `to-gray-950/60` after the user
    // reported the page was too dark.
    expect(sources.corporate).toMatch(/bg-gradient-to-b from-gray-950\/20 via-gray-950\/40 to-gray-950\/60/);
    expect(sources.corporate).not.toMatch(/to-gray-950\/90/);
  });

  it("RewardsLandingPage keeps the stronger gradient (asymmetric to corporate)", () => {
    // The rewards page has a different visual brief from
    // corporate (a hospitality hero vs a corporate B2B hero)
    // and still uses the heavier gradient. The asymmetry is
    // intentional — if rewards also ends up too dark, mirror
    // the corporate easing.
    expect(sources.rewards).toMatch(/to-gray-950\/90/);
  });

  it("AboutPage uses a top-to-bottom gradient (light top, heavy bottom)", () => {
    expect(sources.about).toMatch(/bg-gradient-to-b/);
  });
});
