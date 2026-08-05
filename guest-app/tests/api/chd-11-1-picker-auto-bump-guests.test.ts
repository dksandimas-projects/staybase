// Per CHD-11.1 (2026-08-04, per decision #192) and its
// refinements in CHD-11.3 + CHD-11.4 + CHD-11.5
// (2026-08-05, per decisions #194 + #195 + #196):
// source-text regression tests for the picker auto-bump
// + extraction of the `setOccupancy` helper. The
// pre-CHD-11.1 surface hard-capped the children picker
// at `Math.max(0, guests - 1)`, which prevented the user
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
// CHD-11.5 then replaced the "Guests" (total) state
// with an "Adults" state; the picker is now Adults +
// Children directly. The `setOccupancy` helper takes
// `nextAdults` (not `nextGuests`); `safeAdults` (not
// `safeGuests`); `updateGuests` is renamed to
// `updateAdults`. The "at least 1 adult" rule is
// enforced at the Adults stepper's min (1), not via
// the submit gate.
//
// Evolution:
//   1. `setOccupancy(nextAdults, nextChildren)` is the
//      extracted shared helper (handles clamping + URL
//      write) — added in CHD-11.1 as
//      `setOccupancy(nextGuests, nextChildren)`, renamed
//      in CHD-11.5.
//   2. `updateAdults` (CHD-11.5: renamed from
//      `updateGuests`):
//      - CHD-11.1: `setOccupancy(nextGuests, numChildren)`
//      - CHD-11.3: added symmetric auto-bump
//        `newGuests = max(nextGuests, numChildren + 1)`
//        then `setOccupancy(newGuests, numChildren)`
//      - CHD-11.4: removed the auto-bump.
//      - CHD-11.5: renamed to `updateAdults`; takes
//        `nextAdults` and calls
//        `setOccupancy(nextAdults, numChildren)` directly.
//   3. `updateChildren` (CHD-11.1 → CHD-11.3 → CHD-11.4
//      → CHD-11.5):
//      - CHD-11.1: auto-bump `newGuests = max(guests,
//        desiredChildren + 1)`
//      - CHD-11.3: per-type cap removed from
//        `desiredChildren`
//      - CHD-11.4: removed the auto-bump.
//      - CHD-11.5: calls `setOccupancy(adults,
//        desiredChildren)` directly (no auto-bump
//        intermediate; the user's `adults` is the
//        state).
//   4. `selectedMaxSelectableChildren` derivation:
//      - CHD-11.1: `effectiveGuests = max(guests, N + 1)`
//        (auto-bump scenario)
//      - CHD-11.5: no auto-bump; uses the user's
//        `adults` directly. The derivation is still
//        used by the chip's hint text.
//   5. The children stepper's `+` button disabled
//      condition is `numChildren >= 10` (CHD-11.2's
//      soft cap, unchanged in CHD-11.5).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.1 — picker auto-bump history (reversed in CHD-11.4)", () => {
  it("a `setOccupancy(nextAdults, nextChildren)` helper is defined (the extracted shared function from CHD-11.1, renamed in CHD-11.5)", () => {
    // The helper is the single source of truth for
    // the occupancy mutation. Both `updateAdults`
    // and `updateChildren` call it. Added in
    // CHD-11.1 as `setOccupancy(nextGuests, ...)`;
    // renamed in CHD-11.5 to `setOccupancy(nextAdults, ...)`.
    expect(bookingPageSrc).toMatch(
      /function setOccupancy\(nextAdults: number, nextChildren: number\)/
    );
  });

  it("the CHD-11.1 + CHD-11.3 auto-bumps are GONE (CHD-11.4 reverses them — picker is free expression)", () => {
    // CHD-11.4 reverses the auto-bump in both
    // `updateAdults` (was `updateGuests`) and
    // `updateChildren`. The picker is now a free
    // expression surface; the "at least 1 adult"
    // rule is enforced at the submit gate (CHD-11.4)
    // + at the Adults stepper's min (1) (CHD-11.5).
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

  it("`updateChildren` calls `setOccupancy(adults, desiredChildren)` directly (no auto-bump intermediate, per CHD-11.4 + CHD-11.5)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, desiredChildren)`
    // where `newGuests = max(guests,
    // desiredChildren + 1)`. The CHD-11.4
    // shape was `setOccupancy(guests,
    // desiredChildren)` — no `newGuests`
    // intermediate. The CHD-11.5 shape is
    // `setOccupancy(adults, desiredChildren)`
    // — uses the new `adults` state.
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
      /setOccupancy\(adults, desiredChildren\)/
    );
    // The pre-CHD-11.4 intermediate `newGuests` is
    // gone from the `updateChildren` body.
    expect(updateChildrenBody).not.toMatch(/newGuests/);
  });

  it("`updateAdults` calls `setOccupancy(nextAdults, numChildren)` directly (no auto-bump intermediate, per CHD-11.4 + renamed in CHD-11.5)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, numChildren)` where
    // `newGuests = max(nextGuests, numChildren + 1)`.
    // The CHD-11.4 shape was
    // `setOccupancy(nextGuests, numChildren)` — no
    // `newGuests` intermediate. The CHD-11.5 shape
    // is `setOccupancy(nextAdults, numChildren)`
    // — uses the new `adults` state.
    // Slice the `updateAdults` body — anchor on
    // the function signature and the closing `}`
    // before `function updateChildren`.
    const updateAdultsStart = bookingPageSrc.indexOf(
      "function updateAdults(nextAdults: number)"
    );
    const updateAdultsEnd = bookingPageSrc.indexOf(
      "}\n\n  function updateChildren(",
      updateAdultsStart
    );
    const updateAdultsBody = bookingPageSrc.slice(
      updateAdultsStart,
      updateAdultsEnd
    );
    expect(updateAdultsBody).toMatch(
      /setOccupancy\(nextAdults, numChildren\)/
    );
    // The pre-CHD-11.4 intermediate `newGuests` is
    // gone from the `updateAdults` body.
    expect(updateAdultsBody).not.toMatch(/newGuests/);
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
    // which is now gone in CHD-11.4 + CHD-11.5 —
    // the derivation stays for the chip's hint
    // text).
    expect(bookingPageSrc).toMatch(
      /for \(let children = 0; children <= 10; children \+= 1\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /for \(let children = 0; children <= Math\.max\(0, guests - 1\); children \+= 1\)/
    );
  });

  it("the derivation uses the user's `adults` (no auto-bump, per CHD-11.5)", () => {
    // The pre-CHD-11.5 derivation used
    // `effectiveGuests = max(guests, N + 1)` to
    // model the historical auto-bump scenario.
    // The CHD-11.5 derivation uses the user's
    // `adults` directly (no auto-bump). The
    // derivation is still used by the chip's
    // hint text.
    expect(bookingPageSrc).toMatch(
      /numAdults: adults,/
    );
    // The pre-CHD-11.5 auto-bump formula is gone.
    expect(bookingPageSrc).not.toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
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
    // — no `- 1`. The CHD-11.5 chain is
    // `Math.max(0, Math.min(nextChildren, safeAdults))`
    // — uses the new `safeAdults` (renamed in CHD-11.5).
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeAdults\)\s*\)/
    );
    // The pre-CHD-11.4 chain (with the `- 1` floor) is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests - 1\)\s*\)/
    );
  });
});
