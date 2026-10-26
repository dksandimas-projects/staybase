// AI-BROWSER-QA (2026-10-26) — §3.7 cleanup: repair the store orders this
// project's QA passes created by CANCELLING A DELIVERED ORDER.
//
// The desk's order actions used to be a raw client-side Firestore write
// (§3.7), so the state machine existed only as UI buttons: a staff
// client could write any status onto any order — including cancelling a
// DELIVERED order whose direct-payment tender had already been
// recorded. The result is a cancelled order that still holds a cash
// tender: money collected against a void order, and a reconciliation
// delta that never closes.
//
// The CODE is fixed (the transitions are server-owned now, and the
// server refuses any transition on an order that holds a tender). The
// RECORDS the broken path wrote are QA fixtures of it, and they are
// repaired here so they look like what the fixed code produces.
//
// SCOPE: only a store order that is BOTH
//   - tagged as test data (`isTestData === true`), AND
//   - cancelled with a reason carrying this project's QA marker
//     ("QA-TEST A7"), AND
//   - holding a `delivery-tender`
// is touched. No live order can match all three, and a record without
// the marker is never written.
//
// THE REPAIR: the order was genuinely DELIVERED (it has a `deliveredAt`
// and a recorded tender), so it goes back to `delivered`, and the
// cancellation fields are cleared. The shelf count is deliberately LEFT
// ALONE — the order's line item is the same QA probe item the ST-04
// scenario drives, whose documented baseline is 10, so the shelf is a
// fixture rather than a ledger.
//
//   ENV_FILE=guest-app/.env.spark-inn-prod node cleanup-37-store-orders.mjs

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

const MARKER = "QA-TEST A7";
let repaired = 0;
let skipped = 0;

const orders = await db.collection("storeOrders").get();
for (const d of orders.docs) {
  const x = d.data() as Record<string, any>;
  if (x.isTestData !== true) continue;
  if (x.status !== "cancelled") continue;

  const reason = String(x.cancellationReason ?? "");
  if (!reason.includes(MARKER)) {
    skipped += 1;
    continue;
  }

  const tender = await d.ref.collection("payments").doc("delivery-tender").get();
  if (!tender.exists) {
    skipped += 1;
    continue;
  }

  const tenderAmount = Number((tender.data() as Record<string, any>)?.amount ?? 0);
  await d.ref.update({
    status: "delivered",
    cancellationReason: "",
    // The stock was never legitimately restored — the items really
    // were delivered. The shelf count itself is left alone (see the
    // header): the line item is the QA probe item, whose documented
    // baseline is 10.
    stockRestoredAt: null,
    qaRepairedAt: Timestamp.now(),
    qaRepairNote: `AI-BROWSER-QA 2026-10-26 §3.7 — restored to "delivered"; it was cancelled after delivery, leaving a tender against a void order.`,
    updatedAt: Timestamp.now()
  });
  repaired += 1;
  console.log(`  repaired ${d.ref.path}  (${x.orderRef})  tender ${tenderAmount} · reason was ${JSON.stringify(reason)}`);
}

console.log(`repaired ${repaired} QA store order(s); left ${skipped} other cancelled test order(s) alone.`);
