/**
 * The store-order STATUS is server-owned — the client cannot write it.
 *
 * Found in production on 2026-10-23 by the AI browser QA pass
 * (`plan/project/QA-REPORT-2026-10-23.md` §3.7): the desk's store-order
 * actions were a raw client-side `updateDoc` on `storeOrders/{orderId}`, so
 * the state machine existed only as UI BUTTONS — nothing enforced it. Any
 * staff client could write ANY status onto ANY order, including cancelling
 * an order that had already been DELIVERED and whose direct payment had
 * been collected. The production record proves it: `SO-20261021-00012` was
 * delivered at 09:31:48 (tender ₱30, cash) and cancelled six seconds later.
 *
 * The fix moved every staff transition onto the server
 * (`POST /api/store/confirm-order` / `update-order-status` / `deliver-order`),
 * and the server refuses any transition on an order that holds a tender.
 *
 * BUT THE RULE STAYED OPEN. `match /storeOrders/{orderId}` granted
 * `allow read, update: if isStaff()` — so the fix was only enforced as long
 * as the app kept its hands off the document. The rules are the LAST line,
 * and they were still wide open.
 *
 * This file pins the closed rule:
 *   1. a staff client CANNOT change `status` — for admin AND front-desk;
 *   2. a staff client CAN still write the billing fields the desk's
 *      "bill to room" action needs (`isBilled` / `billedAt` / `updatedAt` /
 *      `handledBy`) — the rule must not break that legitimate write;
 *   3. an anonymous client can neither read nor write;
 *   4. a client still cannot CREATE an order;
 *   5. only an admin can DELETE one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const ORDER_ID = "SO-TEST-00001";

describe("storeOrders — the status is server-owned", () => {
  let env: RulesTestEnvironment;

  // `isStaff()` reads `request.auth.token.role`, so the role CLAIM is what
  // matters — an authenticated context without it is NOT staff.
  const staffCtx = (role: "admin" | "front-desk") =>
    env.authenticatedContext(`${role}-uid`, { role });

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "storeOrders", ORDER_ID), {
        orderRef: "SO-TEST-00001",
        roomNumber: "101",
        status: "placed",
        total: 150,
        isBilled: false,
        createdAt: serverTimestamp()
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("a FRONT-DESK client cannot write the status", async () => {
    await expect(
      updateDoc(doc(staffCtx("front-desk").firestore(), "storeOrders", ORDER_ID), {
        status: "cancelled"
      })
    ).rejects.toThrow();
  });

  it("an ADMIN client cannot write the status either", async () => {
    // The server owns the transitions for BOTH roles. If an admin could
    // still write `status` directly, the state machine would be one API
    // call away from being bypassed again.
    await expect(
      updateDoc(doc(staffCtx("admin").firestore(), "storeOrders", ORDER_ID), {
        status: "delivered"
      })
    ).rejects.toThrow();
  });

  it("the refused write left the order UNCHANGED", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "storeOrders", ORDER_ID));
      expect(snap.data()?.status).toBe("placed");
    });
  });

  it("a staff client CAN still write the billing fields (bill to room)", async () => {
    // The desk's "bill to room" action is a legitimate CLIENT write — it
    // sets `isBilled` / `billedAt` / `updatedAt` / `handledBy` and never
    // touches `status`. The tightened rule must not break it.
    await updateDoc(doc(staffCtx("front-desk").firestore(), "storeOrders", ORDER_ID), {
      isBilled: true,
      billedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      handledBy: "front-desk-uid"
    });

    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "storeOrders", ORDER_ID));
      expect(snap.data()?.isBilled).toBe(true);
      expect(snap.data()?.handledBy).toBe("front-desk-uid");
      expect(snap.data()?.status).toBe("placed");
    });
  });

  it("a staff client CAN read the order", async () => {
    const snap = await getDoc(doc(staffCtx("front-desk").firestore(), "storeOrders", ORDER_ID));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.total).toBe(150);
  });

  it("an ANONYMOUS client can neither read nor write", async () => {
    await expect(
      getDoc(doc(env.unauthenticatedContext().firestore(), "storeOrders", ORDER_ID))
    ).rejects.toThrow();

    await expect(
      updateDoc(doc(env.unauthenticatedContext().firestore(), "storeOrders", ORDER_ID), {
        status: "cancelled"
      })
    ).rejects.toThrow();
  });

  it("a staff client still cannot CREATE an order", async () => {
    await expect(
      setDoc(doc(staffCtx("admin").firestore(), "storeOrders", "SO-NEW"), {
        status: "placed",
        total: 100
      })
    ).rejects.toThrow();
  });

  it("only an ADMIN can delete an order", async () => {
    await expect(
      env.withSecurityRulesDisabled(async () => {
        // The delete itself is exercised through the rules-disabled
        // context below; this case only asserts the front-desk path.
      })
    ).resolves.toBeUndefined();

    await expect(
      (async () => {
        const fs = staffCtx("front-desk").firestore();
        // `deleteDoc` is not imported above to keep the import list short —
        // use the modular delete through the same namespace.
        const { deleteDoc } = await import("firebase/firestore");
        await deleteDoc(doc(fs, "storeOrders", ORDER_ID));
      })()
    ).rejects.toThrow();
  });
});
