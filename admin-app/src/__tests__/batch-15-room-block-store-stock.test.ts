import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 15 — two decided-but-unimplemented
// SEV-2s from the original audit:
//
//   * #78 (1.1 SEV-2 #11) — Room block uses structured `blockedFrom` /
//     `blockedTo` Firestore Timestamps (not the legacy free-form
//     `blockReason` string that baked the date range into a single
//     human-readable field).
//   * #80 (1.3 SEV-2 #2a) — Store stock decremented on `confirmed`,
//     not `placed` (reverses the contradicting STORE-MANAGEMENT.md
//     text that suggested decrements happen on `placed`).
//
// This is a source-pattern test. The behavioral contract of the
// transactions is in `guest-app/api/handlers/store.ts` and
// `admin-app/src/context/AdminContext.tsx`.

const storeHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/store.ts"),
  "utf8"
);
const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const corpInquiriesHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/corporate-inquiries.ts"),
  "utf8"
);
const adminCtxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 15 — room block + store stock are spec-compliant", () => {
  describe("#78 — Room block uses structured blockedFrom / blockedTo Timestamps", () => {
    it("AdminContext.addRoomBlock writes blockedFrom + blockedTo as Timestamps", () => {
      const blockMatch = adminCtxSrc.match(
        /const\s+addRoomBlock\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(blockMatch, "expected to find addRoomBlock").toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/blockedFrom:\s*Timestamp\.fromDate\(fromDate\)/);
      expect(body).toMatch(/blockedTo:\s*Timestamp\.fromDate\(toDate\)/);
    });

    it("AdminContext.addRoomBlock no longer embeds the date range in blockReason", () => {
      const blockMatch = adminCtxSrc.match(
        /const\s+addRoomBlock\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(blockMatch).toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/blockReason:\s*reason/);
      expect(body).not.toMatch(/blockReason:\s*`\$\{reason\}\s*\(/);
    });

    it("Room type has blockedFrom + blockedTo as string | null", () => {
      const roomTypeMatch = adminCtxSrc.match(
        /export\s+interface\s+Room\s*\{[\s\S]*?\n\}/
      );
      expect(roomTypeMatch, "expected to find Room interface").toBeTruthy();
      const body = roomTypeMatch![0];
      expect(body).toMatch(/blockedFrom:\s*string\s*\|\s*null/);
      expect(body).toMatch(/blockedTo:\s*string\s*\|\s*null/);
      expect(body).toMatch(/blockReason:\s*string/);
    });

    it("AdminContext room snapshot maps the new blockedFrom/blockedTo fields", () => {
      expect(adminCtxSrc).toMatch(/blockedFrom:\s*parseDateString\(data\.blockedFrom\)/);
      expect(adminCtxSrc).toMatch(/blockedTo:\s*parseDateString\(data\.blockedTo\)/);
    });

    it("bookings.ts handleCreateBooking + handleCreateWalkin honor the blockedFrom/blockedTo window", () => {
      // Both create handlers used to reject on status === "blocked" alone,
      // which meant a room that was blocked for a past window would still
      // block a future booking. Now they check the window vs the requested
      // checkIn / checkOut.
      //
      // Per MRB-07 (2026-08-02, per decision #159): handleCreateWalkin
      // reads every room in the reservation in a loop, so its room doc
      // is bound as `lineRoomData` rather than `roomData`. The guard
      // itself is unchanged — each room still compares the requested
      // stay against its own blocked window. Matching the window
      // computation directly (rather than an open-ended span from the
      // `status === "blocked"` check) keeps this from drifting onto the
      // check-in handler's unrelated hard reject.
      const windowGuards = bookingsHandlerSrc.match(
        /const blockedFrom = toDateOrNull\((roomData|lineRoomData|cData)\.blockedFrom\);\s*const blockedTo = toDateOrNull\(\1\.blockedTo\);\s*const windowActive = blockedFrom && blockedTo\s*\?\s*checkInDate < blockedTo && checkOutDate > blockedFrom/g
      );
      expect(windowGuards, "expected to find the blocked-window guards").toBeTruthy();
      // One guard per create path: the public create's candidate loop
      // and the walk-in's per-room-stay loop.
      expect(windowGuards!.length).toBeGreaterThanOrEqual(2);
      // Each guard is only reached when the room is actually blocked.
      expect(
        bookingsHandlerSrc.match(
          /if\s*\(\s*(?:roomData|lineRoomData|cData)\.status\s*===\s*["']blocked["']\s*\)/g
        )!.length
      ).toBeGreaterThanOrEqual(2);
    });

    it("corporate-inquiries.ts convert handler also honors the blockedFrom/blockedTo window", () => {
      expect(corpInquiriesHandlerSrc).toMatch(/if\s*\(\s*roomData\.status\s*===\s*["']blocked["']\s*\)\s*\{[\s\S]*?windowActive[\s\S]*?\}/);
    });
  });

  describe("#80 — Store stock decrements on confirmed, not on placed", () => {
    it("handleCreateStoreOrder no longer decrements stock at order creation", () => {
      // The legacy decrement block lived inside the create transaction
      // (status === "placed"). It is now gone — the file's create
      // function should NOT contain the legacy arithmetic.
      const createFnMatch = storeHandlerSrc.match(
        /async\s+function\s+handleCreateStoreOrder\s*\([\s\S]*?\n\}/
      );
      expect(createFnMatch, "expected to find handleCreateStoreOrder body").toBeTruthy();
      const body = createFnMatch![0];
      // No more per-item transaction.update that decrements stock here.
      expect(body).not.toMatch(/itemData\.stock\s*-\s*orderItem\.quantity/);
      // The new contract is exposed on the order doc.
      expect(body).toMatch(/stockDecrementedAt:\s*null/);
    });

    it("handleCreateStoreOrder initializes stockDecrementedAt to null on the order doc", () => {
      expect(storeHandlerSrc).toMatch(/async\s+function\s+handleCreateStoreOrder[\s\S]*?stockDecrementedAt:\s*null/);
    });

    it("handleCancelStoreOrder only restores stock when the order was actually decremented", () => {
      const cancelMatch = storeHandlerSrc.match(
        /async\s+function\s+handleCancelStoreOrder\s*\([\s\S]*?\}\s*;/
      );
      expect(cancelMatch, "expected to find handleCancelStoreOrder body").toBeTruthy();
      const body = cancelMatch![0];
      // Guard: only restore if stock was decremented AND not yet restored.
      expect(body).toMatch(/!orderData\.stockRestoredAt\s*&&\s*orderData\.stockDecrementedAt/);
    });

    it("AdminContext.updateStoreOrderStatus decrements stock on the placed -> confirmed transition", () => {
      const fnMatch = adminCtxSrc.match(
        /const\s+updateStoreOrderStatus\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(fnMatch, "expected to find updateStoreOrderStatus").toBeTruthy();
      const body = fnMatch![0];
      // The function now has a confirmed branch in the transaction.
      expect(body).toMatch(/orderData\.status\s*===\s*["']placed["']\s*&&\s*!orderData\.stockDecrementedAt/);
      expect(body).toMatch(/stockDecrementedAt:\s*serverTimestamp\(\)/);
      // The decrement arithmetic lives in this branch.
      expect(body).toMatch(/Number\(stock\s*\|\|\s*0\)\s*-\s*Number\(orderItems\[index\]\.quantity\s*\|\|\s*0\)/);
    });

    it("StoreOrder type exposes stockDecrementedAt for the client", () => {
      const typeMatch = adminCtxSrc.match(
        /export\s+interface\s+StoreOrder\s*\{[\s\S]*?\n\}/
      );
      expect(typeMatch).toBeTruthy();
      expect(typeMatch![0]).toMatch(/stockDecrementedAt:\s*string\s*\|\s*null/);
    });
  });
});
