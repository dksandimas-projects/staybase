// Per RPT-01 (QA pass 2026-10-21) + the 2026-10-23 handoff §4:
// reproduce the ADMIN BOOKINGS LIST money projection against LIVE
// production data, using the admin app's OWN projection functions.
//
// WHY THIS EXISTS
// ---------------
// The admin Bookings LIST hydrates `booking.onsitePayments` from a
// per-booking ledger index built by `buildBookingPaymentIndex` over the
// `collectionGroup("payments")` + `collectionGroup("refunds")` snapshots
// (`AdminContext.tsx`). The booking DRAWER reads the same money from its
// own per-booking listeners. In production the two disagree: the list
// reported "Balance due 69" (every booking owing) while the drawer showed
// the correct "PAID ₱5,600" for the same booking.
//
// The handoff ruled out the deployed bundle, the data, and the Firestore
// rules, and left the pure pipeline UNVERIFIED — its production script
// read Firestore directly and never ran the app's `normalizeLedgerDoc`.
//
// This probe closes that gap: it fetches the real ledger with the Admin
// SDK, pushes it through the app's REAL `normalizeLedgerDoc` +
// `buildBookingPaymentIndex` + `resolveBookingOnsitePayments` +
// `computeBookingFolio`, and computes the quick-view chips twice:
//
//   SCENARIO A — index EMPTY    (simulates the live bug)
//   SCENARIO B — index POPULATED (the intended state)
//
// If SCENARIO A reproduces the live chip numbers exactly and SCENARIO B
// reproduces the QA report's measured numbers, the money math and the
// projection are proven correct and the defect is narrowed to the
// CLIENT-SIDE listener layer (the group listener never populating the
// index in the browser).
//
// READ-ONLY. Never writes. Prints counts and aggregate money only — no
// guest names, no emails, no PII.
//
// Usage (needs the esbuild bundle — the shared utils use extensionless
// imports, so `node --experimental-strip-types` cannot resolve them):
//
//   npx esbuild scripts/rpt-01-ledger-index-probe.ts --bundle --platform=node \
//     --outfile=.probe/rpt01-probe.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/rpt01-probe.mjs

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
import { getManilaDateInfo } from "../shared/utils/bookingDates";

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
console.log("env file:", envFile);
console.log("---");

// ── The ledger, exactly as the admin app's group listeners see it ──────
// The Admin SDK's `collectionGroup().get()` is the same collection-group
// query the client SDK's `onSnapshot(collectionGroup(db, "payments"))`
// issues — `allDescendants` is implied.
const paymentSnap = await db.collectionGroup("payments").get();
const refundSnap = await db.collectionGroup("refunds").get();

const ledgerDocs: PaymentLedgerDoc[] = [
  ...paymentSnap.docs.map((d) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>)),
  ...refundSnap.docs.map((d) => normalizeLedgerDoc(d.ref.path, d.data() as Record<string, unknown>))
];

const index = buildBookingPaymentIndex(ledgerDocs);

// ── The bookings + store orders the list reads ────────────────────────
const bookingSnap = await db.collection("bookings").get();
const storeOrderSnap = await db.collection("storeOrders").get();

