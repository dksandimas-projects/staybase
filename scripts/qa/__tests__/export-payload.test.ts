// Per ETR-R / F-A6: the staging-refresh export's payload assembly.
//
// These are FIXTURE tests — no network, no Firestore, no production
// access. They prove the two things the server's staging-refresh gate
// depends on:
//
//   1. the SHAPE — the payload's top level is exactly `export`, `export`
//      has exactly `bookings` / `storeOrders` / `members`, and every
//      doc carries the `id` the server writes `doc(String(x.id))` with;
//   2. the MONEY — `balanceDue` is computed with the shared canonical
//      helper from the ledger that lives in the Firestore SUBCOLLECTIONS
//      (not on the booking doc), with the pending-refund liability rule
//      intact.
//
// The module under test (`../lib/export-payload`) is PURE: it does not
// import `firebase-admin`, does not touch the network, and has no side
// effects. That is what makes these assertions possible without a
// production read.

import { describe, expect, it } from "vitest";
import {
  buildExportPayload,
  normalizeTimestamp,
  toPlainDoc,
  type LedgerRow
} from "../lib/export-payload";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * A normalized payment row.
 *
 * The default `path` is derived from the row id so two rows built from
 * the same helper are two DIFFERENT documents — the module dedups by
 * document path, so a shared default path would (correctly) collapse
 * them into one.
 */
const paymentRow = (over: Partial<LedgerRow> = {}): LedgerRow => {
  const id = over.id ?? "p1";
  return {
    id,
    path: `reservations/res-1/payments/${id}`,
    bookingId: "bk-1",
    amount: 5000,
    method: "gcash",
    status: "",
    recordedAt: "2026-10-20T09:00:00.000Z",
    category: "",
    label: "",
    ...over
  };
};

/** A normalized refund row (stored NEGATIVE, like production). */
const refundRow = (over: Partial<LedgerRow> = {}): LedgerRow => {
  const id = over.id ?? "r1";
  return {
    id,
    path: `reservations/res-1/refunds/${id}`,
    bookingId: "bk-1",
    amount: -100,
    method: "gcash",
    status: "pending",
    recordedAt: "2026-10-21T09:00:00.000Z",
    category: "breakfast",
    label: "",
    ...over
  };
};

/** A normalized charge row. */
const chargeRow = (over: Partial<LedgerRow> = {}): LedgerRow => {
  const id = over.id ?? "c1";
  return {
    id,
    path: `reservations/res-1/charges/${id}`,
    bookingId: "bk-1",
    amount: 500,
    method: "",
    status: "",
    recordedAt: "2026-10-21T10:00:00.000Z",
    category: "laundry",
    label: "Laundry",
    ...over
  };
};

/** A production booking doc — no `id` field of its own (production has none). */
const bookingDoc = (over: Record<string, unknown> = {}) => ({
  bookingRef: "SI-20261020-00001",
  guestName: "Test Guest",
  status: "confirmed",
  totalPrice: 5000,
  ...over
});

/** A production store order doc. */
const storeOrderDoc = (over: Record<string, unknown> = {}) => ({
  orderRef: "SO-001",
  bookingId: "bk-1",
  totalAmount: 250,
  paymentMethod: "add-to-bill",
  status: "delivered",
  isBilled: true,
  ...over
});

/** A production member doc. */
const memberDoc = (over: Record<string, unknown> = {}) => ({
  email: "member@example.test",
  fullName: "Test Member",
  memberNumber: "M-001",
  tier: "silver",
  rewardsPoints: 10,
  isActive: true,
  ...over
});

/** The single booking most of the cases below are about. */
const BASE = {
  bookings: [{ id: "bk-1", ...bookingDoc() }],
  storeOrders: [],
  members: [],
  paymentRows: [],
  refundRows: [],
  chargeRows: []
};

// ---------------------------------------------------------------------------

