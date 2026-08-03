// Per DSC (2026-07-31): the booking discount percentage formula
// `base × (pct/100)` and the "what's left of subtotal after a deduction,
// clamped to ≥ 0" pattern were duplicated across ~25 sites in the admin
// app, the guest-app server, and `shared/utils/pricing.ts` — each with
// its own per-step rounding + clamping + short-circuit logic (per-call-
// site defensive patterns, never a shared function). The DSC spec
// (`plan/project/ROADMAP.md §DSC`) calls the chain out as the third
// pure-refactor PR in the PMH-02 → EXB-02 → DSC pattern, scoped to the
// whole discount stack.
//
// The CHAIN (subtotal → senior → voucher → member) stays surface-
// specific — every site orders or omits the steps differently, rounds
// or doesn't, and clamps or doesn't. What gets centralized is the math
// itself: the two per-step formulas that every site re-derives.
// CHD-10 (children-in-breakfast per CVQ-01) will compose a second add-on
// term with the existing discount stack; that change touches all 25
// sites, and the math now lives in one place.
//
// Per DSC-01..05 (2026-08-01, per CVQ-06): the discount chain now
// consumes a per-class `DiscountScope` (room · breakfast · extra
// bed). The scope determines which charge components each class
// applies to. The "broad scope" (all three components true for
// every class) is the safe default and matches the historical
// behavior byte-for-byte. Narrowing is a one-line admin toggle;
// unwinding under-discounted bills is not — the booking doc
// snapshots the scope at create time (per DSC-02) so a later
// policy change never rewrites an existing bill.
//
// Pure refactor with zero behavior change — pinned by
// `shared/__tests__/booking-discounts.test.ts`.

/**
 * Compute a percentage-based discount: `base × (pct/100)`. Used for
 * the senior/PWD step (`subtotal × (discountPct/100)`) and the
 * Spark Rewards member step (`afterVoucher × (memberDiscountPct/100)`)
 * at every call site.
 *
 * Nullish / NaN / 0 inputs normalize to 0 — the caller's `Math.round`
 * / `Math.max` / `discountPct > 0` gate then handles the surface-
 * specific clamping. The historical `(x || 0)` and `nonNegativeFinite`
 * patterns are subsumed by the `Number(x) || 0` defensive coercion.
 *
 * Returns the raw product (may be negative if `pct` is). The caller
 * decides whether to round, clamp, or short-circuit — pricing.ts uses
 * the raw value byte-equivalently, the server + reports surfaces wrap
 * with `Math.round(...)`.
 */
export function calculatePercentDiscount(base: number, pct?: number | null): number {
  return (Number(base) || 0) * ((Number(pct) || 0) / 100);
}

/**
 * "What's left of `subtotal` after subtracting `deduction`, clamped
 * to ≥ 0." Used as the voucher base (subtotal − seniorDiscount) in
 * the server handlers and as the post-voucher subtotal
 * (afterSenior − voucherAmount) in the reports + receipt surfaces.
 *
 * Nullish / NaN inputs normalize to 0. Returns 0 if the deduction
 * would drive the result negative (e.g. a voucher larger than the
 * subtotal, or a senior discount larger than 100%).
 *
 * Historical patterns subsumed: `Math.max(subtotal - seniorDiscount, 0)`,
 * `Math.max(afterSenior - voucherAmount, 0)`, `Math.max(originalTotalPrice
 * - voucherDiscount, 0)`. All collapse to the same shape.
 */
export function calculateVoucherBase(subtotal: number, deduction: number): number {
  return Math.max(
    (Number(subtotal) || 0) - (Number(deduction) || 0),
    0
  );
}

/**
 * Per DSC-01..05 (2026-08-01, per CVQ-06): per-class discount scope.
 * Each class has 3 components (room, breakfast, extra bed) that can
 * be toggled on/off independently. The "broad scope" is all-true;
 * the "narrow scope" picks 1-2 components per class. Stored on
 * `settings/hotelConfig.discountScope` (admin-editable) and
 * snapshotted onto `Booking.discountScopeSnapshot` at create time
 * so a later policy change never rewrites an existing bill
 * (per DSC-02).
 */
export interface DiscountScopeClass {
  room: boolean;
  breakfast: boolean;
  extraBed: boolean;
}

export interface DiscountScope {
  senior: DiscountScopeClass;
  voucher: DiscountScopeClass;
  member: DiscountScopeClass;
}

/**
 * The default scope (all components true for all classes). Matches
 * the pre-DSC-01 behavior byte-for-byte: the senior discount applies
 * to room + breakfast + extra bed, the voucher applies to the same,
 * the member discount applies to the same. Used when the admin
 * hasn't set a narrower scope (legacy settings without the field,
 * or the explicit "broad" default per the spec).
 */
export const BROAD_DISCOUNT_SCOPE: DiscountScope = {
  senior: { room: true, breakfast: true, extraBed: true },
  voucher: { room: true, breakfast: true, extraBed: true },
  member: { room: true, breakfast: true, extraBed: true }
};

/**
 * Normalize a `DiscountScope` input to a fully-populated object. When
 * the input is undefined / null, returns the broad default (byte-
 * equivalent to the pre-DSC-01 behavior). When a class is undefined
 * or partial, fills in the missing components with `true` (the
 * safe default — narrowing is opt-in, broadening is the fallback).
 */
