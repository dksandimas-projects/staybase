// Per CRL-02 (QA pass 2026-10-21) — the refund write path must not
// depend on a `transaction.firestore` property that does not exist.
//
// WHAT WAS BROKEN: `guest-app/server/lib/refunds.ts` built its document
// references with `transaction.firestore.collection("bookings")`. The
// firebase-admin `Transaction` class does NOT expose a public
// `firestore` getter (it only has the private `_firestore`), so
// `transaction.firestore` was `undefined` and every call threw
// `TypeError: Cannot read properties of undefined (reading
// 'collection')`.
//
// CONFIRMED IN PRODUCTION on 2026-10-21: `POST /api/bookings/add-refund`
// answered HTTP 500 `{"success":false,"error":"Cannot read properties of
// undefined (reading 'collection')"}` on every booking × every amount.
// All four refund paths were dead — cancellation, breakfast,
// other-add-on, and the standalone add-refund endpoint — and the
// over-refund guard sat behind the same throw, so it was unreachable.
//
// The fix threads the Firestore INSTANCE through the helper (`db`) and
// uses it only for path construction. A `DocumentReference` is a path
// holder, so any instance in the same project builds an equivalent
// reference; the caller's transaction still performs every read/write.
//
// WHY A BEHAVIOURAL TEST: the defect is a runtime `undefined`, not a
// text pattern. A source-regex tripwire would have to guess the exact
// spelling, and the repo's own audit (H1) already records that ~99% of
// the suite is source-regex. This test calls the REAL helper with a
// fake db + fake transaction and asserts the resolved paths.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { markRefundPaid } from "../../server/lib/refunds";

/** A minimal stand-in for a Firestore `DocumentReference` (path holder). */
function fakeRef(path: string): any {
  return {
    path,
    collection: (name: string) => ({
      doc: (id?: string) => fakeRef(id === undefined ? `${path}/${name}` : `${path}/${name}/${id}`)
    })
  };
}

/** A minimal stand-in for the Firestore instance used for path building. */
function fakeDb(): any {
  return {
    collection: (name: string) => ({
      doc: (id: string) => fakeRef(`${name}/${id}`)
    })
  };
}

function fakeTransaction() {
  return {
    update: vi.fn(),
    create: vi.fn(),
    set: vi.fn(),
    get: vi.fn()
  } as any;
}

const actor = { uid: "admin-uid", role: "admin" as const };

describe("markRefundPaid — CRL-02 (no transaction.firestore)", () => {
  it("a breakfast refund resolves to bookings/{id}/refunds/{refundId}", () => {
    const transaction = fakeTransaction();
    const result = markRefundPaid({
      category: "breakfast",
      bookingId: "bk1",
      refundId: "rf1",
      amount: 100,
      method: "cash",
      actor,
      transaction,
      db: fakeDb(),
      existingDoc: {
        exists: true,
        data: () => ({ status: "pending", category: "breakfast", amount: -100 })
      } as any,
      currentPaidAmount: 500
    });

    expect(result.alreadyPaid).toBe(false);
    expect(result.newBookingPaidAmount).toBe(400);

    // The refund doc is updated at bookings/{id}/refunds/{refundId}.
    const refundUpdate = transaction.update.mock.calls[0];
    expect(refundUpdate[0].path).toBe("bookings/bk1/refunds/rf1");

    // The booking's paidAmount is decremented at bookings/{id}.
    const bookingUpdate = transaction.update.mock.calls[1];
    expect(bookingUpdate[0].path).toBe("bookings/bk1");
    expect(bookingUpdate[1]).toMatchObject({ paidAmount: 400 });
  });

  it("a cancellation refund on a reservation resolves to reservations/{rid}/refunds/{refundId}", () => {
    const transaction = fakeTransaction();
    markRefundPaid({
      category: "cancellation",
      bookingId: "bk2",
      refundId: "rf2",
      amount: 250,
      method: "gcash",
      actor,
      transaction,
      db: fakeDb(),
      reservationId: "res7",
      existingDoc: null,
      currentPaidAmount: 250
    });

    const written = transaction.create.mock.calls[0];
    expect(written[0].path).toBe("reservations/res7/refunds/rf2");
  });

  it("a legacy cancellation (no reservationId) resolves to bookings/{id}/payments/{refundId}", () => {
    const transaction = fakeTransaction();
    markRefundPaid({
      category: "cancellation",
      bookingId: "bk3",
      refundId: "rf3",
      amount: 100,
      method: "cash",
      actor,
      transaction,
      db: fakeDb(),
      reservationId: null,
      existingDoc: null,
      currentPaidAmount: 100
    });

    const written = transaction.create.mock.calls[0];
    expect(written[0].path).toBe("bookings/bk3/payments/rf3");
  });

  it("the helper source never reads transaction.firestore", () => {
    const src = readFileSync(
      resolve(__dirname, "../../server/lib/refunds.ts"),
      "utf8"
    );
    // Strip the explanatory comment that documents the old defect.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(code).not.toMatch(/transaction\s*\.\s*firestore/);
    expect(code).toMatch(/db:\s*Firestore/);
  });

  it("every markRefundPaid call site passes the Firestore instance", () => {
    const callSites = [
      "../../server/handlers/refunds.ts",
      "../../server/handlers/bookings.ts",
      "../../server/handlers/addons-refund-paid.ts",
      "../../server/handlers/breakfast-refund-paid.ts"
    ];
    for (const relative of callSites) {
      const src = readFileSync(resolve(__dirname, relative), "utf8");
      const calls = src.split("markRefundPaid({").slice(1);
      expect(calls.length, `${relative} has a markRefundPaid call`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${relative} must pass db: adminDb`).toMatch(/db:\s*adminDb\b/);
      }
    }
  });
});
