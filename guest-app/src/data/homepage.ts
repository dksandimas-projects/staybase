import type { Room } from "@spark-inn/shared";

const roomImageOne =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBfjCo0RxeTYwZIMHRi7nG4GiJzWWSaFP6aDG7pKc1U8YkjM9IakMjV5fNeQFbNWyKCvMBKoM4q5RGBEOmXJailrnJnTXhzqrDu8fV8RlrSs2w_z0pxfmGCIRRhBt1Pp8HkSwJOSIqtEe0Yxcs8y913fU-vkG1qGWqDr757P8jjva2Yh8dXPH4jtrrKT6rkkm92BhP0C-DCv7QzBlabxrwPtL1_6ZCFzvo2HTe_F0LzkTdr22ANSc5QcNDpX2Gbuk-JB7aFWDlfBA_r";
const roomImageTwo =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBROWAtzx3r6P2DrCtCX6SlsOosqCQrjeEnzSElnjhzuzCFZkhFxYs2aDDbgsitFYQ79O_inFjWy49NEiOh3WVn5gfEvc0cH7W-lZbhVQRHMhB-BpDLxRlyxpfXX-fkhQa5Km4MOwELC8yhDzupzv0poZDqF_LBRnPfQqIrgWizPT-POlT-6jm8IH56VF-gjzY5NwJLXvmjUiFtGG-XXzuBMq0ocxQrFatxJQFXvYCtWV0HTsc0qO5vsANuSxNV5Hpc8JYN5cEye1sX";
const roomImageThree =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuA5OiUvWH_yNqmhSq4snEK7_e2x3VF_G_r88oWbUucSXveqcV96z6I3ZBt8MCotHH1A9xNFDGSpuYTQznp3-7Y-GbVUIFWhjcNMdKKWdJP67K_WSC_TYR4XEtnl2FqAlmxu8_XCz9_LoaiLHVx8eb1M23MAKWeDPCzQAdR1HeuwsvYoyPUaApOZBttpnVWIStzheAD14spp3xMEuKO_RCqJ0uN4EntkEaBC736Vr0BbEvlPOMToZQT61JNzOe4WWpAHNhztoFmrpRGa";

function room(fields: Omit<Room, "createdAt" | "updatedAt">): Room {
  return {
    ...fields,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z")
  };
}

export const homepageHeroImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCTef7Kgv1QtQkGMUF3IjkJC-VCn1qzPu4wpvFbsZfXP9IJv_dhrx4JJo34Kuxb5ka-hagWW7LvX18wbAck93GBqVBjEn24s5FzC7mAt28gar-1qQn34heG8ehz4jsBY1iBDf5G9vmLwEbivs1ATFikNbWpY6Gjd7_RerEeeiF0pEo1vNo_X_ZFlRPCy9mO_AMQf01x7s0a-pMAG15CWDWwHA_AFNAFp3UqpV-rcx8B6AZY0-2II8F4vAwYUzvd-52h1OJ_fKdE96h2";

export const featuredRooms = [
  room({
    id: "room-201",
    name: "Executive Queen",
    roomNumber: "201",
    type: "executive",
    description: "A warm, spacious retreat with premium bedding, soft lighting, and room to settle in after a day in Bohol.",
    maxCapacity: 2,
    bedDefinition: "1 queen size bed",
    pricePerNight: 3200,
    weekendRate: 3600,
    corporateRate: 2800,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
    imageUrls: [roomImageTwo],
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
    description: "Simple comfort for couples or business travelers who want an easy, consistent stay near the city center.",
    maxCapacity: 2,
    bedDefinition: "1 double bed",
    pricePerNight: 2400,
    weekendRate: 2700,
    corporateRate: 2200,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    imageUrls: [roomImageOne],
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
    description: "Extra space for small families, with thoughtful essentials and a calm base for Bohol plans.",
    maxCapacity: 4,
    bedDefinition: "2 double beds",
    pricePerNight: 4200,
    weekendRate: 4600,
    corporateRate: 3900,
    amenities: ["WiFi", "AC", "Mini Fridge", "Cable TV"],
    imageUrls: [roomImageThree],
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
  },
  {
    title: "Simple online booking",
    description: "Choose dates, pick a room, and review your stay in a few clear steps."
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
