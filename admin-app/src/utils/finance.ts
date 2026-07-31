// Pure finance/reporting helpers shared by the Reports workspace and its
// tests. Kept framework-free so the reconciliation logic (payment-method
// bucketing, timezone-stable day keys) can be unit-tested without rendering
// the page.

// Per EXB-02 (2026-07-31): the breakfast add-on math is now sourced
// from the shared `calculateBreakfastAddOn` helper in
// `@spark-inn/shared`. The historical inline `nonNegativeFinite(x) *
// nonNegativeFinite(y) * z` pattern was duplicated across 10 sites
// (this file + ReportsPage.tsx + rate-breakdown.ts + bookings.ts +
// pricing.ts + CalendarPage.tsx). One PR fixes all of them.
import { calculateBreakfastAddOn } from "@spark-inn/shared";

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

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1000) * 1000;
  return representedAsUtc - instantWithoutMilliseconds;
}

function startOfDateKeyInTimeZone(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day);
  let instant = targetWallClock;

  // Re-evaluate the offset at the resolved instant so this also behaves
  // correctly for white-label hotels in daylight-saving timezones.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = targetWallClock - timeZoneOffsetMs(new Date(instant), timeZone);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

// Inclusive UTC instants for hotel-calendar date keys. Report membership must
// use these boundaries rather than the browser's local midnight.
export function getTimeZoneDayRange(startDateKey: string, endDateKey: string, timeZone: string): { start: Date; end: Date } {
  const start = startOfDateKeyInTimeZone(startDateKey, timeZone);
  const nextDayStart = startOfDateKeyInTimeZone(shiftDateKey(endDateKey, 1), timeZone);
  return { start, end: new Date(nextDayStart.getTime() - 1) };
}

type FolioBooking = { id: string; totalPrice?: number | null };
type FolioPayment = {
  source: "booking" | "store-order";
  sourceId: string;
  bookingId: string;
  amount: number;
};
type FolioCharge = { bookingId: string; amount: number };
type FolioStoreOrder = {
  id: string;
  bookingId?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  isBilled?: boolean | null;
  totalAmount?: number | null;
};

// Snapshot selected booking folios and direct-paid store orders on the same
// to-date basis. This makes Billed, Collected, Outstanding, and Over-collected
// comparable even when a deposit was recorded before the selected stay range.
export function summarizeFolioSnapshot(input: {
  bookings: FolioBooking[];
  bookingIds: Iterable<string>;
  payments: FolioPayment[];
  charges: FolioCharge[];
  storeOrders: FolioStoreOrder[];
  directStoreOrderIds: Iterable<string>;
}): { billed: number; collected: number } {
  const bookingIds = new Set(input.bookingIds);
  const directStoreOrderIds = new Set(input.directStoreOrderIds);

  const bookingTotals = input.bookings
    .filter((booking) => bookingIds.has(booking.id))
    .reduce((sum, booking) => sum + nonNegativeFinite(booking.totalPrice), 0);
  const incidentalTotals = input.charges
    .filter((charge) => bookingIds.has(charge.bookingId))
    .reduce((sum, charge) => sum + (Number.isFinite(Number(charge.amount)) ? Number(charge.amount) : 0), 0);
  const addToBillTotals = input.storeOrders
    .filter((order) => order.bookingId && bookingIds.has(order.bookingId)
      && order.paymentMethod === "add-to-bill" && order.status === "delivered" && order.isBilled)
    .reduce((sum, order) => sum + nonNegativeFinite(order.totalAmount), 0);
  const directStoreTotals = input.storeOrders
    .filter((order) => directStoreOrderIds.has(order.id))
    .reduce((sum, order) => sum + nonNegativeFinite(order.totalAmount), 0);
  const collected = input.payments
    .filter((payment) => payment.source === "booking"
      ? bookingIds.has(payment.bookingId)
      : directStoreOrderIds.has(payment.sourceId))
    .reduce((sum, payment) => sum + (Number.isFinite(Number(payment.amount)) ? Number(payment.amount) : 0), 0);

  return {
    billed: bookingTotals + incidentalTotals + addToBillTotals + directStoreTotals,
    collected
  };
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
  // Per EXB-02 (2026-07-31): the historical inline
  // `nonNegativeFinite(breakfastRate) * nonNegativeFinite(numGuests) * nights`
  // pattern now routes through the shared `calculateBreakfastAddOn`
  // helper. Byte-equivalent output — the helper's `Number(x) || 0`
  // defensive coercion matches `nonNegativeFinite(x)` for the inputs
  // this site passes (all non-negative integers from the booking doc).
  const breakfastGross = calculateBreakfastAddOn({
    hasBreakfast: booking.hasBreakfast,
    breakfastRate: nonNegativeFinite(booking.breakfastRate),
    numGuests: nonNegativeFinite(booking.numGuests),
    numNights: nights
  });

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
