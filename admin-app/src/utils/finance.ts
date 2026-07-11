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
