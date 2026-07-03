import type { PaymentMethodConfig, StoreConfig } from "../types";

// An effective store payment method entry as rendered to the
// admin Store tab and the guest store checkout. Each entry is
// either sourced from `storeConfig.paymentMethods[]` (the
// `cod` / `add-to-bill` half, plus the legacy `gcash` half when
// the toggle is OFF) or from `hotelConfig.paymentMethods[]` (the
// inherited booking methods when the toggle is ON). The `source`
// field tells the UI which list the entry came from so it can
// render the right copy ("Configure →" link vs. inline edit) and
// the right proof-of-payment requirement (cod / add-to-bill skip
// the screenshot, every other method requires one).
export type StorePaymentMethodSource = "store" | "booking";

export interface EffectiveStorePaymentMethod {
  method: string;
  label: string;
  isEnabled: boolean;
  source: StorePaymentMethodSource;
  // Only set when the method was inherited from the booking list
  // — needed by the guest checkout to render the QR + account
  // info + screenshot upload panel. `accountInfo` is the legacy
  // `storeConfig.paymentMethods[].accountInfo` (the free-text
  // field on the `gcash` entry); `accountName` and
  // `accountNumber` come from the booking method's structured
  // fields. Both shapes are present so the UI doesn't have to
  // branch on `source`.
  qrUrl?: string;
  accountInfo?: string;
  accountName?: string;
  accountNumber?: string;
}

// Store-specific methods that are ALWAYS available in the store
// checkout, regardless of the `useBookingPaymentMethods` toggle.
// `cod` is the physical in-room cash handover; `add-to-bill`
// ties the order to a booking folio. Their `label` is read from
// `storeConfig.paymentMethods[]` so admins can rename them
// (e.g. "Cash on Delivery" → "Cash"); the QR fields on those
// entries are ignored in both toggle states.
const STORE_SPECIFIC_METHODS: ReadonlyArray<string> = ["cod", "add-to-bill"];

// Permissive input shape for the store config — the helper is
// tolerant of any `method: string` key on `paymentMethods[]`
// (matches the open-schema policy of `PaymentMethodConfig`).
// This lets the helper accept the local `StorePaymentMethodSetting`
// type used by `SettingsPage` state without forcing a
// `method: "cod" | "add-to-bill" | "gcash"` union at every
// call site.
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
  useBookingPaymentMethods?: boolean;
  paymentMethods?: StorePaymentMethodLike[];
}

// Compute the de-duped, source-tagged list of payment methods
// rendered by the admin Store tab and the guest store checkout.
// This is the single source of truth for the union logic — the
// server-side `/api/store/create-order` handler in
// `guest-app/server/handlers/store.ts` mirrors it inside the
// Firestore transaction so admin-side drift (e.g. an admin
// disabling a method) is caught at write time.
//
// Rules:
//   - When `storeConfig.useBookingPaymentMethods === false`,
//     return `storeConfig.paymentMethods[]` exactly as-is (the
//     legacy 3-method UX is preserved). Each entry's `source`
//     is `"store"`.
//   - When `storeConfig.useBookingPaymentMethods === true`,
//     return the union of:
//       (a) the `cod` and `add-to-bill` entries from
//           `storeConfig.paymentMethods[]` (their labels are
//           admin-customizable; `source: "store"`);
//       (b) every `isEnabled: true` entry from
//           `hotelConfig.paymentMethods[]` whose `method` is
//           NOT `pay-at-hotel` and NOT already in (a)
//           (`source: "booking"` — the UI shows a "Configure →"
//           link to the booking tab).
//   - Disabled entries are filtered out so the UI only shows
//     selectable methods. The `isEnabled` field is also
//     preserved on each entry for downstream consumers that
//     need it (the order-create server uses it for one final
//     validation).
export function getEffectiveStorePaymentMethods(
  storeConfig: Pick<StoreConfig, "useBookingPaymentMethods" | "paymentMethods"> | StoreConfigLike | null | undefined,
  bookingMethods: Array<StorePaymentMethodLike & { method: string; label: string; isEnabled: boolean }> | null | undefined
): EffectiveStorePaymentMethod[] {
  const storeMethods = Array.isArray(storeConfig?.paymentMethods)
    ? storeConfig!.paymentMethods
    : [];
  const useBooking = storeConfig?.useBookingPaymentMethods === true;
  const safeBookingMethods = Array.isArray(bookingMethods) ? bookingMethods : [];

  // Per #111 (per-method surface toggles): a method is only
  // eligible for the store checkout when its per-method
  // `showInStore` flag is not explicitly `false`. The field
  // defaults to `true` when missing (pre-#111 entries without
  // the flag are treated as "visible"). The store-specific
  // methods (`cod` + `add-to-bill`) are also subject to this
  // check so the admin can hide "Cash on Delivery" or "Add to
  // Bill" from the store if needed.
  const isVisibleInStore = (m: StorePaymentMethodLike) => m.showInStore !== false;

  if (!useBooking) {
    return storeMethods
      .filter(
        (m): m is StorePaymentMethodLike =>
          !!m && typeof m.method === "string" && m.isEnabled !== false && isVisibleInStore(m)
      )
      .map((m) => ({
        method: m.method,
        label: m.label || m.method,
        isEnabled: m.isEnabled !== false,
        source: "store" as const,
        qrUrl: m.qrUrl,
        accountInfo: m.accountInfo
      }));
  }

  const storeSpecificKeys = new Set<string>(STORE_SPECIFIC_METHODS);
  const storeSpecific = storeMethods
    .filter(
      (m): m is StorePaymentMethodLike =>
        !!m &&
        typeof m.method === "string" &&
        storeSpecificKeys.has(m.method) &&
        m.isEnabled !== false &&
        isVisibleInStore(m)
    )
    .map((m) => ({
      method: m.method,
      label: m.label || m.method,
      isEnabled: true,
      source: "store" as const,
      qrUrl: m.qrUrl,
      accountInfo: m.accountInfo
    }));

  const seenMethods = new Set<string>(storeSpecific.map((m) => m.method));
  const inherited = safeBookingMethods
    .filter(
      (m) =>
        m &&
        typeof m.method === "string" &&
        m.method !== "pay-at-hotel" &&
        !seenMethods.has(m.method) &&
        m.isEnabled !== false &&
        isVisibleInStore(m)
    )
    .map((m) => ({
      method: m.method,
      label: m.label || m.method,
      isEnabled: true,
      source: "booking" as const,
      qrUrl: m.qrUrl,
      accountName: m.accountName,
      accountNumber: m.accountNumber
    }));

  return [...storeSpecific, ...inherited];
}
