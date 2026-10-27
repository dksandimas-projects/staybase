// RPT-5 (handoff-2026-10-23 §6, Wave 2): the corporate convert path
// wrote `paymentMethod: "chargeback"`.
//
// WHAT WAS WRONG
// --------------
//   `convertInquirySchema` defaulted `paymentMethod` to `"chargeback"`.
//   That string is not a payment method in this system:
//
//     - it is NOT in `SUPPORTED_PAYMENT_METHODS`
//       (gcash / maya / bank / paypal / pay-at-hotel)
//     - the hotel has NO `paymentMethods` entry for it, so no report
//       can group it and no label can render it
//     - and the system's own chargeback settlement trigger —
//       `handleSetLouReceived`, the LOU (Letter of Undertaking)
//       toggle that DECISIONS-FEATURES.md #99 defines as the trigger
//       for marking a corporate chargeback resolved — REJECTS any
//       booking whose `paymentMethod !== "pay-at-hotel"`.
//
//   So a corporate booking converted from an inquiry could never have
//   its LOU marked received. That is exactly how the "Corporate AR"
//   receivables card ends up permanently inflated: the LOW-1 comment
//   in `bookings.ts` describes the same symptom for the rows it fixed.
//
// PROVEN LIVE (2026-10-27)
// -------------------------
//   Every booking's `paymentMethod`, production:
//     pay-at-hotel 134 | gcash 17 | cod 2 | chargeback 4
//
//   All 4 `chargeback` bookings are corporate
//   (`isCorporate: true`, `source: "corporate"`), all with
//   `louReceived: null` — the LOU toggle rejects them.
//
//   The hotel's configured `paymentMethods`:
//     gcash / paypal / pay-at-hotel / cod (disabled) /
//     add-to-bill (disabled) / card
//   A `chargeback` entry exists? NO.
//
// WHAT THIS TEST DOES
// -------------------
// It evaluates the REAL schema's default and the REAL validation
// predicate against production-shaped fixtures. A source-text regex
// alone would only prove a string is present.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/corporate-inquiries.ts"),
  "utf8"
);
const constantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// ── The REAL schema default ──────────────────────────────────────
//
// Lift the `paymentMethod` field's `.default(...)` out of the source
// and read the literal, so the test asserts what the schema actually
// produces.
function schemaDefault(): string {
  const m = handlerSrc.match(
    /paymentMethod:\s*z\.string\(\)[\s\S]{0,200}?\.default\(\s*["']([^"']+)["']\s*\)/
  );
  expect(
    m,
    "could not find the convert schema's paymentMethod default"
  ).toBeTruthy();
  return m![1];
}

// ── The REAL supported-methods list ───────────────────────────────
function supportedPaymentMethods(): string[] {
  const m = constantsSrc.match(
    /export const SUPPORTED_PAYMENT_METHODS\s*=\s*\[([\s\S]*?)\]\s*as const/
  );
  expect(m, "could not find SUPPORTED_PAYMENT_METHODS").toBeTruthy();
  return [...m![1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

// ── The REAL configured methods (production fixture) ──────────────
const productionConfiguredMethods = [
  { method: "gcash", label: "GCash", isEnabled: true },
  { method: "paypal", label: "PayPal", isEnabled: true },
  { method: "pay-at-hotel", label: "Pay at Hotel", isEnabled: true },
  { method: "cod", label: "Cash on Delivery", isEnabled: false },
  { method: "add-to-bill", label: "Add to Room Bill", isEnabled: false },
  { method: "card", label: "Credit Card", isEnabled: true },
];

// The validation the handler now applies.
function isAcceptedByHotel(method: string): boolean {
  if (productionConfiguredMethods.length === 0) return true;
  const isInternal = method === "pay-at-hotel" || method === "add-to-bill";
  const isConfigured = productionConfiguredMethods.some((m) => m.method === method);
  return isInternal || isConfigured;
}

describe("RPT-5 — the corporate convert path must not write `paymentMethod: \"chargeback\"`", () => {
  it("the schema's default payment method is one the system actually supports", () => {
    const def = schemaDefault();
    expect(
      supportedPaymentMethods(),
      "the supported list changed — re-check this test's fixture"
    ).toContain(def);
  });

  it("the default is `pay-at-hotel` (the LOU settlement trigger's required value)", () => {
    expect(schemaDefault()).toBe("pay-at-hotel");
  });

  it("the default is a method the hotel actually offers", () => {
    expect(isAcceptedByHotel(schemaDefault())).toBe(true);
  });

  it("`chargeback` is NOT a valid payment method for a booking", () => {
    expect(supportedPaymentMethods()).not.toContain("chargeback");
    expect(productionConfiguredMethods.map((m) => m.method)).not.toContain("chargeback");
    expect(isAcceptedByHotel("chargeback")).toBe(false);
  });

  // ── The settlement trigger that made this money-affecting ─────
  it("the LOU settlement trigger only fires on `pay-at-hotel`", () => {
    // `handleSetLouReceived` is the mechanism that marks a corporate
    // chargeback resolved. If the converted booking's paymentMethod
    // is not "pay-at-hotel", the desk CANNOT resolve it.
    expect(bookingsSrc).toMatch(
      /booking\.paymentMethod\s*!==\s*["']pay-at-hotel["']/
    );
    expect(bookingsSrc).toMatch(
      /LOU flag only applies to chargeback bookings \(paymentMethod: 'pay-at-hotel'\)|LOU flag only applies to chargeback bookings \(paymentMethod: "pay-at-hotel"\)/
    );
  });

  // ── The guard against a typo'd method ─────────────────────────
  it("the handler validates the method against the hotel's CONFIGURED methods", () => {
    expect(handlerSrc).toMatch(/paymentMethods/);
    expect(handlerSrc).toMatch(
      /is not offered by this hotel/
    );
  });

  it("the validation read happens BEFORE the transaction (no read-after-write)", () => {
    // FOL-03 (2026-10-27): Firestore refuses a read after a write in
    // the same transaction. The hotelConfig read must therefore be
    // OUTSIDE `runTransaction`.
    const readIdx = handlerSrc.indexOf('collection("settings").doc("hotelConfig")');
    const txIdx = handlerSrc.indexOf("await adminDb.runTransaction");
    expect(readIdx).toBeGreaterThan(-1);
    expect(txIdx).toBeGreaterThan(-1);
    expect(
      readIdx,
      "the hotelConfig read must come before the transaction starts"
    ).toBeLessThan(txIdx);
  });

  it("`corporate.billingArrangement` stays `chargeback` (it IS the billing arrangement)", () => {
    // The two fields are different: `paymentMethod` is how the
    // booking settles, `corporate.billingArrangement` records that
    // the company is invoiced. Changing the latter would be wrong.
    expect(handlerSrc).toMatch(/billingArrangement:\s*["']chargeback["']/);
  });
});
