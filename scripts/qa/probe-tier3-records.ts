// AI-BROWSER-QA (2026-10-26) — the manifest of records THIS PASS created.
//
// Every scenario in the Tier-3 scope stamps the repo's ETR-03 test-run id
// on the records it writes (`isTestData: true` + `testRunId`), so the
// manifest is a query, not a promise.
//
// READ-ONLY.
//
//   ENV_FILE=guest-app/.env.spark-inn-prod \
//   node tmp/.../probe-tier3-records.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY
    }),
    projectId: env.FIREBASE_PROJECT_ID
  });
}
const db = getFirestore();
const auth = getAuth();

const createdAt = (d: any) => d.data()?.createdAt?.toMillis?.() ?? 0;

console.log("=== QA bookings (isTestData) ===");
const bookings = (await db.collection("bookings").get()).docs
  .filter((d) => d.data()?.isTestData === true)
  .sort((a, b) => createdAt(b) - createdAt(a));
console.log(`  count=${bookings.length}`);
for (const d of bookings) {
  const x = d.data() as Record<string, any>;
  console.log(
    `  ${x.bookingRef}  id=${d.id}  status=${x.status}  room=${x.roomNumber ?? "-"}  ` +
      `email=${x.guestEmail ?? "-"}  memberId=${x.memberId ?? "-"}  ` +
      `total=${x.totalPrice ?? "-"}  paid=${x.paidAmount ?? "-"}  ` +
      `pointsRedeemed=${x.pointsRedeemed ?? 0}  testRun=${x.testRunId ?? "-"}`
  );
}

console.log("\n=== QA reservations (isTestData) ===");
const reservations = (await db.collection("reservations").get()).docs
  .filter((d) => d.data()?.isTestData === true)
  .sort((a, b) => createdAt(b) - createdAt(a));
console.log(`  count=${reservations.length}`);
for (const d of reservations) {
  const x = d.data() as Record<string, any>;
  console.log(`  ${x.reservationRef ?? d.id}  booking=${x.bookingId ?? "-"}  total=${x.totalPrice ?? "-"}`);
}

console.log("\n=== QA store orders (isTestData) ===");
const orders = (await db.collection("storeOrders").get()).docs
  .filter((d) => d.data()?.isTestData === true)
  .sort((a, b) => createdAt(b) - createdAt(a));
console.log(`  count=${orders.length}`);
for (const d of orders) {
  const x = d.data() as Record<string, any>;
  console.log(`  ${x.orderRef ?? d.id}  status=${x.status}  total=${x.totalAmount ?? "-"}  room=${x.roomNumber ?? "-"}`);
}

console.log("\n=== the Spark Rewards members this pass created (QA alias domain) ===");
const members = (await db.collection("members").get()).docs;
for (const d of members) {
  const m = d.data() as Record<string, any>;
  const email = String(m.email || "");
  if (!email.endsWith("+sparkinn.dev@gmail.com")) continue;
  let verified = "n/a";
  try {
    verified = String((await auth.getUserByEmail(email)).emailVerified);
  } catch {
    verified = "NO AUTH USER";
  }
  console.log(
    `  ${m.memberNumber ?? "-"}  uid=${d.id}  email=${email}  verified=${verified}  ` +
      `points=${m.rewardsPoints ?? 0}  tier=${m.tier ?? "-"}`
  );
}

console.log("\n=== the QA auth accounts (QA alias domain) ===");
const list = await auth.listUsers(1000);
for (const u of list.users) {
  if (!u.email?.endsWith("+sparkinn.dev@gmail.com")) continue;
  console.log(`  ${u.email}  uid=${u.uid}  verified=${u.emailVerified}  disabled=${u.disabled}`);
}

console.log("\n=== store catalogue (the ST-04 fixtures) ===");
const catalogue = (await db.collection("storeItems").get()).docs;
for (const d of catalogue) {
  const i = d.data() as Record<string, any>;
  if (!String(i.name || "").startsWith("A7 ")) continue;
  console.log(`  ${d.id}  ${i.name}  price=${i.price}  stock=${JSON.stringify(i.stock)}  isActive=${i.isActive}`);
}
