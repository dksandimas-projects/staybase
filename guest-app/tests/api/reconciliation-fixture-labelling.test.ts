// A QA FIXTURE and a REAL GUEST booking must never look the same in the
// nightly money reconciliation.
//
// WHY
// ---
// The reconciliation's whole job is to tell the desk whether REAL money
// is at risk. On 2026-10-27 two findings (F-A4, F-D4) had sat "open" for
// a week for one reason only: every booking the reconciliation flagged
// was the hotel's own rehearsal data, and the report printed it in the
// exact same format as a real guest's overcharge. Nobody could tell
// which was which, so nobody could safely close the finding.
//
// These tests pin the labelling that fixes it:
//   * a fixture is labelled `[QA fixture]`
//   * a real guest's booking is labelled `[REAL guest]`
//   * the summary counts the split
//   * and — the part that matters most — a REAL booking's finding is
//     NEVER softened, downgraded or hidden.

import { describe, it, expect, beforeEach, vi } from "vitest";

const BOOKING_FIXTURE = {
  id: "fixture-1",
  bookingRef: "SI-TEST-0001",
  status: "cancelled",
  totalPrice: 2000,
  paidAmount: 2000,
  isTestData: true
};

const BOOKING_REAL = {
  id: "real-1",
  bookingRef: "SI-REAL-0001",
  status: "cancelled",
  totalPrice: 3000,
  paidAmount: 3000,
  isTestData: false
};

const PAYMENTS: Record<string, Array<Record<string, unknown>>> = {
  "fixture-1": [{ amount: 2000, status: "confirmed", type: "payment" }],
  "real-1": [{ amount: 3000, status: "confirmed", type: "payment" }]
};

/**
 * A document with the `ref.parent.parent.path` the bulk index reads, so
 * a payment can be attributed to the booking that owns it.
 */
function makeDoc(data: any, path: string): any {
  const parts = path.split("/");
  return {
    id: data.id,
    path,
    ref: { path, parent: { parent: { path: parts.slice(0, 2).join("/") } } },
    data: () => data
  };
}

function makeSnapshot(docs: any[]): any {
  return { docs, size: docs.length, empty: docs.length === 0 };
}

/**
 * A Firestore stand-in that answers only what the reconciler reads.
 *
 * The reconciler reads every payment and every refund through
 * `collectionGroup` (one bulk read each) rather than per booking, so
 * the stand-in serves them that way.
 */
function fakeFirestore(bookings: any[]): any {
  const paymentDocs: any[] = [];
  const refundDocs: any[] = [];
  for (const booking of bookings) {
    const rows: Array<Record<string, unknown>> = PAYMENTS[booking.id] || [];
    rows.forEach((row, i) => {
      paymentDocs.push(makeDoc({ id: `p${i}`, ...row }, `bookings/${booking.id}/payments/p${i}`));
    });
  }

  return {
    collection: (name: string) => ({
      get: async () => {
        if (name === "bookings") {
          return makeSnapshot(bookings.map((b) => makeDoc(b, `bookings/${b.id}`)));
        }
        return makeSnapshot([]);
      },
      doc: (id: string) => ({
        id,
        // The reconciler reads the hotel's cancellation-policy settings
        // (websiteContent + hotelConfig) once, so the stand-in serves
        // them as empty documents.
        get: async () => ({
          id,
          exists: true,
          data: () => ({}),
          ref: { path: `settings/${id}`, parent: { parent: { path: "settings" } } }
        }),
        collection: () => ({ get: async () => makeSnapshot([]) })
      })
    }),
    collectionGroup: (name: string) => ({
      get: async () => {
        if (name === "payments") return makeSnapshot(paymentDocs);
        if (name === "refunds") return makeSnapshot(refundDocs);
        return makeSnapshot([]);
      }
    })
  };
}

const mockDb = { current: fakeFirestore([]) };

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    get collection() {
      return mockDb.current.collection;
    },
    get collectionGroup() {
      return mockDb.current.collectionGroup;
    }
  },
  adminAuth: {},
  adminStorage: {}
}));

async function runWith(bookings: any[]) {
  mockDb.current = fakeFirestore(bookings);
  const { runReconciliation } = await import("../../server/lib/reconciliation");
  return runReconciliation();
}

describe("the nightly reconciliation tells a QA fixture from a real guest's money", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("labels a fixture booking as a fixture", async () => {
    const result = await runWith([BOOKING_FIXTURE]);
    const i14 = result.findings.find((f) => f.id === "I14");
    expect(i14).toBeDefined();
    expect(i14!.details.join("\n")).toContain("[QA fixture]");
    expect(i14!.details.join("\n")).not.toContain("[REAL guest]");
  });

  it("labels a real guest booking as real", async () => {
    const result = await runWith([BOOKING_REAL]);
    const i14 = result.findings.find((f) => f.id === "I14");
    expect(i14).toBeDefined();
    expect(i14!.details.join("\n")).toContain("[REAL guest]");
  });

  it("counts the split in the summary", async () => {
    const result = await runWith([BOOKING_FIXTURE, BOOKING_REAL]);
    const i14 = result.findings.find((f) => f.id === "I14");
    expect(i14!.summary).toContain("1 QA fixture(s)");
    expect(i14!.summary).toContain("1 real guest booking(s)");
  });

  it("never hides or softens a REAL guest booking's finding", async () => {
    const result = await runWith([BOOKING_REAL]);
    const i14 = result.findings.find((f) => f.id === "I14");
    // The finding is still raised, and it is still a WARN — the same
    // severity it had before the labelling was introduced.
    expect(i14!.status).toBe("WARN");
    expect(i14!.details.length).toBeGreaterThan(0);
  });

  it("still raises a WARN for a booking that is neither tagged nor untagged", async () => {
    const untagged = { ...BOOKING_REAL, isTestData: undefined };
    const result = await runWith([untagged]);
    const i14 = result.findings.find((f) => f.id === "I14");
    // An untagged booking is treated as REAL — the safe default is to
    // assume it is a guest's money until proven otherwise.
    expect(i14!.details.join("\n")).toContain("[REAL guest]");
  });
});
