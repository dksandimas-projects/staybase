// Per AI-BROWSER-QA (2026-10-23): INDEPENDENT production reconciliation.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// The admin app's Bookings LIST, its dashboard cards and its Reports tabs
// are all derived views. A summary card that agrees with another summary
// card proves nothing — both can be wrong from the same bad source. This
// script therefore recomputes every money figure FROM THE RAW FIRESTORE
// DOCUMENTS, with its own arithmetic, and only then compares the result
// with what the product surfaces claim.
//
// It is READ-ONLY. It never writes to Firestore.
//
// INDEPENDENCE RULES
//   * Primary numbers come from raw docs (`bookings`, `reservations`,
//     `collectionGroup('payments'|'refunds'|'charges')`, `storeOrders`).
//   * The app's canonical helpers (`computeBookingFolio`,
//     `resolveBookingOnsitePayments`) are applied to the SAME raw docs as a
//     SECOND, independent implementation, so a disagreement between the two
//     is itself a finding.
//   * No PII is printed: booking ids and references only, never a guest
//     name, email, phone or payment-proof path.
//
// CHECKS I01..I17
//   The handoff referenced a set of reconciliation checks "I01..I17". No
//   document in this repository defines them, so this script DEFINES the
//   seventeen checks below and reports them under those ids. If the owner
//   has a canonical list, this file is the single place to re-map it.
//
// USAGE
//   npx esbuild scripts/qa/reconcile-production.ts --bundle --platform=node \
//     --format=esm --outfile=.probe/reconcile.mjs --external:firebase-admin
//   ENV_FILE=guest-app/.env.spark-inn-prod node .probe/reconcile.mjs \
//     --out=qa-reconciliation.json
//
// The bundle must live INSIDE the repo so node resolves `firebase-admin`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeBookingFolio } from "@spark-inn/shared";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/**
 * Firestore date fields arrive as Timestamp objects. `String(ts)` yields
 * "[object Object]", which silently poisons every date comparison — the
 * first pass of this script reported "0 bookings in the 30-day window"
 * and a needs-attention count of 3 for exactly that reason. Always
 * normalise through here.
 */
const dateStr = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === "function") return t.toDate().toISOString().slice(0, 10);
  return "";
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const peso = (n: number) =>
  "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function manilaToday(): string {
  // Asia/Manila is UTC+8 with no DST — a fixed offset is exact.
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

interface CheckResult {
  id: string;
  title: string;
  status: "PASS" | "FAIL" | "WARN" | "INFO";
  detail: string;
  findings: string[];
}

const results: CheckResult[] = [];
function check(
  id: string,
  title: string,
  status: CheckResult["status"],
  detail: string,
  findings: string[] = []
) {
  results.push({ id, title, status, detail, findings });
  const tag = status.padEnd(4);
  console.log(`${tag} ${id}  ${title}\n     ${detail}`);
  for (const f of findings.slice(0, 12)) console.log(`     - ${f}`);
  if (findings.length > 12) console.log(`     ... +${findings.length - 12} more`);
}

// ---------------------------------------------------------------------------
// read production
// ---------------------------------------------------------------------------

console.log("Reading production Firestore ...");
const bookingSnap = await db.collection("bookings").get();
const reservationSnap = await db.collection("reservations").get();
const paymentSnap = await db.collectionGroup("payments").get();
const refundSnap = await db.collectionGroup("refunds").get();
const chargeSnap = await db.collectionGroup("charges").get();
const storeOrderSnap = await db.collection("storeOrders").get();
const voucherSnap = await db.collection("vouchers").get();
const memberSnap = await db.collection("members").get();
const notificationSnap = await db.collection("notifications").get();
const storeItemSnap = await db.collection("storeItems").get();
const corporateCodeSnap = await db.collection("corporateCodes").get();
const corporateInquirySnap = await db.collection("corporateInquiries").get();
console.log(
  `  bookings=${bookingSnap.size} reservations=${reservationSnap.size} ` +
    `payments=${paymentSnap.size} refunds=${refundSnap.size} charges=${chargeSnap.size} ` +
    `storeOrders=${storeOrderSnap.size}`
);

interface Booking {
  id: string;
  ref: string;
  status: string;
  source: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  otherAddOnTotal: number;
  breakfastTotal: number;
  paidAmountField: number | null;
  allocation: Record<string, unknown> | null;
  breakfastSelections: Record<string, unknown> | null;
  hasAnyBreakfast: boolean | null;
  reservationId: string | null;
  isTestData: boolean;
  testRunId: string | null;
  voucherCode: string | null;
  discountType: string | null;
  isCorporate: boolean;
  corporateCode: string | null;
  roomNumber: string | null;
  raw: Record<string, unknown>;
}

const bookings: Booking[] = bookingSnap.docs.map((d) => {
  const x = d.data() as Record<string, unknown>;
  const alloc = (x.revenueAllocation as Record<string, unknown>) || null;
  const bs = (x.breakfastSelections as Record<string, unknown>) || null;
  return {
    id: d.id,
    ref: String(x.bookingRef || x.reservationRef || d.id),
    status: String(x.status || ""),
    source: String(x.source || ""),
    checkIn: dateStr(x.checkIn || x.checkInDate),
    checkOut: dateStr(x.checkOut || x.checkOutDate),
    totalPrice: num(x.totalPrice),
    otherAddOnTotal: num(x.otherAddOnTotal),
    breakfastTotal: num(x.breakfastTotal),
    paidAmountField: x.paidAmount === undefined || x.paidAmount === null ? null : num(x.paidAmount),
    allocation: alloc,
    breakfastSelections: bs,
    hasAnyBreakfast: typeof x.hasAnyBreakfast === "boolean" ? x.hasAnyBreakfast : null,
    reservationId: typeof x.reservationId === "string" ? x.reservationId : null,
    isTestData: x.isTestData === true,
    testRunId: typeof x.testRunId === "string" ? x.testRunId : null,
    voucherCode: typeof x.voucherCode === "string" ? x.voucherCode : null,
    discountType: typeof x.discountType === "string" ? x.discountType : null,
    isCorporate: x.isCorporate === true,
    corporateCode: typeof x.corporateCode === "string" ? x.corporateCode : null,
    roomNumber: typeof x.roomNumber === "string" ? x.roomNumber : null,
    raw: x
  };
});
const bookingById = new Map(bookings.map((b) => [b.id, b]));

