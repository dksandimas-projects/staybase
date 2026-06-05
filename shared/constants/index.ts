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

export const DEFAULT_ROOM_TYPES = [
  { value: "single", label: "Single", shortLabel: "Single" },
  { value: "standard-double", label: "Standard Double", shortLabel: "Std Double" },
  { value: "standard-twin", label: "Standard Twin", shortLabel: "Std Twin" },
  { value: "executive", label: "Executive", shortLabel: "Executive" },
  { value: "family", label: "Family", shortLabel: "Family" }
] as const;

export type RoomTypeEntry = { value: string; label: string; shortLabel: string };
