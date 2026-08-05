// Per CHD-11.3 (2026-08-05, per decision #194): source-text
// regression tests for the "symmetric auto-bump + remove all
// per-type caps from the picker" UX refinement. The
// pre-CHD-11.3 surface had two residual UX issues that violated
// the CHD-11 "exploration-first, validation-on-commit" promise:
//
//   1. "The maximum I can have is still 3" — the per-type cap
//      (`selectedMaxSelectableChildren`) was still firing in
//      `setOccupancy` and `updateChildren`.
//   2. "When I make it 6 guests, no more children it becomes 0"
//      — the `Math.max(0, safeGuests - 1)` clamp in
//      `setOccupancy` was clamping `children` down when the
//      user lowered `guests` past `children + 1`.
//
// CHD-11.3 flow:
//   1. The per-type cap (`selectedMaxSelectableChildren`) is
//      removed from `setOccupancy` and `updateChildren`. The
//      `safeChildren` clamp chain in `setOccupancy` is now
//      just the "at least 1 adult" invariant
//      (`Math.max(0, safeGuests - 1)`), with the
//      `Math.max(0, nextChildren)` floor.
//   2. `updateChildren`'s `desiredChildren` is now
//      `Math.max(nextChildren, 0)` (no per-type cap).
//   3. `updateGuests` has a symmetric auto-bump:
//      `newGuests = Math.max(nextGuests, numChildren + 1)`. If
//      the user lowers `guests` below `children + 1`, the
//      `guests` is bumped up to `children + 1` instead of
//      clamping `children` down.
//   4. The `selectedMaxSelectableChildren` derivation stays
//      (used by the "Up to N can fit when extra beds cover the
//      overflow" hint in the chip).
//   5. The `Math.max(0, safeGuests - 1)` clamp stays as defense
//      in depth.
//   6. The `+` button's `disabled` condition is `numChildren >= 10`
//      (CHD-11.2's soft cap, unchanged).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.3 — symmetric auto-bump + remove all per-type caps from the picker", () => {
  it("the `setOccupancy` `safeChildren` clamp chain has NO `selectedMaxSelectableChildren` (the per-type cap is gone)", () => {
    // The pre-CHD-11.3 chain was
    // `Math.min(Math.max(nextChildren, 0),
    //  selectedMaxSelectableChildren,
    //  Math.max(0, safeGuests - 1))`.
    // The new chain is `Math.max(0,
    //  Math.min(nextChildren, safeGuests - 1))`
    // — just the "at least 1 adult" invariant.
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests - 1\)\s*\)/
    );
    // The pre-CHD-11.3 chain is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.min\(\s*Math\.max\(nextChildren, 0\),\s*selectedMaxSelectableChildren,\s*Math\.max\(0, safeGuests - 1\)\s*\)/
    );
  });

  it("the `updateChildren` `desiredChildren` is `Math.max(nextChildren, 0)` (NO per-type cap)", () => {
    // The pre-CHD-11.3 chain was
    // `Math.min(Math.max(nextChildren, 0),
    //  selectedMaxSelectableChildren)`.
    // The new chain is just `Math.max(nextChildren, 0)`.
    expect(bookingPageSrc).toMatch(
      /const desiredChildren = Math\.max\(nextChildren, 0\)/
    );
    // The pre-CHD-11.3 chain (with the per-type cap)
    // is gone.
    expect(bookingPageSrc).not.toMatch(
      /const desiredChildren = Math\.min\(\s*Math\.max\(nextChildren, 0\),\s*selectedMaxSelectableChildren\s*\)/
    );
  });

  it("`updateChildren` still has the CHD-11.1 auto-bump (`newGuests = Math.max(guests, desiredChildren + 1)`)", () => {
    // The auto-bump is unchanged from CHD-11.1.
    // It bumps `guests` up to `children + 1` if
    // the desired children count would leave 0
    // adults.
    expect(bookingPageSrc).toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
  });

  it("`updateGuests` has the CHD-11.3 symmetric auto-bump (`newGuests = Math.max(nextGuests, numChildren + 1)`)", () => {
    // The pre-CHD-11.3 shape called
    // `setOccupancy(nextGuests, numChildren)`
    // directly, which would clamp `children` down
    // via the `Math.max(0, safeGuests - 1)`
    // defense-in-depth clamp — the user saw
    // "children becomes 0".
    // The new shape computes
    // `newGuests = Math.max(nextGuests,
    //  numChildren + 1)` and calls
    // `setOccupancy(newGuests, numChildren)`.
    expect(bookingPageSrc).toMatch(
      /const newGuests = Math\.max\(nextGuests, numChildren \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /setOccupancy\(newGuests, numChildren\)/
    );
    // The pre-CHD-11.3 direct call is gone.
    expect(bookingPageSrc).not.toMatch(
      /function updateGuests\(nextGuests: number\) \{[\s\S]{0,200}setOccupancy\(nextGuests, numChildren\)/
    );
  });

  it("the `Math.max(0, safeGuests - 1)` clamp stays as defense in depth in `setOccupancy`", () => {
    // The clamp is the final defense against
    // deep-links + race conditions that could
    // bypass the auto-bump. The user-driven
    // case is covered by the symmetric
    // auto-bump in `updateGuests`; the clamp
    // catches the edge cases.
    expect(bookingPageSrc).toMatch(
      /Math\.min\(nextChildren, safeGuests - 1\)/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation is still present (used by the chip's hint text)", () => {
    // The derivation stays — it's used by the
    // "Up to N can fit when extra beds cover the
    // overflow" hint in the chip. It's no
    // longer a clamp on the picker, but the
    // hint text still references it.
    expect(bookingPageSrc).toMatch(
      /const selectedMaxSelectableChildren = useMemo\(\(\) => \{/
    );
  });

  it("the `selectedMaxSelectableChildren` is NOT used in any clamping chain (only in the chip's hint text)", () => {
    // The per-type cap is removed from
    // `setOccupancy` + `updateChildren` clamping.
    // It's still used in the chip's hint text at
    // `BookingPage.tsx:2284-2285`:
    //   `{selectedMaxSelectableChildren > selectedMaxChildren
    //     ? \` Up to ${selectedMaxSelectableChildren} can fit...\`}`
    // The derivation is still used; the
    // clamping chains are not.
    // Slice the `setOccupancy` body — the function
    // opens with `function setOccupancy(...) {` and
    // closes with the matching `}` at the same
    // indent. We use the `Math.max(0,\n    Math.min`
    // anchor (the start of the new clamp chain) as
    // the start, and the closing `}` (at the same
    // indent) as the end.
    const setOccupancyStart = bookingPageSrc.indexOf(
      "function setOccupancy(nextGuests: number, nextChildren: number)"
    );
    const setOccupancyEnd = bookingPageSrc.indexOf(
      "}\n\n  function updateGuests(",
      setOccupancyStart
    );
    const setOccupancyBody = bookingPageSrc.slice(
      setOccupancyStart,
      setOccupancyEnd
    );
    expect(setOccupancyBody).not.toMatch(/selectedMaxSelectableChildren/);
    // Same for `updateChildren` — anchor on
    // `function updateChildren` and the closing
    // `}` before `function validateUploadFile`.
    const updateChildrenStart = bookingPageSrc.indexOf(
      "function updateChildren(nextChildren: number)"
    );
    const updateChildrenEnd = bookingPageSrc.indexOf(
      "}\n\n  function validateUploadFile(",
      updateChildrenStart
    );
    const updateChildrenBody = bookingPageSrc.slice(
      updateChildrenStart,
      updateChildrenEnd
    );
    expect(updateChildrenBody).not.toMatch(/selectedMaxSelectableChildren/);
  });

  it("the `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged)", () => {
    // The picker cap (10) is unchanged from
    // CHD-11.2. The per-type cap is gone from
    // the picker.
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
  });

  it("the submit gate (`cartFitsGroup` derivation) is unchanged (the picker is no longer the enforcement layer)", () => {
    // The submit gate catches the over-cap
    // case at Step 1 → Step 2. The picker
    // is no longer the enforcement layer;
    // the gate is.
    expect(bookingPageSrc).toMatch(/cartFitsGroup/);
    expect(bookingPageSrc).toMatch(
      /cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation's formula is unchanged (CHD-11.1's auto-bump scenario stays)", () => {
    // The derivation itself is unchanged.
    // It still uses `effectiveGuests = max(guests,
    // N + 1)` to model the auto-bump scenario.
    // The derivation is no longer used as a
    // clamp on the picker, but it's still
    // computed (for the chip's hint text).
    expect(bookingPageSrc).toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /const numAdults = effectiveGuests - children/
    );
  });
});
