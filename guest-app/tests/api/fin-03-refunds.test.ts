import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const router = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-03 refund API", () => {
  it("requires an admin approval and a reason", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?req\.staff\?\.role !== "admin"/);
    expect(handler).toMatch(/Refund method and reason are required/);
    expect(handler).toMatch(/approvedBy/);
  });

  it("uses a transaction and rejects refunds above net collections", () => {
    expect(handler).toMatch(/handleAddRefund[\s\S]+?runTransaction/);
    expect(handler).toMatch(/numericAmount > netCollected/);
    expect(handler).toMatch(/amount: -numericAmount/);
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

  it("checks for an existing refund with the same refundId inside the transaction", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/existingRefund/);
    expect(body).toMatch(/docSnap\.id === refundId/);
  });

  it("replays the existing record on an exact match (idempotent)", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/sameRequest/);
    expect(body).toMatch(/Math\.abs\(Number\(existingData\.amount \|\| 0\)\) === numericAmount/);
    expect(body).toMatch(/String\(existingData\.method \|\| ""\) === safeMethod/);
    expect(body).toMatch(/String\(existingData\.note \|\| ""\) === safeReason/);
    expect(body).toMatch(/\(existingData\.transactionReference \|\| null\) === safeTransactionReference/);
    expect(body).toMatch(/idempotentReplay = true/);
  });

  it("rejects same-ID-different-fields as a 409 conflict", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/Refund ID has already been used for a different refund\./);
    expect(body).toMatch(/res\.status\(409\)/);
  });

  it("creates the ledger entry with the exact preallocated refundId (no overwrite path)", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/transaction\.create\(paymentsRef\.doc\(refundId\)/);
    // transaction.set on a fresh doc is forbidden — set would overwrite a
    // previous server-side race winner, which would defeat the contract.
    expect(body).not.toMatch(/transaction\.set\(paymentsRef\.doc\(refundId\)/);
  });

  it("preserves the existing admin gate, amount ceiling, and append-only ledger", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/req\.staff\?\.role !== "admin"/);
    expect(body).toMatch(/numericAmount > 1_000_000/);
    expect(body).toMatch(/numericAmount > netCollected/);
    expect(body).toMatch(/type: "refund"/);
    expect(body).toMatch(/amount: -numericAmount/);
  });

  it("returns the idempotent-replay flag in the response payload", () => {
    const body = isolateHandleAddRefund();
    expect(body).toMatch(/idempotentReplay/);
    expect(body).toMatch(/netCollected: netCollected - numericAmount/);
  });
});
