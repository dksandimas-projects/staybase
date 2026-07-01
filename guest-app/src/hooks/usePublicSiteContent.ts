import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import config from "@config";
import { swapHeroPreload } from "../utils/heroPrefetch";
import {
  PUBLIC_SITE_CONTENT_CACHE_KEY,
  PUBLIC_SITE_CONTENT_CACHE_TTL_MS,
  DEFAULT_CORPORATE_PERKS,
  DEFAULT_CORPORATE_PAGE_CONTENT,
  readCacheWithTtl,
  writeCache,
  subscribeToPublicSiteContentBust,
  type ContentItem
} from "@spark-inn/shared";
import {
  homepageHeroImage,
  aboutHeroImage,
  corporateHeroImage,
  rewardsHeroImage,
  aboutHeroHeading,
  corporateHeroEyebrow,
  rewardsHeroEyebrowSuffix,
  rewardsHeroHeading,
  rewardsHeroSubtext,
  amenities as fallbackAmenities,
  services as fallbackServices,
  rewardPerks as fallbackRewardPerks
} from "../data/homepage";

export interface SparkRewardsPromo {
  heading: string;
  description: string;
  perks: ContentItem[];
  isEnabled: boolean;
}

// Per-page hero shape used by every public page (homepage, about,
// corporate, rewards). All fields default to the values in
// `data/homepage.ts` when empty in Firestore. Keeps a single fallback
// chain: admin override > static data > hardcoded UI copy.
export interface PublicHeroContent {
  heroEyebrow: string;
  heroHeading: string;
  heroSubtext: string;
  heroPhotoUrl: string;
}

export interface PublicHomepageContent extends PublicHeroContent {
  amenities: ContentItem[];
  // Type values featured on the homepage "Stay with us" section.
  // Each value resolves to its first active room at render time.
  // Previously `featuredRoomIds: string[]` (per-room IDs) — that
  // model was wrong because the card content all comes from the
  // room TYPE, not the individual room. See
  // `shared/constants/index.ts → MAX_FEATURED_TYPES` for the
  // full rationale.
  featuredTypeValues: string[];
  services: ContentItem[];
  sparkRewards: SparkRewardsPromo;
}

export interface PublicAboutContent {
  heroEyebrow: string;
  heroHeading: string;
  heroSubtext: string;
  heroPhotoUrl: string;
  missionStatement: string;
  visionStatement: string;
  hotelStory: string;
}

// Runtime hotel contact details (Phase 11.8 PR 3). Each field
// falls back to the deploy-time `hotel.config.ts` value via
// `pickString` so the public site keeps rendering the brand's
// white-label values until the owner overrides them from
// Settings → Hotel. Mirrors the safe-default chain the hero
// fields use.
export interface PublicContactContent {
  address: string;
  frontDeskPhone: string;
  supportEmail: string;
  dpoEmail: string;
  facebookUrl: string;
  instagramUrl: string;
}

export interface PublicCorporateContent extends PublicHeroContent {
  perks: ContentItem[];
  // Rooms overview section on /corporate. All fields fall back
  // to the hardcoded copy in `CorporateStaysPage` when empty.
  roomsOverviewEyebrow: string;
  roomsOverviewHeading: string;
  roomsOverviewDescription: string;
  // Retreat CTA banner at the bottom of the rooms section.
  // Same empty-string-fallback behavior as the rooms overview.
  retreatHeading: string;
  retreatDescription: string;
  retreatCtaLabel: string;
}

export interface PublicRewardsContent extends PublicHeroContent {}

// Runtime branding overrides (set by the admin from Settings →
// Branding). All fields default to "" — the guest app falls back to
// `hotel.config.ts → logos.*` via `resolveLogo()`. Logo selection for
// the Navbar is also contextual: `logoNavbar` for the scrolled/solid
// state, `logoNavbarOnDark` for the over-hero transparent state.
export interface PublicBranding {
  logoNavbar: string;
  logoNavbarOnDark: string;
  logoFooter: string;
}

export interface PublicSiteContent {
  loading: boolean;
  homepage: PublicHomepageContent;
  about: PublicAboutContent;
  contact: PublicContactContent;
  corporate: PublicCorporateContent;
  rewards: PublicRewardsContent;
  branding: PublicBranding;
}

const FALLBACK_HERO_HEADING = "Your sanctuary in Bohol";
const FALLBACK_HERO_SUBTEXT =
  "A warm, minimalist stay where comfort feels natural and care is quietly intentional.";
