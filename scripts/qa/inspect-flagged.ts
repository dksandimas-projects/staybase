// Per AI-BROWSER-QA (2026-10-23): targeted inspection of the records the
// reconciliation flagged. READ-ONLY. Prints SHAPES and MONEY FIELDS only —
// never a guest name, email, phone, proof path or token.
//
//   npx esbuild scripts/qa/inspect-flagged.ts --bundle --platform=node \
//     --format=esm --outfile=tmp/qa-2026-10-23/inspect.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node tmp/qa-2026-10-23/inspect.mjs

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

const REDACT = /^(guest|owner|customer|first|last|full|email|phone|address|note|reason|paymentProof|discountId|guests|idPhoto|signature|emergency|comment)$/i;
function shape(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) {
    if (depth > 3) return `[array:${v.length}]`;
    return v.slice(0, 3).map((x) => shape(x, depth + 1));
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto && proto.constructor && proto.constructor.name === "Timestamp") {
      return (v as unknown as { toDate: () => Date }).toDate().toISOString();
    }
    if (typeof (v as { toDate?: unknown }).toDate === "function") {
      return (v as unknown as { toDate: () => Date }).toDate().toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? "<redacted>" : shape(val, depth + 1);
    }
    return out;
  }
  if (typeof v === "string" && v.length > 60) return v.slice(0, 60) + "…";
  return v;
}

function section(title: string) {
  console.log("\n" + "=".repeat(78) + "\n" + title + "\n" + "=".repeat(78));
}

// ---------------------------------------------------------------------------
section("1. REFUND DOCS — the whole set (status / amount / bookingId / category)");
const refunds = await db.collectionGroup("refunds").get();
for (const d of refunds.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.ref.path}\n     amount=${JSON.stringify(x.amount)} type=${JSON.stringify(x.type)} ` +
      `status=${JSON.stringify(x.status)} bookingId=${JSON.stringify(x.bookingId)} ` +
      `reservationId=${JSON.stringify(x.reservationId)} category=${JSON.stringify(x.category)} ` +
      `recordedAt=${JSON.stringify(shape(x.recordedAt))} markedPaidAt=${JSON.stringify(shape(x.markedPaidAt))}`
  );
}

// ---------------------------------------------------------------------------
section("2. PAYMENT DOCS — status / amount / bookingId (whole set, compact)");
const payments = await db.collectionGroup("payments").get();
for (const d of payments.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${d.ref.path}  amount=${JSON.stringify(x.amount)} status=${JSON.stringify(x.status)} ` +
      `bookingId=${JSON.stringify(x.bookingId)} method=${JSON.stringify(x.method)}`
  );
}

// ---------------------------------------------------------------------------
section("3. THE FLAGGED BOOKINGS — money + allocation + breakfast shape");
const refs = [
  "SI-20261021-00011",
  "SI-20261021-00006",
  "SI-20261021-00058",
  "SI-20261021-00060",
  "SI-20261021-00061",
  "SI-20261021-00052",
  "SI-20261021-00053",
  "SI-20261021-00055",
  "SI-20261021-00048"
];
const bookings = await db.collection("bookings").get();
for (const d of bookings.docs) {
  const x = d.data() as Record<string, unknown>;
  const ref = String(x.bookingRef || "");
  if (!refs.includes(ref)) continue;
  console.log(`\n  --- ${ref} (${d.id}) ---`);
  console.log(`     status=${x.status} source=${x.source} checkIn=${x.checkIn} checkOut=${x.checkOut}`);
  console.log(`     totalPrice=${x.totalPrice} otherAddOnTotal=${x.otherAddOnTotal} breakfastTotal=${x.breakfastTotal}`);
  console.log(`     paidAmount=${JSON.stringify(x.paidAmount)} hasAnyBreakfast=${JSON.stringify(x.hasAnyBreakfast)}`);
  console.log(`     revenueAllocation=${JSON.stringify(shape(x.revenueAllocation))}`);
  console.log(`     breakfastSelections=${JSON.stringify(shape(x.breakfastSelections))}`);
  console.log(`     rateBreakdown=${JSON.stringify(shape(x.rateBreakdown))}`);
  console.log(`     refundLiability=${JSON.stringify(shape(x.refundLiability))}`);
  console.log(`     onsitePayments=${JSON.stringify(shape(x.onsitePayments))}`);
}

// ---------------------------------------------------------------------------
section("4. VOUCHER DOCS — full shape (to find the real usage-count field)");
const vouchers = await db.collection("vouchers").get();
for (const d of vouchers.docs) {
  console.log(`\n  ${d.id}: ${JSON.stringify(shape(d.data()), null, 2)}`);
}

