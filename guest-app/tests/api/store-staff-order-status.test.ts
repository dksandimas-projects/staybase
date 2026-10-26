import { beforeEach, describe, expect, test, vi } from "vitest";

// Per QA §3.7 (2026-10-26): the desk's store-order transitions are
// server-owned now.
//
// The bug these tests pin: the desk's actions used to be a raw
// client-side `updateDoc` on `storeOrders/{orderId}`, so the state
// machine existed only as UI buttons. A staff client could write ANY
// status onto ANY order — including cancelling a DELIVERED order whose
// direct payment had already been collected. The result was a cancelled
// order still holding a cash tender, and a reconciliation delta that
// never closed.
//
// These are behavioural: they call the real handler and assert on the
// writes it makes and the responses it returns. A source-regex test
// would not have caught the bug — the old code had no server handler to
// match.

const mockState = vi.hoisted(() => ({
  order: null as Record<string, any> | null,
  tender: null as Record<string, any> | null,
  itemStock: 5,
  writes: [] as Array<{ type: "set" | "update"; path: string; data: Record<string, any> }>
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const createDocRef = (path: string): any => ({
    path,
    id: path.split("/").at(-1),
    collection: (name: string) => ({
      doc: (id: string) => createDocRef(`${path}/${name}/${id}`)
    }),
    get: async () => ({ exists: false, data: () => undefined })
  });

  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => createDocRef(`${name}/${id}`)
      }),
      runTransaction: vi.fn(async (callback) => callback({
        get: vi.fn(async (ref: any) => {
          const path = ref.path;
          if (path === "storeOrders/order-1") {
            return { exists: !!mockState.order, data: () => mockState.order };
          }
          if (path === "storeOrders/order-1/payments/delivery-tender") {
            return { exists: !!mockState.tender, data: () => mockState.tender };
          }
          if (path.startsWith("storeItems/")) {
            return { exists: true, data: () => ({ stock: mockState.itemStock }) };
          }
          return { exists: false, data: () => undefined };
        }),
        set: vi.fn((ref, data) => mockState.writes.push({ type: "set", path: ref.path, data })),
        update: vi.fn((ref, data) => mockState.writes.push({ type: "update", path: ref.path, data }))
      }))
    }
  };
});

vi.mock("../../server/handlers/email", () => ({
  sendStoreOrderTrigger: vi.fn(async () => undefined),
  sendStaffRefundReviewTrigger: vi.fn(async () => undefined)
}));

import { handleStaffStoreOrderStatus } from "../../server/handlers/store";
import { sendStaffRefundReviewTrigger } from "../../server/handlers/email";

function mockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("handleStaffStoreOrderStatus (QA §3.7)", () => {
  beforeEach(() => {
    mockState.order = {
      orderRef: "SO-20261026-00001",
      bookingId: "booking-1",
      roomNumber: "101",
      guestName: "Test Guest",
      items: [{ itemId: "item-1", quantity: 2 }],
      totalAmount: 30,
      paymentMethod: "cod",
      paymentProofUrl: "",
      status: "confirmed",
      stockDecrementedAt: new Date("2026-10-26T00:00:00.000Z"),
      stockRestoredAt: null
    };
    mockState.tender = null;
    mockState.itemStock = 5;
    mockState.writes = [];
    vi.clearAllMocks();
  });

  test("REFUSES to cancel an order whose payment was already collected", async () => {
    // The order was delivered, so the tender exists.
    mockState.order!.status = "delivered";
    mockState.tender = { type: "payment", amount: 30, method: "cash" };

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    // Nothing may be written — the order must stay exactly as it was.
    expect(mockState.writes).toEqual([]);
  });

  test("refuses an illegal transition even when no tender was recorded", async () => {
    mockState.order!.status = "delivered";

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockState.writes).toEqual([]);
  });

  test("refuses to dispatch an order that was never confirmed", async () => {
    mockState.order!.status = "placed";

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "out-for-delivery" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockState.writes).toEqual([]);
  });

  test("cancels a confirmed order and gives the stock back exactly once", async () => {
    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      {
        method: "POST",
        body: { orderId: "order-1", status: "cancelled", cancellationReason: "Guest changed their mind" },
        staff: { uid: "staff-1" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockState.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "update",
        path: "storeOrders/order-1",
        data: expect.objectContaining({
          status: "cancelled",
          cancellationReason: "Guest changed their mind",
          handledBy: "staff-1"
        })
      }),
      // 5 in the shelf + the 2 the order took.
      expect.objectContaining({
        type: "update",
        path: "storeItems/item-1",
        data: expect.objectContaining({ stock: 7 })
      })
    ]));
  });

  test("does not give the stock back twice when the order was already restored", async () => {
    mockState.order!.stockRestoredAt = new Date("2026-10-26T01:00:00.000Z");

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockState.writes.filter((write) => write.path === "storeItems/item-1")).toEqual([]);
  });

  test("dispatches a confirmed order", async () => {
    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "out-for-delivery" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockState.writes).toEqual([
      expect.objectContaining({
        type: "update",
        path: "storeOrders/order-1",
        data: expect.objectContaining({ status: "out-for-delivery", handledBy: "staff-1" })
      })
    ]);
  });

  test("answers 404 for an order that does not exist", async () => {
    mockState.order = null;

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("opens a refund review when the desk cancels a PAID GCash order", async () => {
    // Per CRL-04: the guest has sent the money, and a cancellation
    // alone does not issue a refund — it needs an owner.
    mockState.order!.paymentMethod = "gcash";
    mockState.order!.paymentProofUrl = "https://example.test/proof.png";

    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendStaffRefundReviewTrigger).toHaveBeenCalledTimes(1);
  });

  test("does not open a refund review for a COD order (the money was never collected)", async () => {
    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "cancelled" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendStaffRefundReviewTrigger).not.toHaveBeenCalled();
  });

  test("rejects a status it does not own", async () => {
    const res = mockResponse();
    await handleStaffStoreOrderStatus(
      { method: "POST", body: { orderId: "order-1", status: "delivered" }, staff: { uid: "staff-1" } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockState.writes).toEqual([]);
  });
});
