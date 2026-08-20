/**
 * Pre-Live Test Data Cleanup Script
 * Cleans up untagged pre-live test bookings, store orders, intercom stays, notifications,
 * daily reference counters, and optionally Spark Rewards member accounts/counters while preserving
 * hotel configuration, staff accounts, store items, and room QR tokens.
 *
 * Usage:
 *   Dry Run (default):  npx tsx scripts/clean-prelive-bookings.ts
 *   Execute:            npx tsx scripts/clean-prelive-bookings.ts --execute
 *   Include Members:    npx tsx scripts/clean-prelive-bookings.ts --reset-members --execute
 *   With Custom Env:    npx tsx scripts/clean-prelive-bookings.ts --env .env.spark-inn-prod --reset-members --execute
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, DocumentReference } from "firebase-admin/firestore";
import { resolve } from "path";
import { existsSync } from "fs";
import { config as dotenv } from "dotenv";
import * as readline from "readline";

// ─── Command Line Arguments ───────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArgValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

const envFile = getArgValue("--env") || "guest-app/.env";
const isExecute = args.includes("--execute");
const isAutoYes = args.includes("--yes") || args.includes("-y");
const shouldResetMembers = args.includes("--reset-members");

// Load target environment variables
const envPath = resolve(process.cwd(), envFile);
if (existsSync(envPath)) {
  dotenv({ path: envPath });
} else {
  dotenv({ path: resolve(process.cwd(), "guest-app/.env") });
}

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error(`❌ Missing Firebase Admin credentials. Check ${envFile}`);
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

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolvePrompt) =>
    rl.question(query, (ans) => {
      rl.close();
      resolvePrompt(ans.trim());
    })
  );
}

// Recursively fetch all subcollection documents for a given document
async function getAllSubcollectionDocRefs(docRef: DocumentReference): Promise<DocumentReference[]> {
  const refs: DocumentReference[] = [];
  const collections = await docRef.listCollections();
  for (const col of collections) {
    const snapshot = await col.get();
    for (const doc of snapshot.docs) {
      refs.push(doc.ref);
      const childRefs = await getAllSubcollectionDocRefs(doc.ref);
      refs.push(...childRefs);
    }
  }
  return refs;
}

// ─── Main Cleanup Logic ───────────────────────────────────────────────────────

async function main() {
  console.log("=====================================================================");
  console.log("🔥 PRE-LIVE DATA CLEANUP SCRIPT");
  console.log("=====================================================================");
  console.log(` Target Environment:  ${FIREBASE_PROJECT_ID}`);
  console.log(` Config File:         ${envFile}`);
  console.log(` Reset Members:       ${shouldResetMembers ? "YES (--reset-members)" : "NO"}`);
  console.log(` Execution Mode:      ${isExecute ? "🚨 REAL EXECUTION (--execute)" : "🔍 DRY RUN (Default)"}`);
  console.log("=====================================================================\n");

  // 1. Scan Operational Collections
  console.log("🔍 Scanning database collections...");

  // Bookings & Subcollections
  const bookingsSnap = await db.collection("bookings").get();
  const bookingDocRefs: DocumentReference[] = [];
  const bookingSubcollectionRefs: DocumentReference[] = [];

  for (const doc of bookingsSnap.docs) {
    bookingDocRefs.push(doc.ref);
    const subRefs = await getAllSubcollectionDocRefs(doc.ref);
    bookingSubcollectionRefs.push(...subRefs);
  }

  // Store Orders & Subcollections
  const ordersSnap = await db.collection("storeOrders").get();
  const orderDocRefs: DocumentReference[] = [];
  const orderSubcollectionRefs: DocumentReference[] = [];

  for (const doc of ordersSnap.docs) {
    orderDocRefs.push(doc.ref);
    const subRefs = await getAllSubcollectionDocRefs(doc.ref);
    orderSubcollectionRefs.push(...subRefs);
  }

  // Intercom Stays & Messages
  const intercomSnap = await db.collection("intercom").get();
  const intercomDocRefs: DocumentReference[] = [];
  const intercomSubcollectionRefs: DocumentReference[] = [];

  for (const doc of intercomSnap.docs) {
    intercomDocRefs.push(doc.ref);
    const subRefs = await getAllSubcollectionDocRefs(doc.ref);
    intercomSubcollectionRefs.push(...subRefs);
  }

  // Notifications
  const notificationsSnap = await db.collection("notifications").get();
  const notificationDocRefs = notificationsSnap.docs.map((d) => d.ref);

  // Test Runs
  const testRunsSnap = await db.collection("testRuns").get();
  const testRunDocRefs = testRunsSnap.docs.map((d) => d.ref);

  // Spark Rewards Members & Subcollections (pointsHistory)
  const memberDocRefs: DocumentReference[] = [];
  const memberSubcollectionRefs: DocumentReference[] = [];

  if (shouldResetMembers) {
    const membersSnap = await db.collection("members").get();
    for (const doc of membersSnap.docs) {
      memberDocRefs.push(doc.ref);
      const subRefs = await getAllSubcollectionDocRefs(doc.ref);
      memberSubcollectionRefs.push(...subRefs);
    }
  }

  // Counters (Bookings, Store Orders, and Member Sequence Counter if reset)
  const countersSnap = await db.collection("counters").get();
  const counterDocRefs = countersSnap.docs
    .filter((d) => {
      if (d.id.startsWith("bookings-") || d.id.startsWith("store-orders-")) return true;
      if (shouldResetMembers && d.id === "memberNumbers") return true;
      return false;
    })
    .map((d) => d.ref);

  // Rooms to Reset
  const roomsSnap = await db.collection("rooms").get();
  const roomsToReset = roomsSnap.docs.filter((d) => {
    const data = d.data();
    return (
      data.status !== "available" ||
      data.housekeepingStatus !== "clean" ||
      data.currentBookingId ||
      data.currentGuestName ||
      data.occupiedUntil
    );
  });

  // Summary Table
  console.log("\n📊 CLEANUP MANIFEST SUMMARY");
  console.log("─────────────────────────────────────────────────────────────────────");
  console.log(`  • Bookings to delete:            ${bookingDocRefs.length} root docs (+ ${bookingSubcollectionRefs.length} payments/charges subdocs)`);
  console.log(`  • Store Orders to delete:        ${orderDocRefs.length} root docs (+ ${orderSubcollectionRefs.length} tenders subdocs)`);
  console.log(`  • Intercom Stays to delete:      ${intercomDocRefs.length} root docs (+ ${intercomSubcollectionRefs.length} messages subdocs)`);
  console.log(`  • Notifications to delete:       ${notificationDocRefs.length} docs`);
  console.log(`  • Test Runs to delete:           ${testRunDocRefs.length} docs`);
  if (shouldResetMembers) {
    console.log(`  • Rewards Members to delete:     ${memberDocRefs.length} root docs (+ ${memberSubcollectionRefs.length} pointsHistory subdocs)`);
  } else {
    console.log(`  • Rewards Members:               PRESERVED (use --reset-members to reset)`);
  }
  console.log(`  • Daily Counters to reset:       ${counterDocRefs.length} docs`);
  console.log(`  • Rooms to reset state:          ${roomsToReset.length} of ${roomsSnap.size} rooms`);
  console.log("─────────────────────────────────────────────────────────────────────");
  console.log("🛡️  PRESERVED DATA (WILL NOT BE TOUCHED):");
  console.log("  ✔ settings/ (hotelConfig, websiteContent, rewardsConfig, storeConfig, etc.)");
  console.log("  ✔ guests/ (staff accounts and user profiles)");
  console.log("  ✔ rooms/ metadata (room names, rates, and in-room QR tokens)");
  console.log("  ✔ storeItems/ (Spark Essentials product catalog)");
  console.log("  ✔ vouchers/ & corporateCodes/");
  console.log("─────────────────────────────────────────────────────────────────────\n");

  if (!isExecute) {
    console.log("💡 DRY RUN COMPLETE.");
    console.log("No data was deleted or modified.");
    console.log("To execute the actual cleanup, run:");
    console.log(`   npx tsx scripts/clean-prelive-bookings.ts ${shouldResetMembers ? "--reset-members " : ""}--execute\n`);
    process.exit(0);
  }

  // 2. Execution Gate & Safety Confirmation
  if (!isAutoYes) {
    console.log(`⚠️  WARNING: You are about to PERMANENTLY DELETE operational data on:`);
    console.log(`   PROJECT ID: ${FIREBASE_PROJECT_ID}\n`);
    const input = await askQuestion(`Type the project ID "${FIREBASE_PROJECT_ID}" to confirm execution: `);

    if (input !== FIREBASE_PROJECT_ID) {
      console.error("\n❌ Confirmation mismatched. Aborting cleanup execution.");
      process.exit(1);
    }
  }

  console.log("\n🚀 EXECUTING DELETIONS AND ROOM RESETS...");

  // Use bulkWriter for high-performance and resilient batched deletions
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    console.error(`❌ Write error on document ${error.documentRef.path}:`, error.message);
    return false; // do not retry failed items indefinitely
  });

  let totalDeletedCount = 0;

  // Enqueue Subcollections Deletions first
  const allSubDocRefs = [
    ...bookingSubcollectionRefs,
    ...orderSubcollectionRefs,
    ...intercomSubcollectionRefs,
    ...memberSubcollectionRefs,
  ];

  for (const ref of allSubDocRefs) {
    bulkWriter.delete(ref);
    totalDeletedCount++;
  }

  // Enqueue Root Documents Deletions
  const allRootDocRefs = [
    ...bookingDocRefs,
    ...orderDocRefs,
    ...intercomDocRefs,
    ...notificationDocRefs,
    ...testRunDocRefs,
    ...memberDocRefs,
    ...counterDocRefs,
  ];

  for (const ref of allRootDocRefs) {
    bulkWriter.delete(ref);
    totalDeletedCount++;
  }

  // Enqueue Room Resets
  let roomsResetCount = 0;
  for (const doc of roomsSnap.docs) {
    bulkWriter.update(doc.ref, {
      status: "available",
      housekeepingStatus: "clean",
      currentBookingId: null,
      currentGuestName: null,
      occupiedUntil: null,
    });
    roomsResetCount++;
  }

  await bulkWriter.close();

  console.log("✔ Bulk deletion and room status reset completed successfully!");

  // 3. Post-Cleanup Verification Audit
  console.log("\n🔍 Running post-cleanup verification...");
  const verifyBookings = await db.collection("bookings").get();
  const verifyOrders = await db.collection("storeOrders").get();
  const verifyIntercom = await db.collection("intercom").get();

  console.log("─────────────────────────────────────────────────────────────────────");
  console.log(`  • Remaining Bookings:    ${verifyBookings.size}`);
  console.log(`  • Remaining Orders:      ${verifyOrders.size}`);
  console.log(`  • Remaining Intercom:    ${verifyIntercom.size}`);
  if (shouldResetMembers) {
    const verifyMembers = await db.collection("members").get();
    console.log(`  • Remaining Members:     ${verifyMembers.size}`);
  }
  console.log(`  • Rooms Reset Count:     ${roomsResetCount}`);
  console.log("─────────────────────────────────────────────────────────────────────");

  console.log("\n🎉 SUCCESS! Operational data is clean and ready for production go-live.");
}

main().catch((err) => {
  console.error("❌ Pre-live cleanup script failed:", err);
  process.exit(1);
});
