// Per BR-10 (Phase 14 — Cut-off toggle + Skip add-ons,
// decision #244 reserved, 2026-10-14): the walk-in
// modal (BookingsPage.tsx) + calendar-create modal
// (CalendarPage.tsx) both render the Add-ons step
// (Step 2) with TWO parallel CTAs:
//
//   - **Primary**  "Continue to guest details"
//     — mirrored from the pre-BR-10 single button.
//
//   - **Ghost**    "No add-ons, continue"
//     — the new skip-addons affordance, identical
//     label across all five BR-10 surfaces
//     (BookingPage, CorporateBookingPage,
//     BookingsPage walk-in, CalendarPage calendar-
//     create, and the future BR-12 per-stay
//     add-ons surface).
//
// Both buttons on the admin modals call the
// IDENTICAL `nextStep` callback (the
// `setWalkinStep` / `setCalendarStep` arrow that
// bumps the step counter). They differ only by
// label + visual style. The BR-10 invariant is
// "both buttons call the same nextStep function"
// — tripwires pin that the onClick handlers in
// both buttons reference the same state-setter
// arrow.
//
// All assertions are byte-stable source-text
// tripwires (no runtime fixtures, no JSDOM).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);

describe("BR-10 — walk-in modal (BookingsPage.tsx) Add-ons dual CTA", () => {
  /**
   * Extract the BR-10 dual-button block from the
   * walk-in modal. The block is anchored on the
   * unique `data-testid="walkin-addons-skip-addons"`
   * (no other element in the file carries that
   * testid). We back-walk to the opening `<div
   * className="flex flex-wrap items-center gap-2">`
   * container + comment block, and forward to the
   * closing `</div>` of the inner Wrap (the ghost
   * button's sibling).
   */
  const skipAnchorIdx = bookingsPageSrc.indexOf(
    'data-testid="walkin-addons-skip-addons"'
  );
  const blockStartIdx = bookingsPageSrc.lastIndexOf(
    "<div className=\"flex flex-wrap items-center gap-2\">",
    skipAnchorIdx
  );
  // The block closes after the ghost button. The
  // ghost button's closing `</button>` is unique
  // here because it's the only `<button>` inside the
  // dual-button container after the primary. We
  // forward-scan for two closing `</button>` tags (the
  // primary + the ghost) and capture up to the second
  // `</div>` after that. For robustness, anchor on
  // the literal "Continue to review" string from the
  // primary button — it lives RIGHT BEFORE the ghost
  // button.
  const reviewLabelIdx = bookingsPageSrc.indexOf(
    "Continue to review",
    skipAnchorIdx
  );
  const blockEndIdx = bookingsPageSrc.lastIndexOf(
    "</button>",
    bookingsPageSrc.indexOf("</div>", skipAnchorIdx)
  );
  const block =
    blockStartIdx >= 0 && skipAnchorIdx >= 0 && blockEndIdx > skipAnchorIdx
      ? bookingsPageSrc.slice(blockStartIdx, blockEndIdx + "</button>".length)
      : null;

  it("renders the primary 'Continue to guest details' CTA on walk-in Step 2", () => {
    // The walk-in modal shares the same primary
    // label as the public + corporate flows. The
    // `${walkinStep === 2 && "Continue to guest
    // details"}` ternary lives in the same `<button>`
    // body — pin the literal.
    expect(bookingsPageSrc).toMatch(/Continue to guest details/);
  });

  it("renders the ghost 'No add-ons, continue' CTA on walk-in Step 2", () => {
    // The ghost CTA is bound to `walkinStep === 2`
    // so it only renders when the staff is actually
    // on the Add-ons step. The button label is the
    // user-requested verbatim string.
    expect(bookingsPageSrc).toMatch(/No add-ons, continue/);
    // And the conditional that gates its visibility
    // is `walkinStep === 2` (matches the BR-09
    // pre-condition: skip affordance only on
    // Add-ons).
    expect(block, "Walk-in dual-button block not found").not.toBeNull();
    const blockText = block!;
    // Anchor the ghost button conditionally on
    // `walkinStep === 2`. The regex looks for the
    // `{walkinStep === 2 && (` open of the JSX
    // conditional that wraps the ghost `<button>`.
    expect(blockText).toMatch(/\{\s*walkinStep\s*===\s*2\s*&&/);
  });

  it("both walk-in buttons call the IDENTICAL `setWalkinStep` advance callback", () => {
    // BR-10 invariant: the two CTAs must call the
    // SAME `nextStep` function. The walk-in modal
    // uses `setWalkinStep((current) => (current < 4
    // ? ((current + 1) as 1 | 2 | 3 | 4) :
    // current))` for the advance. The primary button's
    // onClick + the ghost button's onClick must both
    // reference this exact arrow. Pin via the
    // onClick value repeated twice inside the BR-10
    // block.
    expect(block).not.toBeNull();
    const blockText = block!;
    // Two matches: one for the primary, one for
    // the ghost. The arrow body must be identical.
    const arrowBody =
      /setWalkinStep\(\(current\) => \(current < 4 \? \(\(current \+ 1\) as 1 \| 2 \| 3 \| 4\) : current\)\)/g;
    const matches = blockText.match(arrowBody) || [];
    expect(
      matches.length,
      `expected 2 onClick arrows to setWalkinStep, found ${matches.length}`
    ).toBe(2);
  });

  it("walk-in ghost button uses the muted ghost-variant classes", () => {
    // Same FRONTEND.md §Button Variants muted recipe
    // as the public + corporate flows:
    // `border-gray-300 bg-transparent px-4 text-gray-500
    // hover:bg-gray-50`. Pin via the ghost `<button>`
    // JSX string.
    expect(bookingsPageSrc).toMatch(
      /data-testid="walkin-addons-skip-addons"[\s\S]{0,300}?className="[^"]*\bborder-gray-300\b[^"]*\bbg-transparent\b[^"]*\btext-gray-500\b[^"]*\bhover:bg-gray-50\b/
    );
  });
});

describe("BR-10 — calendar-create modal (CalendarPage.tsx) Add-ons dual CTA", () => {
  /**
   * Mirror of the BookingsPage anchor — same
   * `data-testid="calendar-addons-skip-addons"`
   * uniqueness property.
   */
  const skipAnchorIdx = calendarPageSrc.indexOf(
    'data-testid="calendar-addons-skip-addons"'
  );
  const blockStartIdx = calendarPageSrc.lastIndexOf(
    "<div className=\"flex gap-2\">",
    skipAnchorIdx
  );
  // The block closes after the ghost button.
  // Anchor on the `<PrimaryButton type="submit">Place booking</PrimaryButton>`
  // marker — it lives right after the dual-button
  // block, and the BR-10 conditional ensures the
  // ghost `<button>` is the SECOND `</button>` before
  // the `<PrimaryButton>`.
  const reviewLabelIdx = calendarPageSrc.indexOf(
    "Continue to review",
    skipAnchorIdx
  );
  const blockEndIdx = calendarPageSrc.lastIndexOf(
    "</button>",
    calendarPageSrc.indexOf("<PrimaryButton", skipAnchorIdx)
  );
  const block =
    blockStartIdx >= 0 && skipAnchorIdx >= 0 && blockEndIdx > skipAnchorIdx
      ? calendarPageSrc.slice(blockStartIdx, blockEndIdx + "</button>".length)
      : null;

  it("renders the primary 'Continue to guest details' CTA on calendar Step 2", () => {
    expect(calendarPageSrc).toMatch(/Continue to guest details/);
  });

  it("renders the ghost 'No add-ons, continue' CTA on calendar Step 2", () => {
    expect(calendarPageSrc).toMatch(/No add-ons, continue/);
    expect(block, "Calendar dual-button block not found").not.toBeNull();
    const blockText = block!;
    expect(blockText).toMatch(/\{\s*calendarStep\s*===\s*2\s*&&/);
  });

  it("both calendar buttons call the IDENTICAL `setCalendarStep` advance callback", () => {
    // BR-10 invariant for the calendar modal: the
    // primary button's onClick + the ghost button's
    // onClick must both reference the exact same
    // `setCalendarStep` arrow.
    expect(block).not.toBeNull();
    const blockText = block!;
    const arrowBody =
      /setCalendarStep\(\(current\) => \(current < 4 \? \(\(current \+ 1\) as 1 \| 2 \| 3 \| 4 \| 5\) : current\)\)/g;
    const matches = blockText.match(arrowBody) || [];
    expect(
      matches.length,
      `expected 2 onClick arrows to setCalendarStep, found ${matches.length}`
    ).toBe(2);
  });

  it("calendar ghost button uses the muted ghost-variant classes", () => {
    expect(calendarPageSrc).toMatch(
      /data-testid="calendar-addons-skip-addons"[\s\S]{0,300}?className="[^"]*\bborder-gray-300\b[^"]*\bbg-transparent\b[^"]*\btext-gray-500\b[^"]*\bhover:bg-gray-50\b/
    );
  });
});

describe("BR-10 — admin step modal BR-10 comments are in place", () => {
  /**
   * Both admin modals open their BR-10 dual-button
   * block with a `// Per BR-10 (decision #244
   * reserved, 2026-10-14 — Phase 14): …` comment.
   * Those comments describe the BR-10 invariant in
   * plain English next to the code so a future
   * reviewer understands why we use the muted gray
   * recipe + why both onClick arrows are
   * byte-identical. Pin the literal comment header
   * so a refactor that drops the explanation also
   * drops the rationale (and surfaces in code
   * review).
   *
   * Note: the source-text layout wraps the comment
   * at 60 columns — the literal `— Phase 14):` lives
   * on the line AFTER `2026-10-14 —` (with a
   * single-space indent between). The regex uses
   * `[\s\S]*?` between the two anchors so it
   * handles the wrap, and the start anchor is
   * shortened so a copy-edit at one end doesn't
   * break the tripwire.
   */
  it("BookingsPage.tsx has the BR-10 dual-button rationale comment", () => {
    expect(bookingsPageSrc).toMatch(
      /Per BR-10 \(decision #244 reserved, 2026-10-14[\s\S]*?the walk-in modal's Add-ons step/
    );
  });

  it("CalendarPage.tsx has the BR-10 dual-button rationale comment", () => {
    // The CalendarPage comment wraps at 60 cols more
    // aggressively than the BookingsPage one — anchor
    // on the unique opening phrase + the closing
    // "renders TWO parallel" + "Add-ons step" separately
    // so the tripwire survives wrap-margin edits.
    expect(calendarPageSrc).toMatch(
      /Per BR-10 \(decision #244 reserved, 2026-10-14[\s\S]*?the calendar-create modal[\s\S]*?Add-ons step[\s\S]*?renders TWO parallel/
    );
  });
});
