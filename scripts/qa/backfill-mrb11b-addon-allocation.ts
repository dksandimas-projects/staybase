// Per MRB-11b (QA pass 2026-10-25) — PRODUCTION WRITE, approved by the
// owner on 2026-10-25.
//
// WHAT IT FIXES
// -------------
// The BR-12 "other add-ons" (the airport transfer) sit ON TOP of the
// room bill (OCT-FOL-01, decision #298) — they are NOT inside
// `booking.totalPrice`. The MRB-11 revenue allocation therefore
// described only the room bill, and every revenue stream that reads it
// under-reported by exactly that amount: the production book was short
// by ₱3,950 across two bookings.
//
// The write paths now re-derive the allocation when the add-ons change
// (`addons-manage-save.ts`, `addons-staff-update.ts`) and the create /
// walk-in / reschedule paths carry them. This script brings the
// ALREADY-WRITTEN allocations up to the same contract.
//
// WHAT IT DOES NOT DO
// -------------------
// It never touches `totalPrice`, the folio, the payments or the
// refunds. It writes ONE field — `revenueAllocation` — on the affected
// bookings, and the matching `aggregateRevenueAllocation` on their
// reservation headers.
//
// USAGE
//   node scripts/qa/backfill-mrb11b-addon-allocation.ts            # dry run
//   node scripts/qa/backfill-mrb11b-addon-allocation.ts --apply    # writes

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { rebuildBookingRevenueAllocation } from "../../shared/utils/bookingFolio";

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

const snap = await db.collection("bookings").get();
const affected = snap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((b) => Number(b.otherAddOnTotal) > 0);

console.log(`=== MRB-11b allocation backfill ===`);
console.log(`  mode                : ${APPLY ? "APPLY (writes)" : "DRY RUN"}`);
console.log(`  bookings to re-derive: ${affected.length}\n`);

let written = 0;
for (const b of affected) {
  const otherAddOnTotal = Number(b.otherAddOnTotal) || 0;
  const totalPrice = Number(b.totalPrice) || 0;

  // The STORED allocation may or may not already carry the other
  // add-ons (this script is re-runnable), so the amount it already
  // holds has to be worked out and swapped out for the new one.
  //
  // The stored `addOn` stream is the extra beds PLUS whatever other
  // add-ons were folded in; the booking's own `rateBreakdown` carries
  // the extra-bed figure, so the difference is the other add-ons the
  // stored allocation already holds.
  const extraBedTotal = Number(b.rateBreakdown?.extraBedTotal) || 0;
  const storedOtherAddOns = Math.max(
    0,
    Number(b.revenueAllocation?.addOnNet || 0) - extraBedTotal
  );

  const allocation = rebuildBookingRevenueAllocation({
    existingAllocation: b.revenueAllocation ?? null,
    grossSubtotal: Number(b.originalTotalPrice) || totalPrice,
    totalPrice,
    otherAddOnTotal,
    previousOtherAddOnTotal: storedOtherAddOns
  });

  const before = b.revenueAllocation;
  const changed =
    !before ||
    Math.abs(Number(before.totalNet || 0) - allocation.totalNet) >= 0.01 ||
    Math.abs(Number(before.addOnNet || 0) - allocation.addOnNet) >= 0.01;

  console.log(`  ${b.bookingRef} (${b.id})`);
  console.log(`    totalPrice        : ${totalPrice}   otherAddOnTotal: ${otherAddOnTotal}   billed: ${totalPrice + otherAddOnTotal}`);
  console.log(`    before            : ${JSON.stringify(before ?? null)}`);
  console.log(`    after             : ${JSON.stringify(allocation)}`);
  console.log(`    changed           : ${changed}`);

  if (APPLY) {
    if (changed) {
      await db.collection("bookings").doc(b.id).update({
        revenueAllocation: allocation,
        updatedAt: FieldValue.serverTimestamp()
      });
      written += 1;
    }

    // The reservation header's aggregate is the sum of its children's
    // allocations — keep it in step so the Reports' reservation-level
    // revenue streams read the same figure.
    //
    // The children are re-read AFTER the write: the in-memory snapshot
    // this loop started from still carries the pre-write allocations, so
    // summing it would re-derive the OLD aggregate.
    const reservationId = String(b.reservationId || "").trim();
    if (reservationId) {
      const resRef = db.collection("reservations").doc(reservationId);
      const resSnap = await resRef.get();
      const res = resSnap.data() as Record<string, any> | undefined;
      if (res) {
        const childQuery = await db.collection("bookings").where("reservationId", "==", reservationId).get();
        const children = childQuery.docs.map((d) => d.data() as Record<string, any>);
        const aggregate = {
          roomNet: round2(children.reduce((s, c) => s + Number(c.revenueAllocation?.roomNet || 0), 0)),
          breakfastNet: round2(children.reduce((s, c) => s + Number(c.revenueAllocation?.breakfastNet || 0), 0)),
          addOnNet: round2(children.reduce((s, c) => s + Number(c.revenueAllocation?.addOnNet || 0), 0)),
          deductionNet: round2(children.reduce((s, c) => s + Number(c.revenueAllocation?.deductionNet || 0), 0)),
          totalNet: round2(children.reduce((s, c) => s + Number(c.revenueAllocation?.totalNet || 0), 0))
        };
        await resRef.update({
          aggregateRevenueAllocation: aggregate,
          updatedAt: FieldValue.serverTimestamp()
        });
        console.log(`    reservation       : ${reservationId} · aggregate -> ${JSON.stringify(aggregate)}`);
      }
    }
  }
  console.log("");
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

console.log(`  ${APPLY ? "wrote" : "would write"} ${APPLY ? written : affected.length} booking allocation(s)`);
