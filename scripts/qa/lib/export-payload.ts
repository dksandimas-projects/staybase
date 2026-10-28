// PURE payload assembly for the production → staging export.
//
// WHY THIS FILE EXISTS
// --------------------
// The admin app's "Refresh Staging From Production" panel (Admin →
// Settings → Environment Testing) asks the operator to paste a JSON
// payload. The server's staging-refresh gate
// (`guest-app/server/handlers/test-runs.ts`) accepts EXACTLY:
//
//     { "export": { "bookings": [...], "storeOrders": [...], "members": [...] } }
//
// and every booking doc must carry an `id` (the server writes
// `doc(String(booking.id))`) plus the money the ledger actually holds.
//
// The money is NOT on the booking doc. Production keeps the ledger in
// SUBCOLLECTIONS:
//
//     reservations/{rid}/payments/{rowId}      ← the canonical payment source
//     reservations/{rid}/refunds/{rowId}       ← the canonical refund source
//     reservations/{rid}/charges/{rowId}       ← incidental charges
//     bookings/{bid}/payments|refunds|charges/ ← the legacy per-booking shape
//
// and 0 of 157 production bookings carry a `balanceDue` field — the
// export has to COMPUTE it.
//
// WHY A SEPARATE MODULE
// ----------------------
// The money math is the audited part of this export, so it must be
// provable WITHOUT touching production. This module is the pure half:
//
//   * no `firebase-admin` import (the reader owns that),
//   * no side effects, no top-level await, no clock, no I/O,
//   * the money math is the SHARED canonical helper
//     (`computeBookingFolio` from `@spark-inn/shared`) — the same code
//     the app's own money surfaces read, so an exported balance cannot
//     disagree with what the app would show.
//
// `scripts/qa/export-prod-data.ts` does the Firestore reads and hands
// normalized rows here; `scripts/qa/__tests__/export-payload.test.ts`
// proves the assembly with fixtures and no network.
//
// THE REFUND-LIABILITY RULE
// -------------------------
// A refund the hotel has approved but NOT paid out is a LIABILITY, not
// money collected. The shared helper (`isUnpaidRefund`) excludes a
// refund whose status is not "paid"/"processed" from the collected
// total — and a refund with NO status counts as pending. The export
// therefore carries the refund's RAW `status` through to the payload:
// dropping it would make a pending refund indistinguishable from a paid
// one and the exported balance would be wrong.

import { computeBookingFolio } from "@spark-inn/shared";

// ---------------------------------------------------------------------------
// path filters (mirrored from scripts/qa/reconcile-production.ts)
// ---------------------------------------------------------------------------

/**
 * The folio ledger lives under a booking or a reservation. A row
 * anywhere else — `storeOrders/{id}/payments/{rowId}`, the store's own
 * till tenders — is NOT room-folio money and must not be exported as
 * such.
 */
export const FOLIO_LEDGER_PATH =
  /^(reservations|bookings)\/[^/]+\/(payments|refunds)\/[^/]+$/;

/** Incidental charges live under the same two parents. */
export const CHARGE_LEDGER_PATH =
  /^(reservations|bookings)\/[^/]+\/charges\/[^/]+$/;

/** The legacy per-booking parent — the only path that can name a booking. */
const LEGACY_BOOKING_PATH = /^bookings\/([^/]+)\//;

// ---------------------------------------------------------------------------
// small helpers (mirrored from scripts/qa/reconcile-production.ts)
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 2dp is the canonical money granularity in this system. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// public types
// ---------------------------------------------------------------------------

/**
 * One normalized ledger row. The reader (`export-prod-data.ts`) produces
 * these from the Firestore snapshots; this module does the attribution,
 * the assembly and the money math.
 *
 * `bookingId` is the row's STAMPED `data.bookingId` (null when the row
 * carries none). The legacy path fallback is applied HERE, so the
 * reader never has to guess.
 */
export interface LedgerRow {
  /** The Firestore document id of the ledger row. */
  id: string;
  /** The FULL document path, e.g. `reservations/r1/payments/p1`. */
  path: string;
  /** The row's stamped `data.bookingId`, or null. */
  bookingId: string | null;
  /** The amount EXACTLY as stored (refunds are stored negative). */
  amount: number;
  /** The tender (`gcash`, `cash`, `card`, …), "" when absent. */
  method: string;
  /** The row's lifecycle status; "" when the row carries none. */
  status: string;
  /** The row's recorded timestamp, ISO 8601. */
  recordedAt: string;
  /** The refund/charge category, "" when absent. */
  category: string;
  /** The charge label, "" for payments/refunds. */
  label: string;
}

