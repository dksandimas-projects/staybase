import { beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../[...route]";
import { resend } from "../lib/resend";

let mockBookings: any[] = [];

vi.mock("../lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ id: "mock_email_id" })
    }
  }
}));

vi.mock("../lib/firebase-admin", () => {
  const mockCollection = () => ({
    where: function () {
      return this;
    },
    get: async () => ({
      docs: mockBookings.map((booking) => ({
        id: booking.id,
        data: () => booking
      }))
    })
  });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation(mockCollection)
    },
    adminAuth: {
      verifyIdToken: vi.fn()
    }
  };
});

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (customHeaders = {}) => ({
  method: "GET",
  body: undefined,
  url: "/api/email/checkin-reminder",
  headers: {
    host: "localhost",
    ...customHeaders
  },
  socket: {
    remoteAddress: "127.0.0.1"
  }
} as any);

describe("/api/email/checkin-reminder cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    mockBookings = [{
      id: "booking_tomorrow",
      bookingRef: "SI-20260616-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      roomNumber: "101",
      roomName: "Standard Double",
      checkIn: new Date("2026-06-16T00:00:00.000Z"),
      checkOut: new Date("2026-06-17T00:00:00.000Z"),
      numNights: 1,
      totalPrice: 2500
    }];
    vi.clearAllMocks();
  });

  test("accepts Vercel Cron bearer auth and sends reminders for tomorrow's confirmed bookings", async () => {
    const req = mockRequest({ authorization: "Bearer test-cron-secret" });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { sent: 1 } });
    expect(resend.emails.send).toHaveBeenCalledTimes(1);
    expect(resend.emails.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "maria@example.test"
    }));
  });
});
