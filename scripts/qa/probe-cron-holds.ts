// AI-BROWSER-QA (2026-10-23) — CRON-02 (the holds sweep query must return
// rows instead of FAILED_PRECONDITION) and BASE-07 (the add-on catalog
// payload shape). READ-ONLY.

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
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  })
});
const db = getFirestore();

console.log("=== CRON-02 · the stale-holds sweep query ===");
try {
  const snap = await db
    .collection("bookingHolds")
    .where("status", "==", "active")
    .where("expiresAt", "<", new Date())
    .orderBy("expiresAt")
    .get();
  console.log(`  OK — the query returned ${snap.size} row(s) (no FAILED_PRECONDITION)`);
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const exp = x.expiresAt as { toDate?: () => Date };
    console.log(
      `    ${d.id}: room=${JSON.stringify(x.roomNumber)} expiresAt=${exp?.toDate?.().toISOString() ?? "?"}`
    );
  }
} catch (e) {
  console.log(`  FAILED: ${String(e).slice(0, 400)}`);
}

console.log("\n=== all bookingHolds (status profile) ===");
const all = await db.collection("bookingHolds").get();
const byStatus: Record<string, number> = {};
const now = new Date();
let expired = 0;
for (const d of all.docs) {
  const x = d.data() as Record<string, unknown>;
  const s = String(x.status ?? "<none>");
  byStatus[s] = (byStatus[s] || 0) + 1;
  const exp = x.expiresAt as { toDate?: () => Date } | undefined;
  if (exp?.toDate && exp.toDate() < now) expired++;
}
console.log(`  ${all.size} holds · statuses ${JSON.stringify(byStatus)} · ${expired} already expired`);

console.log("\n=== BASE-07 · the add-on catalog payload (live HTTP) ===");
const res = await fetch("https://www.sparkinnbohol.com/api/bookings/addons/config");
const body = (await res.json()) as Record<string, any>;
console.log(`  success=${body.success} otherAddOnsEnabled=${body.otherAddOnsEnabled} preSeeded=${body.preSeeded}`);
console.log(`  addOns: ${JSON.stringify(body.addOns?.map((a: any) => ({ id: a.id, name: a.name, price: a.price })))}`);
console.log(`  rows are under "addOns": ${Array.isArray(body.addOns) && body.addOns.length > 0}`);
console.log(`  NOT under "data": ${body.data === undefined}`);
