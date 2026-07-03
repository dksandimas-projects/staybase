import type { PaymentMethodConfig } from "../types";

// An effective store payment method entry as rendered to the
// guest store checkout. Payment methods now have one canonical
// admin surface: `settings/hotelConfig.paymentMethods[]`. The
// `source` field is kept for compatibility with existing UI types;
// every entry now comes from the Payment Methods tab.
export type StorePaymentMethodSource = "payment";

export interface EffectiveStorePaymentMethod {
  method: string;
  label: string;
  isEnabled: boolean;
  source: StorePaymentMethodSource;
  // Needed by the guest checkout to render the QR + account info
  // + screenshot upload panel. `accountInfo` is retained only for
  // legacy migrated entries; `accountName` and `accountNumber` are
  // the structured fields used by Payment Methods.
  qrUrl?: string;
  accountInfo?: string;
  accountName?: string;
  accountNumber?: string;
}

export interface StorePaymentMethodLike {
  method: string;
  label?: string;
  isEnabled?: boolean;
  qrUrl?: string;
  accountInfo?: string;
  accountName?: string;
  accountNumber?: string;
  // Per #111 (per-method surface toggles). Both default to
  // `true` when omitted — pre-#111 entries are treated as
  // "visible on all surfaces" without an explicit migration.
  showInStore?: boolean;
  showInCorporate?: boolean;
}
export interface StoreConfigLike {
  paymentMethods?: StorePaymentMethodLike[];
}

// Compute the de-duped, source-tagged list of payment methods
// rendered by the guest store checkout. This is the single source
// of truth for store payment-method visibility — the
// server-side `/api/store/create-order` handler in
// `guest-app/server/handlers/store.ts` calls it inside the
// Firestore transaction so admin-side edits are caught at write
// time.
//
// Rules:
//   - Store payment methods come only from
//     `settings/hotelConfig.paymentMethods[]`.
//   - `showInStore !== false` controls store visibility.
//   - `isEnabled` is the regular-booking toggle and does not hide
//     a method from the store. This lets `cod` / `add-to-bill` be
//     store-only methods with `isEnabled: false`.
//   - `pay-at-hotel` is excluded from the in-room store; the
//     `add-to-bill` method is the folio/check-out option.
export function getEffectiveStorePaymentMethods(
  paymentMethods: Array<StorePaymentMethodLike & { method: string; label: string; isEnabled?: boolean }> | null | undefined
): EffectiveStorePaymentMethod[] {
  const safePaymentMethods = Array.isArray(paymentMethods) ? paymentMethods : [];

  // Per #111 (per-method surface toggles): `showInStore`
  // defaults to true for legacy entries that predate the flag.
  const isVisibleInStore = (m: StorePaymentMethodLike) => m.showInStore !== false;

  return safePaymentMethods
    .filter(
      (m) =>
        m &&
        typeof m.method === "string" &&
        m.method !== "pay-at-hotel" &&
        isVisibleInStore(m)
    )
    .map((m) => ({
      method: m.method,
      label: m.label || m.method,
      isEnabled: true,
      source: "payment" as const,
      qrUrl: m.qrUrl,
      accountInfo: m.accountInfo,
      accountName: m.accountName,
      accountNumber: m.accountNumber
    }));
}
