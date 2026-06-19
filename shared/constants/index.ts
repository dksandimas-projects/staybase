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
  { value: "single",          label: "Single",          shortLabel: "Single",      imageUrls: [], maxCapacity: 1, pricePerNight: 1800, weekendRate: 2100, corporateRate: 1600 },
  { value: "standard-double", label: "Standard Double", shortLabel: "Std Double",  imageUrls: [], maxCapacity: 2, pricePerNight: 2400, weekendRate: 2700, corporateRate: 2200 },
  { value: "standard-twin",   label: "Standard Twin",   shortLabel: "Std Twin",    imageUrls: [], maxCapacity: 2, pricePerNight: 2600, weekendRate: 2900, corporateRate: 2300 },
  { value: "executive",       label: "Executive",       shortLabel: "Executive",   imageUrls: [], maxCapacity: 2, pricePerNight: 3200, weekendRate: 3600, corporateRate: 2800 },
  { value: "family",          label: "Family",          shortLabel: "Family",      imageUrls: [], maxCapacity: 4, pricePerNight: 4200, weekendRate: 4600, corporateRate: 3900 }
];

export type RoomTypeEntry = {
  value: string;
  label: string;
  shortLabel: string;
  imageUrls: string[];
  // Per W3.6 / `plan/features/RATE-MANAGEMENT.md §W3.6`:
  // the room type owns the pricing + capacity model. All rooms of a
  // type share the same max occupancy and the same rate matrix
  // (base / weekend / corporate). The Rates tab is the canonical
  // edit surface; the Rooms tab no longer carries these fields.
  maxCapacity: number;
  pricePerNight: number;
  weekendRate: number;
  corporateRate: number;
};

export const MAX_ROOM_TYPE_PHOTOS = 10;
