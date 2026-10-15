// MBUX-11 (decision #264, 2026-10-16) — the new
// StaySummaryStrip mobile-first persistent top strip on the
// booking flow's Step 1. The strip sits directly under the
// StepIndicator, shows the date range + nights + guests, and
// offers an Edit affordance that smooth-scrolls to the existing
// `<aside>` "Stay details" sidebar.
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
    expect(stripSrc).toMatch(/checkIn: string/);
    expect(stripSrc).toMatch(/checkOut: string/);
    expect(stripSrc).toMatch(/nights: number/);
    expect(stripSrc).toMatch(/guests: number/);
  });

  it("StaySummaryStrip exposes a targetId prop defaulting to 'booking-stay-details-aside'", () => {
    expect(stripSrc).toMatch(/targetId\?:\s*string/);
    expect(stripSrc).toMatch(/targetId\s*=\s*["']booking-stay-details-aside["']/);
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
  // The Edit button must be a real <button type="button">
  // (not a div, not a Link — those would not work for the
  // scroll-into-view + ring + setTimeout behaviour), and the
  // handler must smooth-scroll to the target aside + apply a
  // brief ring highlight + remove it after a timeout.

  it("the Edit button is a real <button type=\"button\"> with a Pencil icon", () => {
    expect(stripSrc).toMatch(/<button[\s\S]+?type=["']button["'][\s\S]+?<\/button>/);
    expect(stripSrc).toMatch(/Pencil/);
  });

  it("the Edit handler calls scrollIntoView with smooth behaviour on the target element", () => {
    expect(stripSrc).toMatch(/el\.scrollIntoView\(\{\s*behavior:\s*["']smooth["']/);
  });

  it("the Edit handler applies a ring highlight then removes it after a timeout (mirrors the Adjust-room CTA at BookingPage.tsx:4656)", () => {
    expect(stripSrc).toMatch(/el\.classList\.add\(["']ring-2["']/);
    expect(stripSrc).toMatch(/window\.setTimeout/);
    expect(stripSrc).toMatch(/el\.classList\.remove\(["']ring-2["']/);
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
  // the legacy inline date strip must be gone, and the sidebar
  // <aside> must carry the scroll target id so the Edit
  // handler can find it.

  it("BookingPage imports the new StaySummaryStrip component", () => {
    expect(bookingPageSrc).toMatch(/import\s*\{[^}]*\bStaySummaryStrip\b[^}]*\}\s*from\s*["']\.\.\/components\/StaySummaryStrip["']/);
  });

  it("BookingPage renders <StaySummaryStrip /> with the four required props", () => {
    expect(bookingPageSrc).toMatch(/<StaySummaryStrip[\s\S]+?\/>/);
    expect(bookingPageSrc).toMatch(/checkIn=\{checkIn\}/);
    expect(bookingPageSrc).toMatch(/checkOut=\{checkOut\}/);
    expect(bookingPageSrc).toMatch(/nights=\{nights\}/);
    expect(bookingPageSrc).toMatch(/guests=\{guests\}/);
  });

  it("the legacy inline date strip at the old location is GONE (no formatStayDate(checkIn) - formatStayDate(checkOut) inline JSX)", () => {
    // The old shape was:
    //   <p className="font-semibold text-gray-950">{formatStayDate(checkIn)} - {formatStayDate(checkOut)}</p>
    expect(bookingPageSrc).not.toMatch(/formatStayDate\(checkIn\)\s*-\s*\{formatStayDate\(checkOut\)\}/);
  });

  it("the BookingPage <aside> has id=\"booking-stay-details-aside\" so the Edit button can target it", () => {
    expect(bookingPageSrc).toMatch(/<aside\s+id=["']booking-stay-details-aside["']/);
  });

  it("the BookingPage <aside> uses scroll-mt-* so the smooth-scroll lands below the sticky header", () => {
    // The strip's scroll target is the aside. Without
    // scroll-mt-*, the smooth scroll would land with the
    // aside's top edge pinned to the very top of the viewport,
    // which can land the heading under the sticky page header.
    expect(bookingPageSrc).toMatch(/<aside[^>]*scroll-mt-/);
  });
});