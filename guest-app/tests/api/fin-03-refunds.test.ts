import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const helper = readFileSync(resolve(__dirname, "../../server/lib/refunds.ts"), "utf8");
const router = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-03 refund API", () => {
  it("requires an admin approval and a reason", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?req\.staff\?\.role !== "admin"/);
    expect(handler).toMatch(/Refund method and reason are required/);
    expect(helper).toMatch(/approvedBy/); // BR-06 — paidAmount decrement + audit row; approvedBy still stamped on the entry
  });

  it("uses a transaction and rejects refunds above net collections", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?runTransaction/);
    expect(handler).toMatch(/numericAmount > netCollected/);
    // BR-06 — `amount: -numericAmount` line moved from bookings.ts into the unified `markRefundPaid` helper.
    expect(helper).toMatch(/amount: -safeAmount/);
  });

  it("keeps all payment-ledger writes server-authoritative and immutable", () => {
    expect(router).toMatch(/action === "add-refund"[\s\S]+?authenticateStaff/);
    expect(rules).toMatch(/match \/payments\/\{paymentId\}[\s\S]+?allow create: if false/);
    expect(rules).toMatch(/allow update, delete: if false/);
  });
});

describe("CRL-01 refund idempotency", () => {
  // The client preallocates the refundId so a retry after an uncertain
  // response (network blip, the staff tab being closed mid-submit) cannot
  // append a second refund entry. Mirrors the handleAddPayment contract:
  // exact replay returns the existing record, same ID with different
  // fields returns 409, server uses transaction.create (not set) so a
  // server-side race still throws rather than overwriting.
  //
  // BR-06 (#235, 2026-10-13): the `sameRequest` +
  // `idempotentReplay` + 409 conflict logic moved from
  // `handleAddRefund` to the unified `markRefundPaid`
  // helper in `server/lib/refunds.ts` (see the BR-06
  // helper-side tests in `br-06-refunds-extension.test.ts`).
  // The handler still owns the validation + the
  // `idempotentReplay` flag in the response payload;
  // the helper owns the idempotency + 409 + create +
  // paidAmount decrement + (breakfast-only) audit row.

  function isolateHandleAddRefund() {
    const start = handler.indexOf("export async function handleAddRefund");
    expect(start).toBeGreaterThanOrEqual(0);
    // Stop at the next export async function (handleMarkPaymentConfirmed).
    const next = handler.indexOf("export async function handleMarkPaymentConfirmed", start);
    expect(next).toBeGreaterThan(start);
    return handler.slice(start, next);
  }

  it("requires and validates a client-preallocated refundId", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/refundId[\s\S]+?PREALLOCATED_PAYMENT_ID_REGEX\.test/);
    expect(body).toMatch(/A valid refund ID is required\./);
  });

  it("checks for an existing refund with the same refundId inside the transaction (helper-delegated, BR-06)", () => {
    const body = isolateHandleAddRefund();
    // BR-06 — pre-read is now the `refundDocRef` + `refundDocSnap`
    // pattern (the handler passes `existingDoc` to the helper).
    expect(body).toMatch(/refundDocRef/);
    expect(body).toMatch(/refundDocSnap/);
    expect(helper).toMatch(/existingDoc/);
  });

  it("replays the existing record on an exact match (idempotent, BR-06)", () => {
    const body = isolateHandleAddRefund();
    // BR-06 — the helper owns the `sameRequest` / `alreadyPaid`
    // math; the handler surfaces it via `helperResult.alreadyPaid`
    // + `helperResult.conflict`.
    expect(body).toMatch(/helperResult\.alreadyPaid/);
    expect(body).toMatch(/idempotentReplay = true/);
    expect(helper).toMatch(/sameRequest/);
    expect(helper).toMatch(/Math\.abs\(Number\(existingData\.amount \|\| 0\)\) === safeAmount/);
    expect(helper).toMatch(/String\(existingData\.method \|\| ""\) === safeMethod/);
  });

  it("rejects same-ID-different-fields as a 409 conflict", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/Refund ID has already been used for a different refund\./);
    expect(body).toMatch(/res\.status\(409\)/);
  });

  it("creates the ledger entry with the exact preallocated refundId (helper-delegated, BR-06)", () => {
    const body = isolateHandleAddRefund();
    // BR-06 — the `transaction.create(refundsRef.doc(refundId), …)`
    // line moved into the unified helper. The handler now reads
    // `refundDocRef = refundsRef.doc(refundId)` + passes the
    // pre-read snapshot to `markRefundPaid`. The helper then
    // calls `transaction.create(refundRef, newRecord)` which
    // covers BOTH the new-reservation +
    // legacy-null-`reservationId` paths.
    expect(body).toMatch(/refundsRef\.doc\(refundId\)/);
    expect(body).toMatch(/markRefundPaid/);
    expect(helper).toMatch(/transaction\.create\(refundRef, newRecord\)/);
    // transaction.set on a fresh doc is still forbidden — the
    // helper uses create() so a race still throws ALREADY_EXISTS
    // rather than overwriting.
    expect(helper).not.toMatch(/transaction\.set\(refundRef/);
  });

  it("preserves the existing admin gate, amount ceiling, and append-only ledger (BR-06)", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/req\.staff\?\.role !== "admin"/);
    expect(body).toMatch(/numericAmount > 1_000_000/);
    expect(body).toMatch(/numericAmount > netCollected/);
    // BR-06 — `type: "refund"` lives on the helper's new
    // entry shape (one source of truth for the create row).
    expect(helper).toMatch(/type: "refund"/);
    expect(helper).toMatch(/amount: -safeAmount/);
  });

  it("returns the idempotent-replay flag in the response payload", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/idempotentReplay/);
    // BR-06 — the `netCollected - numericAmount` line still
    // appears in the response payload; the math now reads
    // the helper's `newBookingPaidAmount`.
    expect(body).toMatch(/netCollected: netCollected - numericAmount/);
  });
});

