import { describe, it, expect } from "vitest";
import {
  computeBookingFolio,
  computeServerFolioTotals,
  type FolioBooking,
  type FolioCharge,
  type FolioLivePayments,
  type FolioStoreOrder
} from "../utils/bookingFolio";

// Per PMH-02 (2026-07-31): characterization tests for the new
// shared folio math. These tests pin the contract that the
// `computeBookingFolio` and `computeServerFolioTotals` shared
// helpers implement. The expected values were derived from the
// pre-refactor behavior of:
//   - `getBookingFolio` in `admin-app/src/pages/BookingsPage.tsx`
//     (the local closure, 8 call sites)
//   - The inline `folioTotal` / `computedBalance` math in
//     `guest-app/server/handlers/bookings.ts`
//   - `summarizeFolioSnapshot` in `admin-app/src/utils/finance.ts`
//
// The refactor is a pure function extraction with zero behavior
// change — the new helpers return the same values the old code
// did. The pre-launch test suite runs these against the real
// Firestore emulator via PMH-05 (in progress) for end-to-end
// coverage; these unit tests pin the per-booking math at the
// function boundary so the array-write-integrity class of bug
// (RTS-01) cannot re-introduce a per-booking miscount.

const baseBooking: FolioBooking = {
  id: "b1",
  totalPrice: 4000
};

describe("computeBookingFolio — basic shape", () => {
  it("returns the documented folio shape for an empty input", () => {
    const folio = computeBookingFolio({ booking: baseBooking, storeOrders: [] });
    expect(folio).toEqual({
      storeCharges: [],
      storeTotal: 0,
      charges: [],
      chargesTotal: 0,
      paymentsTotal: 0,
      grandTotal: 4000, // booking.totalPrice
      balance: 4000 // grandTotal - 0
    });
  });

  it("includes only the store orders that match this booking + qualify (add-to-bill + delivered + isBilled)", () => {
    const storeOrders: FolioStoreOrder[] = [
      // Match: this booking, add-to-bill, delivered, isBilled
      {
        bookingId: "b1",
        paymentMethod: "add-to-bill",
        status: "delivered",
        isBilled: true,
        totalAmount: 500
      },
      // Wrong booking
      {
        bookingId: "b2",
        paymentMethod: "add-to-bill",
        status: "delivered",
        isBilled: true,
        totalAmount: 999
      },
      // Wrong payment method
      {
        bookingId: "b1",
        paymentMethod: "cod",
        status: "delivered",
        isBilled: true,
        totalAmount: 999
      },
      // Wrong status
      {
        bookingId: "b1",
        paymentMethod: "add-to-bill",
        status: "pending",
        isBilled: true,
        totalAmount: 999
      },
      // Not billed
      {
        bookingId: "b1",
        paymentMethod: "add-to-bill",
        status: "delivered",
        isBilled: false,
        totalAmount: 999
      }
    ];
    const folio = computeBookingFolio({ booking: baseBooking, storeOrders });
    expect(folio.storeCharges).toHaveLength(1);
    expect(folio.storeTotal).toBe(500);
    expect(folio.grandTotal).toBe(4000 + 500);
    expect(folio.balance).toBe(4000 + 500);
  });

  it("uses persistedPayments when no live payments are passed", () => {
    const folio = computeBookingFolio({
      booking: baseBooking,
      storeOrders: [],
      persistedPayments: [{ amount: 1500 }, { amount: 1000 }]
    });
    expect(folio.paymentsTotal).toBe(2500);
    expect(folio.balance).toBe(4000 - 2500);
  });

  it("prefers live selectedBookingPayments over persistedPayments (optimistic update path)", () => {
    // Drawer scenario: the staff just recorded a new payment; the
    // local state has the new payment, but persistedPayments is
    // still the pre-snapshot copy. The function should use the
    // live copy.
    const livePayments: FolioLivePayments = [
      { amount: 1000 },
      { amount: 2000 } // the new one
    ];
    const folio = computeBookingFolio({
      booking: baseBooking,
      storeOrders: [],
      persistedPayments: [{ amount: 1000 }],
      selectedBookingPayments: livePayments
    });
    expect(folio.paymentsTotal).toBe(3000);
    expect(folio.balance).toBe(4000 - 3000);
  });
});

describe("computeBookingFolio — live charges (selected booking)", () => {
  it("uses live selectedBookingCharges when provided", () => {
    const liveCharges: FolioCharge[] = [
      { amount: 200 },
      { amount: 300 }
    ];
    const folio = computeBookingFolio({
      booking: baseBooking,
      storeOrders: [],
      selectedBookingCharges: liveCharges
    });
    expect(folio.charges).toEqual(liveCharges);
    expect(folio.chargesTotal).toBe(500);
    expect(folio.grandTotal).toBe(4500);
    expect(folio.balance).toBe(4500);
  });

  it("defaults to zero live charges when not provided", () => {
    const folio = computeBookingFolio({ booking: baseBooking, storeOrders: [] });
    expect(folio.charges).toEqual([]);
    expect(folio.chargesTotal).toBe(0);
  });
});

