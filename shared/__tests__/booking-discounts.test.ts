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

// Per DSC-01..05 (2026-08-01, per CVQ-06): the scope-aware discount
// chain. Decomposes a booking's pre-discount subtotal by component
// (room, breakfast, extra bed), then applies the senior → voucher →
// member chain with each class's scope respected. For the broad
// default scope (all true), the output is byte-equivalent to the
// pre-DSC-01 chain `subtotal → seniorPwdDiscount →
// afterSeniorPwd → afterVoucher → memberDiscount → total`.
import { calculateDiscountChain, normalizeDiscountScope, BROAD_DISCOUNT_SCOPE } from "../utils/bookingDiscounts";

describe("normalizeDiscountScope (DSC-01..05, 2026-08-01, per CVQ-06)", () => {
  it("returns the broad default when the input is undefined", () => {
    expect(normalizeDiscountScope(undefined)).toEqual(BROAD_DISCOUNT_SCOPE);
    expect(normalizeDiscountScope(null)).toEqual(BROAD_DISCOUNT_SCOPE);
  });

  it("fills in missing class entries with all-true defaults", () => {
    expect(normalizeDiscountScope({} as any)).toEqual(BROAD_DISCOUNT_SCOPE);
    expect(normalizeDiscountScope({ senior: undefined as any })).toEqual(BROAD_DISCOUNT_SCOPE);
  });

  it("fills in missing class components with all-true defaults (narrowing is opt-in)", () => {
    const partial = normalizeDiscountScope({
      senior: { room: true, breakfast: false } as any,
      voucher: { room: false } as any,
      member: { extraBed: false } as any
    });
    expect(partial).toEqual({
      senior: { room: true, breakfast: false, extraBed: true },
      voucher: { room: false, breakfast: true, extraBed: true },
      member: { room: true, breakfast: true, extraBed: false }
    });
  });

  it("preserves a fully-specified scope byte-for-byte", () => {
    const explicit = {
      senior: { room: true, breakfast: true, extraBed: false },
      voucher: { room: false, breakfast: true, extraBed: true },
      member: { room: false, breakfast: false, extraBed: true }
    };
    expect(normalizeDiscountScope(explicit)).toEqual(explicit);
  });
});

describe("calculateDiscountChain — broad scope (default, byte-equivalent to pre-DSC-01)", () => {
  it("returns the same total as the pre-DSC-01 chain for a senior-only booking", () => {
    // 1000 room + 200 breakfast + 0 extra bed; 20% senior.
    // Pre-DSC-01: subtotal=1200, senior=240, afterSenior=960, total=960.
    // Broad-scope chain: same. The "scope" is all-true, so the
    // senior percentage applies to the full subtotal.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(0);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(960);
  });

  it("returns the same total as the pre-DSC-01 chain for a senior + voucher booking", () => {
    // 1000 room + 200 breakfast; 20% senior + 100 voucher.
    // Pre-DSC-01: subtotal=1200, senior=240, afterSenior=960, voucher=100, total=860.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 100
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(100);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(860);
  });

  it("returns the same total as the pre-DSC-01 chain for a full chain", () => {
    // 1000 room + 200 breakfast; 20% senior + 100 voucher + 10% member.
    // Pre-DSC-01: subtotal=1200, senior=240, afterSenior=960, voucher=100,
    //              afterVoucher=860, member=86, total=774.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 100,
      memberPct: 10
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(100);
    expect(chain.memberDeduction).toBe(86);
    expect(chain.total).toBe(774);
  });

  it("includes extra bed in the broad-scope chain (the EXB-01 add-on)", () => {
    // 1000 room + 200 breakfast + 300 extra bed; 20% senior + 100 voucher + 10% member.
    // subtotal=1500, senior=300, afterSenior=1200, voucher=100, afterVoucher=1100,
    //              member=110, total=990.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 300,
      seniorPct: 20,
      voucherAmount: 100,
      memberPct: 10
    });
    expect(chain.seniorDeduction).toBe(300);
    expect(chain.voucherDeduction).toBe(100);
    expect(chain.memberDeduction).toBe(110);
    expect(chain.total).toBe(990);
  });

  it("returns 0 deductions + subtotal for a booking with no discounts", () => {
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0
    });
    expect(chain.seniorDeduction).toBe(0);
    expect(chain.voucherDeduction).toBe(0);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(1200);
  });
});