// ---------------------------------------------------------------------------
section("5. RESERVATIONS WITHOUT A BOOKING + BOOKINGS WITHOUT A RESERVATION");
const reservations = await db.collection("reservations").get();
const bookingResIds = new Set(
  bookings.docs.map((d) => (d.data() as Record<string, unknown>).reservationId as string).filter(Boolean)
);
for (const d of reservations.docs) {
  if (bookingResIds.has(d.id)) continue;
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  RES ${d.id}: ref=${JSON.stringify(x.reservationRef)} status=${JSON.stringify(x.status)} ` +
      `bookingIds=${JSON.stringify(x.bookingIds)} roomCount=${JSON.stringify(x.roomCount)} ` +
      `totalPrice=${JSON.stringify(x.totalPrice)} createdAt=${JSON.stringify(shape(x.createdAt))}`
  );
}
for (const d of bookings.docs) {
  const x = d.data() as Record<string, unknown>;
  if (x.reservationId) continue;
  console.log(
    `  BOOKING WITHOUT RESERVATION ${x.bookingRef} (${d.id}): status=${x.status} ` +
      `totalPrice=${x.totalPrice} source=${x.source} checkIn=${x.checkIn}`
  );
}

// ---------------------------------------------------------------------------
section("6. STORE ORDERS — full money shape");
const orders = await db.collection("storeOrders").get();
for (const d of orders.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  ${x.orderRef} id=${d.id} status=${x.status} pm=${x.paymentMethod} total=${x.totalAmount} ` +
      `isBilled=${x.isBilled} billedToRoom=${x.billedToRoom} bookingId=${JSON.stringify(x.bookingId)} ` +
      `cancelledAt=${JSON.stringify(shape(x.cancelledAt))}`
  );
}

// ---------------------------------------------------------------------------
section("7. SETTINGS — vouchers / breakfast config / rewards config presence");
for (const id of ["breakfastConfig", "rewardsConfig", "hotelConfig", "storeConfig"]) {
  const d = await db.collection("settings").doc(id).get();
  if (!d.exists) {
    console.log(`  settings/${id}: MISSING`);
    continue;
  }
  const x = d.data() as Record<string, unknown>;
  if (id === "breakfastConfig") {
    console.log(
      `  settings/breakfastConfig: isEnabled=${JSON.stringify(x.isEnabled)} cutoff=${JSON.stringify(x.cutoffTime)} ` +
        `meals=${JSON.stringify(x.meals)}`
    );
  } else if (id === "rewardsConfig") {
    console.log(`  settings/rewardsConfig: ${JSON.stringify(shape(x))}`);
  } else if (id === "hotelConfig") {
    console.log(
      `  settings/hotelConfig: otherAddOnsEnabled=${JSON.stringify(x.otherAddOnsEnabled)} ` +
        `roomTypes=${(x.roomTypes as unknown[])?.length} paymentMethods=${JSON.stringify(
          (x.paymentMethods as unknown[])?.map((p: Record<string, unknown>) => ({
            method: p.method,
            label: p.label,
            enabled: p.isEnabled
          }))
        )} discountTypes=${JSON.stringify(x.discountTypes)}`
    );
  } else {
    console.log(`  settings/${id}: ${JSON.stringify(shape(x))}`);
  }
}

// ---------------------------------------------------------------------------
section("8. MEMBERS — enrollment state (uid masked)");
const members = await db.collection("members").get();
for (const d of members.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(
    `  id=${d.id} memberId=${JSON.stringify(x.memberId)} uid=${String(x.uid || x.userId || "").slice(0, 6)}… ` +
      `points=${JSON.stringify(x.points)} tier=${JSON.stringify(x.tier)} status=${JSON.stringify(x.status)} ` +
      `joinedAt=${JSON.stringify(shape(x.joinedAt))}`
  );
}

// ---------------------------------------------------------------------------
section("9. NOTIFICATIONS — age profile (retention check)");
const notifications = await db.collection("notifications").get();
let older30 = 0;
let oldest = "";
for (const d of notifications.docs) {
  const x = d.data() as Record<string, unknown>;
  const raw = x.createdAt as unknown;
  const iso =
    raw && typeof (raw as { toDate?: unknown }).toDate === "function"
      ? (raw as { toDate: () => Date }).toDate().toISOString()
      : typeof raw === "string"
        ? raw
        : "";
  if (iso && Date.parse(iso) < Date.now() - 30 * 86400000) {
    older30++;
    if (!oldest || iso < oldest) oldest = iso;
  }
}
console.log(`  ${notifications.size} notifications · ${older30} older than 30 days · oldest ${oldest}`);
