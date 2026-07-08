import { beforeEach, describe, expect, test, vi } from "vitest";

// Regression test for the PF-02 follow-up (Phase 12 Features Audit
// 2026-07-08): the admin approve form seeds its time dropdown from
// `earlyCheckIn.requestedTime` and sends "" when it cannot (legacy
// requests with no stored time, or free-text times submitted straight
// to the API). The resolve schema must treat "" as "no override" and
// fall back to requestedTime — not reject the whole approval with 400.

const { mockBookings, mockWrites, sendEarlyCheckinResolveTrigger } = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockWrites: [] as Array<{ path: string; data: any }>,
  sendEarlyCheckinResolveTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendStaffNewBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendStaffNewPaymentTrigger: vi.fn().mockResolvedValue(undefined),
  sendEarlyCheckinResolveTrigger
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => ({
    path,
    id: path.split("/")[1] || "",
    get: async () => {
      const docId = path.split("/")[1] || "";
      const data = path.startsWith("bookings/") ? mockBookings[docId] : undefined;
      return data ? { exists: true, id: docId, data: () => data } : { exists: false };
    }
  });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => ({
        doc: (docId: string) => docRef(`${collName}/${docId}`)
      })),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => ref.get()),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            const docId = ref.path.split("/").pop();
            if (ref.path.startsWith("bookings/") && docId && mockBookings[docId]) {
              Object.assign(mockBookings[docId], data);
            }
            mockWrites.push({ path: ref.path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import { handleResolveEarlyCheckin } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseBooking = () => ({
  bookingRef: "SI-20990101-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  status: "confirmed",
  earlyCheckIn: {
    status: "requested",
    requestedTime: "09:00 AM",
    notes: "Arriving on the early ferry.",
    requestedAt: "2099-01-01T00:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    staffNote: null
  }
});

const staffReq = (body: any) => ({
  method: "POST",
  body,
  staff: { uid: "staff_1", email: "frontdesk@example.test" }
});

describe("/api/bookings/early-checkin-resolve — confirmedTime handling", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    mockWrites.length = 0;
    sendEarlyCheckinResolveTrigger.mockClear();
  });

  test("approve with an empty-string confirmedTime succeeds and falls back to requestedTime", async () => {
    mockBookings["booking_1"] = baseBooking();
    const res = mockResponse();

    await handleResolveEarlyCheckin(
      staffReq({ bookingId: "booking_1", status: "approved", confirmedTime: "" }) as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].earlyCheckIn.status).toBe("approved");
    expect(mockBookings["booking_1"].earlyCheckIn.confirmedTime).toBe("09:00 AM");
    expect(sendEarlyCheckinResolveTrigger).toHaveBeenCalledTimes(1);
  });

  test("approve with a valid confirmedTime persists the staff-selected time", async () => {
    mockBookings["booking_1"] = baseBooking();
    const res = mockResponse();

    await handleResolveEarlyCheckin(
      staffReq({ bookingId: "booking_1", status: "approved", confirmedTime: "11:00 AM" }) as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].earlyCheckIn.confirmedTime).toBe("11:00 AM");
  });

  test("approve with a free-text confirmedTime is rejected with 400", async () => {
    mockBookings["booking_1"] = baseBooking();
    const res = mockResponse();

    await handleResolveEarlyCheckin(
      staffReq({ bookingId: "booking_1", status: "approved", confirmedTime: "around 10ish" }) as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockBookings["booking_1"].earlyCheckIn.status).toBe("requested");
    expect(sendEarlyCheckinResolveTrigger).not.toHaveBeenCalled();
  });

  test("decline stores a null confirmedTime regardless of what was sent", async () => {
    mockBookings["booking_1"] = baseBooking();
    const res = mockResponse();

    await handleResolveEarlyCheckin(
      staffReq({ bookingId: "booking_1", status: "declined", confirmedTime: "10:00 AM", staffNote: "Fully booked that morning." }) as any,
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].earlyCheckIn.status).toBe("declined");
    expect(mockBookings["booking_1"].earlyCheckIn.confirmedTime).toBeNull();
    expect(mockBookings["booking_1"].earlyCheckIn.staffNote).toBe("Fully booked that morning.");
  });
});
