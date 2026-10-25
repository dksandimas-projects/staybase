// AI-BROWSER-QA (2026-10-25) — read-only probe: is the hotel-wide
// bot-protection switch actually OFF in production, and what else does
// the hotel config carry?
//
// READ-ONLY.

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

const snap = await db.collection("settings").doc("hotelConfig").get();
const cfg = (snap.data() || {}) as Record<string, unknown>;

console.log("=== settings/hotelConfig ===");
console.log(`  botProtectionMode          : ${JSON.stringify(cfg.botProtectionMode)}`);
console.log(`  botProtectionDisabledBy    : ${JSON.stringify(cfg.botProtectionDisabledBy)}`);
console.log(`  botProtectionDisabledAt    : ${JSON.stringify(cfg.botProtectionDisabledAt)}`);
console.log(`  botProtectionDisabledReason: ${JSON.stringify(cfg.botProtectionDisabledReason)}`);
console.log(`  otherAddOnsEnabled         : ${JSON.stringify(cfg.otherAddOnsEnabled)}`);
console.log(`  seniorPwdOnlineEnabled     : ${JSON.stringify(cfg.seniorPwdOnlineEnabled)}`);
console.log(`  keys                       : ${Object.keys(cfg).sort().join(", ")}`);

// The live server's view: does a gated endpoint now accept a bot-token-less
// write? That is the real proof the switch is honoured end to end.
const guestBase = "https://www.sparkinnbohol.com";
const probe = await fetch(`${guestBase}/api/bookings/lookup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bookingRef: "SI-20261021-00001", email: "qa.probe@example.invalid" })
});
const body = await probe.json().catch(() => ({}));
console.log(`\n=== live gate probe (guest /api/bookings/lookup, no bot token) ===`);
console.log(`  HTTP ${probe.status}  ${JSON.stringify(body).slice(0, 220)}`);
