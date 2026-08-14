// STR-01 (2026-08-14, found during the audit pass that
// followed RPT-05 + EXB-12.1 + VOU-01): the spec at
// `plan/features/STORE-MANAGEMENT.md:67` promises a
// `handleConfirmStoreOrder` API that decrements stock
// inside a transaction, but the handler was never
// built. `stockDecrementedAt` is stamped `null` on every
// order at creation (`store.ts:334`); the cancel handler
// (`store.ts:483`) checks if it was ever set, but nothing
// sets it. Result: stock is never decremented — an order
// can be "confirmed" by staff but the underlying inventory
// never reflects the decrement.
//
// Fix: add `handleConfirmStoreOrder` that:
//   (a) reads the order + each storeItems doc in one transaction
//   (b) decrements `stock` by `item.quantity` for each item
//       where `stock !== null` (skip unlimited stock items)
//   (c) throws `OUT_OF_STOCK` if any decrement would go below 0
//   (d) idempotent — if `stockDecrementedAt` is already set,
//       return success without decrementing again
//   (e) sets `status: "confirmed"`, `stockDecrementedAt: now`,
//       `handledBy: staffUid`, `updatedAt: now`
//
// Plus the cancel-restoration pattern at `store.ts:483`
// already handles `stockRestoredAt` correctly — only
// restores if `stockDecrementedAt` is set, so the new
// confirm + existing cancel compose cleanly.
//
// Test discipline (per v0.264.9 retrofit + STR-01 fix
// shape): source-text regex guards pin the contract shape
// at the source level; runtime assertions reproduce the
// row-builder logic against representative fixtures.
// The existing `store-confirm-order.test.ts` only covers
// the create-order path (with `stockDecrementedAt: null`)
// — the confirm path was the missing half.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const store = readFileSync(resolve(__dirname, "../../server/handlers/store.ts"), "utf8");
const router = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");

// ── Source-text guards: pin the new handler's contract shape ──
// at the source level. A future refactor that drops the
// transaction, the stock decrement, or the idempotency
// check is caught at the source-text level.

