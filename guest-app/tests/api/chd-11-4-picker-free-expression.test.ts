// Per CHD-11.4 (2026-08-05, per decision #195): source-text
// regression tests for the "free expression in the picker
// (submit-gate enforces 'at least 1 adult')" UX refinement.
// The pre-CHD-11.4 surface had the "at least 1 adult"
// invariant enforced via auto-bump in `updateChildren`
// (CHD-11.1) + symmetric auto-bump in `updateGuests`
// (CHD-11.3) + the `Math.max(0, safeGuests - 1)` clamp
// in `setOccupancy` (CHD-11.3's defense-in-depth).
//
// CHD-11.4 reverses all three — the picker is a free
// expression surface. The "at least 1 adult" rule stays
// as a business rule (per CHD-05) but is enforced at
// the submit gate (`numAdults >= 1` check at line 724
// + the per-room `cartDistributionComplete` check), not
// in the picker.
//
// What the user sees:
//   1. Set Guests=5, Children=5 → picker shows 5/5/0
//      adults (derived). Submit disabled with the
//      "Choose enough rooms to assign every adult and
//      child, with at least one adult in each room."
//      error. The user adds an adult (or removes a
//      child) and submit re-enables.
//   2. Lower Guests from 3 to 1 with Children=3 → no
//      clamp, Children stays at 3, numAdults =
//      max(0, 1-3) = 0, submit disabled. The user can
//      freely express the state; the validation surfaces
//      it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("CHD-11.4 — free expression in the picker (submit-gate enforces 'at least 1 adult')", () => {
  it("the `setOccupancy` `safeChildren` clamp chain is `Math.max(0, Math.min(nextChildren, safeGuests))` (no '- 1' floor)", () => {
    // The pre-CHD-11.4 chain was
    // `Math.max(0, Math.min(nextChildren, safeGuests - 1))`.
    // The CHD-11.4 chain is `Math.max(0, Math.min(nextChildren, safeGuests))`
    // — children can be up to `safeGuests`, so `numAdults =
    // safeGuests - safeChildren` can be 0.
    // The CHD-11.5 chain renames `safeGuests` to `safeAdults`
    // (the picker is now Adults + Children directly).
    expect(bookingPageSrc).toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeAdults\)\s*\)/
    );
    // The pre-CHD-11.4 chain (with the `- 1` floor) is gone.
    expect(bookingPageSrc).not.toMatch(
      /const safeChildren = Math\.max\(\s*0,\s*Math\.min\(nextChildren, safeGuests - 1\)\s*\)/
    );
  });

  it("`updateChildren` has NO auto-bump (no `newGuests = max(guests, desiredChildren + 1)`)", () => {
    // The pre-CHD-11.4 `updateChildren` computed
    // `newGuests = max(guests, desiredChildren + 1)`
    // (the CHD-11.1 auto-bump) to maintain the
    // "at least 1 adult" invariant. The new shape
    // calls `setOccupancy(adults, desiredChildren)`
    // directly — no auto-bump. The "at least 1
    // adult" rule is enforced at the Adults
    // stepper's min (1) in CHD-11.5.
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(guests, desiredChildren \+ 1\)/
    );
  });

  it("`updateChildren` calls `setOccupancy(adults, desiredChildren)` directly (no auto-bump intermediate)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, desiredChildren)`
    // where `newGuests = max(guests, desiredChildren + 1)`.
    // The CHD-11.4 shape was
    // `setOccupancy(guests, desiredChildren)` — no
    // `newGuests` intermediate.
    // The CHD-11.5 shape is
    // `setOccupancy(adults, desiredChildren)` —
    // uses the new `adults` state.
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

  it("`updateAdults` (renamed from `updateGuests` in CHD-11.5) has NO symmetric auto-bump (no `newGuests = max(nextGuests, numChildren + 1)`)", () => {
    // The pre-CHD-11.4 `updateGuests` (post-CHD-11.3)
    // computed `newGuests = max(nextGuests,
    // numChildren + 1)` (the symmetric auto-bump) to
    // mirror `updateChildren`'s auto-bump. The new
    // shape calls `setOccupancy(nextAdults, numChildren)`
    // directly — no auto-bump. Renamed from
    // `updateGuests` to `updateAdults` in CHD-11.5.
    expect(bookingPageSrc).not.toMatch(
      /const newGuests = Math\.max\(nextGuests, numChildren \+ 1\)/
    );
  });

  it("`updateAdults` calls `setOccupancy(nextAdults, numChildren)` directly (no auto-bump intermediate)", () => {
    // The pre-CHD-11.4 shape was
    // `setOccupancy(newGuests, numChildren)` where
    // `newGuests = max(nextGuests, numChildren + 1)`.
    // The CHD-11.4 shape was
    // `setOccupancy(nextGuests, numChildren)` — no
    // `newGuests` intermediate.
    // The CHD-11.5 shape is
    // `setOccupancy(nextAdults, numChildren)` —
    // uses the new `adults` state.
    // Slice the `updateAdults` body — anchor on the
    // function signature and the closing `}` before
    // `function updateChildren`.
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

  it("the `numAdults = adults` state stays (was `numAdults = max(0, guests - numChildren)` derivation, renamed in CHD-11.5)", () => {
    // The pre-CHD-11.5 `numAdults` derivation
    // was `Math.max(0, guests - numChildren)`.
    // The CHD-11.5 `numAdults` is the state
    // `adults` (no derivation). The total
    // `guests = numAdults + numChildren` is
    // derived (used by the server + cart
    // summary).
    expect(bookingPageSrc).toMatch(
      /const numAdults = adults/
    );
    // The pre-CHD-11.5 derivation is gone.
    expect(bookingPageSrc).not.toMatch(
      /const numAdults = Math\.max\(0, guests - numChildren\)/
    );
  });

  it("the submit gate's `numAdults >= 1` check stays (line 724)", () => {
    // The submit gate catches the 0-adults case.
    // The Continue button is disabled with the
    // "Choose enough rooms to assign every adult
    // and child, with at least one adult in each
    // room." error.
    expect(bookingPageSrc).toMatch(/numAdults >= 1/);
  });

  it("the per-room `cartDistributionComplete` check stays (every room has `numAdults >= 1`)", () => {
    // The per-room check catches the per-room
    // 0-adults case (e.g., 1 room with 0 adults +
    // 5 children). The "Adjust room" CTA is the
    // existing surface for this error.
    expect(bookingPageSrc).toMatch(
      /distributedRoomCart\.every\(\(room\) => room\.numAdults >= 1\)/
    );
  });

  it("the `selectedMaxSelectableChildren` derivation stays (CHD-11.3, used by the chip's hint text)", () => {
    // The per-type cap removal from CHD-11.3 is
    // unchanged. The derivation is still present
    // (used by the chip's hint text), but the
    // picker is now a free expression surface.
    expect(bookingPageSrc).toMatch(
      /const selectedMaxSelectableChildren = useMemo\(\(\) => \{/
    );
  });

  it("the `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged)", () => {
    // The soft cap of 10 is unchanged. The picker
    // is a free expression surface; the per-type
    // cap is gone; the "at least 1 adult" auto-bump
    // is gone. The only picker-side constraint is
    // the soft 10 cap on `+`.
    expect(bookingPageSrc).toMatch(
      /disabled=\{numChildren >= 10\}/
    );
  });

  it("the `cartFitsGroup` over-capacity check stays (the picker is no longer the enforcement layer)", () => {
    // The submit gate catches the over-capacity
    // case. The picker is no longer the enforcement
    // layer; the chip + submit gate are.
    expect(bookingPageSrc).toMatch(/cartFitsGroup/);
    expect(bookingPageSrc).toMatch(
      /cartIsReady = cartHasAvailability && cartDistributionComplete && cartFitsGroup/
    );
  });
});
