// Per RPT-01 (handoff 2026-10-23 §4) — follow-up probe.
//
// The first RPT-01 fix stabilised the auth identity so the ledger listeners
// subscribe ONCE. The live admin app STILL shows an empty ledger index
// (0 "Paid" pills / 69 "Balance due" / 10 "Needs attention"), while the same
// collection-group query returns all 20 payment docs from Node with the same
// staff token, and the booking DRAWER (a plain subcollection listener) shows
// the right amounts.
//
// The browser differs from Node in three ways: the app opens ~20 listeners at
// once, it forces SIX simultaneous ID-token refreshes at load, and it repeats
// a forced refresh every 30s. Each forced refresh changes the token the
// Firestore client is using, which makes the SDK restart its listen stream.
//
// This probe reproduces those conditions with the CLIENT SDK and reports, per
// scenario, whether the `collectionGroup("payments")` listener ever delivers a
// snapshot (and how many docs).
//
// READ-ONLY. Never writes.
//
//   npx esbuild scripts/rpt-01-concurrency-probe.ts --bundle --platform=node \
//     --format=esm --outfile=.probe/rpt01-conc.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-conc.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { initializeApp as initClient, getApps } from "firebase/app";
import { getAuth as getClientAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collection, collectionGroup, onSnapshot, getDocs } from "firebase/firestore";

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

const adminApp = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const adminAuth = getAuth(adminApp);

const STAFF_UID = process.env.STAFF_UID || "Ae2IX8AzLChNB45HgLWiwXb7xLf2";
const customToken = await adminAuth.createCustomToken(STAFF_UID);

const clientApp = getApps().length ? getApps()[0] : initClient({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID
});
const auth = getClientAuth(clientApp);
await signInWithCustomToken(auth, customToken);
const db = getFirestore(clientApp);

console.log("project:", env.VITE_FIREBASE_PROJECT_ID, "| staff uid:", STAFF_UID);
console.log("---");

const WAIT_MS = 12000;

type Outcome = { docs: number | null; ms: number | null; error: string | null };

function watchGroupPayments(label: string): Promise<Outcome> {
  const started = Date.now();
  return new Promise((done) => {
    const timer = setTimeout(() => {
      finish(null, null, "TIMEOUT (no snapshot)");
    }, WAIT_MS);
    let finished = false;
    const finish = (docs: number | null, ms: number | null, error: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ docs, ms, error });
    };
    const unsub = onSnapshot(
      collectionGroup(db, "payments"),
      (snapshot) => {
        finish(snapshot.docs.length, Date.now() - started, null);
        setTimeout(() => unsub(), 50);
      },
      (error) => {
        finish(null, Date.now() - started, String(error?.message || error));
      }
    );
  });
}

function report(label: string, outcome: Outcome) {
  const verdict = outcome.error
    ? `ERROR: ${outcome.error}`
    : outcome.docs === null
      ? "NO SNAPSHOT"
      : `${outcome.docs} docs in ${outcome.ms}ms`;
  console.log(`  ${label.padEnd(58)} ${verdict}`);
}

// --- Scenario A — control: no refresh churn at all -----------------------
console.log("=== A. CONTROL — group listener alone ===");
report("A1 group payments, nothing else running", await watchGroupPayments("A1"));

// --- Scenario B — the app's handshake, nothing else running --------------
console.log("=== B. APP HANDSHAKE, no churn ===");
await auth.currentUser?.getIdToken(true);
report("B1 group payments after ONE forced refresh", await watchGroupPayments("B1"));

// --- Scenario C — six simultaneous forced refreshes at load ---------------
console.log("=== C. THE APP'S LOAD BURST — 6 simultaneous forced refreshes ===");
const refreshes = Promise.all(
  Array.from({ length: 6 }, () => auth.currentUser?.getIdToken(true).catch((e) => `FAIL: ${e?.message || e}`))
);
const resultC = await watchGroupPayments("C1 group payments DURING the burst");
await refreshes;
report("C1 group payments DURING the burst", resultC);

// --- Scenario D — burst first, then attach (post-churn) ------------------
console.log("=== D. BURST FIRST, THEN ATTACH (settled) ===");
await Promise.all(
  Array.from({ length: 6 }, () => auth.currentUser?.getIdToken(true).catch(() => undefined))
);
report("D1 group payments after the burst settled", await watchGroupPayments("D1"));

