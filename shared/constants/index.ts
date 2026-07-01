export const BOOKING_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed",
  "checked-in",
  "checked-out",
  "cancelled"
] as const;

export const BOOKING_SOURCES = ["online", "walk-in", "phone", "facebook", "corporate"] as const;

export const ROOM_STATUSES = ["available", "occupied", "blocked"] as const;

export const HOUSEKEEPING_STATUSES = ["clean", "dirty", "in-progress"] as const;

export const DEFAULT_ROOM_TYPES: readonly RoomTypeEntry[] = [
  { value: "single",          label: "Single",          shortLabel: "Single",      imageUrls: [], bedDefinition: "1 single bed",         description: "A compact private room for solo guests, short work stays, and travelers who value quiet consistency.", amenities: ["WiFi", "AC", "Work Desk", "Private Bath"], maxCapacity: 1, pricePerNight: 1800, weekendRate: 2100, corporateRate: 1600 },
  { value: "standard-double", label: "Standard Double", shortLabel: "Std Double",  imageUrls: [], bedDefinition: "1 double bed",          description: "Simple comfort for couples or business travelers who want an easy, consistent stay near the city center.", amenities: ["WiFi", "AC", "Work Desk", "Private Bath"], maxCapacity: 2, pricePerNight: 2400, weekendRate: 2700, corporateRate: 2200 },
  { value: "standard-twin",   label: "Standard Twin",   shortLabel: "Std Twin",    imageUrls: [], bedDefinition: "2 single beds",         description: "Twin-bed comfort for colleagues or friends who want a simple, tidy stay with all essentials close by.",     amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"], maxCapacity: 2, pricePerNight: 2600, weekendRate: 2900, corporateRate: 2300 },
  { value: "executive",       label: "Executive",       shortLabel: "Executive",   imageUrls: [], bedDefinition: "1 queen size bed",      description: "A warm, spacious retreat with premium bedding, soft lighting, and room to settle in after a day in Bohol.",     amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"], maxCapacity: 2, pricePerNight: 3200, weekendRate: 3600, corporateRate: 2800 },
  { value: "family",          label: "Family",          shortLabel: "Family",      imageUrls: [], bedDefinition: "2 double beds",         description: "Extra space for small families, with thoughtful essentials and a calm base for Bohol plans.",                   amenities: ["WiFi", "AC", "Mini Fridge", "Cable TV"], maxCapacity: 4, pricePerNight: 4200, weekendRate: 4600, corporateRate: 3900 }
];

export type RoomTypeEntry = {
  value: string;
  label: string;
  shortLabel: string;
  imageUrls: string[];
  // Per W3.6 + W3.7 — the room type owns the full room-level model
  // except for identity / operational fields. All rooms of a type
  // share the same:
  //   - bedDefinition: "1 queen + 1 single", "2 single beds", etc.
  //   - description: short marketing copy shown on the public rooms page
  //   - amenities: array of amenity labels
  //   - maxCapacity: max occupancy (canonical, used for guest filter)
  //   - pricePerNight / weekendRate / corporateRate: rate matrix
  //     edited in the Rates tab.
  // See `plan/features/SETTINGS.md §Room Types` for the full list of
  // editable fields and `plan/features/ROOM-MANAGEMENT.md` for the
  // per-room fields that remain.
  bedDefinition: string;
  description: string;
  amenities: string[];
  maxCapacity: number;
  pricePerNight: number;
  weekendRate: number;
  corporateRate: number;
};

export const MAX_ROOM_TYPE_PHOTOS = 10;

// Default perks shown on the public /corporate page (under the hero).
// Shared between the guest app (Firestore override → this fallback)
// and the admin app (seeded into `mergeWebsiteContent` when the
// settings doc has no `corporate.perks[]`). Each entry is editable
// from Settings → Website Content → Corporate page → Perks; the
// admin's editor preserves this shape (title, description, icon,
// isEnabled) via the shared `ListEditor` component.
export const DEFAULT_CORPORATE_PERKS: readonly ContentItem[] = [
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

// Icon names usable on the public site's amenities / services /
// perks / corporate-perks cards. The string key is what gets stored
// in Firestore; the admin app renders a dropdown picker, the guest
// app maps each name to a `lucide-react` component via the per-page
// `resolveIcon` helper. Names are kebab-case strings so they survive
// JSON round-trips and are easy to type in tests.
export const KNOWN_CONTENT_ICONS = [
  "bed",
  "map",
  "pin",
  "users",
  "people",
  "sparkles",
  "star",
  "wifi",
  "coffee",
  "car",
  "palmtree",
  "gift",
  "tag",
  "clock",
  "shield",
  "briefcase",
  "coins",
  "percent",
  "calendar",
  "help",
  "network",
  "money",
  "support",
  "group",
  "date",
  "flexible",
  "security"
] as const;

export type ContentIconName = (typeof KNOWN_CONTENT_ICONS)[number];

// Single source of truth for the list-shaped content item used on
// the public site (homepage amenities / services, Spark Rewards
// perks, corporate perks). Shared between the admin app's
// `ListEditor` and the guest app's per-page renderers. `icon` and
// `isEnabled` are optional on the data side because legacy Firestore
// docs may not have written them.
export interface ContentItem {
  title: string;
  description: string;
  icon?: string;
  isEnabled?: boolean;
}

// Default copy for the entire /corporate page. Single source of
// truth shared by:
//   - the guest app: used as the fallback chain in
//     `usePublicSiteContent.buildFallback` (Firestore override → this
//     constant → hardcoded UI string) and as the `|| "..."` fallback
//     inside `CorporateStaysPage` for any field the admin hasn't
//     overridden yet.
//   - the admin app: Settings → Branding (hero block) and Settings →
//     Website Content → Corporate page (rooms overview + retreat CTA)
//     hydrate the editor state from this constant when the Firestore
//     value is empty, so the admin sees the current text in the
//     inputs instead of blank fields.
//   - the one-time Firestore backfill in `AdminContext`: writes these
//     values to any empty `corporate.*` TEXT field the first time an
//     admin loads the app, so the guest app's empty-string fallback
//     never trips for a property that has had an admin open the
//     dashboard.
//
// Mirror values: these strings must stay byte-identical with the
// hardcoded copy previously inlined in `CorporateStaysPage.tsx` and
// the `FALLBACK_CORPORATE_HERO_*` constants in
// `usePublicSiteContent.ts`.
//
// `hero.photoUrl` is preserved here as a reference value (it matches
// the `corporateHeroImage` static fallback in
// `guest-app/src/data/homepage.ts`) but is NOT written to Firestore
// by the one-time backfill. Persisting it would pin the page to that
// URL and undo the admin's Reset action on the next dashboard load;
// the guest app's `pickString` already provides the static fallback
// when `corporate.heroPhotoUrl` is empty.
export const DEFAULT_CORPORATE_PAGE_CONTENT = {
  hero: {
    eyebrow: "Curated hospitality for executive comfort",
    heading: "Elevated Stays for Modern Business",
    subtext:
      "Redefining business travel through quiet efficiency, ergonomic spaces, and the warm hospitality of Bohol.",
    photoUrl:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80"
  },
  roomsOverview: {
    eyebrow: "Accommodation Types",
    heading: "Rooms Built for Productivity & Rest",
    description:
      "Explore our range of boutique rooms. All rooms feature workspaces, high-speed Wi-Fi, air conditioning, and premium linens. No prices are shown below; corporate rates are negotiated based on contract terms."
  },
  retreat: {
    heading: "Partner with us for your next team retreat.",
    description:
      "Experience the perfect blend of Bohol's natural charm and the high-efficiency environment your business demands. Fully catered planning options are available.",
    ctaLabel: "Get in Touch"
  }
} as const;

// Number of featured types displayed on the homepage. The guest
// app resolves each type to its first active room and renders one
// card per type. When the list is empty, the guest app falls back
// to the first MAX_FEATURED_TYPES distinct types that have at
// least one active room (not raw room IDs — see the homepage
// spec for why the type-driven model is correct).
//
// Migration: this constant used to be called `MAX_FEATURED_ROOMS`
// and the homepage used `featuredRoomIds: string[]` (a list of
// physical room doc IDs). That model was wrong because every
// rendered card field (image, price, bed, description, amenities)
// comes from the room TYPE, not the individual room — picking
// "Room 201" vs "Room 202" (both `executive`) rendered
// identically. The old constant is kept as a deprecated alias
// for the one-time migration in `AdminContext.mergeWebsiteContent`.
export const MAX_FEATURED_TYPES = 3;
export const MAX_FEATURED_ROOMS = MAX_FEATURED_TYPES;

// Per `plan/features/SETTINGS.md §Payment Methods`: the canonical
// list of booking payment method keys the platform supports out
// of the box. Single source of truth shared between the admin
// UI's persistent Pesonet callout, the add/edit modal's inline
// warning, and (optionally) guest-side helpers. The schema itself
// stays open (`method: string`) so the admin can add custom
// methods — this list is policy, not enforcement.
export const SUPPORTED_PAYMENT_METHODS = [
  "gcash",
  "maya",
  "bank",
  "paypal",
  "pay-at-hotel"
] as const;

export type SupportedPaymentMethod = (typeof SUPPORTED_PAYMENT_METHODS)[number];

// Methods the admin UI must surface a warning for. Pesonet is a
// batch-based bank transfer system with cut-off windows and T+1
// settlement — incompatible with our instant-reservation
// confirmation flow. The schema is not hard-blocked so future
// business changes don't require a code deploy; the friction is
// a two-step confirm, not a server-side rejection.
export const UNSUPPORTED_PAYMENT_METHODS = ["pesonet"] as const;

export type UnsupportedPaymentMethod = (typeof UNSUPPORTED_PAYMENT_METHODS)[number];

// Maximum accepted QR image size in bytes (2 MB pre-compression).
// QR PNGs are usually < 100 KB; this cap catches the "I uploaded
// my entire photo roll" case before we burn Storage bandwidth.
// Enforced in the admin Payment Methods tab's file input.
export const MAX_PAYMENT_METHOD_QR_BYTES = 2 * 1024 * 1024;

// localStorage cache key + TTL for the public site content
// (`usePublicSiteContent`). Returning visitors get an instant
// render from the cache while Firestore validates in the
// background — no "fallback-image flash" while waiting for the
// custom upload to load. Bump the `:vN` suffix if the cached
// shape ever changes — a v1 cache will fail type-shape
// validation against the v2 schema and be ignored.
//
// v2 — `homepage.featuredRoomIds` renamed to
// `homepage.featuredTypeValues`. Old cached entries are now
// shape-incompatible and fall through to the empty state.
export const PUBLIC_SITE_CONTENT_CACHE_KEY = "publicSiteContent:v2";
export const PUBLIC_SITE_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

