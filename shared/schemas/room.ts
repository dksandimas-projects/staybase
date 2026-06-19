import { z } from "zod";

// Form schema for the Create Room modal in the admin app.
// Per `plan/docs/FRONTEND.md §Form Validation`, Zod is the source
// of truth; the TypeScript type is derived via `z.infer`. Photos
// are intentionally NOT included here — the create modal captures
// the room identity + base configuration, and photos are added
// later in the existing edit drawer (per `plan/features/ROOM-MANAGEMENT.md`).

export const RoomStatusEnum = z.enum(["available", "occupied", "blocked"]);
export const HousekeepingStatusEnum = z.enum(["clean", "dirty", "in-progress"]);

export const CreateRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(80, "Display name is too long"),
  roomNumber: z
    .string()
    .trim()
    .min(1, "Room number is required")
    .max(20, "Room number is too long"),
  type: z
    .string()
    .trim()
    .min(1, "Room type is required")
    .max(40, "Room type is too long"),
  description: z
    .string()
    .trim()
    .max(1000, "Description is too long")
    .default(""),
  maxCapacity: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .int("Capacity must be a whole number")
    .min(1, "Capacity must be at least 1")
    .max(20, "Capacity is too high"),
  bedDefinition: z
    .string()
    .trim()
    .min(1, "Bed definition is required")
    .max(120, "Bed definition is too long"),
  pricePerNight: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .min(0, "Price cannot be negative"),
  weekendRate: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .min(0, "Weekend rate cannot be negative")
    .optional(),
  corporateRate: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .min(0, "Corporate rate cannot be negative")
    .optional(),
  status: RoomStatusEnum.default("available"),
  housekeepingStatus: HousekeepingStatusEnum.default("clean"),
  isActive: z.boolean().default(true),
  blockReason: z
    .string()
    .trim()
    .max(200, "Block reason is too long")
    .default(""),
  remarks: z
    .string()
    .trim()
    .max(1000, "Remarks are too long")
    .default("")
});

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

// Booking statuses that should block a room deletion. A room with
// any of these bookings cannot be deleted — staff must first cancel
// or check them out. (Per `plan/features/ROOM-MANAGEMENT.md §Delete`.)
export const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed",
  "checked-in"
] as const;

export type ActiveBookingStatus = (typeof ACTIVE_BOOKING_STATUSES)[number];
