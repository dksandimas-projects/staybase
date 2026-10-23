// AI-BROWSER-QA (2026-10-23) — read-only probe for BASE-02.
//
// The booking drawer's Breakfast tab must render the per-date x per-guest
// meal grid. The fixture is SI-20261021-00052 (4 meals over 2026-11-05/06
// at ₱400). This probe prints the raw `breakfastSelections` map so the
// browser assertion has a reconciled truth to check against.
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

for (const ref of ["SI-20261021-00052", "SI-20261021-00005"]) {
  const snap = await db.collection("bookings").where("bookingRef", "==", ref).get();
  console.log(`\n=== ${ref} (${snap.size} doc(s)) ===`);
  for (const d of snap.docs) {
    const b = d.data() as Record<string, any>;
    console.log(`  id=${d.id}`);
    console.log(`  guest=${b.guestName} room=${b.roomNumber} numGuests=${b.numGuests}`);
    console.log(`  checkIn=${b.checkIn} checkOut=${b.checkOut} status=${b.status}`);
    console.log(`  breakfastTotal=${b.breakfastTotal} totalPrice=${b.totalPrice} otherAddOnTotal=${b.otherAddOnTotal}`);
    const sel = b.breakfastSelections || {};
    console.log(`  breakfastSelections (${Object.keys(sel).length} slot(s)):`);
    for (const [k, v] of Object.entries(sel as Record<string, any>)) {
      console.log(`    ${k} -> ${JSON.stringify(v)}`);
    }
    const served = b.breakfastServed || {};
    console.log(`  breakfastServed (${Object.keys(served).length}):`);
    for (const [k, v] of Object.entries(served as Record<string, any>)) {
      console.log(`    ${k} -> ${JSON.stringify(v)}`);
    }
    const other = b.otherAddOnSelections || {};
    console.log(`  otherAddOnSelections (${Object.keys(other).length}):`);
    for (const [k, v] of Object.entries(other as Record<string, any>)) {
      console.log(`    ${k} -> ${JSON.stringify(v)}`);
    }
  }
}
