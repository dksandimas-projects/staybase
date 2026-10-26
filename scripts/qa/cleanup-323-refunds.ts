// AI-BROWSER-QA (2026-10-26) — §3.23 cleanup: stamp the settled state on
// the refund records THIS pass created.
//
// The admin's "Record Refund" wrote a settled refund with no `status`
// (§3.23), so the records this pass created are read back as pending
// liabilities. The CODE is fixed; the RECORDS this pass wrote are
// QA fixtures of that broken path, and they are stamped so they look
// like what the fixed code produces.
//
// SCOPE: only a refund whose own `reason` carries this pass's marker
// ("AI-BROWSER-QA 2026-10-26") is touched. Nothing else is read for
// writing, and the one pre-existing status-less refund (a 2026-10-21 QA
// record) is deliberately LEFT ALONE — it belongs to an earlier pass.
//
//   ENV_FILE=guest-app/.env.spark-inn-prod node cleanup-323-refunds.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

const MARKER = "AI-BROWSER-QA 2026-10-26";
let stamped = 0;
let skipped = 0;

for (const parent of ["reservations", "bookings"]) {
  const parents = await db.collection(parent).get();
  for (const p of parents.docs) {
    const refunds = await p.ref.collection("refunds").get();
    for (const e of refunds.docs) {
      const x = e.data() as Record<string, any>;
      const amount = Number(x.amount) || 0;
      if (!(x.type === "refund" || amount < 0)) continue;
      const status = typeof x.status === "string" ? x.status.trim().toLowerCase() : "";
      if (status === "paid" || status === "processed") continue;
      const reason = String(x.reason ?? x.note ?? "");
      if (!reason.includes(MARKER)) {
        skipped += 1;
        continue;
      }
      await e.ref.update({
        status: "paid",
        paidAt: (x.paidAt as Timestamp) ?? Timestamp.now(),
        paidBy: (x.paidBy as string) ?? "qa-cleanup-2026-10-26",
        lastModifiedAt: Timestamp.now()
      });
      stamped += 1;
      console.log(`  stamped ${e.ref.path}  (amount ${amount})`);
    }
  }
}

console.log(`stamped ${stamped} record(s) from this pass; left ${skipped} other status-less refund(s) alone.`);