const FALLBACK_SPARK_REWARDS = {
  heading: "Stay often, feel known",
  description:
    "Join the loyalty program built for repeat guests, corporate travelers, and anyone who wants a smoother next stay.",
  perks: fallbackRewardPerks.map((perk) => ({
    title: perk,
    description: "",
    icon: "",
    isEnabled: true
  })),
  isEnabled: true
};
const FALLBACK_CORPORATE_HERO_HEADING = DEFAULT_CORPORATE_PAGE_CONTENT.hero.heading;
const FALLBACK_CORPORATE_HERO_SUBTEXT = DEFAULT_CORPORATE_PAGE_CONTENT.hero.subtext;
const FALLBACK_ABOUT_MISSION =
  "To deliver peaceful, consistent stays shaped by genuine, intentional hospitality. We believe that hospitality is not merely a service, but a philosophy of care where every detail is deliberate and every guest feels deeply valued.";
const FALLBACK_ABOUT_VISION = (brand: string) =>
  `To establish ${brand} as the gold standard of boutique lodging in Bohol, recognized for providing curated sanctuaries where travelers find ultimate comfort, reliable modern amenities, and a deep connection to island tranquility.`;
const FALLBACK_ABOUT_STORY = (brand: string) =>
  `Founded in the heart of Tagbilaran City, Bohol, ${brand} was born out of a desire to redefine the boutique hotel experience. We observed that while travelers appreciated the unique characters of boutique stays, they often missed the reliability and consistency of global chains. We set out to bridge this gap, creating a sanctuary where style meets structure, and comfort is guaranteed.\n\nOur location was chosen with care—providing our guests with a peaceful retreat that is simultaneously connected to the rich historical landmarks, business districts, and natural wonders of Bohol. From the sandy beaches of Panglao to the famous Chocolate Hills, ${brand} serves as the perfect home base for both leisure explorers and corporate stay travelers.\n\nEvery element of ${brand} is curated. Our rooms are engineered for quiet comfort, featuring premium soundproofing, custom orthopedic beds, and optimized layouts. We combine these physical comforts with a service team that is trained to anticipate guest needs, offering a warm and authentic Filipino welcome that feels like family.\n\nAs we continue to grow and welcome guests from around the world, our promise remains steadfast: to provide peaceful, consistent stays shaped by genuine, intentional hospitality. We invite you to experience the spark that makes our hospitality warm and our lodging exceptional.`;

const FALLBACK_CORPORATE_PERKS: ContentItem[] = DEFAULT_CORPORATE_PERKS.map((perk) => ({
  title: perk.title,
  description: perk.description,
  icon: perk.icon,
  isEnabled: perk.isEnabled !== false
}));

function toContentItemArray(value: unknown): ContentItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      title: typeof entry.title === "string" ? entry.title : "",
      description: typeof entry.description === "string" ? entry.description : "",
      icon: typeof entry.icon === "string" ? entry.icon : "",
      isEnabled: entry.isEnabled === undefined ? true : Boolean(entry.isEnabled)
    }))
    .filter((entry) => entry.title.length > 0);
}

function buildSparkRewards(raw: unknown): SparkRewardsPromo {
  if (!raw || typeof raw !== "object") return FALLBACK_SPARK_REWARDS;
  const r = raw as Record<string, unknown>;
  return {
    heading: typeof r.heading === "string" ? r.heading : FALLBACK_SPARK_REWARDS.heading,
    description: typeof r.description === "string" ? r.description : FALLBACK_SPARK_REWARDS.description,
    perks: toContentItemArray(r.perks).length > 0
      ? toContentItemArray(r.perks)
      : FALLBACK_SPARK_REWARDS.perks,
    isEnabled: r.isEnabled === undefined ? true : Boolean(r.isEnabled)
  };
}

