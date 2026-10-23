// AI-BROWSER-QA (2026-10-23) — is the staff COLLECTION-GROUP read on
// `callSessions` actually permitted in production?
//
// The admin app's incoming-call listener is
//   collectionGroup(db, "callSessions")
// and it logs "Missing or insufficient permissions" on every sign-in for
// BOTH staff roles. This probe reproduces the query through the Firestore
// REST API with a REAL staff ID token, so the answer is the production
// answer.
//
// READ-ONLY: runQuery with a read-only structured query.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v.replace(/\\n/g, "\n");
  }
  return out;
}
const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  })
});
const auth = getAuth();
const PROJECT = env.FIREBASE_PROJECT_ID;
const API_KEY = env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY;

async function idTokenFor(uid: string, role: string): Promise<string | null> {
  const custom = await auth.createCustomToken(uid, { role });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true })
    }
  );
  const body = (await res.json()) as any;
  if (!res.ok) {
    console.log(`    signIn error: ${JSON.stringify(body).slice(0, 200)}`);
    return null;
  }
  return body.idToken as string;
}

async function runQuery(token: string, from: any, label: string) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ structuredQuery: { from: [from] } })
    }
  );
  const text = await res.text();
  const ok = res.ok;
  let docCount = 0;
  if (ok) {
    try {
      const rows = JSON.parse(text) as any[];
      docCount = rows.filter((r) => r.document).length;
    } catch {
      /* empty body */
    }
  }
  console.log(`  ${label}`);
  console.log(`     HTTP ${res.status}  ${ok ? `OK, ${docCount} document(s)` : ""}`);
  if (!ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = `${j.error?.status}: ${j.error?.message}`;
    } catch {
      /* keep raw */
    }
    console.log(`     ${msg.slice(0, 300)}`);
  }
  return ok;
}

const targets: Array<[string, string, string]> = [
  ["admin", "PZtxhrdw81NuCRgFnUuJ8qzVcSV2", "admin"],
  ["front-desk", "jQ87CJDbdqd11Niip1aX4Ow0uKM2", "front-desk"]
];

for (const [label, uid, role] of targets) {
  console.log(`\n=== ${label} (${uid}) ===`);
  const token = await idTokenFor(uid, role);
  if (!token) {
    console.log("  could not mint an ID token");
    continue;
  }
  console.log("  (ID token minted; it is never printed)");

  // The desk's incoming-call listener — collection group, all descendants.
  await runQuery(
    token,
    { collectionId: "callSessions", allDescendants: true },
    "collectionGroup('callSessions')  ← the desk's incoming-call listener"
  );
  // The same collection, top level only.
  await runQuery(
    token,
    { collectionId: "callSessions" },
    "collection('callSessions')  (top level only)"
  );
  // The other group the desk uses.
  await runQuery(
    token,
    { collectionId: "messages", allDescendants: true },
    "collectionGroup('messages')  ← the desk's inbox thread"
  );
  // A control: a plain staff-only collection the app reads fine.
  await runQuery(
    token,
    { collectionId: "intercoms" },
    "collection('intercoms')  (control — the desk reads this fine)"
  );
}
