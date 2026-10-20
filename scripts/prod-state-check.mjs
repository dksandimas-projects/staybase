// READ-ONLY production state check. Prints counts + field NAMES only —
// never a value from a credential, a guest record, or a PII field.
//
// Usage: node scripts/prod-state-check.mjs
// Reads: guest-app/.env.spark-inn-prod  (prod service account)

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const env = loadEnv("guest-app/.env.spark-inn-prod");

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});

const db = getFirestore(app);
console.log("project:", env.FIREBASE_PROJECT_ID);
console.log("---");

const COLLECTIONS = [
  "bookings",
  "reservations",
  "guests",
  "members",
  "intercoms",
  "intercomSessions",
  "callSessions",
  "calls",
  "storeOrders",
  "vouchers",
  "corporateCodes",
  "corporateInquiries",
  "notifications",
  "roomBlocks",
  "bookingHolds",
  "staffInventoryHolds"
];

for (const name of COLLECTIONS) {
  try {
    const snap = await db.collection(name).count().get();
    console.log(String(snap.data().count).padStart(6), name);
  } catch (error) {
    console.log("    ERR", name, "-", String(error.message).slice(0, 90));
  }
}

console.log("--- settings doc top-level field NAMES ---");
for (const docId of ["hotelConfig", "breakfastConfig", "websiteContent", "rewardsConfig"]) {
  try {
    const snap = await db.collection("settings").doc(docId).get();
    if (!snap.exists) {
      console.log(docId, ": MISSING");
      continue;
    }
    console.log(docId, ":", Object.keys(snap.data() || {}).sort().join(", "));
  } catch (error) {
    console.log(docId, ": ERR", String(error.message).slice(0, 90));
  }
}

console.log("--- rooms ---");
try {
  const snap = await db.collection("rooms").count().get();
  console.log("rooms count:", snap.data().count);
  const one = await db.collection("rooms").limit(1).get();
  if (!one.empty) {
    console.log("rooms doc field NAMES:", Object.keys(one.docs[0].data() || {}).sort().join(", "));
  }
} catch (error) {
  console.log("rooms ERR", String(error.message).slice(0, 90));
}

console.log("--- legacy flat-rate breakfast fields still present in any booking? ---");
try {
  const legacy = ["breakfastIncluded", "breakfastRate", "hasBreakfast"];
  let hits = 0;
  const snap = await db.collection("bookings").limit(50).get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const found = legacy.filter((f) => f in data);
    if (found.length) {
      hits += 1;
      if (hits <= 3) console.log("  booking with legacy fields:", found.join(", "));
    }
  }
  console.log(hits === 0 ? "  none (0 bookings scanned with legacy fields)" : `  ${hits} booking(s) carry legacy fields`);
} catch (error) {
  console.log("  ERR", String(error.message).slice(0, 90));
}

process.exit(0);
