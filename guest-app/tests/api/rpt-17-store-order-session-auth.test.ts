// Per RPT-17 / F08 (P2 security fix, 2026-10-22): the Spark
// Essentials `POST /api/store/create-order` route was UNAUTHENTICATED.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `guest-app/server/apiRouter.ts` → the `store` / `create-order`
// block had a rate limit and nothing else, and
// `guest-app/server/handlers/store.ts` → `handleCreateStoreOrder`
// validated the request BODY only (`roomId`, `roomNumber`,
// `guestName`, `items`, `paymentMethod`). Nothing tied the caller to
// the room, so any anonymous caller who knew a room number could
// place a minibar order in that guest's name — the hotel has to
// fulfil it and it lands in the guest's folio.
//
// THE CREDENTIAL
// --------------
// The guest already holds one: the intercom session capability token
// issued by `POST /api/intercom/verify-guest` and stored on the
// staff-only `intercoms/{roomNumber}.currentStayToken` (32 hex chars
// = 128 bits, stable for the stay, regenerated when the stay
// changes). It is the same credential `handleSendGuestMessage`
// re-verifies. The store order now requires it too:
//
//   - NO token                       → 401 (auth failure, not a 400)
//   - UNKNOWN token                  → 403
//   - token issued for ANOTHER room  → 403  ← the actual attack
//   - valid token for THIS room      → 200
//   - staff-authenticated create     → 200 (the desk creates on the
//                                     guest's behalf with a Firebase
//                                     ID token)
//
// This suite is behavioural — it drives the real `handleCreateStoreOrder`
// against an in-memory Firestore mock, so it FAILS against the
// pre-fix code (which accepted all of the unauthenticated orders) and
// passes after the fix.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  mockBookings,
  mockIntercoms,
  mockStoreItems,
  mockSettings,
  mockCounters,
  mockStoreOrders,
  sendTrigger
} = vi.hoisted(() => ({
  mockBookings: {} as Record<string, any>,
  mockIntercoms: {} as Record<string, any>,
  mockStoreItems: {} as Record<string, any>,
  mockSettings: {} as Record<string, any>,
  mockCounters: {} as Record<string, any>,
  mockStoreOrders: {} as Record<string, any>,
  sendTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendStoreOrderTrigger: sendTrigger,
  sendStaffRefundReviewTrigger: vi.fn().mockResolvedValue(undefined),
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined)
}));

// ── In-memory Firestore mock ─────────────────────────────────────
// Record collections are keyed by doc id; `where` filters are
// equality/`in` only, which is all the store handlers use.
vi.mock("../../server/lib/firebase-admin", () => {
  const buckets: Record<string, Record<string, any>> = {
    bookings: mockBookings,
    intercoms: mockIntercoms,
    storeItems: mockStoreItems,
    settings: mockSettings,
    counters: mockCounters,
    storeOrders: mockStoreOrders,
    notifications: {}
  };

  const bucket = (name: string) => {
    if (!buckets[name]) buckets[name] = {};
    return buckets[name];
  };

  const autoId = () => `auto_${Math.random().toString(36).slice(2, 12)}`;

  const docRef = (name: string, id: string) => ({
    id,
    path: `${name}/${id}`,
    get: async () => {
      const data = bucket(name)[id];
      return data ? { exists: true, id, data: () => data } : { exists: false, id };
    },
    set: async (data: any) => {
      bucket(name)[id] = data;
    },
    update: async (patch: any) => {
      const existing = bucket(name)[id];
      if (existing) Object.assign(existing, patch);
    }
  });

  const collection = (name: string) => {
    const filters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      where(field: string, op: string, value: any) {
        filters.push({ field, op, value });
        return chain;
      },
      limit() {
        return chain;
      },
      doc(id?: string) {
        return docRef(name, id || autoId());
      },
      async add(data: any) {
        const id = autoId();
        bucket(name)[id] = data;
        return { id };
      },
      async get() {
        const docs = Object.entries(bucket(name))
          .filter(([, data]: [string, any]) =>
            filters.every((f) => {
              const v = data[f.field];
              if (f.op === "==") return v === f.value;
              if (f.op === "in") return Array.isArray(f.value) && f.value.includes(v);
              return true;
            })
          )
          .map(([id, data]) => ({ id, ref: docRef(name, id), data: () => data }));
        return { empty: docs.length === 0, docs };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection,
      runTransaction: async (fn: any) => {
        const tx: any = {
          get: async (ref: any) => (ref && typeof ref.get === "function" ? ref.get() : ref),
          set: async (ref: any, data: any) => ref.set(data),
          update: async (ref: any, patch: any) => ref.update(patch)
        };
        return fn(tx);
      }
    },
    adminAuth: {}
  };
});

