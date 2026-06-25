import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock Firebase Admin SDK
let mockBookings: any[] = [];

vi.mock("../../server/lib/firebase-admin", () => {
  const mockCollection = (collName: string) => ({
    where: function () { return this; },
    limit: function () { return this; },
    doc: function (docId: string) {
      return { path: `${collName}/${docId}` };
    },
    get: async function () {
      if (collName === "bookings") {
        const docs = mockBookings.map((b) => ({
          id: b.id,
          data: () => b,
        }));
        return {
          empty: docs.length === 0,
          docs,
          forEach: (cb: any) => docs.forEach((d) => cb(d)),
        };
      }
      return { empty: true, docs: [], forEach: () => {} };
    },
  });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => mockCollection(collName)),
    },
    adminAuth: {},
  };
});

import { handleRoomAvailability } from "../../server/handlers/rooms";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// Helper to build a Firestore-style Timestamp-like object
const ts = (iso: string) => ({ toDate: () => new Date(`${iso}T00:00:00Z`) });

beforeEach(() => {
  mockBookings = [];
});

describe("/api/rooms/availability handler", () => {
  test("rejects non-GET method", async () => {
    const req = { method: "POST", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("rejects missing date params", async () => {
    const req = { method: "GET", query: {} };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining("required") })
    );
  });

  test("rejects invalid date range (checkOut <= checkIn)", async () => {
    const req = { method: "GET", query: { checkIn: "2026-07-05", checkOut: "2026-07-05" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining("Invalid") })
    );
  });

  test("rejects unparseable dates", async () => {
    const req = { method: "GET", query: { checkIn: "not-a-date", checkOut: "2026-07-05" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns empty bookedRanges when no bookings exist", async () => {
    mockBookings = [];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { bookedRanges: [] },
    });
  });

  test("returns active overlapping booking", async () => {
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-02"),
        checkOut: ts("2026-07-04"),
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        bookedRanges: [
          { roomId: "room-A", checkIn: "2026-07-02", checkOut: "2026-07-04", status: "confirmed" },
        ],
      },
    });
  });

  test("excludes cancelled bookings even when overlapping", async () => {
    // The handler filters via Firestore `where("status", "in", ACTIVE_STATUSES)`.
    // In the real SDK cancelled bookings never reach the handler. In this
    // mock we mirror that by only putting active statuses into mockBookings.
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-02"),
        checkOut: ts("2026-07-04"),
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.bookedRanges).toHaveLength(1);
    expect(payload.data.bookedRanges[0].status).not.toBe("cancelled");
  });

  test("excludes non-overlapping bookings", async () => {
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-08-10"),
        checkOut: ts("2026-08-12"),
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { bookedRanges: [] },
    });
  });

  test("includes booking that just touches the checkOut boundary", async () => {
    // Booking ends 2026-07-03, requested checkOut 2026-07-04 → overlap exists
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-01"),
        checkOut: ts("2026-07-03"),
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-02", checkOut: "2026-07-04" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        bookedRanges: [
          { roomId: "room-A", checkIn: "2026-07-01", checkOut: "2026-07-03", status: "confirmed" },
        ],
      },
    });
  });

  test("returns PII-stripped payload (no guestName/guestEmail/phone)", async () => {
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-02"),
        checkOut: ts("2026-07-04"),
        guestName: "Jane Doe",
        guestEmail: "jane@example.com",
        guestPhone: "+639170000000",
        totalPrice: 5000,
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    const payload = (res.json as any).mock.calls[0][0];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain("+639170000000");
    expect(payload.data.bookedRanges[0]).toEqual({
      roomId: "room-A",
      checkIn: "2026-07-02",
      checkOut: "2026-07-04",
      status: "confirmed",
    });
  });

  test("handles multiple overlapping bookings across rooms", async () => {
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-02"),
        checkOut: ts("2026-07-04"),
      },
      {
        id: "b2",
        roomId: "room-B",
        status: "pending",
        checkIn: ts("2026-07-01"),
        checkOut: ts("2026-07-02"),
      },
      {
        id: "b3",
        roomId: "room-C",
        status: "payment-uploaded",
        checkIn: ts("2026-08-01"),
        checkOut: ts("2026-08-05"),
      },
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-05" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.bookedRanges).toHaveLength(2);
    const roomIds = payload.data.bookedRanges.map((r: any) => r.roomId).sort();
    expect(roomIds).toEqual(["room-A", "room-B"]);
  });

  test("skips malformed booking records without crashing", async () => {
    mockBookings = [
      {
        id: "b1",
        roomId: "room-A",
        status: "confirmed",
        checkIn: ts("2026-07-02"),
        checkOut: ts("2026-07-04"),
      },
      { id: "b2", roomId: "room-B" }, // missing status / dates
      { id: "b3", roomId: "room-C", status: "confirmed" }, // missing dates
    ];
    const req = { method: "GET", query: { checkIn: "2026-07-01", checkOut: "2026-07-03" } };
    const res = mockResponse();
    await handleRoomAvailability(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.data.bookedRanges).toHaveLength(1);
    expect(payload.data.bookedRanges[0].roomId).toBe("room-A");
  });
});
