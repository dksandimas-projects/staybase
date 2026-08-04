// Per CHD-13 (2026-08-04, per decision #187): source-text
// regression tests for the homepage "Guests" popover. The
// pre-CHD-13 widget at `guest-app/src/pages/HomePage.tsx:194-228`
// was a flat `<select>` for 1-6 guests with no children split.
// The CHD-13 widget:
//   1. Replaces the flat `<select>` with a popover trigger
//      button (`aria-haspopup="dialog"` + `aria-expanded`).
//   2. The popover contains two stepper rows — "Adults"
//      (1-10, default 2) + "Children (0-11)" (0-10, default
//      0) — matching the `/book` picker shape.
//   3. The trigger label shows the current split
//      ("2 adults" or "2 adults, 1 child").
//   4. The popover dismisses on outside click + Escape
//      (mirrors the Navbar dropdown pattern at
//      `Navbar.tsx:65-75`).
//   5. The `Search` button navigates to `/book` with
//      `guests=adults+children` + `children=N` (the `/book`
//      page already reads both at `BookingPage.tsx:214`
//      and `:220`).
//   6. The single `guests` state is replaced with two
//      `adults` + `children` states (`total` is derived).
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural emulator test
// (real click on the trigger, real popover open, real search
// navigation) is out of scope for this sandbox.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const homePageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/HomePage.tsx"),
  "utf8"
);

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

// Slice the Guests popover block — the trigger button
// + the popover panel + the two stepper rows + the
// Done button. Use a unique comment marker to anchor
// the start (the JSX comment that opens the popover
// block, distinct from the state-initialization
// comment at the top of the function), and the
// Search `<PrimaryButton onClick={searchAvailability}>`
// (the third column in the availability-checker
// grid) as the end. The "the \"Guests\" field is now
// a popover" string is only present in this block.
const popoverStart = homePageSrc.indexOf(
  "the \"Guests\" field is now a popover"
);
const popoverEnd = homePageSrc.indexOf(
  "onClick={searchAvailability}",
  popoverStart
);
const popoverSlice =
  popoverStart >= 0 && popoverEnd > popoverStart
    ? homePageSrc.slice(popoverStart, popoverEnd)
    : "";

describe("CHD-13 — the flat 1-6 guest `<select>` is gone from the homepage", () => {
  it("the old `<select>` with 1-6 options is removed from HomePage", () => {
    // The pre-CHD-13 widget was a flat `<select>` with
    // options 1..6. The CHD-13 widget is a popover with
    // two steppers. The 1-6 options array must be gone
    // (and so must the `<select>` itself).
    expect(homePageSrc).not.toMatch(/\[1, 2, 3, 4, 5, 6\]\.map/);
    // The old `<select>` element is gone.
    expect(homePageSrc).not.toMatch(/<select[\s\S]*?value=\{guests\}/);
  });

  it("the single `guests` `useState` is replaced with two `adults` + `children` states", () => {
    // The pre-CHD-13 state was `const [guests, setGuests] = useState(2)`.
    // The CHD-13 state is two `useState<number>` calls —
    // `adults` (default 2) + `children` (default 0). The
    // `total` is derived as `adults + children`.
    expect(homePageSrc).not.toMatch(/const \[guests, setGuests\] = useState\(2\)/);
    expect(homePageSrc).toMatch(/const \[adults, setAdults\] = useState\(2\)/);
    expect(homePageSrc).toMatch(/const \[children, setChildren\] = useState\(0\)/);
    expect(homePageSrc).toMatch(/const total = adults \+ children/);
  });
});

