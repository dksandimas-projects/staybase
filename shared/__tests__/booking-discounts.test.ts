import { describe, expect, it } from "vitest";
import { calculatePercentDiscount, calculateVoucherBase } from "../utils/bookingDiscounts";

describe("calculatePercentDiscount (DSC extraction, 2026-07-31)", () => {
  describe("happy path — `base × (pct/100)`", () => {
    it("returns the raw product for a positive base and pct", () => {
      expect(calculatePercentDiscount(1000, 20)).toBe(200);
      expect(calculatePercentDiscount(500, 10)).toBe(50);
      expect(calculatePercentDiscount(2000, 5)).toBe(100);
    });

    it("matches the historical inline expression byte-equivalently", () => {
      // The pre-refactor inline pattern was `subtotal * (pct/100)` (no
      // rounding, no clamp). The helper must return the same value.
      const cases: Array<[number, number]> = [
        [1000, 20],
        [1000, 10],
        [999, 12.5],
        [200, 50],
        [50, 0],
        [0, 100],
      ];
      for (const [base, pct] of cases) {
        expect(calculatePercentDiscount(base, pct)).toBe(base * (pct / 100));
      }
    });

    it("preserves fractional results without rounding (caller decides)", () => {
      // 999 × 12.5% = 124.875 — the historical inline also returned 124.875.
      // pricing.ts uses the raw value; server + reports wrap with Math.round.
      expect(calculatePercentDiscount(999, 12.5)).toBe(124.875);
      expect(calculatePercentDiscount(1001, 33.33)).toBeCloseTo(333.6333, 4);
    });
  });

  describe("defensive coercion — nullish / NaN / 0 inputs", () => {
    it("treats nullish base as 0", () => {
      expect(calculatePercentDiscount(null as any, 20)).toBe(0);
      expect(calculatePercentDiscount(undefined as any, 20)).toBe(0);
    });

    it("treats nullish pct as 0", () => {
      expect(calculatePercentDiscount(1000, null)).toBe(0);
      expect(calculatePercentDiscount(1000, undefined)).toBe(0);
    });

    it("treats both nullish as 0", () => {
      expect(calculatePercentDiscount(null as any, null)).toBe(0);
      expect(calculatePercentDiscount(undefined as any, undefined)).toBe(0);
    });

    it("treats 0 base or 0 pct as 0", () => {
      expect(calculatePercentDiscount(0, 20)).toBe(0);
      expect(calculatePercentDiscount(1000, 0)).toBe(0);
    });

    it("treats NaN inputs as 0", () => {
      expect(calculatePercentDiscount(NaN, 20)).toBe(0);
      expect(calculatePercentDiscount(1000, NaN)).toBe(0);
    });
  });

  describe("negative inputs — preserved for caller-side handling", () => {
    it("returns a negative product when pct is negative (caller clamps)", () => {
      // The historical pattern returned a negative product too — the
      // caller's `Math.round` + `Math.max(..., 0)` handled the clamp.
      // The helper preserves the raw value so the caller's clamp logic
      // stays in one place per surface.
      expect(calculatePercentDiscount(1000, -5)).toBe(-50);
    });

    it("returns a negative product when base is negative", () => {
      // Defensive coercion treats negative base as a finite number —
      // Number(-50) || 0 = -50 (truthy, so passes through).
      // The historical inline pattern had the same behavior.
      expect(calculatePercentDiscount(-100, 20)).toBe(-20);
    });
  });
});

describe("calculateVoucherBase (DSC extraction, 2026-07-31)", () => {
  describe("happy path — `Math.max(subtotal − deduction, 0)`", () => {
    it("returns the unclamped subtraction when result is positive", () => {
      expect(calculateVoucherBase(1000, 200)).toBe(800);
      expect(calculateVoucherBase(500, 50)).toBe(450);
      expect(calculateVoucherBase(100, 0)).toBe(100);
    });

    it("clamps the result to 0 when deduction exceeds subtotal", () => {
      expect(calculateVoucherBase(100, 200)).toBe(0);
      expect(calculateVoucherBase(100, 100)).toBe(0);
    });

    it("matches the historical inline expression byte-equivalently", () => {
      // The pre-refactor inline pattern was `Math.max(subtotal - x, 0)`.
      // The helper must return the same value.
      const cases: Array<[number, number]> = [
        [1000, 200],
        [500, 50],
        [100, 0],
        [0, 0],
        [100, 100],
        [100, 200],
      ];
      for (const [subtotal, deduction] of cases) {
        expect(calculateVoucherBase(subtotal, deduction)).toBe(Math.max(subtotal - deduction, 0));
      }
    });
  });

  describe("defensive coercion — nullish / NaN / 0 inputs", () => {
    it("treats nullish subtotal as 0", () => {
      expect(calculateVoucherBase(null as any, 200)).toBe(0);
      expect(calculateVoucherBase(undefined as any, 200)).toBe(0);
    });

    it("treats nullish deduction as 0", () => {
      expect(calculateVoucherBase(1000, null)).toBe(1000);
      expect(calculateVoucherBase(1000, undefined)).toBe(1000);
    });

    it("treats both nullish as 0", () => {
      expect(calculateVoucherBase(null as any, null)).toBe(0);
      expect(calculateVoucherBase(undefined as any, undefined)).toBe(0);
    });

    it("treats NaN inputs as 0", () => {
      expect(calculateVoucherBase(NaN, 200)).toBe(0);
      expect(calculateVoucherBase(1000, NaN)).toBe(1000);
    });
  });

  describe("realistic chain scenarios — verifying byte-equivalence with the historical sites", () => {
    it("matches the booking.ts handleCreateBooking voucher base exactly", () => {
      // Per server/handlers/bookings.ts:1030-1031:
      //   const seniorPwdDiscountForVoucher = Math.round(subtotal * (discountPct / 100));
      //   const voucherBase = Math.max(subtotal - seniorPwdDiscountForVoucher, 0);
      // Equivalent refactor:
      //   const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
      //   const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscount);
      const subtotal = 1000;
      const discountPct = 20;
      const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
      const voucherBase = calculateVoucherBase(subtotal, seniorPwdDiscount);
      expect(seniorPwdDiscount).toBe(200);
      expect(voucherBase).toBe(800);
    });

    it("matches the ReportsPage afterVoucher clamp exactly", () => {
      // Per ReportsPage.tsx:730:
      //   const afterVoucher = Math.max(afterSenior - vchDiscount, 0);
      // Equivalent refactor:
      //   const afterVoucher = calculateVoucherBase(afterSenior, vchDiscount);
      const afterSenior = 800;
      const vchDiscount = 100;
      expect(calculateVoucherBase(afterSenior, vchDiscount)).toBe(700);
      expect(calculateVoucherBase(afterSenior, 1000)).toBe(0); // clamps to 0
    });

    it("matches the BookingsPage receipt-PDF member base exactly", () => {
      // Per BookingsPage.tsx:2041:
      //   const memberBase = Math.max(discountBase - seniorPwdAmount - (b.voucherDiscount || 0), 0);
      // Equivalent refactor:
      //   const afterSenior = calculateVoucherBase(discountBase, seniorPwdAmount);
      //   const memberBase = calculateVoucherBase(afterSenior, b.voucherDiscount || 0);
      const discountBase = 1000;
      const seniorPwdAmount = 200;
      const voucherDiscount = 100;
      const afterSenior = calculateVoucherBase(discountBase, seniorPwdAmount);
      const memberBase = calculateVoucherBase(afterSenior, voucherDiscount);
      expect(afterSenior).toBe(800);
      expect(memberBase).toBe(700);
    });
  });
});
