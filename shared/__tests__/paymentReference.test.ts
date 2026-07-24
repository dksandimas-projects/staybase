import { describe, expect, test } from "vitest";
import { getLatestPaymentReference } from "../utils/paymentReference";

describe("getLatestPaymentReference", () => {
  test("returns null when booking has no onsite payments", () => {
    expect(getLatestPaymentReference({ onsitePayments: [] })).toBeNull();
    expect(getLatestPaymentReference({ onsitePayments: undefined })).toBeNull();
    expect(getLatestPaymentReference({ onsitePayments: null })).toBeNull();
    expect(getLatestPaymentReference({})).toBeNull();
  });

  test("returns null when booking is null or undefined", () => {
    expect(getLatestPaymentReference(null)).toBeNull();
    expect(getLatestPaymentReference(undefined)).toBeNull();
  });

  test("returns null when every entry has an empty reference", () => {
    expect(getLatestPaymentReference({
      onsitePayments: [
        { transactionReference: null },
        { transactionReference: "" },
        { transactionReference: undefined },
        { transactionReference: "   " }
      ]
    })).toBeNull();
  });

  test("returns the only reference when one payment is recorded", () => {
    expect(getLatestPaymentReference({
      onsitePayments: [{ transactionReference: "GCASH-001" }]
    })).toBe("GCASH-001");
  });

  test("returns the most recent non-empty reference across multiple entries", () => {
    // Per 2026-07-24: "latest" wins because the most recent
    // entry reflects the current state. Older blank entries
    // must not block the lookup.
    expect(getLatestPaymentReference({
      onsitePayments: [
        { transactionReference: "GCASH-001" },
        { transactionReference: "" },
        { transactionReference: null },
        { transactionReference: "BANK-VRF-002" },
        { transactionReference: "CASH-003" }
      ]
    })).toBe("CASH-003");
  });

  test("ignores trailing blank entries and falls back to the most recent valid one", () => {
    expect(getLatestPaymentReference({
      onsitePayments: [
        { transactionReference: "GCASH-001" },
        { transactionReference: "BANK-VRF-002" },
        { transactionReference: "" },
        { transactionReference: null }
      ]
    })).toBe("BANK-VRF-002");
  });

  test("trims whitespace when comparing emptiness (but returns the raw value)", () => {
    // The helper returns the reference exactly as stored;
    // it only checks that the trimmed value is non-empty.
    expect(getLatestPaymentReference({
      onsitePayments: [{ transactionReference: "  GCASH-001  " }]
    })).toBe("  GCASH-001  ");
  });
});
