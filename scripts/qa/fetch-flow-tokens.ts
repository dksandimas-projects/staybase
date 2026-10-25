// AI-BROWSER-QA (2026-10-25) — the lookup-token reader.
//
// The guest reaches the Manage Other Add-Ons page through the magic link in
// the confirmation email (`/my-booking/addons?ref=…&token=…`). This pass has
// no inbox, so the token is read from Firestore with the READ-ONLY admin
// SDK — the same value the email would have carried.
//
// READ-ONLY. The tokens are written to a gitignored file under `tmp/` and
// are never printed to stdout, never logged and never committed.
//
//   node fetch-flow-tokens.mjs --out tmp/qa-2026-10-23/flow-tokens.json

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

const vars = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: vars.FIREBASE_PROJECT_ID,
      clientEmail: vars.FIREBASE_CLIENT_EMAIL,
      privateKey: vars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}
const db = getFirestore();

const FLOW_EMAIL = "qa.browser.flow+sparkinn.dev@gmail.com";

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex === -1 ? "tmp/qa-2026-10-23/flow-tokens.json" : process.argv[outIndex + 1];

// Every booking this pass created carries the QA guest email.
const snapshot = await db.collection("bookings").where("guestEmail", "==", FLOW_EMAIL).get();

const tokens: Record<string, string> = {};
for (const doc of snapshot.docs) {
  const data = doc.data() as Record<string, any>;
  const ref = String(data.bookingRef || "");
  const token = String(data.lookupToken || "");
  if (ref && token) tokens[ref] = token;
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(tokens, null, 2));

// The refs only — the tokens never reach stdout.
console.log(`lookup tokens written for ${Object.keys(tokens).length} QA booking(s): ${Object.keys(tokens).join(", ")}`);
