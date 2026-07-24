import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertBookingFinanceInvariant, getManilaDateInfo } from "@spark-inn/shared";
import handler from "../../server/apiRouter";

// Global mock state
let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockVouchers: Record<string, any> = {};
let mockCorporateCodes: Record<string, any> = {};
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
        if (coll === "corporateCodes" && mockCorporateCodes[docId]) {
          return {
            exists: true,
            data: () => mockCorporateCodes[docId]
          };
        }
        if (coll === "vouchers" && mockVouchers[docId]) {
          return {
            exists: true,
            data: () => mockVouchers[docId]
          };
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
        } else if (collName === "vouchers") {
          pool = Object.entries(mockVouchers).map(([id, data]) => ({ id, ...data }));
        } else if (collName === "corporateCodes") {
          pool = Object.entries(mockCorporateCodes).map(([id, data]) => ({ id, ...data }));
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

      if (coll === "corporateCodes") {
        if (mockCorporateCodes[docId]) {
          return {
            exists: true,
            data: () => mockCorporateCodes[docId]
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
      let hasWrites = false;
      const readAfterWriteMessage = "Firestore transactions require all reads to be executed before all writes.";
      const transaction = {
        get: vi.fn().mockImplementation(async (ref: any) => {
          if (hasWrites) {
            throw new Error(readAfterWriteMessage);
          }
          return mockTransaction.get(ref);
        }),
        getAll: vi.fn().mockImplementation(async (...refs: any[]) => {
          if (hasWrites) {
            throw new Error(readAfterWriteMessage);
          }
          return Promise.all(refs.map((ref) => mockTransaction.get(ref)));
        }),
        set: vi.fn().mockImplementation((ref: any, data: any) => {
          hasWrites = true;
          return mockTransaction.set(ref, data);
        }),
        update: vi.fn().mockImplementation((ref: any, data: any) => {
          hasWrites = true;
          return mockTransaction.update(ref, data);
        }),
        create: vi.fn().mockImplementation((ref: any, data: any) => {
          hasWrites = true;
          return mockTransaction.set(ref, data);
        }),
        delete: vi.fn().mockImplementation((ref: any) => {
          hasWrites = true;
          updateCalls.push({ path: ref.path, data: { __deleted: true } });
        })
      };
      return await callback(transaction);
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

// Per BI-12 (booking-intercom audit 2026-07-06): the public
// /api/bookings/create route now rejects past check-ins. The
// test fixtures previously hardcoded `"2026-06-15"`-style
// strings, which became past-the-day the audit ran and started
// failing the new check. Compute future-dated ISO strings
// relative to the test run so the suite stays green as the
// calendar advances (no more "update the test dates" every
// quarter).
const isoDate = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const offsetDateKey = (dateKey: string, offsetDays: number): string => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
// 30 / 33 / 36 days out — well past the past-date check's
// "today" floor for any reasonable test-run time. Spread
// gives the room-type + overlap tests enough headroom to
// detect conflicts.
const FUTURE_CHECK_IN_1 = isoDate(30);
const FUTURE_CHECK_OUT_1 = isoDate(33);
const FUTURE_CHECK_IN_2 = isoDate(32);
const FUTURE_CHECK_OUT_2 = isoDate(34);
const FUTURE_CHECK_IN_3 = isoDate(36);
const FUTURE_CHECK_OUT_3 = isoDate(39);
const completeGuestRegistration = {
  nationality: "Filipino",
  address: "Tagbilaran City",
  dateOfBirth: "1980-01-01",
  gender: "Female",
  // Per Decision #121 (2026-07-23): purpose of stay defaults to
  // "Leisure" and is required at physical check-in.
  purposeOfStay: "leisure",
  idType: "Passport",
  idNumber: "P1234567",
  emergencyContact: "Juan Dela Cruz / 09171234567",
  signatureStatus: "signed"
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
        paymentMethods: [
          { method: "cash", requireReferenceNumber: false }
        ],
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
    mockCorporateCodes = {};
    mockCounters = {};
    mockBookings = [];
    setCalls = [];
    updateCalls = [];
    vi.clearAllMocks();
  });

  test.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["non-numeric", "two"],
    ["non-finite", Number.NaN]
  ])("rejects a %s guest count before pricing or Firestore writes", async (_label, invalidGuests) => {
    const req = mockRequest({
      bookingId: "bookingG011",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
      guests: invalidGuests,
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
      turnstileToken: "mock_token"
    });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(setCalls).toHaveLength(0);
  });

  test("rejects unknown top-level public booking fields", async () => {
    const req = mockRequest({
      bookingId: "bookingG012",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
      isCorporate: true,
      turnstileToken: "mock_token"
    });
    const res = mockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(setCalls).toHaveLength(0);
  });

  test("allows only one of two simultaneous bookings for the same room and dates", async () => {
    // Per the room-type booking refactor: the safety net is
    // per-physical-room, not per-type. Limit this test to a
    // single candidate of the requested type so we can verify
    // the transaction rejects a second overlapping booking.
    mockRooms["room_102"].isActive = false;

    const validBookingBody = {
      bookingId: "bookingAbc1",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
        bookingId: "bookingAbc1"
      })
    }));

    // Add first booking to DB to simulate success
    const createdBooking = setCalls.find(call => call.path === "bookings/bookingAbc1")?.data;
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
      bookingId: "bookingDef1",
      checkIn: FUTURE_CHECK_IN_2,
      checkOut: FUTURE_CHECK_OUT_2
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
      bookingId: "bookingXyz1",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
      bookingId: "bookingErr1",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
      bookingId: "bookingHp01",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
      _hp: "some_bot_value" // Honeypot triggered
    };

    const req = mockRequest(honeypotBody);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Per BF-44 (booking-flow audit 2026-06-26): the fake
    // success now always returns a fresh random bookingId;
    // the bot's preallocated `bookingHp01` is NOT echoed
    // back (it would leak the real preallocated ID into the
    // bot's response).
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        bookingId: expect.stringMatching(/^hp_/)
      })
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.not.objectContaining({
        bookingId: "bookingHp01"
      })
    }));

    // Ensure absolutely NO database writes occurred
    expect(setCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  test("Turnstile token validation blocks invalid inputs", async () => {
    const invalidTurnstileBody = {
      bookingId: "bookingTurnstile1",
      roomType: "standard-double",
      checkIn: FUTURE_CHECK_IN_1,
      checkOut: FUTURE_CHECK_OUT_1,
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
        bookingId: "bookingTypeFirst1",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
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
      const created = setCalls.find((c) => c.path === "bookings/bookingTypeFirst1")?.data;
      expect(created).toBeDefined();
      // Should auto-assign one of the two standard-double rooms.
      expect(["room_101", "room_102"]).toContain(created.roomId);
      expect(created.roomType).toBe("standard-double");
      expect(created.roomNumber).toBeTruthy();
      expect(created.originalTotalPrice).toBe(created.totalPrice);
      assertBookingFinanceInvariant(created);
    });

    test("skips a candidate room with an overlapping booking and assigns the next free one of the same type", async () => {
      // Pre-existing booking on room_101 for the same window.
      // Per BI-12: use the dynamic future-dated fixtures so the
      // setup overlaps the new booking's window without falling
      // foul of the past-date check.
      mockBookings.push({
        id: "existing_booking",
        bookingId: "existing_booking",
        roomId: "room_101",
        status: "confirmed",
        checkIn: { toDate: () => new Date(`${FUTURE_CHECK_IN_2}T00:00:00Z`) },
        checkOut: { toDate: () => new Date(`${FUTURE_CHECK_OUT_2}T00:00:00Z`) }
      });

      const body = {
        bookingId: "bookingPickSecond1",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
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
      const created = setCalls.find((c) => c.path === "bookings/bookingPickSecond1")?.data;
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
        bookingId: "bookingNoRoom1",
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
      expect(setCalls.find((c) => c.path === "bookings/bookingNoRoom1")).toBeUndefined();
    });

    test("blocks a same-day booking when every room has a past-dated checked-in guest", async () => {
      const { todayStr } = getManilaDateInfo();
      const yesterdayKey = offsetDateKey(todayStr, -1);
      const tomorrowKey = offsetDateKey(todayStr, 1);

      mockBookings.push({
        id: "lingering_101",
        bookingId: "lingering_101",
        roomId: "room_101",
        status: "checked-in",
        checkIn: { toDate: () => new Date(`${offsetDateKey(todayStr, -3)}T00:00:00Z`) },
        checkOut: { toDate: () => new Date(`${yesterdayKey}T00:00:00Z`) }
      });
      mockBookings.push({
        id: "lingering_102",
        bookingId: "lingering_102",
        roomId: "room_102",
        status: "checked-in",
        checkIn: { toDate: () => new Date(`${offsetDateKey(todayStr, -2)}T00:00:00Z`) },
        checkOut: { toDate: () => new Date(`${yesterdayKey}T00:00:00Z`) }
      });

      const body = {
        bookingId: "bookingRoomNotReady1",
        roomType: "standard-double",
        checkIn: todayStr,
        checkOut: tomorrowKey,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Same",
          lastName: "Day",
          email: "sameday@example.com",
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
        error: "Room not ready — previous guest has not checked out yet."
      });
      expect(setCalls.find((c) => c.path === "bookings/bookingRoomNotReady1")).toBeUndefined();
    });

    test("does not block today's checked-in departure before the configured checkout time", async () => {
      const { todayStr } = getManilaDateInfo();
      const tomorrowKey = offsetDateKey(todayStr, 1);
      mockSettings.hotelConfig.checkOutTime = "23:59";

      mockBookings.push({
        id: "departure_today_101",
        bookingId: "departure_today_101",
        roomId: "room_101",
        status: "checked-in",
        checkIn: { toDate: () => new Date(`${offsetDateKey(todayStr, -2)}T00:00:00Z`) },
        checkOut: { toDate: () => new Date(`${todayStr}T00:00:00Z`) }
      });

      const body = {
        bookingId: "bookingBeforeCheckout1",
        roomType: "standard-double",
        checkIn: todayStr,
        checkOut: tomorrowKey,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Before",
          lastName: "Checkout",
          email: "before-checkout@example.com",
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
      expect(setCalls.find((c) => c.path === "bookings/bookingBeforeCheckout1")).toBeDefined();
    });

    test("rejects an unknown roomType with a user-facing error", async () => {
      const body = {
        bookingId: "bookingBadType1",
        roomType: "penthouse-suite",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
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
      expect(setCalls.find((c) => c.path === "bookings/bookingBadType1")).toBeUndefined();
    });
  });

  describe("transaction read/write ordering regressions", () => {
    test("valid corporate-code booking increments usageCount and still succeeds", async () => {
      mockCorporateCodes.CORP500 = {
        code: "CORP500",
        companyName: "Acme Travel",
        isActive: true,
        expiresAt: { toDate: () => new Date(`${isoDate(90)}T00:00:00Z`) },
        usageCap: 10,
        usageCount: 2,
        ratePerRoomType: {
          "standard-double": 1500
        }
      };

      const body = {
        bookingId: "bookingCorp1",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Corporate",
          lastName: "Guest",
          email: "corp@example.com",
          phone: "09171234567",
          consent: true,
          companyName: "Client-entered name"
        },
        discountType: "",
        discountIdPhotoUrl: null,
        paymentMethod: "pay-at-hotel",
        corporateCode: "corp500",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/bookingCorp1")?.data;
      expect(created).toBeDefined();
      expect(created.isCorporate).toBe(true);
      expect(created.source).toBe("corporate");
      expect(created.companyName).toBe("Acme Travel");
      expect(created.ratePerNight).toBe(1500);
      expect(updateCalls).toContainEqual({
        path: "corporateCodes/CORP500",
        data: expect.objectContaining({
          usageCount: 3
        })
      });
    });

    test("valid voucher booking increments usageCount and still succeeds", async () => {
      mockVouchers.SAVE500 = {
        code: "SAVE500",
        discountType: "fixed",
        discountValue: 500,
        isActive: true,
        expiresAt: { toDate: () => new Date(`${isoDate(90)}T00:00:00Z`) },
        usageCap: 10,
        usageCount: 4,
        applicableRoomTypes: []
      };

      const body = {
        bookingId: "bookingVoucher1",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Voucher",
          lastName: "Guest",
          email: "voucher@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        voucherCode: "save500",
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/bookingVoucher1")?.data;
      expect(created).toBeDefined();
      expect(created.voucherCode).toBe("SAVE500");
      expect(created.voucherDiscount).toBe(500);
      expect(updateCalls).toContainEqual({
        path: "vouchers/SAVE500",
        data: expect.objectContaining({
          usageCount: 5
        })
      });
    });

    test("voucher with a non-Timestamp expiresAt (string) does not crash booking creation", async () => {
      // Regression (BF-500): legacy/imported voucher docs can store expiresAt
      // as an ISO string, so `vData.expiresAt.toDate()` threw
      // "toDate is not a function" and 500'd /api/bookings/create.
      mockVouchers.SAVESTR = {
        code: "SAVESTR",
        discountType: "fixed",
        discountValue: 500,
        isActive: true,
        expiresAt: `${isoDate(90)}T00:00:00Z`,
        usageCap: 10,
        usageCount: 4,
        applicableRoomTypes: []
      };

      const body = {
        bookingId: "bookingVoucherStr",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Voucher",
          lastName: "Guest",
          email: "voucherstr@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "",
        discountIdPhotoUrl: null,
        voucherCode: "savestr",
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/bookingVoucherStr")?.data;
      expect(created).toBeDefined();
      expect(created.voucherCode).toBe("SAVESTR");
      expect(created.voucherDiscount).toBe(500);
    });

    test("percent voucher applies after Senior/PWD discount during booking creation", async () => {
      mockVouchers.SAVE10 = {
        code: "SAVE10",
        discountType: "percent",
        discountValue: 10,
        isActive: true,
        expiresAt: { toDate: () => new Date(`${isoDate(90)}T00:00:00Z`) },
        usageCap: 10,
        usageCount: 2,
        applicableRoomTypes: []
      };

      const body = {
        bookingId: "bookingVoucherSenior1",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Senior",
          lastName: "Voucher",
          email: "seniorvoucher@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "senior",
        // Per X-01 (E2E audit 2026-07-17): guest clients must
        // never mint a download URL for private bucket uploads.
        // The server validates the discount against the path
        // only — the URL is derived server-side for staff via
        // `/api/storage/signed-url`.
        discountIdPhotoPath: "bookings/bookingVoucherSenior1/discount-id/test-senior.jpg",
        voucherCode: "save10",
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const created = setCalls.find((c) => c.path === "bookings/bookingVoucherSenior1")?.data;
      expect(created).toBeDefined();
      const seniorPwdDiscount = Math.round(created.originalTotalPrice * 0.2);
      const expectedVoucherDiscount = Math.round((created.originalTotalPrice - seniorPwdDiscount) * 0.1);
      expect(created.voucherCode).toBe("SAVE10");
      expect(created.voucherDiscount).toBe(expectedVoucherDiscount);
      expect(created.totalPrice).toBe(created.originalTotalPrice - seniorPwdDiscount - expectedVoucherDiscount);
      assertBookingFinanceInvariant(created);
      expect(updateCalls).toContainEqual({
        path: "vouchers/SAVE10",
        data: expect.objectContaining({
          usageCount: 3
        })
      });
    });

    // Per X-01 (E2E audit 2026-07-17): the discount-ID business rule
    // is validated against the private-bucket *path* (not a public
    // URL), because anonymous guest uploads never mint a
    // download URL. Regression guard: a senior/PWD discount with
    // no path must still be rejected.
    test("rejects government discount when no discountIdPhotoPath is provided", async () => {
      const body = {
        bookingId: "bookingNoDiscountId",
        roomType: "standard-double",
        checkIn: FUTURE_CHECK_IN_1,
        checkOut: FUTURE_CHECK_OUT_1,
        guests: 2,
        hasBreakfast: false,
        guestDetails: {
          firstName: "Senior",
          lastName: "NoId",
          email: "seniornoid@example.com",
          phone: "09171234567",
          consent: true
        },
        discountType: "senior",
        // no discountIdPhotoPath — guest skipped the ID upload
        paymentMethod: "pay-at-hotel",
        turnstileToken: "mock_token"
      };

      const req = mockRequest(body);
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Government-mandated discount")
        })
      );
    });
  });

  describe("staff actions (walk-ins, payments, discount rejections, cancellations)", () => {
    test("POST /api/bookings/create-walkin: creates booking with override", async () => {
      const walkinBody = {
        bookingId: "walkin12345",
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
          bookingId: "walkin12345"
        })
      }));

      const createdWalkin = setCalls.find(call => call.path === "bookings/walkin12345")?.data;
      expect(createdWalkin).toBeDefined();
      expect(createdWalkin.totalPrice).toBe(5000);
      expect(createdWalkin.originalTotalPrice).toBe(5000); // staff-agreed manual override is the pre-discount pricing basis
      expect(createdWalkin.source).toBe("walk-in");
      assertBookingFinanceInvariant(createdWalkin);
    });

    test("POST /api/bookings/create-walkin: blocks unauthenticated requests", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const walkinBody = {
        bookingId: "walkinAuth1",
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
        bookingId: "walkinAuth1",
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
        paymentId: "paymentRequest001",
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

    test("POST /api/bookings/checkin: blocks missing guest ID photo", async () => {
      mockBookings.push({
        id: "booking_checkin_no_id",
        roomId: "room_101",
        status: "confirmed",
        guestIdPhotoUrl: null,
        guestRegistration: completeGuestRegistration
      });

      const req = mockRequest({ bookingId: "booking_checkin_no_id" }, "POST", "/api/bookings/checkin", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining("Guest ID photo")
      }));
      expect(updateCalls.find((c) => c.path === "bookings/booking_checkin_no_id")).toBeUndefined();
    });

    test("POST /api/bookings/checkin: blocks incomplete guest registration", async () => {
      mockBookings.push({
        id: "booking_checkin_incomplete",
        roomId: "room_101",
        status: "confirmed",
        guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
        guestRegistration: {
          ...completeGuestRegistration,
          emergencyContact: "",
          signatureStatus: "pending"
        }
      });

      const req = mockRequest({ bookingId: "booking_checkin_incomplete" }, "POST", "/api/bookings/checkin", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining("Emergency contact")
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining("Guest signature marked signed")
      }));
      expect(updateCalls.find((c) => c.path === "bookings/booking_checkin_incomplete")).toBeUndefined();
    });

    test("POST /api/bookings/checkin: succeeds from confirmed when registration packet is complete", async () => {
      mockBookings.push({
        id: "booking_checkin_confirmed",
        roomId: "room_101",
        status: "confirmed",
        guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
        guestRegistration: completeGuestRegistration
      });

      const req = mockRequest({ bookingId: "booking_checkin_confirmed" }, "POST", "/api/bookings/checkin", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateCalls).toContainEqual({
        path: "bookings/booking_checkin_confirmed",
        data: expect.objectContaining({ status: "checked-in" })
      });
      expect(updateCalls).toContainEqual({
        path: "rooms/room_101",
        data: expect.objectContaining({ status: "occupied" })
      });
    });

    test("POST /api/bookings/checkin: succeeds directly from payment-confirmed", async () => {
      mockBookings.push({
        id: "booking_checkin_paid",
        roomId: "room_101",
        status: "payment-confirmed",
        guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
        guestRegistration: completeGuestRegistration
      });

      const req = mockRequest({ bookingId: "booking_checkin_paid" }, "POST", "/api/bookings/checkin", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateCalls).toContainEqual({
        path: "bookings/booking_checkin_paid",
        data: expect.objectContaining({ status: "checked-in" })
      });
    });

    test("POST /api/bookings/checkin: rejects terminal statuses", async () => {
      mockBookings.push({
        id: "booking_checkin_cancelled",
        roomId: "room_101",
        status: "cancelled",
        guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
        guestRegistration: completeGuestRegistration
      });

      const req = mockRequest({ bookingId: "booking_checkin_cancelled" }, "POST", "/api/bookings/checkin", { authorization: "Bearer mock_token" });
      const res = mockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.stringContaining("Booking status must be confirmed or payment-confirmed")
      }));
      expect(updateCalls.find((c) => c.path === "bookings/booking_checkin_cancelled")).toBeUndefined();
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
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          discountRejected: true,
          discountRejectedBy: "mock_staff_uid",
          discountRejectionReason: "Invalid ID card photo quality",
          discountPct: 0,
          totalPrice: 6000
        })
      });

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
        voucherCode: "SAVE500",
        checkIn: { toDate: () => new Date("2026-06-12") },
        checkOut: { toDate: () => new Date("2026-06-14") }
      };
      mockVouchers.SAVE500 = {
        code: "SAVE500",
        usageCount: 2
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

      expect(updateCalls).toContainEqual({
        path: "bookings/booking_to_cancel",
        data: expect.objectContaining({
          status: "cancelled",
          cancellationReason: "Change of plans"
        })
      });
      expect(updateCalls).toContainEqual({
        path: "vouchers/SAVE500",
        data: expect.objectContaining({
          usageCount: 1
        })
      });
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
      expect(updateCalls).toContainEqual({
        path: "bookings/booking_confirmed",
        data: expect.objectContaining({
          status: "cancelled"
        })
      });
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
      expect(updateCalls).toContainEqual({
        path: "bookings/booking_payment_confirmed",
        data: expect.objectContaining({
          status: "cancelled"
        })
      });
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
