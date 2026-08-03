import type { BookingRateBreakdown } from "../types";
import type { DiscountScope } from "./bookingDiscounts";
import { calculateBreakfastAddOn } from "./bookingAddOns";
import { calculateDiscountChain } from "./bookingDiscounts";

export interface PriceInput {
  ratePerNight: number;
  numNights: number;
  numGuests?: number;
  breakfastRate?: number;
  hasBreakfast?: boolean;
  discountPct?: number;
  voucherDiscount?: number;
  memberDiscountPct?: number;
  // Per BF-08 (booking-flow audit 2026-06-26): callers that
  // already walked each night and substituted the weekend rate
  // (e.g. BookingPage's `roomTotal` useMemo, the server's
  // handleCreateBooking transaction) can pass a pre-computed
  // `roomTotal` that overrides the `ratePerNight * numNights`
  // calculation. This makes the displayed total match the
  // server's `totalPrice` on stays that include a weekend night.
  roomTotal?: number;
  // Per EXB-01 (2026-07-31): the per-night extra-bed subtotal.
  // Composed into the discount chain's `extraBedTotal` so the
  // chain math sees the full pre-discount subtotal. Default 0.
  extraBedTotal?: number;
  // Per DSC-01..05 (2026-08-01, per CVQ-06): the admin's
  // per-class discount scope. Default `undefined` reads as
  // the broad scope (all-true) — byte-equivalent to the
  // pre-DSC-01 behavior. The booking page passes the live
  // admin scope for the live preview; the server snapshots
  // its own scope onto the booking and reads it back on
  // reschedule.
  discountScope?: DiscountScope | null;
}

export function calculateBookingTotal(input: PriceInput) {
  // Per BF-08: prefer the pre-computed `roomTotal` when provided
  // (it accounts for per-night weekend substitution). Fall back
  // to the flat `ratePerNight * numNights` for callers that don't
  // need weekend-aware pricing.
  const roomTotal = input.roomTotal ?? (input.ratePerNight * input.numNights);
  // Per EXB-02 (2026-07-31): the inline `breakfastRate × numGuests × numNights`
  // ternary now routes through the shared `calculateBreakfastAddOn` helper.
  // Byte-equivalent output: the helper's `hasBreakfast` short-circuit replaces
  // the original outer guard, and its defensive coercion on each operand
  // (nullish / 0 → 0) is a strict superset of the historical truthy checks.
  const breakfastTotal = calculateBreakfastAddOn(input);
  // Per EXB-01 (2026-07-31): extra-bed subtotal is the third
  // term in the pre-discount subtotal. Composed into the chain
  // so the senior/voucher/member percentages see the full
  // picture.
  const extraBedTotal = Number(input.extraBedTotal) || 0;

  // Stacking order (per DECISIONS-FEATURES.md discount stacking):
  // 1. Senior/PWD discount (input.discountPct) — applied first to subtotal
  // 2. Voucher discount (input.voucherDiscount) — flat/percent reduction next
  // 3. Spark Rewards member discount (input.memberDiscountPct) — applied last on the post-discount amount
  // Per DSC-01..05 (2026-08-01, per CVQ-06): the whole chain now
  // routes through `calculateDiscountChain` so the math (and any
  // future per-class scope narrowing) lives in one place. pricing.ts
  // historically returned the raw (unrounded) product — the helper
  // preserves that with `round: false` (the client preview path).
  // The server calls the same helper with `round: true` and the
  // snapshotted scope, so the two paths always agree on the
  // byte-level for the broad default scope.
  const { total } = calculateDiscountChain({
    roomTotal,
    breakfastTotal,
    extraBedTotal,
    seniorPct: input.discountPct,
    voucherAmount: input.voucherDiscount,
    memberPct: input.memberDiscountPct,
    scope: input.discountScope,
    round: false
  });

  return total;
}

export function getLockedManualNightlyRate(
  breakdown: BookingRateBreakdown | null | undefined
): number | null {
  const manualLine = breakdown?.roomLines?.find((line) => line.source === "manual");
  if (!manualLine) return null;

  const nights = Number(manualLine.nights);
  const subtotal = Number(manualLine.subtotal);
  if (Number.isFinite(nights) && nights > 0 && Number.isFinite(subtotal) && subtotal >= 0) {
    return subtotal / nights;
  }

  const nightlyRate = Number(manualLine.nightlyRate);
  return Number.isFinite(nightlyRate) && nightlyRate >= 0 ? nightlyRate : null;
}
