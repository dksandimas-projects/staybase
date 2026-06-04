import type { Room } from "@spark-inn/shared";
import { featuredRooms } from "./homepage";

function room(fields: Omit<Room, "createdAt" | "updatedAt">): Room {
  return {
    ...fields,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z")
  };
}

const twinImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBKLC9-qqoTLxtDsE0uClSV9QqlUUDoOtwBAoqUy2fD4cXzD13BM7pL_5rX1Ek9FfIpYkzlkp_AuNM1nx5sfRGFZHhWlTnrVPYenQomt2mF259WmRinpIHzjCyN9Y1VS5jThZ8G15eb68PIROugPebuJ-CuOAGhw_PE1-tRmAKJG4S-TIVpUNRcaloPwPbyvUtCIe4dy_VuBcrMI5tqOwUNiQD7ic7FUi08SvriGlU9Aqy5HwfzGb2CL9JZM7vd_htN5vA0BRNsqUQB";
const singleImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDtB2pY9pyA-nHcs0ODXwxWP--b1nfhZFJaBTYHwKm47pIe2HKLRd1EkTeXVpU_fbatxxxec-JWZ-9GahSvI5ISEbIVbFOQG2_3Qi1KWbATiZ6DCFV05FFNBm1KrQi2r6Us3EVHSFfRL4_kF3PR4-IgafYvrt0wMIN08MONiOJOia2LmghUtGRPxkTdTmk4ESSA_m3pHCsfQQ6mCuhhsoMoGtg-9NOzq41lb9fl3aqxjRzwQMgS74Vu9LL5KefrHaUmmjHzAuFDiWXQ";

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
    imageUrls: [twinImage],
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
    imageUrls: [singleImage],
    isActive: true,
    status: "blocked",
    housekeepingStatus: "in-progress",
    blockReason: "Maintenance",
    remarks: ""
  })
];
