/**
 * Per 2026-11-19 (off-roadmap bug fix, decision #318): the ONE rule
 * that decides whether a booking's money is settled AT THE PROPERTY
 * or still owed BY THE GUEST.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The rule used to live as an ALLOWLIST of method keys
 * (`["gcash", "bank"]`) inside the guest confirmation helper
 * (`guest-app/src/utils/confirmationStatus.ts`), while every other
 * surface used the opposite formulation:
 *
 *   - booking Step 4's proof-upload gate: proof is required unless
 *     the method is `pay-at-hotel` (`BookingPage.tsx`);
 *   - the create endpoint: the booking lands in `payment-uploaded`
 *     when a receipt came with it (`bookings.ts`);
 *   - the booking-submitted email: "payment due upon arrival" only
 *     for `pay-at-hotel`, otherwise "your uploaded payment proof is
 *     queued for manual verification" (`email.ts`).
 *
 * An allowlist of method keys cannot survive admin-configured
 * methods. The live Spark Inn deployment stores its bank transfer
 * under the key `bpi` (label "Bank Transfer"), so the allowlist
 * classified it as "not online" — and the confirmation page told a
 * guest who had ALREADY uploaded a bank-transfer receipt:
 *
 *   "Pay at the property — nothing to pay now, settle with Bank
 *    Transfer when you check in"
 *
 * while the very same booking's email said "your uploaded payment
 * proof is queued for manual verification". Two surfaces, one
 * booking, opposite truths — and the wrong one tells the guest that
 * no money is owed.
 *
 * THE RULE
 * --------
 * Settled at the property: the keys in
 * `SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS` — `pay-at-hotel` (the
 * documented booking-flow method), `cash`, `cod` (cash on delivery)
 * and `add-to-bill` (charged to the room folio).
 *
 * EVERY other key is an ONLINE method: the guest pays now and proves
 * it. That covers every admin-configured method, including custom
 * ones the platform has never seen (`bpi`, `maya`, `paypal`, `card`,
 * `pesonet`, …).
 *
 * THE DEFAULT IS DELIBERATELY "ONLINE"
 * -------------------------------------
 * For an unknown key the platform asks for a receipt; the opposite
 * mistake would tell a guest who MUST pay that nothing is owed — the
 * hotel simply never collects the money. The cheaper mistake is the
 * one that ships.
 */

/**
 * Method keys whose money is settled at the property (or on the room
 * folio), i.e. NOT an online payment the guest must prove.
 */
export const SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS = [
  "pay-at-hotel",
  "cash",
  "cod",
  "add-to-bill"
] as const;

export type SettleAtPropertyPaymentMethodKey =
  (typeof SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS)[number];

/**
 * Normalizes a method key for comparison. The value reaches the
 * client as a URL param (`/book/confirm?paymentMethod=…`), so it can
 * carry stray whitespace and mixed case.
 */
export function normalizePaymentMethodKey(
  method: string | null | undefined
): string {
  return typeof method === "string" ? method.trim().toLowerCase() : "";
}

/**
 * True when the method settles at the property — nothing is owed by
 * the guest right now.
 */
export function isSettleAtPropertyPaymentMethod(
  method: string | null | undefined
): boolean {
  const key = normalizePaymentMethodKey(method);
  if (!key) return false;
  return (SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS as readonly string[]).includes(
    key
  );
}

/**
 * True when the method is an ONLINE payment: the guest must pay now
 * and prove it (upload a receipt) before the hotel can verify it.
 *
 * An EMPTY / unknown key is NOT online: there is no method to pay
 * with, so no receipt can be demanded. Callers that must fail closed
 * (e.g. the store's write path) keep their own rule.
 */
export function isOnlinePaymentMethod(
  method: string | null | undefined
): boolean {
  const key = normalizePaymentMethodKey(method);
  if (!key) return false;
  return !isSettleAtPropertyPaymentMethod(key);
}
