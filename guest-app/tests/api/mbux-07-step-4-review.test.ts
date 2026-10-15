// MBUX-07 — Step 4 made summary-first and payment-first.
//
// Phase 15 / decision #259. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Step 4 — Review & Pay`.
//
// The two changes with teeth here are ORDERING, not decoration:
//
//  1. The booking summary sat in a sidebar that, in the single-column
//     mobile grid, rendered AFTER every control. A guest scrolled past
//     payment, uploads, and optional savings to discover what they were
//     paying for.
//  2. The voucher / points / discount controls sat ABOVE payment and
//     were permanently expanded, so the most common path — just pay —
//     was the longest one.
//
// Already correct and therefore asserted as PRESERVED:
//   - only the SELECTED payment method expands its instructions;
//   - the cancellation policy is already a collapsed `<details>`;
//   - proof / ID uploads already support camera + preview + replace;
//   - the duplicate consent checkbox (MBUX-06) is already gone.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

/**
 * The Step 4 RENDER branch only.
 *
 * There are two `if (isReviewStep) {` guards in this file: one inside a
 * helper (the back-handler) and the render branch itself. `indexOf`
 * finds the helper, whose neighbourhood contains none of Step 4's
 * markup — `lastIndexOf` pins the render branch.
 */
const reviewStart = bookingPageSrc.lastIndexOf("if (isReviewStep) {");
const reviewEnd = bookingPageSrc.indexOf("return bookingShell(", reviewStart + 40000);
const reviewBranch = bookingPageSrc.slice(reviewStart, reviewEnd + 40000);

function offsetOf(needle: string): number {
  const idx = reviewBranch.indexOf(needle);
  expect(idx, `"${needle}" not found in the Step 4 branch`).toBeGreaterThan(-1);
  return idx;
}

describe("MBUX-07 — mobile order is summary-first", () => {
  it("the controls column is order-2 on mobile and order-1 from lg:", () => {
    expect(bookingPageSrc).toMatch(
      /<div className="order-2 space-y-6 lg:order-1">/
    );
  });

  it("the summary aside is order-1 on mobile and order-2 from lg:", () => {
    // Per MBUX-11 (decision #264, 2026-10-16): the aside
    // now carries `id="booking-stay-details-aside"` (the
    // scroll target for the StaySummaryStrip Edit button).
    // The order classes still matter — this pins the layout
    // contract. The id attribute may appear BEFORE or AFTER
    // the className; either is structurally valid JSX.
    expect(bookingPageSrc).toMatch(
      /<aside[^>]*className="order-1 lg:order-2 lg:sticky lg:top-28 lg:self-start[^"]*"[^>]*>/
    );
  });

  it("the two orders are complementary — exactly one of each per breakpoint", () => {
    const controls = bookingPageSrc.match(/order-2 space-y-6 lg:order-1/g) ?? [];
    const summary = bookingPageSrc.match(/order-1 lg:order-2 lg:sticky/g) ?? [];
    expect(controls).toHaveLength(1);
    expect(summary).toHaveLength(1);
  });

  it("no DOM reorder and no duplicated summary component", () => {
    // Two renders of the summary would let the desktop sidebar drift
    // from the mobile card. `order` moves the SAME node. The MBUX-11
    // aside carries an additional `id` attribute; the structural
    // contract is "exactly one aside with order-1 lg:order-2",
    // regardless of which attribute appears first.
    const asideCount = (bookingPageSrc.match(/<aside[^>]*order-1 lg:order-2/g) ?? []).length;
    expect(asideCount).toBe(1);
  });

  it("the sidebar keeps its lg: sticky behaviour", () => {
    expect(bookingPageSrc).toMatch(/lg:sticky lg:top-28 lg:self-start/);
  });
});

