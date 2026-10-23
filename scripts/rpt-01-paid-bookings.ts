// Per RPT-01 (handoff 2026-10-23 §4): print the PER-BOOKING money truth for
// live production, so the admin UI can be checked row-by-row.
//
// The quick-view chips are aggregates, which makes them a poor QA handle: a
// wrong index and a wrong projection produce the same aggregate. This probe
// prints one line per booking that HAS a ledger entry — booking ref, status,
// total, paid, balance, and whether the row would show a "Paid" pill — so a
// single row can be compared against the list row and the booking DRAWER for
// the same booking.
//
// READ-ONLY. Never writes. Prints booking refs and money only — no guest
// names, no emails, no PII.
//
// Usage (needs the esbuild bundle — the shared utils use extensionless
// imports, so `node --experimental-strip-types` cannot resolve them):
//
//   npx esbuild scripts/rpt-01-paid-bookings.ts --bundle --platform=node \
//     --format=esm --outfile=.probe/rpt01-paid.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-paid.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  normalizeLedgerDoc,
  buildBookingPaymentIndex,
  resolveBookingOnsitePayments,
  type PaymentLedgerDoc
} from "../admin-app/src/utils/bookingPaymentEntries";
import { computeBookingFolio } from "../shared/utils/bookingFolio";

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

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);

console.log("project:", env.FIREBASE_PROJECT_ID);
console.log("---");

const paymentSnap = await db.collectionGroup("payments").get();
const refundSnap = await db.collectionGroup("refunds").get();
const ledgerDocs: PaymentLedgerDoc[] = [
  ...paymentSnap.docs.map((d) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>)),
  ...refundSnap.docs.map((d) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>))
];
const index = buildBookingPaymentIndex(ledgerDocs);

const bookingSnap = await db.collection("bookings").get();
const storeOrderSnap = await db.collection("storeOrders").get();

const parseDateString = (val: any): string => {
  if (!val) return "";
  if (typeof val.toDate === "function") return val.toDate().toISOString().split("T")[0];
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string") return val.split("T")[0];
  return "";
};

const bookings = bookingSnap.docs.map((d) => {
  const data = d.data() as Record<string, any>;
  return {
    id: d.id,
    bookingRef: (data.bookingRef as string) || "",
    totalPrice: Number(data.totalPrice) || 0,
    otherAddOnTotal: Number(data.otherAddOnTotal) || 0,
    status: (data.status as string) || "",
    checkIn: parseDateString(data.checkIn),
    onsitePayments: (data.onsitePayments as any[]) || []
  };
});

const storeOrders = storeOrderSnap.docs.map((d) => {
  const data = d.data() as Record<string, any>;
  return {
    bookingId: (data.bookingId as string) || null,
    paymentMethod: (data.paymentMethod as string) || null,
    status: (data.status as string) || null,
    isBilled: (data.isBilled as boolean) || null,
    totalAmount: Number(data.totalAmount) || 0
  };
});

let paidPills = 0;
let balanceDue = 0;
const rows: string[] = [];

for (const booking of bookings) {
  const hydrated = resolveBookingOnsitePayments(booking.id, booking.onsitePayments, index as any);
  const paid = (hydrated ?? []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
  const folio = computeBookingFolio({
    booking: {
      id: booking.id,
      totalPrice: booking.totalPrice,
      otherAddOnTotal: booking.otherAddOnTotal
    },
    persistedPayments: hydrated,
    folioBookingIds: [booking.id],
    storeOrders: storeOrders as any
  });
  const isPaid = paid >= booking.totalPrice && booking.totalPrice > 0;
  if (isPaid) paidPills++;
  if (folio.balance > 0) balanceDue++;

  const entries = index[booking.id] ?? [];
  if (entries.length === 0) continue;

  rows.push(
    [
      booking.bookingRef.padEnd(22),
      booking.status.padEnd(18),
      `total ${String(booking.totalPrice).padStart(7)}`,
      `paid ${String(paid).padStart(7)}`,
      `balance ${String(folio.balance).padStart(7)}`,
      isPaid ? "PAID-PILL" : "         ",
      `entries ${entries.length}`
    ].join("  ")
  );
}

console.log("=== PER-BOOKING MONEY TRUTH (index populated) ===");
for (const row of rows) console.log(row);
console.log("---");
console.log("bookings total:", bookings.length);
console.log("bookings WITH a ledger:", rows.length);
console.log("Paid pills:", paidPills, "| Balance due:", balanceDue);
console.log("---");
console.log("EXPECTED IN THE LIVE LIST: 14 Paid pills, 55 Balance due.");
console.log("IF THE LIVE LIST SHOWS 0 pills / 69 balance due, THE LEDGER INDEX IS EMPTY.");
process.exit(0);