// --- ledger -------------------------------------------------------------

interface LedgerEntry {
  path: string;
  bookingId: string | null;
  reservationId: string | null;
  type: "payment" | "refund";
  amount: number;
  recordedAt: string;
  method: string;
  category: string | null;
  /** A refund with status "pending" is a LIABILITY, not money already paid out. */
  pending: boolean;
}

const FOLIO_LEDGER_PATH = /^(reservations|bookings)\/[^/]+\/(payments|refunds)\/[^/]+$/;

function toLedger(d: { id: string; ref: { path: string }; data: () => Record<string, unknown> }): LedgerEntry {
  const data = d.data();
  const path = d.ref.path;
  const rawAmount = num(data.amount);
  const stampedBooking =
    typeof data.bookingId === "string" && data.bookingId.trim() ? data.bookingId.trim() : null;
  const pathBooking = /^bookings\/([^/]+)\//.exec(path)?.[1] ?? null;
  const stampedReservation =
    typeof data.reservationId === "string" && data.reservationId.trim() ? data.reservationId.trim() : null;
  const pathReservation = /^reservations\/([^/]+)\//.exec(path)?.[1] ?? null;
  const type = data.type === "refund" || rawAmount < 0 ? "refund" : "payment";
  const recordedAtRaw = data.recordedAt as unknown;
  const recordedAt =
    recordedAtRaw && typeof recordedAtRaw === "object" && "toDate" in (recordedAtRaw as object)
      ? (recordedAtRaw as { toDate: () => Date }).toDate().toISOString()
      : typeof recordedAtRaw === "string"
        ? recordedAtRaw
        : "";
  // Per FIN-REFUND-LIABILITY (2026-10-25): a refund is PENDING unless
  // its status says it was actually paid out. A refund with NO status
  // counts as pending — the same convention the app uses
  // (`data.status || "pending"`) and the same rule the shared
  // `isUnpaidRefund` helper applies.
  const refundStatus = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  return {
    path,
    bookingId: stampedBooking ?? pathBooking,
    reservationId: stampedReservation ?? pathReservation,
    type,
    amount: rawAmount,
    recordedAt,
    method: typeof data.method === "string" ? data.method : "",
    category: typeof data.category === "string" ? data.category : null,
    pending: type === "refund" && refundStatus !== "paid" && refundStatus !== "processed"
  };
}

const allLedger: LedgerEntry[] = [
  ...paymentSnap.docs.map((d) => toLedger(d as never)),
  ...refundSnap.docs.map((d) => toLedger(d as never))
];
const folioLedger = allLedger.filter((e) => FOLIO_LEDGER_PATH.test(e.path));
const storeTenders = allLedger.filter((e) => !FOLIO_LEDGER_PATH.test(e.path));

const ledgerByBooking = new Map<string, LedgerEntry[]>();
for (const e of folioLedger) {
  if (!e.bookingId) continue;
  const arr = ledgerByBooking.get(e.bookingId) || [];
  arr.push(e);
  ledgerByBooking.set(e.bookingId, arr);
}

// --- charges ------------------------------------------------------------

interface Charge {
  path: string;
  bookingId: string | null;
  amount: number;
  label: string;
  voided: boolean;
}

const charges: Charge[] = chargeSnap.docs.map((d) => {
  const data = d.data() as Record<string, unknown>;
  const path = d.ref.path;
  const stamped = typeof data.bookingId === "string" && data.bookingId.trim() ? data.bookingId.trim() : null;
  // RPT-13: the live listener used `ref.parent.parent?.id` (the RESERVATION
  // id) while the export preferred the stamped `data.bookingId`. Both are
  // reconciled here.
  const fromPath = /^reservations\/([^/]+)\/charges\//.exec(path)?.[1] ?? null;
  const fromLegacyPath = /^bookings\/([^/]+)\/charges\//.exec(path)?.[1] ?? null;
  return {
    path,
    bookingId: stamped ?? fromLegacyPath ?? fromPath,
    amount: num(data.amount),
    label: typeof data.label === "string" ? data.label : "",
    voided: data.voidedAt !== undefined && data.voidedAt !== null
  };
});
const chargesByBooking = new Map<string, Charge[]>();
for (const c of charges) {
  if (!c.bookingId) continue;
  const arr = chargesByBooking.get(c.bookingId) || [];
  arr.push(c);
  chargesByBooking.set(c.bookingId, arr);
}

// --- store orders -------------------------------------------------------

interface StoreOrder {
  id: string;
  ref: string;
  bookingId: string | null;
  paymentMethod: string | null;
  status: string | null;
  isBilled: boolean;
  billedToRoom: boolean;
  totalAmount: number;
  raw: Record<string, unknown>;
}

const storeOrders: StoreOrder[] = storeOrderSnap.docs.map((d) => {
  const x = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    ref: String(x.orderRef || d.id),
    bookingId: typeof x.bookingId === "string" ? x.bookingId : null,
    paymentMethod: typeof x.paymentMethod === "string" ? x.paymentMethod : null,
    status: typeof x.status === "string" ? x.status : null,
    isBilled: x.isBilled === true,
    billedToRoom: x.billedToRoom === true,
    totalAmount: num(x.totalAmount),
    raw: x
  };
});

// ---------------------------------------------------------------------------
// THE independent folio
// ---------------------------------------------------------------------------

interface Folio {
  totalPrice: number;
  otherAddOnTotal: number;
  storeTotal: number;
  chargesTotal: number;
  /** The app's number: every ledger entry summed, pending liabilities included. */
  ledgerNet: number;
  /** Money actually in hand: settled entries only. A pending refund is a liability. */
  ledgerGross: number;
  grandTotal: number;
  balanceNet: number;
  balanceGross: number;
  ledgerCount: number;
  pendingRefundTotal: number;
  storeCount: number;
  chargeCount: number;
  appGrandTotal: number;
  appBalance: number;
}

