// Per CHD-11.3 (2026-08-05, per decision #194) and its
// reversal in CHD-11.4 (decision #195): source-text
// regression tests for the "symmetric auto-bump + remove
// all per-type caps from the picker" UX refinement. The
// pre-CHD-11.3 surface had two residual UX issues that
// violated the CHD-11 "exploration-first, validation-on-
// commit" promise:
//
//   1. "The maximum I can have is still 3" — the per-type
//      cap (`selectedMaxSelectableChildren`) was still
//      firing in `setOccupancy` and `updateChildren`.
//   2. "When I make it 6 guests, no more children it
//      becomes 0" — the `Math.max(0, safeGuests - 1)`
//      clamp in `setOccupancy` was clamping `children`
//      down when the user lowered `guests` past
//      `children + 1`.
//
// CHD-11.3 added the symmetric auto-bump + removed the
// per-type cap. CHD-11.4 then reversed the auto-bump
// (the picker became a free expression surface; the
// "at least 1 adult" rule is enforced at the submit
// gate, not in the picker).
//
// Evolution (this file tracks what stayed vs what was
// reversed):
//   1. The per-type cap (`selectedMaxSelectableChildren`)
//      is removed from `setOccupancy` and `updateChildren`
//      (CHD-11.3) — stays in CHD-11.4.
//   2. The `safeChildren` clamp chain in `setOccupancy`:
//      - CHD-11.3: `Math.max(0, Math.min(nextChildren,
//        safeGuests - 1))` (the "at least 1 adult" floor)
//      - CHD-11.4: `Math.max(0, Math.min(nextChildren,
//        safeGuests))` (the floor is gone; picker is free
//        expression)
//   3. `updateChildren`'s `desiredChildren` is
//      `Math.max(nextChildren, 0)` (no per-type cap) —
//      added in CHD-11.3, stays in CHD-11.4.
//   4. `updateGuests`'s symmetric auto-bump
//      `newGuests = Math.max(nextGuests, numChildren + 1)`
//      — added in CHD-11.3, **reversed in CHD-11.4**.
//   5. `updateChildren`'s CHD-11.1 auto-bump
//      `newGuests = Math.max(guests, desiredChildren + 1)`
//      — added in CHD-11.1, **reversed in CHD-11.4**.
//   6. The `Math.max(0, safeGuests - 1)` clamp in
//      `setOccupancy` — added in CHD-11.3 as defense in
//      depth, **removed in CHD-11.4** (the "at least 1
//      adult" rule is enforced at the submit gate).
//   7. The `selectedMaxSelectableChildren` derivation
//      stays (used by the chip's hint text).
//   8. The `+` button's `disabled` condition is
//      `numChildren >= 10` (CHD-11.2's soft cap,
//      unchanged).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.3 — per-type cap removed from picker (auto-bump reversed in CHD-11.4)", () => {
  it("the `setOccupancy` `safeChildren` clamp chain has NO `selectedMaxSelectableChildren` (the per-type cap is gone, stays in CHD-11.4)", () => {
    // The pre-CHD-11.3 chain was
    // `Math.min(Math.max(nextChildren, 0),
    //  selectedMaxSelectableChildren,
    //  Math.max(0, safeGuests - 1))`.
    // The CHD-11.3 chain was
    // `Math.max(0, Math.min(nextChildren, safeGuests - 1))`.
    // The CHD-11.4 chain is
    // `Math.max(0, Math.min(nextChildren, safeGuests))`
    // — no `- 1`, no `selectedMaxSelectableChildren`.
    // The CHD-11.5 chain renames `safeGuests` to
    // `safeAdults` (the picker is now Adults +
    // Children directly).
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeAdults\)\s*\)/
    );
    // The pre-CHD-11.3 chain (with the per-type cap) is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.min\(\s*Math\.max\(nextChildren, 0\),\s*selectedMaxSelectableChildren,\s*Math\.max\(0, safeGuests - 1\)\s*\)/
    );
  });

  it("the `updateChildren` `desiredChildren` is `Math.max(nextChildren, 0)` (NO per-type cap, stays in CHD-11.4)", () => {
    // The pre-CHD-11.3 chain was
    // `Math.min(Math.max(nextChildren, 0),
    //  selectedMaxSelectableChildren)`.
    // The CHD-11.3 chain is just
    // `Math.max(nextChildren, 0)`. Stays in
    // CHD-11.4 (the per-type cap is gone, the
    // auto-bump is also gone).
    expect(bookingPageSrc).toMatch(
      /const desiredChildren = Math\.max\(nextChildren, 0\)/
    );
    // The pre-CHD-11.3 chain (with the per-type cap)
    // is gone.
    expect(bookingPageSrc).not.toMatch(
      /const desiredChildren = Math\.min\(\s*Math\.max\(nextChildren, 0\),\s*selectedMaxSelectableChildren\s*\)/
    );
  });

  it("the CHD-11.1 + CHD-11.3 auto-bumps are GONE (reversed in CHD-11.4)", () => {
    // CHD-11.4 reverses both auto-bumps:
    // - CHD-11.1: `newGuests = max(guests, desiredChildren + 1)`
    //   in `updateChildren`
    // - CHD-11.3: `newGuests = max(nextGuests, numChildren + 1)`
    //   in `updateGuests`
    // The picker is a free expression surface;
    // the "at least 1 adult" rule is enforced at
    // the submit gate.
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(nextGuests, numChildren \+ 1\)/
    );
  });

  it("the `Math.max(0, safeGuests - 1)` clamp is GONE (reversed in CHD-11.4 + renamed in CHD-11.5)", () => {
    // The pre-CHD-11.4 clamp
    // `Math.min(nextChildren, safeGuests - 1)` is
    // gone (CHD-11.4). The new chain is
    // `Math.min(nextChildren, safeAdults)` (no
    // `- 1`; renamed in CHD-11.5).
    expect(bookingPageSrc).not.toMatch(
      /Math\.min\(nextChildren, safeGuests - 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /Math\.min\(nextChildren, safeAdults\)/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation is still present (used by the chip's hint text, stays in CHD-11.4)", () => {
    // The derivation stays — it's used by the
    // "Up to N can fit when extra beds cover the
    // overflow" hint in the chip. It's no
    // longer a clamp on the picker (CHD-11.3),
    // and stays unused in clamping chains
    // (CHD-11.4).
    expect(bookingPageSrc).toMatch(
      /const selectedMaxSelectableChildren = useMemo\(\(\) => \{/
    );
  });

  it("the `selectedMaxSelectableChildren` is NOT used in any clamping chain (only in the chip's hint text, stays in CHD-11.5)", () => {
    // The per-type cap is removed from
    // `setOccupancy` + `updateChildren` clamping
    // (CHD-11.3). It's still used in the chip's
    // hint text.
    // Slice the `setOccupancy` body — the function
    // opens with `function setOccupancy(...) {` and
    // closes with the matching `}` at the same
    // indent. We use the `function setOccupancy`
    // anchor as the start, and the closing `}`
    // before `function updateAdults` as the end
    // (renamed in CHD-11.5).
    const setOccupancyStart = bookingPageSrc.indexOf(
      "function setOccupancy(nextAdults: number, nextChildren: number)"
    );
    const setOccupancyEnd = bookingPageSrc.indexOf(
      "}\n\n  function updateAdults(",
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

  it("the `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged in CHD-11.5)", () => {
    // The picker cap (10) is unchanged from
    // CHD-11.2. The per-type cap is gone from
    // the picker (CHD-11.3). The "at least 1
    // adult" auto-bump is gone (CHD-11.4). The
    // picker is now Adults + Children directly
    // (CHD-11.5). The only picker-side cap is
    // the soft 10.
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
  });

  it("the submit gate (`cartFitsGroup` derivation) is unchanged (the picker is no longer the enforcement layer, stays in CHD-11.5)", () => {
    // The submit gate catches the over-cap
    // case at Step 1 → Step 2. The picker
    // is no longer the enforcement layer;
    // the gate is.
    expect(bookingPageSrc).toMatch(/cartFitsGroup/);
    expect(bookingPageSrc).toMatch(
      /cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation uses the user's `adults` (no auto-bump, per CHD-11.5)", () => {
    // The pre-CHD-11.5 derivation used
    // `effectiveGuests = max(guests, N + 1)`
    // to model the historical auto-bump
    // scenario. The CHD-11.5 derivation uses
    // the user's `adults` directly (no
    // auto-bump). The derivation is no longer
    // used as a clamp on the picker (CHD-11.3),
    // the auto-bump is gone (CHD-11.4), and the
    // derivation is simplified (CHD-11.5). The
    // derivation stays (used by the chip's hint
    // text).
    expect(bookingPageSrc).toMatch(
      /numAdults: adults,/
    );
    // The pre-CHD-11.5 auto-bump formula is gone.
    expect(bookingPageSrc).not.toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
  });
});
