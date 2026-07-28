// Per `plan/bugs/walkin-booking-modal-scrollability.md` (shipped 2026-07-08
// in commit `2d99946` / `a249a3e`, marked shipped in `7a6bc02` / `2ae1980`)
// and `plan/docs/FRONTEND.md §Modals`. The walk-in booking modal used to
// clip form inputs and footer buttons on smaller viewports (e.g. 13-inch
// laptops) because the modal wrapper had no `max-h` constraint, the
// motion.section was set to `h-full max-h-full` (which let the natural
// content height blow past the viewport), the scrollable body div did
// not have `min-h-0` (so nested flex children refused to shrink and
// scroll), and the Cancel/Confirm buttons lived inside the form body
// (so they got clipped along with the rest of the form). The shipped
// fix:
//
//   1. Desktop wrapper gets `max-h-[90vh]` (true viewport-bounded constraint).
//   2. Desktop motion.section is `flex min-h-0 w-full flex-1 flex-col` so
//      flexbox can actually shrink it below its natural content height.
//   3. Desktop body div gains `min-h-0` (required for `overflow-y-auto`
//      to fire on a flex child).
//   4. Mobile wrapper is `max-h-[95vh]`; mobile body div is
//      `flex-1 overflow-y-auto`.
//   5. Cancel/Confirm buttons moved out of the scrollable form body into
//      the Modal `footer` prop (and the form gained `id="walkin-form"`
//      so the buttons can still submit the form via `form="walkin-form"`).
//   6. The footer is wrapped in a `shrink-0` div so it stays pinned at
//      the bottom regardless of scroll position.
//
// These tests pin the contract so a refactor that re-introduces any of
// the failure modes fails CI. The checks are intentionally
// source-text-shaped (matching the structure, not a runtime render)
// because the failure mode is a CSS-class arrangement, not a JS
// behavior.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Walk-in modal scrollability (regression for plan/bugs/walkin-booking-modal-scrollability.md)", () => {
  const modal = read("admin-app/src/components/Modal.tsx");
  const bookingsPage = read("admin-app/src/pages/BookingsPage.tsx");

  // ─── 1. Desktop panel: viewport-bounded constraint ───────────────────

  it("Desktop modal panel has a max-h-[90vh] constraint on its outer wrapper", () => {
    // The fixed-positioned wrapper around the desktop motion.section must
    // bound its height to the viewport. The fix moved the old inline
    // `style={{ maxHeight: "90vh" }}` into a Tailwind class so the
    // constraint is part of the layout flow (and so `shrink-0` + flex
    // children can size against it).
    const desktopWrapperClass = modal.match(
      /"pointer-events-auto fixed left-1\/2 top-1\/2 z-\[60\][^"]*"/
    );
    expect(desktopWrapperClass, "expected to find the desktop modal wrapper class string").not.toBeNull();
    expect(desktopWrapperClass?.[0]).toMatch(/max-h-\[90vh\]/);
  });

  it("Desktop wrapper does NOT carry an inline style maxHeight (replaced by Tailwind class)", () => {
    // The original layout had `style={{ maxHeight: "90vh" }}` on the
    // wrapper. That was moved to `max-h-[90vh]` so the constraint plays
    // well with the surrounding flex layout. A regression that re-adds
    // the inline style would not necessarily break the scroll, but it
    // would re-introduce the original code smell the fix removed.
    const inlineMaxHeight = modal.match(/style=\{\{\s*maxHeight\s*:/);
    expect(inlineMaxHeight, "expected no inline `style={{ maxHeight: ... }}` on the modal wrapper").toBeNull();
  });

  // ─── 2. Desktop motion.section: flex-1 + min-h-0 ─────────────────────

  it("Desktop motion.section is flex min-h-0 w-full flex-1 flex-col (so it can shrink below its natural height)", () => {
    // `min-h-0` is the magic line. Without it, a flex child refuses to
    // shrink below its content's intrinsic height, so `overflow-y-auto`
    // on the child never fires. The shipped fix replaced the old
    // `flex h-full max-h-full w-full flex-col` shape with the
    // `min-h-0 flex-1` shape.
    const desktopSection = modal.match(
      /className="flex min-h-0 w-full flex-1 flex-col"/
    );
    expect(desktopSection, "expected to find the desktop motion.section className=\"flex min-h-0 w-full flex-1 flex-col\"").not.toBeNull();
  });

  it("Desktop motion.section does NOT use the pre-fix h-full max-h-full shape", () => {
    // The pre-fix shape `flex h-full max-h-full w-full flex-col` is the
    // one that let the natural content height blow past the viewport.
    // This guard pins the removal of the broken shape (any motion.section
    // in the file should not carry it).
    const preFixShape = modal.match(/flex h-full max-h-full w-full flex-col/);
    expect(preFixShape, "expected no motion.section to use the pre-fix `flex h-full max-h-full w-full flex-col` shape").toBeNull();
  });

  // ─── 3. Desktop body div: min-h-0 + overflow-y-auto ──────────────────

  it("Desktop scrollable body has min-h-0 flex-1 overflow-y-auto", () => {
    // The body div is the actual scroll container. It needs both
    // `min-h-0` (to allow flex shrinking) and `overflow-y-auto` (to
    // render the scrollbar when content exceeds the constrained height).
    // The fix added `min-h-0` to the existing `flex-1 overflow-y-auto`
    // pair.
    const desktopBody = modal.match(
      /<div className="min-h-0 flex-1 overflow-y-auto p-5">/
    );
    expect(desktopBody, "expected desktop body div to have min-h-0 flex-1 overflow-y-auto").not.toBeNull();
  });

  // ─── 4. Footer is shrink-0 so it stays pinned at the bottom ──────────

  it("Desktop footer div is shrink-0 (stays pinned below the scrollable body)", () => {
    // The Cancel/Confirm buttons must remain visible regardless of how
    // far down the form scrolls. The `shrink-0` class on the footer
    // wrapper prevents the flex layout from squeezing it as the body
    // scrolls.
    const desktopFooter = modal.match(
      /footer \? <div className="([^"]+)"/
    );
    expect(desktopFooter, "expected to find the desktop footer conditional render").not.toBeNull();
    expect(desktopFooter?.[1]).toMatch(/shrink-0/);
  });

  // ─── 5. Mobile panel: viewport-bounded + scrollable body ─────────────

  it("Mobile modal panel has max-h-[95vh] and a flex-1 overflow-y-auto body", () => {
    // The mobile variant uses a bottom-sheet shape. It still needs the
    // `max-h-[95vh]` constraint and a `flex-1 overflow-y-auto` body so
    // the same scrollability contract holds on small screens.
    const mobilePanel = modal.match(
      /fixed inset-x-0 bottom-0 z-\[60\] flex max-h-\[95vh\]/
    );
    expect(mobilePanel, "expected mobile panel to have max-h-[95vh]").not.toBeNull();

    const mobileBody = modal.match(
      /<div className="flex-1 overflow-y-auto px-5 py-4">/
    );
    expect(mobileBody, "expected mobile body div to have flex-1 overflow-y-auto").not.toBeNull();
  });

  // ─── 6. Walk-in modal: form is the scrollable body ───────────────────

  it("Walk-in modal form has id=\"walkin-form\" matching the footer's form= attribute", () => {
    // The fix split the walk-in form from the action row. The form is
    // now the Modal `children` (scrollable body) and the buttons live
    // in the Modal `footer` prop. Because the buttons are no longer
    // children of the <form>, they need `form="walkin-form"` to keep
    // working — the form has to carry that exact id.
    const walkinForm = bookingsPage.match(
      /<form[\s\S]*?id="walkin-form"[\s\S]*?className="space-y-4 text-sm"/
    );
    expect(walkinForm, "expected walk-in form to have id=\"walkin-form\" with the space-y-4 text-sm class").not.toBeNull();
  });

  it("Walk-in modal's Cancel + Confirm Reservation buttons live in the Modal footer prop (not inside the scrollable form body)", () => {
    // The fix moved Cancel + Confirm Reservation out of the <form> body
    // and into the Modal `footer` prop so they stay pinned at the
    // bottom. The `form="walkin-form"` attribute on each button keeps
    // the submit wired up.
    const walkinModal = bookingsPage.match(
      /<Modal[\s\S]*?title="Create Walk-in Booking"[\s\S]*?<\/Modal>/
    );
    expect(walkinModal, "expected to find the walk-in Modal block").not.toBeNull();
    expect(walkinModal?.[0]).toMatch(/footer=\{/);
    expect(walkinModal?.[0]).toMatch(/<button[\s\S]*?type="button"[\s\S]*?form="walkin-form"[\s\S]*?>\s*Cancel\s*<\/button>/);
    expect(walkinModal?.[0]).toMatch(/<PrimaryButton[\s\S]*?type="submit"[\s\S]*?form="walkin-form"[\s\S]*?>\s*\{isWalkinSubmitting \? "Confirming\.\.\." : "Confirm Reservation"\}\s*<\/PrimaryButton>/);
  });

  it("Walk-in form is NOT followed by an inline action row inside the <form> (the old layout)", () => {
    // The pre-fix layout had Cancel + Confirm inside the <form> at the
    // end. Once the form scrolls past the viewport, those buttons
    // became inaccessible. The fix removed the inline action row. This
    // guard pins the removal: the walk-in form should close with the
    // pricing summary div, and the next thing after `</form>` should
    // be the closing `</Modal>` (or another unrelated Modal).
    const inlineActionRow = bookingsPage.match(
      /<span>\{formatPrice\(priceOverride !== "" \? Number\(priceOverride\) : totalPrice\)\}<\/span>\s*<\/div>\s*\{\/\* Action Row \*\/\}/
    );
    expect(inlineActionRow, "expected the inline 'Action Row' comment + Cancel/Confirm buttons to be removed from the walk-in form body").toBeNull();
  });
});
