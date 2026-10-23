// Per RPT-01 (handoff 2026-10-23 §4) — browser repro v2.
//
// v1 proved the Firestore group query works in a browser (20 docs in 129ms,
// persistent AND memory cache). The live admin app still shows an empty
// ledger index. The only remaining difference is the COMBINATION the app
// creates: ~20 concurrent listeners, the app's gate shape
// (`getIdToken(true).then(...)`), and a forced token refresh every 30s
// (the ETR `refreshTestRuns` interval).
//
// This page runs that combination and logs every step. Then it re-runs with
// the 30s refresh removed, to bisect the trigger.
//
//   node scripts/rpt-01-browser-repro2.mjs
// Open http://localhost:8900/

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const envFile = process.env.ENV_FILE || "guest-app/.env.spark-inn-prod";
const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), envFile), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq === -1) return [line, ""];
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, eq).trim(), value.replace(/\\n/g, "\n")];
    })
);

const adminApp = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const STAFF_UID = process.env.STAFF_UID || "Ae2IX8AzLChNB45HgLWiwXb7xLf2";
const customToken = await getAuth(adminApp).createCustomToken(STAFF_UID);

const SDK = "11.10.0";
const cfg = {
  apiKey: env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>RPT-01 browser repro v2</title></head>
<body style="font-family:monospace;padding:16px">
<h3>RPT-01 browser reproduction v2 — app-shaped load</h3>
<pre id="out"></pre>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js";
import { getAuth, signInWithCustomToken, getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js";
import { getFirestore, collection, collectionGroup, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js";

const out = document.getElementById("out");
function log(line) {
  console.log("RPT01v2: " + line);
  out.textContent += line + "\\n";
}
const CFG = ${JSON.stringify(cfg)};
const TOKEN = ${JSON.stringify(customToken)};

// The app's other top-level collections (the ones AdminContext opens).
const APP_COLLECTIONS = [
  "bookings", "reservations", "notifications", "members", "storeOrders",
  "charges", "breakfastAudit", "otherAddOnAudit", "callSessions", "rooms",
  "rates", "vouchers", "inquiries", "corporateInquiries", "dailyCloses",
  "roomTypes", "hotelSettings", "intercomMessages", "corporateInvoices",
  "paymentMethods", "guests", "roomBlocks", "failedEmails", "testRuns"
];

async function main() {
  const app = initializeApp(CFG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  log("signed in uid=" + (await signInWithCustomToken(auth, TOKEN)).user.uid);

  const unsubs = [];

  // ---- the app's auth handler: ONE forced refresh per uid, then set user
  let currentUser = null;
  let forcedFor = null;
  onAuthStateChanged(auth, async (user) => {
    if (!user) { currentUser = null; return; }
    try {
      const needsForced = forcedFor !== user.uid;
      const tr = await getIdTokenResult(user, needsForced);
      forcedFor = user.uid;
      currentUser = { uid: user.uid, role: tr.claims.role };
      log("auth handler: currentUser set uid=" + user.uid + " role=" + tr.claims.role);
    } catch (e) {
      log("auth handler FAILED: " + String(e && e.message || e));
    }
  });

  await new Promise((r) => setTimeout(r, 1500));
  log("currentUser=" + (currentUser ? currentUser.uid : "NULL"));

  // ---- the app's other ~24 listeners -------------------------------------
  for (const name of APP_COLLECTIONS) {
    try {
      unsubs.push(onSnapshot(collection(db, name), () => {}, (e) => log("listener " + name + " error: " + String(e && e.message || e))));
    } catch (e) {
      log("listener " + name + " threw: " + String(e && e.message || e));
    }
  }
  log("opened " + unsubs.length + " other listeners");
  await new Promise((r) => setTimeout(r, 1200));

  // ---- the app's LEDGER effect shape -------------------------------------
  let cancelled = false;
  let ledgerState = "not-started";
  function ledgerEffect(tag) {
    log(tag + " ledger effect: running");
    const started = Date.now();
    void auth.currentUser?.getIdToken(true).then(() => {
      if (cancelled) { log(tag + " ledger: gate resolved but CANCELLED"); return; }
      log(tag + " ledger: gate resolved after " + (Date.now() - started) + "ms -> attaching");
      void getDocs(collectionGroup(db, "payments"))
        .then((snap) => log(tag + " ledger: getDocs -> " + snap.docs.length + " docs in " + (Date.now() - started) + "ms"))
        .catch((e) => log(tag + " ledger: getDocs ERROR " + String(e && e.message || e)));
      const un = onSnapshot(
        collectionGroup(db, "payments"),
        (snap) => { ledgerState = snap.docs.length + " docs"; log(tag + " ledger: onSnapshot -> " + snap.docs.length + " docs in " + (Date.now() - started) + "ms"); },
        (err) => { log(tag + " ledger: onSnapshot ERROR " + String(err && err.message || err)); }
      );
      unsubs.push(un);
    }).catch((e) => {
      log(tag + " ledger: GATE REJECTED -> " + String(e && e.message || e) + " (listener never attaches)");
    });
  }

  ledgerEffect("P1");
  await new Promise((r) => setTimeout(r, 8000));
  log("P1 ledgerState=" + ledgerState);

  // ---- the app's 30s forced refresh (ETR refreshTestRuns) -----------------
  log("starting the 30s forced-refresh interval");
  const interval = setInterval(() => {
    void auth.currentUser?.getIdToken(true).then(
      () => log("30s refresh ok"),
      (e) => log("30s refresh FAILED " + String(e && e.message || e))
    );
  }, 30000);

  await new Promise((r) => setTimeout(r, 35000));
  log("after 35s with the 30s refresh running, ledgerState=" + ledgerState);

  clearInterval(interval);
  cancelled = true;
  unsubs.forEach((u) => u());

  // ---- bisect: same shape WITHOUT the 30s refresh -----------------------
  log("--- bisect: fresh instance, no 30s refresh ---");
  const app2 = initializeApp(CFG, "v2-b");
  const auth2 = getAuth(app2);
  const db2 = getFirestore(app2);
  await signInWithCustomToken(auth2, TOKEN);
  let state2 = "not-started";
  const unsubs2 = APP_COLLECTIONS.map((name) => onSnapshot(collection(db2, name), () => {}, () => {}));
  await new Promise((r) => setTimeout(r, 1200));
  void auth2.currentUser?.getIdToken(true).then(() => {
    void getDocs(collectionGroup(db2, "payments"))
      .then((snap) => log("Q1 getDocs -> " + snap.docs.length + " docs"))
      .catch((e) => log("Q1 getDocs ERROR " + String(e && e.message || e)));
    onSnapshot(
      collectionGroup(db2, "payments"),
      (snap) => { state2 = snap.docs.length + " docs"; log("Q1 onSnapshot -> " + snap.docs.length + " docs"); },
      (err) => log("Q1 onSnapshot ERROR " + String(err && err.message || err))
    );
  }).catch((e) => log("Q1 GATE REJECTED " + String(e && e.message || e)));
  await new Promise((r) => setTimeout(r, 8000));
  log("Q1 ledgerState=" + state2);
  unsubs2.forEach((u) => u());
  log("DONE");
}
main().catch((e) => log("FATAL " + String(e && e.stack || e)));
</script>
</body></html>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(8900, () => console.log("listening on http://localhost:8900/"));