// --- Scenario E — ~20 unrelated listeners open, then the group listener ---
console.log("=== E. 20 CONCURRENT LISTENERS, then the group listener ===");
const others = [
  "bookings",
  "reservations",
  "notifications",
  "members",
  "storeOrders",
  "charges",
  "breakfastAudit",
  "otherAddOnAudit",
  "callSessions",
  "rooms",
  "rates",
  "vouchers",
  "inquiries",
  "corporateInquiries",
  "dailyCloses",
  "roomTypes",
  "hotelSettings",
  "intercomMessages",
  "corporateInvoices",
  "paymentMethods"
].map((name) => onSnapshot(collection(db, name), () => undefined, () => undefined));

await new Promise((r) => setTimeout(r, 1500));
report("E1 group payments with 20 listeners open", await watchGroupPayments("E1"));

// --- Scenario F — the real app order: burst + 20 listeners + handshake ----
console.log("=== F. FULL APP LOAD SHAPE ===");
others.forEach((u) => u());
const burst = Promise.all(
  Array.from({ length: 6 }, () => auth.currentUser?.getIdToken(true).catch(() => undefined))
);
const others2 = [
  "bookings",
  "reservations",
  "notifications",
  "members",
  "storeOrders",
  "charges",
  "breakfastAudit",
  "otherAddOnAudit"
].map((name) => onSnapshot(collection(db, name), () => undefined, () => undefined));
await burst;
await new Promise((r) => setTimeout(r, 800));
report("F1 group payments 800ms after the burst", await watchGroupPayments("F1"));

others2.forEach((u) => u());

// --- Scenario G — the APP'S EXACT effect, then a forced refresh later -----
// The admin app attaches the ledger listener behind a `getIdToken(true)`
// handshake and then forces ANOTHER token refresh every 30s (the ETR
// `refreshTestRuns` interval). This scenario mirrors both.
console.log("=== G. APP EFFECT SHAPE + a forced refresh WHILE ATTACHED ===");

function appEffect(): { docs: number | null; ms: number | null } {
  const started = Date.now();
  let resolveOuter: (v: { docs: number | null; ms: number | null }) => void = () => {};
  const outer = new Promise<{ docs: number | null; ms: number | null }>((r) => { resolveOuter = r; });
  let settled = false;
  const settle = (docs: number | null) => {
    if (settled) return;
    settled = true;
    resolveOuter({ docs, ms: Date.now() - started });
  };
  void auth.currentUser?.getIdToken(true).then(() => {
    void getDocs(collectionGroup(db, "payments")).then((snap) => {
      console.log(`  G  getDocs(group) -> ${snap.docs.length} docs`);
      settle(snap.docs.length);
    });
    const unsub = onSnapshot(
      collectionGroup(db, "payments"),
      (snap) => {
        console.log(`  G  onSnapshot(group) -> ${snap.docs.length} docs`);
        settle(snap.docs.length);
      },
      (error) => {
        console.log(`  G  onSnapshot(group) ERROR ${String((error as any)?.message || error)}`);
        settle(null);
      }
    );
    setTimeout(() => unsub(), 60000);
  });
  return outer;
}

const gOutcome = await appEffect();
report("G1 app-shaped effect (handshake + getDocs + listener)", {
  docs: gOutcome.docs,
  ms: gOutcome.ms,
  error: gOutcome.docs === null ? "NO SNAPSHOT" : null
});

// Now force a token refresh WHILE the listener is attached (the 30s timer).
console.log("  G2 forcing a token refresh while the listener is attached...");
await auth.currentUser?.getIdToken(true);
await new Promise((r) => setTimeout(r, 4000));
const afterRefresh = await watchGroupPayments("G3");
report("G3 group listener attached AFTER the refresh", afterRefresh);

console.log("---");
console.log("If G1 delivers but the live app does not, the difference is the");
console.log("surrounding app state, not the query. If G3 fails while A/B/C");
console.log("pass, a forced token refresh breaks an ALREADY-attached group");
console.log("listener (the app's 30s ETR refresh).");
process.exit(0);
