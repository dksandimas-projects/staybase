import { z } from "zod";

// Per-page hero shape used by every public page (homepage, about,
// corporate, rewards). All fields are optional — when empty the
// guest app falls back to the deploy-time assets in
// `guest-app/src/data/homepage.ts`. Consumed by Settings → Branding
// in the admin app and surfaced through
// `guest-app/src/hooks/usePublicSiteContent.ts`.
export const PublicHeroSchema = z.object({
  heroEyebrow: z.string().default(""),
  heroHeading: z.string().default(""),
  heroSubtext: z.string().default(""),
  heroPhotoUrl: z.string().default("")
});

export const HomepageContentSchema = PublicHeroSchema.extend({
  amenities: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string().optional(),
      isEnabled: z.boolean().optional()
    })
  ),
  // Type values featured on the homepage "Stay with us" section.
  // Each value resolves to its first active room — see
  // `HomePage` and the `TypePicker` admin component. Capped at
  // `MAX_FEATURED_TYPES` (3) at the editor and at the renderer.
  //
  // Migration note: the previous field was `featuredRoomIds`
  // (a list of physical room doc IDs). That model was wrong —
  // see `MAX_FEATURED_TYPES` in `shared/constants/index.ts` for
  // the full rationale. `AdminContext.mergeWebsiteContent` does
  // a one-time mapping from the old field to the new one.
  featuredTypeValues: z.array(z.string()),
  services: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string().optional(),
      isEnabled: z.boolean().optional()
    })
  ),
  sparkRewards: z.object({
    heading: z.string(),
    description: z.string(),
    perks: z.array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
        isEnabled: z.boolean().optional()
      })
    ),
    isEnabled: z.boolean()
  })
});

export const AboutContentSchema = z.object({
  heroEyebrow: z.string().default(""),
  heroHeading: z.string().default(""),
  heroSubtext: z.string().default(""),
  heroPhotoUrl: z.string().default(""),
  missionStatement: z.string().default(""),
  visionStatement: z.string().default(""),
  hotelStory: z.string().default("")
});

export const CorporateContentSchema = PublicHeroSchema.extend({
  perks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      icon: z.string().optional(),
      isEnabled: z.boolean().optional()
    })
  ),
  // Rooms overview section on /corporate (eyebrow + heading + subtext).
  // All optional — the guest app falls back to hardcoded copy in
  // `CorporateStaysPage` when empty. Edited from Settings → Website
  // Content → Corporate page.
  roomsOverviewEyebrow: z.string().default(""),
  roomsOverviewHeading: z.string().default(""),
  roomsOverviewDescription: z.string().default(""),
  // Retreat CTA banner at the bottom of the "rooms" section
  // (heading + description + button label). All optional with the
  // same fallback behavior as the rooms overview block above.
  retreatHeading: z.string().default(""),
  retreatDescription: z.string().default(""),
  retreatCtaLabel: z.string().default("")
});

export const RewardsContentSchema = PublicHeroSchema;

// Runtime branding overrides (set by the admin from Settings →
// Branding). All fields default to "" — the guest app falls back to
// `hotel.config.ts → logos.*` via `resolveLogo()`. Logo selection for
// the Navbar is also contextual: `logoNavbar` for the scrolled/solid
// state, `logoNavbarOnDark` for the over-hero transparent state.
export const BrandingConfigSchema = z.object({
  logoNavbar: z.string().default(""),
  logoNavbarOnDark: z.string().default(""),
  logoFooter: z.string().default("")
});

export const WebsiteContentSchema = z.object({
  homepage: HomepageContentSchema,
  about: AboutContentSchema,
  corporate: CorporateContentSchema,
  rewards: RewardsContentSchema,
  branding: BrandingConfigSchema,
  privacyPolicyBody: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  houseRules: z.string().optional(),
  privacyPolicyLastUpdated: z.string().optional()
});

export type PublicHero = z.infer<typeof PublicHeroSchema>;
export type HomepageContent = z.infer<typeof HomepageContentSchema>;
export type AboutContent = z.infer<typeof AboutContentSchema>;
export type CorporateContent = z.infer<typeof CorporateContentSchema>;
export type RewardsContent = z.infer<typeof RewardsContentSchema>;
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;
export type WebsiteContent = z.infer<typeof WebsiteContentSchema>;
