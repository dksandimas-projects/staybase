// Per RPT-01 (QA pass 2026-10-21): the admin bookings list reads a
// payment ledger that the server never wrote.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The admin bookings mapper hydrates `booking.onsitePayments` — the
// DENORMALIZED array on the booking doc — and four admin surfaces
// read it:
//
//   1. the row's "Paid" pill (`BookingsPage.tsx` → `isBookingPaid`)
//   2. the advanced filter's "Payment state" (`getBookingFolio` →
//      `persistedPayments`)
//   3. the dashboard's "pending payments" card
//   4. the advanced filter's "Reference" search
//
// The server NEVER writes that array. Measured against production on
// 2026-10-21: 0 of 67 bookings carried an `onsitePayments` field, so
// every one of those surfaces read "₱0 paid" for every booking —
// the "Paid" pill never rendered, the "paid" / "partial" filters
// matched nothing, and the pending-payments card claimed every guest
// owed the full amount.
//
// The money lives in the payments / refunds subcollections, and the
// server stamps `bookingId` on every entry
// (`guest-app/server/handlers/bookings.ts:10498` — "per-room
// attribution possible via `bookingId`"). This suite pins the
// resolver that turns those docs back into the per-booking ledger.
//
// The behavioural half (the pure resolver) is the real test. The
// source-text half is the tripwire that the wiring stays wired.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBookingPaymentIndex,
  isFolioLedgerPath,
  normalizeLedgerDoc,
  resolveBookingOnsitePayments,
  sameLedgerPayments,
  type PaymentLedgerDoc,
} from "../utils/bookingPaymentEntries";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

/** A Firestore-Timestamp-like object (duck-typed `toDate()`). */
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

const doc = (
  path: string,
  data: Record<string, unknown>
): PaymentLedgerDoc => normalizeLedgerDoc(path, data);

/** A one-booking index used by the resolver + comparator suites. */
const sampleIndex = buildBookingPaymentIndex([
  doc("reservations/r-1/payments/p-1", {
    amount: 5400,
    bookingId: "BOOK-1",
    recordedAt: "2026-10-21T06:00:00.000Z",
  }),
]);

