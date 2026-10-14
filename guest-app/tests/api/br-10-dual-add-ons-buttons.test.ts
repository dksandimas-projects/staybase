// Per BR-10 (Phase 14 — Cut-off toggle + Skip add-ons,
// decision #244 reserved, 2026-10-14): source-text
// tripwires for the BR-10 dual-button on the Add-ons
// step. The refactor renders TWO parallel CTAs on the
// Add-ons step (the public + corporate booking flows):
//
//   - **Primary**  "Continue to guest details" — the
//     pre-BR-10 single button, kept verbatim.
//
//   - **Ghost**    "No add-ons, continue" — the new
//     "skip add-ons" affordance. Same destination URL
//     + same URL-side guard, mutted gray-ghost styling
//     (`bg-transparent text-gray-500 border border-gray-300
//     hover:bg-gray-50`) per FRONTEND.md §Button Variants.
//
// The tripwires pin:
//   1. The literal button labels appear on each page.
//   2. Both buttons target the same `step=guest-details`
//      URL (no shortcut for skip).
//   3. The ghost button uses the muted ghost-variant
//      classes (not the brand-primary colored variant
//      from `components/GhostButton.tsx`, which would
//      visually compete with the primary CTA).
//
// All assertions are byte-stable: the file reads the
// source of each file (no runtime fixtures, no JSDOM)
// so each tripwire is reproducible across edits.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);
const corporateBookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

