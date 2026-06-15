import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, mockSettings, mockCounters, mockWrites, sendBookingTrigger } = vi.hoisted(() => {
  const mockWrites: Array<{ type: string; path: string; data: any }> = [];
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    mockSettings: {} as Record<string, any>,
    mockCounters: {} as Record<string, any>,
    mockWrites,
    sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("../handlers/email", () => ({
  sendBookingTrigger,
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    return {
      path,
      id: docId,
      get: async () => {
        let store: Record<string, any> = {};
        if (coll === "bookings") store = mockBookings;
        else if (coll === "rooms") store = mockRooms;
        else if (coll === "settings") store = mockSettings;
        else if (coll === "counters") store = mockCounters;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      },
      update: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        }
        mockWrites.push({ type: "update", path, data });
      },
      set: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        }
        mockWrites.push({ type: "set", path, data });
      }
    };
  };

  const collectionChain = (collName: string): any => {
    const chain: any = {
      _coll: collName,
      doc: (docId?: string) => docRef(`${collName}/${docId || "auto_id"}`),
      where: function () { return this; },
      limit: function () { return this; },
      get: async function () {
        if (collName === "bookings") {
          const docs = Object.entries(mockBookings).map(([id, data]) => ({
            id,
            data: () => data
          }));
          return { empty: docs.length === 0, docs };
        }
        return { empty: true, docs: [] };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => collectionChain(collName)),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref && typeof ref.get === "function") return ref.get();
            if (ref && ref._coll) return ref.get();
            return { exists: false };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) {
                mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
              }
            }
            mockWrites.push({ type: "set", path: ref.path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) {
                mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
              }
            }
            mockWrites.push({ type: "update", path: ref.path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import { handleConfirmBooking, handleCreateWalkin } from "../handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("/api/bookings/confirm", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockCounters).forEach((k) => delete mockCounters[k]);
    mockWrites.length = 0;
    sendBookingTrigger.mockClear();
  });

  test("confirms a pending booking, flips status, and fires booking-confirmed email", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      status: "pending",
      totalPrice: 5000
    };

    const res = mockResponse();
    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1" }
      },
      res
    );

    expect(mockWrites).toContainEqual({
      type: "update",
      path: "bookings/booking_1",
      data: expect.objectContaining({
        status: "confirmed",
        confirmedBy: "frontdesk@sparkinn.com"
      })
    });
    expect(sendBookingTrigger).toHaveBeenCalledTimes(1);
    expect(sendBookingTrigger).toHaveBeenCalledWith(
      "booking-confirmed",
      expect.objectContaining({ guestEmail: "maria@example.test" })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { status: "confirmed" }
    });
  });

  test("confirms a payment-uploaded booking", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-002",
      guestName: "Juan Dela Cruz",
      guestEmail: "juan@example.test",
      status: "payment-uploaded",
      totalPrice: 4500
    };

    const res = mockResponse();
    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "staff@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1" }
      },
      res
    );

    expect(sendBookingTrigger).toHaveBeenCalledWith("booking-confirmed", expect.anything());
    expect(mockWrites.find((w) => w.path === "bookings/booking_1" && (w.data as any).status === "confirmed")).toBeDefined();
  });

  test("rejects confirmation of a checked-in booking", async () => {
    mockBookings["booking_1"] = { status: "checked-in" };
    const res = mockResponse();

    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "staff@sparkinn.com" },
        body: { bookingId: "booking_1" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });

  test("rejects confirmation of a cancelled booking", async () => {
    mockBookings["booking_1"] = { status: "cancelled" };
    const res = mockResponse();

    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "staff@sparkinn.com" },
        body: { bookingId: "booking_1" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });

  test("returns 404 when booking does not exist", async () => {
    const res = mockResponse();

    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "staff@sparkinn.com" },
        body: { bookingId: "missing" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });

  test("rejects missing bookingId", async () => {
    const res = mockResponse();

    await handleConfirmBooking(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "staff@sparkinn.com" },
        body: {}
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("walk-in booking creation booking-confirmed trigger", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockCounters).forEach((k) => delete mockCounters[k]);
    mockWrites.length = 0;
    sendBookingTrigger.mockClear();

    mockRooms["room_101"] = {
      isActive: true,
      status: "available",
      maxCapacity: 4,
      pricePerNight: 2000,
      weekendRate: 2500,
      name: "Room 101 — Standard Double",
      roomNumber: "101"
    };
    mockSettings["breakfastConfig"] = {
      isEnabled: false,
      ratePerPersonPerNight: 0
    };
  });

  const baseWalkinBody = {
    bookingId: "walkin_1",
    roomId: "room_101",
    checkIn: "2026-06-16",
    checkOut: "2026-06-18",
    guests: 2,
    hasBreakfast: false,
    guestDetails: {
      firstName: "Maria",
      lastName: "Santos",
      email: "maria@example.test",
      phone: "09171234567",
      consent: true
    },
    paymentMethod: "pay-at-hotel"
  };

  test("fires booking-confirmed when walk-in status is confirmed", async () => {
    const res = mockResponse();

    await handleCreateWalkin(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com" },
        body: { ...baseWalkinBody, status: "confirmed" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendBookingTrigger).toHaveBeenCalledTimes(1);
    expect(sendBookingTrigger).toHaveBeenCalledWith(
      "booking-confirmed",
      expect.objectContaining({ guestEmail: "maria@example.test" })
    );
  });

  test("fires booking-confirmed when status is omitted (default confirmed)", async () => {
    const res = mockResponse();

    await handleCreateWalkin(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com" },
        body: { ...baseWalkinBody }
      },
      res
    );

    expect(sendBookingTrigger).toHaveBeenCalledWith("booking-confirmed", expect.anything());
  });

  test("does not fire booking-confirmed when walk-in status is checked-in", async () => {
    const res = mockResponse();

    await handleCreateWalkin(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com" },
        body: { ...baseWalkinBody, status: "checked-in" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });
});