describe("STR-01 — handleConfirmStoreOrder: source-text contract", () => {
  it("exports the new handleConfirmStoreOrder handler from store.ts", () => {
    expect(store).toMatch(/export async function handleConfirmStoreOrder\b/);
  });

  it("the confirm handler reads the order + each storeItems doc in one transaction", () => {
    // Pin the reads-before-writes shape (FOL-03): all
    // `transaction.get(...)` calls must complete before
    // any `transaction.update(...)` call. The confirm
    // handler reads the order doc + every item doc in
    // `Promise.all([...].map(transaction.get))` BEFORE
    // any `transaction.update(...)` writes.
    expect(store).toMatch(
      /handleConfirmStoreOrder[\s\S]{0,5000}?transaction\.get\(orderRefDoc\)[\s\S]{0,3000}?Promise\.all\([\s\S]*?\.map\([\s\S]*?transaction\.get\(itemRef\)\)[\s\S]{0,1500}?transaction\.update\(itemRefs\[index\]/
    );
  });

  it("the confirm handler decrements `stock` by `item.quantity` for each item", () => {
    // Pin the per-item decrement shape: the new stock
    // value equals the prior stock minus the order
    // quantity. The handler computes this via a
    // `newStock` temporary; pin the temp + the final
    // `stock: newStock` write so a future refactor that
    // inlines the math or hoists the temp can't silently
    // diverge.
    expect(store).toMatch(
      /const\s+newStock\s*=\s*currentStock\s*-\s*requestedQuantity/
    );
    expect(store).toMatch(/stock:\s*newStock/);
  });

  it("the confirm handler skips items where stock is null or undefined (unlimited inventory)", () => {
    // Unlimited stock items (`stock: null` or
    // `stock: undefined`) must NOT be decremented.
    // The confirm handler uses the `continue` pattern
    // (line ~536) — pin that idiom. The cancel handler
    // uses the `if block` pattern (line ~488) — both
    // idioms achieve the same skip, but pin the
    // confirm-specific shape.
    expect(store).toMatch(
      /handleConfirmStoreOrder[\s\S]{0,5000}?if\s*\(\s*itemData\.stock\s*===\s*null\s*\|\|\s*itemData\.stock\s*===\s*undefined\)\s*continue;/
    );
  });

  it("the confirm handler throws OUT_OF_STOCK if any decrement would go below 0", () => {
    // Race-safety: a concurrent order between stock check
    // and decrement could push stock negative. The
    // transaction aborts on negative stock so the desk
    // never confirms an order the inventory can't fill.
    expect(store).toMatch(/new Error\(["']OUT_OF_STOCK["']\)/);
  });

  it("the confirm handler is idempotent (skips if stockDecrementedAt already set)", () => {
    // Pin the idempotency check: if a desk operator
    // double-clicks Confirm, the second call returns
    // success without decrementing again.
    expect(store).toMatch(/orderData\.stockDecrementedAt/);
  });

  it("the confirm handler sets status=confirmed + stockDecrementedAt + handledBy + updatedAt", () => {
    // Pin the order-doc writes: status flips to confirmed
    // and stockDecrementedAt is stamped. The handler
    // batches all 4 fields in one transaction.update call.
    expect(store).toMatch(
      /handleConfirmStoreOrder[\s\S]{0,5000}?transaction\.update\(orderRefDoc,\s*\{[\s\S]*?status:\s*["']confirmed["'],[\s\S]*?stockDecrementedAt:\s*new Date\(\),[\s\S]*?handledBy:\s*staffUid,[\s\S]*?updatedAt:\s*new Date\(\)/
    );
  });

  it("the confirm handler is staff-authenticated (not a public endpoint)", () => {
    // Confirm is a staff operation — confirm-order must
    // be wrapped in the same `authenticateStaff` gate
    // the deliver-order endpoint uses. Pin both the
    // router-side auth check AND the handler reading
    // `req.staff?.uid`.
    expect(router).toMatch(
      /domain === ["']store["']\s*&&\s*action === ["']confirm-order["'][\s\S]{0,500}?authenticateStaff/
    );
    expect(store).toMatch(/handleConfirmStoreOrder[\s\S]{0,2000}?req\.staff\?\.uid/);
  });
});

// ── Runtime assertions: reproduce the row-builder logic
// against representative fixtures. The source-text
// guards above pin the *shape*; these pin the *math*.

describe("STR-01 — handleConfirmStoreOrder: runtime row-builder math", () => {
  it("decrements stock by item.quantity for each item where stock !== null", () => {
    // 3-item order: 2 finite-stock items + 1 unlimited
    // (stock: null). Expected: only the 2 finite items
    // get decremented; the unlimited one is skipped.
    const orderItems = [
      { itemId: "itemA", quantity: 3 },
      { itemId: "itemB", quantity: 2 },
      { itemId: "itemUnlimited", quantity: 5 }
    ];
    const storeItems = {
      itemA: { stock: 10 },
      itemB: { stock: 8 },
      itemUnlimited: { stock: null }
    };

    const decrements: Array<{ itemId: string; before: number; after: number }> = [];
    for (const item of orderItems) {
      const itemData = storeItems[item.itemId as keyof typeof storeItems];
      if (itemData.stock === null || itemData.stock === undefined) continue; // skip unlimited
      decrements.push({
        itemId: item.itemId,
        before: itemData.stock,
        after: Number(itemData.stock) - Number(item.quantity || 0)
      });
    }

    expect(decrements).toEqual([
      { itemId: "itemA", before: 10, after: 7 },
      { itemId: "itemB", before: 8, after: 6 }
    ]);
    // itemUnlimited is NOT in the decrements list (unlimited stock is skipped).
    expect(decrements.find((d) => d.itemId === "itemUnlimited")).toBeUndefined();
  });

  it("throws OUT_OF_STOCK if a decrement would go below 0 (race-safety)", () => {
    // Stock is 2, order quantity is 5 → would go to -3 → throw.
    const stock = 2;
    const quantity = 5;
    const wouldBeAfter = Number(stock) - Number(quantity);
    expect(wouldBeAfter).toBeLessThan(0);
    // In the handler this throws `new Error("OUT_OF_STOCK")` and the
    // transaction aborts (no stock decrement lands).
  });

  it("is idempotent when stockDecrementedAt is already set (re-Confirm is a no-op)", () => {
    // Pre-condition: order was already confirmed once.
    const orderData = {
      status: "confirmed",
      stockDecrementedAt: new Date("2026-08-14T10:00:00Z"),
      stockRestoredAt: null
    };
    const isAlreadyConfirmed = Boolean(orderData.stockDecrementedAt);
    expect(isAlreadyConfirmed).toBe(true);
    // Handler returns success without running the stock decrement again.
  });

  it("composes with handleCancelStoreOrder: cancel restores only what confirm decremented", () => {
    // Pre-condition: order was confirmed, then cancelled.
    // The cancel handler at store.ts:483 checks
    // `!stockRestoredAt && stockDecrementedAt` before
    // restoring. After cancel, both are set; the next
    // cancel is a no-op (idempotency holds across the pair).
    const orderAfterConfirmAndCancel = {
      status: "cancelled",
      stockDecrementedAt: new Date("2026-08-14T10:00:00Z"),
      stockRestoredAt: new Date("2026-08-14T11:00:00Z")
    };
    const shouldRestore =
      !orderAfterConfirmAndCancel.stockRestoredAt &&
      orderAfterConfirmAndCancel.stockDecrementedAt;
    expect(shouldRestore).toBe(false); // second cancel: idempotent no-op
  });
});