export function normalizeDiscountScope(scope: DiscountScope | null | undefined): DiscountScope {
  if (!scope) return BROAD_DISCOUNT_SCOPE;
  const fill = (cls: Partial<DiscountScopeClass> | undefined): DiscountScopeClass => ({
    room: cls?.room !== false,
    breakfast: cls?.breakfast !== false,
    extraBed: cls?.extraBed !== false
  });
  return {
    senior: fill(scope.senior),
    voucher: fill(scope.voucher),
    member: fill(scope.member)
  };
}

/**
 * Per DSC-01..05 (2026-08-01, per CVQ-06): the scope-aware discount
 * chain. Decomposes a booking's pre-discount subtotal by component
 * (room, breakfast, extra bed), then applies the senior → voucher →
 * member chain with each class's scope respected.
 *
 * Stacking order (per DECISIONS-FEATURES.md #13b):
 *   1. Senior/PWD (`seniorPct`) — applied first to the senior-scoped
 *      portion of the subtotal. The "base" is the sum of the room,
 *      breakfast, and extra-bed amounts that are in `scope.senior`.
 *   2. Voucher (`voucherAmount`, a flat currency amount) — capped
 *      by the voucher-scoped portion of the remaining after-senior
 *      subtotal. For percent vouchers the server uses
 *      `calculateVoucherDiscount` separately; this helper handles
 *      the flat case.
 *   3. Spark Rewards member (`memberPct`) — applied last to the
 *      member-scoped portion of the remaining after-voucher
 *      subtotal.
 *
 * The `round: true` flag preserves the server's per-step
 * `Math.round(...)` behavior (the client uses `round: false`,
 * byte-equivalent to the pre-DSC-01 behavior). For the broad
 * default scope (all true), the output is byte-equivalent to
 * `subtotal → seniorPwdDiscount → afterSeniorPwd → afterVoucher →
 * memberDiscount → total` — the pre-DSC-01 chain.
 *
 * Returns the chain values so the caller can display them in the
 * rate breakdown, the receipt PDF, and the booking drawer.
 */
export interface DiscountChainInput {
  roomTotal: number;
  breakfastTotal: number;
  extraBedTotal: number;
  seniorPct?: number | null;
  voucherAmount?: number | null;
  memberPct?: number | null;
  scope?: DiscountScope | null;
  round?: boolean;
}

export interface DiscountChain {
  /** Raw `scopeSeniorBase × (seniorPct / 100)`. May be negative. */
  seniorDeduction: number;
  /** Capped by `max(0, scopeVoucherBase − seniorDeduction)`. */
  voucherDeduction: number;
  /** Raw `scopeMemberBase × (memberPct / 100)`, applied to the running remaining. */
  memberDeduction: number;
  /** The final total (`subtotal − all deductions`, clamped to ≥ 0). */
  total: number;
}

export function calculateDiscountChain(input: DiscountChainInput): DiscountChain {
  const roomTotal = Number(input.roomTotal) || 0;
  const breakfastTotal = Number(input.breakfastTotal) || 0;
  const extraBedTotal = Number(input.extraBedTotal) || 0;
  const subtotal = roomTotal + breakfastTotal + extraBedTotal;
  const scope = normalizeDiscountScope(input.scope);

  // Per-class "discountable" base: the sum of components in the
  // class's scope. Used to gate the senior percentage, the voucher
  // cap, and the member percentage. For the broad default scope
  // (all true) this collapses to `subtotal` for each class — the
  // pre-DSC-01 behavior.
  const scopeBase = (cls: DiscountScopeClass): number =>
    (cls.room ? roomTotal : 0) +
    (cls.breakfast ? breakfastTotal : 0) +
    (cls.extraBed ? extraBedTotal : 0);

  const seniorBase = scopeBase(scope.senior);
  const seniorRaw = seniorBase * ((Number(input.seniorPct) || 0) / 100);
  const seniorDeduction = input.round ? Math.round(seniorRaw) : seniorRaw;

  // The voucher's cap is the voucher-scoped portion of the
  // remaining after-senior subtotal. For the broad default scope
  // this is `(subtotal − seniorDeduction)` — the pre-DSC-01 cap.
  const voucherBase = Math.max(0, scopeBase(scope.voucher) - seniorDeduction);
  const voucherAmount = Number(input.voucherAmount) || 0;
  const voucherDeduction = Math.min(Math.max(0, voucherAmount), voucherBase);

  // The member percentage applies to the member-scoped portion of
  // the running remaining. For the broad default scope this is
  // `subtotal − seniorDeduction − voucherDeduction` — the
  // pre-DSC-01 base.
  const memberBase = Math.max(
    0,
    scopeBase(scope.member) - seniorDeduction - voucherDeduction
  );
  const memberRaw = memberBase * ((Number(input.memberPct) || 0) / 100);
  const memberDeduction = input.round ? Math.round(memberRaw) : memberRaw;

  const total = Math.max(0, subtotal - seniorDeduction - voucherDeduction - memberDeduction);

  return { seniorDeduction, voucherDeduction, memberDeduction, total };
}
