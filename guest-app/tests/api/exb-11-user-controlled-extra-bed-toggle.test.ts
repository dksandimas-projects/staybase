// Per EXB-11 (2026-08-04, per decision #186): source-text
// regression tests for the user-controlled extra-bed toggle
// on the `/book` page. The pre-EXB-11 flow auto-computed the
// per-room `extraBedCount` from the overflow rule, hiding the
// per-bed-per-night price until Step 3 and silently overriding
// the user's intent. The EXB-11 flow:
//   1. Surfaces a per-type "Extras" sub-section on each
//      room-type card with a 0..maxExtraBeds counter.
//   2. Shows the per-bed-per-night rate + stay total inline
//      (so the price is visible at the point of decision).
//   3. Enforces a soft floor on the `[−]` button at
//      `max(0, requiredExtraBeds)` — the user can't drop below
//      the per-room overflow the group needs.
//   4. Surfaces a soft-floor warning when the type's
//      `maxExtraBeds` cap is below the per-room overflow
//      (the user can't satisfy the group with the available
//      beds; the submit gate, per CHD-11, catches the case).
//   5. Mirrors the per-type user pick onto every room of
//      that type in the cart — per-type, not per-room.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural emulator test
// (full `/book` interaction with various group sizes) is out
// of scope for this sandbox.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

const bookingRoomCartSrc = readFileSync(
  resolve(__dirname, "../../src/utils/bookingRoomCart.ts"),
  "utf8"
);

// Slice the Extras sub-section IIFE — the block that renders
// the per-type counter + rate + stay total + soft-floor
// warning. Use a unique comment marker to anchor the start,
// and the unique `})()}` close of the IIFE for the end
// (the IIFE returns the JSX block and the closing `})()}` is
// the only top-level close after the JSX). The "EXB-11
// (2026-08-04, per decision\n                            #186):
// the per-type" string is only present in this block.
const extrasStart = bookingPageSrc.indexOf(
  "EXB-11 (2026-08-04, per decision\n                            #186): the per-type"
);
const extrasEnd = bookingPageSrc.indexOf("})()}", extrasStart) + "})()}".length;
const extrasSlice =
  extrasStart >= 0 && extrasEnd > extrasStart
    ? bookingPageSrc.slice(extrasStart, extrasEnd)
    : "";

