import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockWrites, sendEarlyCheckinResolveTrigger } = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockWrites: [] as Array<{ path: string; data: any }>,
  sendEarlyCheckinResolveTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn(),
  sendBookingConfirmedWithBalanceTrigger: vi.fn(),
  sendStaffNewBookingTrigger: vi.fn(),
  sendStaffNewPaymentTrigger: vi.fn(),
  sendEarlyCheckinResolveTrigger
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => ({
    path,
    id: path.split("/")[1] || "",
    get: async () => {
      const id = path.split("/")[1] || "";
      const data = mockBookings[id];
      return data ? { exists: true, id, data: () => data } : { exists: false };
    }
  });
  return {
    adminDb: {
      collection: vi.fn().mockImplementation((name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) })),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => callback({
        get: vi.fn().mockImplementation((ref: any) => ref.get()),
        update: vi.fn().mockImplementation((ref: any, data: any) => {
          Object.assign(mockBookings[ref.id], data);
          mockWrites.push({ path: ref.path, data });
        })
      }))
    },
    adminAuth: {}
  };
});

import { handleResolveEarlyCheckin } from "../../server/handlers/bookings";

function response() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const booking = (overrides: Record<string, any> = {}) => ({
  bookingRef: "SI-20990101-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  status: "confirmed",
  checkIn: "2099-01-02",
  ...overrides
});

const request = (role: "admin" | "front-desk", body: Record<string, any>) => ({
  method: "POST",
  body,
  staff: { uid: "staff_1", email: `${role}@example.test`, role }
});

describe("admin-granted early check-in", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((key) => delete mockBookings[key]);
    mockWrites.length = 0;
    sendEarlyCheckinResolveTrigger.mockClear();
  });

  test("an admin can grant early check-in to an eligible booking", async () => {
    mockBookings.booking_1 = booking();
    const res = response();

    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1",
      status: "approved",
      grantIfMissing: true,
      confirmedTime: "10:00 AM",
      staffNote: "Please check in at reception."
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings.booking_1.earlyCheckIn).toMatchObject({
      source: "staff-granted",
      status: "approved",
      requestedTime: "10:00 AM",
      confirmedTime: "10:00 AM",
      resolvedBy: "admin@example.test"
    });
    expect(sendEarlyCheckinResolveTrigger).toHaveBeenCalledTimes(1);
  });

  test("front desk cannot create a grant", async () => {
    mockBookings.booking_1 = booking();
    const res = response();
    await handleResolveEarlyCheckin(request("front-desk", {
      bookingId: "booking_1", status: "approved", grantIfMissing: true, confirmedTime: "10:00 AM"
    }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockWrites).toHaveLength(0);
  });

  test("a grant requires a selected time", async () => {
    mockBookings.booking_1 = booking();
    const res = response();
    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1", status: "approved", grantIfMissing: true
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockWrites).toHaveLength(0);
  });

  test("grant mode rejects a declined status", async () => {
    mockBookings.booking_1 = booking();
    const res = response();
    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1", status: "declined", grantIfMissing: true, confirmedTime: "10:00 AM"
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockWrites).toHaveLength(0);
  });

  test("a grant cannot overwrite an existing guest request", async () => {
    mockBookings.booking_1 = booking({ earlyCheckIn: { source: "guest-request", status: "requested" } });
    const res = response();
    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1", status: "approved", grantIfMissing: true, confirmedTime: "10:00 AM"
    }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockBookings.booking_1.earlyCheckIn.status).toBe("requested");
  });

  test("only paid or confirmed bookings are eligible", async () => {
    mockBookings.booking_1 = booking({ status: "payment-uploaded" });
    const res = response();
    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1", status: "approved", grantIfMissing: true, confirmedTime: "10:00 AM"
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockWrites).toHaveLength(0);
  });

  test("an identical retry is idempotent and does not resend email", async () => {
    mockBookings.booking_1 = booking({
      earlyCheckIn: {
        source: "staff-granted", status: "approved", confirmedTime: "10:00 AM", staffNote: "Welcome early."
      }
    });
    const res = response();
    await handleResolveEarlyCheckin(request("admin", {
      bookingId: "booking_1", status: "approved", grantIfMissing: true, confirmedTime: "10:00 AM", staffNote: "Welcome early."
    }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockWrites).toHaveLength(0);
    expect(sendEarlyCheckinResolveTrigger).not.toHaveBeenCalled();
  });

  test("front desk cannot change an admin-granted record", async () => {
    mockBookings.booking_1 = booking({
      earlyCheckIn: { source: "staff-granted", status: "approved", requestedTime: "10:00 AM" }
    });
    const res = response();
    await handleResolveEarlyCheckin(request("front-desk", {
      bookingId: "booking_1", status: "declined", staffNote: "Changed"
    }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockWrites).toHaveLength(0);
  });
});
