// PRODUCTION WRITE — APPLIED 2026-11-21 (owner-reported).
//
// WHAT IT DID
// -----------
// Turned OFF the hotel-wide intercom VOICE CALL in PRODUCTION —
// `settings/hotelConfig.intercomCallsEnabled: false`.
//
// WHY
// ---
// The owner switched the voice call off in the admin Settings → Intercom
// tab, but the guest panel still showed the "Call Desk" button. The
// production document still carried `intercomCallsEnabled: true`, so the
// public projection published `true` and the guest rendered the button.
//
// WHY A SCRIPT (and not the admin UI)
// -----------------------------------
// The admin toggle only persisted when "Save Intercom Settings" was
// pressed (the button sits at the bottom of the tab). The owner's OFF
// never reached Firestore. This script performs exactly the same write
// the admin UI would have performed — and the admin toggle was fixed the
// same day (decision #335: the switches now persist on click).
//
// USAGE
//   node scripts/qa/flip-intercom-calls-off.ts           # dry run
//   node scripts/qa/flip-intercom-calls-off.ts --apply   # writes
//
// READ-ONLY by default. Writes ONE field. Idempotent: it exits early
// when the switch is already OFF.

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

async function main() {
  const apply = process.argv.includes("--apply");
  const ref = db.collection("settings").doc("hotelConfig");

  const before = await ref.get();
  const current = (before.data() || {}) as Record<string, unknown>;

  console.log("=== BEFORE ===");
  console.log(`  intercomCallsEnabled : ${JSON.stringify(current.intercomCallsEnabled)}`);
  console.log(`  intercomChatEnabled  : ${JSON.stringify(current.intercomChatEnabled)}`);

  if (current.intercomCallsEnabled === false) {
    console.log("\nAlready OFF — nothing to write.");
    return;
  }

  if (!apply) {
    console.log("\nDry run. Would write: intercomCallsEnabled = false");
    console.log("Re-run with --apply to write.");
    return;
  }

  console.log("\nWriting intercomCallsEnabled = false …");
  // A merge write of ONE field. Nothing else on the document is touched.
  await ref.set({ intercomCallsEnabled: false }, { merge: true });
  console.log("Write committed.");

  // Never trust the exit code — re-read and assert.
  const after = await ref.get();
  const now = (after.data() || {}) as Record<string, unknown>;
  console.log("\n=== AFTER ===");
  console.log(`  intercomCallsEnabled : ${JSON.stringify(now.intercomCallsEnabled)}`);
  console.log(`  intercomChatEnabled  : ${JSON.stringify(now.intercomChatEnabled)}`);
  if (now.intercomCallsEnabled !== false) {
    console.error("ASSERTION FAILED: intercomCallsEnabled is still not false.");
    process.exit(1);
  }
  console.log("\nASSERTION PASSED: the voice call switch is OFF in production.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
