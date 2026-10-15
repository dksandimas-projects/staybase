// MBUX-13 (decision #266, 2026-10-16) — the "Have a voucher,
// points, or discount?" disclosure moved from BELOW the payment
// proof upload to ABOVE the payment method card on Step 4. On
// mobile the pre-MBUX-13 order put the "Click to upload receipt
// photo" button BEFORE the disclosure, so a guest who already
// sent payment via QR + uploaded the receipt had nothing to gain
// by then opening the disclosure. The fix puts the disclosure
// FIRST so the guest sees "you might have a discount / voucher"
// BEFORE they commit to "sending payment".
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. The visual
// acceptance (does the disclosure sit above the upload on a
// 375px phone) is the MBUX-10 manual browser pass when the
// owner confirms the Firebase env.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

// Strip JS comments so a negative regex about CODE cannot be
// tripped by prose in a doc comment. The MBUX-13 rationale block
// at the new disclosure site references the pre-MBUX-13 order
// for context, so the doc-comment prose must not accidentally
// satisfy a negative regex about WHERE the disclosure sits.
// Same pattern as `mbux-01-booking-shell.test.ts` +
// `mbux-12-breakfast-menu-grid.test.ts`.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const bookingPageCode = stripComments(bookingPageSrc);

describe("MBUX-13 — savings disclosure sits ABOVE the payment method card on Step 4", () => {
  // ── The disclosure comes before the payment method card ───
  //
  // The pre-MBUX-13 order put the upload BEFORE the disclosure
  // (and the payment method card BEFORE both). The fix reverses
  // only the disclosure vs. payment-method relationship — the
  // disclosure now sits immediately above the payment method
  // card, so the guest sees "you might have a discount" before
  // picking a payment method at all.

  it("the optional-savings <details> appears BEFORE the 'Payment Method' card in the source order", () => {
    const disclosureIdx = bookingPageCode.indexOf('data-testid="optional-savings-disclosure"');
    const paymentMethodIdx = bookingPageCode.indexOf("Payment Method");
    expect(disclosureIdx, "the disclosure must exist").toBeGreaterThan(-1);
    expect(paymentMethodIdx, "the Payment Method card must exist").toBeGreaterThan(-1);
    expect(
      disclosureIdx,
      "the disclosure must precede the Payment Method card so guests see it before committing to a payment method"
    ).toBeLessThan(paymentMethodIdx);
  });

  it("the optional-savings <details> appears BEFORE the 'Click to upload receipt photo' upload in the source order", () => {
    // The user's specific complaint was that the upload button
    // sat above the disclosure. Pin that the upload now follows
    // the disclosure, not the other way around.
    const disclosureIdx = bookingPageCode.indexOf('data-testid="optional-savings-disclosure"');
    const uploadIdx = bookingPageCode.indexOf("Click to upload receipt photo");
    expect(disclosureIdx).toBeGreaterThan(-1);
    expect(uploadIdx, "the payment proof upload button must still exist").toBeGreaterThan(-1);
    expect(
      disclosureIdx,
      "the disclosure must precede the payment proof upload (was the pre-MBUX-13 reverse)"
    ).toBeLessThan(uploadIdx);
  });

  // ── The disclosure's structure is preserved ───────────────
  //
  // MBUX-13 only reorders the placement; the collapse-vs-expand
  // state, the testids, the summary header, the inner content
  // (voucher / points / Senior-PWD picker / ID upload), and the
  // `appliedSavingsLabels` line all stay. Pin them so a future
  // refactor that drifts the shape is caught here.

  it("the disclosure still carries the same `data-testid=\"optional-savings-disclosure\"` for the test surface", () => {
    expect(bookingPageSrc).toMatch(/<details[\s\S]+?data-testid="optional-savings-disclosure"/);
  });

  it("the disclosure's `<summary>` still carries `data-testid=\"optional-savings-summary\"` and the 'Have a voucher, points, or discount?' header text", () => {
    expect(bookingPageSrc).toMatch(/<summary[\s\S]+?data-testid="optional-savings-summary"/);
    expect(bookingPageSrc).toMatch(/Have a voucher, points, or discount\?/);
  });

  it("the disclosure's `<details>` carries an `open` attribute (MBUX-14: expanded by default)", () => {
    // Per MBUX-14 (decision #267, 2026-10-16): the disclosure is
    // open by default so guests see the voucher / points /
    // Senior-PWD options before committing to a payment path.
    // MBUX-13 deferred this state change (it was a placement
    // slice only); MBUX-14 picks up the deferred flip. A future
    // edit that REMOVES `open` must be a deliberate decision
    // entry, not a silent change.
    //
    // Anchor the regex at the <details> opening tag whose
    // CLOSING tag ends at the disclosure's testid. The
    // bookingPage has multiple <details> (the hold-countdown
    // banner at L2305, the optional-savings disclosure at
    // L3126, the cancellation policy at L3622), so a naive
    // `<details[\s\S]+?data-testid="optional-savings-disclosure"`
    // regex with non-greedy `[\s\S]+?` matches from the FIRST
    // <details> to the disclosure's testid — openingTag would
    // include the wrong start. Anchor to the LAST <details>
    // before the testid instead.
    const testidIdx = bookingPageCode.indexOf('data-testid="optional-savings-disclosure"');
    const tagStart = bookingPageCode.lastIndexOf("<details", testidIdx);
    const tagEnd = bookingPageCode.indexOf(">", testidIdx);
    const openingTag = bookingPageCode.slice(tagStart, tagEnd);
    expect(openingTag, "the disclosure <details> opening tag must carry an `open` attribute (MBUX-14)").toMatch(/\sopen(\s|=|\/>)/);
  });

  it("the disclosure still renders the 'Applied:' line for guests who applied a voucher/points/discount (data-testid=\"optional-savings-applied\")", () => {
    expect(bookingPageSrc).toMatch(/data-testid="optional-savings-applied"/);
  });

  it("the disclosure still contains the Voucher or Promo Code card (voucher input flow unchanged)", () => {
    expect(bookingPageSrc).toMatch(/Voucher or Promo Code/);
    expect(bookingPageSrc).toMatch(/id="voucherCode"/);
  });

  it("the disclosure still contains the Apply Your Points card (gated by memberSelfRedeemEnabled + memberAvailablePoints > 0)", () => {
    expect(bookingPageSrc).toMatch(/Apply Your Points/);
  });

  it("the disclosure still contains the Discount Options card with the Senior/PWD picker + ID upload (gated by seniorPwdOnlineEnabled)", () => {
    expect(bookingPageSrc).toMatch(/Discount Options/);
    // The discount-type testid is built from a template literal:
    // `data-testid={\`guest-discount-type-${type}\`}`. Pin the
    // pre-MBUX-13 wrapper className so a future refactor that
    // re-labels the testid must also update the test.
    expect(bookingPageSrc).toMatch(/data-testid=\{`guest-discount-type-\$\{type\}`\}/);
    expect(bookingPageSrc).toMatch(/id="discountIdFile"/);
  });

  // ── The MBUX-13 rationale comment is in place ─────────────
  //
  // A future refactor that reorders the disclosure without
  // understanding the rationale (or that reverts to the
  // pre-MBUX-13 placement) should trip here.

  it("the new disclosure site carries a comment that explains the MBUX-13 placement rationale", () => {
    // The MBUX-13 comment must appear in the file and reference
    // the move (ABOVE the payment method card, was BELOW the
    // payment proof upload). The actual comment wraps "payment
    // proof upload" across a line break, so the regex uses [\s\S]
    // (with a generous window) between "payment proof" and "upload".
    expect(bookingPageSrc).toMatch(/Per MBUX-13[\s\S]+?ABOVE the[\s\S]+?payment method card/);
    expect(bookingPageSrc).toMatch(/was BELOW the[\s\S]+?payment proof[\s\S]+?upload/);
  });

  // ── The disclosure count is still 1 ───────────────────────
  //
  // Exactly one disclosure with this testid — a future edit that
  // accidentally duplicates the block during the reorder would
  // leave two disclosures visible at once.

  it("there is exactly one `optional-savings-disclosure` in the source (no accidental duplication)", () => {
    const matches = bookingPageCode.match(/data-testid="optional-savings-disclosure"/g);
    expect(matches, "the testid must appear exactly once").not.toBeNull();
    expect(matches?.length).toBe(1);
  });

  // ── The MBUX-07 test surface still pins the disclosure ─────
  //
  // The pre-MBUX-13 source-text pin in `mbux-07-step-4-review.test.ts`
  // asserts the disclosure exists and carries the same shape.
  // That test must continue to pass post-reorder. We pin the
  // absence of a regressive change here by asserting the
  // assertions the MBUX-07 test relies on are still satisfiable.

  it("the disclosure carries the same outer wrapper className that the MBUX-07 test pins (rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6)", () => {
    // The className can be on the same line OR on a later
    // line (multi-line tag formatting per MBUX-14's added
    // rationale comment + per the MBUX-14 `open` attribute).
    // Anchor to the disclosure testid and read the opening
    // tag directly.
    const testidIdx = bookingPageSrc.indexOf('data-testid="optional-savings-disclosure"');
    const tagStart = bookingPageSrc.lastIndexOf("<details", testidIdx);
    const tagEnd = bookingPageSrc.indexOf(">", testidIdx);
    const openingTag = bookingPageSrc.slice(tagStart, tagEnd);
    expect(openingTag).toMatch(/className="group rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"/);
  });

  it("the disclosure's `<summary>` carries the same flex/min-h-11/list-none styling the MBUX-07 test pins", () => {
    expect(bookingPageSrc).toMatch(
      /<summary\s+className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold text-gray-950"/
    );
  });
});