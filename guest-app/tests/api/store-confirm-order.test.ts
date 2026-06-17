import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  storeOrders: {} as Record<string, any>,
  storeItems: {} as Record<string, any>,
  bookings: [] as any[],
  settings: {} as Record<string, any>,
  counters: {} as Record<string, any>,
  writes: [] as { type: string; path: string; data: any }[],
  newDocCounter: 0
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      path,
      id: docId,
      get: async () => {
        if (coll === "storeOrders" && mockState.storeOrders[docId]) {
          return {
            exists: true,
            id: docId,
            data: () => mockState.storeOrders[docId]
          };
        }
        if (coll === "storeItems" && mockState.storeItems[docId]) {
          return {
            exists: true,
            id: docId,
            data: () => mockState.storeItems[docId]
          };
        }
        if (coll === "settings" && mockState.settings[docId]) {
          return {
            exists: true,
            id: docId,
            data: () => mockState.settings[docId]
          };
        }
        if (coll === "counters" && mockState.counters[docId]) {
          return {
            exists: true,
            id: docId,
            data: () => mockState.counters[docId]
          };
        }
        return { exists: false };
      }
    };
  };

  const collection = vi.fn().mockImplementation((collName: string) => ({
    doc: (docId?: string) => createDocRef(`${collName}/${docId || `generated_${++mockState.newDocCounter}`}`),
    where: function (field: string, op: string, value: any) {
      return { ...this, field, op, value };
    },
    limit: function (count: number) {
      return { ...this, limitCount: count };
    }
  }));

  return {
    adminDb: {
      collection,
      runTransaction: vi.fn().mockImplementation(async (callback) => {
        await callback({
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.path) return ref.get();
            if (ref.limitCount === 1) {
              return {
                empty: mockState.bookings.length === 0,
                docs: mockState.bookings
              };
            }
            return { empty: true, docs: [] };
          }),
          set: vi.fn().mockImplementation((ref: any, data: any) => {
            mockState.writes.push({ type: "set", path: ref.path, data });
          }),
          update: vi.fn().mockImplementation((ref: any, data: any) => {
            mockState.writes.push({ type: "update", path: ref.path, data });
          })
        });
      })
    }
  };
});

import { handleCreateStoreOrder, handleGetStoreOrderStatus } from "../../server/handlers/store";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("/api/store/order-status", () => {
  beforeEach(() => {
    mockState.storeOrders = {
      "order_123": {
        orderRef: "SO-20260612-001",
        roomNumber: "202",
        status: "out-for-delivery",
        paymentProofUrl: "https://storage.example/payment-proof.png",
        notes: "Internal note",
        updatedAt: { toDate: () => new Date("2026-06-12T10:30:00.000Z") }
      }
    };
    mockState.storeItems = {
      "coffee": {
        name: "Cold Brew",
        price: 120,
        stock: 5,
        isActive: true
      },
      "tea": {
        name: "Hot Tea",
        price: 90,
        stock: null,
        isActive: true
      }
    };
    mockState.bookings = [{ id: "booking_123" }];
    mockState.settings = {
      storeConfig: {
        isEnabled: true,
        paymentMethods: [
          { method: "cod", isEnabled: true },
          { method: "gcash", isEnabled: true },
          { method: "add-to-bill", isEnabled: true }
        ]
      }
    };
    mockState.counters = {
      "store-orders-2026-06-15": { count: 4 }
    };
    mockState.writes = [];
    mockState.newDocCounter = 0;
    vi.clearAllMocks();
  });

  test("creates an order with deferred stock decrement and active booking lookup", async () => {
    // Per W2.12 / decision #80 (Batch 15): stock is decremented on
    // the placed -> confirmed transition (handled by
    // AdminContext.updateStoreOrderStatus), not at order creation.
    // The create handler now seeds the order doc with
    // stockDecrementedAt: null + status: "placed" and does not
    // touch storeItems at all.
    //
    // Also: the per-day counter key is computed from the Manila
    // timezone at call time, so the test derives it dynamically
    // from `new Date()` to match the handler.
    const d = new Date();
    const manilaStr = d.toLocaleString("en-US", { timeZone: "Asia/Manila" });
    const manilaDate = new Date(manilaStr);
    const todayStr = `${manilaDate.getFullYear()}-${String(manilaDate.getMonth() + 1).padStart(2, "0")}-${String(manilaDate.getDate()).padStart(2, "0")}`;

    // Seed today's counter so the handler takes the `update` path
    // (sequence goes from 4 to 5, matching the original intent).
    mockState.counters[`store-orders-${todayStr}`] = { count: 4 };
    const expectedRef = `SO-${todayStr.replace(/-/g, "")}-005`;

    const req = {
      method: "POST",
      body: {
        roomId: "room_202",
        roomNumber: "202",
        guestName: "Maria Santos",
        items: [
          { itemId: "coffee", quantity: 2 },
          { itemId: "tea", quantity: 1 }
        ],
        paymentMethod: "cod"
      }
    };
    const res = mockResponse();

    await handleCreateStoreOrder(req, res);

    expect(mockState.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "update",
        path: `counters/store-orders-${todayStr}`,
        data: { count: 5 }
      }),
      expect.objectContaining({
        type: "set",
        path: "storeOrders/generated_1",
        data: expect.objectContaining({
          orderRef: expectedRef,
          roomNumber: "202",
          bookingId: "booking_123",
          guestName: "Maria Santos",
          totalAmount: 330,
          paymentMethod: "cod",
          status: "placed",
          stockDecrementedAt: null
        })
      })
    ]));
    // No stock decrement at create time (deferred to confirmation).
    expect(mockState.writes.some((write) => write.path === "storeItems/coffee")).toBe(false);
    expect(mockState.writes.some((write) => write.path === "storeItems/tea")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        orderId: "generated_1",
        orderRef: expectedRef,
        totalAmount: 330,
        bookingId: "booking_123"
      })
    });
  });

  test("rejects create-order when stock is insufficient", async () => {
    mockState.storeItems.coffee.stock = 1;
    const req = {
      method: "POST",
      body: {
        roomId: "room_202",
        roomNumber: "202",
        guestName: "Maria Santos",
        items: [{ itemId: "coffee", quantity: 2 }],
        paymentMethod: "cod"
      }
    };
    const res = mockResponse();

    await handleCreateStoreOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "One of the selected items no longer has enough stock."
    });
  });

  test("returns only guest-safe status metadata for a matching order", async () => {
    const req = {
      method: "POST",
      body: {
        orderId: "order_123",
        roomNumber: "202",
        orderRef: "SO-20260612-001"
      }
    };
    const res = mockResponse();

    await handleGetStoreOrderStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        status: "out-for-delivery",
        updatedAt: "2026-06-12T10:30:00.000Z"
      }
    });
  });

  test("rejects order status lookup when the room does not match", async () => {
    const req = {
      method: "POST",
      body: {
        orderId: "order_123",
        roomNumber: "303",
        orderRef: "SO-20260612-001"
      }
    };
    const res = mockResponse();

    await handleGetStoreOrderStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "This order does not belong to this room."
    });
  });

  test("rejects missing order proof fields", async () => {
    const req = { method: "POST", body: { orderId: "order_123" } };
    const res = mockResponse();

    await handleGetStoreOrderStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Missing required order status fields."
    });
  });
});
