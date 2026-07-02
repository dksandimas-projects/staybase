import { beforeEach, describe, expect, test, vi } from "vitest";

// Per BF-02 (booking-flow audit 2026-06-26): the walkin handler
// was reading `roomData.{maxCapacity, pricePerNight, weekendRate}`
// to enforce capacity and compute pricing. Per W3.6 + W3.7, those
// fields moved off individual room documents and now live on the
// room type entry in `settings/hotelConfig.roomTypes[]`. After the
// migration backfill, the room-doc fields are absent → walkins
// could be priced at ₱0 and bypass the capacity check. The fix
// reads the three fields from the type entry. These tests pin the
// new behavior and the regression case where the dead room-doc
// fields are out of sync with the type entry.

let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockBookings: any[] = [];
let setCalls: any[] = [];
let updateCalls: any[] = [];
let transactionGetLog: string[] = [];

vi.mock("../../server/lib/resend", () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ id: "mock_email_id" }) } }
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      id: docId,
      path,
      firestore: { valueType: true },
      get: async () => {
        if (coll === "rooms" && mockRooms[docId]) {
          return { exists: true, id: docId, data: () => mockRooms[docId] };
        }
        if (coll === "settings" && mockSettings[docId]) {
          return { exists: true, id: docId, data: () => mockSettings[docId] };
        }
        if (coll === "counters" && mockBookings.find((b) => b.id === docId)) {
          const found = mockBookings.find((b) => b.id === docId);
          return { exists: true, id: docId, data: () => found };
        }
        if (coll === "bookings") {
          const found = mockBookings.find((b) => b.id === docId);
          if (found) return { exists: true, id: docId, data: () => found };
        }
        return { exists: false };
      },
      collection: (sub: string) => ({
        add: async (data: any) => {
          setCalls.push({ path: `${path}/${sub}`, data });
          return { id: "mock_sub_id" };
        }
      })
    };
  };

  const buildQuery = (collName: string, filters: Array<{ field: string; op: string; value: any }> = []) => {
    const q: any = {
      isQuery: true,
      collectionName: collName,
      filters: filters.slice(),
      where: (field: string, op: string, value: any) =>
        buildQuery(collName, [...filters, { field, op, value }]),
      limit: () => q,
      doc: (docId: string) => createDocRef(`${collName}/${docId}`),
      get: async () => {
        let pool: any[] = [];
        if (collName === "bookings") {
          pool = mockBookings.map((b: any) => ({ id: b.id, ...b }));
        }
        let filtered = pool;
        for (const f of filters) {
          filtered = filtered.filter((doc: any) => {
            if (f.op === "==") return doc[f.field] === f.value;
            if (f.op === "!=") return doc[f.field] !== f.value;
            return true;
          });
        }
        return {
          empty: filtered.length === 0,
          docs: filtered.map((doc: any) => ({
            id: doc.id,
            data: () => doc,
            exists: true,
            ref: createDocRef(`${collName}/${doc.id}`)
          }))
        };
      }
    };
    return q;
  };

  const mockTransaction = {
    get: vi.fn().mockImplementation(async (ref: any) => {
      transactionGetLog.push(ref?.path ?? "(no path)");
      if (ref && ref.isQuery) return ref.get();
      if (!ref || typeof ref.path !== "string") return { exists: false };
      return ref.get();
    }),
    set: vi.fn().mockImplementation((ref: any, data: any) => {
      setCalls.push({ path: ref.path, data });
    }),
    update: vi.fn().mockImplementation((ref: any, data: any) => {
      updateCalls.push({ path: ref.path, data });
    })
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => buildQuery(collName)),
      doc: vi.fn().mockImplementation((path: string) => createDocRef(path)),
      runTransaction: vi.fn().mockImplementation(async (cb: any) => await cb(mockTransaction))
    },
    adminAuth: { verifyIdToken: vi.fn() }
  };
});

import handler from "../../server/apiRouter";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (body: any, method = "POST", url = "/api/bookings/create-walkin") => ({
  method,
  body,
  url,
  headers: { host: "localhost" },
  socket: { remoteAddress: "127.0.0.1" },
  staff: { uid: "staff_uid_1", email: "frontdesk@sparkinn.com", role: "front-desk" }
} as any);

