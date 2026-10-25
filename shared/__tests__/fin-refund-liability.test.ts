// Per FIN-REFUND-LIABILITY (QA pass 2026-10-24): a refund the hotel has
// APPROVED but not yet PAID is a LIABILITY, not collected money.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `admin-app/src/utils/bookingPaymentEntries.ts` → `normalizeLedgerDoc`
// DROPPED the refund doc's `status`, so a pending refund was
// indistinguishable from one that had been paid out. Both were netted
// into `paymentsTotal`, so a fully settled guest read as a debtor:
//
//   SI-20261021-00058  collected ₱2,800 · bill ₱2,800 · refund ₱100 PENDING
//     before: paid ₱2,700 · balance ₱100   ← the guest owes nothing
//     after:  paid ₱2,800 · balance ₱0     ← and the hotel owes ₱100
//
// The folio's own contract already said it — "a negative balance means
// the guest is overpaid (refund pending)" — the implementation just did
// not match it.
//
// THE FIX
// -------
//   * `normalizeLedgerDoc` keeps `status`;
//   * `isUnpaidRefund` / `sumCollectedPayments` (shared) exclude a
//     pending refund from the collected total;
//   * a refund with NO status counts as PENDING — the same convention
//     the dashboard's pending-refunds counter uses
//     (`data.status || "pending"`).

import { describe, it, expect } from "vitest";
import {
  computeBookingFolio,
  isUnpaidRefund,
  sumCollectedPayments,
  type FolioBooking
} from "../utils/bookingFolio";
import {
  normalizeLedgerDoc,
  buildBookingPaymentIndex,
  resolveBookingOnsitePayments
} from "../../admin-app/src/utils/bookingPaymentEntries";

const booking: FolioBooking = { id: "A6BR08CANCEL0000001", totalPrice: 2800 };

describe("isUnpaidRefund — the pending-refund rule", () => {
  it("treats a pending refund as a liability", () => {
    expect(isUnpaidRefund({ amount: -100, type: "refund", status: "pending" })).toBe(true);
  });

  it("treats a refund with no status as pending (the dashboard's convention)", () => {
    expect(isUnpaidRefund({ amount: -1000, type: "refund" })).toBe(true);
    expect(isUnpaidRefund({ amount: -1000, type: "refund", status: null })).toBe(true);
  });

  it("treats a PAID refund as settled money that has left the till", () => {
    expect(isUnpaidRefund({ amount: -100, type: "refund", status: "paid" })).toBe(false);
    expect(isUnpaidRefund({ amount: -100, type: "refund", status: "processed" })).toBe(false);
  });

  it("never treats a payment as a refund", () => {
    expect(isUnpaidRefund({ amount: 2800, type: "payment", status: "pending" })).toBe(false);
    expect(isUnpaidRefund({ amount: 2800 })).toBe(false);
  });

  it("recognises a refund by its negative amount even without an explicit type", () => {
    expect(isUnpaidRefund({ amount: -100 })).toBe(true);
  });
});

describe("sumCollectedPayments — pending refunds are not collected money", () => {
  it("nets a PAID refund but not a pending one", () => {
    const entries = [
      { amount: 2800, type: "payment" as const },
      { amount: -100, type: "refund" as const, status: "pending" }
    ];
    expect(sumCollectedPayments(entries)).toBe(2800);
  });

  it("nets a refund that has actually been paid out", () => {
    const entries = [
      { amount: 2800, type: "payment" as const },
      { amount: -100, type: "refund" as const, status: "paid" }
    ];
    expect(sumCollectedPayments(entries)).toBe(2700);
  });
});

describe("computeBookingFolio — a settled guest is not a debtor", () => {
  it("does not net a pending refund against the collected money", () => {
    const folio = computeBookingFolio({
      booking,
      storeOrders: [],
      persistedPayments: [
        { amount: 2800, type: "payment" },
        { amount: -100, type: "refund", status: "pending" }
      ]
    });

    expect(folio.paymentsTotal).toBe(2800);
    expect(folio.balance).toBe(0);
  });

  it("nets a refund that has been paid out", () => {
    const folio = computeBookingFolio({
      booking,
      storeOrders: [],
      persistedPayments: [
        { amount: 2800, type: "payment" },
        { amount: -100, type: "refund", status: "paid" }
      ]
    });

    expect(folio.paymentsTotal).toBe(2700);
    expect(folio.balance).toBe(100);
  });

  it("still nets a refund that predates the status field (legacy docs)", () => {
    // A legacy refund doc with no `status` is PENDING by the app's own
    // convention, so it must not reduce the collected total.
    const folio = computeBookingFolio({
      booking,
      storeOrders: [],
      persistedPayments: [
        { amount: 2800, type: "payment" },
        { amount: -100, type: "refund" }
      ]
    });

    expect(folio.paymentsTotal).toBe(2800);
    expect(folio.balance).toBe(0);
  });
});

describe("normalizeLedgerDoc — the refund's status must survive", () => {
  it("keeps `status: \"pending\"` on a refund doc", () => {
    const doc = normalizeLedgerDoc("bookings/A6BR08CANCEL0000001/refunds/r1", {
      amount: -100,
      type: "refund",
      status: "pending",
      category: "breakfast",
      bookingId: "A6BR08CANCEL0000001"
    });

    expect(doc.status).toBe("pending");
    expect(doc.type).toBe("refund");
  });

  it("records a missing status as `null` (not as a pending/paid guess)", () => {
    const doc = normalizeLedgerDoc("reservations/r1/refunds/QARefundFix01", {
      amount: -1000,
      type: "refund",
      bookingId: "A2FD10Walkin0001"
    });

    expect(doc.status).toBeNull();
  });

  it("carries the status through the per-booking index", () => {
    const docs = [
      normalizeLedgerDoc("bookings/A6BR08CANCEL0000001/payments/p1", {
        amount: 2800,
        type: "payment",
        bookingId: "A6BR08CANCEL0000001"
      }),
      normalizeLedgerDoc("bookings/A6BR08CANCEL0000001/refunds/r1", {
        amount: -100,
        type: "refund",
        status: "pending",
        bookingId: "A6BR08CANCEL0000001"
      })
    ];

    const index = buildBookingPaymentIndex(docs);
    const entries = index["A6BR08CANCEL0000001"];
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.type === "refund")?.status).toBe("pending");
  });

  it("a resolved booking ledger carries the pending status to the folio", () => {
    const docs = [
      normalizeLedgerDoc("bookings/A6BR08CANCEL0000001/payments/p1", {
        amount: 2800,
        type: "payment",
        bookingId: "A6BR08CANCEL0000001"
      }),
      normalizeLedgerDoc("bookings/A6BR08CANCEL0000001/refunds/r1", {
        amount: -100,
        type: "refund",
        status: "pending",
        bookingId: "A6BR08CANCEL0000001"
      })
    ];
    const index = buildBookingPaymentIndex(docs);
    const resolved = resolveBookingOnsitePayments("A6BR08CANCEL0000001", [], index);

    const folio = computeBookingFolio({
      booking,
      storeOrders: [],
      persistedPayments: resolved
    });

    expect(folio.paymentsTotal).toBe(2800);
    expect(folio.balance).toBe(0);
  });
});