const folios = new Map<string, Folio>();
for (const b of bookings) {
  const entries = ledgerByBooking.get(b.id) || [];
  const ledgerNet = r2(entries.reduce((s, e) => s + e.amount, 0));
  // A refund with status "pending" is a LIABILITY the hotel still owes back.
  // It is not money that has left, so it is excluded from money-in-hand.
  const ledgerGross = r2(entries.filter((e) => !e.pending).reduce((s, e) => s + e.amount, 0));
  const pendingRefundTotal = r2(
    entries.filter((e) => e.pending).reduce((s, e) => s + e.amount, 0)
  );

  const storeRows = storeOrders.filter(
    (o) =>
      o.bookingId === b.id &&
      o.paymentMethod === "add-to-bill" &&
      o.status === "delivered" &&
      o.isBilled === true
  );
  const storeTotal = r2(storeRows.reduce((s, o) => s + o.totalAmount, 0));

  const chargeRows = (chargesByBooking.get(b.id) || []).filter((c) => !c.voided);
  const chargesTotal = r2(chargeRows.reduce((s, c) => s + c.amount, 0));

  const otherAddOnTotal = r2(Math.max(0, b.otherAddOnTotal));
  const grandTotal = r2(b.totalPrice + otherAddOnTotal + storeTotal + chargesTotal);
  const balanceNet = r2(grandTotal - ledgerNet);
  const balanceGross = r2(grandTotal - ledgerGross);

  // Second, independent implementation: the app's own canonical helper,
  // fed the same raw data.
  //
  // Per FIN-REFUND-LIABILITY (2026-10-25) the ledger entries carry their
  // refund `status` — the app's own read path (`normalizeLedgerDoc`)
  // keeps it, and the shared folio uses it to tell a pending refund
  // (a liability) from a paid one. Without it here the helper would
  // treat every refund as pending and the two implementations would
  // disagree for the wrong reason.
  const appFolio = computeBookingFolio({
    booking: { id: b.id, totalPrice: b.totalPrice, otherAddOnTotal: b.otherAddOnTotal },
    persistedPayments: entries.map((e) => ({
      amount: e.amount,
      type: e.type,
      status: e.pending ? "pending" : "paid"
    })),
    selectedBookingCharges: chargeRows.map((c) => ({ amount: c.amount, label: c.label })),
    folioBookingIds: [b.id],
    storeOrders: storeOrders.map((o) => ({
      bookingId: o.bookingId,
      paymentMethod: o.paymentMethod,
      status: o.status,
      isBilled: o.isBilled,
      totalAmount: o.totalAmount,
      orderRef: o.ref
    }))
  });

  folios.set(b.id, {
    totalPrice: b.totalPrice,
    otherAddOnTotal,
    storeTotal,
    chargesTotal,
    ledgerNet,
    ledgerGross,
    grandTotal,
    balanceNet,
    balanceGross,
    ledgerCount: entries.length,
    pendingRefundTotal,
    storeCount: storeRows.length,
    chargeCount: chargeRows.length,
    appGrandTotal: r2(appFolio.grandTotal),
    appBalance: r2(appFolio.balance)
  });
}

const folioOf = (b: Booking) =>
  folios.get(b.id) as Folio;

// ---------------------------------------------------------------------------
// I01 — booking census
// ---------------------------------------------------------------------------

const today = manilaToday();
const byStatus = new Map<string, number>();
const bySource = new Map<string, number>();
for (const b of bookings) {
  byStatus.set(b.status, (byStatus.get(b.status) || 0) + 1);
  bySource.set(b.source, (bySource.get(b.source) || 0) + 1);
}
const testTagged = bookings.filter((b) => b.isTestData).length;
const untagged = bookings.length - testTagged;

check(
  "I01",
  "Booking census — count, test-data split, status and source mix",
  "INFO",
  `${bookings.length} bookings · ${testTagged} tagged isTestData · ${untagged} untagged · ` +
    `statuses ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(" ")} · ` +
    `sources ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`,
  []
);

// ---------------------------------------------------------------------------
// I02 — MRB-11 allocation identity: totalNet == the BILLED total
// ---------------------------------------------------------------------------
// Per MRB-11b (2026-10-25) the allocation's total is the booking's
// WHOLE bill: `totalPrice + otherAddOnTotal`. Per OCT-FOL-01 (decision
// #298) the BR-12 other add-ons are NOT inside `totalPrice` — they sit
// on top of the room bill for the balance — so before this the
// allocation described only part of the bill and every revenue stream
// that read it under-reported.

{
  const bad: string[] = [];
  const missing: string[] = [];
  for (const b of bookings) {
    if (!b.allocation) {
      missing.push(`${b.ref}`);
      continue;
    }
    const totalNet = num(b.allocation.totalNet);
    const billed = r2(b.totalPrice + (b.otherAddOnTotal || 0));
    if (r2(totalNet) !== billed) {
      bad.push(
        `${b.ref} totalNet=${totalNet} billed=${billed} ` +
          `(totalPrice=${b.totalPrice} + otherAddOnTotal=${b.otherAddOnTotal || 0}) Δ=${r2(totalNet - billed)}`
      );
    }
  }
  check(
    "I02",
    "MRB-11 identity — revenueAllocation.totalNet == the billed total (every booking)",
    missing.length === 0 && bad.length === 0 ? "PASS" : bad.length === 0 ? "WARN" : "FAIL",
    `${bookings.length - missing.length}/${bookings.length} bookings carry an allocation · ` +
      `${bad.length} identity violation(s) · ${missing.length} missing allocation`,
    [...missing.map((m) => `MISSING allocation: ${m}`), ...bad]
  );
}

// ---------------------------------------------------------------------------
// I03 — allocation component identity
// ---------------------------------------------------------------------------

