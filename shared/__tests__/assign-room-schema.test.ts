// Per RAR-01 (2026-11-19, decision #323): the pre-assigned room
// override's request contract.
//
// The schema is the FIRST line of defence for the rule that matters
// most here: an override changes the room and NOTHING else. The
// body has no date fields and no price fields, so a client — or a
// future refactor of the admin client — physically cannot ask the
// server to move the stay or re-price it through this route.

import { describe, expect, it } from "vitest";
import { AssignRoomSchema } from "../schemas/booking";

describe("RAR-01 §AssignRoomSchema", () => {
  it("accepts a booking id, a room id and an optional reason", () => {
    const parsed = AssignRoomSchema.safeParse({
      bookingId: "booking_1",
      roomId: "room_14",
      reason: "Room 12 needs cleaning"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bookingId).toBe("booking_1");
      expect(parsed.data.roomId).toBe("room_14");
      expect(parsed.data.reason).toBe("Room 12 needs cleaning");
    }
  });

  it("defaults the reason to an empty string", () => {
    const parsed = AssignRoomSchema.safeParse({ bookingId: "booking_1", roomId: "room_14" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe("");
  });

  it("trims the ids", () => {
    const parsed = AssignRoomSchema.safeParse({ bookingId: "  booking_1  ", roomId: "  room_14  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bookingId).toBe("booking_1");
      expect(parsed.data.roomId).toBe("room_14");
    }
  });

  it("rejects a missing booking id or room id", () => {
    expect(AssignRoomSchema.safeParse({ roomId: "room_14" }).success).toBe(false);
    expect(AssignRoomSchema.safeParse({ bookingId: "booking_1" }).success).toBe(false);
    expect(AssignRoomSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty booking id or room id", () => {
    expect(AssignRoomSchema.safeParse({ bookingId: "   ", roomId: "room_14" }).success).toBe(false);
    expect(AssignRoomSchema.safeParse({ bookingId: "booking_1", roomId: "   " }).success).toBe(false);
  });

  it("caps the reason at 500 characters, like the reschedule schema", () => {
    expect(
      AssignRoomSchema.safeParse({ bookingId: "b", roomId: "r", reason: "x".repeat(500) }).success
    ).toBe(true);
    expect(
      AssignRoomSchema.safeParse({ bookingId: "b", roomId: "r", reason: "x".repeat(501) }).success
    ).toBe(false);
  });

  it("is strict — an unexpected field is rejected", () => {
    // The whole point of the strict posture: a client cannot smuggle
    // a price or a date past the contract.
    expect(
      AssignRoomSchema.safeParse({
        bookingId: "booking_1",
        roomId: "room_14",
        totalPrice: 1
      }).success
    ).toBe(false);
    expect(
      AssignRoomSchema.safeParse({
        bookingId: "booking_1",
        roomId: "room_14",
        checkIn: "2026-11-20",
        checkOut: "2026-11-22"
      }).success
    ).toBe(false);
  });
});
