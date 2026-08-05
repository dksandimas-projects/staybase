// Per CHD-11.2 (2026-08-05, per decision #193) and its
// refinements in CHD-11.3 + CHD-11.4: source-text
// regression tests for the "picker cap raised to soft 10
// (no per-type cap on the + button)" UX refinement. The
// pre-CHD-11.2 surface hard-capped the children picker's
// `+` button at the room's capacity (e.g., 3 for a Single
// Room with `maxCapacity: 1`, `maxChildren: 2`,
// `maxExtraBeds: 1`). The user could pick up to 3
// children, but not more — even though the system can
// validate the over-cap case via the "Fits your group"
// chip + the submit gate.
//
// Evolution:
//   1. The children stepper's `+` button's `disabled`
//      condition is `numChildren >= 10` (the CHD-11 soft
//      cap, not the room's capacity) — added in
//      CHD-11.2, stays through CHD-11.4.
//   2. The pre-CHD-11.2 condition
//      (`numChildren >= Math.min(10,
//      selectedMaxSelectableChildren)`) is gone —
//      removed in CHD-11.2, stays gone.
//   3. The `selectedMaxSelectableChildren` derivation
//      stays (still used by the "Fits your group" chip +
//      the CHD-11 capacity indicator).
//   4. The `−` button's `disabled` condition is
//      unchanged.
//   5. The `updateChildren` function (post-CHD-11.4):
//      `desiredChildren = Math.max(nextChildren, 0)` (the
//      per-type cap `selectedMaxSelectableChildren` was
//      removed in CHD-11.3) and the CHD-11.1 auto-bump
//      `newGuests = max(guests, desiredChildren + 1)`
//      was removed in CHD-11.4 (the picker is now a
//      free expression surface). The function calls
//      `setOccupancy(guests, desiredChildren)` directly.
//   6. The `setOccupancy` helper (post-CHD-11.4): the
//      per-type cap is removed from the `safeChildren`
//      clamp chain (CHD-11.3), and the
//      `Math.max(0, safeGuests - 1)` floor is removed
//      (CHD-11.4 — the "at least 1 adult" rule is
//      enforced at the submit gate, not in the picker).
//      The new chain is
//      `Math.max(0, Math.min(nextChildren, safeGuests))`.
//   7. The submit gate is unchanged (the picker is no
//      longer the enforcement layer; the gate is).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.2 — picker cap raised to soft 10 (no per-type cap on the + button)", () => {
  it("the children stepper's `+` button disabled condition is `numChildren >= 10` (NOT the room's capacity)", () => {
    // Per CHD-11.2: the cap is the soft 10 (the
    // CHD-11 sanity guard), not the room's
    // capacity. The pre-CHD-11.2 cap of
    // `Math.min(10, selectedMaxSelectableChildren)`
    // overrode the 10 with the room's capacity,
    // which is the wrong layer.
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
  });

  it("the pre-CHD-11.2 condition `numChildren >= Math.min(10, selectedMaxSelectableChildren)` is gone", () => {
    // The pre-CHD-11.2 cap was the room's
    // capacity (`selectedMaxSelectableChildren`)
    // bounded by 10. The new cap is just 10.
    expect(bookingPageSrc).not.toMatch(
      /disabled=\{numChildren >= Math\.min\(10, selectedMaxSelectableChildren\)\}/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation is still present (used by the chip + capacity indicator)", () => {
    // The derivation stays — the "Fits your
    // group" chip + the CHD-11 capacity indicator
    // still use it. The picker just doesn't gate
    // on it anymore.
    expect(bookingPageSrc).toMatch(
      /const selectedMaxSelectableChildren = useMemo\(\(\) => \{/
    );
    // The new formula (per CHD-11.1): the
    // loop bound is 10, and the derivation
    // uses `effectiveGuests = max(guests, N + 1)`.
    expect(bookingPageSrc).toMatch(
      /effectiveGuests = Math\.max\(guests, children \+ 1\)/
    );
  });

  it("the `−` button's `disabled` condition (`numChildren <= 0`) is unchanged", () => {
    // The `−` button is disabled when the
    // count is 0. Unchanged from CHD-11.
    expect(bookingPageSrc).toMatch(/disabled=\{numChildren <= 0\}/);
  });

  it("the `updateChildren` function (post-CHD-11.4: no auto-bump) is intact (per-type cap removed in CHD-11.3, auto-bump removed in CHD-11.4)", () => {
    // The function is intact: per-type cap
    // removed in CHD-11.3, auto-bump removed
    // in CHD-11.4. The new shape is
    // `setOccupancy(guests, desiredChildren)`
    // directly — no `newGuests` intermediate.
    expect(bookingPageSrc).toMatch(
      /function updateChildren\(nextChildren: number\)/
    );
    expect(bookingPageSrc).toMatch(
      /const desiredChildren = Math\.max\(nextChildren, 0\)/
    );
    // The pre-CHD-11.4 auto-bump
    // (`newGuests = max(guests, desiredChildren + 1)`)
    // is gone (CHD-11.4).
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
  });

  it("the `setOccupancy` helper (post-CHD-11.4: no `safeGuests - 1` floor) is intact (per-type cap removed in CHD-11.3, `- 1` floor removed in CHD-11.4)", () => {
    // The helper stays. The `safeGuests - 1`
    // floor for children is removed in
    // CHD-11.4 — the "at least 1 adult" rule
    // is enforced at the submit gate, not in
    // the picker. CHD-11.3 already removed the
    // per-type cap (`selectedMaxSelectableChildren`)
    // from the `safeChildren` clamp chain.
    // The new chain is
    // `Math.max(0, Math.min(nextChildren, safeGuests))`.
    expect(bookingPageSrc).toMatch(
      /function setOccupancy\(nextGuests: number, nextChildren: number\)/
    );
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests\)\s*\)/
    );
    // The pre-CHD-11.4 chain (with the `- 1` floor) is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests - 1\)\s*\)/
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
});
