import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import config from "@config";
import { homepageHeroImage, amenities as fallbackAmenities, services as fallbackServices, rewardPerks as fallbackRewardPerks } from "../data/homepage";

export interface ContentItem {
  title: string;
  description: string;
  icon?: string;
  isEnabled?: boolean;
}

export interface SparkRewardsPromo {
  heading: string;
  description: string;
  perks: ContentItem[];
  isEnabled: boolean;
}

export interface PublicHomepageContent {
  heroHeading: string;
  heroSubtext: string;
  heroPhotoUrl: string;
  amenities: ContentItem[];
  featuredRoomIds: string[];
  services: ContentItem[];
  sparkRewards: SparkRewardsPromo;
}

export interface PublicAboutContent {
  heroPhotoUrl: string;
  missionStatement: string;
  visionStatement: string;
  hotelStory: string;
}

export interface PublicCorporateContent {
  heroHeading: string;
  heroSubtext: string;
  heroPhotoUrl: string;
  perks: ContentItem[];
}

export interface PublicSiteContent {
  loading: boolean;
  homepage: PublicHomepageContent;
  about: PublicAboutContent;
  corporate: PublicCorporateContent;
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
const FALLBACK_CORPORATE_HERO_HEADING = "Elevated Stays for Modern Business";
const FALLBACK_CORPORATE_HERO_SUBTEXT =
  "Redefining business travel through quiet efficiency, ergonomic spaces, and the warm hospitality of Bohol.";
const FALLBACK_ABOUT_HERO =
  "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&q=80&w=1600&h=600";
const FALLBACK_CORPORATE_HERO =
  "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80";
const FALLBACK_ABOUT_MISSION =
  "To deliver peaceful, consistent stays shaped by genuine, intentional hospitality. We believe that hospitality is not merely a service, but a philosophy of care where every detail is deliberate and every guest feels deeply valued.";
const FALLBACK_ABOUT_VISION = (brand: string) =>
  `To establish ${brand} as the gold standard of boutique lodging in Bohol, recognized for providing curated sanctuaries where travelers find ultimate comfort, reliable modern amenities, and a deep connection to island tranquility.`;
const FALLBACK_ABOUT_STORY = (brand: string) =>
  `Founded in the heart of Tagbilaran City, Bohol, ${brand} was born out of a desire to redefine the boutique hotel experience. We observed that while travelers appreciated the unique characters of boutique stays, they often missed the reliability and consistency of global chains. We set out to bridge this gap, creating a sanctuary where style meets structure, and comfort is guaranteed.\n\nOur location was chosen with care—providing our guests with a peaceful retreat that is simultaneously connected to the rich historical landmarks, business districts, and natural wonders of Bohol. From the sandy beaches of Panglao to the famous Chocolate Hills, ${brand} serves as the perfect home base for both leisure explorers and corporate stay travelers.\n\nEvery element of ${brand} is curated. Our rooms are engineered for quiet comfort, featuring premium soundproofing, custom orthopedic beds, and optimized layouts. We combine these physical comforts with a service team that is trained to anticipate guest needs, offering a warm and authentic Filipino welcome that feels like family.\n\nAs we continue to grow and welcome guests from around the world, our promise remains steadfast: to provide peaceful, consistent stays shaped by genuine, intentional hospitality. We invite you to experience the spark that makes our hospitality warm and our lodging exceptional.`;

const FALLBACK_CORPORATE_PERKS: ContentItem[] = [
  {
    title: "Negotiated Rates",
    description:
      "Unlock exclusive fixed-rate packages tailored to your company's annual travel volume. Control and predict your hospitality budget with ease.",
    icon: "coins",
    isEnabled: true
  },
  {
    title: "Group Bookings",
    description:
      "Coordinated logistics for team building retreats, board meetings, and product launches. Keep your organization unified and fully refreshed.",
    icon: "users",
    isEnabled: true
  },
  {
    title: "Dedicated Support",
    description:
      "A personal account manager handles reservations, customized invoices, and check-in assistance, giving your team peace of mind.",
    icon: "briefcase",
    isEnabled: true
  },
  {
    title: "High-Speed Wi-Fi",
    description:
      "Dedicated high-bandwidth networks are active throughout our property. Perform remote work, host video calls, and stay in touch without delays.",
    icon: "wifi",
    isEnabled: true
  },
  {
    title: "Premium Security",
    description:
      "Enjoy a peaceful, secure stay with 24/7 staff, encrypted access locks, and strict privacy protocols for high-profile business visitors.",
    icon: "shield",
    isEnabled: true
  },
  {
    title: "Flexible Bookings",
    description:
      "Business plans change. Corporate agreements enjoy reduced cancellation fees, priority rescheduling, and same-day room re-allocations.",
    icon: "calendar",
    isEnabled: true
  }
];

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
  return {
    loading: true,
    homepage: {
      heroHeading: FALLBACK_HERO_HEADING,
      heroSubtext: FALLBACK_HERO_SUBTEXT,
      heroPhotoUrl: homepageHeroImage,
      amenities: fallbackAmenities.map((entry) => ({
        title: entry.title,
        description: entry.description,
        icon: "",
        isEnabled: true
      })),
      featuredRoomIds: ["room-201", "room-204", "room-301"],
      services: fallbackServices.map((entry) => ({
        title: entry.title,
        description: entry.description,
        icon: "",
        isEnabled: true
      })),
      sparkRewards: FALLBACK_SPARK_REWARDS
    },
    about: {
      heroPhotoUrl: FALLBACK_ABOUT_HERO,
      missionStatement: FALLBACK_ABOUT_MISSION,
      visionStatement: FALLBACK_ABOUT_VISION(config.brandName),
      hotelStory: FALLBACK_ABOUT_STORY(config.brandName)
    },
    corporate: {
      heroHeading: FALLBACK_CORPORATE_HERO_HEADING,
      heroSubtext: FALLBACK_CORPORATE_HERO_SUBTEXT,
      heroPhotoUrl: FALLBACK_CORPORATE_HERO,
      perks: FALLBACK_CORPORATE_PERKS
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

export function usePublicSiteContent(): PublicSiteContent {
  const [content, setContent] = useState<PublicSiteContent>(() => {
    const fb = buildFallback();
    return { ...fb, loading: true };
  });

  useEffect(() => {
    let cancelled = false;
    loadFromFirestore().then(({ websiteContent, hotelConfig }) => {
      if (cancelled) return;
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

      const rawAmenities = homepageRaw ? toContentItemArray(homepageRaw.amenities) : [];
      const rawServices = homepageRaw ? toContentItemArray(homepageRaw.services) : [];
      const rawPerks = corporateRaw ? toContentItemArray(corporateRaw.perks) : [];
      const rawFeatured = Array.isArray(homepageRaw?.featuredRoomIds)
        ? (homepageRaw!.featuredRoomIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];

      const hc = (hotelConfig ?? {}) as Record<string, unknown>;
      const brandName = typeof hc.hotelName === "string" && hc.hotelName.length > 0 ? hc.hotelName : config.brandName;

      setContent({
        loading: false,
        homepage: {
          heroHeading:
            (typeof homepageRaw?.heroHeading === "string" && homepageRaw.heroHeading.length > 0
              ? homepageRaw.heroHeading
              : fb.homepage.heroHeading),
          heroSubtext:
            (typeof homepageRaw?.heroSubtext === "string" && homepageRaw.heroSubtext.length > 0
              ? homepageRaw.heroSubtext
              : fb.homepage.heroSubtext),
          heroPhotoUrl:
            (typeof homepageRaw?.heroPhotoUrl === "string" && homepageRaw.heroPhotoUrl.length > 0
              ? homepageRaw.heroPhotoUrl
              : fb.homepage.heroPhotoUrl),
          amenities: rawAmenities.length > 0 ? rawAmenities : fb.homepage.amenities,
          featuredRoomIds: rawFeatured.length > 0 ? rawFeatured : fb.homepage.featuredRoomIds,
          services: rawServices.length > 0 ? rawServices : fb.homepage.services,
          sparkRewards: homepageRaw ? buildSparkRewards(homepageRaw.sparkRewards) : fb.homepage.sparkRewards
        },
        about: {
          heroPhotoUrl:
            (typeof aboutRaw?.heroPhotoUrl === "string" && aboutRaw.heroPhotoUrl.length > 0
              ? aboutRaw.heroPhotoUrl
              : fb.about.heroPhotoUrl),
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
        corporate: {
          heroHeading:
            (typeof corporateRaw?.heroHeading === "string" && corporateRaw.heroHeading.length > 0
              ? corporateRaw.heroHeading
              : fb.corporate.heroHeading),
          heroSubtext:
            (typeof corporateRaw?.heroSubtext === "string" && corporateRaw.heroSubtext.length > 0
              ? corporateRaw.heroSubtext
              : fb.corporate.heroSubtext),
          heroPhotoUrl:
            (typeof corporateRaw?.heroPhotoUrl === "string" && corporateRaw.heroPhotoUrl.length > 0
              ? corporateRaw.heroPhotoUrl
              : fb.corporate.heroPhotoUrl),
          perks: rawPerks.length > 0 ? rawPerks : fb.corporate.perks
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return content;
}
