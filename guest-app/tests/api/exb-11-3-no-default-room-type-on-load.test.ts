// Per EXB-11.3 (2026-08-04, per decision #191): source-text
// regression tests for the "no default room-type selection on
// /book page load" UX fix. The pre-EXB-11.3 surface had a
// `useEffect` that auto-picked the first available room type
// and silently added it to the cart on page load. The user
// landed on `/book` with a pre-checked rate option, a "Fits
// your group" chip, an active "Rooms" stepper showing "1",
// and a pre-populated "Your cart" line — all without the user
// having explicitly chosen anything.
//
// EXB-11.3 flow:
//   1. On page load, the cart is empty and no room type is
//      pre-selected. The user must click a rate option on a
//      card to add 1 of that type to the cart.
//   2. The sync branch fires when the cart has rooms but the
//      selection doesn't match (e.g., after a URL-driven
//      pre-fill, or after the user adds a second room type).
//   3. URL-driven pre-fill stays — `?roomType=single-room` or
//      `?rooms=single-room:1:2:0:0` deep-links still pre-fill
//      the selection + cart.
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

describe("EXB-11.3 — no default room-type selection on /book page load", () => {
  it("the auto-select useEffect no longer has the `if (roomCart.length === 0 && availableRoomTypes[0])` branch", () => {
    // The pre-EXB-11.3 useEffect had an auto-select
    // branch that fired on empty cart. EXB-11.3
    // removes that branch — the only remaining logic
    // in the useEffect is the sync branch (cart has
    // rooms but selection doesn't match).
    expect(bookingPageSrc).not.toMatch(
      /if \(roomCart\.length === 0 && availableRoomTypes\[0\]\)/
    );
  });

  it("the auto-select's `setSelectedRoomType(defaultType)` call is gone", () => {
    // The pre-EXB-11.3 branch called
    // `setSelectedRoomType(defaultType)` to pre-select
    // the first available room type. EXB-11.3
    // removes that call — the selection is now
    // user-explicit (via the rate-option click) or
    // URL-driven (via the `?roomType=` param).
    expect(bookingPageSrc).not.toMatch(
      /setSelectedRoomType\(defaultType\)/
    );
  });

  it("the auto-select's `setRoomCart([{ ...defaultType, ... }])` call is gone", () => {
    // The pre-EXB-11.3 branch called
    // `setRoomCart([{ ... }])` to silently add 1 of
    // the default type to the cart. EXB-11.3 removes
    // that call — the cart is empty on page load;
    // the user adds a room via the rate-option click
    // (`selectRoomType` at `BookingPage.tsx:935-960`).
    expect(bookingPageSrc).not.toMatch(
      /setRoomCart\(\[?\{[\s\S]{0,200}defaultType/
    );
  });

  it("the sync branch is still present (for the deep-link / re-render path)", () => {
    // The sync branch fires when the cart has rooms
    // but the selection doesn't match. This handles
    // the URL-driven pre-fill case (e.g., the cart
    // has 1 Single Room from `?rooms=single-room:1:2:0:0`
    // but the selection is empty). The sync branch
    // sets the selection to match the cart's first
    // room.
    expect(bookingPageSrc).toMatch(
      /!roomCart\.some\(\(room\) => room\.roomType === selectedRoomType\) && roomCart\[0\]/
    );
  });

  it("the `selectRoomType` function (user click handler) is unchanged", () => {
    // The user-explicit path: user clicks a rate
    // option on a card → `selectRoomType` is called →
    // the type is added to the cart (if not present)
    // and the selection is set. This is the path
    // EXB-11.3 wants the user to take.
    expect(bookingPageSrc).toMatch(
      /function selectRoomType\(typeValue: string, nextRateChoice: RateChoice\)/
    );
  });

  it("the `updateRoomQuantity` function (user changes quantity) is unchanged", () => {
    // The user-explicit path: user changes the
    // "Rooms" stepper on a card → `updateRoomQuantity`
    // is called → the cart's count for that type is
    // updated. Unchanged from EXB-11.
    expect(bookingPageSrc).toMatch(
      /function updateRoomQuantity\(typeValue: string, nextQuantity: number, maxQuantity: number\)/
    );
  });

  it("the bottom bar's `Add at least one room` CTA is still present (the existing disabled-state label)", () => {
    // When `distributedRoomCart.length === 0`, the
    // disabled Next button's label is
    // "Add at least one room" (per the existing
    // wiring at `BookingPage.tsx:2900`). With no
    // auto-select, this is the default state on
    // page load. The CTA guides the user to click
    // a rate option on a card.
    expect(bookingPageSrc).toMatch(/Add at least one room/);
  });

  it("the URL-driven pre-fill is still wired (the `selectedRoomType` state is initialized from `searchParams.get(\"roomType\")`)", () => {
    // The `selectedRoomType` state at
    // `BookingPage.tsx:244` is initialized from
    // `searchParams.get("roomType") ?? ""`. A
    // deep-link to `/book?roomType=single-room` is
    // intentional pre-fill (the user typed the URL)
    // — the selection is set from the URL, no
    // auto-select needed. The same goes for
    // `roomCart` (initialized from
    // `searchParams.get("rooms")` via the cart
    // parser).
    expect(bookingPageSrc).toMatch(
      /useState\(searchParams\.get\("roomType"\) \?\? ""\)/
    );
  });
});
