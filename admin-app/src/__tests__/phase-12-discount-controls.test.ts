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
    // Per fix/walkin-split-name (2026-07-25): the parameter
    // name in addWalkinBooking was renamed `booking` → `input`
    // to reflect that it's an input (not a stored Booking)
    // and because the function no longer reads a `guestName`
    // field. The field-flow contract is unchanged.
    expect(context).toMatch(/discountType: input\.discountType/);
    expect(context).toMatch(/voucherCode: input\.voucherCode/);
  });

  it("persists the online setting from Rate Management", () => {
    expect(rates).toMatch(/seniorPwdOnlineEnabled/);
    expect(rates).toMatch(/updateSettings\("hotelConfig", \{ seniorPwdOnlineEnabled: next/);
    expect(rates).toMatch(/Staff grants remain available/);
  });
});