describe("export payload — the shape the server's gate accepts", () => {
  it("has exactly the top level `export` with exactly bookings/storeOrders/members", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      members: [{ id: "m-1", ...memberDoc() }]
    });

    expect(Object.keys(payload)).toEqual(["export"]);
    expect(Object.keys(payload.export).sort()).toEqual([
      "bookings",
      "members",
      "storeOrders"
    ]);
    expect(Array.isArray(payload.export.bookings)).toBe(true);
    expect(Array.isArray(payload.export.storeOrders)).toBe(true);
    expect(Array.isArray(payload.export.members)).toBe(true);
  });

  it("gives every booking, store order and member the `id` of its source document", () => {
    const { payload } = buildExportPayload({
      bookings: [
        { id: "bk-1", ...bookingDoc() },
        { id: "bk-2", ...bookingDoc({ bookingRef: "SI-20261020-00002" }) }
      ],
      storeOrders: [{ id: "so-1", ...storeOrderDoc() }],
      members: [{ id: "m-1", ...memberDoc() }],
      paymentRows: [],
      refundRows: [],
      chargeRows: []
    });

    expect(payload.export.bookings.map((b: any) => b.id)).toEqual(["bk-1", "bk-2"]);
    expect(payload.export.storeOrders.map((o: any) => o.id)).toEqual(["so-1"]);
    expect(payload.export.members.map((m: any) => m.id)).toEqual(["m-1"]);
  });

  it("keeps every original production field on the booking", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      bookings: [
        {
          id: "bk-1",
          ...bookingDoc({
            guestEmail: "guest@example.test",
            checkIn: "2026-10-20",
            checkOut: "2026-10-22",
            numNights: 2
          })
        }
      ]
    });

    const b = payload.export.bookings[0];
    expect(b.bookingRef).toBe("SI-20261020-00001");
    expect(b.guestName).toBe("Test Guest");
    expect(b.guestEmail).toBe("guest@example.test");
    expect(b.checkIn).toBe("2026-10-20");
    expect(b.checkOut).toBe("2026-10-22");
    expect(b.numNights).toBe(2);
    expect(b.totalPrice).toBe(5000);
  });
});

// ---------------------------------------------------------------------------

