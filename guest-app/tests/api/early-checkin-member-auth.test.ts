import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockSend } = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockSend: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((id: string) => ({
        get: vi.fn().mockResolvedValue(
          collectionName === "bookings" && mockBookings[id]
            ? { exists: true, id, data: () => mockBookings[id] }
            : { exists: false }
        ),
        update: vi.fn().mockResolvedValue(undefined)
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
    }))
  }
}));

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: mockSend
    }
  }
}));

import { handleEmailTrigger } from "../../server/handlers/email";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const booking = {
  bookingRef: "SI-20990101-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  memberId: "member_123",
  roomNumber: "101",
  roomName: "Standard Room",
  status: "confirmed",
  checkIn: new Date("2099-01-10T00:00:00.000Z"),
  checkOut: new Date("2099-01-12T00:00:00.000Z"),
  numNights: 2,
  totalPrice: 5000
};

describe("/api/email/early-checkin-request member auth", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((key) => delete mockBookings[key]);
    mockSend.mockReset();
    mockSend.mockResolvedValue({ id: "email_123" });
  });

  test("accepts a verified member whose uid matches the booking memberId", async () => {
    mockBookings.booking_1 = booking;
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_123", email: "other@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("rejects a member token that does not own the booking", async () => {
    mockBookings.booking_1 = booking;
    const res = mockResponse();

    await handleEmailTrigger(
      {
        method: "POST",
        body: { bookingId: "booking_1" },
        user: { uid: "member_999", email: "intruder@example.test" }
      } as any,
      res,
      "early-checkin-request"
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