const seedFixtures = () => {
  mockRooms = {
    room_101: {
      isActive: true,
      status: "available",
      type: "standard-double",
      // Per BF-02: the room-doc fields below are inert post-migration.
      // The handler must read from the type entry. The test deliberately
      // sets them out of sync so the test can prove the type entry is
      // the source of truth.
      maxCapacity: 2,
      pricePerNight: 100,
      weekendRate: 150,
      name: "Room 101 — Standard Double",
      roomNumber: "101"
    }
  };
  mockSettings = {
    breakfastConfig: {
      isEnabled: false,
      ratePerPersonPerNight: 0
    },
    hotelConfig: {
      roomTypes: [
        {
          value: "standard-double",
          label: "Standard Double",
          shortLabel: "Std Double",
          imageUrls: [],
          bedDefinition: "1 double bed",
          description: "Simple comfort.",
          amenities: ["WiFi", "AC"],
          maxCapacity: 4,
          pricePerNight: 2000,
          weekendRate: 2500,
          corporateRate: 1800
        }
      ]
    }
  };
  mockBookings = [];
  setCalls = [];
  updateCalls = [];
  transactionGetLog = [];
};

describe("BF-02 — handleCreateWalkin reads pricing + max capacity from the room type entry", () => {
  beforeEach(() => {
    seedFixtures();
    vi.clearAllMocks();
  });

  test("enforces capacity against the type entry, not the dead room-doc field", async () => {
    // Guest count 3 — would fail against roomData.maxCapacity=2,
    // passes against typeEntry.maxCapacity=4. The fix means the
    // booking is created (not rejected).
    const body = {
      bookingId: "walkin_bf02_a",
      roomId: "room_101",
      checkIn: "2026-08-04", // Tue
      checkOut: "2026-08-06", // Thu (no weekend nights)
      guests: 3,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.success).toBe(true);
    expect(jsonArg.data.bookingRef).toMatch(/^SI-\d{8}-\d{5}$/);
  });

  test("computes ratePerNight from the type entry's pricePerNight (not the dead room-doc field)", async () => {
    const body = {
      bookingId: "walkin_bf02_b",
      roomId: "room_101",
      checkIn: "2026-08-04",
      checkOut: "2026-08-06",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const bookingWrite = setCalls.find((c) => c.path === "bookings/walkin_bf02_b");
    // 2 nights @ ₱2000 (type entry) = ₱4000.
    // Pre-fix, this would have been 2 nights @ ₱100 (dead room-doc
    // field) = ₱200.
    expect(bookingWrite.data.ratePerNight).toBe(2000);
    expect(bookingWrite.data.totalPrice).toBe(4000);
  });

  test("uses the type entry's weekendRate for Sat/Sun nights", async () => {
    // 2026-08-08 (Sat) → 2026-08-10 (Mon): 2 nights, both weekend.
    // typeWeekendRate = 2500, typeBaseRate = 2000.
    // Expected total: 2500 * 2 = 5000.
    const body = {
      bookingId: "walkin_bf02_c",
      roomId: "room_101",
      checkIn: "2026-08-08",
      checkOut: "2026-08-10",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const bookingWrite = setCalls.find((c) => c.path === "bookings/walkin_bf02_c");
    expect(bookingWrite.data.totalPrice).toBe(5000);
  });

  test("rejects when guest count exceeds the type entry's maxCapacity", async () => {
    // 5 guests — type's maxCapacity is 4. Should reject.
    const body = {
      bookingId: "walkin_bf02_d",
      roomId: "room_101",
      checkIn: "2026-08-04",
      checkOut: "2026-08-06",
      guests: 5,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.error).toBe("Guest count exceeds room capacity of 4.");
    expect(setCalls.find((c) => c.path === "bookings/walkin_bf02_d")).toBeUndefined();
  });

  test("transaction reads settings/hotelConfig inside the transaction body", async () => {
    const body = {
      bookingId: "walkin_bf02_e",
      roomId: "room_101",
      checkIn: "2026-08-04",
      checkOut: "2026-08-06",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(transactionGetLog).toContain("settings/hotelConfig");
    expect(transactionGetLog).toContain("rooms/room_101");
  });

  test("rejects when the room's type is not in the hotelConfig.roomTypes[] catalog", async () => {
    mockRooms["room_101"].type = "defunct-room-type";

    const body = {
      bookingId: "walkin_bf02_f",
      roomId: "room_101",
      checkIn: "2026-08-04",
      checkOut: "2026-08-06",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Walkin",
        lastName: "Guest",
        email: "walkin@example.test",
        phone: "09171234567",
        consent: true
      },
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.error).toBe("Room type is not available.");
    expect(setCalls.find((c) => c.path === "bookings/walkin_bf02_f")).toBeUndefined();
  });
});
