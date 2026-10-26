// AI-BROWSER-QA (2026-10-26) — prerequisite probe for the four remaining
// Tier-3 scenarios: FD-10 + BASE-04 (the refund chain), ST-04 (the stock
// write), RW-03 (the redemption apply/undo) and RW-01's signup half.
//
// READ-ONLY. It reads the live production Firestore through the admin SDK
// and prints only the configuration + balances the scenarios need. No
// guest PII is printed: the QA identities are masked down to their local
// part's first three characters.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
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

function loadQaEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const qa = loadQaEnv("e2e/.qa.env.local");

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);
const auth = getAuth(app);

function mask(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 3)}***@${domain || "?"}`;
}

console.log("=== rewardsConfig (RW-03) ===");
const rewards = await db.collection("settings").doc("rewardsConfig").get();
if (!rewards.exists) {
  console.log("  MISSING");
} else {
  const r = rewards.data() as Record<string, unknown>;
  console.log(`  pointsRedemptionRate    = ${JSON.stringify(r.pointsRedemptionRate)}`);
  console.log(`  minPointsToRedeem       = ${JSON.stringify(r.minPointsToRedeem)}`);
  console.log(`  pointsCanPayUpToBillPct = ${JSON.stringify(r.pointsCanPayUpToBillPct)}`);
  console.log(`  pointsPerBooking        = ${JSON.stringify(r.pointsPerBooking)}`);
  console.log(`  welcomePoints           = ${JSON.stringify(r.welcomePoints)}`);
  console.log(`  memberDiscountPct       = ${JSON.stringify(r.memberDiscountPct)}`);
  console.log(`  levels                  = ${JSON.stringify(r.levels)}`);
}

console.log("\n=== the QA member identity (RW-03 / RW-01) ===");
for (const key of ["QA_MEMBER_EMAIL", "QA_MEMBERB_EMAIL"]) {
  const email = qa[key];
  if (!email) continue;
  let uid = "";
  try {
    const found = await auth.getUserByEmail(email);
    uid = found.uid;
    console.log(`  ${key} ${mask(email)} uid=${uid} emailVerified=${found.emailVerified}`);
  } catch (err: any) {
    console.log(`  ${key} ${mask(email)} → NO AUTH USER (${err?.code || "unknown"})`);
    continue;
  }
  const member = await db.collection("members").doc(uid).get();
  if (!member.exists) {
    console.log(`    member doc: MISSING`);
    continue;
  }
  const m = member.data() as Record<string, unknown>;
  console.log(
    `    memberNumber=${JSON.stringify(m.memberNumber)} rewardsPoints=${JSON.stringify(m.rewardsPoints)} ` +
      `isMember=${JSON.stringify(m.isMember)} isActive=${JSON.stringify(m.isActive)} tier=${JSON.stringify(m.tier)} ` +
      `completedStays=${JSON.stringify(m.completedStays)}`
  );
  const history = await db.collection(`members/${uid}/pointsHistory`).get();
  console.log(`    pointsHistory rows: ${history.size}`);
  for (const d of history.docs.slice(0, 8)) {
    const h = d.data() as Record<string, unknown>;
    console.log(
      `      ${d.id}: type=${JSON.stringify(h.type)} points=${JSON.stringify(h.points)} ` +
        `reason=${JSON.stringify(String(h.reason ?? h.description ?? "").slice(0, 60))}`
    );
  }
}

console.log("\n=== store items (ST-04) ===");
const items = await db.collection("storeItems").get();
if (items.empty) {
  console.log("  storeItems: EMPTY");
}
for (const d of items.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: name=${JSON.stringify(x.name)} price=${JSON.stringify(x.price)} ` +
      `stock=${JSON.stringify(x.stock)} stockMode=${JSON.stringify(x.stockMode)} ` +
      `isActive=${JSON.stringify(x.isActive)} category=${JSON.stringify(x.category)}`
  );
}

console.log("\n=== store settings (ST-04 / ST-06) ===");
const storeSettings = await db.collection("settings").doc("storeConfig").get();
if (storeSettings.exists) {
  const s = storeSettings.data() as Record<string, unknown>;
  console.log(`  enabled=${JSON.stringify(s.enabled)} isEnabled=${JSON.stringify(s.isEnabled)}`);
  console.log(`  keys=${JSON.stringify(Object.keys(s))}`);
} else {
  console.log("  settings/storeConfig: MISSING");
}

console.log("\n=== hotelConfig paymentMethods (FD-10) ===");
const hotel = await db.collection("settings").doc("hotelConfig").get();
const h = (hotel.data() as Record<string, unknown>) || {};
const methods = Array.isArray(h.paymentMethods) ? h.paymentMethods : [];
for (const m of methods) {
  console.log(`  ${JSON.stringify(m)}`);
}

console.log("\n=== the open QA member bookings (RW-03 needs a `confirmed` one) ===");
const bookings = await db.collection("bookings").get();
for (const d of bookings.docs) {
  const x = d.data() as Record<string, unknown>;
  if (!x.memberId) continue;
  console.log(
    `  ${x.bookingRef} id=${d.id} status=${JSON.stringify(x.status)} total=${JSON.stringify(x.totalPrice)} ` +
      `memberId=${JSON.stringify(x.memberId)} pointsRedeemed=${JSON.stringify(x.pointsRedeemed ?? 0)} ` +
      `isTestData=${JSON.stringify(x.isTestData ?? false)} testRunId=${JSON.stringify(x.testRunId ?? null)}`
  );
}
