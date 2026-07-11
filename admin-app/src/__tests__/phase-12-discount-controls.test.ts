import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const rates = readFileSync(resolve(__dirname, "../pages/RatesPage.tsx"), "utf8");
const context = readFileSync(resolve(__dirname, "../context/AdminContext.tsx"), "utf8");

describe("Phase 12 discount controls", () => {
  it("offers staff repricing in the booking drawer", () => {
    expect(bookings).toMatch(/Apply discount \/ voucher/);
    expect(bookings).toMatch(/\/api\/bookings\/apply-discount/);
    expect(bookings).toMatch(/New total:/);
  });

  it("sends walk-in discounts and vouchers to the server", () => {
    expect(bookings).toMatch(/discountType: walkinDiscountType/);
    expect(bookings).toMatch(/voucherCode: walkinVoucherCode\.trim\(\)\.toUpperCase\(\)/);
    expect(context).toMatch(/discountType: booking\.discountType/);
    expect(context).toMatch(/voucherCode: booking\.voucherCode/);
  });

  it("persists the online setting from Rate Management", () => {
    expect(rates).toMatch(/seniorPwdOnlineEnabled/);
    expect(rates).toMatch(/updateSettings\("hotelConfig", \{ seniorPwdOnlineEnabled: next/);
    expect(rates).toMatch(/Staff grants remain available/);
  });
});
