// The production → staging export.
//
// The Admin app's Settings → Environment Testing → "Refresh Staging From
// Production" panel tells the operator to paste the JSON produced by
// this export. The file the UI names (`scripts/export-prod-data.mjs`)
// did not exist (QA-REPORT-2026-10-21 §F-A6 / QA-BACKLOG-2026-10-26
// F-A6), so the instruction was a dead end: the operator was told to
// run a file that was not there.
//
// THIS SCRIPT IS THAT EXPORT. It reads PRODUCTION (read-only) and
// writes a JSON payload shaped exactly as the server's staging-refresh
// gate accepts:
//
//     { "export": { "bookings": [...], "storeOrders": [...], "members": [...] } }
//
// The top level is EXACTLY `export`, and `export` has EXACTLY three
// keys — the server's schema is strict.
//
// ─────────────────────────────────────────────────────────────────────
// WHAT IT DOES AND DOES NOT DO
//
// READ-ONLY against production. Every Firestore call in this file is a
// `.get()`. There is no `.set()`, no `.update()`, no `.delete()`, no
// `.write()`, no batch commit.
//
// The payload contains REAL GUEST PII — names, emails, phones. That is
// the point: the server's sanitization engine
// (`sanitizeBookingExport` / `sanitizeStoreOrderExport` /
// `sanitizeMemberExport` in `guest-app/server/handlers/test-runs.ts`)
// is what scrubs it, and it runs on the SERVER so the mapping stays
// server-owned. This script deliberately does NOT pre-scrub: a second
// sanitizer here would be a second implementation of a rule, and it is
// the one that drifts.
//
// The output file is therefore SENSITIVE. It is written under `tmp/`
// (gitignored) by default, never to a tracked path.
//
// ─────────────────────────────────────────────────────────────────────
// THE MONEY
//
// The ledger does NOT live on the booking doc. It lives in Firestore
// SUBCOLLECTIONS:
//
//     reservations/{rid}/payments/{rowId}   ← the canonical payment source
//     reservations/{rid}/refunds/{rowId}    ← the canonical refund source
//     reservations/{rid}/charges/{rowId}    ← incidental charges
//     bookings/{bid}/payments|refunds|charges/{rowId}  ← the legacy shape
//
// and 0 of 157 production bookings carry a `balanceDue` field at all.
// An export that dumped the booking docs verbatim would therefore
// export 157 bookings with NO money on them.
//
// So the export reads the three ledger COLLECTIONS, attributes each row
// to its booking (stamped `bookingId`, else the legacy path), and
// computes the balance with the SHARED canonical helper
// (`computeBookingFolio` from `@spark-inn/shared`) — the same code the
// app's own money surfaces read, so an exported balance cannot disagree
// with what the app would show.
//
// Refund sign convention: a refund is stored NEGATIVE and it is a
// LIABILITY until it is paid out. The shared helper (`isUnpaidRefund`)
// excludes a refund whose status is not "paid"/"processed" from the
// collected money, so the export carries the refund's RAW `status`
// through — dropping it would make a pending refund indistinguishable
// from a paid one.
//
// ─────────────────────────────────────────────────────────────────────
// THE SPLIT
//
// The money math is the audited part, so it lives in a PURE module:
//
//     scripts/qa/lib/export-payload.ts
//         — no firebase-admin, no side effects, no I/O, no top-level await
//         — proven by scripts/qa/__tests__/export-payload.test.ts
//
// This file does the Firestore reads and the normalization, then hands
// the rows to that module.
//
// ─────────────────────────────────────────────────────────────────────
// USAGE
//
//   npx esbuild scripts/qa/export-prod-data.ts --bundle --platform=node \
//     --format=esm --outfile=tmp/qa/export-prod-data.mjs --external:firebase-admin
//   node tmp/qa/export-prod-data.mjs --out tmp/qa/prod-export.json
//
//   --out <path>   the output file   (default: tmp/qa/prod-export.json)
//   --env <path>   the env file      (default: guest-app/.env.spark-inn-prod)
//                  (the ENV_FILE environment variable also works)
//
// The bundle must live INSIDE the repo so node resolves `firebase-admin`.
//
// (The script is TypeScript with top-level await, so it is BUNDLED to
// ESM by esbuild and run from the bundle — the same shape as
// `qa:reconcile`. Running a top-level-await script directly under the
// repo's CommonJS package would fail.)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  buildExportPayload,
  normalizeTimestamp,
  toPlainDoc,
  type LedgerRow
} from "./lib/export-payload";

// ── args ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(`--${name}=`.length) : undefined;
};

const OUT_FILE = opt("out") || "tmp/qa/prod-export.json";
const ENV_FILE = opt("env") || process.env.ENV_FILE || "guest-app/.env.spark-inn-prod";

// ── env ───────────────────────────────────────────────────────────────
//
// Mirrors `scripts/qa/reconcile-production.ts`: a flat KEY=VALUE file,
// `#` comments, optional surrounding quotes, `\n` escapes.

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
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

const env = loadEnv(ENV_FILE);

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);

