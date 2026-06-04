export interface PriceInput {
  ratePerNight: number;
  numNights: number;
  numGuests?: number;
  breakfastRate?: number;
  hasBreakfast?: boolean;
  discountPct?: number;
  voucherDiscount?: number;
}

export function calculateBookingTotal(input: PriceInput) {
  const roomTotal = input.ratePerNight * input.numNights;
  const breakfastTotal =
    input.hasBreakfast && input.breakfastRate && input.numGuests
      ? input.breakfastRate * input.numGuests * input.numNights
      : 0;
  const subtotal = roomTotal + breakfastTotal;
  const percentageDiscount = subtotal * ((input.discountPct ?? 0) / 100);
  const totalDiscount = percentageDiscount + (input.voucherDiscount ?? 0);

  return Math.max(subtotal - totalDiscount, 0);
}
