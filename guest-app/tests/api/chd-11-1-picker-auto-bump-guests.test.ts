// Per CHD-11.1 (2026-08-04, per decision #192): source-text
// regression tests for the "picker auto-bumps guests to fit
// more children" UX fix. The pre-CHD-11.1 surface hard-capped
// the children picker at `Math.max(0, guests - 1)`, which
// prevented the user from picking more children than the
// booking's total allowed. With 2 guests, the user could only
// pick 1 child — even when the room could hold 2.
//
// CHD-11.1 flow (later refined by CHD-11.3 — see notes inline):
//   1. `setOccupancy(nextGuests, nextChildren)` is the
//      extracted shared helper (handles clamping + URL
//      write).
//   2. `updateGuests` (post-CHD-11.3): symmetric auto-bump
//      `newGuests = max(nextGuests, numChildren + 1)` then
//      `setOccupancy(newGuests, numChildren)`. Pre-CHD-11.3
//      just called `setOccupancy(nextGuests, numChildren)`.
//   3. `updateChildren` (post-CHD-11.3): `desiredChildren =
//      max(nextChildren, 0)` (per-type cap removed), then
//      `newGuests = max(guests, desiredChildren + 1)` (the
//      auto-bump), then `setOccupancy(newGuests,
//      desiredChildren)`. Pre-CHD-11.3 clamped
//      `desiredChildren` with `selectedMaxSelectableChildren`.
//   4. `selectedMaxSelectableChildren` derivation loops
//      `N` from 0 to 10 (the soft cap), using
//      `effectiveGuests = max(guests, N + 1)` to model the
//      auto-bump scenario.
//   5. The children stepper's `+` button disabled
//      condition is `numChildren >= 10` (CHD-11.2's
//      refinement; CHD-11.1 had
//      `numChildren >= Math.min(10,
//      selectedMaxSelectableChildren)`).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.1 — picker auto-bumps guests to fit more children", () => {
  it("a `setOccupancy(nextGuests, nextChildren)` helper is defined (the extracted shared function)", () => {
    // The helper is the single source of truth for
    // the occupancy mutation. Both `updateGuests`
    // and `updateChildren` call it.
    expect(bookingPageSrc).toMatch(
      /function setOccupancy\(nextGuests: number, nextChildren: number\)/
    );
  });

  it("`updateGuests` has the CHD-11.3 symmetric auto-bump (`newGuests = max(nextGuests, numChildren + 1)`)", () => {
    // Pre-CHD-11.3: `updateGuests` called
    // `setOccupancy(nextGuests, numChildren)`
    // directly, which would clamp `children` down
    // via the `Math.max(0, safeGuests - 1)`
    // defense-in-depth clamp — the user saw
    // "children becomes 0".
    //
    // Post-CHD-11.3 (per decision #194):
    // `updateGuests` computes
    // `newGuests = Math.max(nextGuests,
    //  numChildren + 1)` and calls
    // `setOccupancy(newGuests, numChildren)`. The
    // symmetric auto-bump mirrors
    // `updateChildren`'s.
    expect(bookingPageSrc).toMatch(
      /function updateGuests\(nextGuests: number\) \{[\s\S]{0,800}const newGuests = Math\.max\(nextGuests, numChildren \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /setOccupancy\(newGuests, numChildren\)/
    );
  });

  it("`updateChildren` computes `desiredChildren = Math.max(nextChildren, 0)` and `newGuests = max(guests, desiredChildren + 1)` (the auto-bump, per-type cap removed in CHD-11.3)", () => {
    // The pre-CHD-11.1 shape hard-capped
    // children at `guests - 1`. The new shape
    // auto-bumps `guests` to maintain the
    // invariant. The pre-CHD-11.3 shape clamped
    // `desiredChildren` to
    // `selectedMaxSelectableChildren`; CHD-11.3
    // removed that cap.
    expect(bookingPageSrc).toMatch(
      /const desiredChildren = Math\.max\(nextChildren, 0\)/
    );
    expect(bookingPageSrc).toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /setOccupancy\(newGuests, desiredChildren\)/
    );
  });

  it("the `Math.max(0, guests - 1)` clamp is gone from `updateChildren` (the pre-CHD-11.1 hard cap)", () => {
    // The pre-CHD-11.1 `updateChildren` clamped
    // to `Math.max(0, guests - 1)`. The new
    // shape relies on `setOccupancy` to clamp
    // children to `safeGuests - 1` (which
    // preserves the invariant for `updateGuests`
    // drops) and the auto-bump to maintain the
    // invariant for `updateChildren` increments.
    // The pre-CHD-11.1 hard cap on children in
    // `updateChildren` is gone.
    // Check the function body — `updateChildren`
    // should NOT have `Math.max(0, guests - 1)`
    // in its clamping chain. The `setOccupancy`
    // helper has the equivalent (the safeChildren
    // clamp), but the `updateChildren` body itself
    // uses `Math.max(guests, desiredChildren + 1)`
    // for the auto-bump.
    const updateChildrenMatch = bookingPageSrc.match(
      /function updateChildren\(nextChildren: number\) \{([\s\S]+?)\n  \}/
    );
    expect(updateChildrenMatch).not.toBeNull();
    const updateChildrenBody = updateChildrenMatch![1];
    expect(updateChildrenBody).not.toMatch(/Math\.max\(0, guests - 1\)/);
  });

  it("the `selectedMaxSelectableChildren` derivation loops `N` from 0 to 10 (the soft cap, not `Math.max(0, guests - 1)`)", () => {
    // The pre-CHD-11.1 derivation bounded the
    // loop by `Math.max(0, guests - 1)`. The
    // new derivation bounds by `10` (the soft
    // cap from CHD-11), allowing the user to
    // explore children counts the room
    // supports (with auto-bump).
    expect(bookingPageSrc).toMatch(
      /for \(let children = 0; children <= 10; children \+= 1\)/
    );
    expect(bookingPageSrc).not.toMatch(
      /for \(let children = 0; children <= Math\.max\(0, guests - 1\); children \+= 1\)/
    );
  });

  it("the new derivation uses `effectiveGuests = max(guests, N + 1)` (the auto-bump scenario)", () => {
    // For each candidate child count `N`, the
    // effective `guests` is `max(originalGuests,
    // N + 1)` (auto-bump if needed) so the
    // `numAdults` is always `>= 1`. The room
    // supports `N` children if the overflow
    // (with the post-bump `numAdults`) fits in
    // `maxExtraBeds`.
    expect(bookingPageSrc).toMatch(
      /const effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /const numAdults = effectiveGuests - children/
    );
  });

  it("the children stepper's `+` button disabled condition is `numChildren >= 10` (not the room's capacity, not `Math.max(0, guests - 1)`)", () => {
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

  it("the `setOccupancy` helper preserves the `safeGuests - 1` floor for children (the 'at least 1 adult' invariant, kept as defense in depth per CHD-11.3)", () => {
    // When `updateGuests(1)` is called with 2
    // children, `setOccupancy(1, 2)` should
    // clamp children to `safeGuests - 1 = 0`.
    // The clamping chain in `setOccupancy`
    // includes `Math.max(0, safeGuests - 1)` as
    // defense in depth. The pre-CHD-11.3 chain
    // also included `selectedMaxSelectableChildren`
    // (the per-type cap); CHD-11.3 removed that
    // — the picker is no longer the enforcement
    // layer. The `Math.max(0, safeGuests - 1)`
    // clamp stays as defense in depth.
    expect(bookingPageSrc).toMatch(
      /Math\.min\(nextChildren, safeGuests - 1\)/
    );
  });
});
