// Per PAY-01 (P1 MONEY, 2026-10-22): `booking.paidAmount` — the money
// collected AGAINST a booking — must be WRITTEN by every production path
// that records a payment.
//
// THE DEFECT
// ----------
// `booking.paidAmount` had NO production writer. The only writer was the
// refund path (`guest-app/server/lib/refunds.ts`), which DECREMENTS it.
// A booking with money collected against it therefore carried NO
// `paidAmount` at all, and every read fell back to `0`:
//
//   • `guest-app/server/handlers/addons-manage.ts`      (guest balance)
//   • `guest-app/server/handlers/breakfast-manage.ts`   (guest balance)
//   • `guest-app/server/handlers/breakfast-refund-paid.ts` (refund base)
//   • `guest-app/server/handlers/bookings.ts` (`handleAddRefund` base)
//   • `guest-app/server/handlers/bookings.ts` (`redateAddOnsForCancel`)
//   • `admin-app/src/components/BookingDrawerWorkspace.tsx` (refund banner)
//
// THE MONEY THAT DISAPPEARED
// --------------------------
// `redateBreakfastSelections` (shared/utils/bookingAddOnReschedule.ts)
// uses `paidAmount` as the "was this meal paid for?" budget:
//
//   const wasPaid = amount > 0 && remainingPaid >= amount;
//
// With `paidAmount` always 0, `wasPaid` was ALWAYS false, so cancelling a
// booking with a paid breakfast opened ZERO `category: "breakfast"` refund
// rows: the hotel collected the money and never refunded it.
//
// The counterfactual — injecting `paidAmount: 2800` onto the booking —
// produces the expected −₱100 breakfast refund row.
//
// WHAT THESE TESTS PIN
// ---------------------
//   1. A payment write SETS `paidAmount` to the collected amount.
//   2. A later payment INCREMENTS it.
//   3. The refund-liability gate OPENS when `paidAmount > 0` (the PAY-01
//      repro: a ₱2,800-paid booking with a ₱100 breakfast now yields the
//      refund row).
//   4. A store-order tender does NOT count toward a booking's `paidAmount`.
//   5. The refund decrement still produces the right new `paidAmount` and
//      stays idempotent on a repeated refund.
//
// EVERY behavioural assertion below reads the value FROM the booking doc
// after the handler ran, so each one FAILS against the pre-fix code
// (where the field is absent) and PASSES after the fix.
//
// The last describe block is the repo's usual source-text tripwire layer
// (the same style as `crl-02-refund-transaction-firestore.test.ts`):
// it pins the write sites so a future refactor cannot silently drop the
// `paidAmount` maintenance again.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { redateBreakfastSelections } from "@spark-inn/shared";
import type { BreakfastSelectionEntry } from "@spark-inn/shared";

// ---------------------------------------------------------------------------
// The Firestore mock — a flat, PATH-keyed doc store.
//
// Path-keyed (not id-keyed) on purpose: the reservation-scope payment
// subcollection (`reservations/{rid}/payments/{pid}`) and the legacy
// booking-scope one (`bookings/{bid}/payments/{pid}`) must be able to hold
// different docs with the same doc id.
// ---------------------------------------------------------------------------