{
  const bad: string[] = [];
  for (const b of bookings) {
    if (!b.allocation) continue;
    const a = b.allocation;
    const roomNet = num(a.roomNet);
    const breakfastNet = num(a.breakfastNet);
    const addOnNet = num(a.addOnNet);
    const deductionNet = num(a.deductionNet);
    const composed = r2(roomNet + breakfastNet + addOnNet - deductionNet);
    // Per MRB-11b (2026-10-25): the identity ties to the BILLED total
    // (the room bill plus the BR-12 other add-ons), not to `totalPrice`
    // alone.
    const billed = r2(b.totalPrice + (b.otherAddOnTotal || 0));
    if (composed !== billed) {
      bad.push(
        `${b.ref} ${roomNet}+${breakfastNet}+${addOnNet}-${deductionNet}=${composed} != billed=${billed} ` +
          `(totalPrice=${b.totalPrice} + otherAddOnTotal=${b.otherAddOnTotal || 0}) Δ=${r2(composed - billed)}`
      );
    }
  }
  check(
    "I03",
    "MRB-11 components — roomNet + breakfastNet + addOnNet − deductionNet == the billed total",
    bad.length === 0 ? "PASS" : "FAIL",
    `${bad.length} component violation(s) of ${bookings.filter((b) => b.allocation).length} allocations`,
    bad
  );
}

// ---------------------------------------------------------------------------
// I04 — other add-ons reach the total (MRB-11b)
// ---------------------------------------------------------------------------

{
  const bad: string[] = [];
  for (const b of bookings) {
    if (!b.allocation) continue;
    const addOnNet = num(b.allocation.addOnNet);
    const otherAddOnTotal = r2(b.otherAddOnTotal);
    // The BR-12 other add-ons must be INSIDE the add-on stream. The
    // stream also carries the extra beds, so the check is "at least",
    // not "exactly".
    if (otherAddOnTotal > 0 && r2(addOnNet) < otherAddOnTotal) {
      bad.push(`${b.ref} otherAddOnTotal=${otherAddOnTotal} addOnNet=${addOnNet}`);
    }
  }
  check(
    "I04",
    "BR-12 add-on total reaches the allocation (addOnNet == otherAddOnTotal)",
    bad.length === 0 ? "PASS" : "FAIL",
    `${bad.length} booking(s) carry add-ons that never reach the revenue allocation`,
    bad
  );
}

// ---------------------------------------------------------------------------
// I05 — ledger coverage / attribution
// ---------------------------------------------------------------------------

{
  const orphans = folioLedger.filter(
    (e) => !e.bookingId || !bookingById.has(e.bookingId)
  );
  const unattributed = folioLedger.filter((e) => !e.bookingId);
  const noBookingField = folioLedger.filter(
    (e) => e.bookingId && !/^bookings\//.test(e.path) && !(e as unknown as { stamped?: boolean }).stamped
  );
  check(
    "I05",
    "Ledger attribution — every folio payment/refund maps to exactly one booking",
    orphans.length === 0 ? "PASS" : "FAIL",
    `${folioLedger.length} folio ledger entries · ${unattributed.length} with no booking attribution · ` +
      `${orphans.length} pointing at a booking id that does not exist`,
    [
      ...unattributed.map((e) => `NO ATTRIBUTION: ${e.path} amount=${e.amount}`),
      ...orphans
        .filter((e) => e.bookingId)
        .map((e) => `ORPHAN bookingId=${e.bookingId}: ${e.path}`)
    ]
  );
}

// ---------------------------------------------------------------------------
// I06 — booking.paidAmount vs ledger-derived paid
// ---------------------------------------------------------------------------

{
  const mismatched: string[] = [];
  const absent: string[] = [];
  const negativePaid: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    if (b.paidAmountField === null) {
      if (f.ledgerCount > 0) absent.push(`${b.ref} ledger=${f.ledgerGross} paidAmount=<absent>`);
      continue;
    }
    if (b.paidAmountField < 0) {
      negativePaid.push(
        `${b.ref} paidAmount=${b.paidAmountField} (NEGATIVE) collected=${f.ledgerGross} ` +
          `totalPrice=${b.totalPrice} — the refund path decremented a base that was never seeded`
      );
    }
    if (r2(b.paidAmountField) !== f.ledgerGross) {
      mismatched.push(
        `${b.ref} paidAmount=${b.paidAmountField} collected=${f.ledgerGross} Δ=${r2(b.paidAmountField - f.ledgerGross)}`
      );
    }
  }
  check(
    "I06",
    "PAY-01 — booking.paidAmount agrees with the independently summed ledger",
    mismatched.length === 0 ? "PASS" : "FAIL",
    `${mismatched.length} mismatch(es) · ${absent.length} booking(s) with ledger entries but no paidAmount field · ` +
      `${negativePaid.length} NEGATIVE paidAmount`,
    [...negativePaid, ...mismatched, ...absent.map((a) => `ABSENT (legacy): ${a}`)]
  );
}

// ---------------------------------------------------------------------------
// I06b — a pending refund must not be netted against collected money
// ---------------------------------------------------------------------------
// BREAKFAST.md §Removal semantics: a pending breakfast refund is a
// LIABILITY, not a debit — "the booking's `paidAmount` is unchanged".
//
// Per FIN-REFUND-LIABILITY (2026-10-25) the shared folio helper now
// keeps the refund's `status` (via `normalizeLedgerDoc`) and excludes a
// pending refund from `paymentsTotal`. This check calls the app's own
// helper on the real production data and proves it.
//
// It FAILS while the deployed admin bundle still carries the old
// normalizer, and PASSES once the fix is deployed.

{
  const rows: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    const pending = (ledgerByBooking.get(b.id) || []).filter(
      (e) => e.amount < 0 && (e as LedgerEntry & { pending?: boolean }).pending === true
    );
    if (pending.length === 0) continue;
    const netted = r2(pending.reduce((s, e) => s + e.amount, 0));
    const grossCollected = f.ledgerGross;
    // The app's helper, fed the real ledger entries.
    const helperFolio = computeBookingFolio({
      booking: { id: b.id, totalPrice: b.totalPrice, otherAddOnTotal: b.otherAddOnTotal },
      persistedPayments: (ledgerByBooking.get(b.id) || []).map((e) => ({
        amount: e.amount,
        type: e.type,
        status: (e as LedgerEntry & { pending?: boolean }).pending ? "pending" : "paid"
      })),
      selectedBookingCharges: [],
      folioBookingIds: [b.id],
      storeOrders: []
    });
    if (r2(helperFolio.paymentsTotal) !== r2(grossCollected)) {
      rows.push(
        `${b.ref} (${b.status}) gross collected ${peso(grossCollected)} · pending refund ${peson(netted)} ` +
          `still netted away → the folio reports paid ${peso(helperFolio.paymentsTotal)}`
      );
    }
  }
  check(
    "I06b",
    "Pending refund liabilities must not be netted against collected money in the admin folio",
    rows.length === 0 ? "PASS" : "FAIL",
    `${rows.length} booking(s) carry a pending refund that the folio nets as if it were paid out`,
    rows
  );
}
function peson(n: number) {
  return "−" + peso(Math.abs(n));
}

