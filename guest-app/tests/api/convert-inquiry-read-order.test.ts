import { describe, test, expect, vi, beforeEach } from "vitest";
import handler from "../../server/apiRouter";

// Per BR-06 (booking-flow audit 2026-07-08): runtime regression
// coverage for `handleConvertInquiryToBooking`. The existing
// `batch-9-convert-inquiry.test.ts` is source-pattern only, so it
// could not catch the read-after-write transaction bug: the
// corporate-code `usageCount` increment queued a write before the
// booking-ref counter read, and the Firestore Admin SDK throws
// "Firestore transactions require all reads to be executed before
// all writes." on any transaction read once a write is queued.
// The mock transaction below enforces the same rule (mirroring the
// BR-03 hardening in `bookings-create.test.ts`) so the ordering is
// test-visible.

let mockInquiries: Record<string, any> = {};
let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockCorporateCodes: Record<string, any> = {};
let mockCounters: Record<string, any> = {};

let setCalls: Array<{ path: string; data: any }> = [];
let updateCalls: Array<{ path: string; data: any }> = [];

vi.mock("../../server/lib/firebase-admin", () => {
  const lookupDoc = (path: string) => {
    const [coll, docId] = path.split("/");
    const pools: Record<string, Record<string, any>> = {
      corporateInquiries: mockInquiries,
      rooms: mockRooms,
      settings: mockSettings,
      corporateCodes: mockCorporateCodes,
      counters: mockCounters
    };
    const pool = pools[coll];
    if (pool && pool[docId]) {
      return { exists: true, id: docId, data: () => pool[docId] };
    }
    return { exists: false, id: docId, data: () => undefined };
  };

  const createDocRef = (path: string): any => ({
    path,
    get: async () => lookupDoc(path),
    collection: (sub: string) => mockCollection(`${path}/${sub}`)
  });

  const mockCollection = (collName: string): any => {
    const makeQuery = (filters: Array<{ field: string; op: string; value: any }>): any => ({
      __query: true,
      collName,
      filters,
      where: (field: string, op: string, value: any) =>
        makeQuery([...filters, { field, op, value }]),
      limit: () => makeQuery(filters),
      get: async () => ({ empty: true, docs: [] })
    });
    return {
      doc: (docId: string) => createDocRef(`${collName}/${docId}`),
      where: (field: string, op: string, value: any) =>
        makeQuery([{ field, op, value }])
    };
  };

  const runQuery = async (_query: any) => {
    // The convert handler's only transaction query is the
    // overlapping-bookings check; these tests always run it
    // against an empty bookings collection.
    return { empty: true, docs: [] };
  };

  const mockAdminDb = {
    collection: vi.fn().mockImplementation((collName: string) => mockCollection(collName)),
    doc: vi.fn().mockImplementation((path: string) => createDocRef(path)),
    runTransaction: vi.fn().mockImplementation(async (callback: any) => {
      // BR-03 / BR-06: enforce the Firestore Admin SDK's
      // read-before-write transaction rule so a queued write
      // followed by any read fails the test exactly like
      // production.
      let hasWrites = false;
      const readAfterWriteMessage =
        "Firestore transactions require all reads to be executed before all writes.";
      const transaction = {
        get: async (refOrQuery: any) => {
          if (hasWrites) {
            throw new Error(readAfterWriteMessage);
          }
          if (refOrQuery?.__query) {
            return runQuery(refOrQuery);
          }
          return lookupDoc(refOrQuery.path);
        },
        getAll: async (...refs: any[]) => {
          if (hasWrites) {
            throw new Error(readAfterWriteMessage);
          }
          return refs.map((ref) => lookupDoc(ref.path));
        },
        set: (ref: any, data: any) => {
          hasWrites = true;
          setCalls.push({ path: ref.path, data });
        },
        update: (ref: any, data: any) => {
          hasWrites = true;
          updateCalls.push({ path: ref.path, data });
        },
        create: (ref: any, data: any) => {
          hasWrites = true;
          setCalls.push({ path: ref.path, data });
        },
        delete: (ref: any) => {
          hasWrites = true;
          updateCalls.push({ path: ref.path, data: { __deleted: true } });
        }
      };
      return await callback(transaction);
    })
  };

  return {
    adminDb: mockAdminDb,
    adminAuth: {}
  };
});

const isoDate = (daysFromNow: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

const CHECK_IN = isoDate(30);
const CHECK_OUT = isoDate(32);

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (body: any) =>
  ({
    method: "POST",
    body,
    url: "/api/corporate/convert-inquiry",
    headers: { host: "localhost" },
    socket: { remoteAddress: "127.0.0.1" }
  }) as any;

const baseBody = {
  inquiryId: "inq_1",
  bookingId: "bkconv0000001",
  roomId: "room_101",
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  guests: 2,
  hasBreakfast: false,
  paymentMethod: "chargeback"
};

describe("/api/corporate/convert-inquiry — transaction read/write ordering (BR-06)", () => {
  beforeEach(() => {
    mockInquiries = {
      inq_1: {
        status: "negotiating",
        companyName: "Acme Travel",
        contactPerson: "Jane Cruz",
        email: "jane@acmetravel.example",
        phone: "09171234567",
        specialRequirements: "Near the lobby please",
        preferredDates: `${CHECK_IN} to ${CHECK_OUT}`,
        numRooms: 1,
        notes: []
      }
    };
    mockRooms = {
      room_101: {
        name: "Standard Double 101",
        roomNumber: "101",
        type: "standard-double",
        isActive: true,
        status: "available",
        maxCapacity: 2,
        pricePerNight: 2000,
        corporateRate: 1800
      }
    };
    mockSettings = {};
    mockCorporateCodes = {};
    mockCounters = {};
    setCalls = [];
    updateCalls = [];
  });

  test("converting an inquiry with an attached access code succeeds and increments usageCount", async () => {
    mockInquiries.inq_1.accessCodeId = "CORP500";
    mockCorporateCodes.CORP500 = {
      code: "CORP500",
      companyName: "Acme Travel",
      isActive: true,
      usageCap: 10,
      usageCount: 2,
      ratePerRoomType: {
        "standard-double": 1500
      }
    };

    const req = mockRequest(baseBody);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const created = setCalls.find((c) => c.path === "bookings/bkconv0000001")?.data;
    expect(created).toBeDefined();
    expect(created.isCorporate).toBe(true);
    expect(created.source).toBe("corporate");
    expect(created.corporateCode).toBe("CORP500");
    expect(created.linkedInquiryId).toBe("inq_1");
    expect(created.ratePerNight).toBe(1500);
    expect(updateCalls).toContainEqual({
      path: "corporateCodes/CORP500",
      data: expect.objectContaining({ usageCount: 3 })
    });
    const inquiryUpdate = updateCalls.find((c) => c.path === "corporateInquiries/inq_1")?.data;
    expect(inquiryUpdate).toBeDefined();
    expect(inquiryUpdate.status).toBe("converted");
    expect(inquiryUpdate.convertedBookingId).toBe("bkconv0000001");
  });

  test("converting an inquiry without an access code succeeds at the room's corporateRate", async () => {
    const req = mockRequest(baseBody);
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const created = setCalls.find((c) => c.path === "bookings/bkconv0000001")?.data;
    expect(created).toBeDefined();
    expect(created.isCorporate).toBe(true);
    expect(created.ratePerNight).toBe(1800);
    expect(created.corporateCode).toBe("");
    expect(updateCalls.some((c) => c.path.startsWith("corporateCodes/"))).toBe(false);
  });
});
