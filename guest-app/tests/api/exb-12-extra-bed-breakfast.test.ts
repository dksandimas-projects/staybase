// Per EXB-12 (2026-08-06, per decision #199): source-text
// regression tests for the extra-bed breakfast toggle on
// the `/book` Step 1 room-type cards. The pre-EXB-12
// surface had no way to opt in to breakfast for the
// extra-bed occupant(s) — the breakfast total was
// strictly `numAdults + (includesChildren ? numChildren : 0)`,
// and the extra beds were priced as a separate add-on with
// no breakfast coupling. The operator's ask on 2026-08-06:
// "if someone adds an extra bed, are they included in the
// breakfast?" — answer: not by default, but the user can
// opt in via a per-type toggle on the Extras sub-section.
//
// EXB-12 flow:
//   1. The `BookingRoomCartItem` gains an optional
//      `extraBedBreakfast: boolean` field (default `false`).
//   2. The `calculateBreakfastAddOn` helper gains two
//      optional fields — `extraBedCount` and
//      `extraBedBreakfast`. When `extraBedBreakfast` is
//      truthy, the helper counts `extraBedCount` toward the
//      breakfast total (priced as
//      `breakfastRate × extraBedCount × nights`).
//   3. The server validates the invariant:
//      `extraBedBreakfast implies extraBedCount > 0`.
//      A `true` toggle with 0 extra beds is forced off.
//   4. The toggle is disabled when `extraBedCount === 0`
//      (no point offering breakfast for 0 extra beds).
//   5. The toggle only renders when `breakfastConfig.isEnabled`
//      (no point offering breakfast when breakfast is off).
//   6. The toggle is per-type, mirrored onto every room of
//      the type (same pattern as the extra-bed count +
//      rate choice).
//
// Sibling to EXB-11 (extra-bed toggle) + EXB-11.4
// (revert auto-init) + EXB-11.5 (rate-option toggle) on
// the same room-type card.
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
const bookingRoomCartSrc = readFileSync(
  resolve(__dirname, "../../src/utils/bookingRoomCart.ts"),
  "utf8"
);
const bookingAddOnsSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingAddOns.ts"),
  "utf8"
);
const bookingSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);
const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const serverHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const rateBreakdownSrc = readFileSync(
  resolve(__dirname, "../../server/lib/rate-breakdown.ts"),
  "utf8"
);

