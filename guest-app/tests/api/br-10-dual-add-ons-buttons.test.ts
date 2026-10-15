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
// MBUX-05 supersession (see the block comment above).
//
// BR-10 shipped two parallel CTAs on the Add-ons step —
// "Continue to guest details" (primary) and "No add-ons,
// continue" (ghost) — that advanced to the IDENTICAL
// `/book?step=guest-details` URL and differed only in
// visual style and label.
//
// MBUX-05 (decision #257, 2026-10-15) retires the pair on
// the PUBLIC flow in favour of ONE context-aware action
// whose label states what will actually happen.
//
// Why the pair was wrong: the ghost button implied that
// the primary would do something different with the
// guest's breakfast choices. It would not. A guest who
// had skipped the grid was being told there was a
// special "skip" affordance, which is a distinction the
// destination does not honour. One action removes the
// implication without removing any capability — skipping
// is now simply "have no selections and press Continue".
//
// SCOPE: the public `/book` flow ONLY. The corporate flow
// keeps its BR-10 pair until MBUX-09 does the parity
// pass; the corporate describe block below still asserts
// it, deliberately.
describe("MBUX-05 — one context-aware Add-ons CTA on BookingPage.tsx", () => {
  it("the ghost 'No add-ons, continue' CTA is GONE from the public flow", () => {
    expect(bookingPageSrc).not.toMatch(/No add-ons, continue/);
    expect(bookingPageSrc).not.toMatch(/data-testid="booking-addons-skip-addons"/);
  });

  it("renders one context-aware action that states the real outcome", () => {
    expect(bookingPageSrc).toMatch(/Continue without add-ons/);
    expect(bookingPageSrc).toMatch(/Continue with \{addOnCount\} add-on/);
  });

  it("the no-selection label and the with-selection label are mutually exclusive", () => {
    expect(bookingPageSrc).toMatch(
      /addOnCount === 0\s*\?\s*\(\s*"Continue without add-ons"/
    );
  });

  it("derives the count from the breakfast selections, not a hardcoded number", () => {
    expect(bookingPageSrc).toMatch(
      /const addOnCount = Object\.keys\(breakfastSelections\)\.length/
    );
  });

  it("quotes `breakfastTotal` — the SAME value the review step and create payload use", () => {
    // A CTA total that can disagree with the bill is worse than no
    // total, so this pins the shared source rather than a copy.
    expect(bookingPageSrc).toMatch(/formatPrice\(breakfastTotal\)/);
  });

  it("still advances to `guest-details` — retiring the ghost button mints no new step key", () => {
    expect(bookingPageSrc).not.toMatch(/STEP_KEYS\.skipAddOns/);
    expect(bookingPageSrc).not.toMatch(/"skip-addons"/);
    expect(bookingPageSrc).not.toMatch(/"skip_addons"/);
    expect(bookingPageSrc).toMatch(
      /data-testid="booking-addons-continue-primary"/
    );
    // ...and it is still a client-side <Link>-backed PrimaryButton, so
    // breakfastSelections + breakfastTotal survive the route change.
    expect(bookingPageSrc).toMatch(
      /<PrimaryButton\s+to=\{`\/book\?\$\{guestDetailsParams\.toString\(\)\}`\}/
    );
  });

  it("the footer summary states the selection count and total honestly", () => {
    // The pre-MBUX-05 summary said "Continue to guest details when
    // you're ready." — true but useless next to a CTA that already
    // says where you are going.
    expect(bookingPageSrc).not.toMatch(/Continue to guest details when you&apos;re ready\./);
    expect(bookingPageSrc).toMatch(/No add-ons selected/);
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
    // MBUX-05 (decision #257) retired the ghost "skip" button, so the
    // block is now delimited by the surviving single CTA's testid
    // rather than the removed one. The invariant is unchanged: the
    // Add-ons rendering branch must not mint a new step key.
    const skipIdx = bookingPageSrc.indexOf(
      'data-testid="booking-addons-continue-primary"'
    );
    expect(startIdx, "isAddOnsStep guard not found").toBeGreaterThanOrEqual(0);
    expect(skipIdx, "Add-ons CTA testid not found").toBeGreaterThanOrEqual(0);
    expect(startIdx, "start anchor must come before the CTA testid").toBeLessThan(skipIdx);
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
