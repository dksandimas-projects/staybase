// AI-BROWSER-QA (2026-10-26) — find every refund record that carries NO
// `status`, i.e. every refund that every reader classifies as a PENDING
// liability.
//
// §3.23: the admin's "Record Refund" (`handleAddRefund` → `markRefundPaid`,
// the CRL-01 branch) creates a refund with no `status`, while the write
// path decrements `booking.paidAmount` as if the money had left the till.
//
// READ-ONLY.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
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
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY
    }),
    projectId: env.FIREBASE_PROJECT_ID
  });
}
const db = getFirestore();

const rows: { path: string; amount: number; category: string; method: string; reason: string }[] = [];

for (const [parent, collection] of [
  ["bookings", "refunds"],
  ["bookings", "payments"],
  ["reservations", "refunds"],
  ["reservations", "payments"]
] as [string, string][]) {
  const parents = await db.collection(parent).get();
  for (const p of parents.docs) {
    const entries = await p.ref.collection(collection).get();
    for (const e of entries.docs) {
      const x = e.data() as Record<string, any>;
      const amount = Number(x.amount) || 0;
      const isRefund = x.type === "refund" || amount < 0;
      if (!isRefund) continue;
      const status = typeof x.status === "string" ? x.status.trim().toLowerCase() : "";
      if (status === "paid" || status === "processed") continue;
      rows.push({
        path: e.ref.path,
        amount,
        category: String(x.category ?? "<none>"),
        method: String(x.method ?? "<none>"),
        reason: String(x.reason ?? x.note ?? "").slice(0, 60)
      });
    }
  }
}

const noStatus = rows.filter((r) => !/pending/.test(r.method));
console.log(`refunds with no settled status: ${rows.length}`);
console.log(`  of which the method is not "pending": ${noStatus.length}`);
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  console.log(
    `  ${r.amount}  category=${r.category}  method=${r.method}  ${r.path}\n      reason="${r.reason}"`
  );
}
