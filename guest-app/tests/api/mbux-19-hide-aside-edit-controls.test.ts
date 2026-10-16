// MBUX-19 (decision #276, 2026-10-16) — on mobile the
// BookingPage `<aside id="booking-stay-details-aside">`
// duplicates the MBUX-18 mobile bottom sheet (`EditStayDetailsSheet`,
// decision #275): the strip at the top exposes Edit → sheet,
// and the aside just below it exposed the same `<DateRangePicker>`
// + Adults/Children steppers inline. The BOOKING-MOBILE-UX.md
// rule "The page does not repeat the same stay summary in
// both a header card and sidebar card." (#139) explicitly
// forbids that duplication. MBUX-19 hides the aside's three
// editable blocks on `< lg:` so the mobile surface is the
// strip + sheet (one editable control) + the cart + info card
// (read-only), and on `lg:` the aside is the full edit surface
// (the strip itself is `lg:hidden` so the sheet cannot open on
// desktop).
//
// The wrapper uses `hidden lg:contents` — not `hidden lg:block`
// — because `lg:contents` removes the wrapper from the layout
// entirely on `lg:`, slotting the three controls back into the
// parent's `space-y-6` stacking context without an extra
// anonymous box (a `display: block` swap would add an extra
// wrapper box and the parent's `space-y-6` would treat it as
// a real child, doubling the gap between the picker and the
// stepper below).
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. The visual
// acceptance (does the aside show only the cart + info card
// at 375px, the full picker + stepper + cart + info at 1024px)
// is the MBUX-10 manual browser pass — this file pins the
// SHAPE the browser pass needs to verify.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

// We anchor assertions on the wrapper's slice so a future
// refactor that moves the three blocks out of the wrapper
// fails with a meaningful diff (not "the wrapper is missing
// somewhere in a 5800-line file").
//
// The slice starts at the wrapper `<div className="hidden
// lg:contents">` and ends at the matching closing `</div>`
// after the Children stepper. The cart (RoomCartLines) is
// OUTSIDE this wrapper and stays visible on mobile.
//
// The slice construction uses a brace-balanced matcher: the
// file is plain text (no JSX execution), and a regex would
// fail on the inner `<div>...<div>...<div>...</div></div></div>`
// stack inside the picker / stepper rows. A small bracket
// walker is the right shape here.

function sliceAsideEditableWrapper(source: string): { start: number; end: number; body: string } | null {
  const openTag = '<div className="hidden lg:contents">';
  const start = source.indexOf(openTag);
  if (start < 0) return null;
  // Walk forward from after the opening tag, counting
  // `<div ...>` opens vs `</div>` closes. The wrapper ends
  // when the depth returns to 0.
  const tagAfterOpen = start + openTag.length;
  let depth = 1;
  let cursor = tagAfterOpen;
  while (cursor < source.length && depth > 0) {
    const nextOpen = source.indexOf("<div", cursor);
    const nextClose = source.indexOf("</div>", cursor);
    if (nextClose < 0) return null;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      // Make sure this `<div` is the start of a tag, not a
      // substring like `<divide`. The next char after `<div`
      // must be whitespace, `>`, or end-of-tag attribute
      // boundary (e.g. `<div\n`, `<div `, `<div>`).
      const charAfter = source[nextOpen + 4];
      if (charAfter === " " || charAfter === "\n" || charAfter === "\t" || charAfter === ">") {
        depth += 1;
        cursor = nextOpen + 4;
        continue;
      }
      cursor = nextOpen + 4;
      continue;
    }
    depth -= 1;
    cursor = nextClose + "</div>".length;
    if (depth === 0) {
      return { start, end: cursor, body: source.slice(start, cursor) };
    }
  }
  return null;
}

const wrapper = sliceAsideEditableWrapper(bookingPageSrc);

