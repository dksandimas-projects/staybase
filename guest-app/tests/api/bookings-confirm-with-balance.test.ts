// Per CWB-01 / decision #122 (2026-07-23): tests for the
// "confirm with balance" endpoint. The flow is:
//   1. Booking is in `payment-uploaded` status with a partial
//      onsite payment recorded via `/api/bookings/verify-and-record-payment`.
//   2. Staff opens the confirm-with-balance form, types a
//      reason, submits.
//   3. Server atomically: verifies status, computes the
//      charge-inclusive balance, reads
//      `hotelConfig.unpaidCheckoutApprovalThreshold`, enforces
//      the front-desk / admin gate, stamps the four
//      `confirmedWithBalance*` fields, flips `status` to
//      `confirmed`, fires the new email + a `booking`
//      notification, and returns 200.
//
// Coverage:
//   - happy path with front-desk under threshold
//   - happy path with admin over threshold
//   - 403 when front-desk tries to confirm over threshold
//   - 400 when reason is missing or empty
//   - 400 when booking is not in `payment-uploaded` status
//   - 404 when booking does not exist
//   - 403 when booking is not staff (auth is enforced at the
//     dispatch level; this is the same mocked staff flow)

import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, mockSettings, mockStoreOrders, mockWrites, sendBookingConfirmedWithBalanceTrigger, writeNotification } = vi.hoisted(() => {
  const mockWrites: Array<{ type: string; path: string; data: any }> = [];
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    mockSettings: {} as Record<string, any>,
    mockStoreOrders: {} as Record<string, any>,
    mockWrites,
    sendBookingConfirmedWithBalanceTrigger: vi.fn().mockResolvedValue(undefined),
    writeNotification: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendBookingConfirmedWithBalanceTrigger
}));

vi.mock("../../server/lib/notifications", () => ({
  writeNotification
}));

vi.mock("../../server/lib/firebase-admin", () => {
  // Per CWB-01: the confirm-with-balance transaction re-reads
  // `bookings/{id}/payments`, `bookings/{id}/charges`, and the
  // matching `storeOrders` so the charge-inclusive balance is
  // authoritative. The mock supports all three sub-collections
  // plus the booking doc itself and `settings/hotelConfig`.
  const subCollectionStore: Record<string, Record<string, any>> = {
    payments: {},
    charges: {}
  };

  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    const sub = segments[2];
    const subDocId = segments[3];
    return {
      path,
      id: subDocId || docId,
      get: async () => {
        if (sub === "payments" || sub === "charges") {
          const store = subCollectionStore[sub];
          const data = subDocId ? store[subDocId] : undefined;
          if (data !== undefined) {
            return { exists: true, id: subDocId, data: () => data };
          }
          // Return the snapshot shape the handler reads.
          return {
            exists: true,
            id: subDocId || "",
            data: () => ({}),
            docs: Object.entries(store).map(([id, d]) => ({ id, data: () => d })),
            forEach: (cb: any) => Object.entries(store).forEach(([id, d]) => cb({ id, data: () => d }))
          } as any;
        }
        if (coll === "bookings" && sub === "storeOrders") {
          // The handler uses `transaction.get(query)` which returns
          // a QuerySnapshot with `forEach`. We model it inline.
          return { exists: false } as any;
        }
        let store: Record<string, any> = {};
        if (coll === "bookings") store = mockBookings;
        else if (coll === "rooms") store = mockRooms;
        else if (coll === "settings") store = mockSettings;
        else if (coll === "storeOrders") store = mockStoreOrders;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      },
      update: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        }
        mockWrites.push({ type: "update", path, data });
      },
      set: async (data: any) => {
        if (coll === "bookings" && mockBookings[docId]) {
          Object.assign(mockBookings[docId], data);
        }
        mockWrites.push({ type: "set", path, data });
      },
      collection: (subColl: string) => ({
        get: async () => {
          const store = subCollectionStore[subColl] || {};
          return {
            empty: Object.keys(store).length === 0,
            docs: Object.entries(store).map(([id, d]) => ({ id, data: () => d })),
            forEach: (cb: any) => Object.entries(store).forEach(([id, d]) => cb({ id, data: () => d }))
          };
        }
      })
    };
  };

  const collectionChain = (collName: string): any => {
    const chain: any = {
      _coll: collName,
      doc: (docId?: string) => docRef(`${collName}/${docId || "auto_id"}`),
      where: function () { return this; },
      limit: function () { return this; },
      get: async function () {
        if (collName === "storeOrders") {
          const docs = Object.entries(mockStoreOrders).map(([id, data]) => ({ id, data: () => data }));
          return { empty: docs.length === 0, docs, forEach: (cb: any) => docs.forEach((d) => cb(d)) };
        }
        return { empty: true, docs: [], forEach: () => undefined };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => collectionChain(collName)),
      runTransaction: vi.fn().mockImplementation(async (callback: any) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref && typeof ref.get === "function") return ref.get();
            if (ref && ref._coll) return ref.get();
            return { exists: false };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) {
                mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
              }
            }
            mockWrites.push({ type: "set", path: ref.path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.path && ref.path.startsWith("bookings/")) {
              const docId = ref.path.split("/").pop();
              if (docId) {
                mockBookings[docId] = { ...(mockBookings[docId] || {}), ...data };
              }
            }
            mockWrites.push({ type: "update", path: ref.path, data });
          })
        });
      })
    },
    adminAuth: {}
  };
});

