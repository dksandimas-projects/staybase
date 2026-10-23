// Per RPT-01 (handoff 2026-10-23 §4) — browser-side reproduction.
//
// The admin app's ledger index is empty in the BROWSER but correct from Node
// with the same staff token and the same query. Node has no IndexedDB, so the
// one browser-only difference in the Firestore client is the PERSISTENT LOCAL
// CACHE (enabled by default since firebase-js-sdk v10).
//
// This script serves a self-contained page that runs, in ONE browser tab:
//   1. a plain collection listener      (control — the app's bookings list)
//   2. a collectionGroup listener       (the app's ledger listener)
//   3. a one-shot getDocs(group)        (the app's hydration read)
//   4. the same three on a SECOND
//      Firestore instance created with
//      persistentLocalCache: false      (memory-only — no IndexedDB)
// Every result is logged to the browser console with a RPT01: prefix.
//
// The page embeds a SHORT-LIVED staff custom token (1h). The file is written
// under node_modules/.cache (git-ignored) and is safe to delete.
//
//   node scripts/rpt-01-browser-repro.mjs
// Then open http://localhost:8899/ in the browser and read the console.

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
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

const apiKey = env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY;
const projectId = env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID;
const appId = env.VITE_FIREBASE_APP_ID;
const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
const SDK = "11.10.0";

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>RPT-01 browser repro</title></head>
<body style="font-family:monospace;padding:16px">
<h3>RPT-01 browser reproduction</h3>
<pre id="out"></pre>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js";
import {
  getFirestore, initializeFirestore, memoryLocalCache,
  collection, collectionGroup, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js";

const out = document.getElementById("out");
function log(line) {
  console.log("RPT01: " + line);
  out.textContent += line + "\\n";
}
const CFG = {
  apiKey: ${JSON.stringify(apiKey)},
  authDomain: ${JSON.stringify(authDomain)},
  projectId: ${JSON.stringify(projectId)},
  appId: ${JSON.stringify(appId)}
};
const TOKEN = ${JSON.stringify(customToken)};

async function main() {
  // Instance A — default settings: PERSISTENT IndexedDB cache.
  const appA = initializeApp(CFG);
  const authA = getAuth(appA);
  log("signing in...");
  const cred = await signInWithCustomToken(authA, TOKEN);
  log("signed in uid=" + cred.user.uid);
  const dbA = getFirestore(appA);

  // Instance B — MEMORY-ONLY cache (no IndexedDB).
  const appB = initializeApp(CFG, "repro-memory");
  const authB = getAuth(appB);
  await signInWithCustomToken(authB, TOKEN);
  const dbB = initializeFirestore(appB, { localCache: memoryLocalCache() });
  log("instance B = memoryLocalCache (no IndexedDB)");

  async function run(label, db) {
    const t0 = Date.now();
    const done = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ kind: "TIMEOUT", ms: Date.now() - t0 }), 15000);
      try {
        onSnapshot(
          collectionGroup(db, "payments"),
          (snap) => { clearTimeout(timer); resolve({ kind: "SNAPSHOT", n: snap.docs.length, ms: Date.now() - t0 }); },
          (err) => { clearTimeout(timer); resolve({ kind: "ERROR", err: String(err && err.message || err), ms: Date.now() - t0 }); }
        );
      } catch (e) {
        clearTimeout(timer);
        resolve({ kind: "THROW", err: String(e && e.message || e), ms: Date.now() - t0 });
      }
    });
    log(label + " collectionGroup(payments) listener -> " + JSON.stringify(done));
    return done;
  }

  async function runControl(label, db) {
    const t0 = Date.now();
    const done = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ kind: "TIMEOUT", ms: Date.now() - t0 }), 15000);
      onSnapshot(
        collection(db, "bookings"),
        (snap) => { clearTimeout(timer); resolve({ kind: "SNAPSHOT", n: snap.docs.length, ms: Date.now() - t0 }); },
        (err) => { clearTimeout(timer); resolve({ kind: "ERROR", err: String(err && err.message || err), ms: Date.now() - t0 }); }
      );
    });
    log(label + " collection(bookings) listener -> " + JSON.stringify(done));
    return done;
  }

  async function runGetDocs(label, db) {
    const t0 = Date.now();
    try {
      const snap = await getDocs(collectionGroup(db, "payments"));
      log(label + " getDocs(collectionGroup(payments)) -> " + snap.docs.length + " docs in " + (Date.now() - t0) + "ms");
    } catch (e) {
      log(label + " getDocs(collectionGroup(payments)) -> ERROR " + String(e && e.message || e));
    }
  }

  log("--- instance A (default = persistent IndexedDB cache) ---");
  await runControl("A", dbA);
  await run("A", dbA);
  await runGetDocs("A", dbA);

  log("--- instance B (memoryLocalCache, no IndexedDB) ---");
  await runControl("B", dbB);
  await run("B", dbB);
  await runGetDocs("B", dbB);

  log("DONE");
}
main().catch((e) => { log("FATAL " + String(e && e.stack || e)); });
</script>
</body></html>`;

const file = resolve(process.cwd(), "node_modules/.cache/rpt01/repro.html");
writeFileSync(file, html, "utf8");
console.log("wrote", file);
console.log("serving http://localhost:8899/ (ctrl+c to stop)");

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(8899, () => console.log("listening on 8899"));