// The admin app's EXACT date normalizer, copied from the bookings
// mapper in `AdminContext.tsx` (line 1858). The live app compares
// `booking.checkIn` (a normalized "YYYY-MM-DD" string) against
// `todayStr`. Comparing the RAW Firestore Timestamp instead gives a
// completely different answer — the probe must match the app.
const parseDateString = (val: any): string => {
  if (!val) return "";
  if (typeof val.toDate === "function") {
    return val.toDate().toISOString().split("T")[0];
  }
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  if (typeof val === "string") {
    return val.split("T")[0];
  }
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
    checkOut: parseDateString(data.checkOut),
    earlyCheckInStatus: (data.earlyCheckIn as any)?.status as string | undefined,
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

// The admin app's timezone comes from the hotel config.
let timezone = "Asia/Manila";
try {
  const cfg = await db.collection("settings").doc("hotelConfig").get();
  timezone = (cfg.data()?.timezone as string) || timezone;
} catch {
  /* keep the default */
}
const today = getManilaDateInfo(timezone).todayStr;

// ── The quick-view predicates, copied from BookingsPage.tsx ───────────
// (lines 2029-2056) so this probe counts exactly what the chips count.
type Scenario = { label: string; index: Record<string, any[]> };

function computeChips(scenario: Scenario) {
  let paidPills = 0;
  let balanceDue = 0;
  let needsAttention = 0;

  for (const booking of bookings) {
    // The list hydrates `onsitePayments` from the index, exactly as
    // `resolveBookingOnsitePayments` does inside the AdminContext mapper.
    const hydrated = resolveBookingOnsitePayments(
      booking.id,
      booking.onsitePayments,
      scenario.index as any
    );

    // `getBookingFolio` for a NON-selected row (BookingsPage.tsx:2103).
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

    // `isBookingPaid` (BookingsPage.tsx:2498).
    const paid = (hydrated ?? []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    if (paid >= booking.totalPrice && booking.totalPrice > 0) paidPills++;

    if (folio.balance > 0) balanceDue++;

    if (
      booking.status === "payment-uploaded" ||
      (booking.status === "confirmed" && booking.checkIn < today) ||
      (booking.status === "pending" && booking.checkIn <= today) ||
      booking.earlyCheckInStatus === "requested" ||
      (booking.status === "checked-in" && booking.checkOut < today) ||
      (booking.status === "checked-out" && folio.balance > 0)
    ) {
      needsAttention++;
    }
  }

  return { paidPills, balanceDue, needsAttention };
}

// ── Report ─────────────────────────────────────────────────────────────
console.log("=== LEDGER (as the admin app's group listeners see it) ===");
console.log("payments docs:", paymentSnap.size);
console.log("refunds docs:", refundSnap.size);
console.log("ledger docs after normalizeLedgerDoc:", ledgerDocs.length);
console.log("index keys (bookings with a ledger):", Object.keys(index).length);
console.log("bookings total:", bookings.length);
console.log("storeOrders:", storeOrders.length);
console.log("today (hotel timezone", timezone + "):", today);

const indexKeys = Object.keys(index);
const bookingIds = new Set(bookings.map((b) => b.id));
const orphanKeys = indexKeys.filter((k) => !bookingIds.has(k));
const keyedBookings = indexKeys.filter((k) => bookingIds.has(k));
console.log("index keys matching a booking id:", keyedBookings.length);
console.log("index keys NOT matching any booking id:", orphanKeys.length, orphanKeys.slice(0, 10));
console.log("---");

const scenarioA = computeChips({ label: "A", index: {} });
const scenarioB = computeChips({ label: "B", index });

console.log("=== SCENARIO A — index EMPTY (simulates the live bug) ===");
console.log("Paid pills:", scenarioA.paidPills);
console.log("Balance due:", scenarioA.balanceDue);
console.log("Needs attention:", scenarioA.needsAttention);
console.log("---");

console.log("=== SCENARIO B — index POPULATED (the intended state) ===");
console.log("Paid pills:", scenarioB.paidPills);
console.log("Balance due:", scenarioB.balanceDue);
console.log("Needs attention:", scenarioB.needsAttention);
console.log("---");

// ── Field-shape diagnostics ────────────────────────────────────────────
// The needs-attention chip count did not line up, so dump the SHAPE of
// the fields its predicate reads. A Timestamp vs a string changes the
// outcome of `booking.checkIn < today` completely.
console.log("=== BOOKING FIELD SHAPES ===");
const statusCounts: Record<string, number> = {};
const checkInKinds: Record<string, number> = {};
let cancelled = 0;
for (const b of bookings) {
  statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  if (b.status === "cancelled") cancelled++;
  const kind = b.checkIn === "" ? "empty" : typeof b.checkIn;
  checkInKinds[kind] = (checkInKinds[kind] || 0) + 1;
}
console.log("status distribution:", JSON.stringify(statusCounts));
console.log("checkIn value types:", JSON.stringify(checkInKinds));
console.log("cancelled bookings (live chip says 19):", cancelled);
console.log("---");

// ── Needs-attention clause breakdown (scenario A: empty index) ─────────
console.log("=== NEEDS-ATTENTION CLAUSE BREAKDOWN (index EMPTY) ===");
const clauseCounts: Record<string, number> = {
  "payment-uploaded": 0,
  "confirmed && checkIn < today": 0,
  "pending && checkIn <= today": 0,
  "earlyCheckIn requested": 0,
  "checked-in && checkOut < today": 0,
  "checked-out && balance > 0": 0
};
for (const booking of bookings) {
  const hydrated = resolveBookingOnsitePayments(booking.id, booking.onsitePayments, {} as any);
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
  if (booking.status === "payment-uploaded") clauseCounts["payment-uploaded"]++;
  if (booking.status === "confirmed" && booking.checkIn < today)
    clauseCounts["confirmed && checkIn < today"]++;
  if (booking.status === "pending" && booking.checkIn <= today)
    clauseCounts["pending && checkIn <= today"]++;
  if (booking.earlyCheckInStatus === "requested") clauseCounts["earlyCheckIn requested"]++;
  if (booking.status === "checked-in" && booking.checkOut < today)
    clauseCounts["checked-in && checkOut < today"]++;
  if (booking.status === "checked-out" && folio.balance > 0)
    clauseCounts["checked-out && balance > 0"]++;
}
for (const [clause, n] of Object.entries(clauseCounts)) {
  console.log(`  ${clause}: ${n}`);
}
console.log("---");

console.log("=== EXPECTED (from the QA report + handoff) ===");
console.log("LIVE (observed in the browser)  -> Paid pills: 0   Balance due: 69  Needs attention: 10");
console.log("TRUTH (QA measurement)          -> Paid pills: 14  Balance due: 55  Needs attention: 5");
console.log("---");

const aMatches =
  scenarioA.balanceDue === 69 && scenarioA.needsAttention === 10 && scenarioA.paidPills === 0;
const bMatches =
  scenarioB.balanceDue === 55 && scenarioB.needsAttention === 5 && scenarioB.paidPills === 14;
console.log("VERDICT:");
console.log("  Scenario A reproduces the LIVE chip numbers:", aMatches ? "YES" : "NO");
console.log("  Scenario B reproduces the TRUTH numbers:   ", bMatches ? "YES" : "NO");
if (aMatches && bMatches) {
  console.log(
    "  => The money math and the ledger projection are CORRECT.\n" +
      "     The defect is in the CLIENT-SIDE group listener: the\n" +
      "     collectionGroup('payments') snapshot never populates the index."
  );
}