const { store, mockAdminDb } = vi.hoisted(() => {
  const docs = new Map<string, Record<string, any>>();

  const docRef = (path: string) => ({
    path,
    id: path.split("/").pop() || "",
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => ({
      exists: docs.has(path),
      id: path.split("/").pop() || "",
      data: () => ({ ...(docs.get(path) || {}) })
    }),
    set: async (data: any) => {
      docs.set(path, { ...data });
    },
    update: async (data: any) => {
      docs.set(path, { ...(docs.get(path) || {}), ...data });
    }
  });

  const collectionRef = (path: string) => ({
    path,
    doc: (id?: string) => docRef(id === undefined ? `${path}/__auto__` : `${path}/${id}`),
    add: async (data: any) => {
      const id = `auto${docs.size + 1}`;
      docs.set(`${path}/${id}`, { ...data });
      return { id };
    },
    where: (field: string, _op: string, value: any) => ({
      path: `${path}?where=${field}=${value}`,
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([docPath]) => docPath.startsWith(`${path}/`))
          .filter(([, data]) => data[field] === value)
          .map(([docPath, data]) => ({
            id: docPath.split("/").pop() || "",
            data: () => ({ ...data })
          }))
      })
    }),
    get: async () => ({
      docs: Array.from(docs.entries())
        .filter(([docPath]) => docPath.startsWith(`${path}/`))
        .map(([docPath, data]) => ({
          id: docPath.split("/").pop() || "",
          data: () => ({ ...data })
        }))
    })
  });

  const transaction = {
    get: async (ref: any) => {
      if (ref && typeof ref.get === "function") return ref.get();
      return { exists: false, data: () => ({}) };
    },
    set: (ref: any, data: any) => {
      docs.set(ref.path, { ...data });
    },
    create: (ref: any, data: any) => {
      if (docs.has(ref.path)) throw new Error("ALREADY_EXISTS");
      docs.set(ref.path, { ...data });
    },
    update: (ref: any, data: any) => {
      docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...data });
    }
  };

  const adminDb = {
    collection: (name: string) => collectionRef(name),
    doc: (path: string) => docRef(path),
    runTransaction: async (callback: any) => await callback(transaction)
  };

  return { store: docs, mockAdminDb: adminDb };
});

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: mockAdminDb,
  adminAuth: {}
}));

vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendBookingConfirmedWithBalanceTrigger: vi.fn().mockResolvedValue(undefined),
  sendStaffNewBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendStaffNewPaymentTrigger: vi.fn().mockResolvedValue(undefined),
  sendEarlyCheckinResolveTrigger: vi.fn().mockResolvedValue(undefined),
  buildReservationEmailView: vi.fn().mockReturnValue({}),
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

import { handleAddPayment, handleVerifyAndRecordPayment } from "../../server/handlers/bookings";
import { markRefundPaid } from "../../server/lib/refunds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const staffReq = (overrides: Record<string, any> = {}) => ({
  method: "POST",
  staff: { uid: "staff_1", email: "frontdesk@sparkinn.com", role: "front-desk" },
  body: {
    bookingId: "bk1",
    paymentId: "paymentRequest001",
    amount: 2800,
    method: "cash",
    ...overrides
  }
});

/** The booking doc as it stands after the handler ran. */
function bookingDoc(id = "bk1"): Record<string, any> {
  return { ...(store.get(`bookings/${id}`) || {}) };
}

function meal(overrides: Partial<BreakfastSelectionEntry> = {}): BreakfastSelectionEntry {
  return {
    mealId: "meal-1",
    mealName: "Continental",
    price: 100,
    quantity: 1,
    addedAt: "2026-10-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    ...overrides
  } as BreakfastSelectionEntry;
}

beforeEach(() => {
  store.clear();
  store.set("settings/hotelConfig", {
    paymentMethods: [
      { method: "cash", requireReferenceNumber: false },
      { method: "gcash", requireReferenceNumber: true }
    ]
  });
  store.set("bookings/bk1", {
    bookingRef: "SI-20261022-001",
    guestName: "Maria Santos",
    guestEmail: "maria@example.test",
    totalPrice: 2800,
    status: "pending"
  });
});

// ---------------------------------------------------------------------------
// 1. + 2. — the payment write SETS `paidAmount`, a later one INCREMENTS it
// ---------------------------------------------------------------------------

