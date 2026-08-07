/**
 * Per 2026-08-07 (off-roadmap bug fix, decision #200):
 * the payment-method label surfaced on every guest-facing page
 * (booking confirmation, my-booking single card, my-booking
 * reservation card, store checkout) was hardcoded in each
 * page's own `paymentLabels` / `legacy` object literal. When
 * the admin edited a method's `label` in Settings → Payment
 * Methods, the booking page picked up the new label (it
 * reads `hotelConfig.paymentMethods[].label` dynamically)
 * but the my-booking + confirmation pages did not — they
 * kept showing the legacy "Digital Wallet (GCash/Maya)" /
 * "Pay at Hotel" / "Bank Transfer" copy even after the
 * admin renamed the method. When the admin added a custom
 * method (e.g. `pesonet`), the my-booking + reservation
 * cards fell through to the raw method key, so the guest
 * saw "pesonet" / "credit-card" as the label.
 *
 * This module is the single source of truth for resolving a
 * payment method's guest-facing label. Every display surface
 * routes through `resolvePaymentMethodLabel` so the label
 * can never drift again:
 *
 *   1. Look up the method in the admin's
 *      `hotelConfig.paymentMethods[]` array (admin-editable
 *      label is the canonical source).
 *   2. Fall back to a small hardcoded legacy map for the
 *      few keys the admin has not surfaced on the current
 *      deployment (e.g. `paypal`, which the current
 *      spark-inn deployment does not enable).
 *   3. Fall back to the raw method key as a last resort —
 *      the guest still sees something readable-ish (the
 *      key is a short kebab-case slug) and staff can
 *      identify the gap from the lookup's
 *      `paymentMethod` field.
 */

export interface PaymentMethodConfigLike {
  method: string;
  label?: string;
}

/**
 * Hardcoded legacy labels. These exist only as a last-resort
 * fallback for the few method keys the admin has not surfaced
 * in `hotelConfig.paymentMethods[]` on the current deployment
 * (e.g. `paypal` is wired in the old data model but not used
 * at Spark Inn Bohol). They are NOT the canonical source — the
 * admin-editable array is. Both BookingConfirmPage and
 * BookingLookupPage import this map via the shared package so
 * the two pages can never drift apart.
 */
export const LEGACY_PAYMENT_METHOD_LABELS: Record<string, string> = {
  gcash: "Digital Wallet (GCash/Maya)",
  bank: "Bank Transfer (Direct Deposit)",
  "pay-at-hotel": "Pay at Hotel"
};

/**
 * Returns the guest-facing label for a booking's stored
 * `paymentMethod` key.
 *
 * Resolution order (see module header for rationale):
 *
 *   1. `paymentMethods` (admin config) — match by `method`,
 *      return that entry's `label`. Admin edits win.
 *   2. `LEGACY_PAYMENT_METHOD_LABELS` — covers the few keys
 *      the admin has not surfaced yet (e.g. `paypal`).
 *   3. Raw `methodKey` — short kebab-case slug; the guest
 *      sees something readable, staff can identify the gap.
 *
 * Returns an empty string when `methodKey` is empty /
 * non-string, so the caller can short-circuit (`if (!label)
 * return null;`).
 */
export function resolvePaymentMethodLabel(
  methodKey: string | null | undefined,
  paymentMethods: ReadonlyArray<PaymentMethodConfigLike> | null | undefined
): string {
  if (typeof methodKey !== "string" || methodKey.length === 0) {
    return "";
  }

  // Step 1: admin-editable config is the canonical source.
  if (Array.isArray(paymentMethods)) {
    const match = paymentMethods.find(
      (m) => m && typeof m.method === "string" && m.method === methodKey
    );
    if (match && typeof match.label === "string" && match.label.length > 0) {
      return match.label;
    }
  }

  // Step 2: legacy map for keys the admin has not surfaced.
  if (Object.prototype.hasOwnProperty.call(LEGACY_PAYMENT_METHOD_LABELS, methodKey)) {
    return LEGACY_PAYMENT_METHOD_LABELS[methodKey];
  }

  // Step 3: raw key as a last resort. The key is always
  // present (the booking stored it), so the guest sees
  // something instead of a blank cell.
  return methodKey;
}