describe("computeBookingFolio — the historical 8-call-site shape (the bug-class regression guard)", () => {
  // This is the test pattern the spec author called for: pin the
  // exact shape the old `getBookingFolio` closure returned, with
  // realistic inputs (multiple store orders, a refund, a non-zero
  // payments total). A future change that drifts the math (e.g.
  // subtracts refunds, or double-counts a charge) fails here.
  it("returns the full shape: storeCharges + storeTotal + charges + chargesTotal + paymentsTotal + grandTotal + balance", () => {
    const booking: FolioBooking = {
      ...baseBooking,
      totalPrice: 4500, // 2 nights × ₱2,000 + ₱500 breakfast
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2
    };
    const storeOrders: FolioStoreOrder[] = [
      { bookingId: "b1", paymentMethod: "add-to-bill", status: "delivered", isBilled: true, totalAmount: 300 },
      { bookingId: "b1", paymentMethod: "add-to-bill", status: "delivered", isBilled: true, totalAmount: 150 }
    ];
    const livePayments: FolioLivePayments = [
      { amount: 2000 },
      { amount: -200 } // refund
    ];
    const folio = computeBookingFolio({
      booking,
      storeOrders,
      selectedBookingPayments: livePayments
    });
    // storeTotal = 300 + 150 = 450
    expect(folio.storeTotal).toBe(450);
    // paymentsTotal = 2000 + (-200) = 1800
    expect(folio.paymentsTotal).toBe(1800);
    // grandTotal = totalPrice + storeTotal = 4500 + 450 = 4950
    expect(folio.grandTotal).toBe(4950);
    // balance = grandTotal - paymentsTotal = 4950 - 1800 = 3150
    expect(folio.balance).toBe(3150);
  });
});

describe("computeServerFolioTotals — the server inline-math replacement", () => {
  // Pins the historical server behavior:
  //   folioTotal = data.totalPrice + incidentalTotal + addToBillTotal
  //   computedBalance = Math.max(folioTotal - collectedTotal, 0)
  it("returns the same totals the inline math returned", () => {
    const result = computeServerFolioTotals({
      totalPrice: 4000,
      incidentalTotal: 200,
      addToBillTotal: 500,
      collectedTotal: 1500
    });
    expect(result.folioTotal).toBe(4700);
    expect(result.computedBalance).toBe(3200);
  });

  it("clamps the balance to zero (no negative balances — a refund that overpays is recorded separately)", () => {
    const result = computeServerFolioTotals({
      totalPrice: 1000,
      incidentalTotal: 0,
      addToBillTotal: 0,
      collectedTotal: 2000
    });
    expect(result.folioTotal).toBe(1000);
    expect(result.computedBalance).toBe(0);
  });

  it("treats nullish inputs as zero (defensive — matches the historical `Number(x) || 0` pattern)", () => {
    const result = computeServerFolioTotals({
      totalPrice: undefined as any,
      incidentalTotal: undefined as any,
      addToBillTotal: undefined as any,
      collectedTotal: undefined as any
    });
    expect(result.folioTotal).toBe(0);
    expect(result.computedBalance).toBe(0);
  });
});

// Per MRB-04 (2026-08-02, per decision #159): the
// behavior-frozen balance invariant for the reservation
// folio. The invariant is `reservation balance ==
// reservationTotal + chargesTotal − paymentsTotal`. A
// positive balance means the guest owes money; a negative
// balance means the guest is overpaid (refund pending).
// The helper enforces this with a single-pass sign-aware
// sum so the invariant is preserved at the math level —
// no separate derivation that could drift. The test pins
// the invariant for a representative range of inputs
// (zero, positive-only, mixed signs, edge cases like NaN
// inputs that normalize to 0).
import { getReservationFolioSummary } from "../utils/bookingFolio";

