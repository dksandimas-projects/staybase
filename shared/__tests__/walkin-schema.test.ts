import { describe, expect, test } from "vitest";
import { WalkinBookingSchema } from "../schemas/booking";

const validWalkin = {
  bookingId: "walkin12345",
  roomId: "room_101",
  checkIn: "2026-07-13",
  checkOut: "2026-07-15",
  guests: 2,
  // BR-08: the legacy `hasBreakfast: false` flag is replaced
  // by the optional `breakfastSelections` (BR-01 meal map) +
  // `breakfastTotal` (snapshotted total). A walk-in with no
  // meals picks simply omits both fields.
  guestDetails: {
    firstName: "Maria",
    lastName: "Santos",
    email: "Maria@Example.com",
    phone: "09171234567"
  },
  paymentMethod: "cash"
};

describe("WalkinBookingSchema", () => {
  test("normalizes a valid walk-in request", () => {
    const parsed = WalkinBookingSchema.parse({
      ...validWalkin,
      guests: "2",
      totalPriceOverride: "5000"
    });

    expect(parsed.guests).toBe(2);
    expect(parsed.totalPriceOverride).toBe(5000);
    expect(parsed.guestDetails.email).toBe("maria@example.com");
    expect(parsed.status).toBe("confirmed");
  });

  test.each([
    ["non-numeric override", "not-a-number"],
    ["negative override", -1],
    ["override above the transaction cap", 1_000_001]
  ])("rejects %s", (_label, totalPriceOverride) => {
    expect(WalkinBookingSchema.safeParse({ ...validWalkin, totalPriceOverride }).success).toBe(false);
  });

  test("rejects malformed guest details", () => {
    expect(WalkinBookingSchema.safeParse({
      ...validWalkin,
      guestDetails: { ...validWalkin.guestDetails, firstName: "", email: "invalid" }
    }).success).toBe(false);
  });

  test("rejects unexpected top-level fields", () => {
    expect(WalkinBookingSchema.safeParse({ ...validWalkin, totalPrice: 123 }).success).toBe(false);
  });

  test("accepts a server-issued staff inventory hold id", () => {
    const parsed = WalkinBookingSchema.parse({
      ...validWalkin,
      staffHoldId: "staffhold12345"
    });

    expect(parsed.staffHoldId).toBe("staffhold12345");
    expect(WalkinBookingSchema.safeParse({ ...validWalkin, staffHoldId: "bad/id" }).success).toBe(false);
  });
});