function buildFallback(): PublicSiteContent {
  // Used in two places:
  //   1. As the *post-load* shape — i.e. what to render when
  //      Firestore has no custom override. Image URLs are
  //      pre-populated with the static `data/homepage.ts`
  //      fallbacks so the page can render immediately.
  //   2. As the source for individual section defaults during
  //      the Firestore merge (see the `useEffect` body).
  return {
    loading: false,
    homepage: {
      heroEyebrow: "",
      heroHeading: FALLBACK_HERO_HEADING,
      heroSubtext: FALLBACK_HERO_SUBTEXT,
      heroPhotoUrl: homepageHeroImage,
      amenities: fallbackAmenities.map((entry) => ({
        title: entry.title,
        description: entry.description,
        icon: "",
        isEnabled: true
      })),
      // Defaults to three canonical Spark Inn types so the homepage
      // shows a representative room card on first visit. The page
      // resolves each to its first active room.
      featuredTypeValues: ["executive", "standard-double", "family"],
      services: fallbackServices.map((entry) => ({
        title: entry.title,
        description: entry.description,
        icon: "",
        isEnabled: true
      })),
      sparkRewards: FALLBACK_SPARK_REWARDS
    },
    about: {
      // The about page reads `heroEyebrow` + `heroSubtext` only when
      // the admin has set them in Settings → Branding; otherwise the
      // page renders the deploy-time hardcoded copy it has shipped
      // with. Empty string here means "no admin override" — the page
      // falls back to its own hardcoded default at render time.
      heroEyebrow: "",
      heroHeading: aboutHeroHeading,
      heroSubtext: "",
      heroPhotoUrl: aboutHeroImage,
      missionStatement: FALLBACK_ABOUT_MISSION,
      visionStatement: FALLBACK_ABOUT_VISION(config.brandName),
      hotelStory: FALLBACK_ABOUT_STORY(config.brandName)
    },
    contact: {
      // Same pattern as `homepage.heroEyebrow` (PR 1): the deploy-
      // time `hotel.config.ts` values are the safe fallback so the
      // public site never goes blank during the cold-load window
      // before the Firestore `settings/hotelConfig` doc resolves.
      // The hook returns "" when the doc carries no override, and
      // the consumer pages (Footer / Contact / Privacy) layer a
      // `|| config.X` on top of the hook value at render time.
      address: config.address
        ? `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`
        : "",
      frontDeskPhone: config.frontDeskPhone,
      supportEmail: config.supportEmail,
      dpoEmail: config.dpoEmail,
      facebookUrl: config.facebookUrl,
      instagramUrl: config.instagramUrl
    },
    corporate: {
      heroEyebrow: corporateHeroEyebrow,
      heroHeading: FALLBACK_CORPORATE_HERO_HEADING,
      heroSubtext: FALLBACK_CORPORATE_HERO_SUBTEXT,
      // The corporate hero photo is sourced from the static
      // `corporateHeroImage` in `data/homepage.ts` directly. The
      // one-time Firestore backfill in `AdminContext` does NOT
      // write `corporate.heroPhotoUrl` — leaving the field empty
      // means "use the static fallback", which is also the value
      // the admin's Reset action writes. The guest app's
      // `pickString` chain (Firestore override → static fallback)
      // applies at read time.
      heroPhotoUrl: corporateHeroImage,
      perks: FALLBACK_CORPORATE_PERKS,
      // Rooms overview + retreat CTA — sourced from
      // `DEFAULT_CORPORATE_PAGE_CONTENT` so the guest app, the
      // admin editor's pre-population, and the one-time Firestore
      // backfill in `AdminContext` all agree on the same copy.
      roomsOverviewEyebrow: DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.eyebrow,
      roomsOverviewHeading: DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.heading,
      roomsOverviewDescription: DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.description,
      retreatHeading: DEFAULT_CORPORATE_PAGE_CONTENT.retreat.heading,
      retreatDescription: DEFAULT_CORPORATE_PAGE_CONTENT.retreat.description,
      retreatCtaLabel: DEFAULT_CORPORATE_PAGE_CONTENT.retreat.ctaLabel
    },
    rewards: {
      heroEyebrow: rewardsHeroEyebrowSuffix,
      heroHeading: rewardsHeroHeading,
      heroSubtext: rewardsHeroSubtext,
      heroPhotoUrl: rewardsHeroImage
    },
    branding: {
      logoNavbar: "",
      logoNavbarOnDark: "",
      logoFooter: ""
    }
  };
}

