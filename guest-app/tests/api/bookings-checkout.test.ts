import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, mockSettings, mockMembers, mockPayments, mockCharges, mockStoreOrders, mockPointsHistory, mockWrites, sendBookingTrigger } = vi.hoisted(() => {
  const mockWrites: Array<{ type: string; path: string; data: any }> = [];
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    mockSettings: {} as Record<string, any>,
    mockMembers: {} as Record<string, any>,
    mockPayments: [] as Array<{ amount: number }>,
    mockCharges: [] as Array<{ amount: number }>,
    mockStoreOrders: [] as Array<Record<string, any>>,
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
        path: `${path}/${sub}`,
        doc: (subDocId?: string) => docRef(`${path}/${sub}/${subDocId || "auto_id"}`),
        get: async () => ({
          docs: (sub === "payments" ? mockPayments : sub === "charges" ? mockCharges : []).map((data, index) => ({
            id: `${sub}_${index + 1}`,
            data: () => data
          }))
        })
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
                    if (collName === "storeOrders") {
                      const docs = mockStoreOrders
                        .filter((data) => op !== "==" || data[field] === value)
                        .slice(0, n)
                        .map((data, index) => ({ id: data.id || `order_${index + 1}`, data: () => data, exists: true }));
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
                if (collName === "storeOrders") {
                  const docs = mockStoreOrders
                    .filter((data) => op !== "==" || data[field] === value)
                    .map((data, index) => ({ id: data.id || `order_${index + 1}`, data: () => data, exists: true }));
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
    mockPayments.length = 0;
    mockCharges.length = 0;
    mockStoreOrders.length = 0;
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
      data: { status: "checked-out", pointsAwarded: 0, memberId: null, checkedOutWithBalance: 5000 }
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
    mockPayments.push({ amount: 5000 });

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
    mockPayments.push({ amount: 5000 });

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
    mockPayments.push({ amount: 2000 });

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
    mockPayments.push({ amount: 2000 });

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBookings["booking_1"].memberId).toBe("member_1");
    expect(mockMembers["member_1"].rewardsPoints).toBe(100);
  });

  test("defers points and stamps the charge-inclusive balance when checkout is unpaid", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260615-001",
      guestEmail: "member@sparkinn.com",
      status: "checked-in",
      totalPrice: 5000,
      roomId: "room_101",
      memberId: "member_1"
    };
    mockMembers["member_1"] = { rewardsPoints: 100 };
    mockSettings["rewardsConfig"] = { pointsEnabled: true, earningMode: "per-spend", pointsPerHundred: 10 };
    mockPayments.push({ amount: 2000 });
    mockCharges.push({ amount: 500 });
    mockStoreOrders.push({ bookingId: "booking_1", paymentMethod: "add-to-bill", status: "delivered", isBilled: true, totalAmount: 300 });
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(mockBookings["booking_1"]).toEqual(expect.objectContaining({
      checkedOutFolioTotal: 5800,
      checkedOutCollectedTotal: 2000,
      checkedOutWithBalance: 3800,
      pointsAwarded: 0,
      pendingLoyaltyPoints: 500,
      loyaltyAwardStatus: "pending-payment"
    }));
    expect(mockMembers["member_1"].rewardsPoints).toBe(100);
    expect(mockPointsHistory).toHaveLength(0);
  });

  test("rebuilds an early-checkout breakdown with an explicit retained-total line", async () => {
    mockBookings["booking_1"] = {
      bookingRef: "SI-20260710-001",
      status: "checked-in",
      totalPrice: 7500,
      ratePerNight: 2500,
      numNights: 3,
      checkIn: new Date("2026-07-11T00:00:00Z"),
      checkOut: new Date("2026-07-20T00:00:00Z"),
      roomId: "room_101",
      memberId: null,
      rateBreakdown: {
        roomSubtotal: 7500,
        roomLines: [{ source: "regular", label: "Regular rate", startDate: "2026-07-11", endDate: "2026-07-14", nights: 3, nightlyRate: 2500, subtotal: 7500 }],
        addOns: [], deductions: [], finalTotal: 7500
      }
    };
    mockPayments.push({ amount: 7500 });
    mockRooms["room_101"] = { status: "occupied" };

    const res = mockResponse();
    await handleCheckoutBooking(staffReq(), res);

    expect(mockBookings["booking_1"].earlyCheckoutOriginalCheckOut).toBeDefined();
    expect(mockBookings["booking_1"].rateBreakdown.addOns).toContainEqual(expect.objectContaining({
      label: "Early departure — original total retained"
    }));
    expect(mockBookings["booking_1"].rateBreakdown.finalTotal).toBe(7500);
  });
});
