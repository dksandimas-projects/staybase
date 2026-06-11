import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  storeOrders: {} as Record<string, any>
}));

vi.mock("../lib/firebase-admin", () => {
  const createDocRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      path,
      get: async () => {
        if (coll === "storeOrders" && mockState.storeOrders[docId]) {
          return {
            exists: true,
            data: () => mockState.storeOrders[docId]
          };
        }
        return { exists: false };
      }
    };
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => ({
        doc: (docId: string) => createDocRef(`${collName}/${docId}`)
      }))
    }
  };
});

import { handleGetStoreOrderStatus } from "../handlers/store";

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
    vi.clearAllMocks();
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

  test.todo("decrements stock when an order is confirmed");
  test.todo("restores stock when an order is cancelled before confirmation");
  test.todo("allows unlimited stock items without decrementing");
});
