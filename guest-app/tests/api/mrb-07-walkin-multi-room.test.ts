import { beforeEach, describe, expect, test, vi } from "vitest";

// Per MRB-07 (2026-08-02, per decision #159): the admin New Booking
// modal can create a reservation covering N rooms, so
// `/api/bookings/create-walkin` accepts an optional `rooms[]` room
// list. These tests exercise the handler end to end (against mocked
// Firestore) rather than pinning source text, because the properties
// that matter are behavioral: N booking docs, distinct references, one
// reservation header with correct aggregates, per-room money
// allocations that re-sum to the reservation total exactly, all-or-
// nothing availability, and byte-equivalence for the single-room case.

let mockRooms: Record<string, any> = {};
let mockSettings: Record<string, any> = {};
let mockBookings: any[] = [];
let mockCounters: Record<string, any> = {};
let setCalls: any[] = [];
let updateCalls: any[] = [];
let autoDocSeq = 0;

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
        if (coll === "counters" && mockCounters[docId]) {
          return { exists: true, id: docId, data: () => mockCounters[docId] };
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
      // `doc()` with no argument auto-mints an id — the pattern the
      // handler uses for rooms 2..N of a reservation.
      doc: (docId?: string) =>
        createDocRef(`${collName}/${docId ?? `auto_${++autoDocSeq}`}`),
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

  const mockTransaction = {
    get: vi.fn().mockImplementation(async (ref: any) => {
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

const mockRequest = (body: any) => ({
  method: "POST",
  body,
  url: "/api/bookings/create-walkin",
  headers: { host: "localhost" },
  socket: { remoteAddress: "127.0.0.1" },
  staff: { uid: "staff_uid_1", email: "frontdesk@sparkinn.com", role: "front-desk" }
} as any);

const GUEST_DETAILS = {
  firstName: "Group",
  lastName: "Booker",
  email: "group@example.test",
  phone: "09171234567",
  consent: true
};

const seedFixtures = () => {
  mockRooms = {
    room_101: {
      isActive: true,
      status: "available",
      type: "standard-double",
      name: "Room 101 — Standard Double",
      roomNumber: "101"
    },
    room_102: {
      isActive: true,
      status: "available",
      type: "standard-double",
      name: "Room 102 — Standard Double",
      roomNumber: "102"
    },
    room_201: {
      isActive: true,
      status: "available",
      type: "family",
      name: "Room 201 — Family",
      roomNumber: "201"
    }
  };
  mockSettings = {
    breakfastConfig: { isEnabled: false, ratePerPersonPerNight: 0 },
    hotelConfig: {
      roomTypes: [
        {
          value: "standard-double",
          label: "Standard Double",
          maxCapacity: 2,
          maxChildren: 1,
          pricePerNight: 2000,
          weekendRate: 2000
        },
        {
          value: "family",
          label: "Family",
          maxCapacity: 4,
          maxChildren: 2,
          pricePerNight: 3500,
          weekendRate: 3500
        }
      ]
    }
  };
  mockBookings = [];
  mockCounters = {};
  setCalls = [];
  updateCalls = [];
  autoDocSeq = 0;
};

const bookingWrites = () => setCalls.filter((c) => c.path.startsWith("bookings/"));
const reservationWrite = () => setCalls.find((c) => c.path.startsWith("reservations/"));

// Tue → Thu: two weekday nights, no weekend rate in play, so every
// expected figure below is `pricePerNight * 2`.
const STAY = { checkIn: "2026-08-04", checkOut: "2026-08-06" };
const NIGHTS = 2;

describe("MRB-07 — multi-room walk-in creation", () => {
  beforeEach(() => {
    seedFixtures();
    vi.clearAllMocks();
  });

  test("creates one booking doc per room stay under a single reservation", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07A",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 1, numChildren: 0 },
        { roomId: "room_201", numAdults: 2, numChildren: 2 }
      ],
      ...STAY,
      guests: 7,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    expect(writes).toHaveLength(3);

    // The first room uses the client's preallocated booking id; the
    // other two auto-mint fresh ids.
    expect(writes[0].path).toBe("bookings/walkinMrb07A");

    // Each doc carries its own room and its own 1-indexed position,
    // and every doc agrees on the reservation-level room count.
    expect(writes.map((w) => w.data.roomId)).toEqual(["room_101", "room_102", "room_201"]);
    expect(writes.map((w) => w.data.roomNumber)).toEqual(["101", "102", "201"]);
    expect(writes.map((w) => w.data.reservationPosition)).toEqual([1, 2, 3]);
    expect(writes.every((w) => w.data.reservationRoomCount === 3)).toBe(true);

    // All three share one reservation.
    const reservationIds = new Set(writes.map((w) => w.data.reservationId));
    expect(reservationIds.size).toBe(1);
    expect(reservationWrite()).toBeTruthy();
    expect(reservationWrite()!.data.id).toBe([...reservationIds][0]);
  });

  test("each room stay gets a distinct guest-facing booking reference and lookup token", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07B",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    const refs = writes.map((w) => w.data.bookingRef);
    // A shared ref would make "booking ref + email" lookup ambiguous —
    // that contract assumes a ref identifies exactly one room stay.
    expect(new Set(refs).size).toBe(2);
    expect(refs.every((ref: string) => /^SI-\d{8}-\d{5}$/.test(ref))).toBe(true);
    // Consecutive sequence numbers off the shared daily counter.
    const sequences = refs.map((ref: string) => Number(ref.split("-")[2]));
    expect(sequences[1]).toBe(sequences[0] + 1);
    // The counter advances past every sequence the reservation used.
    const counterWrite = setCalls.find((c) => c.path.startsWith("counters/"));
    expect(counterWrite!.data.count).toBe(2);

    expect(new Set(writes.map((w) => w.data.lookupToken)).size).toBe(2);
  });

  test("prices each room stay against its own room type and its own occupancy", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07C",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_201", numAdults: 2, numChildren: 2 }
      ],
      ...STAY,
      guests: 6,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    // Standard Double at 2000/night and Family at 3500/night — each
    // room is priced by its own type, not by the primary room's.
    expect(writes[0].data.totalPrice).toBe(2000 * NIGHTS);
    expect(writes[1].data.totalPrice).toBe(3500 * NIGHTS);
    expect(writes[0].data.ratePerNight).toBe(2000);
    expect(writes[1].data.ratePerNight).toBe(3500);

    // Occupancy is distributed across the rooms, never duplicated onto
    // each of them.
    expect(writes.map((w) => w.data.numGuests)).toEqual([2, 4]);
    expect(writes.map((w) => w.data.numAdults)).toEqual([2, 2]);
    expect(writes.map((w) => w.data.numChildren)).toEqual([0, 2]);

    // The reservation total is exactly the sum of the room allocations.
    const reservation = reservationWrite()!.data;
    expect(reservation.totalPrice).toBe((2000 + 3500) * NIGHTS);
    expect(reservation.totalPrice).toBe(
      writes.reduce((sum, w) => sum + w.data.totalPrice, 0)
    );
    // Per BAR-02 (2026-08-08, per decision #203): the
    // 5 aggregate counter fields are no longer written
    // to the reservation header. The N=2 derivation is
    // `deriveReservationCounters(children).roomCount ===
    // 2` (covered in
    // `shared/__tests__/booking-folio.test.ts`).
    expect(reservation.roomCount).toBeUndefined();
    expect(reservation.activeRoomCount).toBeUndefined();
  });

  test("charges breakfast per guest across the reservation, not per guest per room", async () => {
    mockSettings.breakfastConfig = { isEnabled: true, ratePerPersonPerNight: 300 };
    const req = mockRequest({
      bookingId: "walkinMrb07D",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 1, numChildren: 0 }
      ],
      ...STAY,
      guests: 3,
      hasBreakfast: true,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // 3 guests × 300 × 2 nights = 1800 of breakfast across the
    // reservation. Charging per room would have produced 2 × (3 × 300 ×
    // 2) = 3600.
    const reservation = reservationWrite()!.data;
    expect(reservation.totalPrice).toBe(2000 * 2 * NIGHTS + 3 * 300 * NIGHTS);
  });

  test("applies a voucher once across the reservation and re-sums exactly", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07E",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed",
      // Senior discount is a percentage, so it applies per room; the
      // point of this case is that the per-room totals still re-sum to
      // the reservation figure with no rounding drift.
      discountType: "senior"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    const reservation = reservationWrite()!.data;
    expect(reservation.totalPrice).toBe(
      writes.reduce((sum, w) => sum + w.data.totalPrice, 0)
    );
    // 20% off each 4000 room stay.
    expect(writes.map((w) => w.data.totalPrice)).toEqual([3200, 3200]);
  });

  test("allocates a manual reservation-level override across the room stays", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07F",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_201", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed",
      totalPriceOverride: 10000
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    const allocations = writes.map((w) => w.data.totalPrice);
    // The override is a price for the whole reservation, split in
    // proportion to each stay's own subtotal (4000 and 7000 of 11000),
    // with the rounding remainder landing on the first room so the
    // allocations re-sum to the override exactly.
    expect(allocations.reduce((sum, n) => sum + n, 0)).toBe(10000);
    expect(reservationWrite()!.data.totalPrice).toBe(10000);
    expect(allocations[1]).toBe(Math.floor((10000 * 7000) / 11000));
  });

  test("occupies every room in the reservation on immediate check-in", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07G",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "checked-in"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const occupied = updateCalls.filter((c) => c.data?.status === "occupied");
    expect(occupied.map((c) => c.path).sort()).toEqual(["rooms/room_101", "rooms/room_102"]);
    // Per BAR-02 (2026-08-08, per decision #203): the
    // `checkedInRoomCount` is no longer written to the
    // reservation header. The N=2 check-in derivation is
    // `deriveReservationCounters(children).checkedInRoomCount
    // === 2` (covered in
    // `shared/__tests__/booking-folio.test.ts`).
    expect(reservationWrite()!.data.checkedInRoomCount).toBeUndefined();
  });

  test("aborts the whole reservation when any one room is unavailable", async () => {
    // Room 102 is already sold for an overlapping stay.
    mockBookings = [{
      id: "existing_1",
      roomId: "room_102",
      status: "confirmed",
      checkIn: new Date("2026-08-04T00:00:00Z"),
      checkOut: new Date("2026-08-06T00:00:00Z")
    }];

    const req = mockRequest({
      bookingId: "walkinMrb07H",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    // All-or-nothing: the available room must not be half-committed.
    expect(bookingWrites()).toHaveLength(0);
    expect(reservationWrite()).toBeUndefined();
  });

  test("rejects the same room twice inside one reservation", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07I",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_101", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 4,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/selected more than once/i);
    expect(bookingWrites()).toHaveLength(0);
  });

  test("rejects a reservation whose room occupancy disagrees with the guest total", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07J",
      roomId: "room_101",
      rooms: [
        { roomId: "room_101", numAdults: 2, numChildren: 0 },
        { roomId: "room_102", numAdults: 2, numChildren: 0 }
      ],
      ...STAY,
      guests: 5,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/Occupancy split mismatch/);
    expect(bookingWrites()).toHaveLength(0);
  });

  test("caps each room stay against its own room type", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07K",
      roomId: "room_201",
      rooms: [
        // The Family room legitimately holds 4; the Standard Double
        // does not, and must be rejected against its own cap rather
        // than measured against the primary room's.
        { roomId: "room_201", numAdults: 4, numChildren: 0 },
        { roomId: "room_101", numAdults: 4, numChildren: 0 }
      ],
      ...STAY,
      guests: 8,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/Not enough extra beds/);
    expect(bookingWrites()).toHaveLength(0);
  });

  test("single-room walk-in is unchanged when `rooms` is omitted", async () => {
    const req = mockRequest({
      bookingId: "walkinMrb07L",
      roomId: "room_101",
      ...STAY,
      guests: 2,
      numAdults: 2,
      numChildren: 0,
      hasBreakfast: false,
      guestDetails: GUEST_DETAILS,
      paymentMethod: "pay-at-hotel",
      status: "confirmed"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const writes = bookingWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("bookings/walkinMrb07L");
    expect(writes[0].data).toMatchObject({
      roomId: "room_101",
      numGuests: 2,
      totalPrice: 2000 * NIGHTS,
      reservationPosition: 1,
      reservationRoomCount: 1
    });
    const reservation = reservationWrite()!.data;
    // Per BAR-02 (2026-08-08, per decision #203): the
    // 5 aggregate counter fields are no longer written
    // to the reservation header. The N=1 derivation is
    // `deriveReservationCounters(children).roomCount ===
    // 1` (covered in
    // `shared/__tests__/booking-folio.test.ts`).
    expect(reservation.roomCount).toBeUndefined();
    expect(reservation.activeRoomCount).toBeUndefined();
    expect(reservation.totalPrice).toBe(2000 * NIGHTS);
  });
});
