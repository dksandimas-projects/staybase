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
  { value: "single", label: "Single", shortLabel: "Single", imageUrls: [] },
  { value: "standard-double", label: "Standard Double", shortLabel: "Std Double", imageUrls: [] },
  { value: "standard-twin", label: "Standard Twin", shortLabel: "Std Twin", imageUrls: [] },
  { value: "executive", label: "Executive", shortLabel: "Executive", imageUrls: [] },
  { value: "family", label: "Family", shortLabel: "Family", imageUrls: [] }
] as const;

export type RoomTypeEntry = {
  value: string;
  label: string;
  shortLabel: string;
  imageUrls: string[];
};

export const MAX_ROOM_TYPE_PHOTOS = 10;