describe("CHD-13 — the popover trigger button is the new first surface", () => {
  it("the trigger has the standard popover a11y contract", () => {
    // The trigger is a `<button>` with:
    // - `aria-haspopup="dialog"` (announces a dialog popover)
    // - `aria-expanded={popoverOpen}` (announces open/closed)
    // - `aria-controls="guests-popover"` (links to the popover id)
    // - `data-testid="guests-trigger"` (test surface)
    expect(popoverSlice).toMatch(/aria-haspopup="dialog"/);
    expect(popoverSlice).toMatch(/aria-expanded=\{popoverOpen\}/);
    expect(popoverSlice).toMatch(/aria-controls="guests-popover"/);
    expect(popoverSlice).toMatch(/data-testid="guests-trigger"/);
  });

  it("the trigger label shows the current adults + children split", () => {
    // Per the spec: the trigger label is "N adults"
    // when `children === 0`, or "N adults, M child(ren)"
    // when `children > 0`. The implementation uses an
    // inline conditional on the `children` count.
    expect(popoverSlice).toMatch(/\{adults\} \{adults === 1 \? "adult" : "adults"\}/);
    // The "with children" branch is gated on `children > 0`.
    expect(popoverSlice).toMatch(/\{children > 0\s*\?/);
    expect(popoverSlice).toMatch(/\$\{children\} \$\{children === 1 \? "child" : "children"\}/);
  });

  it("the trigger's onClick toggles the popover open/closed", () => {
    // The standard popover pattern: clicking the
    // trigger toggles the popover. The implementation
    // uses `setPopoverOpen((open) => !open)` for the
    // toggle.
    expect(popoverSlice).toMatch(/onClick=\{\(\) => setPopoverOpen\(\(open\) => !open\)\}/);
  });

  it("the trigger's chevron rotates 180° when the popover is open", () => {
    // Standard popover pattern: the chevron rotates
    // when the popover is open (visual cue).
    expect(popoverSlice).toMatch(/popoverOpen \? "rotate-180" : ""/);
  });
});

describe("CHD-13 — the popover panel is the new selection surface", () => {
  it("the popover has the dialog a11y contract", () => {
    // The popover is a `<div>` with:
    // - `role="dialog"` (announces a dialog)
    // - `aria-labelledby="guests-popover-title"` (links to the title)
    // - `id="guests-popover"` (the trigger's `aria-controls` target)
    // - `data-testid="guests-popover"` (test surface)
    expect(popoverSlice).toMatch(/role="dialog"/);
    expect(popoverSlice).toMatch(/aria-labelledby="guests-popover-title"/);
    expect(popoverSlice).toMatch(/id="guests-popover"/);
    expect(popoverSlice).toMatch(/data-testid="guests-popover"/);
  });

  it("the popover contains two stepper rows: 'Adults' + 'Children (0–11)'", () => {
    // The two stepper rows. The "Children (0-11)" label
    // matches the /book picker shape (the same age range
    // label surfaces in both places).
    expect(popoverSlice).toMatch(/data-testid="adults-stepper"/);
    expect(popoverSlice).toMatch(/data-testid="children-stepper"/);
    expect(popoverSlice).toMatch(/Children \(0.11\)/);
  });

  it("the Adults stepper is min 1 max 10 (matches the /book 'at least one adult' invariant)", () => {
    // The Adults stepper's `[−]` is disabled at
    // `adults <= 1`; the `[+]` is disabled at
    // `adults >= 10`. The state is clamped via
    // `Math.max(1, ...)` and `Math.min(10, ...)`
    // to be safe.
    expect(popoverSlice).toMatch(/disabled=\{adults <= 1\}/);
    expect(popoverSlice).toMatch(/disabled=\{adults >= 10\}/);
    expect(popoverSlice).toMatch(/setAdults\(Math\.max\(1, adults - 1\)\)/);
    expect(popoverSlice).toMatch(/setAdults\(Math\.min\(10, adults \+ 1\)\)/);
  });

  it("the Children stepper is min 0 max 10 (matches the /book picker soft cap)", () => {
    // The Children stepper's `[−]` is disabled at
    // `children <= 0`; the `[+]` is disabled at
    // `children >= 10`. The state is clamped via
    // `Math.max(0, ...)` and `Math.min(10, ...)`.
    expect(popoverSlice).toMatch(/disabled=\{children <= 0\}/);
    expect(popoverSlice).toMatch(/disabled=\{children >= 10\}/);
    expect(popoverSlice).toMatch(/setChildren\(Math\.max\(0, children - 1\)\)/);
    expect(popoverSlice).toMatch(/setChildren\(Math\.min\(10, children \+ 1\)\)/);
  });

  it("the Children stepper has `aria-label=\"Children count\"` and `aria-live=\"polite\"` (matches the /book picker shape)", () => {
    // The Children count `<span>` carries the
    // `aria-label="Children count"` + `aria-live="polite"`
    // attributes — same shape as the /book picker at
    // `BookingPage.tsx:2149` (the spec calls this out
    // explicitly).
    expect(popoverSlice).toMatch(/aria-label="Children count"/);
    expect(popoverSlice).toMatch(/aria-live="polite"/);
  });

  it("the 'Done' button closes the popover", () => {
    // The "Done" button is the primary dismiss action
    // (alongside outside-click + Escape).
    expect(popoverSlice).toMatch(/data-testid="guests-popover-done"/);
    expect(popoverSlice).toMatch(/onClick=\{\(\) => setPopoverOpen\(false\)\}/);
  });
});

describe("CHD-13 — the popover dismisses on outside click + Escape (mirrors the Navbar dropdown)", () => {
  it("the popover has a click-outside dismissal via `mousedown`", () => {
    // The popover is dismissed when the user
    // `mousedown`s outside both the popover panel
    // and the trigger. Mirrors the Navbar dropdown
    // pattern at `Navbar.tsx:65-75`.
    expect(homePageSrc).toMatch(/document\.addEventListener\("mousedown", handleMouseDown\)/);
    // The handler closes the popover when the target
    // is outside the popover + trigger.
    expect(homePageSrc).toMatch(
      /popoverRef\.current[\s\S]{0,200}!popoverRef\.current\.contains\(e\.target as Node\)/
    );
  });

  it("the popover dismisses on Escape key", () => {
    // Standard popover behavior — Escape closes
    // the popover.
    expect(homePageSrc).toMatch(/if \(e\.key === "Escape"\) setPopoverOpen\(false\)/);
  });
});

describe("CHD-13 — the Search button URL contract carries `children`", () => {
  it("`searchAvailability` includes `children: String(children)` in the URL params", () => {
    // The URL contract gains `children` so the
    // `/book` page can pre-fill its own `numChildren`
    // state at `BookingPage.tsx:220` from
    // `searchParams.get("children")`. The `guests`
    // param is updated to `total` (`adults +
    // children`).
    expect(homePageSrc).toMatch(
      /guests: String\(total\)/
    );
    expect(homePageSrc).toMatch(
      /children: String\(children\)/
    );
  });

  it("`/book` still reads `searchParams.get(\"children\")` (the pre-fill is unchanged)", () => {
    // The /book page's pre-fill at `BookingPage.tsx:220`
    // is unchanged. The homepage widget is just sending
    // the new param; the reader stays.
    expect(bookingPageSrc).toMatch(
      /Number\(searchParams\.get\("children"\) \?\? 0\)/
    );
  });
});
