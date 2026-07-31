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
