// Per RPT-01 (handoff 2026-10-23 §4) — browser repro v3.
//
// v1 (group query alone) and v2 (app-shaped effect + 24 listeners + the 30s
// refresh) both deliver all 20 payment docs. The live admin app still shows
// an empty ledger index.
//
// The one ingredient v2 did NOT have: the app forces SEVEN simultaneous
// ID-token refreshes at load (the auth handler + the reservations,
// notifications, failed-emails, members and the two ledger listeners).
// Each forced refresh mints a new token, the Auth SDK fires
// `onIdTokenChanged`, and the Firestore SDK restarts its listen stream.
//
// This page tests whether a burst of concurrent forced refreshes can make a
// just-attached collection-group listener never deliver its first snapshot.
//
//   node scripts/rpt-01-browser-repro3.mjs
// Open http://localhost:8901/

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
<html><head><meta charset="utf-8"><title>RPT-01 browser repro v3</title></head>
<body style="font-family:monospace;padding:16px">
<h3>RPT-01 browser reproduction v3 — concurrent forced token refreshes</h3>
<pre id="out"></pre>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js";
import { getFirestore, collection, collectionGroup, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js";

const out = document.getElementById("out");
function log(line) { console.log("RPT01v3: " + line); out.textContent += line + "\\n"; }
const CFG = ${JSON.stringify(cfg)};
const TOKEN = ${JSON.stringify(customToken)};

async function main() {
  const app = initializeApp(CFG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  log("signed in uid=" + (await signInWithCustomToken(auth, TOKEN)).user.uid);

  // --- P2: SEVEN concurrent forced refreshes, then attach the listener ---
  log("P2: firing 7 concurrent getIdToken(true) ...");
  const started = Date.now();
  const results = [];
  const refreshes = Array.from({ length: 7 }, (_, i) =>
    auth.currentUser.getIdToken(true).then(
      () => { results.push("ok@" + (Date.now() - started) + "ms"); log("P2 refresh " + i + " resolved " + (Date.now() - started) + "ms"); },
      (e) => { results.push("FAIL@" + (Date.now() - started) + "ms:" + String(e && e.message || e)); log("P2 refresh " + i + " REJECTED " + String(e && e.message || e)); }
    )
  );
  // The app's ledger gate resolves on the first refresh, then attaches.
  await Promise.race(refreshes);
  log("P2: attaching the group listener " + (Date.now() - started) + "ms into the burst");
  const p2 = { docs: null, ms: null };
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 20000);
    onSnapshot(
      collectionGroup(db, "payments"),
      (snap) => { clearTimeout(timer); p2.docs = snap.docs.length; p2.ms = Date.now() - started; log("P2 onSnapshot -> " + snap.docs.length + " docs at " + p2.ms + "ms"); resolve(); },
      (err) => { clearTimeout(timer); log("P2 onSnapshot ERROR " + String(err && err.message || err)); resolve(); }
    );
    void getDocs(collectionGroup(db, "payments"))
      .then((snap) => log("P2 getDocs -> " + snap.docs.length + " docs at " + (Date.now() - started) + "ms"))
      .catch((e) => log("P2 getDocs ERROR " + String(e && e.message || e)));
  });
  await Promise.all(refreshes);
  log("P2 RESULT: " + (p2.docs === null ? "NO SNAPSHOT (ledger would stay EMPTY)" : p2.docs + " docs at " + p2.ms + "ms"));

  // --- P3: attach first, then fire the burst ---------------------------
  log("P3: attach first, then 7 concurrent forced refreshes");
  const p3 = { docs: null, ms: null };
  const t3 = Date.now();
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 20000);
    onSnapshot(
      collectionGroup(db, "payments"),
      (snap) => { clearTimeout(timer); p3.docs = snap.docs.length; p3.ms = Date.now() - t3; log("P3 onSnapshot -> " + snap.docs.length + " docs at " + p3.ms + "ms"); resolve(); },
      (err) => { clearTimeout(timer); log("P3 onSnapshot ERROR " + String(err && err.message || err)); resolve(); }
    );
  });
  await Promise.all(Array.from({ length: 7 }, () => auth.currentUser.getIdToken(true).catch((e) => { log("P3 refresh failed " + String(e && e.message || e)); })));
  await new Promise((r) => setTimeout(r, 6000));
  log("P3 RESULT: " + (p3.docs === null ? "NO SNAPSHOT" : p3.docs + " docs at " + p3.ms + "ms"));

  log("DONE");
}
main().catch((e) => log("FATAL " + String(e && e.stack || e)));
</script>
</body></html>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(8901, () => console.log("listening on http://localhost:8901/"));