export interface ExportPayloadInput {
  /** Production booking docs. Each must carry its Firestore doc id in `id`. */
  bookings: any[];
  /** Production store-order docs. Each must carry its Firestore doc id in `id`. */
  storeOrders: any[];
  /** Production member docs. Each must carry its Firestore doc id in `id`. */
  members: any[];
  /** Rows read from `collectionGroup("payments")`. */
  paymentRows: LedgerRow[];
  /** Rows read from `collectionGroup("refunds")`. */
  refundRows: LedgerRow[];
  /** Rows read from `collectionGroup("charges")`. */
  chargeRows: LedgerRow[];
}

export interface ExportPayloadStats {
  bookings: number;
  storeOrders: number;
  members: number;
  /** Every ledger row the reader handed over (all three collections). */
  ledgerRowsRead: number;
  /** Rows attached to an exported booking. */
  ledgerRowsAttributed: number;
  /** Rows NOT attached to an exported booking (out-of-path, unattributable, duplicate). */
  ledgerRowsDropped: number;
  /** Bookings whose computed balance is not zero. */
  bookingsWithBalance: number;
}

export interface ExportPayloadResult {
  payload: any;
  stats: ExportPayloadStats;
}

// ---------------------------------------------------------------------------
// normalization helpers
// ---------------------------------------------------------------------------

const isTimestampLike = (v: unknown): boolean => {
  if (!v || typeof v !== "object") return false;
  const t = v as { toDate?: unknown; seconds?: unknown; nanoseconds?: unknown };
  if (typeof t.toDate === "function") return true;
  return typeof t.seconds === "number" && typeof t.nanoseconds === "number";
};

const isDocumentReferenceLike = (v: unknown): boolean => {
  if (!v || typeof v !== "object") return false;
  const t = v as { path?: unknown; collection?: unknown; constructor?: { name?: string } };
  if (typeof t.path !== "string") return false;
  if (t.constructor?.name === "DocumentReference") return true;
  return typeof t.collection === "function";
};

/**
 * Normalize a Firestore timestamp-ish value to an ISO 8601 string.
 *
 *   Timestamp  → its `toDate()` ISO string
 *   Date       → its ISO string
 *   string     → passed through unchanged
 *   anything   → ""
 *
 * `String(firestoreTimestamp)` yields "[object Object]", which silently
 * poisons every date comparison downstream — always normalize through
 * here.
 */
