import type {
  BookingRateAdjustmentLine,
  BookingRateBreakdown,
  BookingRateLine
} from "@spark-inn/shared";

type BuildRateBreakdownInput = {
  roomLines: BookingRateLine[];
  roomSubtotal: number;
  breakfastTotal: number;
  discountType: string;
  discountPct: number;
  voucherDiscount: number;
  memberDiscountPct: number;
  pointsRedeemedValue?: number;
  finalTotal: number;
};

type RebuildableBooking = {
  rateBreakdown?: BookingRateBreakdown | null;
  discountType?: unknown;
  discountPct?: unknown;
  voucherDiscount?: unknown;
  memberDiscountPct?: unknown;
  pointsRedeemedValue?: unknown;
  totalPrice?: unknown;
};

type RebuildOverrides = {
  pointsRedeemedValue?: number;
  finalTotal?: number;
};

function nonNegativeFinite(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
}

function composeRateBreakdown(input: {
  roomLines: BookingRateLine[];
  roomSubtotal: number;
  addOns: BookingRateAdjustmentLine[];
  discountType: string;
  discountPct: number;
  voucherDiscount: number;
  memberDiscountPct: number;
  pointsRedeemedValue: number;
  finalTotal: number;
}): BookingRateBreakdown {
  const roomSubtotal = nonNegativeFinite(input.roomSubtotal);
  const addOns = input.addOns.map((line) => ({
    ...line,
    amount: nonNegativeFinite(line.amount)
  }));
  const subtotal = roomSubtotal + addOns.reduce((sum, line) => sum + line.amount, 0);
  const discountPct = nonNegativeFinite(input.discountPct);
  const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
  const afterSeniorPwd = Math.max(subtotal - seniorPwdDiscount, 0);
  const voucherDiscount = nonNegativeFinite(input.voucherDiscount);
  const afterVoucher = Math.max(afterSeniorPwd - voucherDiscount, 0);
  const memberDiscountPct = nonNegativeFinite(input.memberDiscountPct);
  const memberDiscount = Math.round(afterVoucher * (memberDiscountPct / 100));
  const pointsRedeemedValue = nonNegativeFinite(input.pointsRedeemedValue);
  const deductions: BookingRateAdjustmentLine[] = [
    ...(seniorPwdDiscount > 0
      ? [{
          label: `${input.discountType === "senior" ? "Senior Citizen" : "PWD"} discount (${discountPct}%)`,
          amount: seniorPwdDiscount
        }]
      : []),
    ...(voucherDiscount > 0 ? [{ label: "Voucher discount", amount: voucherDiscount }] : []),
    ...(memberDiscount > 0 ? [{ label: `Spark Rewards member discount (${memberDiscountPct}%)`, amount: memberDiscount }] : []),
    ...(pointsRedeemedValue > 0 ? [{ label: "Spark Rewards points redeemed", amount: pointsRedeemedValue }] : [])
  ];

  return {
    roomSubtotal,
    roomLines: input.roomLines,
    addOns,
    deductions,
    finalTotal: nonNegativeFinite(input.finalTotal)
  };
}

export function buildRateBreakdown(input: BuildRateBreakdownInput): BookingRateBreakdown {
  return composeRateBreakdown({
    ...input,
    addOns: input.breakfastTotal > 0
      ? [{ label: "Breakfast add-on", amount: input.breakfastTotal }]
      : [],
    pointsRedeemedValue: input.pointsRedeemedValue || 0
  });
}

// Rebuild an existing locked breakdown after a money-field mutation while
// preserving its original room lines and add-on labels. Legacy bookings that
// never had a breakdown remain on their documented fallback path.
export function rebuildRateBreakdown(
  booking: RebuildableBooking,
  overrides: RebuildOverrides = {}
): BookingRateBreakdown | undefined {
  const existing = booking.rateBreakdown;
  if (!existing) return undefined;

  const pointsRedeemedValue = overrides.pointsRedeemedValue === undefined
    ? nonNegativeFinite(booking.pointsRedeemedValue)
    : nonNegativeFinite(overrides.pointsRedeemedValue);
  const finalTotal = overrides.finalTotal === undefined
    ? nonNegativeFinite(booking.totalPrice)
    : nonNegativeFinite(overrides.finalTotal);

  return composeRateBreakdown({
    roomLines: existing.roomLines || [],
    roomSubtotal: existing.roomSubtotal,
    addOns: existing.addOns || [],
    discountType: String(booking.discountType || ""),
    discountPct: nonNegativeFinite(booking.discountPct),
    voucherDiscount: nonNegativeFinite(booking.voucherDiscount),
    memberDiscountPct: nonNegativeFinite(booking.memberDiscountPct),
    pointsRedeemedValue,
    finalTotal
  });
}