import { handleCreateStoreOrder } from "../../server/handlers/store";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const statusOf = (res: any) => (res.status as any).mock.calls[0][0] as number;
const bodyOf = (res: any) => (res.json as any).mock.calls[0][0] as any;

const ROOM = "101";
const OTHER_ROOM = "201";
const STAY_ID = "booking_101";
const OTHER_STAY_ID = "booking_201";
// 32 hex characters — the shape the server issues
// (`crypto.randomBytes(16)` → 128 bits of entropy).
const ROOM_TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER_ROOM_TOKEN = "fedcba9876543210fedcba9876543210";
const ITEM_ID = "item_water";

const guestBody = (overrides: Record<string, unknown> = {}) => ({
  roomId: ROOM,
  roomNumber: ROOM,
  guestName: "Maria Santos",
  items: [{ itemId: ITEM_ID, quantity: 2 }],
  paymentMethod: "cod",
  ...overrides
});

const orderDocs = () => Object.values(mockStoreOrders);

describe("RPT-17 / F08 — store create-order requires the guest's session credential", () => {
  beforeEach(() => {
    [
      mockBookings,
      mockIntercoms,
      mockStoreItems,
      mockSettings,
      mockCounters,
      mockStoreOrders
    ].forEach((bucket) => {
      Object.keys(bucket).forEach((key) => delete bucket[key]);
    });
    sendTrigger.mockClear();

    mockStoreItems[ITEM_ID] = { name: "Bottled Water", price: 50, isActive: true, stock: 100 };
    mockSettings["hotelConfig"] = {
      paymentMethods: [
        { method: "cod", label: "Cash on Delivery", isEnabled: true, showInStore: true },
        { method: "add-to-bill", label: "Add to Bill", isEnabled: true, showInStore: true }
      ]
    };
    mockSettings["storeConfig"] = { isEnabled: true };

    // Two checked-in stays, each with the capability token the server
    // issued for that room's current stay.
    mockBookings[STAY_ID] = {
      roomNumber: ROOM,
      status: "checked-in",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test"
    };
    mockBookings[OTHER_STAY_ID] = {
      roomNumber: OTHER_ROOM,
      status: "checked-in",
      guestName: "Ana Reyes",
      guestEmail: "ana@example.test"
    };
    mockIntercoms[ROOM] = {
      roomId: ROOM,
      roomNumber: ROOM,
      currentStayId: STAY_ID,
      currentStayToken: ROOM_TOKEN
    };
    mockIntercoms[OTHER_ROOM] = {
      roomId: OTHER_ROOM,
      roomNumber: OTHER_ROOM,
      currentStayId: OTHER_STAY_ID,
      currentStayToken: OTHER_ROOM_TOKEN
    };
  });

  test("rejects a create-order with NO session token (401, not a 400)", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder({ method: "POST", body: guestBody() } as any, res);

    expect(statusOf(res)).toBe(401);
    expect(bodyOf(res).success).toBe(false);
    expect(bodyOf(res).error).toMatch(/session/i);
    // A validation error would say "Missing required store order
    // fields." — the caller must be able to tell the two apart.
    expect(bodyOf(res).error).not.toMatch(/Missing required store order fields/i);
    expect(orderDocs()).toHaveLength(0);
    expect(sendTrigger).not.toHaveBeenCalled();
  });

  test("rejects a create-order with an UNKNOWN session token", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder(
      { method: "POST", body: guestBody({ sessionToken: "ffffffffffffffffffffffffffffffff" }) } as any,
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(bodyOf(res).success).toBe(false);
    expect(orderDocs()).toHaveLength(0);
    expect(sendTrigger).not.toHaveBeenCalled();
  });

  test("rejects a session token that was issued for ANOTHER room (the attack)", async () => {
    // A token for room 201, an order against room 102.
    const res = mockResponse();
    await handleCreateStoreOrder(
      { method: "POST", body: guestBody({ sessionToken: OTHER_ROOM_TOKEN }) } as any,
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(bodyOf(res).success).toBe(false);
    expect(orderDocs()).toHaveLength(0);
    expect(sendTrigger).not.toHaveBeenCalled();
  });

  test("rejects a valid token when the order claims a different room", async () => {
    // The mirror image of the attack: a genuine token for room 101,
    // but the order body claims room 201.
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: guestBody({ roomId: OTHER_ROOM, roomNumber: OTHER_ROOM, sessionToken: ROOM_TOKEN })
      } as any,
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(orderDocs()).toHaveLength(0);
  });

  test("accepts a create-order with a valid token for the right room", async () => {
    const res = mockResponse();
    await handleCreateStoreOrder(
      { method: "POST", body: guestBody({ sessionToken: ROOM_TOKEN }) } as any,
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(bodyOf(res).data.orderRef).toMatch(/^SO-\d{8}-\d{5}$/);
    // The order is bound to the stay the token was issued for.
    expect(bodyOf(res).data.bookingId).toBe(STAY_ID);
    expect(orderDocs()).toHaveLength(1);
    expect(orderDocs()[0].roomNumber).toBe(ROOM);
    expect(orderDocs()[0].bookingId).toBe(STAY_ID);
  });

  test("rejects a valid token whose stay is no longer active", async () => {
    // The guest checked out — the token must not keep working.
    mockBookings[STAY_ID].status = "checked-out";
    const res = mockResponse();
    await handleCreateStoreOrder(
      { method: "POST", body: guestBody({ sessionToken: ROOM_TOKEN }) } as any,
      res
    );

    expect(statusOf(res)).toBe(403);
    expect(orderDocs()).toHaveLength(0);
  });

  test("a staff-authenticated create still succeeds without a session token", async () => {
    // The front desk creates the order on the guest's behalf with a
    // Firebase ID token — the router sets `req.staff`.
    const res = mockResponse();
    await handleCreateStoreOrder(
      {
        method: "POST",
        body: guestBody(),
        staff: { uid: "staff_1", role: "front-desk" }
      } as any,
      res
    );

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).success).toBe(true);
    expect(orderDocs()).toHaveLength(1);
    expect(orderDocs()[0].bookingId).toBe(STAY_ID);
  });
});

