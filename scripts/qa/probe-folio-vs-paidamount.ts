// AI-BROWSER-QA (2026-10-26) — compute the admin folio for a booking with
// the APP'S OWN shared helper, against the live production ledger.
//
// §3.23: the admin's "Record Refund" writes a refund with NO `status`
// field, so every read path classifies it as a PENDING liability
// (`isUnpaidRefund` — "no status ⇒ pending"), while the write path
// decremented `booking.paidAmount` as if the money had already left the
// till. The two models then disagree by exactly the refund amount.
//
// This probe prints BOTH models side by side, from live data, using the
// shared helper the admin drawer itself uses.
//
//   node probe-folio-vs-paidamount.mjs SI-20261026-00002

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeBookingFolio, sumCollectedPayments, isUnpaidRefund } from "@spark-inn/shared";

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

  // The live ledger, exactly as the admin drawer reads it.
  const payments: any[] = [];
  const refunds: any[] = [];
  const rid = b.reservationId;
  for (const [path, bucket] of [
    [`reservations/${rid}/payments`, payments],
    [`reservations/${rid}/refunds`, refunds],
    [`bookings/${doc.id}/payments`, payments],
    [`bookings/${doc.id}/refunds`, refunds]
  ] as [string, any[]][]) {
    const entries = await db.collection(path).get();
    for (const e of entries.docs) {
      const x = e.data() as Record<string, any>;
      bucket.push({
        amount: Number(x.amount) || 0,
        type: x.type ?? (Number(x.amount) < 0 ? "refund" : "payment"),
        status: x.status ?? null,
        method: x.method ?? "",
        path: e.ref.path
      });
    }
  }
  const ledger = [...payments, ...refunds];

  const folio = computeBookingFolio({
    booking: {
      id: doc.id,
      totalPrice: Number(b.totalPrice) || 0,
      otherAddOnTotal: Number(b.otherAddOnTotal) || 0
    } as never,
    persistedPayments: ledger,
    storeOrders: []
  });

  const collected = sumCollectedPayments(ledger);
  const pendingRefunds = ledger.filter(isUnpaidRefund);

  console.log(`\n${ref}  totalPrice=${b.totalPrice}  paidAmount=${b.paidAmount}`);
  console.log(`  the app's folio   : paymentsTotal=${folio.paymentsTotal}  balance=${folio.balance}`);
  console.log(`  the ledger's gross : collected=${collected}  (settled net)`);
  console.log(`  Δ (folio − ledger) : ${folio.paymentsTotal - collected}`);
  console.log(`  the booking's own paidAmount: ${b.paidAmount}`);
  console.log(`  Δ (paidAmount − ledger)    : ${Number(b.paidAmount) - collected}`);
  console.log("  the ledger:");
  for (const e of ledger) {
    console.log(
      `    ${e.amount}  ${e.type}  status=${e.status ?? "<absent>"}  ` +
        `${isUnpaidRefund(e) ? "→ treated as a PENDING LIABILITY" : "→ settled"}  ${e.path}`
    );
  }
  console.log(`  pending refunds the desk is told it still owes: ${pendingRefunds.length}`);
}
