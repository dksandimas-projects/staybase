// Per RPT-01 / handoff 2026-10-23 §4: reproduce the ADMIN APP'S CLIENT-SIDE
// ledger listener against LIVE production, with a REAL staff token.
//
// WHY THIS IS THE DECISIVE TEST
// ------------------------------
// `scripts/rpt-01-ledger-index-probe.ts` proved that the money math and
// the ledger projection are CORRECT: an empty index reproduces the live
// chips exactly (0 paid / 69 balance due / 10 needs attention) and a
// populated index reproduces the truth exactly (14 / 55 / 5).
//
// So the defect is in the CLIENT-SIDE layer — the
// `collectionGroup("payments")` / `collectionGroup("refunds")` listeners
// in `AdminContext.tsx` never populate `paymentLedgerDocs`.
//
// This script runs THAT EXACT listener with the real client SDK and a
// real staff token, and compares four scenarios:
//
//   T1  attach with NO `getIdToken(true)` handshake   (what the app does)
//   T2  attach AFTER `await getIdToken(true)`         (what the reservations
//                                                        listener does)
//   T3  a DIRECT path read of the same docs           (what the drawer
//                                                        does — known good)
//   T4  the same direct read WITHOUT the handshake
//
// T3 vs T1 isolates "group query" from "token". T1 vs T2 isolates
// "handshake". If T1 succeeds here, the bug is NOT the handshake or the
// group query, and it is somewhere else entirely (the effect lifecycle).
//
// READ-ONLY. Never writes. Prints uids and roles — never emails.
//
// Usage:
//   npx esbuild scripts/rpt-01-client-listener-probe.ts --bundle --platform=node \
//     --format=esm --outfile=.probe/rpt01-client.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-client.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp as initializeAdminApp, cert } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collection, collectionGroup, doc, onSnapshot } from "firebase/firestore";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
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

const envFile = process.env.ENV_FILE || "guest-app/.env.spark-inn-prod";
const env = loadEnv(resolve(process.cwd(), envFile));

// ── Find a staff account (Firebase Auth, not Firestore) ────────────────
const adminApp = initializeAdminApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);

console.log("project:", env.FIREBASE_PROJECT_ID);
console.log("---");

// ── Find a reservation that has a ledger, for the direct-read test ─────
const paymentSnap = await adminDb.collectionGroup("payments").get();
const samplePath = paymentSnap.docs[0]?.ref.path ?? "";
const parts = samplePath.split("/");
const sampleReservationId = parts[0] === "reservations" ? parts[1] : "";
console.log("ledger docs:", paymentSnap.size, "refunds:", (await adminDb.collectionGroup("refunds").get()).size);
console.log("sample ledger path:", samplePath);
console.log("---");

// Enumerate auth users and pick one whose custom claims carry a staff role.
let staffUid = "";
let staffRole = "";
const list = await adminAuth.listUsers(1000);
for (const u of list.users) {
  const role = (u.customClaims as any)?.role;
  if (role === "front-desk" || role === "admin") {
    staffUid = u.uid;
    staffRole = role;
    break;
  }
}
if (!staffUid) {
  console.log("NO STAFF USER FOUND with role front-desk|admin");
  process.exit(2);
}
console.log("staff uid:", staffUid, "role:", staffRole);
console.log("---");

// ── Client SDK: sign in with a custom token carrying the role claim ────
const customToken = await adminAuth.createCustomToken(staffUid, { role: staffRole });

const clientApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        appId: env.VITE_FIREBASE_APP_ID
      });
const auth = getAuth(clientApp);
const db = getFirestore(clientApp);

await signInWithCustomToken(auth, customToken);

const user = auth.currentUser!;
const claims = (await user.getIdTokenResult()).claims;
console.log("token claims role:", (claims as any).role, "| uid matches:", claims.sub === staffUid);
console.log("---");

type Outcome = { label: string; docs: number | null; error: string | null; ms: number };

async function runGroupListener(label: string, withHandshake: boolean): Promise<Outcome> {
  const started = Date.now();
  if (withHandshake) {
    await auth.currentUser?.getIdToken(true);
  }
  return await new Promise<Outcome>((resolve) => {
    let settled = false;
    const finish = (docs: number | null, error: string | null) => {
      if (settled) return;
      settled = true;
      resolve({ label, docs, error, ms: Date.now() - started });
    };
    const unsub = onSnapshot(
      collectionGroup(db, "payments"),
      (snap) => {
        finish(snap.size, null);
        unsub();
      },
      (err) => {
        finish(null, `${err?.code ?? "?"}: ${err?.message ?? String(err)}`);
        unsub();
      }
    );
    // Do NOT hang forever if the listener never settles.
    setTimeout(() => finish(null, "TIMEOUT (no snapshot, no error within 8s)"), 8000);
  });
}

async function runDirectListener(
  label: string,
  withHandshake: boolean
): Promise<Outcome> {
  const started = Date.now();
  if (withHandshake) {
    await auth.currentUser?.getIdToken(true);
  }
  return await new Promise<Outcome>((resolve) => {
    let settled = false;
    const finish = (docs: number | null, error: string | null) => {
      if (settled) return;
      settled = true;
      resolve({ label, docs, error, ms: Date.now() - started });
    };
    if (!sampleReservationId) {
      finish(null, "no sample reservation id");
      return;
    }
    const unsub = onSnapshot(
      collection(db, "reservations", sampleReservationId, "payments"),
      (snap) => {
        finish(snap.size, null);
        unsub();
      },
      (err) => {
        finish(null, `${err?.code ?? "?"}: ${err?.message ?? String(err)}`);
        unsub();
      }
    );
    setTimeout(() => finish(null, "TIMEOUT (no snapshot, no error within 8s)"), 8000);
  });
}

console.log("=== CLIENT-SIDE LISTENER MATRIX (real staff token, production) ===");
const t1 = await runGroupListener("T1 group payments, NO handshake", false);
console.log(" ", JSON.stringify(t1));
const t2 = await runGroupListener("T2 group payments, WITH handshake", true);
console.log(" ", JSON.stringify(t2));
const t3 = await runDirectListener("T3 direct reservation payments, WITH handshake", true);
console.log(" ", JSON.stringify(t3));
const t4 = await runDirectListener("T4 direct reservation payments, NO handshake", false);
console.log(" ", JSON.stringify(t4));

console.log("---");
console.log("INTERPRETATION:");
if (t1.docs === paymentSnap.size && t1.docs !== null) {
  console.log(
    "  T1 SUCCEEDED with the SAME token and NO handshake — the group query and the\n" +
      "  rules are FINE. The defect is therefore NOT the handshake, NOT the rules,\n" +
      "  and NOT the group query. It is in the app's effect lifecycle / state wiring."
  );
} else if (t1.error && t1.error.startsWith("permission-denied")) {
  console.log(
    "  T1 was PERMISSION_DENIED → the token used at attach time lacks the staff\n" +
      "  role claim. Adding the `getIdToken(true)` handshake (T2) is the fix."
  );
} else if (t1.error && t1.error.startsWith("TIMEOUT")) {
  console.log(
    "  T1 never delivered a snapshot and never errored → the listener attaches but\n" +
      "  the query never completes for this client."
  );
} else {
  console.log("  T1 returned:", t1.docs ?? t1.error, "— compare against T2/T3/T4 above.");
}