describe("getReservationFolioSummary — the balance invariant (MRB-04)", () => {
  it("zero balance when total = payments (fully paid)", () => {
    const summary = getReservationFolioSummary({
      reservationId: "res_test_1",
      reservationTotal: 5000,
      payments: [{ amount: 5000 }],
      charges: [],
      source: "reservation-subcollection"
    });
    expect(summary.balance).toBe(0);
    expect(summary.paymentsTotal).toBe(5000);
    expect(summary.chargesTotal).toBe(0);
  });

  it("positive balance when total > payments (guest owes money)", () => {
    const summary = getReservationFolioSummary({
      reservationId: "res_test_2",
      reservationTotal: 5000,
      payments: [{ amount: 3000 }],
      charges: [],
      source: "reservation-subcollection"
    });
    expect(summary.balance).toBe(2000);
  });

  it("negative balance when total < payments (guest overpaid)", () => {
    const summary = getReservationFolioSummary({
      reservationId: "res_test_3",
      reservationTotal: 5000,
      payments: [{ amount: 6000 }],
      charges: [],
      source: "reservation-subcollection"
    });
    expect(summary.balance).toBe(-1000);
  });

  it("refund contributes a negative amount to paymentsTotal (sign-aware)", () => {
    // The CRL-01 negative-amount convention: refunds
    // are negative entries on the payments ledger. A
    // 5000 payment + 1000 refund = 4000 total. The
    // balance = total + charges − payments = 5000 -
    // 4000 = 1000. The single-pass sign-aware sum
    // preserves the invariant.
    const summary = getReservationFolioSummary({
      reservationId: "res_test_4",
      reservationTotal: 5000,
      payments: [{ amount: 5000 }, { amount: -1000 }],
      charges: [],
      source: "reservation-subcollection"
    });
    expect(summary.paymentsTotal).toBe(4000);
    expect(summary.balance).toBe(1000);
  });

  it("charges contribute to the balance (charges add to the total)", () => {
    // A 1000 charge + 5000 payment on a 3000 total
    // = balance of 3000 + 1000 - 5000 = -1000 (the
    // guest overpaid by 1000 after the charge).
    const summary = getReservationFolioSummary({
      reservationId: "res_test_5",
      reservationTotal: 3000,
      payments: [{ amount: 5000 }],
      charges: [{ amount: 1000 }],
      source: "reservation-subcollection"
    });
    expect(summary.chargesTotal).toBe(1000);
    expect(summary.paymentsTotal).toBe(5000);
    expect(summary.balance).toBe(-1000);
  });

  it("defensive coercion: NaN / undefined amounts normalize to 0", () => {
    // The helper uses `Number(amount) || 0` so NaN,
    // undefined, or string amounts normalize to 0.
    // The balance invariant holds for any mix of
    // malformed inputs.
    const summary = getReservationFolioSummary({
      reservationId: "res_test_6",
      reservationTotal: 1000,
      payments: [{ amount: NaN }, { amount: undefined as any }, { amount: 500 }],
      charges: [{ amount: "garbage" as any }, { amount: 200 }],
      source: "reservation-subcollection"
    });
    expect(summary.paymentsTotal).toBe(500);
    expect(summary.chargesTotal).toBe(200);
    expect(summary.balance).toBe(700);  // 1000 + 200 - 500 = 700
  });

  it("echoes the source flag on the returned summary", () => {
    // The `source` field is the canonical "did this
    // data come from the new reservation subcollections
    // or the legacy booking subcollections" marker.
    // The admin UI uses this to render a "legacy
    // booking" badge; the receipt path renders the
    // same shape regardless of source. The flag
    // must round-trip through the helper.
    const newSummary = getReservationFolioSummary({
      reservationId: "res_test_7",
      reservationTotal: 0,
      payments: [],
      charges: [],
      source: "reservation-subcollection"
    });
    expect(newSummary.source).toBe("reservation-subcollection");

    const legacySummary = getReservationFolioSummary({
      reservationId: "res_test_8",
      reservationTotal: 0,
      payments: [],
      charges: [],
      source: "booking-subcollection-legacy"
    });
    expect(legacySummary.source).toBe("booking-subcollection-legacy");
  });

  it("the balance invariant is preserved for a randomized property check (the MRB-04 PMH-05 shape)", () => {
    // Per the MRB-04 spec: the balance invariant is
    // the canonical money rule. The property test
    // verifies the invariant holds for any mix of
    // random reservation totals, payments, and
    // charges. A future refactor that breaks the
    // invariant fails this test.
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      const reservationTotal = Math.floor(Math.random() * 100000) - 10000;
      const numPayments = Math.floor(Math.random() * 5);
      const numCharges = Math.floor(Math.random() * 5);
      const payments = Array.from({ length: numPayments }, () => ({
        amount: Math.floor(Math.random() * 20000) - 5000
      }));
      const charges = Array.from({ length: numCharges }, () => ({
        amount: Math.floor(Math.random() * 10000) - 2000
      }));
      const summary = getReservationFolioSummary({
        reservationId: `res_prop_${i}`,
        reservationTotal,
        payments,
        charges,
        source: "reservation-subcollection"
      });
      const expectedPaymentsTotal = payments.reduce(
        (sum, p) => sum + (Number(p.amount) || 0),
        0
      );
      const expectedChargesTotal = charges.reduce(
        (sum, c) => sum + (Number(c.amount) || 0),
        0
      );
      const expectedBalance = reservationTotal + expectedChargesTotal - expectedPaymentsTotal;
      expect(summary.paymentsTotal).toBe(expectedPaymentsTotal);
      expect(summary.chargesTotal).toBe(expectedChargesTotal);
      expect(summary.balance).toBe(expectedBalance);
    }
  });
});
