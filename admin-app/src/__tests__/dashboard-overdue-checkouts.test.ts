import { describe, expect, it } from "vitest";
import type { Booking } from "../context/AdminContext";
import { getDaysOverdue, parseTimeToMinutes, selectOverdueCheckouts } from "../pages/DashboardPage";

const booking = (overrides: Partial<Booking>): Booking => ({
  id: "booking-1",
  bookingRef: "SI-20260710-001",
  roomId: "room-101",
  roomNumber: "101",
  roomType: "standard",
  guestName: "Test Guest",
  guestEmail: "guest@example.com",
  guestPhone: "09170000000",
  numGuests: 2,
  checkIn: "2026-07-08",
  checkOut: "2026-07-09",
  numNights: 1,
  ratePerNight: 1500,
  totalPrice: 1500,
  originalTotalPrice: null,
  discountType: "",
  discountPct: 0,
  discountIdPhotoUrl: null,
  discountVerified: false,
  discountVerifiedBy: null,
  discountRejected: false,
  discountRejectedBy: null,
  discountRejectionReason: "",
  voucherCode: "",
  voucherDiscount: 0,
  isCorporate: false,
  corporateCode: "",
  companyName: "",
  specialRequests: "",
  status: "checked-in",
  paymentMethod: "pay-at-hotel",
  paymentProofUrl: null,
  lookupToken: "lookup-token",
  source: "online",
  notes: "",
  memberId: null,
  pointsRedeemed: 0,
  pointsRedeemedValue: 0,
  pointsRedeemedBy: null,
  pointsRedeemedAt: null,
  hasBreakfast: false,
  breakfastRate: 0,
  reminderSentAt: null,
  guestIdPhotoUrl: null,
  handledBy: "",
  cancellationReason: "",
  createdAt: "2026-07-08T00:00:00.000Z",
  ...overrides
});

describe("Dashboard overdue check-outs", () => {
  it("surfaces checked-in bookings before today, plus today's departures after checkout time", () => {
    const todayKey = "2026-07-10";
    const overdue = booking({ id: "overdue", checkOut: "2026-07-09", status: "checked-in" });
    const todayDeparture = booking({ id: "today", checkOut: todayKey, status: "checked-in" });
    const futureDeparture = booking({ id: "future", checkOut: "2026-07-11", status: "checked-in" });
    const alreadyCheckedOut = booking({ id: "done", checkOut: "2026-07-08", status: "checked-out" });

    expect(selectOverdueCheckouts([overdue, todayDeparture, futureDeparture, alreadyCheckedOut], todayKey, parseTimeToMinutes("11:59"), "12:00"))
      .toEqual([overdue]);

    expect(selectOverdueCheckouts([overdue, todayDeparture, futureDeparture, alreadyCheckedOut], todayKey, parseTimeToMinutes("12:00"), "12:00"))
      .toEqual([overdue, todayDeparture]);
  });

  it("counts overdue days from YYYY-MM-DD keys", () => {
    expect(getDaysOverdue("2026-07-09", "2026-07-10")).toBe(1);
    expect(getDaysOverdue("2026-07-01", "2026-07-10")).toBe(9);
    expect(getDaysOverdue("2026-07-10", "2026-07-10")).toBe(0);
  });

  it("parses both 24-hour and 12-hour checkout time formats", () => {
    expect(parseTimeToMinutes("12:00")).toBe(720);
    expect(parseTimeToMinutes("12:00 PM")).toBe(720);
    expect(parseTimeToMinutes("2:30 PM")).toBe(870);
    expect(parseTimeToMinutes("12:15 AM")).toBe(15);
  });
});
