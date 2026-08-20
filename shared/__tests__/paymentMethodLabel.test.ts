import { describe, expect, test } from "vitest";
import {
  LEGACY_PAYMENT_METHOD_LABELS,
  resolvePaymentMethodLabel
} from "../utils/paymentMethodLabel";

describe("resolvePaymentMethodLabel", () => {
  test("returns the admin-configured label when the method is in paymentMethods", () => {
    const methods = [
      { method: "gcash", label: "GCash Only (no Maya)" },
      { method: "pesonet", label: "PESONET Bank Transfer" },
      { method: "pay-at-hotel", label: "Settle at the front desk" }
    ];
    expect(resolvePaymentMethodLabel("gcash", methods)).toBe("GCash Only (no Maya)");
    expect(resolvePaymentMethodLabel("pesonet", methods)).toBe("PESONET Bank Transfer");
    expect(resolvePaymentMethodLabel("pay-at-hotel", methods)).toBe("Settle at the front desk");
  });

  test("admin label wins over the legacy map for a shared key (e.g. gcash)", () => {
    // The legacy map has `gcash: "Digital Wallet (GCash/Maya)"`. When the
    // admin renames it, the renamed label must win — that's the whole
    // point of this refactor (decision #200).
    const methods = [{ method: "gcash", label: "GCash Only" }];
    expect(resolvePaymentMethodLabel("gcash", methods)).toBe("GCash Only");
  });

  test("falls back to the legacy map when the method is not in paymentMethods", () => {
    // The legacy map covers the three method keys the booking +
    // corporate + store flows used before the dynamic
    // `hotelConfig.paymentMethods[]` array existed. A method
    // the admin has not surfaced yet falls through to the
    // legacy copy (if any) or to the raw key as a last resort.
    expect(resolvePaymentMethodLabel("gcash", [])).toBe(LEGACY_PAYMENT_METHOD_LABELS.gcash);
    expect(resolvePaymentMethodLabel("bank", [])).toBe(LEGACY_PAYMENT_METHOD_LABELS.bank);
    expect(resolvePaymentMethodLabel("pay-at-hotel", [])).toBe(LEGACY_PAYMENT_METHOD_LABELS["pay-at-hotel"]);
  });

  test("falls through to the raw method key when no admin + no legacy match", () => {
    // `paypal` is a known method key the current spark-inn
    // deployment does not surface (not in the legacy map, not
    // in paymentMethods[]) — the guest sees the raw kebab-case
    // key. Better than a blank cell, and staff can identify
    // the gap from the lookup's `paymentMethod` field.
    expect(resolvePaymentMethodLabel("paypal", [])).toBe("paypal");
    expect(resolvePaymentMethodLabel("paypal", null)).toBe("paypal");
  });

  test("falls back to the raw method key when no admin + no legacy match", () => {
    // A custom method the admin added but did not surface in
    // `paymentMethods[]` yet (data migration in flight) OR a
    // protected method whose label is intentionally blank. The
    // guest still sees the raw key, which is at least a readable
    // kebab-case slug.
    expect(resolvePaymentMethodLabel("credit-card", [])).toBe("credit-card");
    expect(resolvePaymentMethodLabel("wechat-pay", null)).toBe("wechat-pay");
  });

  test("ignores admin entries with a missing/empty label (does not poison the fallback)", () => {
    // A malformed admin entry (label accidentally cleared) must
    // NOT silently surface an empty string to the guest — the
    // helper must keep falling through to the legacy / raw key.
    const methods = [
      { method: "gcash", label: "" },
      { method: "bank" /* no label field at all */ }
    ];
    expect(resolvePaymentMethodLabel("gcash", methods)).toBe(LEGACY_PAYMENT_METHOD_LABELS.gcash);
    expect(resolvePaymentMethodLabel("bank", methods)).toBe(LEGACY_PAYMENT_METHOD_LABELS.bank);
  });

  test("returns an empty string for empty / non-string / nullish input", () => {
    expect(resolvePaymentMethodLabel("", [{ method: "gcash", label: "GCash" }])).toBe("");
    expect(resolvePaymentMethodLabel(null, [{ method: "gcash", label: "GCash" }])).toBe("");
    expect(resolvePaymentMethodLabel(undefined, [{ method: "gcash", label: "GCash" }])).toBe("");
  });

  test("ignores non-array / malformed paymentMethods input without throwing", () => {
    // Defensive: the Firestore read on `settings/hotelConfig` may
    // return the field as `undefined` (uninitialised), an object,
    // or anything else. The helper must not throw.
    expect(resolvePaymentMethodLabel("gcash", null as any)).toBe(LEGACY_PAYMENT_METHOD_LABELS.gcash);
    expect(resolvePaymentMethodLabel("gcash", undefined as any)).toBe(LEGACY_PAYMENT_METHOD_LABELS.gcash);
    expect(resolvePaymentMethodLabel("gcash", { not: "an array" } as any)).toBe(
      LEGACY_PAYMENT_METHOD_LABELS.gcash
    );
  });

  test("ignores admin entries whose `method` is not a string", () => {
    const methods = [
      { method: 123 as any, label: "numeric" },
      { method: null as any, label: "nullish" },
      { method: "gcash", label: "Valid GCash Label" }
    ];
    expect(resolvePaymentMethodLabel("gcash", methods)).toBe("Valid GCash Label");
  });
});
