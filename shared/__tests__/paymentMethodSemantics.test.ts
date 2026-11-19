import { describe, expect, it } from "vitest";
import {
  SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS,
  isOnlinePaymentMethod,
  isSettleAtPropertyPaymentMethod,
  normalizePaymentMethodKey
} from "../utils/paymentMethodSemantics";

// Per 2026-11-19 (decision #318): the ONE rule for "does the guest
// owe money now?".
//
// THE DEFECT THIS FILE EXISTS TO PIN
// ---------------------------------
// The rule used to be an ALLOWLIST of method keys (`["gcash",
// "bank"]`) inside the guest confirmation helper. An allowlist of
// method keys cannot survive admin-configured methods: the live
// deployment keys its bank transfer as `bpi` (label "Bank Transfer"),
// so `bpi` fell into the "not online" bucket and the confirmation
// page told a guest who had ALREADY uploaded a bank-transfer receipt
// that nothing is due now — while the same booking's email said the
// uploaded proof was queued for verification.
//
// The rule is now a settle-at-the-property LIST, and every other key
// is online. These tests pin BOTH halves: the list must keep the
// platform's internal methods, and an unknown/custom key must be
// online (the direction that collects the money).

describe("payment method semantics — normalization", () => {
  it("trims and lowercases, because the key arrives as a URL param", () => {
    expect(normalizePaymentMethodKey("  GCash ")).toBe("gcash");
    expect(normalizePaymentMethodKey("BPI")).toBe("bpi");
  });

  it("treats a non-string as no key at all", () => {
    expect(normalizePaymentMethodKey(null)).toBe("");
    expect(normalizePaymentMethodKey(undefined)).toBe("");
  });
});

describe("payment method semantics — settled at the property", () => {
  it("lists the platform's internal methods", () => {
    expect(SETTLE_AT_PROPERTY_PAYMENT_METHOD_KEYS).toEqual(
      expect.arrayContaining(["pay-at-hotel", "cash", "cod", "add-to-bill"])
    );
  });

  it("classifies the settle-at-the-property methods", () => {
    for (const key of ["pay-at-hotel", "cash", "cod", "add-to-bill"]) {
      expect(isSettleAtPropertyPaymentMethod(key)).toBe(true);
      expect(isOnlinePaymentMethod(key)).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isSettleAtPropertyPaymentMethod(" Pay-At-Hotel ")).toBe(true);
    expect(isSettleAtPropertyPaymentMethod("CASH")).toBe(true);
  });
});

describe("payment method semantics — online methods", () => {
  it("treats the platform's canonical online methods as online", () => {
    for (const key of ["gcash", "maya", "paypal", "card", "bank"]) {
      expect(isOnlinePaymentMethod(key)).toBe(true);
    }
  });

  it("treats a CUSTOM admin method key as online — the production regression", () => {
    // `bpi` is the live deployment's key for "Bank Transfer". Before
    // the fix it was classified as "not online", so the confirmation
    // page said "Pay at the property" for a method whose receipt the
    // hotel was waiting for.
    expect(isOnlinePaymentMethod("bpi")).toBe(true);
    expect(isSettleAtPropertyPaymentMethod("bpi")).toBe(false);

    // Any other key the admin invents behaves the same way.
    for (const key of ["pesonet", "credit-card", "crypto", "whatever-next-year"]) {
      expect(isOnlinePaymentMethod(key)).toBe(true);
    }
  });

  it("defaults an UNKNOWN key to online, never to 'nothing is owed'", () => {
    // Deliberate: the two possible mistakes are not symmetric. Telling
    // a guest who must pay that nothing is owed loses the money;
    // asking a guest who already paid for a receipt is recoverable.
    expect(isOnlinePaymentMethod("hotel")).toBe(true);
    expect(isSettleAtPropertyPaymentMethod("hotel")).toBe(false);
  });

  it("treats an EMPTY key as neither — there is no method to pay with", () => {
    expect(isOnlinePaymentMethod("")).toBe(false);
    expect(isOnlinePaymentMethod("   ")).toBe(false);
    expect(isSettleAtPropertyPaymentMethod("")).toBe(false);
    expect(isOnlinePaymentMethod(null)).toBe(false);
    expect(isOnlinePaymentMethod(undefined)).toBe(false);
  });
});
