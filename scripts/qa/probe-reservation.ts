// AI-BROWSER-QA (2026-10-26) — inspect one reservation's ledger and the
// booking it belongs to.
//
//   node probe-reservation.mjs 138fc076-08ab-4ef8-a8a0-6b7ca781dcdb

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
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

for (const rid of process.argv.slice(2)) {
  const res = await db.collection("reservations").doc(rid).get();
  console.log(`reservation ${rid}: ${JSON.stringify(res.data()).slice(0, 300)}`);
  for (const collection of ["payments", "refunds"]) {
    const entries = await db.collection(`reservations/${rid}/${collection}`).get();
    console.log(`  ${collection} → ${entries.size}`);
    for (const e of entries.docs) {
      const x = e.data() as Record<string, any>;
      console.log(
        `    ${e.id}  amount=${x.amount}  type=${x.type ?? "-"}  status=${x.status ?? "<absent>"}  ` +
          `method=${x.method ?? "-"}  category=${x.category ?? "-"}  bookingId=${x.bookingId ?? "-"}`
      );
    }
  }
  // The booking the reservation belongs to.
  const bid = res.data()?.bookingId;
  if (typeof bid === "string" && bid) {
    const b = await db.collection("bookings").doc(bid).get();
    console.log(`  booking ${bid}: ${b.exists ? `totalPrice=${b.data()?.totalPrice} paidAmount=${b.data()?.paidAmount} status=${b.data()?.status}` : "missing"}`);
  }
}
