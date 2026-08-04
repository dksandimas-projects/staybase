// Per EXB-11 (2026-08-04, per decision #186) + EXB-11.1
// (2026-08-04, per decision #189): source-text regression tests
// for the user-controlled extra-bed toggle on the `/book` page.
// The pre-EXB-11 flow auto-computed the per-room `extraBedCount`
// from the overflow rule, hiding the per-bed-per-night price
// until Step 3 and silently overriding the user's intent.
//
// EXB-11 flow:
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
// EXB-11.1 refinements (operator feedback post-EXB-11):
//   1. Moved the Extras sub-section to the BOTTOM of the
//      room-type card (after the rate options + mixed-rates
//      panel) — same shape as the breakfast add-on, keeps the
//      decision cluster tight.
//   2. When `maxExtraBeds === 1`, render a binary checkbox
//      instead of the counter (the user can only set 0 or 1;
//      the counter presents 3 affordances for a yes/no
//      decision).
//   3. Checkbox disabled-when-soft-floor rules differ from the
//      counter's: it's disabled when `userExtraBeds === 0 &&
//      softFloor >= 1` (the "forced on" affordance — the user
//      can't uncheck what the group requires), not just at the
//      floor like the `[−]`. The over-cap state stays a
//      separate warning.
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
// the per-type counter OR checkbox (EXB-11.1 split) + rate +
// stay total + soft-floor warning. Use a unique comment
// marker to anchor the start, and the unique `})()}` close of
// the IIFE for the end (the IIFE returns the JSX block and the
// closing `})()}` is the only top-level close after the JSX).
// The "EXB-11 (2026-08-04, per decision\n                            #186)
// + EXB-11.1 (2026-08-04, per decision\n                            #189):
// the per-type" string is only present in this block.
const extrasStart = bookingPageSrc.indexOf(
  "EXB-11 (2026-08-04, per decision\n                            #186) + EXB-11.1 (2026-08-04, per decision\n                            #189): the per-type"
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

describe("EXB-11.1 — bottom-of-card placement + checkbox for `maxExtraBeds === 1`", () => {
  it("the Extras IIFE was moved to the bottom of the room-type card (after the mixed-rates panel)", () => {
    // Per the EXB-11.1 spec, the sub-section is now
    // positioned after the rate options + the
    // "mixed nightly rates" panel. The position
    // in the source file is captured by the
    // comment marker (which now references both
    // EXB-11 and EXB-11.1) and by the fact that
    // the slice's start comes AFTER the
    // `hasNonRegularRate` mixed-rates panel in
    // the file. The slice's first marker is the
    // EXB-11 + EXB-11.1 comment header.
    expect(extrasSlice).toMatch(/EXB-11\.1/);
    // The comment explicitly documents the move.
    expect(extrasSlice).toMatch(/BOTTOM of the\s+card/);
    expect(extrasSlice).toMatch(/after the rate options \+ mixed-rates/);
  });

  it("the Extras IIFE was moved to bottom of card (proves it sits after the mixed-rates panel, not the capacity chip)", () => {
    // Sanity check: in the full source file, the
    // Extras IIFE's start position is AFTER the
    // mixed-rates panel's start position. The
    // EXB-11 implementation placed it directly
    // after the capacity chip (per the original
    // PR), so a strict "EXB-11.1" move has to
    // come after the panel.
    const mixedRatesStart = bookingPageSrc.indexOf("This stay uses mixed nightly rates");
    const exbStart = bookingPageSrc.indexOf(
      "EXB-11 (2026-08-04, per decision\n                            #186) + EXB-11.1 (2026-08-04, per decision\n                            #189): the per-type"
    );
    expect(mixedRatesStart).toBeGreaterThan(-1);
    expect(exbStart).toBeGreaterThan(-1);
    expect(exbStart).toBeGreaterThan(mixedRatesStart);
  });

  it("the wrapping div uses `mt-6` (EXB-11 used `mt-4` — bumped to mirror the breakfast add-on's bottom-of-card spacing)", () => {
    // The breakfast add-on uses `mt-4`/`mt-6`
    // for bottom-of-card spacing. To match the
    // visual rhythm and signal "this is a
    // decision cluster at the bottom", the
    // Extras wrapper bumped to `mt-6`.
    expect(extrasSlice).toMatch(/className="mt-6 grid gap-2"/);
  });

  it("splits the body into two branches on `typeMaxExtraBeds === 1` (checkbox) vs `>= 2` (counter)", () => {
    // The discriminator is `typeMaxExtraBeds === 1`.
    // The checkbox branch is the `if` return, the
    // counter branch is the trailing `return` after
    // the `if` (no `else` — the early `return` from
    // the IIFE handles the `=== 1` case).
    expect(extrasSlice).toMatch(/if \(typeMaxExtraBeds === 1\)/);
    // The trailing `return` after the `if` block is
    // the counter branch (the IIFE has one
    // return-per-shape).
    const checkboxBranchEnd = extrasSlice.indexOf("if (typeMaxExtraBeds === 1)");
    const trailingReturn = extrasSlice.lastIndexOf("return (");
    expect(checkboxBranchEnd).toBeGreaterThan(-1);
    expect(trailingReturn).toBeGreaterThan(checkboxBranchEnd);
  });

  it("the checkbox branch renders an `<input type=\"checkbox\">` with the spec's testid, `id`, and label", () => {
    // The checkbox's `id` matches the `<label
    // htmlFor>` so clicking the label toggles the
    // checkbox (a11y + UX requirement). The
    // testid is the spec's
    // `extras-checkbox-${type.value}`.
    expect(extrasSlice).toMatch(/type="checkbox"/);
    expect(extrasSlice).toMatch(
      /id=\{`extras-checkbox-\$\{type\.value\}`\}/
    );
    expect(extrasSlice).toMatch(
      /data-testid=\{`extras-checkbox-\$\{type\.value\}`\}/
    );
    // The label is `htmlFor`-bound to the
    // checkbox's `id`.
    expect(extrasSlice).toMatch(
      /htmlFor=\{`extras-checkbox-\$\{type\.value\}`\}/
    );
    // The checkbox has its own label distinct
    // from the counter's "Extra beds" — a
    // yes/no is "Add an extra bed".
    expect(extrasSlice).toMatch(/Add an extra bed/);
  });

  it("the checkbox's `checked` is `userExtraBeds === 1` and the `onChange` writes 0 or 1 via `updateExtraBedCount`", () => {
    // The checkbox's `checked` reads the cart's
    // per-type count (mirrored onto every room
    // of the type). The `onChange` translates
    // the binary toggle to 0/1 and writes it via
    // the same `updateExtraBedCount` helper the
    // counter uses — no new mutation path.
    expect(extrasSlice).toMatch(/checked=\{userExtraBeds === 1\}/);
    expect(extrasSlice).toMatch(
      /onChange=\{\(e\) => updateExtraBedCount\(type\.value, e\.target\.checked \? 1 : 0, typeMaxExtraBeds\)\}/
    );
  });

  it("the checkbox's `disabled` is `typeQuantity === 0 || (userExtraBeds === 0 && softFloor >= 1)` (different from the counter's)", () => {
    // The checkbox's disabled-when-soft-floor
    // rule is NOT the same as the counter's
    // `[−]` rule. The counter's `[−]` disables
    // at the floor (`userExtraBeds <= softFloor`)
    // because the user might want to drop down
    // but can't go below. The checkbox's
    // disabled rule fires when the user is at
    // 0 AND the group needs at least 1 — i.e.,
    // the "forced on" affordance, since
    // unchecking would invalidate the group.
    expect(extrasSlice).toMatch(
      /disabled=\{typeQuantity === 0 \|\| \(userExtraBeds === 0 && softFloor >= 1\)\}/
    );
    // The counter's `[−]` rule still exists in
    // the counter branch and is unchanged.
    expect(extrasSlice).toMatch(
      /disabled=\{typeQuantity === 0 \|\| userExtraBeds <= softFloor\}/
    );
  });

  it("the checkbox's `aria-describedby` is wired to the soft-floor warning when the group needs the extra bed", () => {
    // The `aria-describedby` is conditional: it
    // only points to the soft-floor warning when
    // `softFloor >= 1` (i.e., the group needs the
    // extra bed and the warning is on screen).
    // Screen readers should announce the warning
    // when the user tabs onto the checkbox in
    // that state.
    expect(extrasSlice).toMatch(
      /aria-describedby=\{softFloor >= 1 \? `extras-soft-floor-warning-\$\{type\.value\}` : undefined\}/
    );
  });

  it("the counter branch is rendered separately (no checkbox) when `typeMaxExtraBeds >= 2`", () => {
    // The counter branch is the trailing
    // `return` after the checkbox branch's
    // early return. It renders the
    // `[−] count [+]` stepper with
    // `extras-count-${type.value}` and
    // `extras-stepper-${type.value}` testids.
    // No checkbox in this branch.
    expect(extrasSlice).toMatch(/data-testid=\{`extras-count-\$\{type\.value\}`\}/);
    expect(extrasSlice).toMatch(/aria-label=\{`Remove one extra bed from \$\{type\.label\}`\}/);
    expect(extrasSlice).toMatch(/aria-label=\{`Add one extra bed to \$\{type\.label\}`\}/);
    // The counter label is "Extra beds" (the
    // checkbox's "Add an extra bed" is the
    // distinct label for the yes/no shape).
    expect(extrasSlice).toMatch(/Extra beds/);
  });

  it("the data model and helpers are unchanged from EXB-11 (no auto-init, no new URL params, no new state)", () => {
    // Per the spec: "The data model is
    // unchanged: `room.extraBedCount: number`
    // (0 or 1 for the checkbox case; 0..maxExtraBeds
    // for the counter case). `rebalanceGuestDistribution`
    // clamping unchanged. `updateExtraBedCount`
    // unchanged. Cart URL serialization unchanged."
    // No auto-init in `updateRoomQuantity` was
    // added — the user can be in a state where
    // `typeQuantity === 0` and `softFloor === 1`,
    // and the CHD-11 submit gate catches the
    // over-cap. Simpler than the auto-init path.
    expect(bookingPageSrc).not.toMatch(/setExtraBedCount/);
    expect(bookingPageSrc).not.toMatch(/function updateExtraBeds\b/);
    expect(bookingPageSrc).toMatch(/function updateExtraBedCount\(/);
  });
});
