export interface PriceInput {
  ratePerNight: number;
  numNights: number;
  numGuests?: number;
  breakfastRate?: number;
  hasBreakfast?: boolean;
  discountPct?: number;
  voucherDiscount?: number;
  memberDiscountPct?: number;
}

export function calculateBookingTotal(input: PriceInput) {
  const roomTotal = input.ratePerNight * input.numNights;
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
