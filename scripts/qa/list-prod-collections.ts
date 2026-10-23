// Per AI-BROWSER-QA (2026-10-23): enumerate every production Firestore root
// collection with its document count, and locate the staff/role records and
// the QA identities. READ-ONLY. Emails are masked.

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

const mask = (s: string) => s.replace(/^(.).*(@.*)$/, "$1***$2");

console.log("=== root collections ===");
const cols = await db.listCollections();
const counts: Array<[string, number]> = [];
for (const c of cols) {
  const n = await c.count().get().then((s) => s.data().count);
  counts.push([c.id, n]);
}
counts.sort((a, b) => b[1] - a[1]);
for (const [id, n] of counts) console.log(`  ${String(n).padStart(5)}  ${id}`);

console.log("\n=== staff-like collections, full dump (emails masked) ===");
for (const [id] of counts) {
  if (!/staff|user|account|member|guest/i.test(id)) continue;
  const snap = await db.collection(id).get();
  if (snap.empty) {
    console.log(`  ${id}: EMPTY`);
    continue;
  }
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (/email|name|phone|address|password|token|secret|note/i.test(k)) {
        out[k] = typeof v === "string" ? mask(v) : "<redacted>";
      } else {
        out[k] = v;
      }
    }
    console.log(`  ${id}/${d.id}: ${JSON.stringify(out).slice(0, 400)}`);
  }
}

console.log("\n=== Firebase Auth identities (email masked, role/last-login kept) ===");
try {
  const list = await app.auth().listUsers(100);
  for (const u of list.users) {
    console.log(
      `  uid=${u.uid.slice(0, 12)}… email=${mask(u.email || "")} ` +
        `disabled=${u.disabled} created=${u.metadata.creationTime} lastSignIn=${u.metadata.lastSignInTime || "never"}`
    );
  }
  console.log(`  total auth users: ${list.users.length}`);
} catch (e) {
  console.log(`  ERR listing auth users: ${String(e).slice(0, 300)}`);
}
