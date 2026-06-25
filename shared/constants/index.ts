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

// Number of featured rooms displayed on the homepage. The guest app
// falls back to the first 3 active rooms when this list is empty.
export const MAX_FEATURED_ROOMS = 3;

// localStorage cache key + TTL for the public site content
// (`usePublicSiteContent`). Returning visitors get an instant
// render from the cache while Firestore validates in the
// background — no "fallback-image flash" while waiting for the
// custom upload to load. Bump the `:v1` suffix if the cached
// shape ever changes.
export const PUBLIC_SITE_CONTENT_CACHE_KEY = "publicSiteContent:v1";
export const PUBLIC_SITE_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