// ── helpers ───────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ── read production ───────────────────────────────────────────────────

console.log(`Reading production Firestore (${env.FIREBASE_PROJECT_ID}) ...`);

const bookingSnap = await db.collection("bookings").get();
const storeOrderSnap = await db.collection("storeOrders").get();
const memberSnap = await db.collection("members").get();

// The ledger lives in SUBCOLLECTIONS, so it is read with
// `collectionGroup` — one query per collection, not one per parent.
//
//   collectionGroup("payments") → reservations/{rid}/payments, bookings/{bid}/payments,
//                                  storeOrders/{oid}/payments (the till tenders —
//                                  excluded by the path filter in the pure module)
//   collectionGroup("refunds")  → reservations/{rid}/refunds,  bookings/{bid}/refunds
//   collectionGroup("charges")  → reservations/{rid}/charges,  bookings/{bid}/charges
//
// READ-ONLY: `.get()` and nothing else.
const paymentSnap = await db.collectionGroup("payments").get();
const refundSnap = await db.collectionGroup("refunds").get();
const chargeSnap = await db.collectionGroup("charges").get();

console.log(
  `  bookings=${bookingSnap.size} storeOrders=${storeOrderSnap.size} ` +
    `members=${memberSnap.size} payments=${paymentSnap.size} ` +
    `refunds=${refundSnap.size} charges=${chargeSnap.size}`
);

/**
 * Normalize one ledger document into the row shape the pure module
 * expects. The STAMPED `data.bookingId` is carried through untouched
 * (null when the row carries none) — the pure module owns the
 * attribution rule (stamped id, else the legacy `bookings/{id}/...`
 * path, else dropped-and-counted).
 */
function toLedgerRow(doc: {
  id: string;
  ref: { path: string };
  data: () => Record<string, unknown>;
}): LedgerRow {
  const data = doc.data() as Record<string, unknown>;
  const stamped =
    typeof data.bookingId === "string" && data.bookingId.trim()
      ? data.bookingId.trim()
      : null;
  return {
    id: doc.id,
    path: doc.ref.path,
    bookingId: stamped,
    // The amount EXACTLY as stored — refunds are stored negative and
    // the sign is preserved all the way into the payload.
    amount: num(data.amount),
    method: str(data.method),
    status: str(data.status),
    recordedAt: normalizeTimestamp(data.recordedAt),
    category: str(data.category),
    label: str(data.label)
  };
}

const paymentRows: LedgerRow[] = paymentSnap.docs.map((d) => toLedgerRow(d as never));
const refundRows: LedgerRow[] = refundSnap.docs.map((d) => toLedgerRow(d as never));
const chargeRows: LedgerRow[] = chargeSnap.docs.map((d) => toLedgerRow(d as never));

// ── the production docs ───────────────────────────────────────────────
//
// Every doc gets its Firestore document id as `id` — the server writes
// `doc(String(booking.id))`, so without it the import has no key.
// Production docs do NOT carry an `id` field of their own.

const bookings = bookingSnap.docs.map((d) => ({
  id: d.id,
  ...toPlainDoc(d.data() as Record<string, unknown>)
}));

const storeOrders = storeOrderSnap.docs.map((d) => ({
  id: d.id,
  ...toPlainDoc(d.data() as Record<string, unknown>)
}));

const members = memberSnap.docs.map((d) => ({
  id: d.id,
  ...toPlainDoc(d.data() as Record<string, unknown>)
}));

// ── assemble ──────────────────────────────────────────────────────────
//
// The pure module owns the attribution, the assembly and the money math
// (via the shared `computeBookingFolio`).

const { payload, stats } = buildExportPayload({
  bookings,
  storeOrders,
  members,
  paymentRows,
  refundRows,
  chargeRows
});

// ── write ─────────────────────────────────────────────────────────────

const outAbs = resolve(process.cwd(), OUT_FILE);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, JSON.stringify(payload, null, 2), "utf8");

// ── summary ───────────────────────────────────────────────────────────
//
// COUNTS AND OPERATIONAL IDS ONLY. No guest name, no email, no phone,
// no note, no amount — this output lands in an operator's terminal and
// in CI logs. The production PII lives in the FILE only.

console.log("");
console.log("Production export written.");
console.log(`  output file             : ${OUT_FILE}`);
console.log(`  bookings                : ${stats.bookings}`);
console.log(`  storeOrders             : ${stats.storeOrders}`);
console.log(`  members                 : ${stats.members}`);
console.log(`  ledger rows read        : ${stats.ledgerRowsRead}`);
console.log(`  ledger rows attributed  : ${stats.ledgerRowsAttributed}`);
console.log(`  ledger rows dropped     : ${stats.ledgerRowsDropped}`);
console.log(`  bookings with a balance : ${stats.bookingsWithBalance}`);
console.log("");
console.log(
  "WARNING: this file contains PRODUCTION PII (guest names, emails, phones).\n" +
    "         It must NOT be committed. The default path is under tmp/ (gitignored);\n" +
    "         the server's sanitizer scrubs it during the staging refresh."
);
