import { calculateBreakfastAddOn } from "@spark-inn/shared";
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
  numNights?: unknown;
  numGuests?: unknown;
  ratePerNight?: unknown;
  breakfastRate?: unknown;
  hasBreakfast?: unknown;
  checkIn?: unknown;
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

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dateKeyFromUnknown(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date
    ? value
    : value && typeof (value as any).toDate === "function"
      ? (value as any).toDate()
      : new Date(value as any);
  return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
}

// Early departure keeps the contracted total, but the receipt must describe
// the shortened stay. Rebuild the consumed room/add-on lines, preserve the
// canonical booking deductions, then expose the retained balance as its own
// positive adjustment instead of hiding it in the room rate.
export function rebuildEarlyCheckoutRateBreakdown(
  booking: RebuildableBooking,
  newNights: number
): BookingRateBreakdown {
  const nights = Math.max(Math.floor(nonNegativeFinite(newNights)), 1);
  const originalNights = Math.max(Math.floor(nonNegativeFinite(booking.numNights)), nights);
  const finalTotal = nonNegativeFinite(booking.totalPrice);
  const existing = booking.rateBreakdown;

  let remainingNights = nights;
  const roomLines: BookingRateLine[] = (existing?.roomLines || []).flatMap((line) => {
    if (remainingNights <= 0) return [];
    const lineNights = Math.max(Math.floor(nonNegativeFinite(line.nights)), 0);
    const consumedNights = Math.min(lineNights, remainingNights);
    if (consumedNights <= 0) return [];
    remainingNights -= consumedNights;
    return [{
      ...line,
      endDate: shiftDateKey(line.startDate, consumedNights),
      nights: consumedNights,
      subtotal: nonNegativeFinite(line.nightlyRate) * consumedNights
    }];
  });

  if (roomLines.length === 0) {
    const startDate = dateKeyFromUnknown(booking.checkIn);
    const nightlyRate = nonNegativeFinite(booking.ratePerNight);
    roomLines.push({
      source: "manual",
      label: "Locked room rate",
      startDate,
      endDate: shiftDateKey(startDate, nights),
      nights,
      nightlyRate,
      subtotal: nightlyRate * nights
    });
  }

  const roomSubtotal = roomLines.reduce((sum, line) => sum + line.subtotal, 0);
  const addOnRatio = originalNights > 0 ? nights / originalNights : 1;
  // Per EXB-02 (2026-07-31): the inline `breakfastRate × numGuests × nights`
  // pattern now routes through the shared `calculateBreakfastAddOn` helper.
  // Byte-equivalent output: the helper's defensive coercion is at least as
  // strong as the historical `nonNegativeFinite` wrapper, and the
  // `booking.hasBreakfast` gate is preserved by the surrounding ternary.
  const addOns = existing
    ? (existing.addOns || []).map((line) => ({ ...line, amount: Math.round(nonNegativeFinite(line.amount) * addOnRatio * 100) / 100 }))
    : booking.hasBreakfast
      ? [{
          label: "Breakfast add-on",
          amount: calculateBreakfastAddOn({
            hasBreakfast: booking.hasBreakfast,
            breakfastRate: booking.breakfastRate,
            numGuests: booking.numGuests,
            numNights: nights
          })
        }]
      : [];

  const originalRoomSubtotal = existing?.roomSubtotal
    ?? nonNegativeFinite(booking.ratePerNight) * originalNights;
  const originalAddOns = existing?.addOns
    ?? (booking.hasBreakfast
      ? [{
          label: "Breakfast add-on",
          amount: calculateBreakfastAddOn({
            hasBreakfast: booking.hasBreakfast,
            breakfastRate: booking.breakfastRate,
            numGuests: booking.numGuests,
            numNights: originalNights
          })
        }]
      : []);
  const originalPricing = composeRateBreakdown({
    roomLines: existing?.roomLines || roomLines,
    roomSubtotal: originalRoomSubtotal,
    addOns: originalAddOns,
    discountType: String(booking.discountType || ""),
    discountPct: nonNegativeFinite(booking.discountPct),
    voucherDiscount: nonNegativeFinite(booking.voucherDiscount),
    memberDiscountPct: nonNegativeFinite(booking.memberDiscountPct),
    pointsRedeemedValue: nonNegativeFinite(booking.pointsRedeemedValue),
    finalTotal
  });
  const deductionTotal = originalPricing.deductions.reduce((sum, line) => sum + line.amount, 0);
  const consumedGross = roomSubtotal + addOns.reduce((sum, line) => sum + line.amount, 0);
  const retainedAmount = Math.max(Math.round((finalTotal + deductionTotal - consumedGross) * 100) / 100, 0);

  return {
    roomSubtotal,
    roomLines,
    addOns: retainedAmount > 0
      ? [...addOns, { label: "Early departure — original total retained", amount: retainedAmount }]
      : addOns,
    deductions: originalPricing.deductions,
    finalTotal
  };
}
