import type { Room } from "@spark-inn/shared";
import { featuredRooms } from "./homepage";

// Static fallback rooms for the period before Firestore data loads.
// Per W3.6 + W3.7 — `plan/features/ROOM-MANAGEMENT.md §W3.6+W3.7`:
// photos, rates, max capacity, bed description, description, and
// amenities all live on the room TYPE. Each entry below only carries
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

export const rooms = [
  ...featuredRooms,
  room({
    id: "room-105",
    name: "Standard Twin",
    roomNumber: "105",
    type: "standard-twin",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  }),
  room({
    id: "room-102",
    name: "Single Room",
    roomNumber: "102",
    type: "single",
    isActive: true,
    status: "blocked",
    housekeepingStatus: "in-progress",
    blockReason: "Maintenance",
    remarks: ""
  })
];
