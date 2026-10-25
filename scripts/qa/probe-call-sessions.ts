// AI-BROWSER-QA (2026-10-23) — why does the admin's
// collectionGroup("callSessions") listener fail with "Missing or insufficient
// permissions"?
//
// A Firestore collection-group query is DENIED unless the rules can prove
// access for EVERY document in the group. The rules grant
// callSessions/{token} and callSessions/{token}/iceCandidates/{id}
// unconditionally — so if any callSessions document lives under a DIFFERENT
// parent, the whole group query is denied for everyone.
//
// READ-ONLY.

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
const db = getFirestore();

console.log("=== every callSessions document path in production ===");
const group = await db.collectionGroup("callSessions").get();
console.log(`  ${group.size} document(s) in the 'callSessions' collection group`);
const parents = new Map<string, number>();
for (const d of group.docs) {
  const p = d.ref.parent.parent!.path; // strip the doc id → the grandparent path
  parents.set(p, (parents.get(p) || 0) + 1);
}
for (const [p, n] of parents) console.log(`  parent: ${p}  (${n} doc(s))`);

console.log("\n=== intercoms collection: nested callSessions? ===");
const intercoms = await db.collection("intercoms").get();
console.log(`  ${intercoms.size} intercom doc(s)`);
let nested = 0;
for (const d of intercoms.docs) {
  const sub = await d.ref.collection("callSessions").get();
  if (!sub.empty) {
    nested += sub.size;
    console.log(`  intercoms/${d.id}/callSessions -> ${sub.size} doc(s)`);
  }
}
console.log(`  nested callSessions under intercoms: ${nested}`);

console.log("\n=== other possible parents ===");
for (const parent of ["bookings", "reservations", "storeOrders", "callSessions"]) {
  const snap = await db.collection(parent).get();
  let n = 0;
  for (const d of snap.docs) {
    const sub = await d.ref.collection("callSessions").get();
    n += sub.size;
  }
  if (n > 0) console.log(`  ${parent}/{id}/callSessions -> ${n} doc(s)`);
}
