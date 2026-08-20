import { describe, expect, it } from "vitest";
import {
  parseBookingRoomCart,
  rebalanceGuestDistribution,
  serializeBookingRoomCart,
  type BookingRoomCartItem
} from "../utils/bookingRoomCart";

const roomTypes = [
  { value: "standard", maxCapacity: 2, maxChildren: 1, maxExtraBeds: 1 },
  { value: "family", maxCapacity: 3, maxChildren: 2, maxExtraBeds: 0 }
];

describe("booking room cart", () => {
  it("distributes one lead adult per room, then fills configured caps", () => {
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 0 },
      { bookingId: "b", roomType: "family", rateChoice: "room-breakfast", numAdults: 0, numChildren: 0, extraBedCount: 0 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 4, 3);
    expect(result.unassignedAdults).toBe(0);
    expect(result.unassignedChildren).toBe(0);
    expect(result.rooms.map((room) => room.numAdults)).toEqual([2, 2]);
    expect(result.rooms.map((room) => room.numChildren)).toEqual([1, 2]);
  });

  it("reports guests that cannot fit instead of silently dropping them", () => {
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 0 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 4, 2);
    expect(result.unassignedAdults + result.unassignedChildren).toBeGreaterThan(0);
  });

  it("round-trips the URL-safe cart state", () => {
    // Per EXB-12 (2026-08-06, per decision #199): the
    // cart gained an `extraBedBreakfast` field. The
    // `parseBookingRoomCart` helper coerces any
    // nullish / false / non-boolean value to
    // `extraBedBreakfast: false` (no breakfast for
    // extra beds), so a serialize → parse round-trip
    // turns an undefined field into `false` — vitest's
    // `.toEqual` treats `undefined` vs `false` as
    // unequal. The fixture MUST declare the field
    // explicitly so the round-trip is byte-equivalent.
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 2, numChildren: 1, extraBedCount: 0, extraBedBreakfast: false }
    ];
    const roundTripped = parseBookingRoomCart(serializeBookingRoomCart(rooms));
    expect(roundTripped).toEqual(rooms);
    // Pin the EXB-12 invariant explicitly: the
    // round-trip preserves the false default. If a
    // future refactor drops the `extraBedBreakfast`
    // handling in parseBookingRoomCart, the field
    // would be undefined after parse — vitest's
    // `.toEqual` would fail (undefined ≠ false) and
    // this assertion catches the drift at the test
    // boundary, not at the runtime boundary.
    expect(roundTripped[0].extraBedBreakfast).toBe(false);
  });

  // Per EXB-12 (2026-08-06, per decision #199): the
  // round-trip MUST preserve `extraBedBreakfast: true`
  // (the opt-in case) end-to-end. If a future refactor
  // drops the `extraBedBreakfast === true` guard in
  // parseBookingRoomCart (the defensive coercion),
  // the cart would lose the guest's choice after every
  // page reload — silent data loss. Pin the opt-in
  // path with its own test so the true + false paths
  // are both covered.
  it("round-trips the EXB-12 extra-bed breakfast opt-in toggle", () => {
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-breakfast", numAdults: 2, numChildren: 1, extraBedCount: 1, extraBedBreakfast: true }
    ];
    const roundTripped = parseBookingRoomCart(serializeBookingRoomCart(rooms));
    expect(roundTripped).toEqual(rooms);
    expect(roundTripped[0].extraBedBreakfast).toBe(true);
  });

  // Per EXB-11 (2026-08-04, per decision #186): the
  // user-set per-room `extraBedCount` is the source of
  // truth. The rebalance preserves the value (clamped to
  // the type's `maxExtraBeds`) instead of auto-computing it
  // from the overflow rule.
  it("preserves the user-set per-room extraBedCount instead of auto-computing it (EXB-11)", () => {
    // 3 adults in 1 Standard (maxCap 2, maxExtraBeds 1):
    // pre-EXB-11 would set `extraBedCount = 1` (1 overflow
    // adult, 1 extra bed covers it). EXB-11 preserves the
    // user's pick — here 0 — and surfaces the overflow as
    // `unassignedAdults` so the CHD-11 submit gate can
    // catch it. The room still absorbs 2 adults (1 lead
    // + 1 fill from the cap).
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 0 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 3, 0);
    expect(result.rooms[0].extraBedCount).toBe(0);
    expect(result.rooms[0].numAdults).toBe(2);
    expect(result.unassignedAdults).toBe(1);
  });

  it("clamps a user-set extraBedCount above maxExtraBeds to the type's cap (EXB-11)", () => {
    // The user can only set up to the type's `maxExtraBeds`.
    // A value above the cap (legacy state, malicious URL
    // param) is clamped to the cap on rebalance.
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 5 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 2, 1);
    expect(result.rooms[0].extraBedCount).toBe(1);
  });

  it("uses the user-set count as the cap on overflow absorption (EXB-11)", () => {
    // 3 adults in 1 Standard (maxCap 2, maxExtraBeds 1)
    // with `extraBedCount: 0`: 2 adults fit in the room
    // (1 lead + 1 fill), 1 adult is unassigned (the cap
    // on overflow absorption is the user-set count, not
    // the type's `maxExtraBeds`). Pre-EXB-11, the rebalance
    // would have bumped the bed count to 1 to absorb the
    // overflow.
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 0 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 3, 0);
    expect(result.rooms[0].extraBedCount).toBe(0);
    expect(result.rooms[0].numAdults).toBe(2);
    expect(result.unassignedAdults).toBe(1);
  });

  it("a 0-maxExtraBeds type with overflow reports unassigned guests (EXB-11)", () => {
    // 4 adults in 1 Family (maxCap 3, maxExtraBeds 0): the
    // type offers no extra beds, so the user-set count is
    // pinned to 0 and the overflow is reported.
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "family", rateChoice: "room-only", numAdults: 0, numChildren: 0, extraBedCount: 0 }
    ];
    const result = rebalanceGuestDistribution(rooms, roomTypes, 4, 0);
    expect(result.rooms[0].extraBedCount).toBe(0);
    expect(result.rooms[0].numAdults).toBe(3);
    expect(result.unassignedAdults).toBe(1);
  });
});
