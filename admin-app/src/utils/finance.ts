// Pure finance/reporting helpers shared by the Reports workspace and its
// tests. Kept framework-free so the reconciliation logic (payment-method
// bucketing, timezone-stable day keys) can be unit-tested without rendering
// the page.

export type PaymentBucket = "cash" | "gcash" | "bank" | "card" | "paypal" | "other";

// The fixed Daily Close columns. "other" is the catch-all so a custom or
// ambiguous method (e.g. a hotel-defined tender, or the booking-intent
// "pay-at-hotel") never silently inflates the physical cash count and
// produces a false drawer variance.
export const PAYMENT_BUCKETS: PaymentBucket[] = ["cash", "gcash", "bank", "card", "paypal", "other"];

// Map a recorded payment's free-form `method` string onto a reconciliation
// bucket. Only tenders we can physically/ digitally count map to a named
// bucket; everything else (including "pay-at-hotel", which is a booking
// intent rather than a settled tender) falls through to "other".
export function normalizePaymentMethodBucket(method: string): PaymentBucket {
  const m = (method || "").trim().toLowerCase();
  if (m === "gcash") return "gcash";
  if (m === "bank" || m === "bank_transfer" || m === "bank-transfer" || m === "bank transfer") return "bank";
  if (m === "card" || m === "credit-card" || m === "credit card" || m === "creditcard") return "card";
  if (m === "paypal") return "paypal";
  if (m === "cash") return "cash";
  return "other";
}

// A calendar-day key (YYYY-MM-DD) for a timestamp, evaluated in the hotel's
// timezone rather than UTC or the admin's browser locale. Using this
// everywhere keeps "Collections by day" and the Daily Close ledger agreeing
// on which business day a payment belongs to — a payment recorded at 1 AM
// Manila must not land on the previous UTC day in one view and today in the
// other.
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

type BookingRevenueInput = {
  totalPrice?: number | null;
  ratePerNight?: number | null;
  numNights?: number | null;
  numGuests?: number | null;
  hasBreakfast?: boolean | null;
  breakfastRate?: number | null;
  rateBreakdown?: {
    roomSubtotal?: number | null;
  } | null;
};

function nonNegativeFinite(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
}

// A booking's totalPrice already contains breakfast and all deductions. Split
// that net total proportionally across the locked gross room/breakfast amounts
// so the two report streams are disjoint and always add back to totalPrice.
// Legacy bookings fall back to ratePerNight × numNights for the room basis.
export function splitBookingRevenue(booking: BookingRevenueInput): { room: number; breakfast: number } {
  const total = nonNegativeFinite(booking.totalPrice);
  const nights = nonNegativeFinite(booking.numNights);
  const breakfastGross = booking.hasBreakfast
    ? nonNegativeFinite(booking.breakfastRate) * nonNegativeFinite(booking.numGuests) * nights
    : 0;

  if (total === 0 || breakfastGross === 0) {
    return { room: total, breakfast: 0 };
  }

  const lockedRoomSubtotal = nonNegativeFinite(booking.rateBreakdown?.roomSubtotal);
  const legacyRoomSubtotal = nonNegativeFinite(booking.ratePerNight) * nights;
  const roomGross = lockedRoomSubtotal > 0 ? lockedRoomSubtotal : legacyRoomSubtotal;

  if (roomGross <= 0) {
    return { room: total, breakfast: 0 };
  }

  const grossTotal = roomGross + breakfastGross;
  const breakfast = Math.round(total * (breakfastGross / grossTotal) * 100) / 100;
  return {
    room: Math.round((total - breakfast) * 100) / 100,
    breakfast
  };
}
