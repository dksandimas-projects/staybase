import type { Room } from "@spark-inn/shared";

const roomImageOne =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBfjCo0RxeTYwZIMHRi7nG4GiJzWWSaFP6aDG7pKc1U8YkjM9IakMjV5fNeQFbNWyKCvMBKoM4q5RGBEOmXJailrnJnTXhzqrDu8fV8RlrSs2w_z0pxfmGCIRRhBt1Pp8HkSwJOSIqtEe0Yxcs8y913fU-vkG1qGWqDr757P8jjva2Yh8dXPH4jtrrKT6rkkm92BhP0C-DCv7QzBlabxrwPtL1_6ZCFzvo2HTe_F0LzkTdr22ANSc5QcNDpX2Gbuk-JB7aFWDlfBA_r";
const roomImageTwo =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBROWAtzx3r6P2DrCtCX6SlsOosqCQrjeEnzSElnjhzuzCFZkhFxYs2aDDbgsitFYQ79O_inFjWy49NEiOh3WVn5gfEvc0cH7W-lZbhVQRHMhB-BpDLxRlyxpfXX-fkhQa5Km4MOwELC8yhDzupzv0poZDqF_LBRnPfQqIrgWizPT-POlT-6jm8IH56VF-gjzY5NwJLXvmjUiFtGG-XXzuBMq0ocxQrFatxJQFXvYCtWV0HTsc0qO5vsANuSxNV5Hpc8JYN5cEye1sX";
const roomImageThree =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuA5OiUvWH_yNqmhSq4snEK7_e2x3VF_G_r88oWbUucSXveqcV96z6I3ZBt8MCotHH1A9xNFDGSpuYTQznp3-7Y-GbVUIFWhjcNMdKKWdJP67K_WSC_TYR4XEtnl2FqAlmxu8_XCz9_LoaiLHVx8eb1M23MAKWeDPCzQAdR1HeuwsvYoyPUaApOZBttpnVWIStzheAD14spp3xMEuKO_RCqJ0uN4EntkEaBC736Vr0BbEvlPOMToZQT61JNzOe4WWpAHNhztoFmrpRGa";
const twinImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBKLC9-qqoTLxtDsE0uClSV9QqlUUDoOtwBAoqUy2fD4cXzD13BM7pL_5rX1Ek9FfIpYkzlkp_AuNM1nx5sfRGFZHhWlTnrVPYenQomt2mF259WmRinpIHzjCyN9Y1VS5jThZ8G15eb68PIROugPebuJ-CuOAGhw_PE1-tRmAKJG4S-TIVpUNRcaloPwPbyvUtCIe4dy_VuBcrMI5tqOwUNiQD7ic7FUi08SvriGlU9Aqy5HwfzGb2CL9JZM7vd_htN5vA0BRNsqUQB";
const singleImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDtB2pY9pyA-nHcs0ODXwxWP--b1nfhZFJaBTYHwKm47pIe2HKLRd1EkTeXVpU_fbatxxxec-JWZ-9GahSvI5ISEbIVbFOQG2_3Qi1KWbATiZ6DCFV05FFNBm1KrQi2r6Us3EVHSFfRL4_kF3PR4-IgafYvrt0wMIN08MONiOJOia2LmghUtGRPxkTdTmk4ESSA_m3pHCsfQQ6mCuhhsoMoGtg-9NOzq41lb9fl3aqxjRzwQMgS74Vu9LL5KefrHaUmmjHzAuFDiWXQ";

export const homepageHeroImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCTef7Kgv1QtQkGMUF3IjkJC-VCn1qzPu4wpvFbsZfXP9IJv_dhrx4JJo34Kuxb5ka-hagWW7LvX18wbAck93GBqVBjEn24s5FzC7mAt28gar-1qQn34heG8ehz4jsBY1iBDf5G9vmLwEbivs1ATFikNbWpY6Gjd7_RerEeeiF0pEo1vNo_X_ZFlRPCy9mO_AMQf01x7s0a-pMAG15CWDWwHA_AFNAFp3UqpV-rcx8B6AZY0-2II8F4vAwYUzvd-52h1OJ_fKdE96h2";

// Per-room-type static fallback images. Consumed by
// `getRoomTypeImages(roomTypes, room.type)` when the live `useRoomTypes`
// hook has not yet returned a non-empty `imageUrls[]` for the type.
export const ROOM_TYPE_IMAGES: Record<string, string[]> = {
  executive: [roomImageTwo],
  "standard-double": [roomImageOne],
  family: [roomImageThree],
  "standard-twin": [twinImage],
  single: [singleImage]
};

// Static fallback rooms for the period before Firestore data loads.
// Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`: photos, rates,
// and max capacity live on the room TYPE. Each entry below only carries
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

export const featuredRooms = [
  room({
    id: "room-201",
    name: "Executive Queen",
    roomNumber: "201",
    type: "executive",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  }),
  room({
    id: "room-204",
    name: "Standard Double",
    roomNumber: "204",
    type: "standard-double",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  }),
  room({
    id: "room-301",
    name: "Family Room",
    roomNumber: "301",
    type: "family",
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: ""
  })
];

export const amenities = [
  {
    title: "Consistent comfort",
    description: "Quiet rooms, crisp linens, and the essentials guests expect every time."
  },
  {
    title: "Easy city access",
    description: "A practical Tagbilaran base for tours, meetings, errands, and onward travel."
  },
  {
    title: "Warm front desk care",
    description: "Helpful support for arrivals, local questions, and small travel details."
  }
];

export const services = [
  {
    title: "Tour Packages",
    description: "Ask our team for help arranging Bohol countryside tours, island plans, and local experiences."
  },
  {
    title: "Car Rentals",
    description: "Coordinate simple transportation support for business trips, family errands, or day tours."
  }
];

export const rewardPerks = [
  "Earn points on completed stays",
  "Member-only stay offers",
  "Request early check-in"
];
