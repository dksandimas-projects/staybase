// Per CHD-11.1 (2026-08-04, per decision #192) and its
// refinements in CHD-11.3 + CHD-11.4 (2026-08-05, per
// decisions #194 + #195): source-text regression tests
// for the picker auto-bump + extraction of the
// `setOccupancy` helper. The pre-CHD-11.1 surface
// hard-capped the children picker at
// `Math.max(0, guests - 1)`, which prevented the user
// from picking more children than the booking's total
// allowed. With 2 guests, the user could only pick 1
// child — even when the room could hold 2.
//
// The auto-bump was added in CHD-11.1, then symmetric-
// bumped in CHD-11.3, then **removed** in CHD-11.4
// (the picker became a free expression surface; the
// "at least 1 adult" rule is enforced at the submit
// gate, not in the picker).
//
// Evolution:
//   1. `setOccupancy(nextGuests, nextChildren)` is the
//      extracted shared helper (handles clamping + URL
//      write) — added in CHD-11.1, stays through
//      CHD-11.4.
//   2. `updateGuests` (CHD-11.1 → CHD-11.3 → CHD-11.4):
//      - CHD-11.1: `setOccupancy(nextGuests, numChildren)`
//      - CHD-11.3: added symmetric auto-bump
//        `newGuests = max(nextGuests, numChildren + 1)`
//        then `setOccupancy(newGuests, numChildren)`
//      - CHD-11.4: removed the auto-bump. Now
//        `setOccupancy(nextGuests, numChildren)`
//        directly (free expression).
//   3. `updateChildren` (CHD-11.1 → CHD-11.3 → CHD-11.4):
//      - CHD-11.1: auto-bump `newGuests = max(guests,
//        desiredChildren + 1)`
//      - CHD-11.3: per-type cap removed from
//        `desiredChildren`
//      - CHD-11.4: removed the auto-bump. Now
//        `setOccupancy(guests, desiredChildren)`
//        directly (free expression).
//   4. `selectedMaxSelectableChildren` derivation loops
//      `N` from 0 to 10 (the soft cap), using
//      `effectiveGuests = max(guests, N + 1)` to model
//      the historical auto-bump scenario. The
//      derivation stays in CHD-11.4 (used by the
//      chip's hint text), but the picker is now a
//      free expression surface so the auto-bump is
//      no longer fired.
//   5. The children stepper's `+` button disabled
//      condition is `numChildren >= 10` (CHD-11.2's
//      soft cap, unchanged in CHD-11.4).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.1 — picker auto-bump history (reversed in CHD-11.4)", () => {
  it("a `setOccupancy(nextGuests, nextChildren)` helper is defined (the extracted shared function from CHD-11.1)", () => {
    // The helper is the single source of truth for
    // the occupancy mutation. Both `updateGuests`
    // and `updateChildren` call it. Added in
    // CHD-11.1; stays through CHD-11.4.
    expect(bookingPageSrc).toMatch(
      /function setOccupancy\(nextGuests: number, nextChildren: number\)/
    );
  });

  it("the CHD-11.1 + CHD-11.3 auto-bumps are GONE (CHD-11.4 reverses them — picker is free expression)", () => {
    // CHD-11.4 reverses the auto-bump in both
    // `updateGuests` and `updateChildren`. The
    // picker is now a free expression surface;
    // the "at least 1 adult" rule is enforced at
    // the submit gate, not in the picker.
    // The pre-CHD-11.4 `newGuests` intermediates
    // (CHD-11.1 in `updateChildren` + CHD-11.3 in
    // `updateGuests`) are gone.
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(nextGuests, numChildren \+ 1\)/
    );
  });

  it("`updateChildren` calls `setOccupancy(guests, desiredChildren)` directly (no auto-bump intermediate, per CHD-11.4)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, desiredChildren)`
    // where `newGuests = max(guests,
    // desiredChildren + 1)`. The new shape is
    // `setOccupancy(guests, desiredChildren)`
    // — no `newGuests` intermediate.
    // Slice the `updateChildren` body — anchor on
    // the function signature and the closing `}`
    // before `function validateUploadFile`.
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
    expect(updateChildrenBody).toMatch(
      /setOccupancy\(guests, desiredChildren\)/
    );
    // The pre-CHD-11.4 intermediate `newGuests` is
    // gone from the `updateChildren` body.
    expect(updateChildrenBody).not.toMatch(/newGuests/);
  });

  it("`updateGuests` calls `setOccupancy(nextGuests, numChildren)` directly (no auto-bump intermediate, per CHD-11.4)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, numChildren)` where
    // `newGuests = max(nextGuests, numChildren + 1)`.
    // The new shape is
    // `setOccupancy(nextGuests, numChildren)` — no
    // `newGuests` intermediate.
    // Slice the `updateGuests` body — anchor on
    // the function signature and the closing `}`
    // before `function updateChildren`.
    const updateGuestsStart = bookingPageSrc.indexOf(
      "function updateGuests(nextGuests: number)"
    );
    const updateGuestsEnd = bookingPageSrc.indexOf(
      "}\n\n  function updateChildren(",
      updateGuestsStart
    );
    const updateGuestsBody = bookingPageSrc.slice(
      updateGuestsStart,
      updateGuestsEnd
    );
    expect(updateGuestsBody).toMatch(
      /setOccupancy\(nextGuests, numChildren\)/
    );
    // The pre-CHD-11.4 intermediate `newGuests` is
    // gone from the `updateGuests` body.
    expect(updateGuestsBody).not.toMatch(/newGuests/);
  });

  it("the `Math.max(0, guests - 1)` hard cap is gone from `updateChildren` (the pre-CHD-11.1 hard cap, reversed in CHD-11.1)", () => {
    // The pre-CHD-11.1 `updateChildren` clamped
    // to `Math.max(0, guests - 1)`. The CHD-11.1
    // shape auto-bumped instead; CHD-11.4 removed
    // the auto-bump entirely. The hard cap on
    // children in `updateChildren` is gone (in two
    // ways — the clamp is gone, and the auto-bump
    // is gone; the picker is a free expression
    // surface).
    // Check the function body — `updateChildren`
    // should NOT have `Math.max(0, guests - 1)`
    // in its body.
    const updateChildrenMatch = bookingPageSrc.match(
      /function updateChildren\(nextChildren: number\) \{([\s\S]+?)\n  \}/
    );
    expect(updateChildrenMatch).not.toBeNull();
    const updateChildrenBody = updateChildrenMatch![1];
    expect(updateChildrenBody).not.toMatch(/Math\.max\(0, guests - 1\)/);
  });

  it("the `selectedMaxSelectableChildren` derivation loops `N` from 0 to 10 (the soft cap)", () => {
    // The pre-CHD-11.1 derivation bounded the
    // loop by `Math.max(0, guests - 1)`. The
    // new derivation bounds by `10` (the soft
    // cap from CHD-11), allowing the user to
    // explore children counts the room
    // supports (with the historical auto-bump,
    // which is now gone in CHD-11.4 — the
    // derivation stays for the chip's hint text).
    expect(bookingPageSrc).toMatch(
      /for \(let children = 0; children <= 10; children \+= 1\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /for \(let children = 0; children <= Math\.max\(0, guests - 1\); children \+= 1\)/
    );
  });

  it("the derivation uses `effectiveGuests = max(guests, N + 1)` (the historical auto-bump scenario)", () => {
    // For each candidate child count `N`, the
    // effective `guests` is `max(originalGuests,
    // N + 1)` (the historical auto-bump if
    // needed) so the `numAdults` is always
    // `>= 1`. The room supports `N` children if
    // the overflow (with the post-bump
    // `numAdults`) fits in `maxExtraBeds`. The
    // derivation stays in CHD-11.4 even though
    // the auto-bump is gone — it's used by the
    // chip's hint text.
    expect(bookingPageSrc).toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /const numAdults = effectiveGuests - children/
    );
  });

  it("the children stepper's `+` button disabled condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged)", () => {
    // The pre-CHD-11.1 disabled condition was
    // `numChildren >= Math.min(10, Math.max(0,
    // guests - 1))`. The CHD-11.1 condition was
    // `numChildren >= Math.min(10,
    // selectedMaxSelectableChildren)` (the room's
    // capacity with auto-bump). The CHD-11.2
    // condition is just `numChildren >= 10` (the
    // CHD-11 soft cap, not the room's capacity).
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
    // The pre-CHD-11.1 disabled condition is
    // gone (the `Math.max(0, guests - 1)`
    // floor on the `+` button).
    expect(bookingPageSrc).not.toMatch(
      /disabled=\{numChildren >= Math\.min\(10, Math\.max\(0, guests - 1\)\)\}/
    );
    // The pre-CHD-11.2 disabled condition is
    // also gone (the room's capacity as the cap).
    expect(bookingPageSrc).not.toMatch(
      /disabled=\{numChildren >= Math\.min\(10, selectedMaxSelectableChildren\)\}/
    );
  });

  it("the `setOccupancy` `safeChildren` chain has NO `safeGuests - 1` floor (reversed in CHD-11.4)", () => {
    // The pre-CHD-11.4 chain was
    // `Math.max(0, Math.min(nextChildren, safeGuests - 1))`
    // (the "at least 1 adult" floor). The
    // CHD-11.4 chain is
    // `Math.max(0, Math.min(nextChildren, safeGuests))`
    // — no `- 1`. Children can be up to `safeGuests`,
    // so `numAdults = safeGuests - safeChildren` can
    // be 0. The "at least 1 adult" rule is enforced
    // at the submit gate, not in the picker.
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests\)\s*\)/
    );
    // The pre-CHD-11.4 chain (with the `- 1` floor) is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests - 1\)\s*\)/
    );
  });
});
