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
    const rooms: BookingRoomCartItem[] = [
      { bookingId: "a", roomType: "standard", rateChoice: "room-only", numAdults: 2, numChildren: 1, extraBedCount: 0 }
    ];
    expect(parseBookingRoomCart(serializeBookingRoomCart(rooms))).toEqual(rooms);
  });
});
