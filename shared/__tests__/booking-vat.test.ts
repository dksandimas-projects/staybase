import { describe, expect, it } from "vitest";
import { calculateVatBreakdown } from "../utils/bookingVat";

describe("calculateVatBreakdown (DSC-06, 2026-08-01, per CVQ-06/#115)", () => {
  describe("happy path — non-senior booking (full bill is VATable)", () => {
    it("returns the 12% breakdown for a 1000-peso non-senior booking", () => {
      // totalPrice = 1000; seniorDiscount = 0; vatRate = 0.12.
      // vatExclusiveSales = 1000 / 1.12 ≈ 892.8571
      // vatExemptSales = 0
      // vatAmount = 892.8571 × 0.12 ≈ 107.1429
      const b = calculateVatBreakdown({ totalPrice: 1000 });
      expect(b.vatRate).toBe(0.12);
      expect(b.vatExclusiveSales).toBeCloseTo(892.8571, 4);
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatAmount).toBeCloseTo(107.1429, 4);
      // Reconciliation: vatExclusiveSales + vatAmount = totalPrice
      expect(b.vatExclusiveSales + b.vatAmount).toBeCloseTo(1000, 4);
    });

    it("reconciles for a 2000-peso non-senior booking (the typical 2-night room)", () => {
      // 2000 / 1.12 ≈ 1785.7143; VAT = 214.2857
      const b = calculateVatBreakdown({ totalPrice: 2000 });
      expect(b.vatExclusiveSales).toBeCloseTo(1785.7143, 4);
      expect(b.vatAmount).toBeCloseTo(214.2857, 4);
      expect(b.vatExclusiveSales + b.vatAmount).toBeCloseTo(2000, 4);
    });
  });

  describe("happy path — senior/PWD booking (the exempt portion is RA 9994)", () => {
    it("returns the breakdown for a 2000-peso bill with 400 senior discount", () => {
      // totalPrice = 2000; seniorDiscount = 400 (the 20% off the VATable base);
      // vatRate = 0.12.
      // vatExclusiveSales = 2000 / 1.12 ≈ 1785.7143
      // vatExemptSales = 400 (the senior discount, exempt under RA 9994)
      // vatAmount = 1785.7143 × 0.12 ≈ 214.2857
      const b = calculateVatBreakdown({
        totalPrice: 2000,
        seniorDiscountAmount: 400
      });
      expect(b.vatExclusiveSales).toBeCloseTo(1785.7143, 4);
      expect(b.vatExemptSales).toBe(400);
      expect(b.vatAmount).toBeCloseTo(214.2857, 4);
    });

    it("reports the senior discount as VAT-exempt without reducing the VAT base", () => {
      // The senior discount is reported separately as a VAT-exempt
      // sale; the VAT is still computed on the net bill (the bill
      // the guest paid, divided by 1.12). This is the BIR's
      // standard interpretation under RA 9994: the 20% discount
      // removes the VAT component on the exempt portion entirely,
      // but the remaining bill is still subject to VAT.
      const b = calculateVatBreakdown({
        totalPrice: 800,
        seniorDiscountAmount: 200
      });
      expect(b.vatExclusiveSales).toBeCloseTo(800 / 1.12, 4);
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatAmount).toBeCloseTo((800 / 1.12) * 0.12, 4);
    });

    it("scopes correctly with DSC-01..05 narrow scope: only the senior's portion counts as VAT-exempt", () => {
      // The helper takes `seniorDiscountAmount` as input — the
      // caller (the reports surface) computes the senior discount
      // from the booking's discount scope + chain. A narrow
      // scope that excludes breakfast + extra bed from the senior
      // percentage produces a smaller senior discount, and the
      // helper reports exactly that amount as VAT-exempt. The
      // helper itself is scope-agnostic — it just reports whatever
      // the caller passes in.
      const narrowSeniorDiscount = 160; // 20% of 800 (room only)
      const b = calculateVatBreakdown({
        totalPrice: 800,
        seniorDiscountAmount: narrowSeniorDiscount
      });
      expect(b.vatExemptSales).toBe(160);
    });
  });

  describe("defensive coercion — nullish / NaN / 0 inputs", () => {
    it("treats nullish totalPrice as 0", () => {
      const b = calculateVatBreakdown({ totalPrice: null as any });
      expect(b.vatExclusiveSales).toBe(0);
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatAmount).toBe(0);
    });

    it("treats nullish seniorDiscountAmount as 0", () => {
      const b = calculateVatBreakdown({
        totalPrice: 1000,
        seniorDiscountAmount: null
      });
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatAmount).toBeCloseTo(1000 / 1.12 * 0.12, 4);
    });

    it("treats nullish vatRate as the 0.12 default", () => {
      const b = calculateVatBreakdown({
        totalPrice: 1000,
        vatRate: null
      });
      expect(b.vatRate).toBe(0.12);
    });

    it("treats NaN totalPrice as 0", () => {
      const b = calculateVatBreakdown({ totalPrice: NaN });
      expect(b.vatExclusiveSales).toBe(0);
      expect(b.vatAmount).toBe(0);
    });

    it("treats negative totalPrice as 0 (the historical `Math.max(x, 0)` clamp)", () => {
      const b = calculateVatBreakdown({ totalPrice: -500 });
      expect(b.vatExclusiveSales).toBe(0);
      expect(b.vatAmount).toBe(0);
    });

    it("treats negative seniorDiscountAmount as 0 (clamped)", () => {
      const b = calculateVatBreakdown({
        totalPrice: 1000,
        seniorDiscountAmount: -100
      });
      expect(b.vatExemptSales).toBe(0);
    });
  });

  describe("alternative vatRate — for testing + non-PH deployments", () => {
    it("supports a custom vatRate (e.g. 0.10 for testing)", () => {
      const b = calculateVatBreakdown({
        totalPrice: 1000,
        vatRate: 0.10
      });
      expect(b.vatRate).toBe(0.10);
      expect(b.vatExclusiveSales).toBeCloseTo(1000 / 1.10, 4);
      expect(b.vatAmount).toBeCloseTo(1000 / 1.10 * 0.10, 4);
    });

    it("supports a 0% vatRate (zero-rated or exempt industry)", () => {
      // For a zero-rated industry, totalPrice == vatExclusiveSales and vatAmount is 0.
      const b = calculateVatBreakdown({ totalPrice: 1000, vatRate: 0 });
      expect(b.vatRate).toBe(0);
      expect(b.vatExclusiveSales).toBe(1000);
      expect(b.vatAmount).toBe(0);
    });
  });

  describe("realistic per-booking scenarios — the chain math stays consistent", () => {
    it("senior-only booking: subtotal 1000, 20% senior, no voucher/member/points", () => {
      // 1000 - 200 (senior 20%) = 800 (the bill, VAT-inclusive).
      // The senior discount is 200 (the VAT-exempt portion).
      const b = calculateVatBreakdown({
        totalPrice: 800,
        seniorDiscountAmount: 200
      });
      expect(b.vatExclusiveSales).toBeCloseTo(800 / 1.12, 4);
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatAmount).toBeCloseTo(800 / 1.12 * 0.12, 4);
    });

    it("non-senior booking with voucher: subtotal 1000, 0% senior, 100 voucher", () => {
      // 1000 - 100 (voucher) = 900 (the bill, VAT-inclusive).
      // No senior discount, so no VAT-exempt portion.
      const b = calculateVatBreakdown({
        totalPrice: 900,
        seniorDiscountAmount: 0
      });
      expect(b.vatExclusiveSales).toBeCloseTo(900 / 1.12, 4);
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatAmount).toBeCloseTo(900 / 1.12 * 0.12, 4);
    });

    it("senior + voucher booking: subtotal 1000, 20% senior (200), 100 voucher", () => {
      // 1000 - 200 - 100 = 700 (the bill, VAT-inclusive).
      // The senior discount is 200 (the VAT-exempt portion);
      // the voucher is on top of that but is NOT VAT-exempt
      // (vouchers are hotel-issued, not RA 9994).
      const b = calculateVatBreakdown({
        totalPrice: 700,
        seniorDiscountAmount: 200
      });
      expect(b.vatExclusiveSales).toBeCloseTo(700 / 1.12, 4);
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatAmount).toBeCloseTo(700 / 1.12 * 0.12, 4);
    });

    it("reconciles end-to-end: vatExclusiveSales + vatAmount = totalPrice (rounding-safe)", () => {
      // For any totalPrice, the two pieces (VATable + VAT) must
      // sum back to the original total. This is the BIR's
      // reconciliation rule.
      for (const total of [100, 500, 1000, 1234.56, 9999.99]) {
        const b = calculateVatBreakdown({ totalPrice: total });
        expect(b.vatExclusiveSales + b.vatAmount).toBeCloseTo(total, 4);
      }
    });
  });
});

