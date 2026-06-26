import { beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../../api/[...route]";

// Per W2.2 / decision #90: the server is authoritative on the
// member discount. The handler must (a) verify the Firebase ID
// token from the Authorization header, (b) look up the member,
// (c) read settings/rewardsConfig, and (d) apply the 3rd stacking
// discount step. Per BF-01 (booking-flow audit 2026-06-26): the
// old version of this test was a regex-on-source assertion and
// therefore missed the missing `adminAuth` import — the
// `adminAuth.verifyIdToken` call was a runtime ReferenceError
// even though the regex pattern was present in source. This
// behavioral version imports the handler, mocks `adminAuth`,
// and asserts the booking is actually created with the member
// fields populated.

let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockMembers: Record<string, any> = {};
let mockCounters: Record<string, any> = {};
let mockVouchers: Record<string, any> = {};
let mockBookings: any[] = [];
let setCalls: any[] = [];
let updateCalls: any[] = [];
let allGetLog: string[] = [];

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
        allGetLog.push(path);
        if (coll === "rooms" && mockRooms[docId]) {
          return { exists: true, id: docId, data: () => mockRooms[docId] };
        }
        if (coll === "settings" && mockSettings[docId]) {
          return { exists: true, id: docId, data: () => mockSettings[docId] };
        }
        if (coll === "vouchers" && mockVouchers[docId]) {
          return { exists: true, id: docId, data: () => mockVouchers[docId] };
        }
        if (coll === "counters" && mockCounters[docId]) {
          return { exists: true, id: docId, data: () => mockCounters[docId] };
        }
        if (coll === "members" && mockMembers[docId]) {
          return { exists: true, id: docId, data: () => mockMembers[docId] };
        }
        if (coll === "bookings") {
          const found = mockBookings.find(
            (b) => b.id === docId || b.bookingId === docId || b.bookingRef === docId
          );
          if (found) return { exists: true, id: docId, data: () => found };
        }
        return { exists: false };
      },
      collection: (sub: string) => ({
        add: async (subData: any) => {
          setCalls.push({ path: `${path}/${sub}`, data: subData });
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
      allGetLog.push(`tx:${ref?.path ?? "(no path)"}`);
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

  const mockAdminDb = {
    collection: vi.fn().mockImplementation((collName: string) => buildQuery(collName)),
    doc: vi.fn().mockImplementation((path: string) => createDocRef(path)),
    runTransaction: vi.fn().mockImplementation(async (callback: any) =>
      await callback(mockTransaction)
    )
  };

  const mockAdminAuth = {
    verifyIdToken: vi.fn().mockImplementation(async (token: string) => {
      if (token === "valid_member_token") {
        return { uid: "member_uid_1", email: "member@example.com" };
      }
      throw new Error("Invalid token");
    })
  };

  return {
    adminDb: mockAdminDb,
    adminAuth: mockAdminAuth
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

const mockRequest = (body: any, headers: Record<string, string> = {}) => ({
  method: "POST",
  body,
  url: "/api/bookings/create",
  headers: { host: "localhost", ...headers },
  socket: { remoteAddress: "127.0.0.1" }
} as any);

describe("BF-01 — handleCreateBooking reads the Authorization Bearer token and applies the member discount server-side", () => {
  beforeEach(() => {
    mockRooms = {
      room_101: {
        isActive: true,
        status: "available",
        type: "standard-double",
        name: "Room 101 — Standard Double",
        roomNumber: "101"
      }
    };
    mockSettings = {
      breakfastConfig: { isEnabled: true, ratePerPersonPerNight: 250 },
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
      },
      rewardsConfig: {
        pointsEnabled: true,
        memberDiscountEnabled: true,
        memberDiscountPct: 10
      }
    };
    mockMembers = {
      member_uid_1: {
        isMember: true,
        isActive: true,
        fullName: "Maria Member",
        email: "member@example.com",
        memberNumber: "SR-00001",
        rewardsPoints: 0
      }
    };
    mockVouchers = {};
    mockCounters = {};
    mockBookings = [];
    setCalls = [];
    updateCalls = [];
    allGetLog = [];
    vi.clearAllMocks();
  });

  test("does not throw ReferenceError when Authorization header is present", async () => {
    const body = {
      bookingId: "booking_bf01_a",
      roomType: "standard-double",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Maria",
        lastName: "Member",
        email: "member@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      turnstileToken: "mock_token"
    };

    const req = mockRequest(body, { authorization: "Bearer valid_member_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.success).toBe(true);
    expect(jsonArg.data.bookingRef).toMatch(/^SI-\d{8}-\d{3}$/);
    expect(jsonArg.data.roomId).toBe("room_101");
  });

  test("verifies the ID token and looks up the member doc", async () => {
    const { adminAuth } = await import("../../server/lib/firebase-admin");

    const body = {
      bookingId: "booking_bf01_b",
      roomType: "standard-double",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Maria",
        lastName: "Member",
        email: "member@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      turnstileToken: "mock_token"
    };

    const req = mockRequest(body, { authorization: "Bearer valid_member_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith("valid_member_token");
    expect(allGetLog).toContain("members/member_uid_1");
    expect(allGetLog.some((p) => p.startsWith("tx:") && p.endsWith("settings/rewardsConfig"))).toBe(true);
  });

  test("booking doc carries memberId, memberDiscountPct, and a discounted totalPrice", async () => {
    const body = {
      bookingId: "booking_bf01_c",
      roomType: "standard-double",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Maria",
        lastName: "Member",
        email: "member@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      turnstileToken: "mock_token"
    };

    // 2 nights @ 2000 = 4000 subtotal
    // memberDiscountPct 10% on the post-voucher subtotal (4000 - 0 = 4000)
    // member discount = 400
    // totalPrice = 3600
    const req = mockRequest(body, { authorization: "Bearer valid_member_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const bookingWrite = setCalls.find((c) => c.path === "bookings/booking_bf01_c");
    expect(bookingWrite).toBeDefined();
    expect(bookingWrite.data.memberId).toBe("member_uid_1");
    expect(bookingWrite.data.memberDiscountPct).toBe(10);
    expect(bookingWrite.data.totalPrice).toBe(3600);
  });

  test("anonymous booking (no Authorization header) succeeds with no member discount", async () => {
    const body = {
      bookingId: "booking_bf01_d",
      roomType: "standard-double",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Anon",
        lastName: "Guest",
        email: "anon@example.com",
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
    const bookingWrite = setCalls.find((c) => c.path === "bookings/booking_bf01_d");
    expect(bookingWrite).toBeDefined();
    expect(bookingWrite.data.memberId).toBeNull();
    expect(bookingWrite.data.memberDiscountPct).toBe(0);
    expect(bookingWrite.data.totalPrice).toBe(4000);
  });

  test("invalid/expired ID token falls through to anonymous booking", async () => {
    const body = {
      bookingId: "booking_bf01_e",
      roomType: "standard-double",
      checkIn: "2026-07-15",
      checkOut: "2026-07-17",
      guests: 2,
      hasBreakfast: false,
      guestDetails: {
        firstName: "Anon",
        lastName: "Guest",
        email: "anon@example.com",
        phone: "09171234567",
        consent: true
      },
      discountType: "",
      discountIdPhotoUrl: null,
      paymentMethod: "pay-at-hotel",
      turnstileToken: "mock_token"
    };

    const req = mockRequest(body, { authorization: "Bearer expired_token_xyz" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const bookingWrite = setCalls.find((c) => c.path === "bookings/booking_bf01_e");
    expect(bookingWrite.data.memberId).toBeNull();
    expect(bookingWrite.data.totalPrice).toBe(4000);
  });
});