describe("RPT-01 — the canonical payment ledger resolver", () => {
  describe("normalizeLedgerDoc", () => {
    it("reads the booking attribution from the doc's `bookingId` field", () => {
      const entry = doc("reservations/r-1/payments/p-1", {
        type: "payment",
        amount: 5400,
        method: "gcash",
        bookingId: "BOOK-1",
        reservationId: "r-1",
        recordedAt: timestamp("2026-10-21T06:37:33.302Z"),
      });
      expect(entry.bookingId).toBe("BOOK-1");
      expect(entry.reservationId).toBe("r-1");
      expect(entry.amount).toBe(5400);
      expect(entry.method).toBe("gcash");
      expect(entry.type).toBe("payment");
    });

    it("falls back to the path for a legacy `bookings/{id}/payments/{pid}` doc", () => {
      // A legacy doc may predate the `bookingId` stamp. The path
      // still says which booking it belongs to.
      const entry = doc("bookings/BOOK-9/payments/p-legacy", {
        type: "payment",
        amount: 1200,
        recordedAt: "2026-08-01T00:00:00.000Z",
      });
      expect(entry.bookingId).toBe("BOOK-9");
    });

    it("normalizes `recordedAt` from a Timestamp, a Date, and an ISO string", () => {
      expect(doc("bookings/B/payments/1", { recordedAt: timestamp("2026-10-21T06:37:33.302Z") }).recordedAt)
        .toBe("2026-10-21T06:37:33.302Z");
      expect(doc("bookings/B/payments/1", { recordedAt: new Date("2026-10-21T06:37:33.302Z") }).recordedAt)
        .toBe("2026-10-21T06:37:33.302Z");
      expect(doc("bookings/B/payments/1", { recordedAt: "2026-10-21T06:37:33.302Z" }).recordedAt)
        .toBe("2026-10-21T06:37:33.302Z");
    });

    it("types a negative amount as a refund (the CRL-01 convention)", () => {
      const entry = doc("reservations/r-1/refunds/rf-1", {
        type: "refund",
        amount: -1000,
        bookingId: "BOOK-1",
        recordedAt: timestamp("2026-10-21T06:37:33.302Z"),
      });
      expect(entry.type).toBe("refund");
      expect(entry.amount).toBe(-1000);
    });

    it("types an entry as a refund when the amount is negative even without `type: 'refund'`", () => {
      const entry = doc("bookings/B/payments/1", { amount: -250, recordedAt: "2026-01-01T00:00:00.000Z" });
      expect(entry.type).toBe("refund");
    });

    it("treats a non-numeric amount as 0 rather than NaN", () => {
      const entry = doc("bookings/B/payments/1", { amount: "not-a-number", recordedAt: "2026-01-01T00:00:00.000Z" });
      expect(entry.amount).toBe(0);
      expect(Number.isNaN(entry.amount)).toBe(false);
    });
  });

  describe("isFolioLedgerPath", () => {
    it("accepts the four folio ledger paths", () => {
      expect(isFolioLedgerPath("reservations/r-1/payments/p-1")).toBe(true);
      expect(isFolioLedgerPath("reservations/r-1/refunds/rf-1")).toBe(true);
      expect(isFolioLedgerPath("bookings/b-1/payments/p-1")).toBe(true);
      expect(isFolioLedgerPath("bookings/b-1/refunds/rf-1")).toBe(true);
    });

    it("REJECTS a store-order tender — it is not a room folio payment", () => {
      // The store writes its tender under the ORDER, not the booking:
      // "Store tenders live under the order (not the linked booking),
      // so they participate in the collection-group reconciliation
      // without reducing the room folio."
      // (`guest-app/server/handlers/store.ts:106`).
      expect(isFolioLedgerPath("storeOrders/o-1/payments/delivery-tender")).toBe(false);
    });

    it("rejects a path that is not a ledger entry at all", () => {
      expect(isFolioLedgerPath("reservations/r-1")).toBe(false);
      expect(isFolioLedgerPath("bookings/b-1/payments")).toBe(false);
      expect(isFolioLedgerPath("storeOrders/o-1/payments/delivery-tender/meta")).toBe(false);
    });
  });

  describe("buildBookingPaymentIndex", () => {
    it("groups entries by the booking they were recorded against", () => {
      const index = buildBookingPaymentIndex([
        doc("reservations/r-1/payments/p-1", { amount: 5400, bookingId: "BOOK-1", recordedAt: "2026-10-21T06:00:00.000Z" }),
        doc("reservations/r-1/payments/p-2", { amount: 1000, bookingId: "BOOK-2", recordedAt: "2026-10-21T07:00:00.000Z" }),
      ]);
      expect(Object.keys(index).sort()).toEqual(["BOOK-1", "BOOK-2"]);
      expect(index["BOOK-1"]).toHaveLength(1);
      expect(index["BOOK-1"][0].amount).toBe(5400);
    });

    it("EXCLUDES a store-order tender — it must not reduce the room folio", () => {
      // Regression guard for the double-count: the folio already adds
      // a delivered + billed add-to-bill store order to the grand
      // total via `computeBookingFolio`'s `storeTotal`. Counting the
      // tender as a room payment would charge the guest twice.
      const index = buildBookingPaymentIndex([
        doc("storeOrders/o-1/payments/delivery-tender", {
          amount: 150,
          bookingId: "BOOK-1",
          recordedAt: "2026-10-21T06:00:00.000Z",
        }),
        doc("reservations/r-1/payments/p-1", {
          amount: 1800,
          bookingId: "BOOK-1",
          recordedAt: "2026-10-21T06:30:00.000Z",
        }),
      ]);
      expect(index["BOOK-1"]).toHaveLength(1);
      expect(index["BOOK-1"][0].amount).toBe(1800);
    });

    it("drops an entry with no attributable booking (a bare reservation-scope entry)", () => {
      const index = buildBookingPaymentIndex([
        doc("reservations/r-1/payments/p-1", {
          amount: 5400,
          reservationId: "r-1",
          recordedAt: "2026-10-21T06:00:00.000Z",
        }),
      ]);
      expect(index["BOOK-1"]).toBeUndefined();
      expect(Object.keys(index)).toHaveLength(0);
    });

    it("orders the entries oldest-first, matching the drawer's live listener", () => {
      const index = buildBookingPaymentIndex([
        doc("reservations/r-1/payments/p-2", { amount: 3800, bookingId: "BOOK-1", recordedAt: "2026-10-21T08:00:00.000Z" }),
        doc("reservations/r-1/payments/p-1", { amount: 1000, bookingId: "BOOK-1", recordedAt: "2026-10-21T06:00:00.000Z" }),
      ]);
      expect(index["BOOK-1"].map((e) => e.amount)).toEqual([1000, 3800]);
    });

    it("keeps a refund in the same ledger as the payment it offsets", () => {
      // The production shape: a ₱5,400 payment and a ₱1,000 refund on
      // the same booking → the row's paid total is ₱4,400.
      const index = buildBookingPaymentIndex([
        doc("reservations/r-1/payments/p-1", { amount: 5400, bookingId: "BOOK-1", recordedAt: "2026-10-21T06:00:00.000Z" }),
        doc("reservations/r-1/refunds/rf-1", { amount: -1000, bookingId: "BOOK-1", recordedAt: "2026-10-21T07:00:00.000Z" }),
      ]);
      expect(index["BOOK-1"]).toHaveLength(2);
      const total = index["BOOK-1"].reduce((sum, e) => sum + e.amount, 0);
      expect(total).toBe(4400);
      expect(index["BOOK-1"][1].type).toBe("refund");
    });
  });

  describe("resolveBookingOnsitePayments", () => {
    const index = sampleIndex;

    it("prefers the canonical index over the booking doc's denormalized array", () => {
      const resolved = resolveBookingOnsitePayments("BOOK-1", [], sampleIndex);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].amount).toBe(5400);
    });

    it("falls back to the denormalized array when the index has nothing for the booking", () => {
      const legacy = [
        {
          id: "legacy-1",
          type: "payment" as const,
          amount: 999,
          method: "cash",
          note: "",
          transactionReference: null,
          reason: null,
          approvedBy: null,
          recordedBy: "staff",
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      const resolved = resolveBookingOnsitePayments("BOOK-OTHER", legacy, index);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].amount).toBe(999);
    });

    it("is IDEMPOTENT — resolving twice must not grow the ledger", () => {
      // The re-hydration effect re-resolves every booking whenever the
      // ledger changes. A union-style merge would double-count on
      // every pass; a wholesale index swap cannot.
      const once = resolveBookingOnsitePayments("BOOK-1", [], sampleIndex);
      const twice = resolveBookingOnsitePayments("BOOK-1", once, index);
      expect(twice).toHaveLength(1);
      expect(twice[0].amount).toBe(5400);
    });
  });

  describe("sameLedgerPayments", () => {
    it("detects a changed amount", () => {
      const a = resolveBookingOnsitePayments("BOOK-1", [], sampleIndex);
      const b = [{ ...a[0], amount: 1 }];
      expect(sameLedgerPayments(a, b)).toBe(false);
    });

    it("treats two empty ledgers as equal", () => {
      expect(sameLedgerPayments([], [])).toBe(true);
      expect(sameLedgerPayments(undefined, [])).toBe(true);
      expect(sameLedgerPayments([], undefined)).toBe(true);
    });

    it("reports equal for the same ledger", () => {
      const a = resolveBookingOnsitePayments("BOOK-1", [], sampleIndex);
      const b = resolveBookingOnsitePayments("BOOK-1", [], sampleIndex);
      expect(sameLedgerPayments(a, b)).toBe(true);
    });
  });
});

