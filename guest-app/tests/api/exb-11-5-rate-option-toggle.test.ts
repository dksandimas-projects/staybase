// Per EXB-11.5 (2026-08-06, per decision #198): source-text
// regression tests for the per-type rate-option toggle on
// the `/book` Step 1 room-type cards. The pre-EXB-11.5
// surface (post-EXB-11.3) had a one-way rate-option click:
// clicking a rate option added the room (or updated the
// rate if the type was already in the cart), but clicking
// the same rate again was a no-op — the user had no way to
// "untick" the room via the rate option itself (they had
// to use the "Rooms" stepper to decrement to 0).
//
// EXB-11.5 flow:
//   1. Click a rate option on a card → 1 room of that type
//      is added to the cart with the chosen rate (or the
//      rate is updated in place if the type is already in
//      the cart with a different rate).
//   2. Click the same rate option again → all rooms of
//      that type are removed from the cart (per-type
//      toggle). The `selectedRoomType` / `rateChoice`
//      state sync is skipped — the useEffect at
//      `BookingPage.tsx:865` picks another type (or
//      clears) when the current selection is no longer
//      in the cart.
//   3. Click a different rate option → the rate is
//      updated in place for every room of that type
//      (same as the pre-EXB-11.5 behavior).
//
// Sibling to EXB-11.4 (extra-bed toggle on the same card)
// — same "user is in full control" pattern, different
// surface.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("EXB-11.5 — per-type rate-option toggle on /book Step 1", () => {
  it("the `selectRoomType` function declares the toggle with three branches (add / untick / switch rate)", () => {
    // The pre-EXB-11.5 function had a single ternary:
    // `hasType ? updateRate : addRoom`. EXB-11.5 splits
    // the "type in cart" branch into two: same rate
    // (untick) vs different rate (switch).
    expect(bookingPageSrc).toMatch(
      /function selectRoomType\(typeValue: string, nextRateChoice: RateChoice\) \{[\s\S]*?existingRoom\.rateChoice === nextRateChoice[\s\S]*?next = current\.filter\(\(room\) => room\.roomType !== typeValue\)/
    );
  });

  it("the untick branch removes ALL rooms of the type (per-type toggle, not per-room)", () => {
    // The pre-EXB-11.5 "type in cart" branch updated the
    // rate in place. The EXB-11.5 untick branch uses
    // `current.filter((room) => room.roomType !== typeValue)`
    // to remove every room of that type — matches the
    // per-type shape of the rate option (one toggle per
    // type, not per room).
    expect(bookingPageSrc).toMatch(
      /existingRoom\.rateChoice === nextRateChoice\) \{[\s\S]*?next = current\.filter\(\(room\) => room\.roomType !== typeValue\)/
    );
  });

  it("the add branch stays (type not in cart → add 1 room with the chosen rate)", () => {
    // The pre-EXB-11.5 add branch is preserved. When the
    // type is not in the cart, `selectRoomType` adds 1
    // room with the chosen rate (Room Only or Room +
    // Breakfast).
    expect(bookingPageSrc).toMatch(
      /!existingRoom\) \{[\s\S]*?shouldSyncSelection = true;[\s\S]*?next = \[\s*\.\.\.current,/
    );
  });

  it("the switch-rate branch stays (type in cart with different rate → update rate in place)", () => {
    // The pre-EXB-11.5 "type in cart" branch is split:
    // when the rate is different, the rate is updated in
    // place for every room of that type (same as before).
    // When the rate is the same, the untick branch fires.
    expect(bookingPageSrc).toMatch(
      /\} else \{[\s\S]*?shouldSyncSelection = true;[\s\S]*?next = current\.map\(\(room\) =>[\s\S]*?room\.roomType === typeValue[\s\S]*?\? \{ \.\.\.room, rateChoice: nextRateChoice \}/
    );
  });

  it("the `setSelectedRoomType` + `setRateChoice` calls are guarded by `shouldSyncSelection` (skipped on the untick path)", () => {
    // The pre-EXB-11.5 function always called
    // `setSelectedRoomType(typeValue)` + `setRateChoice(nextRateChoice)`
    // regardless of which branch fired. EXB-11.5 guards
    // these calls with a `shouldSyncSelection` flag that's
    // only set to `true` on the add and switch-rate paths
    // (not the untick path). The useEffect at
    // `BookingPage.tsx:865` handles the selection sync
    // when the current selection is no longer in the cart.
    expect(bookingPageSrc).toMatch(
      /if \(shouldSyncSelection\) \{[\s\S]*?setSelectedRoomType\(typeValue\);[\s\S]*?setRateChoice\(nextRateChoice\);/
    );
  });

  it("the comment block documents the per-type toggle (add / untick / switch)", () => {
    // The comment block above `selectRoomType` must
    // explicitly document the three branches so future
    // readers understand the toggle shape. The block
    // references EXB-11.5 + decision #198 and notes the
    // "user is in full control" pattern.
    expect(bookingPageSrc).toMatch(/Per EXB-11\.5/);
    expect(bookingPageSrc).toMatch(/decision #198/);
    expect(bookingPageSrc).toMatch(/per-type toggle/);
  });

  it("the hint text on /book Step 1 tells the user about the toggle (click to add, click again to remove)", () => {
    // The pre-EXB-11.5 hint said "Select Room Only or
    // Room + Breakfast to lock the Step 1 summary" — a
    // one-way instruction. EXB-11.5 updates the hint to
    // "Click a rate to add a room. Click the same rate
    // again to remove it." — a two-way instruction that
    // teaches the toggle.
    expect(bookingPageSrc).toMatch(
      /Click a rate to add a room\. Click the same rate again to remove it\./
    );
    // The pre-EXB-11.5 hint is gone.
    expect(bookingPageSrc).not.toMatch(
      /Select Room Only or Room \+ Breakfast to lock the Step 1 summary\./
    );
  });

  it("the `selectRoomType` function is still exported / wired to the rate-option `onSelect` handlers", () => {
    // Sanity check: the function still exists with the
    // same signature, and the two rate-option `onSelect`
    // handlers in the room-type card still call it with
    // the correct rate choice.
    expect(bookingPageSrc).toMatch(
      /function selectRoomType\(typeValue: string, nextRateChoice: RateChoice\)/
    );
    expect(bookingPageSrc).toMatch(
      /onSelect=\{\(\) => selectRoomType\(type\.value, "room-only"\)\}/
    );
    expect(bookingPageSrc).toMatch(
      /onSelect=\{\(\) => selectRoomType\(type\.value, "room-breakfast"\)\}/
    );
  });
});

describe("EXB-11.5 — the EXB-11.3 tests still hold (no default room-type on page load)", () => {
  it("the `selectRoomType` function still has the user-explicit path (the EXB-11.3 invariant)", () => {
    // EXB-11.3 established that the user must explicitly
    // click a rate option to add a room — no auto-select
    // on page load. EXB-11.5 extends this to a toggle
    // (click to add, click again to remove) but the
    // user-explicit invariant is preserved: the function
    // still has the add branch.
    expect(bookingPageSrc).toMatch(
      /function selectRoomType\(typeValue: string, nextRateChoice: RateChoice\)/
    );
  });
});
