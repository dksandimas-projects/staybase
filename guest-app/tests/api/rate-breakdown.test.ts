import { describe, expect, test } from "vitest";
import { assertBookingFinanceInvariant } from "@spark-inn/shared";
import { rebuildEarlyCheckoutRateBreakdown, rebuildRateBreakdown } from "../../server/lib/rate-breakdown";

const lockedBreakdown = {
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
  deductions: [],
  finalTotal: 4_050
};

describe("rebuildRateBreakdown", () => {
  test("rebuilds every deduction in canonical order when points are redeemed", () => {
    const rebuilt = rebuildRateBreakdown({
      rateBreakdown: lockedBreakdown,
      discountType: "senior",
      discountPct: 20,
      voucherDiscount: 300,
      memberDiscountPct: 10,
      pointsRedeemedValue: 0,
      totalPrice: 4_050
    }, {
      pointsRedeemedValue: 500,
      finalTotal: 3_550
    });

    expect(rebuilt).toEqual({
      ...lockedBreakdown,
      deductions: [
        { label: "Senior Citizen discount (20%)", amount: 1_200 },
        { label: "Voucher discount", amount: 300 },
        { label: "Spark Rewards member discount (10%)", amount: 450 },
        { label: "Spark Rewards points redeemed", amount: 500 }
      ],
      finalTotal: 3_550
    });
    assertBookingFinanceInvariant({ totalPrice: 3_550, rateBreakdown: rebuilt });
  });

  test("removes only the points line when redemption is undone", () => {
    const rebuilt = rebuildRateBreakdown({
      rateBreakdown: {
        ...lockedBreakdown,
        deductions: [{ label: "Spark Rewards points redeemed", amount: 500 }],
        finalTotal: 3_550
      },
      discountType: "senior",
      discountPct: 20,
      voucherDiscount: 300,
      memberDiscountPct: 10,
      pointsRedeemedValue: 500,
      totalPrice: 3_550
    }, {
      pointsRedeemedValue: 0,
      finalTotal: 4_050
    });

    expect(rebuilt?.deductions).toEqual([
      { label: "Senior Citizen discount (20%)", amount: 1_200 },
      { label: "Voucher discount", amount: 300 },
      { label: "Spark Rewards member discount (10%)", amount: 450 }
    ]);
    expect(rebuilt?.finalTotal).toBe(4_050);
    assertBookingFinanceInvariant({ totalPrice: 4_050, rateBreakdown: rebuilt });
  });

  test("leaves legacy bookings on their documented fallback path", () => {
    expect(rebuildRateBreakdown({ totalPrice: 2_000 }, {
      pointsRedeemedValue: 500,
      finalTotal: 1_500
    })).toBeUndefined();
  });
});

describe("rebuildEarlyCheckoutRateBreakdown", () => {
  test("shortens the stay while explaining the retained contracted total", () => {
    const rebuilt = rebuildEarlyCheckoutRateBreakdown({
      rateBreakdown: lockedBreakdown,
      numNights: 2,
      totalPrice: 4_050,
      discountType: "senior",
      discountPct: 20,
      voucherDiscount: 300,
      memberDiscountPct: 10,
      pointsRedeemedValue: 0
    }, 1);

    expect(rebuilt.roomLines).toEqual([expect.objectContaining({
      startDate: "2026-07-20",
      endDate: "2026-07-21",
      nights: 1,
      subtotal: 2_500
    })]);
    expect(rebuilt.addOns).toContainEqual({ label: "Breakfast add-on", amount: 500 });
    expect(rebuilt.addOns).toContainEqual(expect.objectContaining({
      label: "Early departure — original total retained",
      amount: expect.any(Number)
    }));
    const visibleTotal = rebuilt.roomSubtotal
      + rebuilt.addOns.reduce((sum, line) => sum + line.amount, 0)
      - rebuilt.deductions.reduce((sum, line) => sum + line.amount, 0);
    expect(visibleTotal).toBe(rebuilt.finalTotal);
    expect(rebuilt.finalTotal).toBe(4_050);
    assertBookingFinanceInvariant({ totalPrice: 4_050, rateBreakdown: rebuilt });
  });

  test("creates a transparent breakdown for legacy bookings", () => {
    const rebuilt = rebuildEarlyCheckoutRateBreakdown({
      checkIn: "2026-07-20",
      numNights: 3,
      ratePerNight: 2_000,
      totalPrice: 6_000
    }, 1);

    expect(rebuilt.roomLines[0]).toMatchObject({ nights: 1, subtotal: 2_000 });
    expect(rebuilt.addOns).toContainEqual({
      label: "Early departure — original total retained",
      amount: 4_000
    });
    expect(rebuilt.finalTotal).toBe(6_000);
    assertBookingFinanceInvariant({ totalPrice: 6_000, rateBreakdown: rebuilt });
  });
});