describe("RPT-01 — the AdminContext wiring (tripwire)", () => {
  it("the bookings mapper resolves `onsitePayments` from the canonical index", () => {
    // The mapper MUST call the resolver. Without it the field stays
    // the booking doc's (always empty) denormalized array and every
    // reading surface stays broken.
    //
    // Per RPT-01b (QA pass 2026-10-23) the resolution happens at
    // COMMIT time — immediately before the rows are written to state —
    // not inside the per-row mapping loop. Resolving inside the loop
    // captured the index as it was at SNAPSHOT time; the `await` that
    // follows (the private storage URLs) is long enough for the
    // payments listener to land in between, and the mapper then
    // committed its stale, un-hydrated array over the rows the
    // re-hydration effect had already repaired. The full pin for the
    // new structure is `rpt-01b-commit-time-ledger.test.ts`.
    expect(adminContextSrc).toMatch(
      /booking\.onsitePayments\s*=\s*resolveBookingOnsitePayments\(/
    );
  });

  it("the mapper keeps the denormalized array as the fallback", () => {
    expect(adminContextSrc).toMatch(/legacyOnsitePaymentsRef\.current\[docSnap\.id\]/);
  });

  it("the app subscribes to the `refunds` collection group", () => {
    // A refund is the OTHER half of the ledger: without it a refunded
    // booking would read as overpaid.
    expect(adminContextSrc).toMatch(/collectionGroup\(db,\s*"refunds"\)/);
  });

  it("the payments collection group feeds the per-booking ledger", () => {
    expect(adminContextSrc).toMatch(/setPaymentLedgerDocs\(/);
    expect(adminContextSrc).toMatch(/normalizeLedgerDoc\(/);
  });

  it("the re-hydration effect keeps the row in step with the ledger", () => {
    // A payment recorded AFTER the bookings snapshot must still flip
    // the row to "Paid" — the two listeners are independent.
    //
    // Per RPT-01b (QA pass 2026-10-23) the effect must ALSO depend on
    // the ROWS: if it only watched the index, it could run before the
    // rows arrived, short-circuit on an empty list, and then never run
    // again — leaving every row un-hydrated. That is exactly what
    // shipped, and it is why the production list read "PHP 0 paid" for
    // all 68 rows.
    expect(adminContextSrc).toMatch(/\}, \[paymentIndex, currentUser, bookings\]\);/);
    expect(adminContextSrc).toMatch(/sameLedgerPayments\(resolved, booking\.onsitePayments\)/);
  });
});