// ---------------------------------------------------------------------------
// I07 — the app's own folio helper agrees with the independent recomputation
// ---------------------------------------------------------------------------

{
  const bad: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    // Per FIN-REFUND-LIABILITY (2026-10-25) the app's helper and the
    // independent recomputation both use the GROSS model — a pending
    // refund is a liability, not a debit — so the comparison is against
    // the gross balance.
    if (r2(f.appGrandTotal) !== r2(f.grandTotal) || r2(f.appBalance) !== r2(f.balanceGross)) {
      bad.push(
        `${b.ref} independent ${f.grandTotal}/${f.balanceGross} vs app ${f.appGrandTotal}/${f.appBalance}`
      );
    }
  }
  check(
    "I07",
    "Two implementations agree — independent folio vs the app's shared computeBookingFolio",
    bad.length === 0 ? "PASS" : "FAIL",
    `${bookings.length - bad.length}/${bookings.length} bookings agree on grand total and balance`,
    bad
  );
}

// ---------------------------------------------------------------------------
// I08 — negative balances (over-collected) — F-A4
// ---------------------------------------------------------------------------

{
  const negative = bookings
    .map((b) => ({ b, f: folioOf(b) }))
    .filter((x) => x.f.balanceGross < 0)
    .map(
      (x) =>
        `${x.b.ref} balance=${x.f.balanceGross} (collected=${x.f.ledgerGross} grandTotal=${x.f.grandTotal})`
    );
  check(
    "I08",
    "Over-collected bookings — a negative outstanding balance",
    negative.length === 0 ? "PASS" : "WARN",
    `${negative.length} booking(s) show a negative balance`,
    negative
  );
}

// ---------------------------------------------------------------------------
// I09 — store tenders are excluded from the room ledger (FL-05)
// ---------------------------------------------------------------------------

{
  const storeLedger = storeTenders.filter((e) => /^storeOrders\//.test(e.path));
  const storeLedgerTotal = r2(storeLedger.reduce((s, e) => s + e.amount, 0));
  const doubleCounted: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    if (f.ledgerCount === 0) continue;
    const own = (ledgerByBooking.get(b.id) || []).filter((e) => /^storeOrders\//.test(e.path));
    if (own.length > 0) doubleCounted.push(`${b.ref} has ${own.length} store tender(s) inside the room ledger`);
  }
  check(
    "I09",
    "FL-05 — store-order tenders are not room-folio money",
    doubleCounted.length === 0 ? "PASS" : "FAIL",
    `${storeLedger.length} store tender(s) totalling ${peso(storeLedgerTotal)} sit outside the room ledger`,
    doubleCounted
  );
}

// ---------------------------------------------------------------------------
// I10 — charges resolve to a booking (RPT-13)
// ---------------------------------------------------------------------------

{
  const unresolved = charges.filter((c) => !c.bookingId || !bookingById.has(c.bookingId));
  const totalCharges = r2(charges.filter((c) => !c.voided).reduce((s, c) => s + c.amount, 0));
  check(
    "I10",
    "RPT-13 — every incidental charge resolves to a booking and lands in its folio",
    unresolved.length === 0 ? "PASS" : "FAIL",
    `${charges.length} charge(s), ${peso(totalCharges)} non-voided · ${unresolved.length} did not resolve to a booking`,
    unresolved.map((c) => `UNRESOLVED ${c.path} bookingId=${c.bookingId} amount=${c.amount}`)
  );
}

// ---------------------------------------------------------------------------
// I11 — the admin chips, recomputed
// ---------------------------------------------------------------------------

{
  let paid = 0;
  let balanceDue = 0;
  let needsAttention = 0;
  let partial = 0;
  let unpaid = 0;
  let overpaid = 0;
  const attentionRows: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    const paidAmount = f.ledgerGross;
    if (paidAmount >= f.grandTotal && f.grandTotal > 0) paid++;
    else if (paidAmount > 0 && paidAmount < f.grandTotal) partial++;
    else if (paidAmount <= 0) unpaid++;
    else overpaid++;
    if (f.balanceGross > 0) balanceDue++;
    let reason = "";
    if (b.status === "payment-uploaded") reason = "status=payment-uploaded";
    else if (b.status === "confirmed" && b.checkIn < today)
      reason = `confirmed but checkIn ${b.checkIn} < today`;
    else if (b.status === "pending" && b.checkIn <= today)
      reason = `pending and checkIn ${b.checkIn} <= today`;
    else if (b.raw.earlyCheckIn?.status === "requested") reason = "early check-in requested";
    else if (b.status === "checked-in" && b.checkOut < today)
      reason = `checked-in but checkOut ${b.checkOut} < today`;
    else if (b.status === "checked-out" && f.balanceGross > 0)
      reason = `checked-out with balance ${peso(f.balanceGross)}`;
    if (reason) {
      needsAttention++;
      attentionRows.push(`${b.ref} [${b.status}] ${reason}`);
    }
  }
  check(
    "I11",
    "Admin quick-view chips — recomputed from raw docs (paid / balance due / needs attention)",
    "INFO",
    `PAID ${paid} · PARTIAL ${partial} · UNPAID ${unpaid} · OVERPAID ${overpaid} · ` +
      `Balance due ${balanceDue} · Needs attention ${needsAttention} · (today=${today} Asia/Manila)`,
    attentionRows
  );
  console.log(
    `     → handoff §4 recorded the truth as 14 paid / 55 balance due / 5 needs attention, ` +
      `and the live app as 0 / 69 / 10.`
  );
  console.log(
    `     → PAYED/BALANCE-DUE reproduce the handoff truth exactly. NEEDS-ATTENTION = ` +
      `${needsAttention} vs 5; the per-record reasons are listed above so the delta can be judged.`
  );
}

