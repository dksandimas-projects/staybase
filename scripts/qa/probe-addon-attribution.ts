// AI-BROWSER-QA (2026-10-25) — read-only probe: how the BR-12 other
// add-ons are attributed across a reservation's children.
//
// The other add-ons are spread onto EVERY child doc by the create path
// (`...newBooking`), so the allocation's attribution rule has to be
// decided against the real data, not assumed.
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

for (const ref of ["SI-20261021-00053", "SI-20261021-00055"]) {
  const snap = await db.collection("bookings").where("bookingRef", "==", ref).get();
  for (const d of snap.docs) {
    const b = d.data() as Record<string, any>;
    const resId = String(b.reservationId || "");
    console.log(`\n=== ${ref} (id=${d.id}) ===`);
    console.log(`  reservationId : ${resId || "(none)"}`);
    console.log(`  totalPrice    : ${b.totalPrice}`);
    console.log(`  otherAddOnTotal: ${b.otherAddOnTotal}`);
    console.log(`  allocation    : ${JSON.stringify(b.revenueAllocation)}`);
    if (resId) {
      const res = await db.collection("reservations").doc(resId).get();
      const r = res.data() as Record<string, any> || {};
      const children = (r.children as any[]) || [];
      console.log(`  reservation totalPrice : ${r.totalPrice}`);
      console.log(`  reservation otherAddOnTotal : ${r.otherAddOnTotal}`);
      console.log(`  reservation aggregateRevenueAllocation : ${JSON.stringify(r.aggregateRevenueAllocation)}`);
      console.log(`  reservation children (${children.length}):`);
      for (const c of children) {
        console.log(
          `    ${c.id ?? c.bookingId ?? "?"} · ref=${c.bookingRef ?? "?"} · totalPrice=${c.totalPrice} · otherAddOnTotal=${c.otherAddOnTotal}`
        );
      }
      // The children as stored on the reservation header vs the child docs.
      const childDocs = await db
        .collection("bookings")
        .where("reservationId", "==", resId)
        .get();
      console.log(`  child booking docs (${childDocs.size}):`);
      for (const c of childDocs.docs) {
        const cb = c.data() as Record<string, any>;
        console.log(
          `    ${cb.bookingRef} · totalPrice=${cb.totalPrice} · otherAddOnTotal=${cb.otherAddOnTotal} · alloc.totalNet=${cb.revenueAllocation?.totalNet} · alloc.addOnNet=${cb.revenueAllocation?.addOnNet}`
        );
      }
    }
  }
}

// How many production bookings carry other add-ons at all, and how many
// share a reservation with another booking?
const all = await db.collection("bookings").get();
const withAddOns = all.docs.filter((d) => Number((d.data() as any).otherAddOnTotal) > 0);
console.log(`\n=== production summary ===`);
console.log(`  bookings with otherAddOnTotal > 0 : ${withAddOns.length}`);
const resCounts = new Map<string, number>();
for (const d of all.docs) {
  const r = String((d.data() as any).reservationId || "");
  if (r) resCounts.set(r, (resCounts.get(r) || 0) + 1);
}
for (const d of withAddOns.docs) {
  const b = d.data() as Record<string, any>;
  const r = String(b.reservationId || "");
  console.log(
    `  ${b.bookingRef} · otherAddOnTotal=${b.otherAddOnTotal} · reservationId=${r || "(none)"} · children in that reservation=${r ? resCounts.get(r) : 0}`
  );
}
const maxChildren = Math.max(0, ...resCounts.values());
console.log(`  largest reservation child count : ${maxChildren}`);
