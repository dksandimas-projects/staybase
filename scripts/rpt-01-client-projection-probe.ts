// Per RPT-01 (handoff 2026-10-23 §4) — client-side projection probe.
//
// The instrumented admin app shows the ledger INDEX populated (17 keys from
// 20 payment + 3 refund docs) yet every row still reads ₱0 paid, so the
// per-booking lookup must be missing. This probe runs the app's exact
// client-side path — CLIENT SDK, the app's own
// `normalizeLedgerDoc` / `buildBookingPaymentIndex` /
// `resolveBookingOnsitePayments` utils — and reports, per booking, whether
// the index resolves an entry for the booking doc id.
//
// READ-ONLY. Never writes. Prints booking ids and money only, no PII.
//
//   npx esbuild scripts/rpt-01-client-projection-probe.ts --bundle \
//     --platform=node --format=esm --outfile=.probe/rpt01-proj.mjs \
//     --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-proj.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { initializeApp as initClient, getApps } from "firebase/app";
import { getAuth as getClientAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collection, collectionGroup, onSnapshot } from "firebase/firestore";

import {
  normalizeLedgerDoc,
  buildBookingPaymentIndex,
  resolveBookingOnsitePayments,
  type PaymentLedgerDoc
} from "../admin-app/src/utils/bookingPaymentEntries";

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
const STAFF_UID = process.env.STAFF_UID || "Ae2IX8AzLChNB45HgLWiwXb7xLf2";
const customToken = await getAuth(adminApp).createCustomToken(STAFF_UID);

const clientApp = getApps().length ? getApps()[0] : initClient({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID
});
const auth = getClientAuth(clientApp);
await signInWithCustomToken(auth, customToken);
const db = getFirestore(clientApp);

const waitFor = (subscribe: (cb: (docs: any[]) => void) => () => void): Promise<any[]> =>
  new Promise((done) => {
    const unsub = subscribe((docs) => {
      unsub();
      done(docs);
    });
  });

console.log("project:", env.VITE_FIREBASE_PROJECT_ID, "| staff uid:", STAFF_UID);
console.log("---");

// The app's group listeners, through the CLIENT SDK.
const paymentDocs = await waitFor((cb) =>
  onSnapshot(collectionGroup(db, "payments"), (snap) => cb(snap.docs))
);
const refundDocs = await waitFor((cb) =>
  onSnapshot(collectionGroup(db, "refunds"), (snap) => cb(snap.docs))
);
const bookingDocs = await waitFor((cb) =>
  onSnapshot(collection(db, "bookings"), (snap) => cb(snap.docs))
);

const ledgerDocs: PaymentLedgerDoc[] = [
  ...paymentDocs.map((d: any) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>)),
  ...refundDocs.map((d: any) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>))
];
const index = buildBookingPaymentIndex(ledgerDocs);
const indexKeys = Object.keys(index);

console.log("client-side ledger docs:", ledgerDocs.length, "| index keys:", indexKeys.length);
console.log("sample index keys:", indexKeys.slice(0, 3));
console.log("sample booking ids:", bookingDocs.slice(0, 3).map((d: any) => d.id));

let resolved = 0;
let resolvedWithMoney = 0;
const misses: string[] = [];
for (const doc of bookingDocs as any[]) {
  const legacy = (doc.data()?.onsitePayments ?? []) as any[];
  const entries = resolveBookingOnsitePayments(doc.id, legacy, index as any);
  if (entries.length > 0) {
    resolved += 1;
    if (entries.reduce((s: number, e: any) => s + (e.amount || 0), 0) > 0) resolvedWithMoney += 1;
  } else if (indexKeys.length > 0) {
    misses.push(doc.id);
  }
}
console.log("---");
console.log("bookings:", bookingDocs.length);
console.log("bookings whose ledger RESOLVES via the index:", resolved, "| with money:", resolvedWithMoney);
console.log("bookings that did NOT resolve:", misses.length, misses.slice(0, 5));
console.log("---");
console.log(resolved >= 17
  ? "=> The CLIENT-side lookup HITS. The app's rows should hydrate => the bug is in the app's React wiring."
  : "=> The CLIENT-side lookup MISSES => the index keys do not match the booking doc ids from the client SDK.");
process.exit(0);
