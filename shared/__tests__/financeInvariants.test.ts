import { describe, expect, test } from "vitest";
import { assertBookingFinanceInvariant, assertRevenueFinanceInvariant } from "../utils/financeInvariants";

const validBooking = () => ({
  totalPrice: 4_050,
  rateBreakdown: {
    roomSubtotal: 5_000,
    roomLines: [{
      source: "regular" as const,
      label: "Regular rate",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      nights: 2,
      nightlyRate: 2_500,
      subtotal: 5_000
    }],
    addOns: [{ label: "Breakfast add-on", amount: 1_000 }],
    deductions: [{ label: "Discounts", amount: 1_950 }],
    finalTotal: 4_050
  }
});

describe("assertBookingFinanceInvariant", () => {
  test("accepts a fully reconciled booking", () => {
    expect(() => assertBookingFinanceInvariant(validBooking())).not.toThrow();
  });

  test.each([
    ["non-finite money", (booking: any) => { booking.totalPrice = Number.NaN; }, /finite number/],
    ["room-line drift", (booking: any) => { booking.rateBreakdown.roomLines[0].subtotal = 4_999; }, /room line total/],
    ["breakdown drift", (booking: any) => { booking.rateBreakdown.deductions[0].amount = 1_900; }, /finalTotal/],
    ["booking drift", (booking: any) => { booking.totalPrice = 4_000; }, /booking\.totalPrice/]
  ])("rejects %s", (_label, mutate, message) => {
    const booking = validBooking();
    mutate(booking);
    expect(() => assertBookingFinanceInvariant(booking)).toThrow(message);
  });
});

describe("assertRevenueFinanceInvariant", () => {
  const validReport = () => ({
    roomRevenue: 10_000,
    breakfastRevenue: 1_000,
    storeRevenue: 1_500,
    incidentalRevenue: 500,
    totalRevenue: 13_000,
    streamEntryIds: {
      revenue: ["booking:b1", "store:s1"],
      tenders: ["booking:b1/payment:p1", "store:s1/payment:delivery-tender"],
      receivables: ["booking:b2/receivable"]
    }
  });

  test("accepts reconciled revenue with disjoint ledger streams", () => {
    expect(() => assertRevenueFinanceInvariant(validReport())).not.toThrow();
  });

  test("rejects a Total Revenue mismatch", () => {
    const report = validReport();
    report.totalRevenue = 12_500;
    expect(() => assertRevenueFinanceInvariant(report)).toThrow(/totalRevenue/);
  });

  test("rejects a ledger entry counted in two streams", () => {
    const report = validReport();
    report.streamEntryIds.receivables.push("booking:b1/payment:p1");
    expect(() => assertRevenueFinanceInvariant(report)).toThrow(/appears in both tenders and receivables/);
  });
});
