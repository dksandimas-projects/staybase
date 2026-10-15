// MBUX-14 (decision #267, 2026-10-16) — `Have a voucher, points,
// or discount?` disclosure is OPEN by default on Step 4. The
// pre-MBUX-14 / pre-MBUX-13 / MBUX-07 (decision #259) state was
// collapsed-by-default; MBUX-14 flips the state without
// changing the placement (MBUX-13 handled the placement).
//
// Why this slice exists: on mobile the guest had to tap the
// "Have a voucher, points, or discount?" disclosure to even
// SEE the voucher / points / Senior-PWD options. A guest in a
// hurry would submit the booking without realizing a discount
// was available. The MBUX-13 slice moved the disclosure ABOVE
// the payment method card (so it sits before the "commit to a
// payment path" moment) but kept the collapsed state — the
// owner review asked for it to be open by default too. This
// is the deferred state flip from MBUX-13.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach the MBUX-* / BR-* / DR-01 suites use. These tests
// pin the SHAPE (the `<details>` opening tag carries an `open`
// attribute, the inner content stays the same, the disclosure
// still wraps voucher / points / discount + ID upload), not
// the pixels; the visual acceptance (does the disclosure look
// open on a 375px phone) is the MBUX-10 manual browser pass.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-14 — savings disclosure is open by default on Step 4", () => {
  // ── Anchor helpers ─────────────────────────────────────────
  //
  // The bookingPage has multiple `<details>` (the hold-countdown
  // banner at L2305, the optional-savings disclosure at L3126,
  // the cancellation policy at L3622). The non-greedy regex
  // `<details[\s\S]+?data-testid="optional-savings-disclosure"`
  // would match from the FIRST `<details>` to the disclosure's
  // testid, producing an openingTag that includes the wrong
  // start. Anchor the regex to the LAST `<details>` BEFORE the
  // testid — that is the disclosure's opening tag.

  function disclosureOpeningTag(): string {
    const testidIdx = bookingPageSrc.indexOf('data-testid="optional-savings-disclosure"');
    const tagStart = bookingPageSrc.lastIndexOf("<details", testidIdx);
    const tagEnd = bookingPageSrc.indexOf(">", testidIdx);
    return bookingPageSrc.slice(tagStart, tagEnd);
  }

  // ── The open attribute is present ─────────────────────────
  //
  // The pin: the opening tag carries an `open` attribute. The
  // word "open" also appears in the `group-open:rotate-180`
  // Tailwind class (on the ChevronDown chevron rotation), so
  // a naive substring search is useless. Pin the ATTRIBUTE
  // shape (`open` preceded by whitespace, followed by
  // whitespace / `=` / `>` / `/>`) so the negative space of
  // the `group-open` class doesn't satisfy the regex.

  it("the disclosure <details> opening tag carries an `open` attribute (MBUX-14)", () => {
    const openingTag = disclosureOpeningTag();
    expect(openingTag, "the disclosure <details> opening tag must be readable").toMatch(/^<details\b/);
    expect(
      openingTag,
      "the disclosure <details> opening tag must carry an `open` attribute so the disclosure renders expanded by default (MBUX-14, decision #267)"
    ).toMatch(/\sopen(\s|=|\/>)/);
  });

  // ── The rationale comment is in place ─────────────────────
  //
  // A future refactor that flips the state back without a
  // decision entry should trip here. The MBUX-14 comment must
  // reference the deferred-from-MBUX-13 decision and explain
  // why the visibility-default is now open.

  it("the disclosure site carries a comment that explains the MBUX-14 open-by-default rationale", () => {
    expect(bookingPageSrc).toMatch(/Per MBUX-14 \(decision #267, 2026-10-16\)/);
    expect(bookingPageSrc).toMatch(/OPEN by default/);
    // "MBUX-13 deferred this state change" is wrapped across
    // multiple lines in the source comment; the regex uses
    // [\s\S]+? with a tight window to match the phrase
    // across the line break.
    expect(bookingPageSrc).toMatch(/MBUX-13[\s\S]+?deferred this state change/);
  });

  // ── The disclosure's other shape is unchanged ─────────────
  //
  // MBUX-14 only flips the `open` attribute. The className, the
  // testid, the summary text, the chevron rotation, the
  // inner content (voucher / points / Senior-PWD picker /
  // ID upload) are unchanged. A future edit that drifts the
  // shape is caught here.

  it("the disclosure still carries `data-testid=\"optional-savings-disclosure\"`", () => {
    expect(bookingPageSrc).toMatch(/data-testid="optional-savings-disclosure"/);
  });

  it("the disclosure still carries the same outer wrapper className", () => {
    const openingTag = disclosureOpeningTag();
    expect(openingTag).toMatch(/className="group rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-6"/);
  });

  it("the disclosure still renders the `Have a voucher, points, or discount?` summary header text", () => {
    expect(bookingPageSrc).toMatch(/Have a voucher, points, or discount\?/);
  });

  it("the disclosure still renders the `group-open:rotate-180` chevron rotation animation (unchanged)", () => {
    // The chevron rotates when the disclosure opens (group-open
    // is a Tailwind variant that matches the `open` attribute
    // on the parent <details>). MBUX-14 only adds the
    // attribute; the animation wiring is unchanged.
    expect(bookingPageSrc).toMatch(/group-open:rotate-180/);
  });

  it("the disclosure still wraps the Voucher or Promo Code card (voucher input flow unchanged)", () => {
    expect(bookingPageSrc).toMatch(/Voucher or Promo Code/);
    expect(bookingPageSrc).toMatch(/id="voucherCode"/);
  });

  it("the disclosure still wraps the Apply Your Points card (gated by memberSelfRedeemEnabled + memberAvailablePoints > 0)", () => {
    expect(bookingPageSrc).toMatch(/Apply Your Points/);
  });

  it("the disclosure still wraps the Discount Options card with the Senior/PWD picker + ID upload (gated by seniorPwdOnlineEnabled)", () => {
    expect(bookingPageSrc).toMatch(/Discount Options/);
    expect(bookingPageSrc).toMatch(/data-testid=\{`guest-discount-type-\$\{type\}`\}/);
    expect(bookingPageSrc).toMatch(/id="discountIdFile"/);
  });

  // ── Other <details> elements on Step 4 are unaffected ─────
  //
  // The hold-countdown banner (L2305) and the cancellation
  // policy (L3622) are different disclosures. They stay in
  // their pre-MBUX-14 states (the cancellation policy is also
  // collapsed-by-default per its design). MBUX-14 must not
  // accidentally flip them open.

  it("the hold-countdown banner's `<details>` does NOT carry `open` (different disclosure, untouched by MBUX-14)", () => {
    // The hold-countdown banner sits at L2305. Its opening tag
    // is the FIRST `<details>` in the file. Pin that this tag
    // does NOT carry `open`.
    const firstTagStart = bookingPageSrc.indexOf("<details");
    const firstTagEnd = bookingPageSrc.indexOf(">", firstTagStart);
    const holdBannerTag = bookingPageSrc.slice(firstTagStart, firstTagEnd);
    expect(holdBannerTag).toMatch(/className="mt-2 group"/);
    expect(holdBannerTag, "the hold-countdown banner stays collapsed").not.toMatch(/\sopen(\s|=|\/>)/);
  });

  it("the cancellation-policy <details>'s opening tag does NOT carry `open` (different disclosure, untouched by MBUX-14)", () => {
    // The cancellation policy sits AFTER the optional-savings
    // disclosure (the testid is `{/* Cancellation Policy */}`
    // in mbux-13). The cancellation policy's <details> opens
    // AFTER the comment — use indexOf (next <details>) not
    // lastIndexOf (which would find the optional-savings
    // disclosure, the previous <details>).
    const cancellationIdx = bookingPageSrc.indexOf("{/* Cancellation Policy */}");
    const tagStart = bookingPageSrc.indexOf("<details", cancellationIdx);
    const tagEnd = bookingPageSrc.indexOf(">", tagStart);
    const cancellationTag = bookingPageSrc.slice(tagStart, tagEnd);
    expect(cancellationTag).toMatch(/className="group/);
    expect(cancellationTag, "the cancellation policy stays collapsed").not.toMatch(/\sopen(\s|=|\/>)/);
  });

  // ── The MBUX-13 + MBUX-07 cross-cutting guards remain ─────
  //
  // The pre-MBUX-14 MBUX-13 + MBUX-07 tests already pin the
  // open attribute now (after MBUX-14 flipped it). We
  // assert here that those test files exist and pin the
  // correct shape, so a future edit that drifts the cross-
  // test contract surfaces at this layer.

  it("mbux-13-savings-disclosure-above-payment.test.ts pins the open-by-default attribute (cross-test contract)", () => {
    const mbux13 = read("guest-app/tests/api/mbux-13-savings-disclosure-above-payment.test.ts");
    expect(mbux13).toMatch(/opening tag must carry an `open` attribute/);
  });

  it("mbux-07-step-4-review.test.ts pins the open-by-default attribute (cross-test contract)", () => {
    const mbux07 = read("guest-app/tests/api/mbux-07-step-4-review.test.ts");
    expect(mbux07).toMatch(/the disclosure is OPEN by default[\s\S]+?MBUX-14/);
  });
});