describe("EXB-12 — extra-bed breakfast toggle on /book Step 1", () => {
  it("the `BookingRoomCartItem` shape gains an optional `extraBedBreakfast: boolean` field", () => {
    // The pre-EXB-12 cart shape had no breakfast-for-extra-beds
    // field. EXB-12 adds it as optional (default `false`).
    expect(bookingRoomCartSrc).toMatch(
      /interface BookingRoomCartItem \{[\s\S]*?extraBedBreakfast\?: boolean;/
    );
  });

  it("the `parseBookingRoomCart` helper preserves `extraBedBreakfast` from the URL", () => {
    // The helper normalizes `extraBedBreakfast === true` (any
    // other value → `false`) so a stale URL with a non-boolean
    // value can't slip through. The server enforces the
    // invariant `extraBedBreakfast implies extraBedCount > 0`.
    expect(bookingRoomCartSrc).toMatch(
      /extraBedBreakfast: room\.extraBedBreakfast === true/
    );
  });

  it("the `calculateBreakfastAddOn` helper accepts `extraBedCount` + `extraBedBreakfast`", () => {
    // The helper interface gains two new optional fields.
    // When `extraBedBreakfast` is truthy, the helper counts
    // `extraBedCount` toward the breakfast total.
    expect(bookingAddOnsSrc).toMatch(/extraBedCount\?: number \| null;/);
    expect(bookingAddOnsSrc).toMatch(/extraBedBreakfast\?: boolean \| null;/);
  });

  it("the helper's `effectiveOccupancy` includes `extraBedCount` when `extraBedBreakfast` is truthy", () => {
    // The post-EXB-12 effective occupancy is
    // `(numAdults + (includesChildren ? numChildren : 0)) + (extraBedBreakfast ? extraBedCount : 0)`.
    // The test matches the conditional + addition pattern.
    expect(bookingAddOnsSrc).toMatch(
      /if \(input\.extraBedBreakfast\) \{[\s\S]*?effectiveOccupancy \+= extraBedCount;/
    );
  });

  it("the public booking schema accepts `extraBedBreakfast: z.boolean().optional()`", () => {
    // The public booking schema (CreateBookingSchema) gains
    // an optional boolean for the extra-bed breakfast toggle.
    // When absent, the server treats it as `false`.
    expect(bookingSchemaSrc).toMatch(
      /extraBedCount: z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.max\(20\)\.optional\(\),[\s\S]*?extraBedBreakfast: z\.boolean\(\)\.optional\(\),/
    );
  });

  it("the walkin schema also accepts `extraBedBreakfast` (admin consistency)", () => {
    // The walkin schema (WalkinRoomLineSchema) gains the
    // same field for admin consistency. A walk-in booking
    // can also opt in to breakfast for extra beds.
    expect(bookingSchemaSrc).toMatch(
      /WalkinRoomLineSchema = z\.object\(\{[\s\S]*?extraBedBreakfast: z\.boolean\(\)\.optional\(\)/
    );
  });

  it("the booking room line type gains an `extraBedBreakfast?: boolean` field", () => {
    // The shared `BookingRoom` type (in `shared/types/index.ts`)
    // gains the field for storage + retrieval. The invariant
    // `extraBedBreakfast implies extraBedCount > 0` is
    // enforced server-side.
    expect(sharedTypesSrc).toMatch(/extraBedBreakfast\?: boolean;/);
  });

  it("the BookingPage exposes an `updateExtraBedBreakfast` helper (per-type mirror)", () => {
    // The helper mirrors the user's pick onto every room of
    // the type (same per-type shape as the extra-bed count
    // + rate choice). When the extra-bed count is 0, the
    // toggle is forced off (no breakfast for 0 extra beds).
    expect(bookingPageSrc).toMatch(
      /function updateExtraBedBreakfast\(typeValue: string, nextEnabled: boolean\)/
    );
  });

  it("the BookingPage's `breakfastTotal` passes `extraBedCount` + `extraBedBreakfast` to the helper", () => {
    // The client-side breakfast total includes the
    // extra-bed breakfast when the toggle is on. The
    // per-room `extraBedBreakfast` is read from the cart
    // (`room.extraBedBreakfast === true`).
    expect(bookingPageSrc).toMatch(
      /extraBedCount: room\.extraBedCount,[\s\S]*?extraBedBreakfast: room\.extraBedBreakfast === true/
    );
  });

  it("the Extras IIFE renders an `Include breakfast for the extra beds` toggle (both branches)", () => {
    // The toggle is added in both the checkbox branch
    // (`typeMaxExtraBeds === 1`) and the counter branch
    // (`typeMaxExtraBeds >= 2`). It carries the
    // `extras-breakfast-toggle-${type.value}` testid and
    // is disabled when `userExtraBeds === 0`.
    const breakfastToggleMatches = bookingPageSrc.match(
      /Include breakfast for the extra bed/g
    );
    expect(breakfastToggleMatches?.length).toBeGreaterThanOrEqual(2);
    expect(bookingPageSrc).toMatch(
      /disabled=\{userExtraBeds === 0\}[\s\S]*?onChange=\{\(e\) => updateExtraBedBreakfast\(type\.value, e\.target\.checked\)\}/
    );
  });

  it("the toggle only renders when the breakfast config is enabled", () => {
    // The toggle is gated on `breakfastConfig.isEnabled` —
    // no point offering breakfast for extra beds when
    // breakfast is globally off. Both branches have the
    // same gate.
    const breakfastConfigGateMatches = bookingPageSrc.match(
      /typeQuantity > 0 && breakfastConfig\.isEnabled/g
    );
    expect(breakfastConfigGateMatches?.length).toBeGreaterThanOrEqual(2);
  });

  it("the booking body passes `extraBedBreakfast` to the server (multi-room + single-room)", () => {
    // The create body's `rooms[]` and the single-room
    // `firstRoomSelection` both include the toggle. The
    // server reads it to count the extra beds toward the
    // breakfast total.
    const bodyMatches = bookingPageSrc.match(
      /extraBedBreakfast: (?:room|firstRoomSelection)\.extraBedBreakfast === true/g
    );
    expect(bodyMatches?.length).toBeGreaterThanOrEqual(2);
  });

  it("the server handler validates the invariant `extraBedBreakfast implies extraBedCount > 0`", () => {
    // The validatedRoomStays loop forces the toggle off
    // when `extraBedCount === 0` — a `true` toggle with 0
    // extra beds is a client bug (or stale URL). The
    // server is the authoritative gate.
    expect(serverHandlerSrc).toMatch(
      /const extraBedBreakfast = selection\.extraBedBreakfast === true && extraBedCount > 0;/
    );
  });

  it("the server's `calculateBreakfastAddOn` call includes `extraBedCount` + `extraBedBreakfast`", () => {
    // The server's per-room pricing loop passes both fields
    // to the helper. The helper's effective occupancy now
    // includes `extraBedCount` when the toggle is on.
    expect(serverHandlerSrc).toMatch(
      /extraBedCount: stay\.extraBedCount,[\s\S]*?extraBedBreakfast: stay\.extraBedBreakfast === true/
    );
  });

  it("the server snapshots `extraBedBreakfast` onto the booking doc", () => {
    // The create body's per-room object includes
    // `extraBedBreakfast: pricingForRoom.extraBedBreakfast === true`.
    // Older booking docs without the field default to
    // `false` (no breakfast for extra beds) on read.
    expect(serverHandlerSrc).toMatch(
      /extraBedBreakfast: pricingForRoom\.extraBedBreakfast === true/
    );
  });

  it("the rate-breakdown rebuild path passes `extraBedCount` + `extraBedBreakfast` to the helper", () => {
    // The early-departure / reschedule rebuild reads
    // `booking.extraBedCount` + `booking.extraBedBreakfast`
    // from the booking doc and passes them to the helper.
    // Nullish → no extra-bed breakfast (back-compat with
    // older docs). This ensures the rebuild matches the
    // create-time total.
    const rebuildMatches = rateBreakdownSrc.match(
      /extraBedCount: booking\.extraBedCount,[\s\S]*?extraBedBreakfast: booking\.extraBedBreakfast === true/g
    );
    expect(rebuildMatches?.length).toBeGreaterThanOrEqual(2);
  });
});
