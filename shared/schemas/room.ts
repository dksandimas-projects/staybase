import { z } from "zod";

// Form schema for the Create Room modal in the admin app.
// Per `plan/docs/FRONTEND.md §Form Validation`, Zod is the source
// of truth; the TypeScript type is derived via `z.infer`.
//
// Photos are NOT captured here. Room images live on the room type
// (per `shared/constants → RoomTypeEntry.imageUrls`) and are managed
// from Settings → Room Types. The create flow only captures the
// room identity + base configuration.

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
  bedDefinition: z
    .string()
    .trim()
    .min(1, "Bed definition is required")
    .max(120, "Bed definition is too long"),
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
