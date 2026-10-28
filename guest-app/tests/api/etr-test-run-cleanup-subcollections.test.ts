import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * ETR — the test-run cleanup must delete EVERY subcollection of the
 * records it removes.
 *
 * WHY THIS MATTERS
 * ---------------
 * Firestore does NOT delete a document's subcollection documents when
 * the parent document is deleted. The cleanup used to delete a FIXED
 * list of booking subcollections — `["payments", "charges"]` — and
 * `refunds` was not on it. Every QA booking cleanup therefore deleted
 * the booking and LEFT ITS REFUNDS BEHIND.
 *
 * Those orphans are money records with no booking under them, and they
 * are not inert: the desk dashboard counts pending refunds with
 * `collectionGroup(db, "refunds")`, so a tenant whose bookings had all
 * been cleaned up still showed "3 pending refunds" — with nothing to
 * refund. That was found on live production during the handover
 * cleanup: 8 orphaned refund documents and 2 orphaned store-order
 * tenders.
 *
 * A store order had the same shape of bug: its `payments` subcollection
 * (the delivery tender) was not in the list either.
 *
 * These tests use a FAKE document reference, so the behaviour is
 * exercised without a Firestore emulator. The fake deliberately offers
 * BOTH `listCollections()` and `collection(name)`, so the old fixed-list
 * implementation still RUNS against it — and still misses the refund.
 */

const { adminDb } = vi.hoisted(() => ({
  adminDb: { collection: vi.fn(), runTransaction: vi.fn() }
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb,
  adminAuth: {}
}));

import { deleteTestRunBookingSubcollections } from "../../server/handlers/test-runs";

/** A fake booking whose subcollections hold documents. */
function fakeBookingRef(subNames: string[]) {
  const deleted: string[] = [];

  const makeSub = (name: string) => ({
    id: name,
    get: async () => ({
      docs: [
        { id: `${name}-doc-1`, ref: { delete: async () => { deleted.push(`${name}/doc-1`); } } },
        { id: `${name}-doc-2`, ref: { delete: async () => { deleted.push(`${name}/doc-2`); } } }
      ]
    })
  });

  const subs = subNames.map(makeSub);

  return {
    deleted,
    // What the FIXED implementation calls.
    collection: (name: string) => {
      const found = subs.find((s) => s.id === name);
      if (!found) return { get: async () => ({ docs: [] }) };
      return { get: found.get };
    },
    // What the FIXED implementation calls now.
    listCollections: async () => subs
  };
}

describe("the test-run cleanup removes every subcollection", () => {
  beforeEach(() => {
    adminDb.collection.mockReset();
  });

  test("the refund subcollection is deleted with the booking", async () => {
    const ref = fakeBookingRef(["payments", "charges", "refunds"]);
    await deleteTestRunBookingSubcollections(ref as any);
    expect(ref.deleted).toContain("refunds/doc-1");
    expect(ref.deleted).toContain("refunds/doc-2");
  });

  test("payments and charges are still deleted", async () => {
    const ref = fakeBookingRef(["payments", "charges", "refunds"]);
    await deleteTestRunBookingSubcollections(ref as any);
    expect(ref.deleted).toContain("payments/doc-1");
    expect(ref.deleted).toContain("charges/doc-1");
  });

  test("a subcollection nobody listed is still deleted", async () => {
    // The whole point: a FUTURE subcollection must not need a code change.
    const ref = fakeBookingRef(["payments", "charges", "refunds", "adjustments"]);
    await deleteTestRunBookingSubcollections(ref as any);
    expect(ref.deleted).toContain("adjustments/doc-1");
  });

  test("every document of every subcollection is deleted", async () => {
    const ref = fakeBookingRef(["payments", "charges", "refunds"]);
    await deleteTestRunBookingSubcollections(ref as any);
    expect(ref.deleted.sort()).toEqual(
      [
        "charges/doc-1",
        "charges/doc-2",
        "payments/doc-1",
        "payments/doc-2",
        "refunds/doc-1",
        "refunds/doc-2"
      ].sort()
    );
  });

  test("a booking with no subcollections is not an error", async () => {
    const ref = fakeBookingRef([]);
    await expect(deleteTestRunBookingSubcollections(ref as any)).resolves.toBeUndefined();
    expect(ref.deleted).toEqual([]);
  });
});
