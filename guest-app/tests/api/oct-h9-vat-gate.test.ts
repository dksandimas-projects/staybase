// Per OCT-H9 (2026-10-20, decision #283): the guest booking page
// showed an ungated 12% VAT breakdown.
//
// THE BUG
//
// The admin app's Tax (VAT) toggle (`settings/hotelConfig.vatConfig`
// → `enabled`) decides whether the guest surfaces render the 12%
// VAT reconciliation at all. `PriceBreakdown.tsx` consulted
// `isVatEnabled(vatConfig)` — but the pre-submission LIVE PREVIEW
// inside `BookingReviewAside` (the sticky summary on the booking
// page) did NOT. A VAT-exempt hotel still saw a "VAT (12%)" line
// and a "Total incl. VAT" figure on its own booking page.
//
// THE FIX
//
// The aside now takes a `vatEnabled` prop (threaded from
// `BookingPage`, which owns the `usePublicSiteContent()`
// subscription) and gates the VAT block on it — the same helper
// `PriceBreakdown.tsx` uses, with the same BIR-compliant default
// (`true` when the snapshot is missing).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);
const priceBreakdownSrc = readFileSync(
  resolve(__dirname, "../../src/components/PriceBreakdown.tsx"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const bookingPage = codeOnly(bookingPageSrc);
const priceBreakdown = codeOnly(priceBreakdownSrc);

describe("OCT-H9 — the guest VAT surfaces are gated on the admin's Tax toggle", () => {
  it("the booking page reads the VAT config from the settings hook", () => {
    expect(bookingPage).toMatch(
      /const \{[^}]*vatConfig[^}]*\} = usePublicSiteContent\(\);/
    );
  });

  it("the booking page resolves the toggle with the shared helper", () => {
    expect(bookingPageSrc).toMatch(/isVatEnabled/);
    expect(bookingPage).toMatch(/const vatEnabled = isVatEnabled\(vatConfig\);/);
  });

  it("the VAT breakdown block is gated on `vatEnabled`", () => {
    // The block must not render the VAT lines when the toggle is
    // off. `vatRate: vatEnabled ? 0.12 : 0` keeps the math honest
    // for the sub-total either way.
    expect(bookingPage).toMatch(/\{vatEnabled \? \(\(\) => \{/);
    expect(bookingPage).toMatch(/vatRate: vatEnabled \? 0\.12 : 0/);
  });

  it("the aside receives the flag as a prop", () => {
    expect(bookingPageSrc).toMatch(/vatEnabled\?: boolean;/);
    expect(bookingPage).toMatch(/vatEnabled = true/);
    // Every `BookingReviewAside` call site passes it.
    const callSites = bookingPage.match(/<BookingReviewAside/g) || [];
    expect(callSites.length).toBeGreaterThan(0);
    const propsPassed = bookingPage.match(/vatEnabled=\{vatEnabled\}/g) || [];
    expect(propsPassed.length).toBe(callSites.length);
  });

  it("the sibling `PriceBreakdown` surface uses the SAME gate (unchanged)", () => {
    expect(priceBreakdown).toMatch(/isVatEnabled\(vatConfig\)/);
  });

  it("the shared helper defaults to enabled when the snapshot is missing", () => {
    const sharedVatSrc = readFileSync(
      resolve(__dirname, "../../../shared/utils/bookingVat.ts"),
      "utf8"
    );
    expect(sharedVatSrc).toMatch(
      /export function isVatEnabled\(vatConfig: Partial<VatConfig> \| null \| undefined\): boolean/
    );
    // A missing / malformed snapshot falls back to the
    // BIR-compliant default (`enabled: true`).
    expect(sharedVatSrc).toMatch(
      /if \(!vatConfig \|\| typeof vatConfig\.enabled !== "boolean"\) return DEFAULT_VAT_CONFIG\.enabled;/
    );
  });
});