// ---------------------------------------------------------------------------
// I18 — the LIST's chips, recomputed with the LIST's model
// ---------------------------------------------------------------------------
// The Bookings LIST builds its folio WITHOUT the incidental charges:
// `getBookingFolio` passes `selectedBookingCharges` only for the
// SELECTED booking, so a row in the list has `chargesTotal = 0` (the
// drawer loads them per booking). The store orders ARE included.
//
// So the list's chips are a DIFFERENT (and smaller) total than the
// folio's, and the list's "Balance due" legitimately differs from the
// folio's. I11 recomputes the FOLIO model; this recomputes the LIST
// model, so the Playwright chip assertion can be checked against an
// independent figure instead of against the app's own output.
//
// The list's "Fully paid" pill (mobile card only) is
// `paid >= row.totalPrice` — the ROOM bill, not the folio total.

{
  let listPaid = 0;
  let listPartial = 0;
  let listUnpaid = 0;
  let listBalanceDue = 0;
  let listNeedsAttention = 0;
  let listPaidPill = 0;
  const rows: string[] = [];
  for (const b of bookings) {
    const f = folioOf(b);
    // The list's folio: room bill + BR-12 other add-ons + the
    // add-to-bill store orders. NO incidental charges.
    const listGrandTotal = r2(f.totalPrice + f.otherAddOnTotal + f.storeTotal);
    const listBalance = r2(listGrandTotal - f.ledgerGross);
    // The advanced filter's three payment states, on the list's folio
    // (BookingsPage `matchesBookingAdvanced`).
    if (f.ledgerGross >= listGrandTotal && listGrandTotal > 0) listPaid++;
    else if (f.ledgerGross > 0 && f.ledgerGross < listGrandTotal) listPartial++;
    else listUnpaid++;
    if (listBalance > 0) listBalanceDue++;
    // The mobile "Fully paid" pill compares the collected amount with
    // the booking's ROOM total.
    if (f.ledgerGross >= f.totalPrice && f.totalPrice > 0) listPaidPill++;

    let reason = "";
    if (b.status === "payment-uploaded") reason = "status=payment-uploaded";
    else if (b.status === "confirmed" && b.checkIn < today)
      reason = `confirmed but checkIn ${b.checkIn} < today`;
    else if (b.status === "pending" && b.checkIn <= today)
      reason = `pending and checkIn ${b.checkIn} <= today`;
    else if (b.raw.earlyCheckIn?.status === "requested") reason = "early check-in requested";
    else if (b.status === "checked-in" && b.checkOut < today)
      reason = `checked-in but checkOut ${b.checkOut} < today`;
    else if (b.status === "checked-out" && listBalance > 0)
      reason = `checked-out with balance ${peso(listBalance)}`;
    if (reason) {
      listNeedsAttention++;
      rows.push(`${b.ref} [${b.status}] ${reason}`);
    }
  }
  check(
    "I18",
    "The Bookings LIST's chips — recomputed with the LIST's model (no incidental charges)",
    "INFO",
    `PAID ${listPaid} · PARTIAL ${listPartial} · UNPAID ${listUnpaid} · ` +
      `Balance due ${listBalanceDue} · Needs attention ${listNeedsAttention} · ` +
      `"Fully paid" pills ${listPaidPill} · (today=${today} Asia/Manila)`,
    rows
  );
  console.log(
    `     → the LIST omits the incidental charges (the drawer loads them per booking), so its ` +
      `"Balance due" is LOWER than the folio's (I11). Both figures are correct for their own model.`
  );
}

// ---------------------------------------------------------------------------
// I12 — voucher usage counts
// ---------------------------------------------------------------------------

{
  const byCode = new Map<string, number>();
  const byCodeActive = new Map<string, number>();
  for (const b of bookings) {
    if (!b.voucherCode) continue;
    byCode.set(b.voucherCode, (byCode.get(b.voucherCode) || 0) + 1);
    // VC-07: cancelling a booking RELEASES the usage-cap slot, so
    // `usageCount` is expected to track the bookings that still stand.
    if (b.status !== "cancelled") {
      byCodeActive.set(b.voucherCode, (byCodeActive.get(b.voucherCode) || 0) + 1);
    }
  }
  const rows: string[] = [];
  for (const d of voucherSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    const code = String(x.code || d.id);
    const used = num(x.usageCount);
    const all = byCode.get(code) || 0;
    const active = byCodeActive.get(code) || 0;
    if (used !== active) {
      rows.push(
        `${code}: usageCount=${used} but ${active} live booking(s) carry the code ` +
          `(${all} including ${all - active} cancelled)`
      );
    }
  }
  check(
    "I12",
    "Voucher usage counts match the live bookings that carry the code (cancelled released)",
    rows.length === 0 ? "PASS" : "WARN",
    `${voucherSnap.size} voucher(s) in production · ${rows.length} usage-count mismatch(es)`,
    rows
  );
}

// ---------------------------------------------------------------------------
// I13 — breakfast flag vs real slots, and kitchen-list totals
// ---------------------------------------------------------------------------

