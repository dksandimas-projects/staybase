// Per FIN-PAID-AMOUNT-SOURCE (QA pass 2026-10-25) — PRODUCTION WRITE,
// approved by the owner on 2026-10-25.
//
// WHAT IT FIXES
// -------------
// `booking.paidAmount` is a denormalized "what the guest has paid"
// field. In production it is wrong on the bookings that carry money:
//
//   * SI-20261021-00011 reads -1000 (the refund path decremented it
//     from a base that was never seeded);
//   * 14 further bookings carry ledger entries but NO `paidAmount` at
//     all.
//
// A negative or absent base reads as "nothing was paid", so
// `shared/utils/bookingAddOnReschedule.ts` opened NO refund liability
// for a PAID breakfast removed on those bookings — the guest was never
// owed the money back.
//
// WHAT IT DOES NOT DO
// -------------------
// It never touches the payments, the refunds, the folio, the totals or
// the allocations. It writes ONE field — `paidAmount` — and only on the
// bookings that actually carry money (a booking with no payments has
// no `paidAmount` at all, which is the correct reading of "nothing
// collected" and is left alone).
//
// The amount is the LEDGER's: the payments + the SETTLED refunds. A
// refund the hotel has approved but not paid out is a LIABILITY, not
// collected money (FIN-REFUND-LIABILITY).
//
// USAGE
//   node scripts/qa/repair-paid-amount.ts            # dry run
//   node scripts/qa/repair-paid-amount.ts --apply    # writes

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
const APPLY = process.argv.includes("--apply");
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

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
  let settled = 0;
  for (const d of refunds.docs) {
    const data = d.data() as any;
    if (isSettledRefund(Number(data.amount || 0), data.status)) settled += Number(data.amount || 0);
  }
  return r2(paid + settled);
}

const all = await db.collection("bookings").get();
const bookings = all.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));

// The reservation child counts — a reservation with more than one child
// cannot attribute its collected amount to a single booking, so those
// are reported for manual review instead of written.
const childCounts = new Map<string, number>();
for (const b of bookings) {
  const r = String(b.reservationId || "");
  if (r) childCounts.set(r, (childCounts.get(r) || 0) + 1);
}

console.log(`=== paidAmount repair ===`);
console.log(`  mode : ${APPLY ? "APPLY (writes)" : "DRY RUN"}`);
console.log(`  bookings scanned: ${bookings.length}\n`);

let written = 0;
let skipped = 0;
let toWrite = 0;
for (const b of bookings) {
  const reservationId = String(b.reservationId || "");
  const children = reservationId ? childCounts.get(reservationId) || 0 : 1;
  const collected = await collectedFor(b.id, reservationId);
  if (collected <= 0) continue; // no money collected — absent is correct

  const stored = b.paidAmount === undefined || b.paidAmount === null ? null : Number(b.paidAmount);
  const matches = stored !== null && Math.abs(stored - collected) < 0.01;
  if (matches) continue;

  if (children > 1) {
    console.log(
      `  SKIP ${b.bookingRef} (${b.id}) · reservation has ${children} children · ` +
        `stored=${stored} · collected=${collected} — the collected amount is reservation-level; manual review.`
    );
    skipped += 1;
    continue;
  }

  console.log(`  ${b.bookingRef} (${b.id})`);
  console.log(`    stored paidAmount : ${stored === null ? "(absent)" : stored}`);
  console.log(`    ledger collected  : ${collected}`);

  toWrite += 1;

  if (APPLY) {
    await db.collection("bookings").doc(b.id).update({
      paidAmount: collected,
      updatedAt: FieldValue.serverTimestamp()
    });
    written += 1;
    console.log(`    -> written`);
  }
}

console.log(`\n  ${APPLY ? "wrote" : "would write"} ${APPLY ? written : toWrite} booking paidAmount field(s)`);
if (skipped) console.log(`  skipped ${skipped} (multi-child reservation — manual review)`);
