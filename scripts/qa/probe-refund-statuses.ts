// AI-BROWSER-QA (2026-10-24) — read-only probe: the exact shape and
// status vocabulary of the production refund documents.
//
// The §3.3 fix (a pending refund is a LIABILITY, not a reduction of
// collected money) depends on the real `status` values, so they are
// read from production rather than assumed.
//
// READ-ONLY. It never writes to Firestore.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

function loadEnv(file: string) {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const vars = loadEnv("guest-app/.env.spark-inn-prod");

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: vars.FIREBASE_PROJECT_ID,
      clientEmail: vars.FIREBASE_CLIENT_EMAIL,
      privateKey: String(vars.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n")
    })
  });
}

const db = getFirestore();

console.log("=== refunds collectionGroup (production) ===");
const refunds = await db.collectionGroup("refunds").get();
for (const d of refunds.docs) {
  const data = d.data() as Record<string, any>;
  console.log(`\n${d.ref.path}`);
  console.log(`  amount      : ${data.amount}`);
  console.log(`  type        : ${data.type ?? "(none)"}`);
  console.log(`  status      : ${data.status ?? "(none)"}`);
  console.log(`  category    : ${data.category ?? "(none)"}`);
  console.log(`  bookingId   : ${data.bookingId ?? "(none)"}`);
  console.log(`  paidAt      : ${data.paidAt ?? "(none)"}`);
  console.log(`  recordedAt  : ${data.recordedAt?.toDate?.().toISOString?.() ?? data.recordedAt ?? "(none)"}`);
}

console.log("\n=== payments collectionGroup — statuses (production) ===");
const payments = await db.collectionGroup("payments").get();
const statuses = new Map<string, number>();
for (const d of payments.docs) {
  const data = d.data() as Record<string, any>;
  const key = `status=${data.status ?? "(none)"} type=${data.type ?? "(none)"}`;
  statuses.set(key, (statuses.get(key) || 0) + 1);
}
for (const [k, v] of statuses) console.log(`  ${k}  x${v}`);

console.log("\n=== the two bookings the QA report flags ===");
for (const ref of ["SI-20261021-00058", "SI-20261021-00060", "SI-20261021-00011"]) {
  const snap = await db.collection("bookings").where("bookingRef", "==", ref).get();
  for (const d of snap.docs) {
    const b = d.data() as Record<string, any>;
    console.log(
      `  ${ref} · id=${d.id} · status=${b.status} · totalPrice=${b.totalPrice} · ` +
        `paidAmount=${b.paidAmount} · otherAddOnTotal=${b.otherAddOnTotal} · ` +
        `breakfastTotal=${b.breakfastTotal} · grandExpected=${Number(b.totalPrice || 0) + Number(b.otherAddOnTotal || 0)}`
    );
  }
}