describe("export payload — the money", () => {
  it("1. a payment that covers the bill leaves a balance of 0 and lands in onsitePayments", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })]
    });

    const b = payload.export.bookings[0];
    expect(b.balanceDue).toBe(0);
    expect(b.onsitePayments).toHaveLength(1);
    expect(b.onsitePayments[0]).toMatchObject({
      id: "p1",
      type: "payment",
      amount: 5000,
      method: "gcash",
      status: "",
      recordedAt: "2026-10-20T09:00:00.000Z"
    });
  });

  it("2. a PENDING refund is a liability — it stays in onsitePayments but does not reduce collected money", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      refundRows: [refundRow({ amount: -100, status: "pending" })]
    });

    const b = payload.export.bookings[0];
    // The refund is present, with its type, amount sign and status intact.
    const refund = b.onsitePayments.find((p: any) => p.type === "refund");
    expect(refund).toBeDefined();
    expect(refund.amount).toBe(-100);
    expect(refund.status).toBe("pending");
    // ...but it is NOT money collected, so the guest still owes nothing.
    expect(b.balanceDue).toBe(0);
  });

  it("3. a PAID refund DOES reduce collected money", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      refundRows: [refundRow({ amount: -100, status: "paid" })]
    });

    const b = payload.export.bookings[0];
    expect(b.balanceDue).toBe(100);
    const refund = b.onsitePayments.find((p: any) => p.type === "refund");
    expect(refund.status).toBe("paid");
  });

  it("4. a charge raises the balance", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      chargeRows: [chargeRow({ amount: 500 })]
    });

    const b = payload.export.bookings[0];
    expect(b.balanceDue).toBe(500);
    expect(b.addedCharges).toHaveLength(1);
    expect(b.addedCharges[0]).toEqual({
      id: "c1",
      label: "Laundry",
      amount: 500,
      category: "laundry"
    });
  });

  it("5. an add-to-bill store order raises the balance; a non-qualifying one does not", () => {
    const qualifying = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      storeOrders: [
        {
          id: "so-1",
          ...storeOrderDoc({
            paymentMethod: "add-to-bill",
            status: "delivered",
            isBilled: true,
            totalAmount: 250
          })
        }
      ]
    });
    expect(qualifying.payload.export.bookings[0].balanceDue).toBe(250);

    // Not add-to-bill / not delivered / not billed → no effect on the folio.
    for (const nonQualifying of [
      { paymentMethod: "cash", status: "delivered", isBilled: true },
      { paymentMethod: "add-to-bill", status: "cancelled", isBilled: true },
      { paymentMethod: "add-to-bill", status: "delivered", isBilled: false }
    ]) {
      const result = buildExportPayload({
        ...BASE,
        paymentRows: [paymentRow({ amount: 5000 })],
        storeOrders: [
          { id: "so-1", ...storeOrderDoc({ totalAmount: 250, ...nonQualifying }) }
        ]
      });
      expect(result.payload.export.bookings[0].balanceDue).toBe(0);
    }
  });

  it("6. a store order on ANOTHER booking does not touch this booking's balance", () => {
    const { payload } = buildExportPayload({
      bookings: [
        { id: "bk-1", ...bookingDoc() },
        { id: "bk-2", ...bookingDoc({ bookingRef: "SI-20261020-00002" }) }
      ],
      storeOrders: [
        {
          id: "so-1",
          ...storeOrderDoc({
            bookingId: "bk-2",
            paymentMethod: "add-to-bill",
            status: "delivered",
            isBilled: true,
            totalAmount: 250
          })
        }
      ],
      paymentRows: [
        paymentRow({ id: "p1", bookingId: "bk-1", amount: 5000 }),
        paymentRow({ id: "p2", bookingId: "bk-2", amount: 5000 })
      ],
      refundRows: [],
      chargeRows: [],
      members: []
    });

    // bk-1's bill is settled — the other booking's store order is not its money.
    expect(payload.export.bookings[0].balanceDue).toBe(0);
    // bk-2 owns the store order: 5000 bill + 250 add-to-bill − 5000 collected.
    expect(payload.export.bookings[1].balanceDue).toBe(250);
  });

  it("carries the BR-12 other add-ons on top of totalPrice and defaults them to 0", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      bookings: [
        {
          id: "bk-1",
          ...bookingDoc({ totalPrice: 5000, otherAddOnTotal: 2000 })
        }
      ],
      paymentRows: [paymentRow({ amount: 5000 })],
      refundRows: [],
      chargeRows: []
    });

    const b = payload.export.bookings[0];
    expect(b.otherAddOnTotal).toBe(2000);
    // 5000 bill + 2000 add-ons − 5000 collected.
    expect(b.balanceDue).toBe(2000);
  });

  it("defaults otherAddOnTotal to 0 when the production doc has none", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      refundRows: [],
      chargeRows: []
    });

    expect(payload.export.bookings[0].otherAddOnTotal).toBe(0);
    expect(payload.export.bookings[0].balanceDue).toBe(0);
  });

  it("keeps the refund amount's sign exactly as stored", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      refundRows: [refundRow({ amount: -100, status: "paid" })]
    });

    const refund = payload.export.bookings[0].onsitePayments.find(
      (p: any) => p.type === "refund"
    );
    expect(refund.amount).toBe(-100);
  });

  it("includes ALL of a booking's charges — a void pair is two rows that net to zero", () => {
    const { payload } = buildExportPayload({
      ...BASE,
      paymentRows: [paymentRow({ amount: 5000 })],
      chargeRows: [
        chargeRow({ id: "c1", amount: 500, label: "Laundry" }),
        chargeRow({ id: "c2", amount: -500, label: "Laundry (void)" })
      ]
    });

    const b = payload.export.bookings[0];
    expect(b.addedCharges).toHaveLength(2);
    expect(b.balanceDue).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("export payload — ledger attribution", () => {
  it("9. a row pointing at an unknown booking is dropped and counted", () => {
    const { payload, stats } = buildExportPayload({
      ...BASE,
      paymentRows: [
        paymentRow({ id: "p1", bookingId: "bk-1" }),
        paymentRow({
          id: "orphan",
          path: "reservations/res-9/payments/orphan",
          bookingId: "bk-does-not-exist"
        })
      ],
      refundRows: [],
      chargeRows: []
    });

    expect(stats.ledgerRowsRead).toBe(2);
    expect(stats.ledgerRowsAttributed).toBe(1);
    expect(stats.ledgerRowsDropped).toBe(1);
    // The orphan is not attached to anything.
    expect(payload.export.bookings[0].onsitePayments).toHaveLength(1);
    expect(payload.export.bookings[0].onsitePayments[0].id).toBe("p1");
  });

  it("10. a legacy row with no stamped bookingId is attributed by its path", () => {
    const { payload, stats } = buildExportPayload({
      ...BASE,
      bookings: [{ id: "bk-legacy", ...bookingDoc() }],
      paymentRows: [
        paymentRow({
          id: "row-1",
          path: "bookings/bk-legacy/payments/row-1",
          bookingId: null,
          amount: 5000
        })
      ],
      refundRows: [],
      chargeRows: []
    });

    expect(stats.ledgerRowsDropped).toBe(0);
    expect(stats.ledgerRowsAttributed).toBe(1);
    const b = payload.export.bookings[0];
    expect(b.id).toBe("bk-legacy");
    expect(b.onsitePayments).toHaveLength(1);
    expect(b.onsitePayments[0].id).toBe("row-1");
    expect(b.balanceDue).toBe(0);
  });

  it("prefers the stamped bookingId over the path", () => {
    const { payload } = buildExportPayload({
      bookings: [
        { id: "bk-1", ...bookingDoc() },
        { id: "bk-2", ...bookingDoc() }
      ],
      storeOrders: [],
      members: [],
      paymentRows: [
        paymentRow({
          id: "row-1",
          path: "bookings/bk-2/payments/row-1",
          bookingId: "bk-1",
          amount: 5000
        })
      ],
      refundRows: [],
      chargeRows: []
    });

    expect(payload.export.bookings[0].onsitePayments).toHaveLength(1);
    expect(payload.export.bookings[1].onsitePayments).toHaveLength(0);
  });

  it("drops a store-order tender — it is not room-folio money", () => {
    const { stats } = buildExportPayload({
      ...BASE,
      paymentRows: [
        paymentRow({
          id: "tender",
          path: "storeOrders/so-1/payments/tender",
          bookingId: "bk-1",
          amount: 180
        })
      ],
      refundRows: [],
      chargeRows: []
    });

    expect(stats.ledgerRowsDropped).toBe(1);
    expect(stats.ledgerRowsAttributed).toBe(0);
  });

  it("never counts the same row twice", () => {
    const row = paymentRow({ id: "p1", amount: 5000 });
    const { stats } = buildExportPayload({
      ...BASE,
      paymentRows: [row, { ...row }],
      refundRows: [],
      chargeRows: []
    });

    expect(stats.ledgerRowsRead).toBe(2);
    expect(stats.ledgerRowsAttributed).toBe(1);
    expect(stats.ledgerRowsDropped).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("export payload — stats", () => {
  it("counts the bookings with a non-zero balance", () => {
    const { stats } = buildExportPayload({
      bookings: [
        { id: "bk-1", ...bookingDoc({ totalPrice: 5000 }) },
        { id: "bk-2", ...bookingDoc({ totalPrice: 5000 }) },
        { id: "bk-3", ...bookingDoc({ totalPrice: 5000 }) }
      ],
      storeOrders: [],
      members: [{ id: "m-1", ...memberDoc() }],
      paymentRows: [
        paymentRow({ id: "p1", bookingId: "bk-1", amount: 5000 }),
        paymentRow({ id: "p2", bookingId: "bk-2", amount: 4000 }),
        paymentRow({ id: "p3", bookingId: "bk-3", amount: 5000 })
      ],
      refundRows: [],
      chargeRows: []
    });

    expect(stats.bookings).toBe(3);
    expect(stats.storeOrders).toBe(0);
    expect(stats.members).toBe(1);
    expect(stats.bookingsWithBalance).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("normalization helpers", () => {
  it("normalizeTimestamp converts a Timestamp, a Date and a string, and returns '' otherwise", () => {
    const iso = "2026-10-20T09:00:00.000Z";
    const timestamp = { toDate: () => new Date(iso) };

    expect(normalizeTimestamp(timestamp)).toBe(iso);
    expect(normalizeTimestamp(new Date(iso))).toBe(iso);
    expect(normalizeTimestamp(iso)).toBe(iso);
    expect(normalizeTimestamp("")).toBe("");
    expect(normalizeTimestamp(null)).toBe("");
    expect(normalizeTimestamp(undefined)).toBe("");
    expect(normalizeTimestamp(42)).toBe("");
    expect(normalizeTimestamp({})).toBe("");
  });

  it("toPlainDoc converts Timestamps to ISO strings and DocumentReferences to their path", () => {
    const iso = "2026-10-20T09:00:00.000Z";
    const plain = toPlainDoc({
      createdAt: { toDate: () => new Date(iso) },
      roomRef: { path: "rooms/room-1", id: "room-1", collection: () => ({}) },
      nested: { checkedInAt: { toDate: () => new Date(iso) } },
      list: [{ toDate: () => new Date(iso) }],
      totalPrice: 5000,
      note: "kept"
    });

    expect(plain.createdAt).toBe(iso);
    expect(plain.roomRef).toBe("rooms/room-1");
    expect(plain.nested.checkedInAt).toBe(iso);
    expect(plain.list[0]).toBe(iso);
    expect(plain.totalPrice).toBe(5000);
    expect(plain.note).toBe("kept");
  });
});
