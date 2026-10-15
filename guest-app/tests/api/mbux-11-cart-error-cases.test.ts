// MBUX-11 (decision #264, 2026-10-16) — the cart-distribution
// failure message on Step 1 used to be a single generic
// sentence regardless of the actual cause. The user review
// captured this exactly: "the error should show differently,
// maybe tell user too much rooms where added maybe update the
// number of guests or check". MBUX-11 branches the message
// into four specific causes + a legacy fallback.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. These tests
// pin the SHAPE (the four specific causes, the precedence
// order, the legacy fallback, the role=alert), not the pixels;
// the visual acceptance (does the warning read well at 375px)
// is the MBUX-10 manual browser pass.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-11 — cart-distribution failure message is branched by cause", () => {
  // ── The four specific causes must all be present ─────────

  it("declares a cartDistributionErrorMessage helper that returns the branched message", () => {
    expect(bookingPageSrc).toMatch(/cartDistributionErrorMessage\s*=/);
  });

  it("Cause A — distributedRoomCart.length === 0 → 'Pick at least one room to start your stay.'", () => {
    expect(bookingPageSrc).toMatch(
      /if\s*\(\s*distributedRoomCart\.length\s*===\s*0\s*\)\s*\{[\s\S]*?return\s+["']Pick at least one room to start your stay\.["']/
    );
  });

  it("Cause B — distributedRoomCart.length > guests → 'each room needs at least one adult'", () => {
    expect(bookingPageSrc).toMatch(
      /distributedRoomCart\.length\s*>\s*guests/
    );
    expect(bookingPageSrc).toMatch(
      /each room needs at least one adult/
    );
  });

  it("Cause C — cartDistribution.unassignedAdults > 0 → 'adults aren't assigned' message", () => {
    expect(bookingPageSrc).toMatch(
      /cartDistribution\.unassignedAdults\s*>\s*0/
    );
    // The text is a template literal that branches on
    // singular/plural: `${n === 1 ? "adult is" : "adults are"} not assigned`.
    // Match either branch loosely so a future whitespace tweak doesn't fail.
    expect(bookingPageSrc).toMatch(
      /adults?\s+(?:is|are)[\s\S]+?not assigned to a room yet/
    );
  });

  it("Cause D — cartDistribution.unassignedChildren > 0 → 'children aren't assigned' message", () => {
    expect(bookingPageSrc).toMatch(
      /cartDistribution\.unassignedChildren\s*>\s*0/
    );
    expect(bookingPageSrc).toMatch(
      /children?\s+(?:is|are)[\s\S]+?not assigned to a room yet/
    );
  });

  // ── Legacy fallback stays ────────────────────────────────
  //
  // The legacy single-sentence fallback is kept as a
  // defensive guard. Removing it would mean a future
  // unhandled case shows nothing — worse than showing the
  // generic text.

  it("the legacy 'Add enough available rooms...' fallback is preserved as the defensive last case", () => {
    expect(bookingPageSrc).toMatch(
      /return\s+["']Add enough available rooms to fit every guest, with at least one adult assigned to each room\.["']/
    );
  });

  // ── Precedence ────────────────────────────────────────────
  //
  // The order matters: Cause A (no rooms) is checked FIRST
  // because if the cart is empty the other comparisons don't
  // make sense. Cause B (more rooms than guests) is checked
  // BEFORE unassigned-adults/children because a 3-room /
  // 1-guest case is more accurately described as "more rooms
  // than guests" than as "adults unassigned". The order of
  // the source-text matches above is implicit — the order of
  // the `if` blocks in the helper must match Cause A → B →
  // C → D → fallback.

  it("Cause A is checked first (no rooms precedes every other branch)", () => {
    const helperIdx = bookingPageSrc.indexOf("cartDistributionErrorMessage");
    expect(helperIdx).toBeGreaterThan(-1);
    const helperStart = bookingPageSrc.indexOf("()", helperIdx);
    const helperBody = bookingPageSrc.slice(helperStart, helperStart + 1500);
    const aIdx = helperBody.indexOf("distributedRoomCart.length === 0");
    const bIdx = helperBody.indexOf("distributedRoomCart.length > guests");
    const cIdx = helperBody.indexOf("unassignedAdults > 0");
    const dIdx = helperBody.indexOf("unassignedChildren > 0");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(cIdx).toBeGreaterThan(-1);
    expect(dIdx).toBeGreaterThan(-1);
    expect(aIdx, "Cause A must precede Cause B").toBeLessThan(bIdx);
    expect(bIdx, "Cause B must precede Cause C").toBeLessThan(cIdx);
    expect(cIdx, "Cause C must precede Cause D").toBeLessThan(dIdx);
  });

  // ── The warning paragraph must carry role="alert" ───────
  //
  // Screen readers must announce the failure immediately.
  // Without `role="alert"`, the warning is silent for
  // visually-impaired guests.

  it("the warning <p> carries role='alert' so screen readers announce the failure immediately", () => {
    // Pin the role at the JSX site that renders the
    // branched message. The id and className already exist
    // pre-MBUX-11 — adding `role="alert"` is the MBUX-11
    // accessibility win. We need the JSX site, not the
    // helper definition (where the same variable name
    // appears earlier in the file).
    const helperIdx = bookingPageSrc.indexOf("cartDistributionErrorMessage =");
    expect(helperIdx).toBeGreaterThan(-1);
    // The JSX site is the SECOND occurrence (the helper
    // definition is the first).
    const jsxIdx = bookingPageSrc.indexOf("{cartDistributionErrorMessage}", helperIdx);
    expect(jsxIdx, "the message must be rendered in the JSX via an expression").toBeGreaterThan(-1);
    const renderingContext = bookingPageSrc.slice(Math.max(0, jsxIdx - 300), jsxIdx);
    expect(renderingContext).toMatch(/role=["']alert["']/);
  });

  // ── The legacy "Add enough available rooms..." inline JSX
  //    text is GONE ─────────────────────────────────────────
  //
  // Pre-MBUX-11 the JSX literally hard-coded the message
  // text. MBUX-11 replaces it with `{cartDistributionErrorMessage}`.
  // A future refactor that re-inlines the legacy string
  // alongside the helper would render both texts.

  it("the JSX uses {cartDistributionErrorMessage}, not the literal legacy string", () => {
    // The literal legacy string now lives ONLY inside the
    // helper as the fallback. Pin that the JSX site is
    // expression, not text. We need the JSX site, not the
    // helper definition (where the same variable name
    // appears earlier in the file).
    const helperIdx = bookingPageSrc.indexOf("cartDistributionErrorMessage =");
    expect(helperIdx).toBeGreaterThan(-1);
    const jsxIdx = bookingPageSrc.indexOf("{cartDistributionErrorMessage}", helperIdx);
    expect(jsxIdx, "the message must be rendered in the JSX via an expression").toBeGreaterThan(-1);
    // The expression must be the sole child of the <p> tag
    // (no legacy literal text inside the same element). We
    // look at the next 50 chars — the </p> closes the element
    // long before that, so anything that isn't whitespace
    // is a regression.
    const renderingContext = bookingPageSrc.slice(jsxIdx, jsxIdx + 50);
    expect(renderingContext).toMatch(/^\{cartDistributionErrorMessage\}\s/);
  });

  // ── The legacy literal text does NOT appear in the JSX
  //    (only in the helper) ────────────────────────────────

  it("the legacy literal 'Add enough available rooms...' appears exactly once in the file (the helper fallback), not in the JSX", () => {
    const occurrences = bookingPageSrc.match(/Add enough available rooms to fit every guest/g);
    expect(occurrences, "legacy string must appear exactly once — only as the fallback").not.toBeNull();
    expect(occurrences?.length).toBe(1);
  });
});