import { describe, expect, test } from "vitest";
import { validateVoucher, calculateVoucherDiscount, applyVoucherDiscount, VoucherLike } from "../utils/vouchers";

describe("voucher utilities", () => {
  const activeVoucher: VoucherLike = {
    discountType: "percent",
    discountValue: 10,
    usageCap: 10,
    usageCount: 2,
    expiresAt: new Date("2026-12-31T23:59:59Z"),
    applicableRoomTypes: [],
    isActive: true
  };

  test("validates active and valid voucher", () => {
    const res = validateVoucher(activeVoucher, "standard-double", new Date("2026-06-08T12:00:00Z"));
    expect(res.valid).toBe(true);
    expect(res.error).toBe("");
  });

  test("rejects inactive voucher", () => {
    const res = validateVoucher({ ...activeVoucher, isActive: false }, "standard-double");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Voucher is inactive.");
  });

  test("rejects expired voucher", () => {
    const res = validateVoucher(activeVoucher, "standard-double", new Date("2027-01-01T00:00:00Z"));
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Voucher has expired.");
  });

  test("rejects over-capacity voucher", () => {
    const res = validateVoucher({ ...activeVoucher, usageCount: 10 }, "standard-double");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Voucher usage limit reached.");
  });

  test("rejects room type mismatch", () => {
    const res = validateVoucher({ ...activeVoucher, applicableRoomTypes: ["executive"] }, "standard-double");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Voucher does not apply to this room type.");
  });

  test("calculates voucher discount correctly", () => {
    // Percent discount: 10% of 5000 = 50
    expect(calculateVoucherDiscount(activeVoucher, 5000)).toBe(500);

    // Flat discount: 500 of 5000 = 500
    const flatVoucher = { discountType: "flat" as const, discountValue: 500 };
    expect(calculateVoucherDiscount(flatVoucher, 5000)).toBe(500);

    // Discount larger than subtotal is capped at subtotal
    const largeFlatVoucher = { discountType: "flat" as const, discountValue: 10000 };
    expect(calculateVoucherDiscount(largeFlatVoucher, 5000)).toBe(5000);
  });

  test("applies voucher discount correctly", () => {
    expect(applyVoucherDiscount(activeVoucher, 5000)).toBe(4500);
  });
});