// ── Source-text tripwires ─────────────────────────────────────────
// The behavioural tests above drive the HANDLER. These pin the two
// wiring halves that make the credential reachable end-to-end: the
// guest client sends the token, and the router still offers the
// staff path.
describe("RPT-17 / F08 — the credential is wired end-to-end", () => {
  const clientSrc = readFileSync(resolve(__dirname, "../../src/pages/IntercomPage.tsx"), "utf8");
  const routerSrc = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
  const handlerSrc = readFileSync(resolve(__dirname, "../../server/handlers/store.ts"), "utf8");

  test("the guest client sends the intercom session token with the store order", () => {
    const block = clientSrc.match(
      /fetch\("\/api\/store\/create-order"[\s\S]*?\n\s*\}\);/
    );
    expect(block, "expected to find the create-order fetch in IntercomPage").toBeTruthy();
    expect(block![0]).toMatch(/sessionToken/);
  });

  test("the router still offers the staff-authenticated create path", () => {
    const block = routerSrc.match(
      /domain === "store" && action === "create-order"[\s\S]*?handleCreateStoreOrder\(req, res\)/
    );
    expect(block, "expected to find the store create-order route block").toBeTruthy();
    expect(block![0]).toMatch(/authenticateStaff\(req\)/);
  });

  test("the handler verifies the token against the room's current stay", () => {
    // Slice the helper by index: the function signature spans several
    // lines (the params type), so a `\n}`-anchored regex would stop
    // inside the signature.
    const start = handlerSrc.indexOf("async function verifyStoreOrderSession");
    const end = handlerSrc.indexOf("\n}\n", start);
    const block = start >= 0 && end > start ? handlerSrc.slice(start, end + 3) : "";

    expect(block, "expected to find verifyStoreOrderSession").not.toBe("");
    expect(block).toMatch(/intercoms/);
    expect(block).toMatch(/currentStayToken/);
    expect(block).toMatch(/currentStayId/);
  });

  test("the handler never lets a missing token fall through to the transaction", () => {
    const block = handlerSrc.match(/export async function handleCreateStoreOrder[\s\S]*?\n\}/);
    expect(block, "expected to find handleCreateStoreOrder").toBeTruthy();
    expect(block![0]).toMatch(/status\(401\)/);
    expect(block![0]).toMatch(/verifyStoreOrderSession/);
  });
});