export function normalizeTimestamp(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (isTimestampLike(value)) {
    const t = value as { toDate?: () => Date; seconds?: number };
    if (typeof t.toDate === "function") {
      const d = t.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : "";
    }
    const seconds = num(t.seconds);
    const d = new Date(seconds * 1000);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

/**
 * Deep-convert a Firestore document into plain JSON:
 *
 *   Timestamp         → ISO 8601 string
 *   DocumentReference → its path
 *   Date              → ISO 8601 string
 *   everything else   → passed through (arrays/objects walked recursively)
 *
 * A plain object is returned, so `JSON.stringify` never sees a Firestore
 * type and the payload stays diffable.
 */
export function toPlainDoc(value: unknown): any {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) return value.map((v) => toPlainDoc(v));
  if (typeof value === "object") {
    if (isDocumentReferenceLike(value)) {
      return (value as { path: string }).path;
    }
    if (isTimestampLike(value)) {
      return normalizeTimestamp(value);
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toPlainDoc(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// attribution
// ---------------------------------------------------------------------------

interface AttributedRow {
  row: LedgerRow;
  /** "payment" | "refund" — a negative amount in the payments collection is a refund. */
  type: "payment" | "refund";
  bookingId: string;
  /** Which collection the row was read from ("payments" | "refunds"). */
  source: "payments" | "refunds";
}

const typeOfRow = (row: LedgerRow, source: "payments" | "refunds"): "payment" | "refund" => {
  // A refund row is a refund even when the amount happens to be stored
  // positive; a negative amount in the payments collection is a legacy
  // refund (mirrors `toLedger` in scripts/qa/reconcile-production.ts).
  if (source === "refunds") return "refund";
  return row.amount < 0 ? "refund" : "payment";
};

/**
 * Attribute one ledger row to a booking.
 *
 *   1. the row's STAMPED `data.bookingId` when it is present and non-empty;
 *   2. otherwise the LEGACY path (`bookings/{id}/...`) — the only path
 *      segment that names a booking;
 *   3. otherwise nothing (the row is dropped and counted).
 *
 * A row whose stamped bookingId names a booking that is NOT in the
 * export is dropped and counted as well.
 */
const attributeBooking = (
  row: LedgerRow,
  knownBookingIds: Set<string>
): { bookingId: string | null; dropped: boolean } => {
  const stamped =
    typeof row.bookingId === "string" && row.bookingId.trim()
      ? row.bookingId.trim()
      : null;
  const legacyPathBooking = LEGACY_BOOKING_PATH.exec(row.path)?.[1] ?? null;
  const bookingId = stamped ?? legacyPathBooking;
  if (!bookingId) return { bookingId: null, dropped: true };
  if (!knownBookingIds.has(bookingId)) return { bookingId: null, dropped: true };
  return { bookingId, dropped: false };
};

// ---------------------------------------------------------------------------
// the payload assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the staging-refresh payload from production docs + the
 * production ledger.
 *
 * The money is computed with the shared canonical helper
 * (`computeBookingFolio`), fed per booking:
 *
 *   booking.totalPrice            ← the production booking doc
 *   booking.otherAddOnTotal       ← the BR-12 other add-ons (0 when absent)
 *   persistedPayments             ← that booking's payment + refund rows
 *   selectedBookingCharges        ← that booking's charge rows
 *   folioBookingIds               ← [booking.id]
 *   storeOrders                   ← ALL store orders in the export
 *
 * `balanceDue` is the helper's `.balance`.
 */
export function buildExportPayload(input: ExportPayloadInput): ExportPayloadResult {
  const bookingsIn = Array.isArray(input.bookings) ? input.bookings : [];
  const storeOrdersIn = Array.isArray(input.storeOrders) ? input.storeOrders : [];
  const membersIn = Array.isArray(input.members) ? input.members : [];
  const paymentRows = Array.isArray(input.paymentRows) ? input.paymentRows : [];
  const refundRows = Array.isArray(input.refundRows) ? input.refundRows : [];
  const chargeRows = Array.isArray(input.chargeRows) ? input.chargeRows : [];

  // ── the bookings, keyed by their Firestore document id ────────────────
  const knownBookingIds = new Set<string>();
  const bookingDocs = bookingsIn.map((doc) => {
    const id =
      doc && typeof doc === "object" && doc.id !== null && doc.id !== undefined
        ? String(doc.id)
        : "";
    knownBookingIds.add(id);
    return { doc, id };
  });

  // ── attribute the ledger ──────────────────────────────────────────────
  const ledgerRowsRead = paymentRows.length + refundRows.length + chargeRows.length;
  let ledgerRowsAttributed = 0;
  let ledgerRowsDropped = 0;

  const paymentsByBooking = new Map<string, AttributedRow[]>();
  const chargesByBooking = new Map<string, LedgerRow[]>();

  // A row is never counted twice. Two guards:
  //   1. the same document path (the reader handed the same row over twice);
  //   2. the same LOGICAL row mirrored across the payments and the refunds
  //      collection (the pre-MRB-01 layout stored a refund in both places)
  //      — same booking, same type, same amount, same recordedAt.
  const seenPaths = new Set<string>();
  const seenLogical = new Map<string, "payments" | "refunds">();

  const considerRow = (
    row: LedgerRow,
    source: "payments" | "refunds",
    isCharge: boolean
  ): void => {
    // (a) the path filter — store-order tenders are not room money.
    const pathOk = isCharge
      ? CHARGE_LEDGER_PATH.test(row.path)
      : FOLIO_LEDGER_PATH.test(row.path);
    if (!pathOk) {
      ledgerRowsDropped++;
      return;
    }

    // (b) attribution — stamped booking id, else the legacy path.
    const { bookingId, dropped } = attributeBooking(row, knownBookingIds);
    if (dropped || !bookingId) {
      ledgerRowsDropped++;
      return;
    }

    // (c) deduplication — the same document handed over twice.
    if (seenPaths.has(row.path)) {
      ledgerRowsDropped++;
      return;
    }
    seenPaths.add(row.path);

    if (isCharge) {
      // Charges have their own dedup namespace: a charge and a payment
      // of the same amount at the same instant are two DIFFERENT rows.
      const chargeKey = `charge|${bookingId}|${row.amount}|${row.recordedAt}|${row.label}`;
      if (seenLogical.has(chargeKey)) {
        ledgerRowsDropped++;
        return;
      }
      seenLogical.set(chargeKey, source);

      ledgerRowsAttributed++;
      const arr = chargesByBooking.get(bookingId) || [];
      arr.push(row);
      chargesByBooking.set(bookingId, arr);
      return;
    }

    // The same LOGICAL row mirrored across the payments and the refunds
    // collection (the pre-MRB-01 layout stored a refund in both places)
    // — same booking, same type, same amount, same recordedAt.
    const type = typeOfRow(row, source);
    const logicalKey = `${bookingId}|${type}|${row.amount}|${row.recordedAt}`;
    const priorSource = seenLogical.get(logicalKey);
    if (priorSource && priorSource !== source) {
      // The mirror — keep the first, drop the second.
      ledgerRowsDropped++;
      return;
    }
    seenLogical.set(logicalKey, source);

    ledgerRowsAttributed++;
    const arr = paymentsByBooking.get(bookingId) || [];
    arr.push({ row, type, bookingId, source });
    paymentsByBooking.set(bookingId, arr);
  };

  for (const row of paymentRows) considerRow(row, "payments", false);
  for (const row of refundRows) considerRow(row, "refunds", false);
  for (const row of chargeRows) considerRow(row, "payments", true);

  // ── the store orders the folio reads ──────────────────────────────────
  // ALL store orders go in — the shared helper filters them down to the
  // ones that qualify for THIS booking (add-to-bill + delivered + billed).
  const folioStoreOrders = storeOrdersIn.map((o) => ({
    bookingId: typeof o?.bookingId === "string" ? o.bookingId : null,
    paymentMethod: typeof o?.paymentMethod === "string" ? o.paymentMethod : null,
    status: typeof o?.status === "string" ? o.status : null,
    isBilled: o?.isBilled === true,
    totalAmount: num(o?.totalAmount)
  }));

  // ── assemble the bookings ─────────────────────────────────────────────
  let bookingsWithBalance = 0;

  const bookings = bookingDocs.map(({ doc, id }) => {
    const { id: _docId, ...rest } = (doc ?? {}) as Record<string, unknown>;

    const totalPrice = num(rest.totalPrice);
    // Per OCT-FOL-01 (decision #298) the BR-12 other add-ons sit ON TOP
    // of `totalPrice`, not inside it. The shared helper clamps a
    // negative to 0; the exported field carries the same clamped value
    // so the payload is self-consistent.
    const otherAddOnTotal = Math.max(0, num(rest.otherAddOnTotal));

    const attributed = paymentsByBooking.get(id) || [];
    const charges = chargesByBooking.get(id) || [];

    // The folio's payments — the row's RAW status travels with it so the
    // shared helper can tell a pending refund (liability) from a paid
    // one (money that left the till).
    const persistedPayments = attributed.map((a) => ({
      amount: a.row.amount,
      type: a.type,
      status: a.row.status
    }));
    const selectedBookingCharges = charges.map((c) => ({
      amount: c.amount,
      label: c.label
    }));

    const folio = computeBookingFolio({
      booking: { id, totalPrice, otherAddOnTotal },
      persistedPayments,
      selectedBookingCharges,
      folioBookingIds: [id],
      storeOrders: folioStoreOrders
    });

    const balanceDue = r2(folio.balance);
    if (balanceDue !== 0) bookingsWithBalance++;

    // The exported ledger rows. The amount's sign is preserved EXACTLY as
    // stored — refunds are stored negative.
    const onsitePayments = attributed
      .map((a) => ({
        id: a.row.id,
        type: a.type,
        amount: a.row.amount,
        method: a.row.method,
        status: a.row.status,
        recordedAt: a.row.recordedAt,
        category: a.row.category
      }))
      .sort(
        (x, y) =>
          (x.recordedAt < y.recordedAt ? -1 : x.recordedAt > y.recordedAt ? 1 : 0) ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
      );

    // ALL charges for the booking — the production convention is that a
    // void pair is TWO rows whose amounts net to zero.
    const addedCharges = charges
      .map((c) => ({
        id: c.id,
        label: c.label,
        amount: c.amount,
        category: c.category
      }))
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

    return {
      id,
      ...rest,
      onsitePayments,
      addedCharges,
      balanceDue,
      otherAddOnTotal
    };
  });

  const storeOrders = storeOrdersIn.map((doc) => {
    const { id: _docId, ...rest } = (doc ?? {}) as Record<string, unknown>;
    return {
      id:
        doc && typeof doc === "object" && doc.id !== null && doc.id !== undefined
          ? String(doc.id)
          : "",
      ...rest
    };
  });

  const members = membersIn.map((doc) => {
    const { id: _docId, ...rest } = (doc ?? {}) as Record<string, unknown>;
    return {
      id:
        doc && typeof doc === "object" && doc.id !== null && doc.id !== undefined
          ? String(doc.id)
          : "",
      ...rest
    };
  });

  const payload = {
    export: {
      bookings,
      storeOrders,
      members
    }
  };

  return {
    payload,
    stats: {
      bookings: bookings.length,
      storeOrders: storeOrders.length,
      members: members.length,
      ledgerRowsRead,
      ledgerRowsAttributed,
      ledgerRowsDropped,
      bookingsWithBalance
    }
  };
}
