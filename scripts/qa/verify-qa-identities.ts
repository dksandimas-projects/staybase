// Per AI-BROWSER-QA (2026-10-23): verify the QA identities' ACTUAL role and
// enrollment state before using them, as the assignment requires.
//
// The admin app gates on the Firebase Auth CUSTOM CLAIM `role`
// ("admin" | "front-desk") — a Firestore role alone is not enough, so both
// are checked here. READ-ONLY.
//
// QA identities print in full (they are dedicated test accounts, not guest
// PII). Human staff accounts are masked.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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
const auth = getAuth(app);

const QA_EMAILS = ["adminbot@gmail.com", "frontdeskbot@gmail.com", "memberbot@gmail.com"];
const mask = (s: string) => (QA_EMAILS.includes(s) ? s : s.replace(/^(.).*(@.*)$/, "$1***$2"));

console.log("=== Auth identities: custom claims (the admin app's actual gate) ===");
const list = await auth.listUsers(200);
for (const u of list.users) {
  const claims = (u.customClaims || {}) as Record<string, unknown>;
  const isQa = QA_EMAILS.includes((u.email || "").toLowerCase());
  console.log(
    `  ${isQa ? "[QA] " : "     "}${mask(u.email || "")}\n` +
      `         uid=${u.uid}\n` +
      `         claims=${JSON.stringify(claims)} disabled=${u.disabled} ` +
      `emailVerified=${u.emailVerified}\n` +
      `         lastSignIn=${u.metadata.lastSignInTime || "NEVER"}`
  );
}
console.log(`  total auth users: ${list.users.length}`);

console.log("\n=== QA identity cross-check (auth claim vs Firestore doc) ===");
for (const email of QA_EMAILS) {
  const u = list.users.find((x) => (x.email || "").toLowerCase() === email);
  if (!u) {
    console.log(`  ${email}: NO AUTH USER`);
    continue;
  }
  const claims = (u.customClaims || {}) as Record<string, unknown>;
  const staffDoc = await db.collection("guests").doc(u.uid).get();
  const memberDoc = await db.collection("members").doc(u.uid).get();
  console.log(`\n  ${email}`);
  console.log(`     auth uid            : ${u.uid}`);
  console.log(`     auth claim role     : ${JSON.stringify(claims.role ?? null)}`);
  console.log(`     auth emailVerified  : ${u.emailVerified}`);
  console.log(`     staff doc exists    : ${staffDoc.exists}`);
  if (staffDoc.exists) {
    const s = staffDoc.data() as Record<string, unknown>;
    console.log(
      `     staff doc role      : ${JSON.stringify(s.role)} isActive=${JSON.stringify(s.isActive)} ` +
        `fullName=${JSON.stringify(s.fullName)}`
    );
  }
  console.log(`     member doc exists   : ${memberDoc.exists}`);
  if (memberDoc.exists) {
    const m = memberDoc.data() as Record<string, unknown>;
    console.log(
      `     member state        : number=${JSON.stringify(m.memberNumber)} isMember=${JSON.stringify(m.isMember)} ` +
        `isActive=${JSON.stringify(m.isActive)} tier=${JSON.stringify(m.tier)} ` +
        `rewardsPoints=${JSON.stringify(m.rewardsPoints)} completedStays=${JSON.stringify(m.completedStays)} ` +
        `email=${JSON.stringify(m.email)}`
    );
  }
  const verdict =
    (claims.role === "admin" || claims.role === "front-desk") && staffDoc.exists
      ? "usable as STAFF"
      : memberDoc.exists
        ? "usable as REWARDS MEMBER (not staff)"
        : "USABLE FOR NOTHING — no role claim, no staff doc, no member doc";
  console.log(`     VERDICT             : ${verdict}`);
}

console.log("\n=== other member docs (candidate member B) ===");
const members = await db.collection("members").get();
for (const d of members.docs) {
  const m = d.data() as Record<string, unknown>;
  const email = String(m.email || "");
  console.log(
    `  ${d.id}: email=${mask(email)} number=${JSON.stringify(m.memberNumber)} ` +
      `isMember=${JSON.stringify(m.isMember)} isActive=${JSON.stringify(m.isActive)} ` +
      `points=${JSON.stringify(m.rewardsPoints)} stays=${JSON.stringify(m.completedStays)} ` +
      `fullName=${JSON.stringify(m.fullName)}`
  );
}

console.log("\n=== rooms (availability fixtures) ===");
const rooms = await db.collection("rooms").get();
const byType: Record<string, number> = {};
let active = 0;
for (const d of rooms.docs) {
  const r = d.data() as Record<string, unknown>;
  const t = String(r.roomType || r.type || "?");
  byType[t] = (byType[t] || 0) + 1;
  if (r.status !== "blocked" && r.status !== "maintenance") active++;
}
console.log(`  ${rooms.size} rooms · ${active} bookable · by type ${JSON.stringify(byType)}`);

console.log("\n=== corporate codes ===");
const codes = await db.collection("corporateCodes").get();
for (const d of codes.docs) {
  const c = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: code=${JSON.stringify(c.code)} isActive=${JSON.stringify(c.isActive)} ` +
      `flatRate=${JSON.stringify(c.flatRate)} expiresAt=${JSON.stringify(c.expiresAt)} ` +
      `maxRooms=${JSON.stringify(c.maxRooms)} usageCount=${JSON.stringify(c.usageCount)}`
  );
}

console.log("\n=== vouchers (prod) ===");
const vouchers = await db.collection("vouchers").get();
for (const d of vouchers.docs) {
  const v = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: code=${JSON.stringify(v.code)} type=${JSON.stringify(v.discountType)} ` +
      `value=${JSON.stringify(v.discountValue)} cap=${JSON.stringify(v.usageCap)} ` +
      `used=${JSON.stringify(v.usageCount)} active=${JSON.stringify(v.isActive)} ` +
      `expires=${JSON.stringify(v.expiresAt)} roomTypes=${JSON.stringify(v.applicableRoomTypes)}`
  );
}

console.log("\n=== store items ===");
const items = await db.collection("storeItems").get();
for (const d of items.docs) {
  const i = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: name=${JSON.stringify(i.name)} price=${JSON.stringify(i.price)} ` +
      `stock=${JSON.stringify(i.stock)} active=${JSON.stringify(i.isActive)}`
  );
}
