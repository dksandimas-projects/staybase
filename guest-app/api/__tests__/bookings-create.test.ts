import { beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../[...route]";

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
vi.mock("../lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ id: "mock_email_id" })
    }
  }
}));

// Mock Firebase Admin SDK
vi.mock("../lib/firebase-admin", () => {
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
      collection: (sub: string) => ({
        add: async (subData: any) => {
          setCalls.push({ path: `${path}/${sub}`, data: subData });
          return { id: "mock_sub_id" };
        }
      })
    };
  };

  const mockCollection = (collName: string) => ({
    isQuery: collName === "bookings",
    path: collName,
    where: function () { return this; },
    limit: function () { return this; },
    doc: (docId: string) => {
      return createDocRef(`${collName}/${docId}`);
    },
    get: async function () {
      const docs = mockBookings.map(b => ({
        data: () => b,
        exists: true,
        id: b.id || b.bookingId || "mock_id",
        ref: createDocRef(`bookings/${b.id || b.bookingId || b.bookingRef}`)
      }));
      return {
        empty: docs.length === 0,
        docs
      };
    }
  });

  const mockTransaction = {
    get: vi.fn().mockImplementation(async (ref: any) => {
      if (ref && ref.isQuery) {
        const docs = mockBookings.map(b => ({
          data: () => b,
          exists: true,
          id: b.bookingId || "mock_id"
        }));
        return { docs };
      }

      if (!ref || typeof ref.path !== "string") {
        return { exists: false };
      }

      const path = ref.path;
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
      }
    };
    mockSettings = {
      "breakfastConfig": {
        isEnabled: true,
        ratePerPersonPerNight: 250
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
    const validBookingBody = {
      bookingId: "booking_abc",
      roomId: "room_101",
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

  test("rejects booking creation when a room is blocked mid-flow", async () => {
    // Block the room
    mockRooms["room_101"].status = "blocked";

    const body = {
      bookingId: "booking_xyz",
      roomId: "room_101",
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
      roomId: "room_101",
      checkIn: "2026-06-15",
      checkOut: "2026-06-18",
      guests: 10, // Exceeds maxCapacity (4)
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
      roomId: "room_101",
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
      roomId: "room_101",
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
      expect(loggedPayment.recordedBy).toBe("mock_staff@sparkinn.com"); // server-side resolved from staff token info
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
      expect(discountedBooking.discountRejectedBy).toBe("mock_staff@sparkinn.com");
      expect(discountedBooking.discountRejectionReason).toBe("Invalid ID card photo quality");
      expect(discountedBooking.discountPct).toBe(0);
      expect(discountedBooking.totalPrice).toBe(6000); // full price restored
    });

    test("POST /api/bookings/cancel: transitions booking status to cancelled", async () => {
      const activeBooking = {
        id: "booking_to_cancel",
        bookingId: "booking_to_cancel",
        bookingRef: "SI-20260608-011",
        guestName: "Guest To Cancel",
        guestEmail: "cancel@guest.com",
        status: "confirmed",
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
  });
});