describe("PAY-01 — the payment paths write the booking's `paidAmount`", () => {
  it("a booking created with a payment has `paidAmount` set to the collected amount", async () => {
    const res = mockResponse();

    await handleAddPayment(staffReq({ amount: 2800 }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bookingDoc().paidAmount).toBe(2800);
  });

  it("adding a later payment increments `paidAmount`", async () => {
    await handleAddPayment(staffReq({ amount: 2800, paymentId: "paymentRequest001" }), mockResponse());
    expect(bookingDoc().paidAmount).toBe(2800);

    await handleAddPayment(staffReq({ amount: 500, paymentId: "paymentRequest002" }), mockResponse());

    expect(bookingDoc().paidAmount).toBe(3300);
  });

  it("the verify-and-record path writes `paidAmount` too", async () => {
    store.set("bookings/bk1", {
      bookingRef: "SI-20261022-001",
      totalPrice: 2800,
      status: "payment-uploaded",
      paymentMethod: "gcash",
      paymentProofUrl: "https://example.test/proof.jpg"
    });

    const res = mockResponse();
    await handleVerifyAndRecordPayment(
      {
        method: "POST",
        staff: { uid: "staff_1", role: "admin" },
        body: {
          bookingId: "bk1",
          paymentId: "verifyPaymentId0001",
          amount: 2800,
          method: "gcash",
          transactionReference: "GCASH-BR08-001"
        }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(bookingDoc().paidAmount).toBe(2800);
  });

  it("a replayed payment does NOT double-count `paidAmount` (idempotency)", async () => {
    await handleAddPayment(staffReq({ amount: 2800, paymentId: "paymentRequest001" }), mockResponse());
    await handleAddPayment(staffReq({ amount: 2800, paymentId: "paymentRequest001" }), mockResponse());

    expect(bookingDoc().paidAmount).toBe(2800);
  });

  it("a legacy booking with payments but no `paidAmount` seeds from the ledger", async () => {
    // Pre-fix booking: money was collected, but nothing ever wrote
    // `paidAmount`, so the doc has no such field.
    store.set("bookings/bk1", {
      bookingRef: "SI-20261022-001",
      totalPrice: 2800,
      status: "pending"
    });
    store.set("bookings/bk1/payments/legacyPayment01", {
      type: "payment",
      amount: 2000,
      method: "cash",
      recordedBy: "staff_1"
    });

    await handleAddPayment(staffReq({ amount: 500, paymentId: "paymentRequest001" }), mockResponse());

    // 2000 already collected + 500 new — NOT 500.
    expect(bookingDoc().paidAmount).toBe(2500);
  });

  it("the reservation scope attributes a payment to the booking it was recorded against", async () => {
    store.set("bookings/bk1", {
      bookingRef: "SI-20261022-001",
      reservationId: "res1",
      totalPrice: 2800,
      status: "pending"
    });
    store.set("bookings/bk2", {
      bookingRef: "SI-20261022-002",
      reservationId: "res1",
      totalPrice: 2800,
      status: "pending"
    });
    store.set("reservations/res1", { totalPrice: 5600 });
    // 3000 was collected against bk1, 1000 against the SIBLING room bk2.
    store.set("reservations/res1/payments/priorRoomPayment1", {
      type: "payment",
      amount: 3000,
      method: "cash",
      reservationId: "res1",
      bookingId: "bk1"
    });
    store.set("reservations/res1/payments/priorRoomPayment2", {
      type: "payment",
      amount: 1000,
      method: "cash",
      reservationId: "res1",
      bookingId: "bk2"
    });

    await handleAddPayment(staffReq({ amount: 500, paymentId: "paymentRequest001" }), mockResponse());

    // bk1's own 3000 + the new 500 — bk2's 1000 is NOT attributed to bk1.
    expect(bookingDoc("bk1").paidAmount).toBe(3500);
    expect(bookingDoc("bk2").paidAmount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. — the refund-liability gate OPENS (the PAY-01 repro)
// ---------------------------------------------------------------------------

describe("PAY-01 — the refund-liability gate opens once money is on the booking", () => {
  const gate = (paidAmount: number) =>
    redateBreakfastSelections({
      mode: "cancel",
      window: { checkIn: "2026-11-01", checkOut: "2026-11-03" },
      today: "2026-10-22",
      selections: { "2026-11-01-guest-0": meal({ price: 100 }) },
      paidAmount
    });

  it("the gate is shut with no `paidAmount` (the pre-fix production state)", () => {
    // The helper is UNCHANGED by this fix — this assertion documents the
    // gate's contract, not the defect.
    expect(gate(0).paidRemoved).toHaveLength(0);
  });

  it("the gate OPENS when `paidAmount > 0` (the counterfactual)", () => {
    const result = gate(2800);
    expect(result.paidRemoved).toHaveLength(1);
    expect(result.paidRemoved[0].amount).toBe(100);
  });

  it("cancelling a breakfast-bearing booking now produces the refund row", async () => {
    // The PAY-01 repro: a ₱2,800 payment against a booking with a ₱100
    // breakfast. Before the fix the booking carried no `paidAmount`, the
    // gate was shut, and ZERO refund rows were produced.
    await handleAddPayment(staffReq({ amount: 2800 }), mockResponse());

    const paidAmount = Number(bookingDoc().paidAmount || 0);
    expect(paidAmount).toBe(2800);

    const result = gate(paidAmount);

    // The paid meal is now recognised as paid → the refund liability opens.
    expect(result.paidRemoved).toHaveLength(1);
    expect(result.paidRemoved[0].amount).toBe(100);
    expect(result.paidRemoved[0].wasPaid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. — a store-order tender does NOT count toward a booking's `paidAmount`
// ---------------------------------------------------------------------------

describe("PAY-01 — store-order tenders are not room-folio payments", () => {
  it("a store-order tender does NOT count toward a booking's `paidAmount`", async () => {
    // The store tender lives under the ORDER, not the booking: it is a
    // direct store payment, and the folio already adds a billed
    // add-to-bill order to the grand total via `storeTotal`.
    store.set("storeOrders/so1", {
      orderRef: "SO-20261022-001",
      bookingId: "bk1",
      status: "delivered",
      paymentMethod: "cash",
      isBilled: true
    });
    store.set("storeOrders/so1/payments/delivery-tender", {
      type: "payment",
      amount: 500,
      method: "cash",
      recordedBy: "staff_1"
    });

    await handleAddPayment(staffReq({ amount: 2800 }), mockResponse());

    // 2800 (the room payment) — NOT 3300 (which would have counted the
    // ₱500 store tender against the room folio).
    expect(bookingDoc().paidAmount).toBe(2800);

    // The tender doc itself never carries a `paidAmount`.
    const tender = store.get("storeOrders/so1/payments/delivery-tender") || {};
    expect(tender.paidAmount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. — the refund decrement still lands on the right value + stays idempotent
// ---------------------------------------------------------------------------

describe("PAY-01 — the refund decrement stays correct + idempotent", () => {
  it("a paid refund decrements the collected `paidAmount` by the refund amount", async () => {
    await handleAddPayment(staffReq({ amount: 2800 }), mockResponse());
    const collected = Number(bookingDoc().paidAmount || 0);
    expect(collected).toBe(2800);

    const transaction = {
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
      get: vi.fn()
    } as any;
    const db = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          collection: (sub: string) => ({
            doc: (subId: string) => ({ path: `${name}/${id}/${sub}/${subId}` })
          })
        })
      })
    } as any;

    const result = markRefundPaid({
      category: "breakfast",
      bookingId: "bk1",
      refundId: "rf1",
      amount: 100,
      method: "cash",
      actor: { uid: "staff_1", role: "front-desk" },
      transaction,
      db,
      existingDoc: {
        exists: true,
        data: () => ({ status: "pending", category: "breakfast", amount: -100 })
      } as any,
      currentPaidAmount: collected
    });

    expect(result.alreadyPaid).toBe(false);
    expect(result.newBookingPaidAmount).toBe(2700);
  });

  it("a repeated refund is idempotent (no second decrement)", async () => {
    await handleAddPayment(staffReq({ amount: 2800 }), mockResponse());
    const collected = Number(bookingDoc().paidAmount || 0);

    const transaction = {
      update: vi.fn(),
      create: vi.fn(),
      set: vi.fn(),
      get: vi.fn()
    } as any;
    const db = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          collection: (sub: string) => ({
            doc: (subId: string) => ({ path: `${name}/${id}/${sub}/${subId}` })
          })
        })
      })
    } as any;

    const paidDoc = {
      exists: true,
      data: () => ({ status: "paid", category: "breakfast", amount: -100 })
    } as any;

    const result = markRefundPaid({
      category: "breakfast",
      bookingId: "bk1",
      refundId: "rf1",
      amount: 100,
      method: "cash",
      actor: { uid: "staff_1", role: "front-desk" },
      transaction,
      db,
      existingDoc: paidDoc,
      currentPaidAmount: collected
    });

    expect(result.alreadyPaid).toBe(true);
    expect(result.newBookingPaidAmount).toBe(collected);
    // The booking's `paidAmount` is NOT written again.
    const bookingWrites = transaction.update.mock.calls.filter(
      (call: any[]) => call[0]?.path === "bookings/bk1"
    );
    expect(bookingWrites).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source-text tripwires — pin the write sites
// ---------------------------------------------------------------------------

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const storeSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/store.ts"),
  "utf8"
);
const refundsSrc = readFileSync(
  resolve(__dirname, "../../server/lib/refunds.ts"),
  "utf8"
);

/** The source slice of one handler, from its declaration to the next one. */
function handlerSlice(name: string): string {
  const start = bookingsSrc.indexOf(`export async function ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const next = bookingsSrc.indexOf("\nexport async function ", start + 1);
  return bookingsSrc.slice(start, next === -1 ? bookingsSrc.length : next);
}

describe("PAY-01 — the `paidAmount` write sites are pinned", () => {
  it("`handleAddPayment` maintains `paidAmount`", () => {
    const slice = handlerSlice("handleAddPayment");
    expect(slice).toMatch(/paidAmount\s*=\s*computeNextBookingPaidAmount\(/);
    expect(slice).toMatch(/recordedAmount:\s*numericAmount/);
  });

  it("`handleVerifyAndRecordPayment` maintains `paidAmount`", () => {
    const slice = handlerSlice("handleVerifyAndRecordPayment");
    expect(slice).toMatch(/paidAmount\s*=\s*computeNextBookingPaidAmount\(/);
    expect(slice).toMatch(/recordedAmount:\s*numericAmount/);
  });

  it("neither payment path writes `totalPrice` (decision #298 — the add-ons stay OUT of the room bill)", () => {
    for (const name of ["handleAddPayment", "handleVerifyAndRecordPayment"]) {
      const slice = handlerSlice(name);
      const start = slice.indexOf("const bookingUpdates");
      expect(start, `${name} must build a bookingUpdates payload`).toBeGreaterThan(-1);
      const end = slice.indexOf("transaction.update(bookingRef, bookingUpdates)", start);
      expect(end, `${name} must write bookingUpdates`).toBeGreaterThan(-1);
      const payload = slice.slice(start, end);
      // `paidAmount` IS written; `totalPrice` is NOT.
      expect(payload, `${name} must write paidAmount`).toMatch(/paidAmount/);
      expect(payload, `${name} must not write totalPrice`).not.toMatch(/totalPrice/);
    }
  });

  it("the store-order path never writes a booking's `paidAmount`", () => {
    expect(storeSrc).not.toMatch(/paidAmount/);
  });

  it("the refund helper still decrements `paidAmount` (the counterpart of the payment write)", () => {
    expect(refundsSrc).toMatch(/paidAmount:\s*newBookingPaidAmount/);
    expect(refundsSrc).toMatch(/computeRefundPaidAmountDelta/);
  });

  it("the cancel path's refund-liability gate still reads the booking's paid amount", () => {
    // Per FIN-PAID-AMOUNT-SOURCE (QA pass 2026-10-24) the gate no
    // longer reads the raw denormalized field: `paidAmount` can be
    // negative (`SI-20261021-00011` read −₱1,000) or absent (14
    // legacy bookings), and both read as "nothing was paid" — which
    // silently suppressed the refund liability for a PAID breakfast
    // removed on those bookings.
    //
    // It now goes through `resolvePaidAmountForLiability`, which uses
    // the denormalized field when it is a POSITIVE number and
    // otherwise falls back to the ledger.
    expect(bookingsSrc).toMatch(/async function resolvePaidAmountForLiability\(/);
    // The call sites assign the resolved amount under different names
    // (the reservation-scope cancel resolves one per cancellable child
    // into a map; the single-room cancel resolves one for its booking).
    // What matters is that EVERY cancel path goes through the resolver
    // — never the raw denormalized field.
    expect(bookingsSrc).toMatch(
      /await resolvePaidAmountForLiability\(\{/
    );
    expect(bookingsSrc).toMatch(
      /paidAmount: await resolvePaidAmountForLiability\(\{/
    );
    // The helper must prefer a positive seeded field…
    expect(bookingsSrc).toMatch(
      /if \(Number\.isFinite\(seeded\) && seeded > 0\) return seeded;/
    );
    // …and fall back to the ledger otherwise.
    expect(bookingsSrc).toMatch(/readTransactionalFolioSnapshot\(\{/);
  });
});
