import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Per QA §3.7 (2026-10-26): the store order state machine has to be
// server-owned.
//
// The defect: the desk's order actions were a raw client-side Firestore
// write, so the state machine existed only as UI BUTTONS. A staff client
// could write any status onto any order — including cancelling a
// DELIVERED order whose direct payment had already been collected. The
// result was a cancelled order still holding a cash tender, and a
// reconciliation delta that never closed.
//
// This guard pins the fix at the client boundary: the admin app must
// not write a store order's status to Firestore itself, and the server
// endpoint it calls must be staff-authenticated and must refuse a
// tendered order.

const root = resolve(__dirname, "../../..");
const context = readFileSync(resolve(root, "admin-app/src/context/AdminContext.tsx"), "utf8");
const bookings = readFileSync(resolve(root, "admin-app/src/pages/BookingsPage.tsx"), "utf8");
const router = readFileSync(resolve(root, "guest-app/server/apiRouter.ts"), "utf8");
const storeHandler = readFileSync(resolve(root, "guest-app/server/handlers/store.ts"), "utf8");

// The body of `updateStoreOrderStatus`, which is what the drawer's
// buttons call.
const statusUpdater = context.slice(
  context.indexOf("const updateStoreOrderStatus"),
  context.indexOf("const billStoreOrder")
);

describe("QA §3.7 — the store order state machine is server-owned", () => {
  it("routes every staff status transition through the server", () => {
    expect(statusUpdater).toMatch(/\/api\/store\/deliver-order/);
    expect(statusUpdater).toMatch(/\/api\/store\/confirm-order/);
    expect(statusUpdater).toMatch(/\/api\/store\/update-order-status/);
  });

  it("never writes a store order's status to Firestore from the client", () => {
    // The client-side `runTransaction` and the bare `updateDoc` were
    // the defect: they were the only place the transitions happened,
    // and they enforced nothing.
    expect(statusUpdater).not.toMatch(/runTransaction\(/);
    expect(statusUpdater).not.toMatch(/updateDoc\(/);
  });

  it("exposes the new transition as a staff-authenticated server route", () => {
    expect(router).toMatch(
      /action === "update-order-status"[\s\S]*?authenticateStaff\(req\)[\s\S]*?handleStaffStoreOrderStatus/
    );
  });

  it("refuses a transition on an order whose payment was already collected", () => {
    // THE TENDER GUARD — the money is already collected, so the order
    // can only be REFUNDED, not voided.
    expect(storeHandler).toMatch(/STORE_TENDER_DOC_ID/);
    expect(storeHandler).toMatch(/ORDER_ALREADY_PAID/);
    expect(storeHandler).toMatch(
      /tenderDoc[\s\S]{0,400}?ORDER_ALREADY_PAID/
    );
  });

  it("gives the desk a refusal instead of a silent failure", () => {
    // The old client-side path failed as an unhandled promise
    // rejection, and the drawer showed the order as cancelled anyway.
    expect(bookings).toMatch(/await updateStoreOrderStatus\(selectedOrder\.id, "cancelled"/);
    expect(bookings).toMatch(/toast\.error\("Could not cancel the order"/);
    expect(bookings).toMatch(/await updateStoreOrderStatus\(selectedOrder\.id, "confirmed"\)/);
    expect(bookings).toMatch(/toast\.error\("Could not confirm the order"/);
    expect(bookings).toMatch(/await updateStoreOrderStatus\(selectedOrder\.id, "out-for-delivery"\)/);
    expect(bookings).toMatch(/toast\.error\("Could not dispatch the order"/);
  });

  it("tells the guest when the desk cancels their order", () => {
    // The drawer promises "The guest will be notified by email" — the
    // client-side cancel sent no email at all.
    expect(storeHandler).toMatch(/sendStoreOrderTrigger\(\s*"store-order-cancelled"/);
    // And a paid GCash order needs a refund review with an owner.
    expect(storeHandler).toMatch(/sendStaffRefundReviewTrigger\(/);
  });
});
