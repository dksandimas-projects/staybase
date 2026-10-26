// Per §3.23 (AI-BROWSER-QA 2026-10-26) — the admin's "Record Refund"
// wrote a SETTLED refund with no `status`, so every read path classified
// it as a PENDING LIABILITY.
//
// WHAT WAS BROKEN: `guest-app/server/lib/refunds.ts` → `markRefundPaid`,
// the CRL-01 branch (the `category: "cancellation"` create), built the
// refund record WITHOUT a `status` field — while DECREMENTING the
// booking's `paidAmount`, i.e. treating the money as already paid out.
//
// The read side disagrees: `shared/utils/bookingFolio.ts` →
// `isUnpaidRefund` classifies a refund by its `status` alone ("no status
// ⇒ pending"), and `sumCollectedPayments` excludes a pending refund
// from `paymentsTotal`. So a refund the desk had already handed back in
// cash was read back as a liability the hotel still owed.
//
// CONFIRMED IN PRODUCTION on 2026-10-26, on `SI-20261026-00002` (the
// FD-10 scenario's own clean run), with the app's own shared helper:
//
//   collected 2600 · refund recorded by the desk ₱100 (settled) ·
//   breakfast refund ₱100 (settled)
//   the app's folio  : paymentsTotal 2500 · balance ₱100 DUE
//   the truth        : the hotel owes the guest ₱200
//   booking.paidAmount 2400 vs the settled ledger 2500  → Δ ₱100
//
// The sign of the balance was wrong: the guest looked like a debtor
// when the hotel was the debtor.
//
// WHY A BEHAVIOURAL TEST: the defect is a MISSING FIELD, so a
// source-regex tripwire would only pin the spelling of the fix, not the
// behaviour. This test calls the REAL helper with a fake db + fake
// transaction (the pattern `crl-02-refund-transaction-firestore.test.ts`
// established) and then feeds the record it produced to the REAL shared
// classifier — the same one the admin drawer's folio uses.

import { describe, expect, it, vi } from "vitest";

import { markRefundPaid } from "../../server/lib/refunds";
import { isUnpaidRefund, sumCollectedPayments } from "../../../shared/utils/bookingFolio";

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

/** The CRL-01 path: the admin records a refund in one shot. */
function recordCancellationRefund(overrides: Record<string, any> = {}) {
  const transaction = fakeTransaction();
  const result = markRefundPaid({
    category: "cancellation",
    bookingId: "bk1",
    refundId: "rf1",
    amount: 100,
    method: "cash",
    reason: "AI-BROWSER-QA 2026-10-26 — a full refund",
    actor,
    transaction,
    db: fakeDb(),
    existingDoc: { exists: false, data: () => undefined } as any,
    currentPaidAmount: 2600,
    reservationId: "res1",
    ...overrides
  } as never);
  const created = transaction.create.mock.calls[0]?.[1] as Record<string, any>;
  return { transaction, result, created };
}

describe("§3.23 — the admin's recorded refund is SETTLED, not a pending liability", () => {
  it("stamps the settled state on the refund record it creates", () => {
    const { created } = recordCancellationRefund();
    expect(created).toBeDefined();
    expect(created.status).toBe("paid");
    expect(created.paidBy).toBe(actor.uid);
    expect(created.paidAt).toBeDefined();
  });

  it("the shared classifier reads it as money that left the till", () => {
    const { created } = recordCancellationRefund();
    // The SAME helper the admin drawer's folio uses.
    expect(isUnpaidRefund(created)).toBe(false);
  });

  it("the folio's collected total counts it", () => {
    const { created } = recordCancellationRefund();
    const ledger = [
      { amount: 2600, type: "payment", status: null },
      { amount: -100, type: "refund", status: created.status }
    ];
    // 2600 collected − 100 refunded = 2500 in hand.
    expect(sumCollectedPayments(ledger)).toBe(2500);
  });

  it("the booking's paidAmount and the settled ledger agree", () => {
    const { result, created } = recordCancellationRefund();
    const ledger = [
      { amount: 2600, type: "payment", status: null },
      { amount: -100, type: "refund", status: created.status }
    ];
    // `paidAmount` is decremented by the write …
    expect(result.newBookingPaidAmount).toBe(2500);
    // … and the settled ledger now says the same thing.
    expect(sumCollectedPayments(ledger)).toBe(result.newBookingPaidAmount);
  });

  it("a genuinely pending liability is still a liability", () => {
    // The BR-04 guest-remove path opens a pending liability with
    // `status: "pending"` — the fix must NOT change that.
    expect(isUnpaidRefund({ amount: -100, type: "refund", status: "pending" })).toBe(true);
  });
});
