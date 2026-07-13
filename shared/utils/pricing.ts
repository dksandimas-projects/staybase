import type { BookingRateBreakdown } from "../types";

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
}

export function calculateBookingTotal(input: PriceInput) {
  // Per BF-08: prefer the pre-computed `roomTotal` when provided
  // (it accounts for per-night weekend substitution). Fall back
  // to the flat `ratePerNight * numNights` for callers that don't
  // need weekend-aware pricing.
  const roomTotal = input.roomTotal ?? (input.ratePerNight * input.numNights);
  const breakfastTotal =
    input.hasBreakfast && input.breakfastRate && input.numGuests
      ? input.breakfastRate * input.numGuests * input.numNights
      : 0;
  const subtotal = roomTotal + breakfastTotal;

  // Stacking order (per DECISIONS-FEATURES.md discount stacking):
  // 1. Senior/PWD discount (input.discountPct) — applied first to subtotal
  // 2. Voucher discount (input.voucherDiscount) — flat/percent reduction next
  // 3. Spark Rewards member discount (input.memberDiscountPct) — applied last on the post-discount amount
  const seniorPwdDiscount = subtotal * ((input.discountPct ?? 0) / 100);
  const afterSeniorPwd = subtotal - seniorPwdDiscount;
  const afterVoucher = afterSeniorPwd - (input.voucherDiscount ?? 0);
  const memberDiscount = afterVoucher * ((input.memberDiscountPct ?? 0) / 100);
  const total = afterVoucher - memberDiscount;

  return Math.max(total, 0);
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