// Empty initial state — used when there's no localStorage cache
// (first visit). All `heroPhotoUrl` fields are intentionally
// empty so the page renders a skeleton / neutral background
// instead of the static fallback while Firestore loads. This
// fixes the "fallback image flashes before the custom upload
// loads" bug observed on the homepage. Once Firestore resolves,
// the hook populates the URLs (custom override or static
// fallback) via the `pickString` merge in the `useEffect`.
function buildEmptyState(): PublicSiteContent {
  return {
    loading: true,
    homepage: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: "",
      amenities: [],
      featuredTypeValues: [],
      services: [],
      sparkRewards: {
        heading: "",
        description: "",
        perks: [],
        isEnabled: false
      }
    },
    about: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: "",
      missionStatement: "",
      visionStatement: "",
      hotelStory: ""
    },
    contact: {
      // Empty until the Firestore doc carries an override — the
      // consumer pages fall back to `config.*` on their own when
      // the hook returns "" so the page never renders a blank
      // field during the brief cold-load window before Firestore
      // resolves.
      address: "",
      frontDeskPhone: "",
      supportEmail: "",
      dpoEmail: "",
      facebookUrl: "",
      instagramUrl: ""
    },
    corporate: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: "",
      perks: [],
      roomsOverviewEyebrow: "",
      roomsOverviewHeading: "",
      roomsOverviewDescription: "",
      retreatHeading: "",
      retreatDescription: "",
      retreatCtaLabel: ""
    },
    rewards: {
      heroEyebrow: "",
      heroHeading: "",
      heroSubtext: "",
      heroPhotoUrl: ""
    },
    branding: {
      logoNavbar: "",
      logoNavbarOnDark: "",
      logoFooter: ""
    }
  };
}

let cachedPromise: Promise<{ websiteContent: Record<string, unknown> | null; hotelConfig: Record<string, unknown> | null }> | null = null;

function loadFromFirestore() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const [wcSnap, hcSnap] = await Promise.all([
        getDoc(doc(db, "settings", "websiteContent")),
        getDoc(doc(db, "settings", "hotelConfig"))
      ]);
      return {
        websiteContent: wcSnap.exists() ? (wcSnap.data() as Record<string, unknown>) : null,
        hotelConfig: hcSnap.exists() ? (hcSnap.data() as Record<string, unknown>) : null
      };
    } catch {
      return { websiteContent: null, hotelConfig: null };
    }
  })();
  return cachedPromise;
}

// What we cache in localStorage: the full state (with fallback
// URLs applied) but without the transient `loading` flag. The
// `loading` field is added back on read with `loading: false` —
// a cached value is, by definition, a "loaded" value.
type CachedContent = Omit<PublicSiteContent, "loading">;

