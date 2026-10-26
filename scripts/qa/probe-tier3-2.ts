// AI-BROWSER-QA (2026-10-26) — a second, focused probe: what does a live
// booking carry (room assignment, registration, id photo), and what does
// the room inventory look like? This decides how the ST-04 in-room store
// scenario can be staged.
//
// READ-ONLY.

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

console.log("=== a recent QA booking's shape ===");
const snap = await db.collection("bookings").get();
const qa = snap.docs
  .filter((d) => (d.data() as any).isTestData)
  .sort((a, b) => ((b.data() as any).createdAt?.toMillis?.() ?? 0) - ((a.data() as any).createdAt?.toMillis?.() ?? 0));
const latest = qa[0];
if (latest) {
  const x = latest.data() as Record<string, any>;
  console.log(`  ref=${x.bookingRef} status=${x.status}`);
  console.log(`  roomId=${JSON.stringify(x.roomId)} roomNumber=${JSON.stringify(x.roomNumber)}`);
  console.log(`  rooms[]=${JSON.stringify(x.rooms ?? null)}`);
  console.log(`  guestIdPhotoUrl=${JSON.stringify(x.guestIdPhotoUrl ?? null)}`);
  console.log(`  guestRegistration=${JSON.stringify(x.guestRegistration ?? null)}`);
  console.log(`  memberId=${JSON.stringify(x.memberId ?? null)} pointsRedeemed=${JSON.stringify(x.pointsRedeemed ?? 0)}`);
  console.log(`  totalPrice=${JSON.stringify(x.totalPrice)} paidAmount=${JSON.stringify(x.paidAmount ?? null)}`);
  console.log(`  reservationId=${JSON.stringify(x.reservationId ?? null)}`);
  console.log(`  keys=${JSON.stringify(Object.keys(x).sort())}`);
} else {
  console.log("  no test-data bookings found");
}

console.log("\n=== how many bookings carry a room assignment? ===");
let withRoom = 0;
let withRoomNumber = 0;
for (const d of snap.docs) {
  const x = d.data() as Record<string, any>;
  if (x.roomId) withRoom++;
  if (x.roomNumber) withRoomNumber++;
}
console.log(`  bookings=${snap.size} withRoomId=${withRoom} withRoomNumber=${withRoomNumber}`);

console.log("\n=== rooms inventory ===");
const rooms = await db.collection("rooms").get();
console.log(`  rooms=${rooms.size}`);
const statuses: Record<string, number> = {};
for (const d of rooms.docs) {
  const r = d.data() as Record<string, any>;
  const key = String(r.status ?? "(none)");
  statuses[key] = (statuses[key] || 0) + 1;
}
console.log(`  by status: ${JSON.stringify(statuses)}`);
for (const d of rooms.docs.slice(0, 12)) {
  const r = d.data() as Record<string, any>;
  console.log(
    `  ${d.id}: number=${JSON.stringify(r.roomNumber ?? r.number)} type=${JSON.stringify(r.type ?? r.roomType)} ` +
      `status=${JSON.stringify(r.status)} name=${JSON.stringify(r.name ?? null)}`
  );
}

console.log("\n=== intercom docs (the session capability store) ===");
const intercoms = await db.collection("intercoms").get();
console.log(`  intercoms=${intercoms.size}`);
for (const d of intercoms.docs.slice(0, 8)) {
  const i = d.data() as Record<string, any>;
  console.log(
    `  ${d.id}: currentStayId=${JSON.stringify(i.currentStayId ?? null)} ` +
      `hasToken=${Boolean(i.currentStayToken)} updatedAt=${JSON.stringify(i.updatedAt ?? null)}`
  );
}

console.log("\n=== store orders (any existing) ===");
const orders = await db.collection("storeOrders").get();
console.log(`  storeOrders=${orders.size}`);
for (const d of orders.docs.slice(0, 8)) {
  const o = d.data() as Record<string, any>;
  console.log(
    `  ${d.id}: ref=${JSON.stringify(o.orderRef)} room=${JSON.stringify(o.roomNumber)} ` +
      `status=${JSON.stringify(o.status)} total=${JSON.stringify(o.totalAmount)} ` +
      `isTestData=${JSON.stringify(o.isTestData ?? false)}`
  );
}