import { getBookingVatBreakdown } from "../utils/bookingVat";

describe("getBookingVatBreakdown (DSC-07, 2026-08-01, per CVQ-06/#115)", () => {
  describe("happy path — non-senior booking", () => {
    it("returns the broad-scope VAT breakdown for a 1000-peso booking", () => {
      // 1000 / 1.12 ≈ 892.8571; VAT = 107.1429; no senior discount.
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1000
      });
      expect(b.vatRate).toBe(0.12);
      expect(b.vatExclusiveSales).toBeCloseTo(892.8571, 4);
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatAmount).toBeCloseTo(107.1429, 4);
    });
  });

  describe("happy path — senior/PWD booking (RA 9994 exemption)", () => {
    it("returns the VAT breakdown with the senior discount as VAT-exempt", () => {
      // totalPrice = 800 (post-senior), originalTotalPrice = 1000
      // (pre-senior), discountPct = 20 → senior = 200.
      // VATable = 800/1.12, VAT-Exempt = 200, VAT = VATable × 0.12.
      const b = getBookingVatBreakdown({
        totalPrice: 800,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: 20
      });
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatExclusiveSales).toBeCloseTo(800 / 1.12, 4);
      expect(b.vatAmount).toBeCloseTo(800 / 1.12 * 0.12, 4);
    });

    it("returns the same breakdown for PWD as for senior (both RA 9994)", () => {
      const senior = getBookingVatBreakdown({
        totalPrice: 800,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: 20
      });
      const pwd = getBookingVatBreakdown({
        totalPrice: 800,
        originalTotalPrice: 1000,
        discountType: "pwd",
        discountPct: 20
      });
      expect(pwd).toEqual(senior);
    });
  });

  describe("rejected senior/PWD — no VAT-exempt", () => {
    it("treats a rejected senior discount as zero (the staff rejected the ID)", () => {
      // Per LR-L2: when staff rejects the senior ID, the senior
      // discount is removed but the rest of the chain (voucher +
      // member) is re-applied. The VAT breakdown for the resulting
      // bill has zero VAT-exempt sales.
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1200,
        discountType: "senior",
        discountPct: 20,
        discountRejected: true
      });
      expect(b.vatExemptSales).toBe(0);
      expect(b.vatExclusiveSales).toBeCloseTo(1000 / 1.12, 4);
    });
  });

  describe("defensive coercion — nullish / NaN / 0 inputs", () => {
    it("treats nullish totalPrice as 0", () => {
      const b = getBookingVatBreakdown({ totalPrice: null as any });
      expect(b.vatExclusiveSales).toBe(0);
      expect(b.vatAmount).toBe(0);
    });

    it("treats nullish originalTotalPrice as 0 (no senior discount)", () => {
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: null,
        discountType: "senior",
        discountPct: 20
      });
      // originalTotalPrice = 0 → senior discount = 0 (clamped)
      expect(b.vatExemptSales).toBe(0);
    });

    it("treats nullish discountPct as 0 (no senior discount)", () => {
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: null
      });
      expect(b.vatExemptSales).toBe(0);
    });

    it("treats 0 discountPct as no senior discount", () => {
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: 0
      });
      expect(b.vatExemptSales).toBe(0);
    });

    it("ignores discountType other than senior/pwd (e.g. corporate)", () => {
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1000,
        discountType: "corporate",
        discountPct: 20
      });
      expect(b.vatExemptSales).toBe(0);
    });

    it("treats NaN totalPrice as 0", () => {
      const b = getBookingVatBreakdown({ totalPrice: NaN });
      expect(b.vatExclusiveSales).toBe(0);
      expect(b.vatAmount).toBe(0);
    });
  });

  describe("alternative vatRate override", () => {
    it("supports a custom vatRate (e.g. 0% for testing or zero-rated)", () => {
      const b = getBookingVatBreakdown({
        totalPrice: 1000,
        originalTotalPrice: 1000,
        vatRate: 0
      });
      expect(b.vatRate).toBe(0);
      expect(b.vatExclusiveSales).toBe(1000);
      expect(b.vatAmount).toBe(0);
    });
  });

  describe("byte-equivalence with the chain math for broad scope", () => {
    it("matches the broad-scope senior deduction for a senior-only booking", () => {
      // For a senior-only booking with broad scope:
      //   seniorDiscount = originalTotalPrice * 20% = 1000 * 0.20 = 200
      //   totalPrice = 1000 - 200 = 800
      //   VATable = 800 / 1.12 ≈ 714.2857
      //   VAT-Exempt = 200
      //   VAT = 714.2857 * 0.12 ≈ 85.7143
      const b = getBookingVatBreakdown({
        totalPrice: 800,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: 20
      });
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatExclusiveSales).toBeCloseTo(714.2857, 4);
      expect(b.vatAmount).toBeCloseTo(85.7143, 4);
    });

    it("matches the broad-scope senior deduction for a senior + voucher booking", () => {
      // 1000 - 200 (senior) - 100 (voucher) = 700
      // senior = 200 (broad-scope approximation)
      const b = getBookingVatBreakdown({
        totalPrice: 700,
        originalTotalPrice: 1000,
        discountType: "senior",
        discountPct: 20
      });
      expect(b.vatExemptSales).toBe(200);
      expect(b.vatExclusiveSales).toBeCloseTo(700 / 1.12, 4);
      expect(b.vatAmount).toBeCloseTo(700 / 1.12 * 0.12, 4);
    });
  });
});
