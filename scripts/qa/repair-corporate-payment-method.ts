// REPAIR the corporate bookings whose `paymentMethod` is the string
// "chargeback" — a value that is not a payment method in this system.
//
// THE DEFECT (RPT-5, fixed in this branch)
// ----------------------------------------
//   The corporate convert path defaulted `paymentMethod` to
//   "chargeback". That string is not in `SUPPORTED_PAYMENT_METHODS`
//   and the hotel had no `paymentMethods` entry for it, so:
//     - no report could group those bookings by payment method;
//     - and `handleSetLouReceived` — the LOU (Letter of Undertaking)
//       toggle that DECISIONS-FEATURES.md #99 defines as the trigger
//       for marking a corporate chargeback resolved — REJECTS any
//       booking whose `paymentMethod !== "pay-at-hotel"`. So the desk
//       could never resolve them, which is exactly how the "Corporate
//       AR" receivables card ends up permanently inflated.
//
// SCOPE — deliberately narrow:
//   A booking is repaired ONLY when ALL of these hold:
//     * `paymentMethod === "chargeback"` (exactly the broken value)
//     * `isCorporate === true` (only the corporate path wrote it)
//     * the hotel's configured `paymentMethods` has NO "chargeback"
//       entry — so there is no legitimate configured method being
//       overwritten
//     * "pay-at-hotel" IS configured (the replacement is a method the
//       hotel actually offers)
//
//   A booking that carries "chargeback" for any other reason, or a
//   hotel that DOES configure a "chargeback" method, is SKIPPED and
//   reported.
//
// READ-ONLY unless `--apply` is passed.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

function L(f: string) {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(f, "utf8").split("\n")) {
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

const APPLY = process.argv.includes("--apply");
const vars = L("guest-app/.env.spark-inn-prod");
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

// ── The hotel's configured payment methods ────────────────────────
const cfgDoc = await db.collection("settings").doc("hotelConfig").get();
const cfg = (cfgDoc.exists ? cfgDoc.data() : {}) || {};
const configured: any[] = Array.isArray(cfg.paymentMethods) ? cfg.paymentMethods : [];
const configuredMethods = configured.map((m: any) => String(m?.method || ""));

console.log("=== the hotel's configured payment methods ===");
console.log("  ", JSON.stringify(configuredMethods));
console.log("   'pay-at-hotel' configured? ", configuredMethods.includes("pay-at-hotel"));
console.log("   'chargeback' configured?   ", configuredMethods.includes("chargeback"));

if (configuredMethods.includes("chargeback")) {
  console.log("\nABORT: the hotel DOES configure a 'chargeback' payment method.");
  console.log("       The 'chargeback' value may be legitimate here — nothing to repair.");
  process.exit(0);
}
if (!configuredMethods.includes("pay-at-hotel")) {
  console.log("\nABORT: 'pay-at-hotel' is not configured — the replacement value would");
  console.log("       write a method this hotel does not offer. Nothing to repair.");
  process.exit(0);
}

// ── Find the affected bookings ────────────────────────────────────
const snap = await db.collection("bookings").get();
const affected: { id: string; ref: string; data: any }[] = [];
const skipped: { id: string; ref: string; why: string }[] = [];

for (const doc of snap.docs) {
  const data = doc.data() || {};
  if (data.paymentMethod !== "chargeback") continue;

  const ref = String(data.bookingRef || doc.id);
  if (data.isCorporate !== true) {
    skipped.push({ id: doc.id, ref, why: "not a corporate booking" });
    continue;
  }
  affected.push({ id: doc.id, ref, data });
}

console.log(`\n=== affected bookings: ${affected.length} ===`);
for (const b of affected) {
  console.log(
    `  ${b.ref}: source=${b.data.source} isCorporate=${b.data.isCorporate} status=${b.data.status} ` +
    `louReceived=${JSON.stringify(b.data.louReceived ?? null)}`
  );
}
if (skipped.length) {
  console.log(`\n=== skipped: ${skipped.length} ===`);
  for (const s of skipped) console.log(`  ${s.ref}: ${s.why}`);
}

if (!affected.length) {
  console.log("\nNothing to repair.");
  process.exit(0);
}

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply to write the repair.");
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────
console.log("\n=== applying ===");
for (const b of affected) {
  const ref = db.collection("bookings").doc(b.id);
  await ref.update({
    paymentMethod: "pay-at-hotel",
    paymentMethodRepairedAt: FieldValue.serverTimestamp(),
    paymentMethodRepairedReason:
      "RPT-5: the corporate convert path defaulted paymentMethod to 'chargeback', " +
      "which is not a payment method in this system and blocked the LOU settlement " +
      "trigger (handleSetLouReceived). Repaired to 'pay-at-hotel'.",
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log(`  repaired ${b.ref} -> paymentMethod = "pay-at-hotel"`);
}

console.log("\n=== verify ===");
const after = await db.collection("bookings").get();
let remaining = 0;
for (const doc of after.docs) {
  const d = doc.data() || {};
  if (d.paymentMethod === "chargeback") {
    remaining++;
    console.log(`  STILL 'chargeback': ${d.bookingRef || doc.id}`);
  }
}
console.log(`  bookings still carrying paymentMethod "chargeback": ${remaining}`);
