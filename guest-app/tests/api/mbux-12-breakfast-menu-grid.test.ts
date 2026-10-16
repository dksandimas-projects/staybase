// MBUX-12 (decision #265, 2026-10-16) — `BreakfastMenuStrip`
// switched from a horizontal-scroll carousel (2.5 cards visible
// on a 375px phone, third cut off mid-name) to a responsive CSS
// grid (2 cols on mobile, 3 on `sm:`, 4 on `lg:`).
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach the MBUX-* / BR-* / DR-01 suites use. These tests pin
// the SHAPE (grid utility classes, aspect ratio, fallback icon,
// per-card data-testid), not the pixels; the visual acceptance
// (does 2.5 cards → 2 fit on 375px) is the MBUX-10 manual
// browser pass when the user confirms the Firebase env.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

// Strip JS comments so an assertion about CODE cannot be tripped by
// prose in a doc comment. The MBUX-12 JSDoc above the strip
// references the pre-MBUX-12 carousel classes for context — those
// tokens must not accidentally satisfy a negative regex. Same
// pattern as `mbux-01-booking-shell.test.ts`.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const stripSrc = read("guest-app/src/components/BreakfastMenuStrip.tsx");
const stripCode = stripComments(stripSrc);
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-12 — breakfast menu switches from horizontal scroll to responsive grid", () => {
  // ── The grid utility classes ──────────────────────────────
  //
  // The pre-MBUX-12 implementation was a horizontal-scroll
  // carousel (`flex snap-x snap-mandatory overflow-x-auto` +
  // per-card `w-32 shrink-0 snap-start`). The fix must NOT keep
  // any of those classes — the scroll behaviour is what produced
  // the "third card cut in half" complaint. The replacement is
  // `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` so:
  //   mobile (default) : 2 cols
  //   sm:              : 3 cols
  //   lg:              : 4 cols

  it("the strip's row uses `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`", () => {
    expect(stripSrc).toMatch(
      /<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">/
    );
  });

  it("the strip's row no longer uses horizontal-scroll carousel classes (flex + snap-x + overflow-x-auto)", () => {
    // A future refactor that re-adds any of these would bring
    // back the cut-off-third-card shape on a 375px phone.
    // The MBUX-12 JSDoc above references these classes for
    // context — `stripCode` (comments stripped) prevents the
    // doc-comment prose from accidentally satisfying the
    // negative regex.
    expect(stripCode).not.toMatch(/snap-x\s+snap-mandatory/);
    expect(stripCode).not.toMatch(/overflow-x-auto/);
    expect(stripCode).not.toMatch(/overscroll-x-contain/);
  });

  it("the strip's row is no longer `flex` (grid replaces flex)", () => {
    // The grid utility class implies `display: grid`; the old
    // `flex` would have to be re-introduced for the carousel to
    // come back. Pin the absence.
    expect(stripCode).not.toMatch(/className="-mx-4 mt-2 flex snap-x/);
    expect(stripCode).not.toMatch(/className="mt-2 flex snap-x/);
  });

  it("per-card sizing is `w-full` (the grid cell owns the width), not a fixed `w-32`/`w-40`", () => {
    // The old shape fixed each card at 128px (`w-32`) on mobile
    // and 160px (`w-40`) on `sm:`, forcing the horizontal
    // scroll. The grid cell owns the width via `w-full`, so
    // cards size to the grid column.
    expect(stripCode).toMatch(/className="w-full"\s*\n\s*data-testid=\{`breakfast-menu-card-/);
    expect(stripCode).not.toMatch(/w-32 shrink-0 snap-start/);
    expect(stripCode).not.toMatch(/w-40/);
  });

  // ── The fallback icon stays ───────────────────────────────
  //
  // MBUX-04 shipped the admin-managed meal photos as an OPTIONAL
  // field. When no photo is uploaded (or the URL 404s) the
  // `UtensilsCrossed` icon is the fallback. The user's screenshot
  // shows the fallback icon because staging has no meal photos
  // uploaded yet — that's a content gap, not a code gap. The
  // fallback MUST stay so the grid layout still reads cleanly
  // when admin photos are missing.

  it("the `UtensilsCrossed` fallback icon still renders when `imageUrl` is absent or 404s", () => {
    expect(stripSrc).toMatch(/<UtensilsCrossed/);
  });

  it("the `failedIds` error-recovery state still tracks per-meal image load failures", () => {
    expect(stripSrc).toMatch(/failedIds/);
    expect(stripSrc).toMatch(/setFailedIds\(\(prev\) => \(\{\s*\.\.\.\s*prev,\s*\[meal\.id\]:\s*true\s*\}\)\)/);
  });

  it("the fallback branch's tile keeps the brand-neutral styling (gray-100 + gray-400 icon)", () => {
    // Pin the visual contract — the tile must look like a
    // "missing photo" placeholder, not like a clickable
    // button. A future refactor that adds a hover state would
    // imply the meal is selectable, which is wrong (the strip
    // is read-only reference — see the JSDoc).
    expect(stripSrc).toMatch(/bg-gray-100 ring-1 ring-gray-200/);
    expect(stripSrc).toMatch(/<span[^>]*className="flex h-full w-full items-center justify-center text-gray-400"/);
  });

  // ── Per-card accessibility + data attributes ──────────────

  it("each card carries `data-testid={breakfast-menu-card-${id}}` for the test surface", () => {
    expect(stripSrc).toMatch(/data-testid=\{`breakfast-menu-card-\$\{meal\.id\}`\}/);
  });

  it("the strip carries `aria-label=\"Breakfast menu\"` so screen readers announce the section", () => {
    expect(stripSrc).toMatch(/aria-label=["']Breakfast menu["']/);
  });

  it("each card's image alt is empty (decorative — the meal name is rendered as text below)", () => {
    // The pre-MBUX-12 alt="" choice was deliberate: the meal
    // NAME is the accessible label, the photo is decorative
    // repetition. A future refactor that sets alt={meal.name}
    // would double-announce every meal.
    expect(stripSrc).toMatch(/<img[\s\S]+?alt=["']["'][\s\S]+?\/>/);
  });

  // ── Step 2 layout integration ─────────────────────────────
  //
  // The skip-a-day explanation copy below the strip moved from
  // mt-4 to mt-5 in MBUX-12 so the breathing room is preserved
  // now that the strip no longer has its own internal `pb-1`.
  // MBUX-17 (decision #272, 2026-10-16) removes that paragraph
  // entirely — the default `<option value="">No breakfast</option>`
  // on every guest slot already implies it, so the reassurance
  // was redundant mobile real estate. The `mt-5` slot the line
  // used to occupy is now taken by the mbux-16 help text when
  // at least one date is locked (mutually exclusive — the help
  // text only appears when a date is locked, otherwise the gap
  // collapses).

  it("the pre-MBUX-17 skip-a-day explanation below the strip is REMOVED (MBUX-17, decision #272)", () => {
    expect(bookingPageSrc).not.toMatch(
      /Skipping a day is fine — leave any slot as \u201cNo breakfast\u201d\./
    );
    // Pin the absence of the `mt-5 text-xs text-gray-600` paragraph
    // that used to wrap the line — a future refactor that
    // re-introduces it under any text must surface here.
    expect(bookingPageSrc).not.toMatch(/mt-5 text-xs text-gray-600">\s*\n\s*Skipping a day is fine/);
  });
});