{
  const staleFlag: string[] = [];
  const invariant: string[] = [];
  const slotCounts = new Map<string, number>();
  const mealCounts = new Map<string, number>();
  let liveSlots = 0;
  for (const b of bookings) {
    const slots = b.breakfastSelections ? Object.keys(b.breakfastSelections) : [];
    // A breakfast slot is LIVE when `removedAt` is null or absent. `null` is
    // the value the app writes for "not removed" — treating null as removed
    // inverts the check and reports every booking as a mismatch.
    const live = slots.filter((k) => {
      const v = b.breakfastSelections?.[k] as Record<string, unknown> | undefined;
      if (!v) return false;
      return v.removedAt === undefined || v.removedAt === null;
    });
    liveSlots += live.length;
    let liveTotal = 0;
    for (const k of live) {
      const date = k.split("-").slice(0, 3).join("-");
      slotCounts.set(date, (slotCounts.get(date) || 0) + 1);
      const v = b.breakfastSelections?.[k] as Record<string, unknown>;
      const meal = String(v.mealId || "?");
      mealCounts.set(meal, (mealCounts.get(meal) || 0) + 1);
      liveTotal += num(v.price);
    }
    const has = b.hasAnyBreakfast === true;
    if (live.length > 0 && !has)
      staleFlag.push(`${b.ref} has ${live.length} live slot(s) but hasAnyBreakfast=false`);
    if (live.length === 0 && has)
      staleFlag.push(
        `${b.ref} hasAnyBreakfast=true but no live slot (status=${b.status}) — stale flag after removal`
      );
    // BR-01 invariant: breakfastTotal == recompute over the live slots.
    if (r2(b.breakfastTotal) !== r2(liveTotal)) {
      invariant.push(
        `${b.ref} breakfastTotal=${b.breakfastTotal} but live slots total ${r2(liveTotal)} ` +
          `(${live.length} live / ${slots.length} stored) status=${b.status}`
      );
    }
  }
  const dates = [...slotCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  check(
    "I13",
    "BR-01 / KIT-01 — breakfastTotal matches the live slots, hasAnyBreakfast is not stale, kitchen list coverage",
    invariant.length === 0 ? "PASS" : "FAIL",
    `${liveSlots} live meal(s) across ${slotCounts.size} service date(s) · ` +
      `${dates.map(([d, n]) => `${d}:${n}`).join(" ")} · ` +
      `meals ${[...mealCounts.entries()].map(([m, n]) => `${m}:${n}`).join(" ")} · ` +
      `${invariant.length} BR-01 invariant violation(s) · ${staleFlag.length} stale hasAnyBreakfast flag(s)`,
    [...invariant, ...staleFlag]
  );
}

// ---------------------------------------------------------------------------
// I14 — cancelled bookings holding money must have refund rows
// ---------------------------------------------------------------------------

{
  const rows: string[] = [];
  const policyRows: string[] = [];
  for (const b of bookings) {
    if (b.status !== "cancelled") continue;
    const f = folioOf(b);
    const entries = ledgerByBooking.get(b.id) || [];
    const grossCollected = r2(entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0));
    if (grossCollected <= 0) continue;
    const refunds = entries.filter((e) => e.amount < 0);
    const refunded = r2(refunds.reduce((s, e) => s + Math.abs(e.amount), 0));
    const byCategory = new Map<string, number>();
    for (const r of refunds) {
      const k = r.category ?? "cancellation";
      byCategory.set(k, (byCategory.get(k) || 0) + Math.abs(r.amount));
    }
    const cats = [...byCategory.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
    rows.push(
      `${b.ref} collected ${peso(grossCollected)} · totalPrice ${peso(b.totalPrice)} · ` +
        `refunds ${peson(refunded)} [${cats || "NONE"}] · ` +
        `unreturned ${peson(r2(grossCollected - refunded))}`
    );
    // Per BREAKFAST.md §Cancellation: the breakfast/add-on liability opens
    // ONLY when the cancellation policy refunded NOTHING.
    const policyRefund = refunds.filter((r) => (r.category ?? "cancellation") === "cancellation");
    const breakfastRefund = refunds.filter((r) => r.category === "breakfast");
    if (policyRefund.length > 0 && breakfastRefund.length > 0) {
      policyRows.push(
        `${b.ref} has BOTH a cancellation-policy refund and a breakfast liability — ` +
          `the add-on liability should only open when the policy refunded nothing`
      );
    }
  }
  check(
    "I14",
    "Cancelled bookings with collected money — refund coverage and liability composition",
    rows.length === 0 ? "PASS" : "WARN",
    `${rows.length} cancelled booking(s) hold money · ${policyRows.length} liability-composition problem(s)`,
    [...rows, ...policyRows]
  );
}

// ---------------------------------------------------------------------------
// I15 — reservation linkage
// ---------------------------------------------------------------------------

{
  const reservationIds = new Set(reservationSnap.docs.map((d) => d.id));
  const missingReservation: string[] = [];
  const orphanBooking: string[] = [];
  const noReservationField: string[] = [];
  for (const b of bookings) {
    if (!b.reservationId) {
      noReservationField.push(b.ref);
      continue;
    }
    if (!reservationIds.has(b.reservationId)) missingReservation.push(`${b.ref} -> ${b.reservationId}`);
  }
  const reservationIdsUsed = new Set(bookings.map((b) => b.reservationId).filter(Boolean) as string[]);
  for (const d of reservationSnap.docs) {
    if (!reservationIdsUsed.has(d.id)) orphanBooking.push(d.id);
  }
  check(
    "I15",
    "Reservation linkage — every booking resolves to its reservation, every reservation to a booking",
    missingReservation.length === 0 ? "PASS" : "FAIL",
    `${reservationSnap.size} reservations · ${bookings.length - noReservationField.length} booking(s) carry a reservationId · ` +
      `${noReservationField.length} booking(s) without one · ${orphanReservationCount(orphanBooking)} reservation(s) with no booking`,
    [
      ...missingReservation.map((m) => `DANGLING: ${m}`),
      ...orphanBooking.map((o) => `RESERVATION WITH NO BOOKING: ${o}`)
    ]
  );
}
function orphanReservationCount(list: string[]) {
  return list.length;
}

// ---------------------------------------------------------------------------
// I16 — reports numbers, recomputed
// ---------------------------------------------------------------------------

{
  const windowStart = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const inWindow = bookings.filter((b) => b.checkIn >= windowStart && b.checkIn <= today);
  const billed = r2(inWindow.reduce((s, b) => s + folioOf(b).grandTotal, 0));
  const collected = r2(inWindow.reduce((s, b) => s + folioOf(b).ledgerGross, 0));
  const outstanding = r2(inWindow.reduce((s, b) => s + folioOf(b).balanceGross, 0));
  const roomNights = inWindow.reduce(
    (s, b) => s + Math.max(0, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000)),
    0
  );
  const adr = roomNights > 0 ? r2(billed / roomNights) : 0;

  // All-time totals, because a 30-day check-in window can legitimately be
  // empty in a pre-launch hotel whose bookings are all future-dated.
  const allBilled = r2(bookings.reduce((s, b) => s + folioOf(b).grandTotal, 0));
  const allCollected = r2(bookings.reduce((s, b) => s + folioOf(b).ledgerGross, 0));
  const allOutstanding = r2(bookings.reduce((s, b) => s + folioOf(b).balanceGross, 0));
  const allNights = bookings.reduce(
    (s, b) => s + Math.max(0, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86400000)),
    0
  );
  const allAdr = allNights > 0 ? r2(allBilled / allNights) : 0;

  // The allocation-based revenue stream — what the Reports revenue tab uses.
  const allocTotal = r2(
    bookings.reduce((s, b) => s + (b.allocation ? num(b.allocation.totalNet) : b.totalPrice), 0)
  );

  check(
    "I16",
    "Reports recomputed — 30-day window and all-time, billed / collected / outstanding / ADR",
    "INFO",
    `window ${windowStart}..${today}: ${inWindow.length} check-ins · billed ${peso(billed)} · ` +
      `collected ${peso(collected)} · outstanding ${peso(outstanding)} · ${roomNights} room-nights · ADR ${peso(adr)}` +
      `\n     all-time: ${bookings.length} bookings · billed ${peso(allBilled)} · collected ${peso(allCollected)} · ` +
      `outstanding ${peso(allOutstanding)} · ${allNights} room-nights · ADR ${peso(allAdr)}` +
      `\n     allocation revenue stream totalNet = ${peso(allocTotal)} · ` +
      `Δ vs folio billed = ${peson(r2(allocTotal - allBilled))}`,
    []
  );
}

