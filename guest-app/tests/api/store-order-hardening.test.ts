import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockStoreOrders, mockStoreItems, mockSettings, sendTrigger } = vi.hoisted(() => {
  const mockBookings: Record<string, any> = {};
  const mockStoreOrders: Record<string, any> = {};
  const mockStoreItems: Record<string, any> = {};
  const mockSettings: Record<string, any> = {};
  const sendTrigger = vi.fn().mockResolvedValue(undefined);
  return { mockBookings, mockStoreOrders, mockStoreItems, mockSettings, sendTrigger };
});

vi.mock("../../server/handlers/email", () => ({
  sendStoreOrderTrigger: sendTrigger,
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => {
      const store = collection === "bookings" ? mockBookings
        : collection === "storeOrders" ? mockStoreOrders
        : collection === "storeItems" ? mockStoreItems
        : collection === "settings" ? mockSettings
        : {};
      const data = store[id];
      return data
        ? { exists: true, id, data: () => data }
        : { exists: false };
    },
    set: (data: any) => {
      const store = collection === "bookings" ? mockBookings
        : collection === "storeOrders" ? mockStoreOrders
        : collection === "storeItems" ? mockStoreItems
        : collection === "settings" ? mockSettings
        : {};
      store[id] = data;
    },
    update: (patch: any) => {
      const store = collection === "storeOrders" ? mockStoreOrders
        : collection === "storeItems" ? mockStoreItems
        : collection === "settings" ? mockSettings
        : {};
      if (store[id]) Object.assign(store[id], patch);
    }
  });

  const collection = (collName: string) => {
    const chain: any = {
      _coll: collName,
      where: function (field: string, op: string, value: any) {
        chain._filters = chain._filters || [];
        chain._filters.push({ field, op, value });
        return chain;
      },
      limit: function () { return chain; },
      doc: function (id?: string) {
        return docRef(collName, id || `auto_${Math.random().toString(36).slice(2, 10)}`);
      },
      get: async function () {
        chain._filters = chain._filters || [];
        const store = collName === "bookings" ? mockBookings
          : collName === "storeOrders" ? mockStoreOrders
          : collName === "storeItems" ? mockStoreItems
          : collName === "settings" ? mockSettings
          : {};
        const docs = Object.entries(store)
          .filter(([, data]: [string, any]) =>
            chain._filters.every((f: any) => {
              const v = data[f.field];
              if (f.op === "==") return v === f.value;
              if (f.op === "in") return Array.isArray(f.value) && f.value.includes(v);
              if (f.op === "!=") return v !== f.value;
              return true;
            })
          )
          .map(([id, data]) => ({ id, ref: docRef(collName, id), data: () => data }));
        return { empty: docs.length === 0, docs };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation(collection),
      runTransaction: async (fn: any) => {
        // Minimal transaction surface used by the
        // store-order handlers: get / get-all / set /
        // update / commit.
        const tx: any = {
          get: async (ref: any) => ref.get(),
          getAll: async (refs: any[]) => Promise.all(refs.map((r: any) => r.get())),
          set: (ref: any, data: any) => ref.set(data),
          update: (ref: any, patch: any) => ref.update(patch)
        };
        return fn(tx);
      }
    },
    adminAuth: {}
  };
});

import { handleCreateStoreOrder, handleCancelStoreOrder, handleGetStoreOrderStatus } from "../../server/handlers/store";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const ITEM_ID = "item_water";
const ACTIVE_BOOKING_ID = "booking_active";

