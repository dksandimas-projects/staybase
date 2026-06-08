import { describe, expect, test } from "vitest";
import { calculateBookingTotal } from "../utils/pricing";

describe("pricing utilities", () => {
  test("calculates room total only when no options are selected", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 3
    });
    expect(total).toBe(6000);
  });

  test("applies breakfast correctly if enabled and selected", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 250,
      hasBreakfast: true
    });
    // roomTotal = 2000 * 2 = 4000
    // breakfastTotal = 250 * 2 guests * 2 nights = 1000
    // subtotal = 5000
    expect(total).toBe(5000);
  });

  test("ignores breakfast if not selected or rate is missing", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 2,
      numGuests: 2,
      hasBreakfast: false
    });
    expect(total).toBe(4000);
  });

  test("applies percentage discount correctly (e.g. OSCA Senior/PWD)", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 3,
      discountPct: 20 // 20% discount
    });
    // subtotal = 6000
    // discount = 1200
    // total = 4800
    expect(total).toBe(4800);
  });

  test("applies voucher discount correctly", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 2,
      voucherDiscount: 500
    });
    // subtotal = 4000
    // total = 3500
    expect(total).toBe(3500);
  });

  test("applies both percentage and voucher discounts correctly", () => {
    const total = calculateBookingTotal({
      ratePerNight: 2000,
      numNights: 2,
      discountPct: 20, // 20% discount on subtotal (4000) = 800
      voucherDiscount: 500 // plus 500 voucher discount = 1300
    });
    // subtotal = 4000
    // total = 4000 - 1300 = 2700
    expect(total).toBe(2700);
  });

  test("ensures total price never drops below 0", () => {
    const total = calculateBookingTotal({
      ratePerNight: 1000,
      numNights: 1,
      voucherDiscount: 2000
    });
    expect(total).toBe(0);
  });
});