describe("calculateDiscountChain — narrow scope (DSC-01..05, per CVQ-06)", () => {
  it("senior scope: room only — 20% of roomTotal, breakfast + extra bed are NOT senior-discounted", () => {
    // 1000 room + 200 breakfast + 300 extra bed; senior scope: room only.
    // Senior base = 1000 (room only); senior = 200. After-senior subtotal: 1300.
    // Voucher (broad) cap = scopeBase(scope.voucher) − seniorDeduction = 1500 − 200 = 1300.
    //   Voucher = min(100, 1300) = 100. After-voucher subtotal: 1200.
    // Member (broad) base = scopeBase(scope.member) − senior − voucher = 1500 − 200 − 100 = 1200.
    //   Member 10% = 120.
    // Total = 1500 − 200 − 100 − 120 = 1080.
    // Note: scopes are per-class and independent. Narrowing senior to "room only"
    // means the senior percentage no longer applies to breakfast/extra bed —
    // it does NOT remove those components from the voucher or member's base.
    // The whole remaining subtotal (after the senior deduction) is still visible
    // to the voucher + member steps.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 300,
      seniorPct: 20,
      voucherAmount: 100,
      memberPct: 10,
      scope: {
        senior: { room: true, breakfast: false, extraBed: false },
        voucher: { room: true, breakfast: true, extraBed: true },
        member: { room: true, breakfast: true, extraBed: true }
      }
    });
    expect(chain.seniorDeduction).toBe(200);
    expect(chain.voucherDeduction).toBe(100);
    expect(chain.memberDeduction).toBe(120);
    expect(chain.total).toBe(1080);
  });

  it("senior scope: room + breakfast only — extra bed is NOT discounted", () => {
    // 1000 room + 200 breakfast + 300 extra bed; senior scope: room + breakfast.
    // Senior base = 1200; senior = 240. After-senior: 1500 - 240 = 1260.
    // Voucher (broad) capped by 1260; voucher = 100. After-voucher: 1160.
    // Member (broad) base = 1500 - 240 - 100 = 1160; member 10% = 116.
    // Total = 1500 - 240 - 100 - 116 = 1044.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 300,
      seniorPct: 20,
      voucherAmount: 100,
      memberPct: 10,
      scope: {
        senior: { room: true, breakfast: true, extraBed: false },
        voucher: { room: true, breakfast: true, extraBed: true },
        member: { room: true, breakfast: true, extraBed: true }
      }
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(100);
    expect(chain.memberDeduction).toBe(116);
    expect(chain.total).toBe(1044);
  });

  it("voucher scope: room only — voucher capped by room-only remaining", () => {
    // 1000 room + 200 breakfast; 20% senior (broad) + 500 voucher (room only).
    // Senior base = 1200; senior = 240. After-senior: 960.
    // Voucher base = (1000 - 240) = 760. Voucher = min(500, 760) = 500.
    // After-voucher: 460. Member (broad) base = 1200 - 240 - 500 = 460; member 10% = 46.
    // Total = 1200 - 240 - 500 - 46 = 414.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 500,
      memberPct: 10,
      scope: {
        senior: { room: true, breakfast: true, extraBed: true },
        voucher: { room: true, breakfast: false, extraBed: false },
        member: { room: true, breakfast: true, extraBed: true }
      }
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(500);
    expect(chain.memberDeduction).toBe(46);
    expect(chain.total).toBe(414);
  });

  it("member scope: breakfast only — 10% off breakfast-only remaining", () => {
    // 1000 room + 200 breakfast; 20% senior (broad) + 50 voucher (broad) + 10% member (breakfast only).
    // Senior base = 1200; senior = 240. After-senior: 960.
    // Voucher = 50. After-voucher: 910.
    // Member base = (200 - 240 - 50) = clipped to 0 (room portion is NOT in member's scope).
    // Total = 1200 - 240 - 50 - 0 = 910.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 50,
      memberPct: 10,
      scope: {
        senior: { room: true, breakfast: true, extraBed: true },
        voucher: { room: true, breakfast: true, extraBed: true },
        member: { room: false, breakfast: true, extraBed: false }
      }
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(50);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(910);
  });

  it("all three classes narrow — 20% senior + 50 voucher + 10% member, all on room only", () => {
    // 1000 room + 200 breakfast + 300 extra bed; all classes room only.
    // Senior base = 1000; senior = 200. After-senior (room only) = 800.
    // Voucher base = (1000 - 200) = 800. Voucher = min(50, 800) = 50. After-voucher: 750.
    // Member base = (1000 - 200 - 50) = 750. Member 10% = 75.
    // Total = 1500 - 200 - 50 - 75 = 1175.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 300,
      seniorPct: 20,
      voucherAmount: 50,
      memberPct: 10,
      scope: {
        senior: { room: true, breakfast: false, extraBed: false },
        voucher: { room: true, breakfast: false, extraBed: false },
        member: { room: true, breakfast: false, extraBed: false }
      }
    });
    expect(chain.seniorDeduction).toBe(200);
    expect(chain.voucherDeduction).toBe(50);
    expect(chain.memberDeduction).toBe(75);
    expect(chain.total).toBe(1175);
  });

  it("no components selected in any class — no deductions", () => {
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 50,
      memberPct: 10,
      scope: {
        senior: { room: false, breakfast: false, extraBed: false },
        voucher: { room: false, breakfast: false, extraBed: false },
        member: { room: false, breakfast: false, extraBed: false }
      }
    });
    expect(chain.seniorDeduction).toBe(0);
    expect(chain.voucherDeduction).toBe(0);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(1200);
  });

  it("voucher larger than its scoped base — capped at the base", () => {
    // 1000 room + 200 breakfast; voucher scope: room only; voucher = 5000 (huge).
    // Senior = 240. After-senior: 960.
    // Voucher base (room only) = 1000 - 240 = 760. Voucher = min(5000, 760) = 760.
    // Total = 1200 - 240 - 760 - 0 = 200.
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: 200,
      extraBedTotal: 0,
      seniorPct: 20,
      voucherAmount: 5000,
      memberPct: 0,
      scope: {
        senior: { room: true, breakfast: true, extraBed: true },
        voucher: { room: true, breakfast: false, extraBed: false },
        member: { room: true, breakfast: true, extraBed: true }
      }
    });
    expect(chain.seniorDeduction).toBe(240);
    expect(chain.voucherDeduction).toBe(760);
    expect(chain.total).toBe(200);
  });
});

describe("calculateDiscountChain — defensive coercion", () => {
  it("treats nullish inputs as 0", () => {
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: null as any,
      extraBedTotal: undefined,
      seniorPct: null as any,
      voucherAmount: null as any,
      memberPct: null as any
    });
    expect(chain.seniorDeduction).toBe(0);
    expect(chain.voucherDeduction).toBe(0);
    expect(chain.memberDeduction).toBe(0);
    expect(chain.total).toBe(1000);
  });

  it("treats NaN inputs as 0", () => {
    const chain = calculateDiscountChain({
      roomTotal: 1000,
      breakfastTotal: NaN,
      extraBedTotal: NaN,
      seniorPct: NaN,
      voucherAmount: NaN,
      memberPct: NaN
    });
    expect(chain.seniorDeduction).toBe(0);
    expect(chain.total).toBe(1000);
  });

  it("clamps the final total to ≥ 0 (huge voucher scenario)", () => {
    const chain = calculateDiscountChain({
      roomTotal: 100,
      breakfastTotal: 0,
      extraBedTotal: 0,
      voucherAmount: 10000
    });
    // Voucher capped at 100 (the full subtotal). Total = 0.
    expect(chain.total).toBe(0);
  });
});