describe("BR-10 — dual 'Continue to guest details' / 'No add-ons, continue' on BookingPage.tsx", () => {
  /**
   * Extract the Add-ons step's dual-button container
   * block from BookingPage.tsx. The block is anchored
   * on the unique `data-testid="booking-addons-skip-addons"`
   * attribute on the ghost CTA `<Link>` — no other
   * element in the file carries that testid. The block
   * extends backwards to the enclosing `<div
   * className="flex flex-col gap-2 sm:flex-row sm:items-center">`
   * container that holds both buttons, and forwards to
   * the closing `</div></div></div>` of the bottom-bar
   * wrapper. This anchors the tripwire on the
   * data-testid rather than a free-form comment so it
   * survives copy edits to the surrounding comments.
   */
  const skipAnchorIdx = bookingPageSrc.indexOf(
    'data-testid="booking-addons-skip-addons"'
  );
  const startAnchorIdx = bookingPageSrc.lastIndexOf(
    '<div className="flex flex-col gap-2 sm:flex-row sm:items-center">',
    skipAnchorIdx
  );
  // The block ends after the bottom-bar's
  // `</div></div></div>` chain — but `</Link>` itself
  // is a clear, unique anchor for the ghost button.
  const endAnchorIdx = bookingPageSrc.indexOf("</Link>", skipAnchorIdx) + "</Link>".length;
  const addOnsBlock =
    startAnchorIdx >= 0 && skipAnchorIdx >= 0 && endAnchorIdx > skipAnchorIdx
      ? bookingPageSrc.slice(startAnchorIdx, endAnchorIdx)
      : null;

  it("renders the primary 'Continue to guest details' CTA label on the Add-ons step", () => {
    // The label is the BR-10 invariant: a future
    // copy edit that drops the word "guest details"
    // would obscure the destination step (the
    // skip-button label is "No add-ons, continue" —
    // both must stay unambiguous). The tripwire is
    // strict-mode literal: the exact string.
    expect(bookingPageSrc).toMatch(/Continue to guest details/);
  });

  it("renders the ghost 'No add-ons, continue' CTA label on the Add-ons step", () => {
    // Per BR-10 (decision #244 reserved, 2026-10-14):
    // the verbatim label is a user-requested string
    // (not paraphrased). Pinning the literal keeps
    // the CTA copy stable across copy edits.
    expect(bookingPageSrc).toMatch(/No add-ons, continue/);
  });

  it("routes both buttons to the same `/book?step=guest-details` destination", () => {
    // Both buttons must navigate to the same URL so
    // the same URL-side guard runs and the per-step
    // payload validation is exercised by both paths.
    // The brief is explicit: "no shortcut for skip".
    expect(addOnsBlock, "Add-ons dual-button block not found in BookingPage.tsx").not.toBeNull();
    const block = addOnsBlock!;
    const occurrences = block.match(/to=\{`\/book\?\$\{guestDetailsParams\.toString\(\)\}`/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it("ghost button uses the muted ghost-variant classes (not `components/GhostButton.tsx`)", () => {
    // The existing `GhostButton` component renders
    // with `border-primary text-primary`, which
    // would visually compete with the primary
    // "Continue" CTA. FRONTEND.md §Button Variants
    // specifies the muted ghost recipe
    // (`bg-transparent text-gray-500 border
    // border-gray-300 hover:bg-gray-50`) for the
    // skip-affordance case.
    expect(addOnsBlock).not.toBeNull();
    const block = addOnsBlock!;
    expect(block).toMatch(/text-gray-500/);
    expect(block).toMatch(/border-gray-300/);
    expect(block).toMatch(/bg-transparent/);
    expect(block).toMatch(/hover:bg-gray-50/);
  });

  it("ghost `<Link>` element does NOT carry the brand-primary ghost-variant class names", () => {
    // Strong pin: extract the ghost `<Link>`'s
    // `className` attribute (the one with the
    // `booking-addons-skip-addons` data-testid) and
    // assert the className does not contain
    // `border-primary` or `text-primary`. This
    // avoids tripping on the BR-10 comment block
    // text that intentionally mentions
    // `border-primary` to describe the recipe we
    // DIDN'T use.
    expect(addOnsBlock).not.toBeNull();
    const block = addOnsBlock!;
    const linkClassMatch = block.match(
      /<Link[\s\S]*?data-testid="booking-addons-skip-addons"[\s\S]*?className="([^"]+)"/
    );
    expect(linkClassMatch, "ghost <Link> className not found").not.toBeNull();
    const ghostClassName = linkClassMatch![1];
    expect(ghostClassName).not.toMatch(/\bborder-primary\b/);
    expect(ghostClassName).not.toMatch(/\btext-primary\b/);
  });

  it("primary CTA + ghost CTA both carry testids for render tests", () => {
    // The primary CTA is wrapped in a `<PrimaryButton>`
    // with `data-testid="booking-addons-continue-primary"`.
    // The ghost CTA is a plain `<Link>` with
    // `data-testid="booking-addons-skip-addons"`. Both
    // testids exist for future render tests.
    expect(bookingPageSrc).toMatch(
      /data-testid="booking-addons-continue-primary"/
    );
    expect(bookingPageSrc).toMatch(
      /data-testid="booking-addons-skip-addons"/
    );
  });
});

describe("BR-10 — dual 'Continue to guest details' / 'No add-ons, continue' on CorporateBookingPage.tsx", () => {
  /**
   * Mirror of the BookingPage anchor — same
   * `data-testid="corporate-addons-skip-addons"`
   * uniqueness property.
   */
  const skipAnchorIdx = corporateBookingPageSrc.indexOf(
    'data-testid="corporate-addons-skip-addons"'
  );
  const startAnchorIdx = corporateBookingPageSrc.lastIndexOf(
    '<div className="flex flex-col gap-2 sm:flex-row sm:items-center">',
    skipAnchorIdx
  );
  const endAnchorIdx =
    corporateBookingPageSrc.indexOf("</Link>", skipAnchorIdx) +
    "</Link>".length;
  const addOnsBlock =
    startAnchorIdx >= 0 && skipAnchorIdx >= 0 && endAnchorIdx > skipAnchorIdx
      ? corporateBookingPageSrc.slice(startAnchorIdx, endAnchorIdx)
      : null;

  it("renders the primary 'Continue to guest details' CTA label on the Add-ons step", () => {
    expect(corporateBookingPageSrc).toMatch(/Continue to guest details/);
  });

  it("renders the ghost 'No add-ons, continue' CTA label on the Add-ons step", () => {
    // The corporate flow keeps the same label as the
    // public flow so future per-stay add-ons (BR-12
    // airport transfer, etc.) drop into both pages
    // identically without renaming either label.
    expect(corporateBookingPageSrc).toMatch(/No add-ons, continue/);
  });

  it("routes both buttons to the same `/corporate/book?step=guest-details` destination", () => {
    expect(addOnsBlock, "Corporate Add-ons dual-button block not found").not.toBeNull();
    const block = addOnsBlock!;
    const occurrences = block.match(/to=\{`\/corporate\/book\?\$\{addOnsNext\.toString\(\)\}`/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it("ghost button uses the muted ghost-variant classes", () => {
    expect(addOnsBlock).not.toBeNull();
    const block = addOnsBlock!;
    expect(block).toMatch(/text-gray-500/);
    expect(block).toMatch(/border-gray-300/);
    expect(block).toMatch(/bg-transparent/);
    expect(block).toMatch(/hover:bg-gray-50/);
  });

  it("ghost `<Link>` element does NOT carry the brand-primary ghost-variant class names", () => {
    expect(addOnsBlock).not.toBeNull();
    const block = addOnsBlock!;
    const linkClassMatch = block.match(
      /<Link[\s\S]*?data-testid="corporate-addons-skip-addons"[\s\S]*?className="([^"]+)"/
    );
    expect(linkClassMatch, "ghost <Link> className not found").not.toBeNull();
    const ghostClassName = linkClassMatch![1];
    expect(ghostClassName).not.toMatch(/\bborder-primary\b/);
    expect(ghostClassName).not.toMatch(/\btext-primary\b/);
  });

  it("primary CTA + ghost CTA both carry testids for render tests", () => {
    expect(corporateBookingPageSrc).toMatch(
      /data-testid="corporate-addons-continue-primary"/
    );
    expect(corporateBookingPageSrc).toMatch(
      /data-testid="corporate-addons-skip-addons"/
    );
  });
});

describe("BR-10 — Add-ons step does NOT introduce a new step key (no shortcut for skip)", () => {
  /**
   * The Add-ons step's rendering branch is anchored
   * by the unique `if (isAddOnsStep) {` guard followed
   * by the closing `}` of the JSX `return` block. We
   * backtrack from the `data-testid="booking-addons-skip-addons"`
   * anchor (the Skip CTA inside the Add-ons branch)
   * so the regex reliably lands on the branch body
   * even if earlier parts of the file mention
   * `isAddOnsStep` (e.g. in the URL search-param
   * handler). The corporate page uses
   * `data-testid="corporate-addons-skip-addons"` and
   * the `currentStepKey === "add-ons"` literal as
   * anchor.
   */
  it("BookingPage still uses STEP_KEYS.guestDetails (not a new skip key) on the Add-ons step", () => {
    // The brief is explicit: skip is a button, not a
    // step. The destination is the same `guest-details`
    // step key as the pre-BR-10 single button. If a
    // future refactor adds a `skip-addons` step key,
    // the URL-side guard would change and this
    // tripwire breaks.
    //
    // We anchor on the LAST `if (isAddOnsStep) {`
    // occurrence — the rendering branch — and extend
    // forward to the skip-addons testid. There are two
    // matches for the guard in the file: an earlier
    // one inside a back-handler and the rendering
    // branch we want. `lastIndexOf` pins the latter.
    // The `STEP_KEYS.guestDetails` reference lives
    // outside the rendering branch (in the URL
    // handler) so we cannot pin it INSIDE this
    // block; instead we anchor the negative pin
    // here (no new skip key in the rendering
    // branch) plus a file-level negative pin
    // elsewhere — see the second assertion.
    const startAnchor = "if (isAddOnsStep) {";
    const startIdx = bookingPageSrc.lastIndexOf(startAnchor);
    const skipIdx = bookingPageSrc.indexOf(
      'data-testid="booking-addons-skip-addons"'
    );
    expect(startIdx, "isAddOnsStep guard not found").toBeGreaterThanOrEqual(0);
    expect(skipIdx, "Skip testid not found").toBeGreaterThanOrEqual(0);
    expect(startIdx, "start anchor must come before skip testid").toBeLessThan(skipIdx);
    const block = bookingPageSrc.slice(startIdx, skipIdx);
    // The rendering branch must NOT mint a
    // `STEP_KEYS.skipAddOns` (or any literal
    // `"skip-addons"` step name) — the destination
    // is the existing `guest-details` step.
    expect(block).not.toMatch(/STEP_KEYS\.skipAddOns/);
    expect(block).not.toMatch(/"skip-addons"/);
    expect(block).not.toMatch(/"skip_addons"/);
    // And — file-level — no `STEP_KEYS.skipAddOns`
    // anywhere in the source.
    expect(bookingPageSrc).not.toMatch(/STEP_KEYS\.skipAddOns/);
  });

  it("CorporateBookingPage's Add-ons step target is `guest-details` (not a new skip key)", () => {
    // The corporate flow sets `step` to the literal
    // `"guest-details"` (the corporate mapping at the
    // top of the file maps step keys to step names).
    // Anchor on the dual-button container and pin the
    // URLSearchParams.set call.
    const startAnchor = `if (currentStepKey === "add-ons") {`;
    const startIdx = corporateBookingPageSrc.indexOf(startAnchor);
    const skipIdx = corporateBookingPageSrc.indexOf(
      'data-testid="corporate-addons-skip-addons"'
    );
    expect(startIdx, "Corporate add-ons guard not found").toBeGreaterThanOrEqual(0);
    expect(skipIdx, "Corporate Skip testid not found").toBeGreaterThanOrEqual(0);
    const block = corporateBookingPageSrc.slice(startIdx, skipIdx);
    expect(block).toMatch(/addOnsNext\.set\("step",\s*"guest-details"\)/);
    // And NOT a new key.
    expect(block).not.toMatch(/"skip-addons"/);
  });
});
