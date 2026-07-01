import type { Room } from "@spark-inn/shared";
import config from "@config";

// LQIP (low-quality image placeholder) for the hero photos. The
// `HeroImage` component renders this as a heavily-blurred background
// underneath the real image, so the hero appears to "develop" into
// focus rather than pop in. We use a brand-tinted SVG gradient
// instead of a tiny JPEG so:
//   - no per-image build step is required
//   - white-label clients automatically get a placeholder that
//     matches their brand palette
//   - the data URL is ~200 bytes, not a few-KB JPEG
// Each variant is the same warm vertical gradient that mirrors the
// kind of light/sky-to-ground falloff a real hotel hero photo has.
function buildHeroLqip(top: string, bottom: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="16" height="9" fill="url(%23g)"/></svg>`;
  const escaped = svg.replace(/#/g, "%23");
  return `data:image/svg+xml;utf8,${escaped}`;
}

// Default LQIP palette: warm sky → earth. Used when the page does
// not pass a custom placeholder. Tied to the brand tokens so a
// white-label client sees its own primary tint behind the photo.
export const DEFAULT_HERO_LQIP = buildHeroLqip(
  lighten(config.colors.primary, 0.55),
  config.colors.sectionBg
);

// Per-page LQIPs (slight palette shifts so each hero has its own
// "mood" during the brief moment between the placeholder and the
// real image).
const heroLqipHome = buildHeroLqip(
  lighten(config.colors.primary, 0.6),
  config.colors.sectionBg
);
const heroLqipAbout = buildHeroLqip("#f3e7d3", config.colors.sectionBg);
const heroLqipCorporate = buildHeroLqip("#dfe5ec", config.colors.sectionBg);
const heroLqipRewards = buildHeroLqip(
  lighten(config.colors.primary, 0.5),
  config.colors.sectionBg
);

export const HOMEPAGE_HERO_LQIP = heroLqipHome;
export const ABOUT_HERO_LQIP = heroLqipAbout;
export const CORPORATE_HERO_LQIP = heroLqipCorporate;
export const REWARDS_HERO_LQIP = heroLqipRewards;

// Lighten a hex color toward white by `amount` (0..1). Used to build
// the LQIP gradient stops. Not exported — internal to this file.
function lighten(hex: string, amount: number): string {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  const blend = (channel: number) =>
    Math.round(channel + (255 - channel) * amount);
  const out = (n: number) => n.toString(16).padStart(2, "0");
  return `#${out(blend(r))}${out(blend(g))}${out(blend(b))}`;
}

export const homepageHeroImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCTef7Kgv1QtQkGMUF3IjkJC-VCn1qzPu4wpvFbsZfXP9IJv_dhrx4JJo34Kuxb5ka-hagWW7LvX18wbAck93GBqVBjEn24s5FzC7mAt28gar-1qQn34heG8ehz4jsBY1iBDf5G9vmLwEbivs1ATFikNbWpY6Gjd7_RerEeeiF0pEo1vNo_X_ZFlRPCy9mO_AMQf01x7s0a-pMAG15CWDWwHA_AFNAFp3UqpV-rcx8B6AZY0-2II8F4vAwYUzvd-52h1OJ_fKdE96h2";

// Per-page hero fallbacks. Each is read by `usePublicSiteContent` when
// the corresponding `settings/websiteContent.<section>.heroPhotoUrl` is
// empty (i.e. the admin has not uploaded a custom image). Promoting
// these from inline string literals in each page keeps a single source
// of truth and matches the existing `homepageHeroImage` pattern.
export const aboutHeroImage =
  "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&q=80&w=1600&h=600";
export const corporateHeroImage =
  "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80";
export const rewardsHeroImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDxE3ob-vSO4zxT_VMu0OviqdIAMTOtgsJXzWeddVJ-6-QmLSHHkERJKmN_zfFFeGvMrFhzST6Xoc-MNtubwhDrYU3ZjBFSjACtuAwnlBaH4z6Ts-UB0kYlC38ol_42OAWXX2iUGuPhL2ZSvUac1bc6j0zvNGyAyCNMnyrg9X2dwyDXafz7n_EIfEX_xAI6S2D_XhfdiedtLyzdH-SxVWzm25SwLm9ovUul16TnLGbrr9fj2Jmezvw2N3x4T49eU2RDAchvC4pc-2UY";

// Per-page hero text fallbacks. The admin can override any of these
// from Settings → Branding; the constants below are the values that
// were previously hardcoded in each page component.
export const aboutHeroHeading = "about us";
export const corporateHeroEyebrow = "Curated hospitality for executive comfort";
export const rewardsHeroEyebrowSuffix = "Loyalty Program"; // used as "{config.rewardsName} {suffix}"
export const rewardsHeroHeading = "Earn Every Stay";
export const rewardsHeroSubtext =
  "Join Spark Rewards and unlock a world of exclusive benefits and heartfelt hospitality. Experience the pinnacle of boutique comfort with personalized rewards tailored just for you.";

// Static fallback rooms for the period before Firestore data loads.
// Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`: photos, rates,
// and max capacity live on the room TYPE. Each entry below only carries
// identity + display fields; the consumer joins `DEFAULT_ROOM_TYPES`
// (or the live `useRoomTypes` hook) for everything else.
type RoomFields = Omit<Room, "createdAt" | "updatedAt">;

function room(fields: RoomFields): Room {
  return {
    ...fields,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z")
  };
}

export const featuredRooms = [
  room({
    id: "room-201",
    name: "Executive Queen",
    roomNumber: "201",
    type: "executive",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  }),
  room({
    id: "room-204",
    name: "Standard Double",
    roomNumber: "204",
    type: "standard-double",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  }),
  room({
    id: "room-301",
    name: "Family Room",
    roomNumber: "301",
    type: "family",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  })
];

export const amenities = [
  {
    title: "Consistent comfort",
    description: "Quiet rooms, crisp linens, and the essentials guests expect every time."
  },
  {
    title: "Easy city access",
    description: "A practical Tagbilaran base for tours, meetings, errands, and onward travel."
  },
  {
    title: "Warm front desk care",
    description: "Helpful support for arrivals, local questions, and small travel details."
  }
];

export const services = [
  {
    title: "Tour Packages",
    description: "Ask our team for help arranging Bohol countryside tours, island plans, and local experiences."
  },
  {
    title: "Car Rentals",
    description: "Coordinate simple transportation support for business trips, family errands, or day tours."
  }
];

export const rewardPerks = [
  "Earn points on completed stays",
  "Member-only stay offers",
  "Request early check-in"
];
