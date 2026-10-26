// AI-BROWSER-QA (2026-10-26) — a focused read of the newest QA booking's
// payment/refund ledger, to see where the recorded payment landed.
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

const snap = await db.collection("bookings").get();
const qa = snap.docs
  .filter((d) => (d.data() as any).isTestData)
  .sort((a, b) => ((b.data() as any).createdAt?.toMillis?.() ?? 0) - ((a.data() as any).createdAt?.toMillis?.() ?? 0));
const latest = qa[0];
if (!latest) {
  console.log("no test bookings");
  process.exit(0);
}
const x = latest.data() as Record<string, any>;
console.log(`booking ${x.bookingRef} id=${latest.id}`);
console.log(`  status=${x.status} total=${x.totalPrice} paidAmount=${x.paidAmount ?? null}`);
console.log(`  reservationId=${x.reservationId ?? null} room=${x.roomNumber}`);
console.log(`  breakfastSelections=${JSON.stringify(x.breakfastSelections ?? null)}`);
console.log(`  breakfastTotal=${x.breakfastTotal ?? null} hasAnyBreakfast=${x.hasAnyBreakfast ?? null}`);

const resId = x.reservationId;
if (resId) {
  const pay = await db.collection("reservations").doc(resId).collection("payments").get();
  console.log(`  reservations/${resId}/payments → ${pay.size}`);
  for (const d of pay.docs) {
    const p = d.data() as Record<string, any>;
    console.log(`    ${d.id}: type=${p.type} amount=${p.amount} method=${p.method} note=${p.note}`);
  }
  const ref = await db.collection("reservations").doc(resId).collection("refunds").get();
  console.log(`  reservations/${resId}/refunds → ${ref.size}`);
}
const bpay = await db.collection("bookings").doc(latest.id).collection("payments").get();
console.log(`  bookings/${latest.id}/payments → ${bpay.size}`);
for (const d of bpay.docs) {
  const p = d.data() as Record<string, any>;
  console.log(`    ${d.id}: type=${p.type} amount=${p.amount} method=${p.method} note=${p.note}`);
}
const bref = await db.collection("bookings").doc(latest.id).collection("refunds").get();
console.log(`  bookings/${latest.id}/refunds → ${bref.size}`);
