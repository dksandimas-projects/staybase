// PROVE the capability-session hotfix in PRODUCTION.
//
// Mints a staff custom token, signs in as that staff member against the
// real Firebase Auth instance, and performs the EXACT write the desk
// performs: a client-side `addDoc` into
// `intercomSessions/{sessionToken}/messages`.
//
// Before the hotfix this returned 403 PERMISSION_DENIED (the desk could
// not reply). After it, it must return 200.
//
// The scratch document is deleted again in the same run.
//
// Usage: node scripts/verify-prod-desk-reply.mjs

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function loadEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const env = loadEnv("guest-app/.env.spark-inn-prod");
const projectId = env.FIREBASE_PROJECT_ID;
const apiKey = env.VITE_FIREBASE_API_KEY;

const app = initializeApp(
  {
    credential: cert({
      projectId,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY
    }),
    projectId
  },
  "prod-verify"
);

const DOCS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// 1. Mint a staff custom token. `role` is the claim the rules check.
const customToken = await getAuth(app).createCustomToken("hotfix-verify-staff", {
  role: "front-desk"
});

// 2. Exchange it for a real ID token (the same path a browser login takes).
const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  }
);
if (!signIn.ok) {
  console.log("sign-in failed:", signIn.status, (await signIn.text()).slice(0, 200));
  process.exit(1);
}
const { idToken } = await signIn.json();
console.log("signed in as staff (front-desk) ✓");

// 3. The desk's actual write: a client-side addDoc into the session thread.
const scratchToken = `hotfix-verify-${randomBytes(8).toString("hex")}`;
const createRes = await fetch(`${DOCS}/intercomSessions/${scratchToken}/messages?key=${apiKey}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`
  },
  body: JSON.stringify({
    fields: {
      text: { stringValue: "hotfix verification — desk reply path" },
      sender: { stringValue: "front-desk" },
      guestName: { stringValue: "Front Desk" },
      isRead: { booleanValue: true },
      isQuickRequest: { booleanValue: false }
    }
  })
});
const createBody = await createRes.text();
console.log(`desk create in session thread -> HTTP ${createRes.status}`);
if (createRes.status !== 200) {
  console.log("  body:", createBody.slice(0, 300));
  console.log("  => THE DESK REPLY IS STILL DENIED");
  process.exit(1);
}
const createdName = JSON.parse(createBody).name;
console.log("  created:", createdName.split("/documents/")[1]);

// 4. Clean up the scratch document.
// `createdName` is already the full resource path
// ("projects/<id>/databases/(default)/documents/<path>"), so it hangs off
// /v1/ directly — not off the documents/ prefix.
const delRes = await fetch(`https://firestore.googleapis.com/v1/${createdName}?key=${apiKey}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${idToken}` }
});
console.log(`  cleanup delete -> HTTP ${delRes.status}`);

const after = await fetch(`https://firestore.googleapis.com/v1/${createdName}?key=${apiKey}`, {
  headers: { Authorization: `Bearer ${idToken}` }
});
console.log(`  read-back after delete -> HTTP ${after.status} (404 = gone)`);
console.log(`  scratch token was: ${scratchToken}`);

console.log(createRes.status === 200 ? "\nPASS — the desk can reply in production." : "\nFAIL");
process.exit(createRes.status === 200 ? 0 : 1);