describe("MBUX-19 — aside's editable controls hidden on mobile", () => {
  // ── Wrapper presence ──────────────────────────────────────

  it("the BookingPage aside's three editable blocks are wrapped in a `<div className=\"hidden lg:contents\">`", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing — see preceding expectation");
    // A slice exists — that proves the wrapper was emitted
    // by the BookingPage source. The substantive assertions
    // below check its contents.
    expect(wrapper.body.length).toBeGreaterThan(500);
  });

  // ── Wrapper contains the three editable blocks ────────────
  //
  // The wrapper must enclose ALL THREE blocks (DateRangePicker,
  // Adults stepper, Children stepper). A future refactor that
  // wraps only the picker would leave the two steppers visible
  // on mobile — pinning all three ensures the wrapper is the
  // single edit-control boundary.

  it("the wrapper contains the inline <DateRangePicker />", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    // The aside's DateRangePicker uses inline handlers
    // (`onRangeChange={(nextCheckIn, nextCheckOut) => {...}}`)
    // — pin the four event handlers exist in the body. The
    // simpler `checkIn={checkIn}` shape pins the prop wire.
    expect(wrapper.body).toMatch(/<DateRangePicker/);
    expect(wrapper.body).toMatch(/checkIn=\{checkIn\}/);
    expect(wrapper.body).toMatch(/checkOut=\{checkOut\}/);
    expect(wrapper.body).toMatch(/onRangeChange=/);
    expect(wrapper.body).toMatch(/onCheckInChange=/);
    expect(wrapper.body).toMatch(/onCheckOutChange=/);
  });

  it("the wrapper contains the Adults stepper `<label>Adults` block", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    expect(wrapper.body).toMatch(/>\s*Adults\s*</);
    expect(wrapper.body).toMatch(/Remove one adult/);
    expect(wrapper.body).toMatch(/Add one adult/);
    expect(wrapper.body).toMatch(/disabled=\{adults\s*>=\s*maxGuestCapacity\}/);
  });

  it("the wrapper contains the Children stepper `<label>Children (0–11)` block", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    expect(wrapper.body).toMatch(/Children\s*\(0[\u2013-]11\)/);
    expect(wrapper.body).toMatch(/Decrease children count/);
    expect(wrapper.body).toMatch(/Increase children count/);
    expect(wrapper.body).toMatch(/disabled=\{numChildren\s*>=\s*10\}/);
  });

  // ── Wrapper excludes the cart + info card ─────────────────
  //
  // The cart (RoomCartLines) and the info card live in the
  // aside but are READ-ONLY — they must stay visible on
  // mobile. Pin that the wrapper ends BEFORE either appears.
  // The cart is identified by `<RoomCartLines`; the info card
  // by `<Info\s` (the lucide-react Info icon).

  it("the wrapper EXCLUDES the cart (RoomCartLines) — the cart stays visible on mobile", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    expect(wrapper.body).not.toMatch(/<RoomCartLines/);
  });

  it("the wrapper EXCLUDES the info card (the <Info /> icon block) — the info card stays visible on mobile", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    expect(wrapper.body).not.toMatch(/<Info\s/);
  });

  // ── Wrapper uses `lg:contents`, not `lg:block` ─────────────
  //
  // `lg:block` would change the wrapper's `display` to `block`,
  // which adds an extra anonymous box inside the parent's
  // `space-y-6` stacking context — the picker would then be
  // separated from the stepper by a double gap. Pin the right
  // utility so the layout stays correct on `lg:`.

  it("the wrapper uses `hidden lg:contents` (not `hidden lg:block`) so the parent's space-y-6 stays intact on lg:", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    expect(wrapper.body).not.toMatch(/hidden\s+lg:block/);
    // The wrapper's opening tag is `<div className="hidden
    // lg:contents">` — pin that exact class string so a
    // future refactor that adds an extra class (e.g.
    // `lg:contents` → `lg:contents mt-4`) fails the equality
    // check and forces an updated decision entry.
    expect(bookingPageSrc).toMatch(/<div\s+className=["']hidden\s+lg:contents["']\s*>/);
  });

  // ── Cart + info card are AFTER the wrapper ────────────────
  //
  // Verify the cart + info card are rendered AFTER the wrapper
  // in source order — they're the mobile-readable siblings
  // that stay visible. A future refactor that moves them
  // INSIDE the wrapper would hide them on mobile.

  it("the cart + info card are rendered AFTER the wrapper (siblings under the aside, not children of the wrapper)", () => {
    expect(wrapper).not.toBeNull();
    if (!wrapper) throw new Error("wrapper missing");
    // The cart opens with `<RoomCartLines` and the aside's
    // info card uses the `<Info size={18} className="...text-primary"`
    // attribute set (the MBUX-11 brand-primary token). Pin
    // those attribute strings so a future refactor that drops
    // the `text-primary` class doesn't silently re-enable the
    // info card inside the wrapper.
    const cartIndex = bookingPageSrc.indexOf("<RoomCartLines");
    const infoIconIndex = bookingPageSrc.indexOf('<Info size={18} className="mt-0.5 shrink-0 text-primary"');
    expect(cartIndex).toBeGreaterThan(wrapper.end);
    expect(infoIconIndex).toBeGreaterThan(wrapper.end);
  });

  // ── Rationale comment is in place ──────────────────────────
  //
  // The MBUX-19 rationale (the BOOKING-MOBILE-UX.md duplicate
  // rule + the `lg:contents` vs `lg:block` rationale) must
  // stay in the source so a future agent reading the file
  // learns why the wrapper exists. Pin the comment.

  it("the BookingPage source carries the MBUX-19 rationale comment referencing the duplicate-summary rule", () => {
    expect(bookingPageSrc).toMatch(/MBUX-19/);
    expect(bookingPageSrc).toMatch(/decision #276/);
    // The rule's verbatim copy wraps across two lines in the
    // comment — pin both halves so a future refactor that
    // breaks the wrap fails the test.
    expect(bookingPageSrc).toMatch(/does not repeat the same/);
    expect(bookingPageSrc).toMatch(/stay summary in both a header card/);
  });

  // ── Aside's id + scroll-mt-32 are unchanged ───────────────
  //
  // MBUX-19 does not touch the defensive deep-link fallback
  // that MBUX-11 + MBUX-18 left in place. Pin so a future
  // refactor doesn't drop it.

  it("the BookingPage <aside> still carries id=\"booking-stay-details-aside\" (defensive deep-link fallback)", () => {
    expect(bookingPageSrc).toMatch(/<aside\s+id=["']booking-stay-details-aside["']/);
  });

  it("the BookingPage <aside> still carries scroll-mt-* for the deep-link scroll offset", () => {
    expect(bookingPageSrc).toMatch(/<aside[^>]*scroll-mt-/);
  });
});