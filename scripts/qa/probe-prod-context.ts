// Per AI-BROWSER-QA (2026-10-23): read the production settings that decide
// the expected cancellation refund, plus a few live HTTP probes.
// READ-ONLY.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);

console.log("=== settings collection ===");
const settings = await db.collection("settings").get();
for (const d of settings.docs) {
  const x = d.data() as Record<string, unknown>;
  const keys = Object.keys(x);
  console.log(`  settings/${d.id}: [${keys.join(", ")}]`);
  for (const k of ["cancellationPolicy", "cancellation", "refundPolicy", "rateConfig", "discounts", "discountConfig"]) {
    if (x[k] !== undefined) {
      console.log(`      ${k} = ${JSON.stringify(x[k])}`);
    }
  }
}

console.log("\n=== rateConfig (full) ===");
for (const id of ["rateConfig", "hotelConfig"]) {
  const d = await db.collection("settings").doc(id).get();
  if (!d.exists) continue;
  const x = d.data() as Record<string, unknown>;
  console.log(`  ${id}: ${JSON.stringify(x, null, 2).slice(0, 4000)}`);
}

console.log("\n=== users collection (QA identities) ===");
const users = await db.collection("users").get();
for (const d of users.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.id}: role=${JSON.stringify(x.role)} email=${JSON.stringify(
      String(x.email || "").replace(/^(.).*(@.*)$/, "$1***$2")
    )} isActive=${JSON.stringify(x.isActive)} createdAt=${JSON.stringify(x.createdAt)}`
  );
}

console.log("\n=== live HTTP probes ===");
const probes: Array<[string, string]> = [
  ["GET", "https://www.sparkinnbohol.com/api/version"],
  ["GET", "https://www.sparkinnbohol.com/api/health"],
  ["GET", "https://www.sparkinnbohol.com/robots.txt"],
  ["GET", "https://www.sparkinnbohol.com/sitemap.xml"],
  ["GET", "https://www.sparkinnbohol.com/api/bookings/breakfast/config"],
  ["GET", "https://www.sparkinnbohol.com/api/rooms"],
  ["GET", "https://www.sparkinnbohol.com/api/availability?checkIn=2026-11-05&checkOut=2026-11-06"],
  ["GET", "https://admin.sparkinnbohol.com/api/version"]
];
for (const [method, url] of probes) {
  try {
    const res = await fetch(url, { method, redirect: "follow" });
    const text = await res.text();
    console.log(
      `  ${res.status} ${url}  ct=${res.headers.get("content-type")} len=${text.length} :: ${text.slice(0, 220).replace(/\s+/g, " ")}`
    );
  } catch (e) {
    console.log(`  ERR ${url} :: ${String(e).slice(0, 160)}`);
  }
}

console.log("\n=== Turnstile gate probe (public write endpoint, no body) ===");
try {
  const res = await fetch("https://www.sparkinnbohol.com/api/bookings/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const text = await res.text();
  console.log(`  ${res.status} :: ${text.slice(0, 400).replace(/\s+/g, " ")}`);
} catch (e) {
  console.log(`  ERR :: ${String(e).slice(0, 200)}`);
}
