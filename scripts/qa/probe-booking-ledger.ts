// AI-BROWSER-QA (2026-10-26) — dump the ledger of one booking.
//
//   node probe-booking-ledger.mjs SI-20261026-00001 [more refs…]

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

for (const ref of process.argv.slice(2)) {
  const snap = await db.collection("bookings").where("bookingRef", "==", ref).limit(1).get();
  if (snap.empty) {
    console.log(`${ref}: not found`);
    continue;
  }
  const doc = snap.docs[0];
  const b = doc.data() as Record<string, any>;
  console.log(`${ref} id=${doc.id} status=${b.status} totalPrice=${b.totalPrice} paidAmount=${b.paidAmount}`);
  const rid = b.reservationId;
  for (const [label, path] of [
    ["booking payments", `bookings/${doc.id}/payments`],
    ["booking refunds", `bookings/${doc.id}/refunds`],
    ...(rid
      ? ([
          ["reservation payments", `reservations/${rid}/payments`],
          ["reservation refunds", `reservations/${rid}/refunds`]
        ] as [string, string][])
      : [])
  ]) {
    const entries = await db.collection(path).get();
    console.log(`  ${label} (${path}) → ${entries.size}`);
    for (const e of entries.docs) {
      const x = e.data() as Record<string, any>;
      console.log(
        `    ${e.id}  amount=${x.amount}  method=${x.method ?? "-"}  status=${x.status ?? "-"}  ` +
          `type=${x.type ?? "-"}  pending=${x.pending ?? "-"}  reason=${String(x.reason ?? "-").slice(0, 40)}`
      );
    }
  }
}