describe("EXB-11 — per-type user-controlled extra-bed toggle on /book", () => {
  it("the Extras sub-section is present and locatable", () => {
    expect(extrasSlice.length).toBeGreaterThan(0);
    expect(extrasSlice).toMatch(/Extra beds/);
  });

  it("hides the sub-section when `maxExtraBeds === 0` per the spec's no-extra-bed edge case", () => {
    // The spec says: "`maxExtraBeds === 0` — the entire
    // 'Extras' sub-section is hidden. The room type
    // doesn't offer extra beds; nothing to toggle."
    // The implementation guards with an early `return null`
    // inside the IIFE.
    expect(extrasSlice).toMatch(/typeMaxExtraBeds === 0\)\s*return null/);
  });

  it("renders the per-type counter (per-type, not per-room) with the spec's 0..maxExtraBeds range", () => {
    // The counter is bound to `selectedTypeRooms[0]?.extraBedCount`
    // (per-type — every room of this type shares the same
    // value via `updateExtraBedCount`'s mirror).
    expect(extrasSlice).toMatch(
      /selectedTypeRooms\[0\]\?\.extraBedCount\s*\?\?\s*0/
    );
    // The `[−]` disabled condition is `userExtraBeds <= softFloor`,
    // the `[+]` disabled condition is `userExtraBeds >= typeMaxExtraBeds`.
    expect(extrasSlice).toMatch(/userExtraBeds <= softFloor/);
    expect(extrasSlice).toMatch(/userExtraBeds >= typeMaxExtraBeds/);
  });

  it("shows the per-bed-per-night rate inline at the point of decision (no Step 3 surprise)", () => {
    // The spec rejects "hide the price until Step 3" — the
    // rate is the primary signal, surfaced on the card.
    expect(extrasSlice).toMatch(/\$\{formatPrice\(typeExtraBedRate\)\} \/ bed \/ night/);
  });

  it("hides the stay total when the count is 0 (don't show '₱0 for 2 nights')", () => {
    // Per the spec: "Stay total — hidden when `extraBedCount === 0`
    // (don't show '₱0 for 2 nights' — it's noise)."
    // The implementation gates the stay-total `<p>` on
    // `typeQuantity > 0 && userExtraBeds > 0`.
    expect(extrasSlice).toMatch(/userExtraBeds > 0 \? /);
    expect(extrasSlice).toMatch(/<p[\s\S]*?data-testid=\{`extras-stay-total-/);
    // The format is `{formatPrice(stayTotal)} for {nights} {nights === 1 ? "night" : "nights"}`.
    expect(extrasSlice).toMatch(
      /formatPrice\(stayTotal\)\} for \{nights\} \{nights === 1 \? "night" : "nights"\}/
    );
  });

  it("fires the soft-floor warning when the type's `maxExtraBeds` cap cannot cover the per-room overflow", () => {
    // The spec example: "⚠ Room needs 2 extra beds to fit
    // your group. You can add up to 1 here." — the second
    // number is the cap, the first is the soft floor.
    // The implementation shows the warning when
    // `softFloor > typeMaxExtraBeds` (the over-cap case).
    expect(extrasSlice).toMatch(/overCap = softFloor > typeMaxExtraBeds/);
    expect(extrasSlice).toMatch(
      /needs \{softFloor\} extra bed\{softFloor === 1 \? "" : "s"\} to fit your group\. You can add up to \{typeMaxExtraBeds\} here\./
    );
  });

  it("uses `requiredExtraBedsFor` to derive the soft floor (single source of overflow truth)", () => {
    // The soft floor is `max(0, requiredExtraBedsFor(...))` —
    // same helper the CHD-11 submit gate uses, so the two
    // surfaces can never disagree on what "the group needs".
    expect(extrasSlice).toMatch(/requiredExtraBedsFor\(/);
    expect(extrasSlice).toMatch(/numAdults/);
    expect(extrasSlice).toMatch(/numChildren/);
    expect(extrasSlice).toMatch(/maxCapacity/);
    expect(extrasSlice).toMatch(/maxChildren/);
    expect(extrasSlice).toMatch(
      /const softFloor = Math\.max\(0, perTypeOverflow\.requiredExtraBeds\)/
    );
  });

  it("emits the spec-mandated data-testid markers for the Extras counter", () => {
    // The four markers the spec calls out + the spec's
    // existing room-type-fit marker surface. The counter
    // wrapper carries the `extras-stepper-${type.value}`
    // testid, the count value carries `extras-count-`,
    // the stay total carries `extras-stay-total-`, and
    // the soft-floor warning carries
    // `extras-soft-floor-warning-`.
    expect(extrasSlice).toMatch(/data-testid=\{`extras-stepper-\$\{type\.value\}`\}/);
    expect(extrasSlice).toMatch(/data-testid=\{`extras-count-\$\{type\.value\}`\}/);
    expect(extrasSlice).toMatch(/data-testid=\{`extras-stay-total-\$\{type\.value\}`\}/);
    expect(extrasSlice).toMatch(
      /data-testid=\{`extras-soft-floor-warning-\$\{type\.value\}`\}/
    );
  });

  it("disables both counter buttons when the cart has 0 rooms of this type (no room to mirror the count onto)", () => {
    // The spec: the toggle is per-type, but the count lives
    // on each room. When `typeQuantity === 0`, there is no
    // room to write the count to, so the counter is inert
    // (both buttons disabled). The user has to add a room
    // first.
    expect(extrasSlice).toMatch(/typeQuantity === 0 \|\| userExtraBeds <= softFloor/);
    expect(extrasSlice).toMatch(/typeQuantity === 0 \|\| userExtraBeds >= typeMaxExtraBeds/);
    // The helper-text message guides the user: "Add at least
    // one room to set extra beds" — instead of showing the
    // rate when there's no room to apply it to.
    expect(extrasSlice).toMatch(/Add at least one room to set extra beds/);
  });

  it("disables the `[−]` at the soft floor (per-room overflow is a hard lower bound)", () => {
    // The spec: "The `[−]` is disabled at the soft floor
    // (clamped at `max(0, requiredExtraBeds)`). The user
    // can't go below the per-room overflow the group needs."
    // The implementation's disabled condition is
    // `userExtraBeds <= softFloor` — i.e., the button is
    // disabled exactly when the counter is at the floor.
    expect(extrasSlice).toMatch(/disabled=\{typeQuantity === 0 \|\| userExtraBeds <= softFloor\}/);
  });
});

describe("EXB-11 — rebalanceGuestDistribution no longer auto-computes the per-room extra-bed count", () => {
  it("preserves the user-set `extraBedCount` (clamped to `maxExtraBeds`) instead of overriding it", () => {
    // The pre-EXB-11 implementation auto-computed
    // `room.extraBedCount = overflowAdults + overflowChildren`
    // at the end of the rebalance loop, silently overriding
    // the user's choice. The EXB-11 implementation preserves
    // the cart's value (clamped to the type's `maxExtraBeds`).
    expect(bookingRoomCartSrc).toMatch(
      /requestedBeds = Math\.max\(0, Math\.floor\(Number\(room\.extraBedCount\) \|\| 0\)\)/
    );
    expect(bookingRoomCartSrc).toMatch(
      /extraBedCount: Math\.min\(requestedBeds, maxExtraBeds\)/
    );
    // The auto-compute line is gone.
    expect(bookingRoomCartSrc).not.toMatch(
      /room\.extraBedCount = overflowAdults \+ overflowChildren/
    );
  });

  it("uses the user-set count as the cap on overflow absorption (not a derived count)", () => {
    // After EXB-11, the rebalance loop reads
    // `extraSlots = room.extraBedCount` (the user-set value,
    // already clamped) instead of the type's `maxExtraBeds`.
    // If the user set fewer beds than the group needs, the
    // overflow is surfaced as `unassignedAdults` /
    // `unassignedChildren` (and the CHD-11 submit gate
    // catches it).
    expect(bookingRoomCartSrc).toMatch(/let extraSlots = room\.extraBedCount/);
  });
});

describe("EXB-11 — single extra-bed state is gone, cart is the source of truth", () => {
  it("the single `extraBedCount` state setter is removed from BookingPage", () => {
    // The pre-EXB-11 shape was a single `useState` for
    // `extraBedCount` plus a `updateExtraBeds` setter that
    // mirrored the count into the `extraBeds` URL param.
    // Both are gone in EXB-11 — the cart is the source of
    // truth and the URL state rides on `rooms=`.
    expect(bookingPageSrc).not.toMatch(/setExtraBedCount/);
    expect(bookingPageSrc).not.toMatch(/function updateExtraBeds\b/);
  });

  it("the `extraBeds` URL param is no longer written to `continueParams`", () => {
    // The per-room count is serialized via
    // `serializeBookingRoomCart` (the `rooms=` URL param);
    // a separate `extraBeds=` param is dead state and must
    // not be re-introduced.
    expect(bookingPageSrc).not.toMatch(
      /continueParams[\s\S]{0,80}extraBeds: String\(/
    );
  });

  it("the new `updateExtraBedCount` helper mirrors the user pick onto every room of the type", () => {
    // The helper updates the per-room `extraBedCount` for
    // every room of the type in the cart and re-serializes
    // the cart to the URL.
    expect(bookingPageSrc).toMatch(/function updateExtraBedCount\(/);
    expect(bookingPageSrc).toMatch(
      /room\.roomType === typeValue[\s\S]{0,200}\{ \.\.\.room, extraBedCount: safeCount \}/
    );
    expect(bookingPageSrc).toMatch(
      /updateExtraBedCount\([\s\S]{0,40}userExtraBeds \+ 1, typeMaxExtraBeds/
    );
  });

  it("the Step 2 / Step 3 aside now reads `totalExtraBeds` (the per-cart sum), not the old state", () => {
    // The pre-EXB-11 aside was wired to the single
    // `extraBedCount` state. The EXB-11 aside reads
    // `totalExtraBeds` (the per-cart sum, derived from
    // each room's `extraBedCount`) so the price breakdown
    // matches the per-type user pick on the room-type
    // card.
    expect(bookingPageSrc).toMatch(/extraBedCount=\{totalExtraBeds\}/);
    // The old `extraBedCount={extraBedCount}` shape is gone.
    expect(bookingPageSrc).not.toMatch(/extraBedCount=\{extraBedCount\}/);
  });
});
