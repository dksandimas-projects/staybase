import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, mockSettings, mockMembers, mockPointsHistory, mockWrites, sendBookingTrigger } = vi.hoisted(() => {
  const mockWrites: Array<{ type: string; path: string; data: any }> = [];
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    mockSettings: {} as Record<string, any>,
    mockMembers: {} as Record<string, any>,
    mockPointsHistory: [] as Array<{ id: string; data: any }>,
    mockWrites,
    sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger,
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

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
        else if (coll === "settings") store = mockSettings;
        else if (coll === "members") store = mockMembers;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      },
      collection: (sub: string) => ({
        doc: (subDocId?: string) => docRef(`${path}/${sub}/${subDocId || "auto_id"}`)
      }),
      update: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        } else if (coll === "rooms" && mockRooms[docId]) {
          Object.assign(mockRooms[docId], data);
        } else if (coll === "members" && mockMembers[docId]) {
          Object.assign(mockMembers[docId], data);
        }
        mockWrites.push({ type: "update", path, data });
      },
      set: async (data: any) => {
        if (coll === "members" && segments[1] && segments[2] === "pointsHistory") {
          mockPointsHistory.push({ id: "history_" + mockPointsHistory.length, data });
        }
        mockWrites.push({ type: "set", path, data });
      }
    };
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => {
        const chain: any = {
          _coll: collName,
          doc: (docId?: string) => docRef(`${collName}/${docId || "auto_id"}`),
          where: function (field: string, op: string, value: any) {
            return {
              ...this,
              _whereField: field,
              _whereOp: op,
              _whereValue: value,
              limit: function (n: number) {
                return {
                  ...this,
                  _limit: n,
                  get: async () => {
                    if (collName === "members") {
                      const docs = Object.entries(mockMembers)
                        .filter(([, data]) => {
                          if (op === "==") return data[field] === value;
                          return true;
                        })
                        .slice(0, n)
                        .map(([id, data]) => ({ id, data: () => data, exists: true }));
                      return { empty: docs.length === 0, docs };
                    }
                    return { empty: true, docs: [] };
                  }
                };
              },
              get: async () => {
                if (collName === "members") {
                  const docs = Object.entries(mockMembers)
                    .filter(([, data]) => {
                      if (op === "==") return data[field] === value;
                      return true;
                    })
                    .map(([id, data]) => ({ id, data: () => data, exists: true }));
                  return { empty: docs.length === 0, docs };
                }
                return { empty: true, docs: [] };
              }
            };
          },
          get: async function () {
            if (collName === "members") {
              const docs = Object.entries(mockMembers).map(([id, data]) => ({
                id,
                data: () => data,
                exists: true
              }));
              return { empty: docs.length === 0, docs };
            }
            return { empty: true, docs: [] };
          }
        };
        return chain;
      }),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref && typeof ref.get === "function") return ref.get();
            return { exists: false };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            const path = ref.path;
            const segments = path.split("/");
            const coll = segments[0];
            const docId = segments[1] || "";
            if (coll === "members" && segments[2] === "pointsHistory") {
              mockPointsHistory.push({ id: docId, data });
            } else if (coll === "bookings" && mockBookings[docId]) {
              Object.assign(mockBookings[docId], data);
            }
            mockWrites.push({ type: "set", path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            const path = ref.path;
            const segments = path.split("/");
            const coll = segments[0];
            const docId = segments[1] || "";
            if (coll === "bookings" && mockBookings[docId]) {
              Object.assign(mockBookings[docId], data);
            } else if (coll === "rooms" && mockRooms[docId]) {
              Object.assign(mockRooms[docId], data);
            } else if (coll === "members" && mockMembers[docId]) {
              Object.assign(mockMembers[docId], data);
            }
            mockWrites.push({ type: "update", path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import { handleCheckoutBooking } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staffReq = (overrides: Record<string, any> = {}) => ({
  method: "POST",
  staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
  body: { bookingId: "booking_1", ...overrides }
});

describe("/api/bookings/checkout", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockMembers).forEach((k) => delete mockMembers[k]);
    mockPointsHistory.length = 0;
    mockWrites.length = 0;
    sendBookingTrigger.mockClear();
  });

  test("rejects checkout from non-checked-in status", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      status: "confirmed",
      totalPrice: 5000,
      memberId: "member_1"
    };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining("checked-in")
    }));
  });

  test("checks out a non-member booking — status flips, room freed, no points", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      status: "checked-in",
      totalPrice: 5000,
      roomId: "room_101",
      memberId: null
    };
    mockRooms["room_101"] = { status: "occupied", housekeepingStatus: "clean" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].status).toBe("checked-out");
    expect(mockBookings["booking_1"].pointsAwarded).toBe(0);
    expect(mockRooms["room_101"].status).toBe("available");
    expect(mockRooms["room_101"].housekeepingStatus).toBe("dirty");
    expect(mockPointsHistory.length).toBe(0);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { status: "checked-out", pointsAwarded: 0, memberId: null }
    });
  });

  test("awards points to a member on checkout (per-spend mode)", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Alex Mercer",
      guestEmail: "member@sparkinn.com",
      status: "checked-in",
      totalPrice: 5000,
      roomId: "room_101",
      memberId: "member_1"
    };
    mockMembers["member_1"] = { rewardsPoints: 100, email: "member@sparkinn.com" };
    mockSettings["rewardsConfig"] = {
      pointsEnabled: true,
      earningMode: "per-spend",
      pointsPerHundred: 10,
      pointsPerBooking: 50
    };
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    // 5000 / 100 * 10 = 500 points
    expect(mockBookings["booking_1"].pointsAwarded).toBe(500);
    expect(mockMembers["member_1"].rewardsPoints).toBe(600); // 100 + 500
    expect(mockPointsHistory.length).toBe(1);
    expect(mockPointsHistory[0].data).toMatchObject({
      type: "earn",
      points: 500,
      bookingId: "booking_1",
      bookingRef: "SI-20260615-001"
    });
  });

  test("awards points to a member on checkout (per-booking mode)", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Alex Mercer",
      guestEmail: "member@sparkinn.com",
      status: "checked-in",
      totalPrice: 5000,
      roomId: "room_101",
      memberId: "member_1"
    };
    mockMembers["member_1"] = { rewardsPoints: 0 };
    mockSettings["rewardsConfig"] = {
      pointsEnabled: true,
      earningMode: "per-booking",
      pointsPerHundred: 10,
      pointsPerBooking: 50
    };
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].pointsAwarded).toBe(50);
    expect(mockMembers["member_1"].rewardsPoints).toBe(50);
  });

  test("does not award points when pointsEnabled is false", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Alex Mercer",
      guestEmail: "member@sparkinn.com",
      status: "checked-in",
      totalPrice: 5000,
      roomId: "room_101",
      memberId: "member_1"
    };
    mockMembers["member_1"] = { rewardsPoints: 100 };
    mockSettings["rewardsConfig"] = {
      pointsEnabled: false,
      pointsPerHundred: 10,
      pointsPerBooking: 50
    };
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].pointsAwarded).toBe(0);
    expect(mockMembers["member_1"].rewardsPoints).toBe(100);
    expect(mockPointsHistory.length).toBe(0);
  });

  test("returns 404 when booking does not exist", async () => {
    const res = mockResponse();
    await handleCheckoutBooking(staffReq({ bookingId: "missing" }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("returns 400 when bookingId is missing", async () => {
    const res = mockResponse();
    await handleCheckoutBooking(
      { method: "POST", staff: { uid: "staff_1", email: "x" }, body: {} },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("auto-links booking to member by email when memberId is missing on booking", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestName: "Alex Mercer",
      guestEmail: "alex@sparkinn.com",
      status: "checked-in",
      totalPrice: 2000,
      roomId: "room_101",
      memberId: null
    };
    mockMembers["member_1"] = { rewardsPoints: 0, email: "alex@sparkinn.com" };
    mockSettings["rewardsConfig"] = { pointsEnabled: true, earningMode: "per-spend", pointsPerHundred: 5 };
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].memberId).toBe("member_1");
    expect(mockMembers["member_1"].rewardsPoints).toBe(100);
  });
});