export function usePublicSiteContent(): PublicSiteContent {
  // Initial state is either:
  //   - the cached value (returning visitor, <5 min old) → instant
  //     paint, no fallback flash, `loading: false` because the
  //     cached value is already the loaded shape
  //   - the empty state (first visit, no cache, or stale) → all
  //     heroPhotoUrl fields are empty so the page renders a
  //     skeleton until Firestore resolves
  const [content, setContent] = useState<PublicSiteContent>(() => {
    const cached = readCacheWithTtl<CachedContent>(
      PUBLIC_SITE_CONTENT_CACHE_KEY,
      PUBLIC_SITE_CONTENT_CACHE_TTL_MS
    );
    if (cached) {
      return { ...cached, loading: false };
    }
    return buildEmptyState();
  });

  useEffect(() => {
    let cancelled = false;

    // Cross-tab cache invalidation. The admin app writes a bust
    // timestamp on every successful settings save (see
    // `bustPublicSiteContentCache`); the `storage` event fires in
    // every other tab. Drop the in-memory promise + the cached
    // localStorage entry and refetch so the guest page reflects
    // the admin's edit immediately.
    function refetch() {
      cachedPromise = null;
      loadFromFirestore().then(({ websiteContent, hotelConfig }) => {
        if (cancelled) return;
        applyFirestoreData(websiteContent, hotelConfig);
      });
    }
    const unsubscribeBust = subscribeToPublicSiteContentBust(refetch);

    loadFromFirestore().then(({ websiteContent, hotelConfig }) => {
      if (cancelled) return;
      applyFirestoreData(websiteContent, hotelConfig);
    });

    function applyFirestoreData(
      websiteContent: Record<string, unknown> | null,
      hotelConfig: Record<string, unknown> | null
    ) {
      const fb = buildFallback();

      const homepageRaw =
        websiteContent && typeof websiteContent.homepage === "object" && websiteContent.homepage !== null
          ? (websiteContent.homepage as Record<string, unknown>)
          : null;
      const aboutRaw =
        websiteContent && typeof websiteContent.about === "object" && websiteContent.about !== null
          ? (websiteContent.about as Record<string, unknown>)
          : null;
      const corporateRaw =
        websiteContent && typeof websiteContent.corporate === "object" && websiteContent.corporate !== null
          ? (websiteContent.corporate as Record<string, unknown>)
          : null;
      const rewardsRaw =
        websiteContent && typeof websiteContent.rewards === "object" && websiteContent.rewards !== null
          ? (websiteContent.rewards as Record<string, unknown>)
          : null;
      const brandingRaw =
        websiteContent && typeof websiteContent.branding === "object" && websiteContent.branding !== null
          ? (websiteContent.branding as Record<string, unknown>)
          : null;

      const rawAmenities = homepageRaw ? toContentItemArray(homepageRaw.amenities) : [];
      const rawServices = homepageRaw ? toContentItemArray(homepageRaw.services) : [];
      const rawPerks = corporateRaw ? toContentItemArray(corporateRaw.perks) : [];
      // Per the type-driven featured-types model: read the new
      // `featuredTypeValues` array. If a doc still carries the
      // old `featuredRoomIds` (pre-migration) and no new field,
      // we pass it through as-is; the page will treat unknown
      // entries as type values, which is fine — old entries that
      // match room type values (e.g. "executive") will be treated
      // as types, others will be skipped. AdminContext's
      // `mergeWebsiteContent` does the canonical migration on
      // save.
      const rawFeatured: string[] = Array.isArray(homepageRaw?.featuredTypeValues)
        ? (homepageRaw!.featuredTypeValues as unknown[]).filter((v): v is string => typeof v === "string")
        : Array.isArray(homepageRaw?.featuredRoomIds)
          ? (homepageRaw!.featuredRoomIds as unknown[]).filter((v): v is string => typeof v === "string")
          : [];

      const hc = (hotelConfig ?? {}) as Record<string, unknown>;
      const brandName = typeof hc.hotelName === "string" && hc.hotelName.length > 0 ? hc.hotelName : config.brandName;

      const pickString = (raw: Record<string, unknown> | null, key: string, fallback: string) =>
        typeof raw?.[key] === "string" && (raw[key] as string).length > 0
          ? (raw[key] as string)
          : fallback;

      const next: PublicSiteContent = {
        loading: false,
        homepage: {
          // Homepage hero eyebrow falls back to `config.tagline` when
          // the admin hasn't overridden it. The Settings → Branding
          // form exposes this field so the hotel owner can swap the
          // tagline without a redeploy.
          heroEyebrow: pickString(homepageRaw, "heroEyebrow", config.tagline),
          heroHeading: pickString(homepageRaw, "heroHeading", fb.homepage.heroHeading),
          heroSubtext: pickString(homepageRaw, "heroSubtext", fb.homepage.heroSubtext),
          heroPhotoUrl: pickString(homepageRaw, "heroPhotoUrl", fb.homepage.heroPhotoUrl),
          amenities: rawAmenities.length > 0 ? rawAmenities : fb.homepage.amenities,
          featuredTypeValues: rawFeatured.length > 0 ? rawFeatured : fb.homepage.featuredTypeValues,
          services: rawServices.length > 0 ? rawServices : fb.homepage.services,
          sparkRewards: homepageRaw ? buildSparkRewards(homepageRaw.sparkRewards) : fb.homepage.sparkRewards
        },
        about: {
          // About hero eyebrow + subtext fall back to "" when the
          // admin hasn't overridden them — the page renders its own
          // deploy-time hardcoded copy in that case. Reading from
          // the public site content hook (rather than a separate
          // `usePublicSiteContent` query) keeps the single-fetch
          // pattern the rest of the page uses.
          heroEyebrow: pickString(aboutRaw, "heroEyebrow", fb.about.heroEyebrow),
          heroHeading: pickString(aboutRaw, "heroHeading", fb.about.heroHeading),
          heroSubtext: pickString(aboutRaw, "heroSubtext", fb.about.heroSubtext),
          heroPhotoUrl: pickString(aboutRaw, "heroPhotoUrl", fb.about.heroPhotoUrl),
          missionStatement:
            (typeof hc.missionStatement === "string" && hc.missionStatement.length > 0
              ? hc.missionStatement
              : FALLBACK_ABOUT_MISSION),
          visionStatement:
            (typeof hc.visionStatement === "string" && hc.visionStatement.length > 0
              ? hc.visionStatement
              : FALLBACK_ABOUT_VISION(brandName)),
          hotelStory:
            (typeof hc.hotelStory === "string" && hc.hotelStory.length > 0
              ? hc.hotelStory
              : FALLBACK_ABOUT_STORY(brandName))
        },
        contact: {
          // Phase 11.8 PR 3 — the 6 hotel contact details live on
          // `settings/hotelConfig` (per `TYPES.md §HotelConfig`).
          // Each falls back to the deploy-time `hotel.config.ts`
          // value via `fb.contact.*` so the public site never
          // renders a blank phone / email / URL when the Firestore
          // doc is partial. The admin writes them from
          // Settings → Hotel Info.
          address: pickString(hc, "address", fb.contact.address),
          frontDeskPhone: pickString(hc, "frontDeskPhone", fb.contact.frontDeskPhone),
          supportEmail: pickString(hc, "supportEmail", fb.contact.supportEmail),
          dpoEmail: pickString(hc, "dpoEmail", fb.contact.dpoEmail),
          facebookUrl: pickString(hc, "facebookUrl", fb.contact.facebookUrl),
          instagramUrl: pickString(hc, "instagramUrl", fb.contact.instagramUrl)
        },
        corporate: {
          heroEyebrow: pickString(corporateRaw, "heroEyebrow", fb.corporate.heroEyebrow),
          heroHeading: pickString(corporateRaw, "heroHeading", fb.corporate.heroHeading),
          heroSubtext: pickString(corporateRaw, "heroSubtext", fb.corporate.heroSubtext),
          heroPhotoUrl: pickString(corporateRaw, "heroPhotoUrl", fb.corporate.heroPhotoUrl),
          perks: rawPerks.length > 0 ? rawPerks : fb.corporate.perks,
          roomsOverviewEyebrow: pickString(corporateRaw, "roomsOverviewEyebrow", fb.corporate.roomsOverviewEyebrow),
          roomsOverviewHeading: pickString(corporateRaw, "roomsOverviewHeading", fb.corporate.roomsOverviewHeading),
          roomsOverviewDescription: pickString(corporateRaw, "roomsOverviewDescription", fb.corporate.roomsOverviewDescription),
          retreatHeading: pickString(corporateRaw, "retreatHeading", fb.corporate.retreatHeading),
          retreatDescription: pickString(corporateRaw, "retreatDescription", fb.corporate.retreatDescription),
          retreatCtaLabel: pickString(corporateRaw, "retreatCtaLabel", fb.corporate.retreatCtaLabel)
        },
        rewards: {
          heroEyebrow: pickString(rewardsRaw, "heroEyebrow", fb.rewards.heroEyebrow),
          heroHeading: pickString(rewardsRaw, "heroHeading", fb.rewards.heroHeading),
          heroSubtext: pickString(rewardsRaw, "heroSubtext", fb.rewards.heroSubtext),
          heroPhotoUrl: pickString(rewardsRaw, "heroPhotoUrl", fb.rewards.heroPhotoUrl)
        },
        branding: {
          logoNavbar: pickString(brandingRaw, "logoNavbar", ""),
          logoNavbarOnDark: pickString(brandingRaw, "logoNavbarOnDark", ""),
          logoFooter: pickString(brandingRaw, "logoFooter", "")
        }
      };

      setContent(next);

      // Now that we know the real hero URL for the current page, tell
      // the prefetch module to swap the static-fallback preload tag
      // for the correct one (no-op if the URL hasn't changed).
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        if (path.startsWith("/about")) {
          swapHeroPreload(next.about.heroPhotoUrl);
        } else if (path.startsWith("/corporate")) {
          swapHeroPreload(next.corporate.heroPhotoUrl);
        } else if (path.startsWith("/rewards")) {
          swapHeroPreload(next.rewards.heroPhotoUrl);
        } else {
          swapHeroPreload(next.homepage.heroPhotoUrl);
        }
      }

      // Write the resolved shape to localStorage so the next
      // mount is instant. We strip `loading` (transient) and
      // write the full resolved content (with fallback URLs
      // applied) so the cached value is renderable as-is.
      const { loading: _loading, ...toCache } = next;
      void _loading;
      writeCache(PUBLIC_SITE_CONTENT_CACHE_KEY, toCache);
    }

    return () => {
      cancelled = true;
      unsubscribeBust();
    };
  }, []);

  return content;
}