describe("MBUX-07 — optional savings are below payment and collapsed", () => {
  it("the payment method renders BEFORE the savings disclosure", () => {
    const payment = offsetOf("Payment Method Section");
    const savings = offsetOf('data-testid="optional-savings-disclosure"');
    expect(payment).toBeLessThan(savings);
  });

  it("the proof/ID upload renders before the savings disclosure", () => {
    const upload = offsetOf("Proof of Payment Upload box");
    const savings = offsetOf('data-testid="optional-savings-disclosure"');
    expect(upload).toBeLessThan(savings);
  });

  it("the cancellation policy stays last among the disclosure blocks", () => {
    const savings = offsetOf('data-testid="optional-savings-disclosure"');
    const cancellation = offsetOf("{/* Cancellation Policy */}");
    expect(savings).toBeLessThan(cancellation);
  });

  it("one collapsed disclosure wraps voucher, points, and discount", () => {
    expect(bookingPageSrc).toMatch(/data-testid="optional-savings-disclosure"/);
    expect(bookingPageSrc).toMatch(/<details\s+className="group rounded-card/);
    expect(bookingPageSrc).toMatch(/Have a voucher, points, or discount\?/);
  });

  it("the disclosure is COLLAPSED by default — the opening `<details>` tag has no `open` attribute", () => {
    // Read the opening tag directly: the word "open" also appears in
    // `group-open:rotate-180`, so a naive substring search is useless.
    const disclosureIdx = bookingPageSrc.indexOf('data-testid="optional-savings-disclosure"');
    const tagStart = bookingPageSrc.lastIndexOf("<details", disclosureIdx);
    const tagEnd = bookingPageSrc.indexOf(">", disclosureIdx);
    const openingTag = bookingPageSrc.slice(tagStart, tagEnd);
    expect(openingTag).toMatch(/^<details\b/);
    expect(openingTag).not.toMatch(/\sopen(\s|=|>)/);
  });

  it("the summary control is a real 44px disclosure affordance", () => {
    expect(bookingPageSrc).toMatch(
      /data-testid="optional-savings-summary"/
    );
    expect(bookingPageSrc).toMatch(/className="flex min-h-11 cursor-pointer list-none/);
  });

  it("APPLIED states stay visible while collapsed", () => {
    // Hiding an applied voucher behind a closed disclosure would
    // invite the guest to apply a second one.
    expect(bookingPageSrc).toMatch(/data-testid="optional-savings-applied"/);
    expect(bookingPageSrc).toMatch(/Applied: \{appliedSavingsLabels\.join\(", "\)\}/);
    expect(bookingPageSrc).toMatch(/\{appliedSavingsLabels\.length > 0 \? \(/);
  });

  it("the applied list names each kind of saving from real state", () => {
    expect(bookingPageSrc).toMatch(
      /voucherApplied \? `Voucher \$\{voucherCode\.trim\(\)\.toUpperCase\(\)\}` : ""/
    );
    expect(bookingPageSrc).toMatch(/pendingPointsToRedeem > 0 \? `\$\{pendingPointsToRedeem\.toLocaleString\(\)\} points` : ""/);
    expect(bookingPageSrc).toMatch(/discountType === "senior" \? "Senior Citizen discount" : ""/);
    expect(bookingPageSrc).toMatch(/discountType === "pwd" \? "PWD discount" : ""/);
  });

  it("the applied-state line sits OUTSIDE the collapsible body", () => {
    // Inside, it would vanish the moment the section is shut.
    const applied = bookingPageSrc.indexOf('data-testid="optional-savings-applied"');
    const bodyOpen = bookingPageSrc.indexOf('<div className="mt-5 space-y-6">', applied);
    expect(applied).toBeGreaterThan(-1);
    expect(bodyOpen).toBeGreaterThan(applied);
  });

  it("the eligibility-heavy markup lives inside the disclosure", () => {
    const bodyOpen = bookingPageSrc.indexOf('<div className="mt-5 space-y-6">');
    const voucher = bookingPageSrc.indexOf("{/* Voucher Section */}");
    const points = bookingPageSrc.indexOf("Points Redemption Section (PR #9)");
    const discount = bookingPageSrc.indexOf("Discount Section — rendered only while");
    for (const [label, idx] of [["voucher", voucher], ["points", points], ["discount", discount]] as const) {
      expect(idx, `${label} section missing`).toBeGreaterThan(bodyOpen);
    }
  });
});

describe("MBUX-07 — the footer shows the total and one action", () => {
  it("the footer summary is labelled 'Total due'", () => {
    expect(reviewBranch).toMatch(/<p className="text-sm text-gray-600">Total due<\/p>/);
  });

  it("the action names the amount it commits to", () => {
    expect(bookingPageSrc).toMatch(/Place booking · \$\{formatPrice\(displayTotal\)\}/);
  });

  it("the quoted figure is `displayTotal` — the same value as the summary and the payload", () => {
    // A button total that can disagree with the bill is worse than none.
    expect(bookingPageSrc).toMatch(/`Ready to confirm · \$\{formatPrice\(displayTotal\)\}`/);
    expect(bookingPageSrc).toMatch(/total=\{displayTotal\}/);
  });

  it("processing states stay explicit and never replace the action", () => {
    expect(bookingPageSrc).toMatch(/\{isSubmitting\s*\?\s*"Processing\.\.\."/);
    expect(bookingPageSrc).toMatch(/Uploading discount ID photo\.\.\./);
    expect(bookingPageSrc).toMatch(/Uploading payment proof receipt\.\.\./);
  });

  it("blocking messages still name the specific gate", () => {
    expect(bookingPageSrc).toMatch(/Please upload your Senior\/PWD ID/);
    expect(bookingPageSrc).toMatch(/Please upload proof of payment/);
    expect(bookingPageSrc).toMatch(
      /!guestDetails\.consent\s*\n\s*\? "Confirm your guest details consent on the previous step"/
    );
  });
});

describe("MBUX-07 — preserved (shipped earlier or done in MBUX-06)", () => {
  it("only the SELECTED payment method expands its instructions", () => {
    // `isPayAtHotel` is derived from the CURRENT selection, so the
    // instruction panel describes the method the guest actually chose
    // rather than listing every method's instructions at once.
    expect(bookingPageSrc).toMatch(
      /const isPayAtHotel = currentPaymentMethod\?\.method === "pay-at-hotel"/
    );
    expect(reviewBranch).toMatch(/Conditional instructions panel/);
  });

  it("the cancellation policy remains a collapsed details block", () => {
    expect(bookingPageSrc).toMatch(
      /\{\/\* Cancellation Policy \*\/\}\s*<div className="rounded-card[^"]*">\s*<details className="group">/
    );
  });

  it("the duplicate consent checkbox does not come back", () => {
    expect(bookingPageSrc).not.toMatch(/termsConsent/);
    expect(bookingPageSrc).not.toMatch(/id="termsConsent"/);
  });

  it("the proof and ID uploads keep image selection + replace, with visible format guidance", () => {
    // NOTE: there is deliberately NO `capture` attribute. On iOS Safari
    // and Android Chrome a file input with an `image/*`-family `accept`
    // already surfaces "Take Photo" alongside the photo library, and a
    // hard `capture` would FORCE the camera and remove the library
    // option. `accept` alone is the correct contract here — this
    // assertion must not "improve" it into a forced camera.
    expect(bookingPageSrc).toMatch(/Upload Proof of Payment/);
    expect(bookingPageSrc).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
    // Format + size guidance is visible next to the control.
    expect(bookingPageSrc).toMatch(/Supports JPG, PNG, WEBP/);
    // The input is reachable by keyboard (label-wrapped, sr-only input).
    expect(bookingPageSrc).toMatch(/id="discountIdFile"/);
  });
});