describe("handleCreateStoreOrder (H4)", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockStoreOrders).forEach((k) => delete mockStoreOrders[k]);
    Object.keys(mockStoreItems).forEach((k) => delete mockStoreItems[k]);
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k]);
    sendTrigger.mockClear();
    mockStoreItems[ITEM_ID] = { name: "Bottled Water", price: 50, isActive: true, stock: 100 };
    mockBookings[ACTIVE_BOOKING_ID] = {
      roomNumber: "101",
      status: "checked-in",
      guestEmail: "guest@example.test"
    };
    // Store checkout payment methods are sourced from
    // `settings/hotelConfig.paymentMethods[]` and filtered by
    // `showInStore`.
    mockSettings["hotelConfig"] = {
      paymentMethods: [
        { method: "cod", label: "Cash on Delivery", isEnabled: false, showInStore: true, showInCorporate: false, qrUrl: "", accountName: "", accountNumber: "" },
        { method: "add-to-bill", label: "Add to Bill", isEnabled: false, showInStore: true, showInCorporate: false, qrUrl: "", accountName: "", accountNumber: "" },
        { method: "gcash", label: "GCash", isEnabled: true, showInStore: true, showInCorporate: true, qrUrl: "", accountName: "", accountNumber: "" }
      ]
    };
    mockSettings["storeConfig"] = {
      isEnabled: true,
      lowStockThreshold: 5
    };
  });

  test("creates an order when the room has an active booking", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: {
          roomId: "room_101",
          roomNumber: "101",
          guestName: "Maria Santos",
          items: [{ itemId: ITEM_ID, quantity: 2 }],
          paymentMethod: "cod"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const json = (res.json as any).mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data.orderRef).toMatch(/^SO-\d{8}-\d{5}$/);
  });

  test("rejects orders when the room has no active booking (H4 S2)", async () => {
    mockBookings[ACTIVE_BOOKING_ID].status = "checked-out";
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: {
          roomId: "room_101",
          roomNumber: "101",
          guestName: "Maria Santos",
          items: [{ itemId: ITEM_ID, quantity: 1 }],
          paymentMethod: "cod"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/active reservation/i);
  });

  test("rejects oversized guestName (H4 S3)", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: {
          roomId: "room_101",
          roomNumber: "101",
          guestName: "x".repeat(200),
          items: [{ itemId: ITEM_ID, quantity: 1 }],
          paymentMethod: "cod"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("trims whitespace on guestName + roomNumber (H4 S3)", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: {
          roomId: "room_101",
          roomNumber: "  101  ",
          guestName: "  Maria Santos  ",
          items: [{ itemId: ITEM_ID, quantity: 1 }],
          paymentMethod: "cod"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("handleCancelStoreOrder (H4)", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockStoreOrders).forEach((k) => delete mockStoreOrders[k]);
    sendTrigger.mockClear();
    mockStoreItems[ITEM_ID] = { name: "Bottled Water", price: 50, isActive: true, stock: 100 };
    mockBookings[ACTIVE_BOOKING_ID] = {
      roomNumber: "101",
      status: "checked-in",
      guestEmail: "guest@example.test"
    };
    mockStoreOrders["order_abc"] = {
      orderRef: "SO-20260615-00001",
      roomId: "room_101",
      roomNumber: "101",
      bookingId: ACTIVE_BOOKING_ID,
      guestName: "Maria Santos",
      items: [{ itemId: ITEM_ID, quantity: 2 }],
      totalAmount: 100,
      paymentMethod: "cod",
      status: "placed",
      stockRestoredAt: null,
      stockDecrementedAt: new Date()
    };
  });

  test("cancels a placed order with the correct triple", async () => {
    const res = mockResponse();
    await handleCancelStoreOrder(
      {
        method: "POST",
        body: {
          orderId: "order_abc",
          roomNumber: "101",
          orderRef: "SO-20260615-00001",
          cancellationReason: "Wrong room"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreOrders["order_abc"].status).toBe("cancelled");
    expect(mockStoreOrders["order_abc"].cancellationReason).toBe("Wrong room");
  });

  test("trims roomNumber + orderRef before the compare (H4 S3)", async () => {
    const res = mockResponse();
    await handleCancelStoreOrder(
      {
        method: "POST",
        body: {
          orderId: "order_abc",
          roomNumber: "  101  ",
          orderRef: "  SO-20260615-00001  "
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("rejects an oversized cancellation reason (H4 S3)", async () => {
    const res = mockResponse();
    await handleCancelStoreOrder(
      {
        method: "POST",
        body: {
          orderId: "order_abc",
          roomNumber: "101",
          orderRef: "SO-20260615-00001",
          cancellationReason: "x".repeat(2000)
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    // The cap is 500; the stored value should be the
    // truncated form, not the 2000-char payload.
    expect(mockStoreOrders["order_abc"].cancellationReason.length).toBe(500);
  });

  test("reads the cancelled order by doc id (orderId), not orderRef (H4 bugfix)", async () => {
    // The previous code queried `doc(cancelledOrder.orderRef)`
    // — using the human-readable ref (e.g. `SO-20260615-00001`)
    // as the doc id, which is wrong. The re-read returned
    // `exists: false` and the email used a stale snapshot.
    const res = mockResponse();
    await handleCancelStoreOrder(
      {
        method: "POST",
        body: {
          orderId: "order_abc",
          roomNumber: "101",
          orderRef: "SO-20260615-00001"
        }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendTrigger).toHaveBeenCalledWith(
      "store-order-cancelled",
      expect.objectContaining({ orderId: "order_abc", orderRef: "SO-20260615-00001" })
    );
  });
});

describe("handleGetStoreOrderStatus (H4)", () => {
  beforeEach(() => {
    Object.keys(mockStoreOrders).forEach((k) => delete mockStoreOrders[k]);
    mockStoreOrders["order_abc"] = {
      orderRef: "SO-20260615-00001",
      roomNumber: "101",
      status: "out-for-delivery",
      updatedAt: { toDate: () => new Date("2026-06-16T10:00:00.000Z") }
    };
  });

  test("returns the current status with a valid triple", async () => {
    const res = mockResponse();
    await handleGetStoreOrderStatus(
      {
        method: "POST",
        body: { orderId: "order_abc", roomNumber: "101", orderRef: "SO-20260615-00001" }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const json = (res.json as any).mock.calls[0][0];
    expect(json.data.status).toBe("out-for-delivery");
    expect(json.data.updatedAt).toBe("2026-06-16T10:00:00.000Z");
  });

  test("returns 403 on a wrong room number", async () => {
    const res = mockResponse();
    await handleGetStoreOrderStatus(
      {
        method: "POST",
        body: { orderId: "order_abc", roomNumber: "999", orderRef: "SO-20260615-00001" }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("trims whitespace on roomNumber + orderRef (H4 S3)", async () => {
    const res = mockResponse();
    await handleGetStoreOrderStatus(
      {
        method: "POST",
        body: { orderId: "order_abc", roomNumber: "  101  ", orderRef: "  SO-20260615-00001  " }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("returns 404 when the order does not exist", async () => {
    const res = mockResponse();
    await handleGetStoreOrderStatus(
      {
        method: "POST",
        body: { orderId: "missing", roomNumber: "101", orderRef: "SO-20260615-00001" }
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