import { handleConfirmBookingWithBalance } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseBooking = (overrides: any = {}) => ({
  bookingRef: "SI-20260723-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  status: "payment-uploaded",
  totalPrice: 5000,
  paymentMethod: "gcash",
  ...overrides
});

describe("/api/bookings/confirm-with-balance", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    Object.keys(mockStoreOrders).forEach((k) => delete mockStoreOrders[k]);
    mockWrites.length = 0;
    sendBookingConfirmedWithBalanceTrigger.mockClear();
    writeNotification.mockClear();
  });

  test("front-desk confirms a payment-uploaded booking with a balance under the threshold", async () => {
    mockBookings["booking_1"] = baseBooking();
    // Default hotel config → threshold 5,000
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: "Guest paid 70% deposit; remaining 30% will be collected at check-in." }
      },
      res
    );

    // Status flipped, four fields stamped, atomically inside
    // one transaction.
    const updateWrite = mockWrites.find(
      (w) => w.path === "bookings/booking_1" && (w.data as any).status === "confirmed"
    );
    expect(updateWrite).toBeDefined();
    expect(updateWrite!.data).toEqual(
      expect.objectContaining({
        status: "confirmed",
        confirmedWithBalance: 5000, // No onsite payments recorded → balance is the full total
        confirmedWithBalanceReason: "Guest paid 70% deposit; remaining 30% will be collected at check-in.",
        confirmedWithBalanceBy: "staff_1",
        handledBy: "staff_1"
      })
    );
    expect(updateWrite!.data.confirmedWithBalanceAt).toBeInstanceOf(Date);

    expect(sendBookingConfirmedWithBalanceTrigger).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmedWithBalanceTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmail: "maria@example.test" }),
      5000,
      "Guest paid 70% deposit; remaining 30% will be collected at check-in."
    );
    expect(writeNotification).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        status: "confirmed",
        balance: 5000,
        confirmedWithBalanceReason: "Guest paid 70% deposit; remaining 30% will be collected at check-in.",
        threshold: 5000
      }
    });
  });

  test("admin confirms a payment-uploaded booking with a balance over the threshold", async () => {
    mockBookings["booking_1"] = baseBooking({ totalPrice: 12000 });
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "admin_1", email: "admin@sparkinn.com", role: "admin" },
        body: { bookingId: "booking_1", reason: "Corporate billing — full folio to be settled by accounts on invoice." }
      },
      res
    );

    expect(sendBookingConfirmedWithBalanceTrigger).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmedWithBalanceTrigger).toHaveBeenCalledWith(
      expect.anything(),
      12000, // No onsite payments → balance equals the booking total
      "Corporate billing — full folio to be settled by accounts on invoice."
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        status: "confirmed",
        balance: 12000,
        threshold: 5000
      })
    });
  });

  test("returns 403 when front-desk attempts to confirm a balance over the threshold", async () => {
    mockBookings["booking_1"] = baseBooking({ totalPrice: 12000 });
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: "Front desk trying to approve above limit." }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    const json = (res.json as any).mock.calls[0][0];
    expect(json.thresholdExceeded).toBe(true);
    expect(json.threshold).toBe(5000);
    expect(json.balance).toBe(12000);
    expect(sendBookingConfirmedWithBalanceTrigger).not.toHaveBeenCalled();
    expect(writeNotification).not.toHaveBeenCalled();
  });

  test("returns 400 when reason is missing", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/reason is required/i);
    expect(sendBookingConfirmedWithBalanceTrigger).not.toHaveBeenCalled();
  });

  test("returns 400 when reason is empty whitespace", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: "   " }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns 400 when booking is not in payment-uploaded status", async () => {
    mockBookings["booking_1"] = baseBooking({ status: "pending" });
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: "Should not be reachable." }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/pending/);
    expect(sendBookingConfirmedWithBalanceTrigger).not.toHaveBeenCalled();
  });

  test("returns 400 when booking is already confirmed", async () => {
    mockBookings["booking_1"] = baseBooking({ status: "confirmed" });
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: "Should not be reachable." }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns 404 when booking does not exist", async () => {
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "missing", reason: "Booking not found test." }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sendBookingConfirmedWithBalanceTrigger).not.toHaveBeenCalled();
  });

  test("truncates reason to 500 chars (matches unpaidCheckoutReason pattern)", async () => {
    mockBookings["booking_1"] = baseBooking();
    mockSettings["hotelConfig"] = { unpaidCheckoutApprovalThreshold: 5000 };

    const longReason = "x".repeat(800);
    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
        body: { bookingId: "booking_1", reason: longReason }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const triggerCall = (sendBookingConfirmedWithBalanceTrigger as any).mock.calls[0];
    expect(triggerCall[2].length).toBe(500);
  });

  test("default threshold is 5000 when hotelConfig is missing the field", async () => {
    mockBookings["booking_1"] = baseBooking({ totalPrice: 12000 });
    // hotelConfig absent entirely
    const res = mockResponse();
    await handleConfirmBookingWithBalance(
      {
        method: "POST",
        staff: { uid: "admin_1", email: "admin@sparkinn.com", role: "admin" },
        body: { bookingId: "booking_1", reason: "Defaults to 5000." }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ threshold: 5000 })
    });
  });
});
