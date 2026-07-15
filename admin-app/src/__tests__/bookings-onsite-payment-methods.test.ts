import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("BookingsPage onsite payments", () => {
  it("sources Record Onsite Payment methods from Settings paymentMethods", () => {
    expect(bookingsPageSrc).toMatch(/paymentMethods/);
    expect(bookingsPageSrc).toMatch(/useAdmin\(\)/);
    expect(bookingsPageSrc).toMatch(/const\s+onsitePaymentMethodOptions\s*=\s*useMemo/);
    expect(bookingsPageSrc).toMatch(/paymentMethods\.filter/);
    expect(bookingsPageSrc).toMatch(/onsitePaymentMethodOptions\.map\(\(/);
  });

  it("keeps non-tender methods (store rails + pay-at-hotel intent) out of the onsite selector", () => {
    expect(bookingsPageSrc).toMatch(/NON_TENDER_ONSITE_PAYMENT_METHODS\s*=\s*new Set\(\["cod",\s*"add-to-bill",\s*"pay-at-hotel"\]\)/);
    expect(bookingsPageSrc).toMatch(/!NON_TENDER_ONSITE_PAYMENT_METHODS\.has\(key\)/);
  });

  it("falls back to the legacy onsite methods only when no Settings methods exist", () => {
    expect(bookingsPageSrc).toMatch(/LEGACY_ONSITE_PAYMENT_METHOD_OPTIONS/);
    expect(bookingsPageSrc).toMatch(/configured\.length\s*>\s*0\s*\?\s*configured\s*:\s*LEGACY_ONSITE_PAYMENT_METHOD_OPTIONS/);
  });

  it("guarantees Cash is always a selectable onsite tender", () => {
    expect(bookingsPageSrc).toMatch(/CASH_ONSITE_PAYMENT_METHOD/);
    expect(bookingsPageSrc).toMatch(/hasCash\s*\?\s*base\s*:\s*\[CASH_ONSITE_PAYMENT_METHOD,\s*\.\.\.base\]/);
  });
});
