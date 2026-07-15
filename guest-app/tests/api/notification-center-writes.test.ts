import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per Phase 12 — Notification Center (decision #120): the
// server-side helper writes a `notifications` doc via the
// Admin SDK. We mock the Admin SDK and assert the doc shape
// (type, title, entityType, entityId, denormalized fields,
// readBy: {}, createdBy: "system", serverTimestamp()) so a
// refactor that drops one of the required fields fails this
// test.

let addCalls: any[] = [];

vi.mock("../../../guest-app/server/lib/firebase-admin", () => ({
  adminDb: {
    collection: (name: string) => {
      expect(name).toBe("notifications");
      return {
        add: async (data: any) => {
          addCalls.push(data);
          return { id: `mock_notif_${addCalls.length}` };
        }
      };
    }
  },
  adminAuth: {},
  adminStorage: {}
}));

import { writeNotification, pruneNotifications } from "../../../guest-app/server/lib/notifications";

describe("Phase 12 — Notification Center writeNotification (decision #120)", () => {
  beforeEach(() => {
    addCalls = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes a booking notification with the canonical shape", async () => {
    await writeNotification({
      type: "booking",
      title: "New booking — SI-20260715-00001 (Room 202)",
      entityType: "booking",
      entityId: "booking_abc",
      roomNumber: "202",
      bookingRef: "SI-20260715-00001"
    });
    expect(addCalls).toHaveLength(1);
    const doc = addCalls[0];
    expect(doc.type).toBe("booking");
    expect(doc.title).toBe("New booking — SI-20260715-00001 (Room 202)");
    expect(doc.entityType).toBe("booking");
    expect(doc.entityId).toBe("booking_abc");
    expect(doc.roomNumber).toBe("202");
    expect(doc.bookingRef).toBe("SI-20260715-00001");
    expect(doc.readBy).toEqual({});
    expect(doc.createdBy).toBe("system");
    // createdAt is a Firestore Timestamp.now() (callable).
    expect(typeof doc.createdAt).toBe("object");
  });

  it("trims + caps the title at 160 chars (Hard Rule: no PII leakage)", async () => {
    const long = "X".repeat(300);
    await writeNotification({
      type: "payment",
      title: long,
      entityType: "booking",
      entityId: "b1"
    });
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].title.length).toBe(160);
  });

  it("trims + caps the room number at 12 chars and ref at 40 chars", async () => {
    await writeNotification({
      type: "arrival",
      title: "Guest checked in",
      entityType: "booking",
      entityId: "b1",
      roomNumber: "X".repeat(50),
      bookingRef: "Y".repeat(80)
    });
    expect(addCalls[0].roomNumber.length).toBe(12);
    expect(addCalls[0].bookingRef.length).toBe(40);
  });

  it("skips the write when title is empty (defense in depth)", async () => {
    await writeNotification({
      type: "payment",
      title: "   ",
      entityType: "booking",
      entityId: "b1"
    });
    expect(addCalls).toHaveLength(0);
  });

  it("skips the write when entityId is empty (defense in depth)", async () => {
    await writeNotification({
      type: "payment",
      title: "Something happened",
      entityType: "booking",
      entityId: ""
    });
    expect(addCalls).toHaveLength(0);
  });

  it("swallows Admin SDK errors so the caller is never disrupted (best-effort)", async () => {
    // Reset the mock to throw.
    addCalls = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.doMock("../../../guest-app/server/lib/firebase-admin", () => ({
      adminDb: {
        collection: () => ({
          add: async () => { throw new Error("Firestore down"); }
        })
      },
      adminAuth: {},
      adminStorage: {}
    }));
    // Re-import with the throwing mock.
    const { writeNotification: throwingWrite } = await import(
      "../../../guest-app/server/lib/notifications?throwing"
    );
    await expect(
      throwingWrite({
        type: "booking",
        title: "Test",
        entityType: "booking",
        entityId: "b1"
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("writes a store-order notification with the right entityType", async () => {
    await writeNotification({
      type: "store-order",
      title: "New store order — SO-20260715-00001 (Room 202)",
      entityType: "storeOrder",
      entityId: "order_xyz",
      roomNumber: "202"
    });
    expect(addCalls[0].entityType).toBe("storeOrder");
    expect(addCalls[0].type).toBe("store-order");
    expect(addCalls[0].bookingRef).toBeNull();
  });
});

describe("Phase 12 — pruneNotifications (decision #120)", () => {
  it("queries with a bounded range filter and deletes the matched docs", async () => {
    const deleteCalls: string[] = [];
    const mockDocs = [
      { id: "n1", ref: { delete: async () => { deleteCalls.push("n1"); } } },
      { id: "n2", ref: { delete: async () => { deleteCalls.push("n2"); } } }
    ];
    vi.doMock("../../../guest-app/server/lib/firebase-admin", () => ({
      adminDb: {
        collection: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs: mockDocs })
              })
            })
          })
        })
      },
      adminAuth: {},
      adminStorage: {}
    }));
    const { pruneNotifications: prune } = await import(
      "../../../guest-app/server/lib/notifications?prune"
    );
    const result = await prune(30 * 24 * 60 * 60 * 1000);
    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(2);
    expect(deleteCalls.sort()).toEqual(["n1", "n2"]);
    expect(result.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns zero counts on an empty collection", async () => {
    vi.doMock("../../../guest-app/server/lib/firebase-admin", () => ({
      adminDb: {
        collection: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs: [] })
              })
            })
          })
        })
      },
      adminAuth: {},
      adminStorage: {}
    }));
    const { pruneNotifications: prune } = await import(
      "../../../guest-app/server/lib/notifications?prune2"
    );
    const result = await prune(30 * 24 * 60 * 60 * 1000);
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.deletedIds).toEqual([]);
  });
});
