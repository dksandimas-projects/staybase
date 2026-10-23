// AI-BROWSER-QA (2026-10-23) — read-only probe: does a booking carry
// other-add-on SELECTIONS (not just a total)?
//
// SI-20261021-00053 has otherAddOnTotal 1,500 and SI-20261021-00055 has
// 1,000, but their `revenueAllocation.addOnNet` is 0 (§3.4). The
// drawer's Add-Ons tab reads the selections, so this probe checks
// whether the selections exist at all.
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
  console.log(`\n=== ${ref} ===`);
  for (const d of snap.docs) {
    const b = d.data() as Record<string, any>;
    console.log(`  id=${d.id} room=${b.roomNumber} otherAddOnTotal=${b.otherAddOnTotal}`);
    const sel = b.otherAddOnSelections || {};
    console.log(`  otherAddOnSelections (${Object.keys(sel).length}):`);
    for (const [k, v] of Object.entries(sel as Record<string, any>)) {
      console.log(`    ${k} -> ${JSON.stringify(v)}`);
    }
    console.log(`  revenueAllocation.addOnNet = ${b.revenueAllocation?.addOnNet}`);
    console.log(`  rateBreakdown.addOns = ${JSON.stringify(b.rateBreakdown?.addOns)}`);
  }
}