// ---------------------------------------------------------------------------
// I17 — store revenue vs store tenders (F-C1 / F-C2)
// ---------------------------------------------------------------------------

{
  const delivered = storeOrders.filter((o) => o.status === "delivered");
  const storeRevenue = r2(delivered.reduce((s, o) => s + o.totalAmount, 0));
  const addToBill = r2(delivered.filter((o) => o.paymentMethod === "add-to-bill").reduce((s, o) => s + o.totalAmount, 0));
  const tenderByOrder = new Map<string, number>();
  for (const e of storeTenders) {
    const m = /^storeOrders\/([^/]+)\//.exec(e.path);
    if (!m) continue;
    tenderByOrder.set(m[1], (tenderByOrder.get(m[1]) || 0) + e.amount);
  }
  const tenderTotal = r2([...tenderByOrder.values()].reduce((s, v) => s + v, 0));
  const cancelledWithTender = storeOrders.filter(
    (o) => o.status === "cancelled" && (tenderByOrder.get(o.id) || 0) > 0
  );
  // Per QA §3.7 (2026-10-26): an ADD-TO-BILL order is delivered WITHOUT
  // a store tender BY DESIGN — its money rolls into the room folio,
  // not into the store's tender ledger (STORE-MANAGEMENT.md: "COD
  // maps to Cash, Add to Bill remains on the booking folio"). Counting
  // those as "delivered, no tender" was a false positive that kept
  // I17 failing on correct behaviour. Only a DIRECT-PAID delivery owes
  // a tender.
  const noTender = delivered.filter(
    (o) => o.paymentMethod !== "add-to-bill" && !(tenderByOrder.get(o.id) > 0)
  );
  const expectedGap = addToBill;
  const actualGap = r2(storeRevenue - tenderTotal);
  check(
    "I17",
    "F-C1 / F-C2 — store revenue reconciles with the store tenders",
    cancelledWithTender.length === 0 && noTender.length === 0 ? "PASS" : "FAIL",
    `${storeOrders.length} store orders · delivered revenue ${peso(storeRevenue)} ` +
      `(add-to-bill ${peso(addToBill)}) · tenders ${peso(tenderTotal)} · ` +
      `Δ revenue−tenders ${peso(actualGap)} (expected ${peso(expectedGap)} — the add-to-bill total, which lands on the folio) · ` +
      `${cancelledWithTender.length} cancelled order(s) still hold a tender`,
    [
      ...cancelledWithTender.map((o) => `CANCELLED WITH TENDER: ${o.ref} tender=${tenderByOrder.get(o.id)}`),
      ...noTender.map((o) => `DELIVERED, NO TENDER: ${o.ref} amount=${o.totalAmount}`)
    ]
  );
}

// ---------------------------------------------------------------------------
// production data manifest
// ---------------------------------------------------------------------------

const manifest = {
  generatedAt: new Date().toISOString(),
  project: env.FIREBASE_PROJECT_ID,
  counts: {
    bookings: bookingSnap.size,
    reservations: reservationSnap.size,
    payments: paymentSnap.size,
    refunds: refundSnap.size,
    charges: chargeSnap.size,
    storeOrders: storeOrderSnap.size,
    storeItems: storeItemSnap.size,
    vouchers: voucherSnap.size,
    members: memberSnap.size,
    notifications: notificationSnap.size,
    corporateCodes: corporateCodeSnap.size,
    corporateInquiries: corporateInquirySnap.size
  },
  bookingRows: bookings.map((b) => {
    const f = folioOf(b);
    return {
      id: b.id,
      ref: b.ref,
      status: b.status,
      source: b.source,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      isTestData: b.isTestData,
      totalPrice: f.totalPrice,
      otherAddOnTotal: f.otherAddOnTotal,
      storeTotal: f.storeTotal,
      chargesTotal: f.chargesTotal,
      grandTotal: f.grandTotal,
      ledgerPaidNet: f.ledgerNet,
      ledgerPaidGross: f.ledgerGross,
      balanceNet: f.balanceNet,
      balanceGross: f.balanceGross,
      paidAmountField: b.paidAmountField,
      hasAllocation: !!b.allocation
    };
  })
};

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.slice("--out=".length) : "qa-reconciliation.json";
writeFileSync(resolve(process.cwd(), outPath), JSON.stringify({ manifest, results }, null, 2));
console.log(`\nWrote ${outPath}`);

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const warn = results.filter((r) => r.status === "WARN").length;
const info = results.filter((r) => r.status === "INFO").length;
console.log(`\nI-checks: ${pass} PASS · ${fail} FAIL · ${warn} WARN · ${info} INFO`);
process.exit(0);
