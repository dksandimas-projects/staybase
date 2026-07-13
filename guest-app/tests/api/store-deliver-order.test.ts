import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  order: null as Record<string, any> | null,
  writes: [] as Array<{ type: "set" | "update"; path: string; data: Record<string, any> }>
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string): any => ({
    path,
    id: path.split("/").at(-1),
    collection: (name: string) => ({
      doc: (id: string) => createDocRef(`${path}/${name}/${id}`)
    })
  });

  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => createDocRef(`${name}/${id}`)
      }),
      runTransaction: vi.fn(async (callback) => callback({
        get: vi.fn(async () => ({
          exists: !!mockState.order,
          data: () => mockState.order
        })),
        set: vi.fn((ref, data) => mockState.writes.push({ type: "set", path: ref.path, data })),
        update: vi.fn((ref, data) => mockState.writes.push({ type: "update", path: ref.path, data }))
      }))
    }
  };
});

import { handleDeliverStoreOrder } from "../../server/handlers/store";

function mockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("handleDeliverStoreOrder", () => {
  beforeEach(() => {
    mockState.order = {
      orderRef: "SO-20260713-00001",
      bookingId: "booking-1",
      roomNumber: "202",
      guestName: "Test Guest",
      totalAmount: 450,
      paymentMethod: "cod",
      status: "out-for-delivery"
    };
    mockState.writes = [];
    vi.clearAllMocks();
  });

  test("atomically delivers a COD order and records a deterministic cash tender", async () => {
    const req = { method: "POST", body: { orderId: "order-1" }, staff: { uid: "staff-1" } };
    const res = mockResponse();

    await handleDeliverStoreOrder(req, res);

    expect(mockState.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "update",
        path: "storeOrders/order-1",
        data: expect.objectContaining({ status: "delivered", handledBy: "staff-1" })
      }),
      expect.objectContaining({
        type: "set",
        path: "storeOrders/order-1/payments/delivery-tender",
        data: expect.objectContaining({
          type: "payment",
          amount: 450,
          method: "cash",
          source: "store-order",
          sourceId: "order-1",
          orderRef: "SO-20260713-00001",
          recordedBy: "staff-1"
        })
      })
    ]));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("preserves a configured direct-payment method", async () => {
    mockState.order!.paymentMethod = "gcash";
    const res = mockResponse();

    await handleDeliverStoreOrder(
      { method: "POST", body: { orderId: "order-1" }, staff: { uid: "staff-1" } },
      res
    );

    const tender = mockState.writes.find((write) => write.type === "set");
    expect(tender?.data.method).toBe("gcash");
  });

  test("does not record a tender for Add to Bill", async () => {
    mockState.order!.paymentMethod = "add-to-bill";
    const res = mockResponse();

    await handleDeliverStoreOrder(
      { method: "POST", body: { orderId: "order-1" }, staff: { uid: "staff-1" } },
      res
    );

    expect(mockState.writes).toHaveLength(1);
    expect(mockState.writes[0].type).toBe("update");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { orderId: "order-1", status: "delivered", tenderRecorded: false }
    });
  });

  test("is idempotent when the order is already delivered", async () => {
    mockState.order!.status = "delivered";
    const res = mockResponse();

    await handleDeliverStoreOrder(
      { method: "POST", body: { orderId: "order-1" }, staff: { uid: "staff-1" } },
      res
    );

    expect(mockState.writes).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("rejects an order that is not out for delivery", async () => {
    mockState.order!.status = "confirmed";
    const res = mockResponse();

    await handleDeliverStoreOrder(
      { method: "POST", body: { orderId: "order-1" }, staff: { uid: "staff-1" } },
      res
    );

    expect(mockState.writes).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
