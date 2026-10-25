// AI-BROWSER-QA (2026-10-25) — read-only probe: the authoritative
// "collected" amount per booking, for the `paidAmount` repair.
//
// `booking.paidAmount` is denormalized and wrong in production:
//   * SI-20261021-00011 carries -1000
//   * 14 further bookings carry ledger entries but NO `paidAmount`
//
// The repair must set it from the LEDGER, using the same rule the folio
// uses (FIN-REFUND-LIABILITY): a PENDING refund is a liability, not
// collected money.
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

const isSettledRefund = (amount: number, status: unknown) => {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s === "paid" || s === "processed";
};

async function collectedFor(bookingId: string, reservationId: string) {
  const paymentsRef = reservationId
    ? db.collection("reservations").doc(reservationId).collection("payments")
    : db.collection("bookings").doc(bookingId).collection("payments");
  const refundsRef = reservationId
    ? db.collection("reservations").doc(reservationId).collection("refunds")
    : db.collection("bookings").doc(bookingId).collection("refunds");
  const [payments, refunds] = await Promise.all([paymentsRef.get(), refundsRef.get()]);
  const paid = payments.docs.reduce((s, d) => s + Number((d.data() as any).amount || 0), 0);
  let refundTotal = 0;
  let pendingRefundTotal = 0;
  for (const d of refunds.docs) {
    const data = d.data() as any;
    const amount = Number(data.amount || 0);
    if (isSettledRefund(amount, data.status)) refundTotal += amount;
    else pendingRefundTotal += amount;
  }
  return {
    collected: Math.round((paid + refundTotal) * 100) / 100,
    paid,
    refundTotal,
    pendingRefundTotal,
    payments: payments.size,
    refunds: refunds.size,
    scope: reservationId ? "reservation" : "booking"
  };
}

const all = await db.collection("bookings").get();
const rows: any[] = [];
for (const d of all.docs) {
  const b = d.data() as Record<string, any>;
  const c = await collectedFor(d.id, String(b.reservationId || ""));
  const stored = b.paidAmount === undefined ? null : Number(b.paidAmount);
  const needsRepair = stored === null || Math.abs(stored - c.collected) >= 0.01;
  if (needsRepair) {
    rows.push({
      ref: b.bookingRef,
      id: d.id,
      reservationId: b.reservationId || "",
      storedPaidAmount: stored,
      collected: c.collected,
      scope: c.scope,
      payments: c.payments,
      refunds: c.refunds,
      pendingRefundTotal: c.pendingRefundTotal
    });
  }
}

console.log(`=== bookings whose paidAmount is wrong or missing: ${rows.length} of ${all.size} ===`);
for (const r of rows) {
  console.log(
    `  ${r.ref} · id=${r.id} · scope=${r.scope} · stored=${r.storedPaidAmount} · collected=${r.collected} ` +
      `· payments=${r.payments} refunds=${r.refunds} pendingRefunds=${r.pendingRefundTotal}`
  );
}
console.log(`\n  total to repair: ${rows.length}`);
console.log(`  total delta   : ${rows.reduce((s, r) => s + (r.storedPaidAmount ?? 0) - r.collected, 0).toFixed(2)}`);
