/**
 * Firestore Seed Script
 * Seeds: settings/hotelConfig, settings/websiteContent, settings/rewardsConfig,
 *        settings/storeConfig, settings/breakfastConfig, rooms collection
 *
 * Run: npx tsx scripts/seed-firestore.ts
 * Requires: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in guest-app/.env
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config as dotenv } from "dotenv";

// Load env from guest-app/.env
dotenv({ path: resolve(process.cwd(), "guest-app/.env") });

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error("❌ Missing Firebase Admin env vars. Check guest-app/.env");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const now = Timestamp.now();

async function setDoc(collection: string, docId: string, data: object) {
  await db.collection(collection).doc(docId).set(data, { merge: false });
  console.log(`  ✔ ${collection}/${docId}`);
}

// ─── Settings: hotelConfig ────────────────────────────────────────────────────

async function seedHotelConfig() {
  console.log("\n📋 Seeding settings/hotelConfig...");
  await setDoc("settings", "hotelConfig", {
    hotelName: "spark inn",
    legalName: "Spark Inn Hotel Corp",
    tagline: "Where comfort is felt, care is intentional, and every stay is consistent.",
    address: {
      street: "J. Borja St",
      city: "Tagbilaran City",
      region: "Bohol",
      postalCode: "6300",
    },
    contactEmail: "sparkinn.dev@gmail.com",
    contactPhone: "+63-38-000-0000",
    facebookUrl: "",
    instagramUrl: "",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    missionStatement:
      "To provide consistent, welcoming stays that make every guest feel cared for.",
    visionStatement:
      "To be Bohol's most trusted boutique hotel for both leisure and business travelers.",
    hotelStory:
      "Spark Inn was built with one idea in mind — that great hospitality doesn't need to be loud. Nestled in the heart of Tagbilaran City, we offer a calm, consistent base for every kind of traveler.",
    paymentMethods: [
      {
        method: "gcash",
        label: "GCash",
        accountName: "Spark Inn Hotel Corp",
        accountNumber: "0917-000-0000",
        qrUrl: "",
        isEnabled: true,
      },
      {
        method: "paypal",
        label: "PayPal",
        accountName: "sparkinn.dev@gmail.com",
        accountNumber: "",
        qrUrl: "",
        isEnabled: true,
      },
    ],
    payAtHotelEnabled: true,
    intercomQuickRequests: [
      "Extra towels",
      "Extra pillows",
      "Room cleaning",
      "Wake-up call",
      "Water refill",
      "Late checkout request",
    ],
    notificationSoundUrl: "",
    updatedAt: now,
  });
}

// ─── Settings: websiteContent ─────────────────────────────────────────────────

async function seedWebsiteContent() {
  console.log("\n🌐 Seeding settings/websiteContent...");
  await setDoc("settings", "websiteContent", {
    homepage: {
      heroHeading: "Where comfort meets intentional care",
      heroSubheading:
        "A boutique stay in the heart of Tagbilaran City — for leisure, business, and everything in between.",
      heroImageUrl: "",
      featuredRoomIds: ["room-201", "room-204", "room-301"],
      amenities: [
        {
          title: "Consistent comfort",
          description: "Quiet rooms, crisp linens, and the essentials guests expect every time.",
          icon: "bed",
        },
        {
          title: "Easy city access",
          description:
            "A practical Tagbilaran base for tours, meetings, errands, and onward travel.",
          icon: "map-pin",
        },
        {
          title: "Warm front desk care",
          description:
            "Helpful support for arrivals, local questions, and small travel details.",
          icon: "heart",
        },
        {
          title: "Simple online booking",
          description:
            "Choose dates, pick a room, and review your stay in a few clear steps.",
          icon: "calendar",
        },
      ],
      services: [
        {
          title: "Tour Packages",
          description:
            "Ask our team for help arranging Bohol countryside tours, island plans, and local experiences.",
          icon: "compass",
          isEnabled: true,
        },
        {
          title: "Car Rentals",
          description:
            "Coordinate simple transportation support for business trips, family errands, or day tours.",
          icon: "car",
          isEnabled: true,
        },
      ],
      sparkRewards: {
        heading: "Join Spark Rewards",
        description:
          "Earn points on every stay and unlock member-only perks designed for guests who keep coming back.",
        isEnabled: true,
      },
    },
    about: {
      heroPhotoUrl: "",
    },
    corporate: {
      heroHeading: "Corporate Stays, Made Simple",
      heroSubheading:
        "Reliable rooms, flat corporate rates, and a front desk that understands business travel.",
      perks: [
        "Flat corporate rates — no hidden fees",
        "Direct billing support for company accounts",
        "Flexible group booking coordination",
        "Dedicated account management",
      ],
    },
    privacyPolicyBody:
      "This Privacy Policy describes how Spark Inn Hotel Corp collects, uses, and protects your personal information in accordance with the Republic Act No. 10173 (Data Privacy Act of 2012). By using our services, you consent to the data practices described in this policy.",
    cancellationPolicy:
      "Cancellations made 48 hours or more before check-in are eligible for a full refund. Cancellations within 48 hours of check-in are non-refundable. No-shows will be charged the full booking amount.",
    houseRules:
      "Check-in time is 2:00 PM. Check-out time is 12:00 PM. No smoking inside rooms. Pets are not allowed. Quiet hours from 10:00 PM to 7:00 AM. Visitors must register at the front desk.",
    updatedAt: now,
  });
}

// ─── Settings: rewardsConfig ──────────────────────────────────────────────────

async function seedRewardsConfig() {
  console.log("\n🏆 Seeding settings/rewardsConfig...");
  await setDoc("settings", "rewardsConfig", {
    pointsEnabled: true,
    earningMode: "per-spend",
    pointsPerBooking: 100,
    pointsPerHundred: 10,
    memberDiscountEnabled: false,
    memberDiscountPct: 0,
    pointsRedemptionRate: 100,
    updatedAt: now,
  });
}

// ─── Settings: storeConfig ────────────────────────────────────────────────────

async function seedStoreConfig() {
  console.log("\n🛍️ Seeding settings/storeConfig...");
  await setDoc("settings", "storeConfig", {
    isEnabled: false,
    lowStockThreshold: 5,
    paymentMethods: [
      { method: "cod", label: "Cash on Delivery", qrUrl: "", accountInfo: "", isEnabled: true },
      { method: "add-to-bill", label: "Add to Bill", qrUrl: "", accountInfo: "", isEnabled: true },
      {
        method: "gcash",
        label: "GCash",
        qrUrl: "",
        accountInfo: "0917-000-0000",
        isEnabled: true,
      },
    ],
    updatedAt: now,
  });
}

// ─── Settings: breakfastConfig ────────────────────────────────────────────────

async function seedBreakfastConfig() {
  console.log("\n🍳 Seeding settings/breakfastConfig...");
  await setDoc("settings", "breakfastConfig", {
    isEnabled: false,
    ratePerPersonPerNight: 250,
    silogItems: [
      { id: "tapsilog", name: "Tapsilog", isActive: true },
      { id: "longsilog", name: "Longsilog", isActive: true },
      { id: "tocilog", name: "Tocilog", isActive: true },
      { id: "bangsilog", name: "Bangsilog", isActive: true },
      { id: "cornsilog", name: "Cornsilog", isActive: true },
      { id: "hotsilog", name: "Hotsilog", isActive: true },
    ],
    updatedAt: now,
  });
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

const placeholderImage =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBROWAtzx3r6P2DrCtCX6SlsOosqCQrjeEnzSElnjhzuzCFZkhFxYs2aDDbgsitFYQ79O_inFjWy49NEiOh3WVn5gfEvc0cH7W-lZbhVQRHMhB-BpDLxRlyxpfXX-fkhQa5Km4MOwELC8yhDzupzv0poZDqF_LBRnPfQqIrgWizPT-POlT-6jm8IH56VF-gjzY5NwJLXvmjUiFtGG-XXzuBMq0ocxQrFatxJQFXvYCtWV0HTsc0qO5vsANuSxNV5Hpc8JYN5cEye1sX";

const roomsData = [
  // — Floor 1 ——————————————————————————————————————————
  {
    id: "room-101",
    name: "Single Room",
    roomNumber: "101",
    type: "single",
    description: "A compact private room for solo guests, short work stays, and travelers who value quiet consistency.",
    maxCapacity: 1,
    bedDefinition: "1 single bed",
    pricePerNight: 1800,
    weekendRate: 2100,
    corporateRate: 1600,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
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
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-103",
    name: "Standard Double",
    roomNumber: "103",
    type: "standard-double",
    description: "Simple comfort for couples or business travelers who want an easy, consistent stay near the city center.",
    maxCapacity: 2,
    bedDefinition: "1 double bed",
    pricePerNight: 2400,
    weekendRate: 2700,
    corporateRate: 2200,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-104",
    name: "Standard Double",
    roomNumber: "104",
    type: "standard-double",
    description: "Simple comfort for couples or business travelers who want an easy, consistent stay near the city center.",
    maxCapacity: 2,
    bedDefinition: "1 double bed",
    pricePerNight: 2400,
    weekendRate: 2700,
    corporateRate: 2200,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
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
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  // — Floor 2 ——————————————————————————————————————————
  {
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
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-202",
    name: "Executive Queen",
    roomNumber: "202",
    type: "executive",
    description: "A warm, spacious retreat with premium bedding, soft lighting, and room to settle in after a day in Bohol.",
    maxCapacity: 2,
    bedDefinition: "1 queen size bed",
    pricePerNight: 3200,
    weekendRate: 3600,
    corporateRate: 2800,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-203",
    name: "Standard Double",
    roomNumber: "203",
    type: "standard-double",
    description: "Simple comfort for couples or business travelers who want an easy, consistent stay near the city center.",
    maxCapacity: 2,
    bedDefinition: "1 double bed",
    pricePerNight: 2400,
    weekendRate: 2700,
    corporateRate: 2200,
    amenities: ["WiFi", "AC", "Work Desk", "Private Bath"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
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
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-205",
    name: "Standard Twin",
    roomNumber: "205",
    type: "standard-twin",
    description: "Twin-bed comfort for colleagues or friends who want a simple, tidy stay with all essentials close by.",
    maxCapacity: 2,
    bedDefinition: "2 single beds",
    pricePerNight: 2600,
    weekendRate: 2900,
    corporateRate: 2300,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  // — Floor 3 ——————————————————————————————————————————
  {
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
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-302",
    name: "Family Room",
    roomNumber: "302",
    type: "family",
    description: "Extra space for small families, with thoughtful essentials and a calm base for Bohol plans.",
    maxCapacity: 4,
    bedDefinition: "2 double beds",
    pricePerNight: 4200,
    weekendRate: 4600,
    corporateRate: 3900,
    amenities: ["WiFi", "AC", "Mini Fridge", "Cable TV"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-303",
    name: "Executive Queen",
    roomNumber: "303",
    type: "executive",
    description: "A warm, spacious retreat with premium bedding, soft lighting, and room to settle in after a day in Bohol.",
    maxCapacity: 2,
    bedDefinition: "1 queen size bed",
    pricePerNight: 3200,
    weekendRate: 3600,
    corporateRate: 2800,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
  {
    id: "room-304",
    name: "Executive Queen",
    roomNumber: "304",
    type: "executive",
    description: "A warm, spacious retreat with premium bedding, soft lighting, and room to settle in after a day in Bohol.",
    maxCapacity: 2,
    bedDefinition: "1 queen size bed",
    pricePerNight: 3200,
    weekendRate: 3600,
    corporateRate: 2800,
    amenities: ["WiFi", "AC", "Hot Shower", "Cable TV"],
    imageUrls: [placeholderImage],
    isActive: true,
    status: "available",
    housekeepingStatus: "clean",
    blockReason: "",
    remarks: "",
  },
];

async function seedRooms() {
  console.log("\n🛏️  Seeding rooms collection (14 rooms)...");
  for (const room of roomsData) {
    const { id, ...data } = room;
    await db
      .collection("rooms")
      .doc(id)
      .set({ ...data, createdAt: now, updatedAt: now }, { merge: false });
    console.log(`  ✔ rooms/${id} — Room ${data.roomNumber} (${data.type})`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Seeding Firestore project: ${FIREBASE_PROJECT_ID}\n`);

  await seedHotelConfig();
  await seedWebsiteContent();
  await seedRewardsConfig();
  await seedStoreConfig();
  await seedBreakfastConfig();
  await seedRooms();

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
