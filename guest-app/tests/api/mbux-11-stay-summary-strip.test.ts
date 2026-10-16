// MBUX-11 (decision #264, 2026-10-16) — the
// StaySummaryStrip mobile-first persistent top strip on the
// booking flow's Step 1. The strip sits directly under the
// StepIndicator, shows the date range + nights + guests, and
// offers an Edit affordance.
//
// MBUX-18 (decision #275, 2026-10-16) replaced the original
// scroll-to-aside Edit behaviour with a mobile bottom sheet
// (`EditStayDetailsSheet`). The original scroll/ring/restore
// assertions below were INVERTED to MBUX-18:
//   - the `targetId` prop + `scrollIntoView` + ring + setTimeout
//     pattern is RETIRED; the Edit pencil now calls `onEdit`
//     and the parent owns the sheet state.
//   - the `id="booking-stay-details-aside"` on the BookingPage
//     `<aside>` stays (defensive fallback for deep links that
//     jump straight to the aside) — see the comment at
//     BookingPage.tsx:4147.
//
// The MBUX-18 shape is pinned in a separate tripwire file
// (`mbux-18-edit-stay-details-sheet.test.ts`) so the two
// contracts don't fight each other.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. The visual
// acceptance (does the strip look right at 375px) is the
// MBUX-10 manual browser pass — this file pins the SHAPE the
// browser pass needs to verify.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const stripSrc = read("guest-app/src/components/StaySummaryStrip.tsx");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-11 — StaySummaryStrip mobile-first top strip", () => {
  // ── Component exists + named export ──────────────────────

  it("the new StaySummaryStrip.tsx exists with a named export", () => {
    expect(stripSrc).toMatch(/export\s+function\s+StaySummaryStrip\s*\(/);
  });

  // ── Props contract ────────────────────────────────────────
  //
  // The strip reads checkIn / checkOut / nights / guests. A
  // future refactor that renames or restructures the props
  // would break every BookingPage call site, so the four
  // names must remain.

  it("StaySummaryStrip accepts checkIn / checkOut / nights / guests props", () => {
    expect(stripSrc).toMatch(/checkIn:\s*string/);
    expect(stripSrc).toMatch(/checkOut:\s*string/);
    expect(stripSrc).toMatch(/nights:\s*number/);
    expect(stripSrc).toMatch(/guests:\s*number/);
  });

  it("StaySummaryStrip exposes an onEdit prop (the MBUX-18 sheet trigger)", () => {
    // Per MBUX-18: the parent owns the sheet state; the strip
    // is a dumb trigger that calls `onEdit?.()` on tap. The
    // optional-chain is in the file so a parent that forgets
    // to wire the prop is a silent no-op rather than a crash.
    expect(stripSrc).toMatch(/onEdit\?:/);
    expect(stripSrc).toMatch(/onEdit\?\.\(\)/);
  });

  // ── The strip is mobile-first ─────────────────────────────
  //
  // On `lg:` the sidebar takes over and the strip must NOT
  // render — the `lg:hidden` Tailwind utility enforces that.
  // Without it, the same summary lines would appear twice on
  // desktop.

  it("the strip uses the `lg:hidden` Tailwind utility so it does NOT render on desktop", () => {
    expect(stripSrc).toMatch(/lg:hidden/);
  });

  it("the strip does NOT include any `lg:` block that would force visibility back on at desktop", () => {
    // A future refactor that adds `lg:flex` (or similar) would
    // re-enable the strip on desktop and put the same lines on
    // screen twice. Pin the absence.
    expect(stripSrc).not.toMatch(/lg:flex|lg:block|lg:grid/);
  });

  // ── The Edit affordance ───────────────────────────────────
  //
  // The Edit button must be a real <button type="button"> (not
  // a div, not a Link — those would not work for the onEdit
  // callback firing), and per MBUX-18 it dispatches to the
  // parent's onEdit prop, NOT to a scrollIntoView + ring +
  // setTimeout dance.

  it("the Edit button is a real <button type=\"button\"> with a Pencil icon", () => {
    expect(stripSrc).toMatch(/<button[\s\S]+?type=["']button["'][\s\S]+?<\/button>/);
    expect(stripSrc).toMatch(/Pencil/);
  });

  it("the Edit handler calls the onEdit prop (MBUX-18 — sheet trigger, not scroll)", () => {
    // Per MBUX-18: the strip's handleEdit is now a thin
    // wrapper around `onEdit?.()`. The pre-MBUX-18 scroll +
    // ring + setTimeout dance is retired and lives in a
    // comment block in the file (so a future agent reading the
    // file learns the history).
    expect(stripSrc).toMatch(/function\s+handleEdit[\s\S]*?onEdit\?\.\(\)/);
  });

  it("the Edit button does NOT call scrollIntoView / classList / setTimeout (pre-MBUX-18 behaviour is RETIRED)", () => {
    // The pre-MBUX-18 Edit handler smooth-scrolled to the
    // aside + added `ring-2 ring-primary ring-offset-2` for
    // 2000ms. MBUX-18 retired that pattern (the sheet opens
    // instead). Pin the negative space so a future refactor
    // can't quietly reintroduce the scroll behaviour.
    expect(stripSrc).not.toMatch(/scrollIntoView/);
    expect(stripSrc).not.toMatch(/classList\.add/);
    expect(stripSrc).not.toMatch(/window\.setTimeout/);
  });

  it("the Edit button has an aria-label so screen readers announce the action", () => {
    expect(stripSrc).toMatch(/aria-label=["']Edit dates and guests["']/);
  });

  // ── Date formatting ──────────────────────────────────────
  //
  // The strip duplicates `formatStayDate` (5-line helper) so
  // it can render without an import cycle back into BookingPage.
  // Pin the helper so a future refactor that deletes it
  // surfaces here.

  it("the strip defines its own formatStayDate helper using config.locale", () => {
    expect(stripSrc).toMatch(/function\s+formatStayDate\s*\(\s*value:\s*string\s*\)/);
    expect(stripSrc).toMatch(/config\.locale/);
  });

  // ── BookingPage integration ──────────────────────────────
  //
  // The strip must mount under the StepIndicator on Step 1,
  // the legacy inline date strip must be gone, the BookingPage
  // must pass an `onEdit` callback that opens the sheet, and
  // the `<aside>` retains its `id` (defensive fallback for
  // deep links per MBUX-18's aside comment at line 4147).

  it("BookingPage imports the new StaySummaryStrip component", () => {
    expect(bookingPageSrc).toMatch(/import\s*\{[^}]*\bStaySummaryStrip\b[^}]*\}\s*from\s*["']\.\.\/components\/StaySummaryStrip["']/);
  });

  it("BookingPage renders <StaySummaryStrip /> with the four required props + an onEdit callback", () => {
    expect(bookingPageSrc).toMatch(/<StaySummaryStrip[\s\S]+?\/>/);
    expect(bookingPageSrc).toMatch(/checkIn=\{checkIn\}/);
    expect(bookingPageSrc).toMatch(/checkOut=\{checkOut\}/);
    expect(bookingPageSrc).toMatch(/nights=\{nights\}/);
    expect(bookingPageSrc).toMatch(/guests=\{guests\}/);
    expect(bookingPageSrc).toMatch(/onEdit=\{[\s\S]*?setIsEditStayDetailsOpen\(true\)[\s\S]*?\}/);
  });

  it("the legacy inline date strip at the old location is GONE (no formatStayDate(checkIn) - formatStayDate(checkOut) inline JSX)", () => {
    // The old shape was:
    //   <p className="font-semibold text-gray-950">{formatStayDate(checkIn)} - {formatStayDate(checkOut)}</p>
    expect(bookingPageSrc).not.toMatch(/formatStayDate\(checkIn\)\s*-\s*\{formatStayDate\(checkOut\)\}/);
  });

  it("the BookingPage <aside> still carries id=\"booking-stay-details-aside\" as a defensive deep-link target", () => {
    // Per MBUX-18: the Edit pencil no longer scrolls to the
    // aside, but the id stays for deep links that jump
    // straight to the aside (BookingStickyFooter URL-driven
    // scroll, accessibility tools). A future refactor that
    // drops the id would lose that contract.
    expect(bookingPageSrc).toMatch(/<aside\s+id=["']booking-stay-details-aside["']/);
  });

  it("the BookingPage <aside> uses scroll-mt-* so a deep-link scroll lands below the sticky header", () => {
    // Defensive fallback for the deep-link path described in
    // the previous test. Without scroll-mt-*, a smooth scroll
    // would land with the aside's top edge pinned to the very
    // top of the viewport, which can land the heading under
    // the sticky page header.
    expect(bookingPageSrc).toMatch(/<aside[^>]*scroll-mt-/);
  });
});