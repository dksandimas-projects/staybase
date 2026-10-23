// AI-BROWSER-QA (2026-10-23) — read-only probe for FL-03.
//
// The dashboard's "Pending Payments" card reads the
// `collectionGroup("payments")` aggregate (MRB-12), NOT the Bookings
// LIST's `onsitePayments` projection — so it may well be correct even
// though the LIST is zeroed. This probe recomputes what the card must
// show, so the browser assertion has a reconciled truth to check
// against.
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
const peso = (n: number) => `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const bookingSnap = await db.collection("bookings").get();
const paymentSnap = await db.collectionGroup("payments").get();

// The aggregate the dashboard card reads: payments grouped by the
// booking they name, summed.
const paidByBooking = new Map<string, number>();
for (const d of paymentSnap.docs) {
  const data = d.data() as Record<string, unknown>;
  const bookingId = typeof data.bookingId === "string" ? data.bookingId : null;
  if (!bookingId) continue;
  const amount = Number(data.amount || 0);
  paidByBooking.set(bookingId, (paidByBooking.get(bookingId) || 0) + amount);
}

const uploaded = bookingSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  .filter((b) => b.status === "payment-uploaded");

console.log(`bookings total: ${bookingSnap.size}`);
console.log(`status === "payment-uploaded": ${uploaded.length}`);
console.log(`collectionGroup("payments") docs: ${paymentSnap.size}\n`);

// The card groups the uploaded bookings by reservationId (FOL-05), so
// the card's COUNT is the number of groups, not the number of bookings.
const groups = new Map<string, any[]>();
for (const b of uploaded) {
  const key = String(b.reservationId || "").trim() || `legacy:${b.id}`;
  const arr = groups.get(key) || [];
  arr.push(b);
  groups.set(key, arr);
}

console.log(`dashboard card would show: ${groups.size} queued\n`);

let groupIndex = 0;
for (const [key, members] of groups) {
  groupIndex += 1;
  const scopedTotal = members.reduce((s, b) => s + Number(b.totalPrice || 0), 0);
  const paidAmount = members.reduce((s, b) => s + (paidByBooking.get(b.id) || 0), 0);
  const due = Math.max(0, scopedTotal - paidAmount);
  console.log(`group ${groupIndex} key=${key} members=${members.length}`);
  for (const m of members) {
    console.log(
      `    ${m.bookingRef} · ${m.guestName} · room ${m.roomNumber} · total ${peso(Number(m.totalPrice || 0))} · ` +
        `paid ${peso(paidByBooking.get(m.id) || 0)} · due ${peso(Math.max(0, Number(m.totalPrice || 0) - (paidByBooking.get(m.id) || 0)))}`
    );
  }
  console.log(`    GROUP TOTAL ${peso(scopedTotal)} · paid ${peso(paidAmount)} · due ${peso(due)}\n`);
}
