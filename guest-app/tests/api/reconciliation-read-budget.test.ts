// The nightly reconciliation must do a BOUNDED number of Firestore
// round trips — no matter how many bookings the hotel has.
//
// WHY THIS EXISTS
// ---------------
// On 2026-10-28 the audit found the standing money check had NEVER
// run in production. The `reconciliationRuns` collection held ZERO
// documents, and the live endpoint died with
// `FUNCTION_INVOCATION_TIMEOUT` after 301 seconds.
//
// The cause was the read pattern, not the arithmetic: the reconciler
// read each booking's ledger with up to FOUR sequential round trips,
// read it AGAIN for the I07 cross-check, and re-read the ENTIRE
// `storeOrders` collection once per booking. With 157 bookings that is
// roughly 1,250 SEQUENTIAL round trips.
//
// The fix reads every payment, every refund and every store order in
// three bulk reads and groups them in memory, so the round-trip count
// is O(1) in the number of bookings.
//
// WHAT THIS TEST PINS
// -------------------
// The read count must NOT grow with the booking count. That invariant
// is the thing that stops the nightly check from silently timing out
// again as the hotel's data grows — and it is invisible to a normal
// test, because a slow-but-correct reconciler still passes every
// assertion about the money.

import { describe, it, expect, beforeEach, vi } from "vitest";

let readCount = 0;

interface FakeDoc {
  id: string;
  path: string;
  ref: { path: string; parent: { parent: { path: string } } };
  data: () => any;
}

function makeDoc(path: string, data: any): FakeDoc {
  const parts = path.split("/");
  const parentPath = parts.slice(0, 2).join("/");
  return {
    id: parts[parts.length - 1],
    path,
    ref: { path, parent: { parent: { path: parentPath } } },
    data: () => data
  };
}

function makeSnapshot(docs: FakeDoc[]) {
  return { docs, size: docs.length, empty: docs.length === 0 };
}

/**
 * A Firestore stand-in that counts every read and serves a dataset
 * that grows with the booking count.
 */
function makeFakeDb(bookingCount: number) {
  const bookings: FakeDoc[] = [];
  const payments: FakeDoc[] = [];
  const refunds: FakeDoc[] = [];

  for (let i = 0; i < bookingCount; i += 1) {
    const id = `booking-${i}`;
    bookings.push(
      makeDoc(`bookings/${id}`, {
        bookingRef: `SI-${String(i).padStart(6, "0")}`,
        status: i % 3 === 0 ? "cancelled" : "confirmed",
        totalPrice: 2000,
        paidAmount: 2000,
        isTestData: i % 2 === 0
      })
    );
    payments.push(makeDoc(`bookings/${id}/payments/p1`, { amount: 2000, type: "payment", status: "confirmed" }));
    if (i % 3 === 0) {
      // A cancelled booking that still holds money — the I14 case.
      refunds.push(makeDoc(`bookings/${id}/refunds/r1`, { amount: -100, type: "refund", status: "confirmed" }));
    }
  }

  const snapshotFor = (name: string) => {
    if (name === "bookings") return makeSnapshot(bookings);
    if (name === "payments") return makeSnapshot(payments);
    if (name === "refunds") return makeSnapshot(refunds);
    if (name === "storeOrders") return makeSnapshot([]);
    return makeSnapshot([]);
  };

  return {
    collection(name: string) {
      return {
        async get() {
          readCount += 1;
          return snapshotFor(name);
        },
        doc(id: string) {
          return {
            id,
            // The reconciler reads the hotel's cancellation-policy
            // settings (websiteContent + hotelConfig) once.
            async get() {
              readCount += 1;
              return {
                id,
                exists: true,
                data: () => ({}),
                ref: { path: `settings/${id}`, parent: { parent: { path: "settings" } } }
              };
            },
            collection: () => ({
              async get() {
                readCount += 1;
                return makeSnapshot([]);
              }
            })
          };
        }
      };
    },
    collectionGroup(name: string) {
      return {
        async get() {
          readCount += 1;
          return snapshotFor(name);
        }
      };
    }
  };
}

let currentDb: any = makeFakeDb(10);

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    get collection() {
      return currentDb.collection;
    },
    get collectionGroup() {
      return currentDb.collectionGroup;
    }
  },
  adminAuth: {},
  adminStorage: {}
}));

async function runWith(bookingCount: number) {
  currentDb = makeFakeDb(bookingCount);
  readCount = 0;
  const { runReconciliation } = await import("../../server/lib/reconciliation");
  const result = await runReconciliation();
  return { result, reads: readCount };
}

describe("the nightly reconciliation's Firestore read budget", () => {
  beforeEach(() => {
    vi.resetModules();
    readCount = 0;
  });

  it("reads a BOUNDED number of times, not one set per booking", async () => {
    const { reads } = await runWith(40);
    // The four bulk reads: bookings, payments, refunds, storeOrders.
    expect(reads).toBeLessThanOrEqual(10);
  });

  it("does NOT grow its read count as the hotel's data grows", async () => {
    const small = await runWith(5);
    const large = await runWith(500);
    expect(large.reads).toBe(small.reads);
  });

  it("still finds every money problem in a large dataset", async () => {
    const { result } = await runWith(500);
    const i14 = result.findings.find((f) => f.id === "I14");
    expect(i14).toBeDefined();
    // Every third booking is cancelled holding money. The fake bookings
    // carry no cancellation stamp, so the policy cannot be applied and
    // the check reports that closure could not be confirmed.
    expect(i14!.status).toBe("WARN");
    expect(i14!.summary).toContain(`${Math.ceil(500 / 3)} cancelled booking(s) do not close`);
  });

  it("still separates a QA fixture from a real guest's money at scale", async () => {
    const { result } = await runWith(30);
    const i14 = result.findings.find((f) => f.id === "I14");
    // Half the bookings are fixtures, and the cancelled ones are every
    // third — so the split must be reported, not just the total.
    expect(i14!.summary).toMatch(/\d+ QA fixture\(s\), \d+ real guest booking\(s\)/);
    expect(i14!.details.some((d) => d.includes("[QA fixture]"))).toBe(true);
  });

  it("never reports a FAIL for a healthy dataset", async () => {
    const { result } = await runWith(25);
    const failures = result.findings.filter((f) => f.status === "FAIL");
    expect(failures.map((f) => f.id)).toEqual([]);
  });
});
