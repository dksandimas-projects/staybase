// MBUX-18 (decision #275, 2026-10-16) — the mobile-only
// EditStayDetailsSheet bottom sheet that the StaySummaryStrip's
// Edit pencil opens. Replaces the pre-MBUX-18
// scroll-to-aside + ring + setTimeout dance with a proper
// mobile bottom sheet carrying the same DateRangePicker +
// Adults/Children steppers the sidebar renders inline.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. The visual
// acceptance (does the sheet look right at 375px) is the
// MBUX-10 manual browser pass — this file pins the SHAPE the
// browser pass needs to verify.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const sheetSrc = read("guest-app/src/components/EditStayDetailsSheet.tsx");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

describe("MBUX-18 — EditStayDetailsSheet mobile bottom sheet", () => {
  // ── Component exists + named export ──────────────────────

  it("EditStayDetailsSheet.tsx exists with a named export", () => {
    expect(sheetSrc).toMatch(/export\s+function\s+EditStayDetailsSheet\s*\(/);
  });

  // ── Props contract ────────────────────────────────────────
  //
  // The sheet threads every state + handler the sidebar uses
  // (date range, adults/children steppers) so the live
  // URL-param writes don't fork into a separate code path.
  // A future refactor that drops one of these props would
  // break the BookingPage call site — the tripwire pins the
  // contract here.

  it("EditStayDetailsSheet accepts open + onClose props for parent-controlled visibility", () => {
    expect(sheetSrc).toMatch(/open:\s*boolean/);
    expect(sheetSrc).toMatch(/onClose:\s*\(\s*\)\s*=>\s*void/);
  });

  it("EditStayDetailsSheet threads the same date-picker state + handlers as the sidebar", () => {
    expect(sheetSrc).toMatch(/checkIn:\s*string/);
    expect(sheetSrc).toMatch(/checkOut:\s*string/);
    expect(sheetSrc).toMatch(/maxStayNights\?:/);
    expect(sheetSrc).toMatch(/onRangeChange:\s*\(\s*checkIn:\s*string,\s*checkOut:\s*string\s*\)\s*=>\s*void/);
    expect(sheetSrc).toMatch(/onCheckInChange:\s*\(\s*value:\s*string\s*\)\s*=>\s*void/);
    expect(sheetSrc).toMatch(/onCheckOutChange:\s*\(\s*value:\s*string\s*\)\s*=>\s*void/);
  });

  it("EditStayDetailsSheet threads the same occupancy state + handlers as the sidebar", () => {
    expect(sheetSrc).toMatch(/adults:\s*number/);
    expect(sheetSrc).toMatch(/maxGuestCapacity:\s*number/);
    expect(sheetSrc).toMatch(/onAdultsChange:\s*\(\s*next:\s*number\s*\)\s*=>\s*void/);
    expect(sheetSrc).toMatch(/numChildren:\s*number/);
    expect(sheetSrc).toMatch(/onChildrenChange:\s*\(\s*next:\s*number\s*\)\s*=>\s*void/);
  });

  // ── Bottom sheet primitive ───────────────────────────────
  //
  // Per FRONTEND.md §Modals + BOOKING-FLOW.md:74 (DR-03):
  // phones get a bottom sheet anchored to the bottom edge
  // (`fixed inset-x-0 bottom-0`) so the height hugs the
  // content. The `max-h-[calc(100dvh-4rem)]` cap stops the
  // sheet from exceeding the viewport on short screens;
  // `overscroll-contain` stops the page from scrolling behind
  // the sheet; `rounded-t-card` matches the booking-flow
  // surface vocabulary.

  it("the sheet uses the `fixed inset-x-0 bottom-0` mobile bottom-sheet primitive", () => {
    expect(sheetSrc).toMatch(/fixed\s+inset-x-0\s+bottom-0/);
  });

  it("the sheet caps at `max-h-[calc(100dvh-4rem)]` so short viewports don't overflow", () => {
    expect(sheetSrc).toMatch(/max-h-\[calc\(100dvh-4rem\)\]/);
  });

  it("the sheet uses `overscroll-contain` so the page doesn't scroll behind the sheet", () => {
    expect(sheetSrc).toMatch(/overscroll-contain/);
  });

  it("the sheet uses `rounded-t-card` to match the booking-flow surface vocabulary", () => {
    expect(sheetSrc).toMatch(/rounded-t-card/);
  });

  it("the sheet animates with the shared `slideInBottom` variant (FRONTEND.md §Modals)", () => {
    expect(sheetSrc).toMatch(/slideInBottom/);
    expect(sheetSrc).toMatch(/import\s*\{[^}]*\bslideInBottom\b[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
  });

  // ── Mobile-only ──────────────────────────────────────────
  //
  // The strip is `lg:hidden`, so the Edit pencil never mounts
  // on desktop. The sheet itself must ALSO be `lg:hidden`-safe
  // — if a future refactor adds a fallback `<EditStayDetailsSheet
  // />` call site on desktop the sheet would render there and
  // duplicate the sidebar's surface. Pin the `lg:hidden`
  // guard on the backdrop so a desktop-open is structurally
  // prevented.

  it("the sheet's outer backdrop uses `lg:hidden` so the sheet cannot open on desktop", () => {
    // The backdrop is the outer `motion.div` — pinning the
    // class on the outermost element covers any inner panel
    // that the sheet might render.
    expect(sheetSrc).toMatch(/lg:hidden/);
  });

  // ── Dialog semantics ─────────────────────────────────────
  //
  // Per FRONTEND.md §Accessibility: modals trap focus + label
  // themselves. The sheet uses `role="dialog"` +
  // `aria-modal="true"` + `aria-labelledby` pointing at the
  // heading id; backdrop click + X + Escape all close it.

  it("the sheet is a proper `role=\"dialog\"` with `aria-modal=\"true\"` + `aria-labelledby`", () => {
    expect(sheetSrc).toMatch(/role=["']dialog["']/);
    expect(sheetSrc).toMatch(/aria-modal=["']true["']/);
    expect(sheetSrc).toMatch(/aria-labelledby=["']edit-stay-details-title["']/);
  });

  it("the sheet exposes a labeled close button (X icon) with `aria-label=\"Close\"`", () => {
    expect(sheetSrc).toMatch(/aria-label=["']Close["']/);
    expect(sheetSrc).toMatch(/<X\b/);
  });

  it("the backdrop click closes the sheet (the user expects click-outside to dismiss)", () => {
    expect(sheetSrc).toMatch(/onClick=\{onClose\}/);
  });

  it("the inner panel stops click propagation so clicking inside the panel doesn't dismiss the sheet", () => {
    expect(sheetSrc).toMatch(/event\.stopPropagation\(\)/);
  });

  // ── Content surface ──────────────────────────────────────
  //
  // The sheet renders the same three controls the sidebar
  // shows: DateRangePicker + Adults stepper + Children
  // stepper. The cart + info card stay on the sidebar only
  // (they're read-only and would clutter the sheet).

  it("the sheet embeds the existing DateRangePicker with the same prop surface as the sidebar", () => {
    expect(sheetSrc).toMatch(/<DateRangePicker\s+checkIn=\{checkIn\}[\s\S]+?onCheckOutChange=\{onCheckOutChange\}/);
    expect(sheetSrc).toMatch(/maxStayNights=\{maxStayNights\}/);
  });

  it("the sheet renders the Adults stepper with the min-1 / max-maxGuestCapacity clamps", () => {
    // The Adults stepper mirrors the sidebar exactly. Min 1
    // (CHD-05 "at least one adult" rule), max
    // `maxGuestCapacity` (room-availability sum).
    expect(sheetSrc).toMatch(/disabled=\{adults\s*<=\s*1\}/);
    expect(sheetSrc).toMatch(/disabled=\{adults\s*>=\s*maxGuestCapacity\}/);
  });

  it("the sheet renders the Children stepper with the soft 10 cap (CHD-11.2)", () => {
    // Per CHD-11.2 (decision #193): the soft 10 cap is the
    // sanity guard, not a domain constraint. The pre-CHD-11.2
    // per-type cap was retired (CHD-11).
    expect(sheetSrc).toMatch(/disabled=\{numChildren\s*<=\s*0\}/);
    expect(sheetSrc).toMatch(/disabled=\{numChildren\s*>=\s*10\}/);
  });

  // ── Primary action — Done ────────────────────────────────
  //
  // Per DR-03 (BOOKING-FLOW.md:74): phones get an explicit
  // Done affordance — the sheet has no click-outside, and the
  // header X is small. Full-width because it's the primary
  // action and sits in the thumb zone. The state writes are
  // LIVE so Done is a close, not a save.

  it("the sheet exposes a full-width Done button styled with `config.colors.primary`", () => {
    // Pin the brand-primary colour, the full-width shape, and
    // the label so a future copy/style regression surfaces.
    expect(sheetSrc).toMatch(/config\.colors\.primary/);
    expect(sheetSrc).toMatch(/<button[\s\S]+?w-full[\s\S]+?>[\s\S]+?Done[\s\S]+?<\/button>/);
  });

  it("the Done button's `onClick` calls `onClose` (close-only, no save — the state writes are LIVE)", () => {
    // Pin the close-only shape so a future refactor that
    // accidentally introduces a separate save step surfaces.
    expect(sheetSrc).toMatch(/<button[\s\S]+?Done[\s\S]+?onClick=\{onClose\}[\s\S]+?<\/button>/);
  });

  // ── testid surface ───────────────────────────────────────

  it("the sheet exposes `data-testid` hooks for the backdrop / close / done surfaces", () => {
    expect(sheetSrc).toMatch(/data-testid=["']edit-stay-details-backdrop["']/);
    expect(sheetSrc).toMatch(/data-testid=["']edit-stay-details-close["']/);
    expect(sheetSrc).toMatch(/data-testid=["']edit-stay-details-done["']/);
  });

  // ── BookingPage integration ──────────────────────────────

  it("BookingPage imports the new EditStayDetailsSheet component", () => {
    expect(bookingPageSrc).toMatch(/import\s*\{[^}]*\bEditStayDetailsSheet\b[^}]*\}\s*from\s*["']\.\.\/components\/EditStayDetailsSheet["']/);
  });

  it("BookingPage declares a useState for the sheet's open flag at the top of the component", () => {
    // Per React 19 rules: hooks must be unconditional. The
    // `isEditStayDetailsOpen` useState must be inside the
    // component body, not inside the `if (isSelectRoomStep)`
    // branch. The shape is `useState(false)` so the sheet
    // never opens without an explicit Edit tap.
    expect(bookingPageSrc).toMatch(/const\s+\[isEditStayDetailsOpen,\s*setIsEditStayDetailsOpen\]\s*=\s*useState\(false\)/);
  });

  it("BookingPage renders <EditStayDetailsSheet /> with the open / onClose / picker / stepper props", () => {
    expect(bookingPageSrc).toMatch(/<EditStayDetailsSheet\s+open=\{isEditStayDetailsOpen\}/);
    expect(bookingPageSrc).toMatch(/onClose=\{[\s\S]*?setIsEditStayDetailsOpen\(false\)[\s\S]*?\}/);
    expect(bookingPageSrc).toMatch(/checkIn=\{checkIn\}/);
    expect(bookingPageSrc).toMatch(/checkOut=\{checkOut\}/);
    expect(bookingPageSrc).toMatch(/maxStayNights=\{maxStayNights\}/);
    expect(bookingPageSrc).toMatch(/adults=\{adults\}/);
    expect(bookingPageSrc).toMatch(/maxGuestCapacity=\{maxGuestCapacity\}/);
    expect(bookingPageSrc).toMatch(/onAdultsChange=\{updateAdults\}/);
    expect(bookingPageSrc).toMatch(/numChildren=\{numChildren\}/);
    expect(bookingPageSrc).toMatch(/onChildrenChange=\{updateChildren\}/);
  });

  it("the StaySummaryStrip call site passes an `onEdit` callback that opens the sheet", () => {
    // The strip's `onEdit` prop is wired to the
    // `setIsEditStayDetailsOpen(true)` setter so a tap
    // dispatches the open signal.
    expect(bookingPageSrc).toMatch(/onEdit=\{[\s\S]*?setIsEditStayDetailsOpen\(true\)[\s\S]*?\}/);
  });
});