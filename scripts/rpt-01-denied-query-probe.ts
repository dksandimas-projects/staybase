// Per RPT-01 / handoff 2026-10-23 §4: what does a DENIED collection-group
// query actually DO in the Firestore JS SDK?
//
// THE HYPOTHESIS UNDER TEST
// -------------------------
// The admin app's list shows exactly what an EMPTY ledger index produces
// (proved by scripts/rpt-01-ledger-index-probe.ts: 0 paid pills / 69
// balance due / 10 needs attention — the live numbers).
//
// `AdminContext.tsx` attaches the group listener WITHOUT the
// `getIdToken(true)` handshake the neighbouring reservations listener
// uses. If the Firestore SDK's cached token lacks the staff `role` claim
// at attach time, the group query is DENIED by `isStaff()`.
//
// THE QUESTION: does a denied group query (a) call the error callback,
// or (b) silently deliver an EMPTY snapshot and never error?
//
//   (a) => the console would show "Error listening to reservation
//         payments collectionGroup:" — the handoff never checked the
//         console, so this is unverified.
//   (b) => the console stays CLEAN, `setPaymentLedgerDocs([])` runs, the
//         index is empty, and every row reads ₱0 — EXACTLY the observed
//         symptom, with no error anywhere.
//
// Each scenario uses a FRESH Firebase app instance so no cached auth
// session or cached Firestore data can leak between scenarios.
//
// READ-ONLY. Never writes.
//
// Usage:
//   npx esbuild scripts/rpt-01-denied-query-probe.ts --bundle --platform=node \
//     --format=esm --outfile=.probe/rpt01-denied.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-denied.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp as initializeAdminApp, cert } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collectionGroup, onSnapshot, terminate } from "firebase/firestore";

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

console.log("production payments docs:", (await adminDb.collectionGroup("payments").get()).size);
console.log("---");

let staffUid = "";
for (const u of (await adminAuth.listUsers(1000)).users) {
  const role = (u.customClaims as any)?.role;
  if (role === "front-desk" || role === "admin") {
    staffUid = u.uid;
    break;
  }
}
if (!staffUid) {
  console.log("no staff user found");
  process.exit(2);
}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID
};

type Event = { kind: string; detail: string; at: number };

async function scenario(
  tag: string,
  roleClaim: Record<string, unknown> | null
): Promise<Event[]> {
  const events: Event[] = [];
  const t0 = Date.now();
  // A FRESH app per scenario: no cached auth session, no cached
  // Firestore data, nothing carried over.
  const app = initializeApp(firebaseConfig, `probe-${tag}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const customToken = await adminAuth.createCustomToken(
    staffUid,
    roleClaim ?? {}
  );
  await signInWithCustomToken(auth, customToken);
  const claims = (await auth.currentUser!.getIdTokenResult()).claims;
  console.log(`  claims.role = ${JSON.stringify((claims as any).role)}`);

  await new Promise<void>((done) => {
    const unsub = onSnapshot(
      collectionGroup(db, "payments"),
      (snap) => {
        events.push({
          kind: "SNAPSHOT",
          detail: `${snap.size} docs, fromCache=${snap.metadata.fromCache}`,
          at: Date.now() - t0
        });
      },
      (err) => {
        events.push({
          kind: "ERROR",
          detail: `code=${err?.code} message=${err?.message}`,
          at: Date.now() - t0
        });
        done();
      }
    );
    setTimeout(() => {
      events.push({ kind: "TIMEOUT", detail: "no error within 7s", at: Date.now() - t0 });
      unsub();
      done();
    }, 7000);
  });

  await terminate(db);
  return events;
}

console.log("=== SCENARIO 1 — token WITH role=front-desk (isStaff() TRUE) ===");
const e1 = await scenario("staff", { role: "front-desk" });
for (const e of e1) console.log(`  [${e.at}ms] ${e.kind}: ${e.detail}`);
console.log("---");

console.log("=== SCENARIO 2 — token with role=guest (isStaff() FALSE => DENIED) ===");
const e2 = await scenario("guest", { role: "guest" });
for (const e of e2) console.log(`  [${e.at}ms] ${e.kind}: ${e.detail}`);
console.log("---");

const sawError = e2.some((e) => e.kind === "ERROR");
const sawSnapshot = e2.some((e) => e.kind === "SNAPSHOT");
const snapDocs = e2.find((e) => e.kind === "SNAPSHOT");

console.log("VERDICT for the DENIED (non-staff) token:");
console.log("  error callback fired:  ", sawError ? "YES" : "NO");
console.log("  snapshot delivered:    ", sawSnapshot ? "YES" : "NO");
if (snapDocs) console.log("  snapshot contents:      ", snapDocs.detail);
console.log("");
if (!sawError && sawSnapshot) {
  console.log(
    "  => A DENIED collection-group query SILENTLY DELIVERS AN EMPTY SNAPSHOT\n" +
      "     with NO error callback. The console stays clean.\n" +
      "     `setPaymentLedgerDocs([])` runs, the index is empty, and every row\n" +
      "     reads 0 paid — EXACTLY the live symptom, with no error anywhere."
  );
} else if (sawError) {
  console.log(
    "  => A denied group query DOES call the error callback. The console would\n" +
      "     show 'Error listening to reservation payments collectionGroup:'.\n" +
      "     That message has never been observed in the live app."
  );
}
process.exit(0);
