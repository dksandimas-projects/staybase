// AI-BROWSER-QA (2026-10-23) — read-only probe for FL-03 (dashboard cards).
//
// Recomputes what the dashboard's "Pending Payments" and "Pending
// refunds" stat cards must show, following the app's own derivations
// (DashboardPage.tsx) but against the raw production documents.
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

const bookingSnap = await db.collection("bookings").get();
const bookings = bookingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));

// ── Pending Payments (FOL-05: grouped by reservationId) ─────────────
const uploaded = bookings.filter((b) => b.status === "payment-uploaded");
const groups = new Map<string, any[]>();
for (const b of uploaded) {
  const key = String(b.reservationId || "").trim() || `legacy:${b.id}`;
  groups.set(key, [...(groups.get(key) || []), b]);
}

// ── Pending refunds — breakfast arm (collectionGroup("refunds")) ───
const refundSnap = await db.collectionGroup("refunds").get();
const breakfastPending = refundSnap.docs.filter((d) => {
  const data = d.data() as Record<string, any>;
  return String(data.category || "") === "breakfast" && String(data.status || "pending") === "pending";
}).length;

// ── Pending refunds — cancellation arm (cancellationLiability) ─────
let cancellationPending = 0;
for (const b of bookings) {
  const liability = b.cancellationLiability as any;
  if (!liability || !liability.policyResult) continue;
  const processed = Number(liability.processedAmount || 0);
  const policyRefund = Number(liability.policyResult?.policyRefund || 0);
  const outstanding = Math.max(policyRefund - processed, 0);
  const state = String(liability.state || "");
  if (outstanding > 0 || state === "pending-processing" || state === "partially-processed") {
    cancellationPending += 1;
  }
}

// ── Bookings stat card (createdAt in the current month) ────────────
const now = new Date();
const manilaNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const monthKey = `${manilaNow.getFullYear()}-${String(manilaNow.getMonth() + 1).padStart(2, "0")}`;
const monthlyBookingsCount = bookings.filter((b) => String(b.createdAt || "").startsWith(monthKey)).length;

// ── Revenue stat card (totalPrice, check-in in this month) ─────────
const monthlyRevenue = bookings
  .filter(
    (b) =>
      String(b.checkIn || "").startsWith(monthKey) &&
      ["payment-confirmed", "confirmed", "checked-in", "checked-out"].includes(String(b.status))
  )
  .reduce((sum, b) => sum + Number(b.totalPrice || 0), 0);

console.log("=== dashboard stat cards — reconciled truth (production) ===");
console.log(`Pending Payments      : ${groups.size}   (payment-uploaded bookings: ${uploaded.length})`);
console.log(`Pending refunds       : ${cancellationPending + breakfastPending}`);
console.log(`   cancellation arm   : ${cancellationPending}`);
console.log(`   breakfast arm      : ${breakfastPending}  (collectionGroup refunds total: ${refundSnap.size})`);
console.log(`Bookings (${monthKey}) : ${monthlyBookingsCount}`);
console.log(`Revenue (${monthKey})  : ₱${monthlyRevenue.toLocaleString("en-US")}`);
console.log(`monthKey              : ${monthKey}`);
