// Per AI-BROWSER-QA (2026-10-23): fixture details needed to author the
// Playwright suite — member B identity, corporate code shape, room inventory,
// and the exact public API route table. READ-ONLY.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}
const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);

console.log("=== members (QA accounts — full email) ===");
const members = await db.collection("members").get();
for (const d of members.docs) {
  const m = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}  email=${JSON.stringify(m.email)} number=${JSON.stringify(m.memberNumber)} ` +
      `fullName=${JSON.stringify(m.fullName)} points=${JSON.stringify(m.rewardsPoints)} ` +
      `stays=${JSON.stringify(m.completedStays)} isActive=${JSON.stringify(m.isActive)} ` +
      `tier=${JSON.stringify(m.tier)} currentLevel=${JSON.stringify(m.currentLevel)}`
  );
}

console.log("\n=== corporateCodes (full shape) ===");
const codes = await db.collection("corporateCodes").get();
for (const d of codes.docs) {
  console.log(`  ${d.id}: ${JSON.stringify(d.data(), null, 2).slice(0, 1200)}`);
}

console.log("\n=== rooms (inventory for availability fixtures) ===");
const rooms = await db.collection("rooms").get();
for (const d of rooms.docs) {
  const r = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: number=${JSON.stringify(r.roomNumber ?? r.number)} type=${JSON.stringify(r.roomType ?? r.type)} ` +
      `status=${JSON.stringify(r.status)} floor=${JSON.stringify(r.floor)} ` +
      `capacity=${JSON.stringify(r.capacity ?? r.maxCapacity)}`
  );
}

console.log("\n=== roomBlocks / bookingHolds (availability blockers) ===");
for (const id of ["roomBlocks", "bookingHolds"]) {
  const snap = await db.collection(id).get();
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    console.log(
      `  ${id}/${d.id}: ${JSON.stringify({
        roomNumber: x.roomNumber,
        roomType: x.roomType,
        checkIn: x.checkIn,
        checkOut: x.checkOut,
        status: x.status,
        expiresAt: x.expiresAt,
        bookingId: x.bookingId
      })}`
    );
  }
}

console.log("\n=== counters (booking ref sequences) ===");
const counters = await db.collection("counters").get();
for (const d of counters.docs) {
  console.log(`  ${d.id}: ${JSON.stringify(d.data())}`);
}

console.log("\n=== testRuns ===");
const runs = await db.collection("testRuns").get();
for (const d of runs.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: status=${JSON.stringify(x.status)} env=${JSON.stringify(x.environment)} ` +
      `startedAt=${JSON.stringify(x.startedAt)} notes=${JSON.stringify(x.notes)}`
  );
}
