// Per RAR-01 (2026-11-19, decision #323): tests for the
// pre-assigned room OVERRIDE endpoint.
//
// The flow the front desk actually performs:
//   1. A booking was created and the server AUTO-ASSIGNED it a
//      room (the room the guest is booked into).
//   2. Staff verify the guest's payment.
//   3. The post-verify success modal shows the pre-assigned room
//      NUMBER and lets staff re-point it at another room of the
//      SAME CATEGORY when the assignment is wrong.
//
// The rules this suite pins:
//   - the room identity changes; the DATES and the MONEY do not
//   - a different room CATEGORY is refused (that is the
//     "Move / upgrade room" action, which re-prices deliberately)
//   - the target room must be available for the stay window
//   - the change is auditable (`rescheduleHistory[]`, `kind: "room"`)
//   - no guest email fires (the room number is never sent to a
//     guest, and the type + dates do not change)
//
// The most important assertion in this file is the LAST one in the
// happy path: the write payload must NOT contain a single money
// field. "The price stays the same" has to be a structural
// property of the write, not a promise — a future edit that adds
// `totalPrice` to this update would silently re-price every
// override.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, mockSettings, mockWrites, sendBookingTrigger } = vi.hoisted(() => {
  const mockWrites: Array<{ type: string; path: string; data: any }> = [];
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    mockSettings: {} as Record<string, any>,
    mockWrites,
    sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger,
  sendBookingConfirmedWithBalanceTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/lib/notifications", () => ({
  writeNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/lib/firebase-admin", () => {
  // The mock supports:
  //   - `collection(name).doc(id).get()` → a single doc
  //   - `collection(name).where(f, op, v).where(...)` → a filtered
  //     query snapshot (the occupancy check needs this)
  //   - `transaction.get(ref)` / `transaction.update(ref, data)`
  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    const storeFor = (name: string) => {
      if (name === "bookings") return mockBookings;
      if (name === "rooms") return mockRooms;
      if (name === "settings") return mockSettings;
      return {};
    };
    return {
      path,
      id: docId,
      get: async () => {
        const data = storeFor(coll)[docId];
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
        mockWrites.push({ type: "set", path, data });
      }
    };
  };

  const collectionChain = (collName: string): any => {
    const filters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      _coll: collName,
      doc: (docId?: string) => docRef(`${collName}/${docId || "auto_id"}`),
      where: function (field: string, op: string, value: any) {
        filters.push({ field, op, value });
        return this;
      },
      limit: function () { return this; },
      get: async function () {
        let store: Record<string, any> = {};
        if (collName === "bookings") store = mockBookings;
        else if (collName === "rooms") store = mockRooms;
        else if (collName === "settings") store = mockSettings;
        let docs = Object.entries(store).map(([id, data]) => ({ id, data: () => data }));
        for (const filter of filters) {
          if (filter.op === "==") {
            docs = docs.filter((d) => d.data()[filter.field] === filter.value);
          } else if (filter.op === "in") {
            docs = docs.filter((d) => filter.value.includes(d.data()[filter.field]));
          }
          // `array-contains` is not modelled — the staff-hold
          // collection is empty in this suite, so the filtered
          // result is empty either way.
        }
        return {
          empty: docs.length === 0,
          docs,
          forEach: (cb: any) => docs.forEach((d) => cb(d))
        };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => collectionChain(collName)),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        // The callback's return value MUST be forwarded — the
        // handler returns the new room identity from inside the
        // transaction callback.
        return await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref && typeof ref.get === "function") return ref.get();
            return { exists: false };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
            }
            mockWrites.push({ type: "set", path: ref.path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
            }
            mockWrites.push({ type: "update", path: ref.path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import { handleAssignBookingRoom } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staff = { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" };

const baseBooking = (overrides: any = {}) => ({
  bookingRef: "SI-20261119-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  status: "payment-confirmed",
  roomId: "room_a",
  roomNumber: "12",
  roomType: "superior",
  checkIn: "2026-11-20",
  checkOut: "2026-11-22",
  numNights: 2,
  totalPrice: 5000,
  ratePerNight: 2500,
  rateBreakdown: { roomLines: [{ nightlyRate: 2500, nights: 2, subtotal: 5000 }] },
  originalTotalPrice: 5000,
  voucherDiscount: 0,
  ...overrides
});

const targetRoom = (overrides: any = {}) => ({
  roomNumber: "14",
  type: "superior",
  isActive: true,
  status: "available",
  ...overrides
});

describe("/api/bookings/assign-room", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    mockWrites.length = 0;
    sendBookingTrigger.mockClear();
    mockSettings["hotelConfig"] = { checkOutTime: "11:00" };
  });

  test("re-points the booking at another room of the same category", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b", reason: "Room 12 needs cleaning" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.roomId).toBe("room_b");
    expect(payload.data.roomNumber).toBe("14");
    expect(payload.data.roomType).toBe("superior");
    expect(payload.data.totalPrice).toBe(5000);

    // The booking now points at the new room.
    expect(mockBookings["booking_1"].roomId).toBe("room_b");
    expect(mockBookings["booking_1"].roomNumber).toBe("14");
  });

  test("the write carries NO money field — the price cannot move", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b", reason: "Wrong room" } },
      res
    );

    const bookingWrite = mockWrites.find((w) => w.path === "bookings/booking_1");
    expect(bookingWrite).toBeDefined();
    const keys = Object.keys(bookingWrite!.data);
    for (const forbidden of [
      "totalPrice",
      "ratePerNight",
      "rateBreakdown",
      "originalTotalPrice",
      "voucherDiscount",
      "revenueAllocation",
      "checkIn",
      "checkOut",
      "numNights",
      "breakfastSelections",
      "breakfastTotal",
      "otherAddOnSelections",
      "otherAddOnTotal",
      "discountType",
      "discountPct",
      "voucherCode"
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    // The money on the booking is untouched.
    expect(mockBookings["booking_1"].totalPrice).toBe(5000);
    expect(mockBookings["booking_1"].ratePerNight).toBe(2500);
    expect(mockBookings["booking_1"].checkIn).toBe("2026-11-20");
    expect(mockBookings["booking_1"].checkOut).toBe("2026-11-22");
  });

  test("records an auditable rescheduleHistory entry", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b", reason: "Room 12 needs cleaning" } },
      res
    );

    const history = mockBookings["booking_1"].rescheduleHistory;
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(1);
    const entry = history[0];
    expect(entry.kind).toBe("room");
    expect(entry.pricingBasis).toBe("preserved");
    expect(entry.deltaTotalPrice).toBe(0);
    expect(entry.fromRoomId).toBe("room_a");
    expect(entry.fromRoomNumber).toBe("12");
    expect(entry.toRoomId).toBe("room_b");
    expect(entry.toRoomNumber).toBe("14");
    expect(entry.reason).toBe("Room 12 needs cleaning");
    expect(entry.by).toBe("staff_1");
  });

  test("preserves an existing rescheduleHistory", async () => {
    mockBookings["booking_1"] = baseBooking({
      rescheduleHistory: [{ kind: "extend", toRoomId: "room_a" }]
    });
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(mockBookings["booking_1"].rescheduleHistory).toHaveLength(2);
    expect(mockBookings["booking_1"].rescheduleHistory[0].kind).toBe("extend");
    expect(mockBookings["booking_1"].rescheduleHistory[1].kind).toBe("room");
  });

  test("refuses a different room category — that is the Move / upgrade action", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom({ type: "deluxe" });

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/category cannot be changed/i);
    // Nothing was written.
    expect(mockBookings["booking_1"].roomId).toBe("room_a");
    expect(mockWrites.filter((w) => w.path === "bookings/booking_1")).toHaveLength(0);
  });

  test("refuses a room that already has a booking in the stay window", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockBookings["booking_2"] = baseBooking({
      bookingRef: "SI-20261119-002",
      roomId: "room_b",
      roomNumber: "14",
      status: "confirmed",
      guestName: "Other Guest"
    });
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/already has a booking/i);
    expect(mockBookings["booking_1"].roomId).toBe("room_a");
  });

  test("a booking does not conflict with itself when it holds the target room", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_a"] = targetRoom({ roomNumber: "12" });
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_a" } },
      res
    );

    // Same room → a no-op, not an error.
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.unchanged).toBe(true);
    expect(payload.data.roomNumber).toBe("12");
  });

  test("refuses a missing booking", async () => {
    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "nope", roomId: "room_b" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/not found/i);
  });

  test("refuses a booking whose status is not re-assignable", async () => {
    mockBookings["booking_1"] = baseBooking({ status: "cancelled" });
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/cannot be reassigned/i);
    expect(mockBookings["booking_1"].roomId).toBe("room_a");
  });

  test("refuses an inactive target room", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom({ isActive: false });

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/inactive/i);
  });

  test("requires a booking id and a room id", async () => {
    const res = mockResponse();
    await handleAssignBookingRoom({ method: "POST", staff, body: { bookingId: "booking_1" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test("rejects a non-POST method", async () => {
    const res = mockResponse();
    await handleAssignBookingRoom({ method: "GET", staff, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("fires NO guest email — the room number is never sent to a guest", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockRooms["room_b"] = targetRoom();

    const res = mockResponse();
    await handleAssignBookingRoom(
      { method: "POST", staff, body: { bookingId: "booking_1", roomId: "room_b" } },
      res
    );

    expect(sendBookingTrigger).not.toHaveBeenCalled();
  });
});
