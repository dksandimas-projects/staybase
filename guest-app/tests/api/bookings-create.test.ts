import { beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../../api/[...route]";

// Global mock state
let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockVouchers: Record<string, any> = {};
let mockCounters: Record<string, any> = {};
let mockBookings: any[] = [];

// Track calls
let setCalls: any[] = [];
let updateCalls: any[] = [];

// Mock Resend
vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ id: "mock_email_id" })
    }
  }
}));

// Mock Firebase Admin SDK
vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      path,
      firestore: {
        valueType: true
      },
      get: async () => {
        if (coll === "bookings") {
          const found = mockBookings.find(b => b.id === docId || b.bookingId === docId || b.bookingRef === docId);
          if (found) {
            return {
              exists: true,
              data: () => found
            };
          }
        }
        return { exists: false };
      },
      update: async (upd: any) => {
        if (coll === "bookings") {
          const found = mockBookings.find(b => b.id === docId || b.bookingId === docId || b.bookingRef === docId);
          if (found) {
            Object.assign(found, upd);
            updateCalls.push({ path, data: upd });
          }
        }
      },
      collection: (sub: string) => {
        const subPath = `${path}/${sub}`;
        return {
          path: subPath,
          // Per BF-14 (booking-flow audit 2026-06-26): the new
          // transactional handleAddPayment uses
          // `paymentsRef.doc()` to mint a new doc ref + write
          // inside the transaction. The post-write `get()` must
          // return the just-written payment so the reduce works.
          doc: (id?: string) => ({
            id: id || "mock_sub_id",
            path: `${subPath}/${id || "mock_sub_id"}`,
            set: async (data: any) => {
              setCalls.push({ path: `${subPath}/${id || "mock_sub_id"}`, data });
            }
          }),
          add: async (subData: any) => {
            setCalls.push({ path: subPath, data: subData });
            return { id: "mock_sub_id" };
          },
          // Return the subcollection docs as collected by the
          // test setup. The handler's `reduce` reads
          // `doc.data().amount`.
          get: async () => {
            const paymentDocs = setCalls
              .filter((c) => c.path.startsWith(`${subPath}/`))
              .map((c, i) => ({
                id: `payment_${i + 1}`,
                data: () => c.data
              }));
            return { docs: paymentDocs };
          }
        };
      }
    };
  };

  // Build a query object for a given collection with the supplied
  // where-filters. The mock transaction below honors the filters
  // when returning docs — needed for the new room-type booking
  // refactor where the transaction queries `rooms where type == X
  // and isActive == true` to pick a candidate.
  const buildQuery = (collName: string, filters: Array<{ field: string; op: string; value: any }> = []) => {
    const q: any = {
      isQuery: true,
      collectionName: collName,
      filters: filters.slice(),
      path: collName,
      where: (field: string, op: string, value: any) => buildQuery(collName, [...filters, { field, op, value }]),
      limit: () => q,
      doc: (docId: string) => createDocRef(`${collName}/${docId}`),
      get: async () => {
        let pool: any[] = [];
        if (collName === "rooms") {
          pool = Object.entries(mockRooms).map(([id, data]) => ({ id, ...data }));
        } else if (collName === "bookings") {
          pool = mockBookings.map((b: any) => ({ id: b.id || b.bookingId || b.bookingRef, ...b }));
        }
        let filtered = pool;
        for (const f of filters) {
          filtered = filtered.filter((doc: any) => {
            if (f.op === "==") return doc[f.field] === f.value;
            if (f.op === "!=") return doc[f.field] !== f.value;
            if (f.op === "in") return Array.isArray(f.value) && f.value.includes(doc[f.field]);
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

  const mockCollection = (collName: string) => buildQuery(collName);

  const mockTransaction = {
    get: vi.fn().mockImplementation(async (ref: any) => {
      if (ref && ref.isQuery) {
        return ref.get();
      }

      if (!ref || typeof ref.path !== "string") {
        return { exists: false };
      }

      // Per BF-14 (booking-flow audit 2026-06-26): a 3-segment
      // path like `bookings/{id}/payments` is a subcollection
      // reference; the per-collection logic below only handles
      // 2-segment doc paths. Fall through to `ref.get()` so
      // the subcollection's get() (which filters setCalls by
      // the subcollection path) is used.
      const path = ref.path;
      if (path.split("/").length === 3 && typeof ref.get === "function") {
        return ref.get();
      }

      const [coll, docId] = path.split("/");

      if (coll === "rooms") {
        if (mockRooms[docId]) {
          return {
            exists: true,
            data: () => mockRooms[docId]
          };
        }
        return { exists: false };
      }

      if (coll === "settings") {
        if (mockSettings[docId]) {
          return {
            exists: true,
            data: () => mockSettings[docId]
          };
        }
        return { exists: false };
      }

      if (coll === "vouchers") {
        if (mockVouchers[docId]) {
          return {
            exists: true,
            data: () => mockVouchers[docId]
          };
        }
        return { exists: false };
      }

      if (coll === "counters") {
        if (mockCounters[docId]) {
          return {
            exists: true,
            data: () => mockCounters[docId]
          };
        }
        return { exists: false };
      }

      if (coll === "bookings") {
        const found = mockBookings.find(b => b.id === docId || b.bookingId === docId || b.bookingRef === docId);
        if (found) {
          return {
            exists: true,
            data: () => found
          };
        }
        return { exists: false };
      }

      return { exists: false };
    }),
    set: vi.fn().mockImplementation((ref: any, data: any) => {
      setCalls.push({ path: ref.path, data });
    }),
    update: vi.fn().mockImplementation((ref: any, data: any) => {
      updateCalls.push({ path: ref.path, data });
    })
  };

  const mockAdminDb = {
    collection: vi.fn().mockImplementation((collName: string) => {
      return mockCollection(collName);
    }),
    doc: vi.fn().mockImplementation((path: string) => {
      return createDocRef(path);
    }),
    runTransaction: vi.fn().mockImplementation(async (callback: any) => {
      return await callback(mockTransaction);
    })
  };

  return {
    adminDb: mockAdminDb,
    adminAuth: {}
  };
});

// Helper to construct mock Request & Response
const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (body: any, method = "POST", url = "/api/bookings/create", customHeaders = {}) => {
  return {
    method,
    body,
    url,
    headers: {
      host: "localhost",
      ...customHeaders
    },
    socket: {
      remoteAddress: "127.0.0.1"
    }
  } as any;
};

describe("/api/bookings/create", () => {
  beforeEach(() => {
    // Reset state
    mockRooms = {
      "room_101": {
        isActive: true,
        status: "available",
        maxCapacity: 4,
        pricePerNight: 2000,
        weekendRate: 2500,
        type: "standard-double",
        name: "Room 101 — Standard Double",
        roomNumber: "101"
      },
      "room_102": {
        isActive: true,
        status: "available",
        maxCapacity: 4,
        pricePerNight: 2000,
        weekendRate: 2500,
        type: "standard-double",
        name: "Room 102 — Standard Double",
        roomNumber: "102"
      }
    };
    mockSettings = {
      "breakfastConfig": {
        isEnabled: true,
        ratePerPersonPerNight: 250
      },
      // Per the room-type booking refactor: the new
      // /api/bookings/create transaction reads the room type
      // entry from `settings/hotelConfig.roomTypes[]` and finds
      // candidate physical rooms of that type. The mock must
      // expose the same shape the real Firestore doc has.
      "hotelConfig": {
        roomTypes: [
          {
            value: "standard-double",
            label: "Standard Double",
            shortLabel: "Std Double",
            imageUrls: [],
            bedDefinition: "1 double bed",
            description: "Simple comfort for couples or business travelers.",
            amenities: ["WiFi", "AC"],
            maxCapacity: 4,
            pricePerNight: 2000,
            weekendRate: 2500,
            corporateRate: 1800
          }
        ]
      }
    };
    mockVouchers = {};
    mockCounters = {};
    mockBookings = [];
    setCalls = [];
    updateCalls = [];
    vi.clearAllMocks();
  });

  test("allows only one of two simultaneous bookings for the same room and dates", async () => {
    // Per the room-type booking refactor: the safety net is
    // per-physical-room, not per-type. Limit this test to a
    // single candidate of the requested type so we can verify
    // the transaction rejects a second overlapping booking.
    mockRooms["room_102"].isActive = false;

    const validBookingBody = {
      bookingId: "booking_abc",
      roomType: "standard-double",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 2,
      hasBreakfast: true,
      guestDetails: {
        firstName: "Daniel",
        lastName: "Sandi",
        email: "daniel@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      isCorporate: false,
      turnstileToken: "mock_token"
    };

    // First booking request
    const req1 = mockRequest(validBookingBody);
    const res1 = mockResponse();
    await handler(req1, res1);

    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        bookingId: "booking_abc"
      })
    }));

    // Add first booking to DB to simulate success
    const createdBooking = setCalls.find(call => call.path === "bookings/booking_abc")?.data;
    expect(createdBooking).toBeDefined();
    // Convert checkIn date to simulate Firestore read (which uses toDate method)
    mockBookings.push({
      ...createdBooking,
      checkIn: { toDate: () => createdBooking.checkIn },
      checkOut: { toDate: () => createdBooking.checkOut }
    });

    // Reset calls
    setCalls = [];

    // Second booking request with overlapping dates
    const overlappingBody = {
      ...validBookingBody,
      bookingId: "booking_def",
      checkIn: "2026-06-17",
      checkOut: "2026-06-19"
    };

    const req2 = mockRequest(overlappingBody);
    const res2 = mockResponse();
    await handler(req2, res2);

    expect(res2.status).toHaveBeenCalledWith(409);
    expect(res2.json).toHaveBeenCalledWith({
      success: false,
      error: "Room no longer available"
    });
    expect(setCalls.length).toBe(0); // No document written
  });

  test("rejects booking creation when all rooms of a type are blocked mid-flow", async () => {
    // Block every physical room of the requested type so the
    // transaction has no candidate to assign.
    mockRooms["room_101"].status = "blocked";
    mockRooms["room_102"].status = "blocked";

    const body = {
      bookingId: "booking_xyz",
      roomType: "standard-double",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      isCorporate: false,
      turnstileToken: "mock_token"
    };

    const req = mockRequest(body);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Room no longer available"
    });
    expect(setCalls.length).toBe(0);
  });

  test("does not leave partial writes after timeout or abort", async () => {
    // Room count exceeds capacity - should throw and fail transaction before writing
    const invalidCapacityBody = {
      bookingId: "booking_err",
      roomType: "standard-double",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 10, // Exceeds type maxCapacity (4)
      hasBreakfast: false,
      guestDetails: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      isCorporate: false,
      turnstileToken: "mock_token"
    };

    const req = mockRequest(invalidCapacityBody);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Guest count exceeds room capacity of 4."
    });
    
    // Check that no partial writes were made (neither the booking nor the daily counter was incremented)
    expect(setCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  test("honeypot triggering skips database write and returns silent success", async () => {
    const honeypotBody = {
      bookingId: "booking_hp",
      roomType: "standard-double",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Bot",
        lastName: "Spammer",
        email: "bot@spammer.com",
        phone: "0000000",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      isCorporate: false,
      _hp: "some_bot_value" // Honeypot triggered
    };

    const req = mockRequest(honeypotBody);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        bookingId: "booking_hp"
      })
    }));

    // Ensure absolutely NO database writes occurred
    expect(setCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  test("Turnstile token validation blocks invalid inputs", async () => {
    const invalidTurnstileBody = {
      bookingId: "booking_turnstile",
      roomType: "standard-double",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Daniel",
        lastName: "Sandi",
        email: "daniel@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      isCorporate: false,
      turnstileToken: "" // Missing/invalid token
    };

    // Make sure NODE_ENV is set to something other than "test" momentarily to trigger validation,
    // or simulate since our verifyTurnstile code has:
    // process.env.NODE_ENV === "test" || token === "mock_token" ...
    // Since NODE_ENV is "test" during vitest, let's temporarily stub process.env.NODE_ENV
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "dummy_secret";

    const req = mockRequest(invalidTurnstileBody);
    const res = mockResponse();
    await handler(req, res);

    // Restore environment
    process.env.NODE_ENV = originalEnv;

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Bot verification token is missing."
    });
    expect(setCalls.length).toBe(0);
  });

  describe("room-type booking (auto-assign first free physical room of type)", () => {
    test("picks the first free room of the requested type", async () => {
      const body = {
        bookingId: "booking_type_first",
        roomType: "standard-double",
        checkIn: "2026-07-01",
        checkOut: "2026-07-03",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Type",
          lastName: "Picking",
          email: "type@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/booking_type_first")?.data;
      expect(created).toBeDefined();
      // Should auto-assign one of the two standard-double rooms.
      expect(["room_101", "room_102"]).toContain(created.roomId);
      expect(created.roomType).toBe("standard-double");
      expect(created.roomNumber).toBeTruthy();
    });

    test("skips a candidate room with an overlapping booking and assigns the next free one of the same type", async () => {
      // Pre-existing booking on room_101 for the same window.
      mockBookings.push({
        id: "existing_booking",
        bookingId: "existing_booking",
        roomId: "room_101",
        status: "confirmed",
        checkIn: { toDate: () => new Date("2026-07-02T00:00:00Z") },
        checkOut: { toDate: () => new Date("2026-07-04T00:00:00Z") }
      });

      const body = {
        bookingId: "booking_pick_second",
        roomType: "standard-double",
        checkIn: "2026-07-01",
        checkOut: "2026-07-05",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Second",
          lastName: "Choice",
          email: "second@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/booking_pick_second")?.data;
      expect(created).toBeDefined();
      // room_101 is occupied; transaction should auto-pick room_102.
      expect(created.roomId).toBe("room_102");
    });

    test("returns 'Room no longer available' when every room of the type is booked", async () => {
      // Block every room of standard-double with overlapping bookings.
      mockBookings.push({
        id: "occupy_101",
        bookingId: "occupy_101",
        roomId: "room_101",
        status: "confirmed",
        checkIn: { toDate: () => new Date("2026-08-01T00:00:00Z") },
        checkOut: { toDate: () => new Date("2026-08-05T00:00:00Z") }
      });
      mockBookings.push({
        id: "occupy_102",
        bookingId: "occupy_102",
        roomId: "room_102",
        status: "confirmed",
        checkIn: { toDate: () => new Date("2026-08-01T00:00:00Z") },
        checkOut: { toDate: () => new Date("2026-08-05T00:00:00Z") }
      });

      const body = {
        bookingId: "booking_no_room",
        roomType: "standard-double",
        checkIn: "2026-08-02",
        checkOut: "2026-08-04",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Empty",
          lastName: "House",
          email: "empty@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Room no longer available"
      });
      expect(setCalls.find((c) => c.path === "bookings/booking_no_room")).toBeUndefined();
    });

    test("rejects an unknown roomType with a user-facing error", async () => {
      const body = {
        bookingId: "booking_bad_type",
        roomType: "penthouse-suite",
        checkIn: "2026-07-01",
        checkOut: "2026-07-03",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Bad",
          lastName: "Type",
          email: "bad@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: "Selected room type is not available."
      }));
      expect(setCalls.find((c) => c.path === "bookings/booking_bad_type")).toBeUndefined();
    });
  });

  describe("staff actions (walk-ins, payments, discount rejections, cancellations)", () => {
    test("POST /api/bookings/create-walkin: creates booking with override", async () => {
      const walkinBody = {
        bookingId: "walkin_123",
        roomId: "room_101",
        checkIn: "2026-06-15",
        checkOut: "2026-06-18",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Walk-in",
          lastName: "Guest",
          email: "walkin@guest.com",
          phone: "09171112222"
        },
        paymentMethod: "cash",
        status: "confirmed",
        totalPriceOverride: 5000 // overridden price
      };

      const req = mockRequest(walkinBody, "POST", "/api/bookings/create-walkin");
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          bookingId: "walkin_123"
        })
      }));

      const createdWalkin = setCalls.find(call => call.path === "bookings/walkin_123")?.data;
      expect(createdWalkin).toBeDefined();
      expect(createdWalkin.totalPrice).toBe(5000);
      expect(createdWalkin.originalTotalPrice).toBe(6000); // standard: 2000 per night * 3 nights = 6000
      expect(createdWalkin.source).toBe("walk-in");
    });

    test("POST /api/bookings/create-walkin: blocks unauthenticated requests", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const walkinBody = {
        bookingId: "walkin_auth",
        roomId: "room_101",
        checkIn: "2026-06-15",
        checkOut: "2026-06-18",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Auth",
          lastName: "Test",
          email: "auth@test.com",
          phone: "000"
        },
        paymentMethod: "cash",
        status: "confirmed"
      };

      const req = mockRequest(walkinBody, "POST", "/api/bookings/create-walkin");
      const res = mockResponse();
      await handler(req, res);

      process.env.NODE_ENV = originalEnv;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized: Missing or invalid authorization token."
      });
    });

    test("POST /api/bookings/create-walkin: blocks unauthenticated requests", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const walkinBody = {
        bookingId: "walkin_auth",
        roomId: "room_101",
        checkIn: "2026-06-15",
        checkOut: "2026-06-18",
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Auth",
          lastName: "Test",
          email: "auth@test.com",
          phone: "000"
        },
        paymentMethod: "cash",
        status: "confirmed"
      };

      const req = mockRequest(walkinBody, "POST", "/api/bookings/create-walkin");
      const res = mockResponse();
      await handler(req, res);

      process.env.NODE_ENV = originalEnv;

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized: Missing or invalid authorization token."
      });
    });

    test("POST /api/bookings/add-payment: records onsite payment", async () => {
      const existingBooking = {
        id: "booking_to_pay",
        bookingId: "booking_to_pay",
        totalPrice: 6000,
        status: "confirmed"
      };
      mockBookings.push(existingBooking);

      const paymentBody = {
        bookingId: "booking_to_pay",
        amount: 2500,
        method: "cash",
        note: "Folio deposit"
      };

      const req = mockRequest(paymentBody, "POST", "/api/bookings/add-payment", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true
      }));

      const loggedPayment = setCalls.find(call => call.path.startsWith("bookings/booking_to_pay/payments"))?.data;
      expect(loggedPayment).toBeDefined();
      expect(loggedPayment.amount).toBe(2500);
      expect(loggedPayment.method).toBe("cash");
      // Per BF-15 (booking-flow audit 2026-06-26): `recordedBy` is
      // the staff UID, not the email (PII + audit-log concern).
      expect(loggedPayment.recordedBy).toBe("mock_staff_uid");
    });

    test("POST /api/bookings/reject-discount: rejects government discount and restores full price", async () => {
      const discountedBooking = {
        id: "booking_discounted",
        bookingId: "booking_discounted",
        bookingRef: "SI-20260608-888",
        guestName: "Senior Citizen Test",
        guestEmail: "guest_sr@example.com",
        discountType: "senior",
        discountPct: 20,
        originalTotalPrice: 6000,
        totalPrice: 4800,
        status: "pending",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockBookings.push(discountedBooking);

      const rejectBody = {
        bookingId: "booking_discounted",
        reason: "Invalid ID card photo quality"
      };

      const req = mockRequest(rejectBody, "POST", "/api/bookings/reject-discount", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });

      // Assert database document was updated correctly
      expect(discountedBooking.discountRejected).toBe(true);
      // Per BF-15 (booking-flow audit 2026-06-26): `discountRejectedBy`
      // is the staff UID, not the email.
      expect(discountedBooking.discountRejectedBy).toBe("mock_staff_uid");
      expect(discountedBooking.discountRejectionReason).toBe("Invalid ID card photo quality");
      expect(discountedBooking.discountPct).toBe(0);
      expect(discountedBooking.totalPrice).toBe(6000); // full price restored
    });

    test("POST /api/bookings/cancel: transitions booking status to cancelled", async () => {
      // Per audit S1.4 / decision: only `pending` and `payment-uploaded`
      // bookings can be self-cancelled. Once payment is confirmed or the
      // booking is confirmed, the guest must contact the front desk to
      // cancel. This test uses a `pending` booking — the only state
      // where self-cancel is valid per Phase 11.6 Batch 6.
      const activeBooking = {
        id: "booking_to_cancel",
        bookingId: "booking_to_cancel",
        bookingRef: "SI-20260608-011",
        guestName: "Guest To Cancel",
        guestEmail: "cancel@guest.com",
        status: "pending",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockBookings.push(activeBooking);

      const cancelBody = {
        bookingId: "booking_to_cancel",
        reason: "Change of plans"
      };

      const req = mockRequest(cancelBody, "POST", "/api/bookings/cancel", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });

      expect(activeBooking.status).toBe("cancelled");
      expect(activeBooking.cancellationReason).toBe("Change of plans");
    });

    test("POST /api/bookings/cancel: allows self-cancel after confirmed (BF-16)", async () => {
      // Per BF-16 (booking-flow audit 2026-06-26): the previous
      // block list also rejected `confirmed` and `payment-confirmed`
      // bookings. The relaxed policy is to block only the terminal
      // states (checked-in, checked-out, cancelled). Confirmed and
      // payment-confirmed bookings are now self-cancellable; the
      // existing test was written under audit S1.4's old policy.
      const confirmedBooking = {
        id: "booking_confirmed",
        bookingId: "booking_confirmed",
        bookingRef: "SI-20260608-012",
        guestName: "Confirmed Guest",
        guestEmail: "confirmed@guest.com",
        status: "confirmed",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockBookings.push(confirmedBooking);

      const req = mockRequest(
        { bookingId: "booking_confirmed", reason: "Change of plans" },
        "POST",
        "/api/bookings/cancel",
        { authorization: "Bearer mock_token" }
      );
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // Status is flipped to cancelled.
      expect(confirmedBooking.status).toBe("cancelled");
    });

    test("POST /api/bookings/cancel: allows self-cancel after payment-confirmed (BF-16)", async () => {
      const paymentConfirmedBooking = {
        id: "booking_payment_confirmed",
        bookingId: "booking_payment_confirmed",
        bookingRef: "SI-20260608-013",
        guestName: "Payment Confirmed Guest",
        guestEmail: "payment-confirmed@guest.com",
        status: "payment-confirmed",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockBookings.push(paymentConfirmedBooking);

      const req = mockRequest(
        { bookingId: "booking_payment_confirmed", reason: "Change of plans" },
        "POST",
        "/api/bookings/cancel",
        { authorization: "Bearer mock_token" }
      );
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(paymentConfirmedBooking.status).toBe("cancelled");
    });

    test("POST /api/bookings/cancel: still rejects self-cancel after checked-in (BF-16)", async () => {
      // Per BF-16: terminal states (checked-in, checked-out,
      // cancelled) are still blocked.
      const checkedInBooking = {
        id: "booking_checked_in",
        bookingId: "booking_checked_in",
        bookingRef: "SI-20260608-014",
        guestName: "Checked-in Guest",
        guestEmail: "checked-in@guest.com",
        status: "checked-in",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockBookings.push(checkedInBooking);

      const req = mockRequest(
        { bookingId: "booking_checked_in", reason: "Change of plans" },
        "POST",
        "/api/bookings/cancel",
        { authorization: "Bearer mock_token" }
      );
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringMatching(/cannot be cancelled because its status is already checked-in/i)
      }));
      // Status is unchanged — the cancel was rejected.
      expect(mockBookings.find((b: any) => b.id === "booking_checked_in").status).toBe("checked-in");
    });
  });
});
