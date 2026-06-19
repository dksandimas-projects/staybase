import type { Room } from "@spark-inn/shared";
import { featuredRooms } from "./homepage";

// Static fallback rooms for the period before Firestore data loads.
// `imageUrls` is intentionally omitted — photos live on the room type
// (`useRoomTypes` / `ROOM_TYPE_IMAGES`).
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
    description: "Twin-bed comfort for colleagues or friends who want a simple, tidy stay with all essentials close by.",
    maxCapacity: 2,
    bedDefinition: "2 single beds",
    pricePerNight: 2600,
    weekendRate: 2900,
    corporateRate: 2300,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
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
    description: "A compact private room for solo guests, short work stays, and travelers who value quiet consistency.",
    maxCapacity: 1,
    bedDefinition: "1 single bed",
    pricePerNight: 1800,
    weekendRate: 2100,
    corporateRate: 1600,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    isActive: true,
    status: "blocked",
    housekeepingStatus: "in-progress",
    blockReason: "Maintenance",
    remarks: ""
  })
];
