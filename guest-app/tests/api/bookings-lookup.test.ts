import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, handleLookupBooking } = vi.hoisted(() => {
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    handleLookupBooking: vi.fn()
  };
});

// We import the real handler, but mock the firebase-admin module + verify behavior
vi.mock("../../server/lib/firebase-admin", () => {
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
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      }
    };
  };

  const collection = (collName: string): any => {
    let queryFilters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      _coll: collName,
      _filters: queryFilters,
      where: function (field: string, op: string, value: any) {
        queryFilters.push({ field, op, value });
        return this;
      },
      limit: function () { return this; },
      doc: function (docId: string) {
        return docRef(`${collName}/${docId}`);
      },
      get: async function () {
        if (collName !== "bookings") return { empty: true, docs: [] };
        const docs = Object.entries(mockBookings)
          .filter(([, data]) =>
            queryFilters.every((f) => {
              const v = (data as any)[f.field];
              if (f.op === "==") return v === f.value;
              if (f.op === "!=") return v !== f.value;
              return true;
            })
          )
          .map(([id, data]) => ({ id, data: () => data, ref: docRef(`bookings/${id}`) }));
        return { empty: docs.length === 0, docs };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation(collection)
    },
    adminAuth: {}
  };
});

// Mock the email handler so the route file imports don't blow up if anything references it
vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

import { handleLookupBooking as realHandleLookupBooking } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseBooking = {
  id: "booking_1",
  bookingRef: "SI-20260615-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  guestPhone: "+63 917 000 0000",
  roomId: "room_101",
  roomNumber: "101",
  roomType: "standard-double",
  checkIn: { toDate: () => new Date("2026-06-16T00:00:00.000Z") },
  checkOut: { toDate: () => new Date("2026-06-18T00:00:00.000Z") },
  numNights: 2,
  numGuests: 2,
  ratePerNight: 2500,
  totalPrice: 5000,
  paymentMethod: "gcash",
  status: "pending",
  hasBreakfast: false,
  specialRequests: "Late check-in please"
};

describe("/api/bookings/lookup", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    mockRooms["room_101"] = { name: "Standard Double", type: "standard-double" };
    vi.clearAllMocks();
  });

  test("returns enriched booking + room data on a matching ref + email", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.data).toMatchObject({
      id: "booking_1",
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      roomId: "room_101",
      roomNumber: "101",
      roomName: "Standard Double",
      roomType: "standard-double",
      numNights: 2,
      numGuests: 2,
      ratePerNight: 2500,
      totalPrice: 5000,
      paymentMethod: "gcash",
      status: "pending",
      hasBreakfast: false,
      specialRequests: "Late check-in please"
    });
  });

  test("returns 404 when no booking matches the ref + email pair", async () => {
    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260101-999", guestEmail: "noone@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Booking not found."
    });
  });

  test("does not leak a booking when only the email matches a different ref", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260101-999", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("does not leak a booking when only the ref matches a different email", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "intruder@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("email match is case-insensitive (trim + lowercase)", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "  SI-20260615-001  ", guestEmail: "  MARIA@EXAMPLE.TEST  " }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("returns 400 when bookingRef or guestEmail is missing", async () => {
    const res1 = mockResponse();
    await realHandleLookupBooking({ method: "POST", body: { bookingRef: "SI-1" } }, res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = mockResponse();
    await realHandleLookupBooking({ method: "POST", body: { guestEmail: "a@b.com" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  test("falls back to roomType when the room doc cannot be enriched", async () => {
    mockBookings["booking_1"] = {
      ...baseBooking,
      roomId: "missing_room",
      roomName: undefined
    };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.data.roomName).toBe("standard-double");
  });

  // Per BF-21 (booking-flow audit 2026-06-26): malformed
  // input must short-circuit with 400 before hitting
  // Firestore.
  describe("input validation (BF-21)", () => {
    test("returns 400 on a malformed booking reference (wrong date format)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-26-15-001", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed booking reference (non-numeric sequence)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-XXX", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed email (no @ sign)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", guestEmail: "notanemail" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on an oversized body (100KB string)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "A".repeat(100_000), guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 (not 404) so callers can distinguish bad input from no match", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "garbage", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
