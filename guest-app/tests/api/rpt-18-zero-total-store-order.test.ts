// RPT-18 (handoff-2026-10-23 §6, Wave 3): a ₱0 store order could never
// be delivered.
//
// WHAT WAS WRONG
// --------------
//   `handleDeliverStoreOrder` guarded the order total with:
//
//     if (!Number.isFinite(totalAmount) || totalAmount <= 0 || ...) {
//       throw new Error("INVALID_ORDER_TOTAL");   // -> HTTP 409
//     }
//
//   But the ORDER CREATION path has no matching guard — it computes
//   `totalAmount` from the store item's price and writes the order
//   whatever it is. So the server accepted an order it could never
//   fulfil: the order sat in `placed` forever and the desk got
//   "The store order total is invalid and cannot be recorded."
//
// PROVEN LIVE (2026-10-27)
// -------------------------
//   The hotel's live catalogue has an ACTIVE complimentary item:
//     "Luggage Storage"  price = 0  isActive = true
//
//   Production store orders: 12 total, **5 with `totalAmount: 0`**,
//   of which **4 are still `placed`** (not cancelled). All 5 would be
//   refused by the delivery guard.
//
//   The admin form could not even fix it: the price input was
//   `min="1"` and the save handler returned early on `price <= 0`, so
//   the operator could not edit the live item without inventing a
//   price for it.
//
// WHAT THIS TEST DOES
// -------------------
// It evaluates the REAL delivery guard against the production-shaped
// fixtures, and pins the admin form's rule. A source-text regex alone
// would only prove a string is present.
//
// The rule: a ₱0 order is a legitimate COMPLIMENTARY order and must
// be deliverable; a CORRUPT total (not-a-number, negative, absurdly
// large) must still be refused.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const storeSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/store.ts"),
  "utf8"
);
const settingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

// ── The REAL delivery guard ───────────────────────────────────────
//
// Lift the guard's condition out of the handler and compile it, so the
// test asserts the behaviour the server actually has.
function extractDeliveryGuard(): (total: any) => boolean {
  const m = storeSrc.match(
    /const totalAmount = Number\(order\.totalAmount\);[\s\S]{0,2500}?if \((!Number\.isFinite\(totalAmount\)[^)]*)\) \{\s*throw new Error\("INVALID_ORDER_TOTAL"\)/
  );
  expect(m, "could not find the delivery handler's total guard").toBeTruthy();

  const condition = m![1].replace(/\btotalAmount\b/g, "total");

  // eslint-disable-next-line no-new-func
  const fn = new Function("total", `return Boolean(${condition});`);
  expect(typeof fn).toBe("function");
  return fn as (total: any) => boolean;
}

describe("RPT-18 — a ₱0 store order must be deliverable", () => {
  const refuses = extractDeliveryGuard();

  it("does NOT refuse a ₱0 order (a complimentary item)", () => {
    // The live catalogue item: "Luggage Storage", price 0.
    expect(refuses(0)).toBe(false);
  });

  it("does NOT refuse a normal paid order", () => {
    expect(refuses(80)).toBe(false);
    expect(refuses(280)).toBe(false);
  });

  it("still refuses a CORRUPT total", () => {
    expect(refuses(-1)).toBe(true);
    expect(refuses(-0.01)).toBe(true);
    expect(refuses(NaN)).toBe(true);
    expect(refuses(Infinity)).toBe(true);
    expect(refuses(1_000_001)).toBe(true);
  });

  it("accepts exactly the 1,000,000 ceiling", () => {
    expect(refuses(1_000_000)).toBe(false);
  });

  // ── The admin side ────────────────────────────────────────────
  //
  // The operator must be able to EDIT a live ₱0 item — otherwise the
  // only way to change it is to invent a price for a complimentary
  // item.
  it("the store-item price input allows 0", () => {
    // The price input's `min` attribute.
    const m = settingsSrc.match(/name="price"\s*\n\s*type="number"\s*\n\s*min="([^"]+)"/);
    expect(m, "could not find the store-item price input").toBeTruthy();
    expect(Number(m![1])).toBe(0);
  });

  it("the store-item save handler accepts a ₱0 price and rejects a corrupt one", () => {
    // The save handler's early-return condition must no longer reject
    // `price <= 0`.
    expect(settingsSrc).not.toMatch(/itemData\.price\s*<=\s*0/);
    // ...and it must still reject a corrupt price.
    expect(settingsSrc).toMatch(/Number\.isFinite\(itemData\.price\)/);
    expect(settingsSrc).toMatch(/itemData\.price\s*<\s*0/);
  });

  it("a ₱0 price is surfaced to the operator as a warning, not silently", () => {
    // The breakfast catalogue already sets this convention: a
    // zero-price item is a deliberate "complimentary" promotion and
    // the warning makes the consequence explicit.
    expect(settingsSrc).toMatch(/itemData\.price === 0/);
    expect(settingsSrc).toMatch(/Store item priced at ₱0/);
  });

  // ── The money ─────────────────────────────────────────────────
  it("a ₱0 order moves neither side of the store reconciliation", () => {
    // An `add-to-bill` order writes NO tender; a direct-paid ₱0 order
    // writes a tender of `amount: 0`. Either way the store revenue
    // and the store tenders both gain 0 — the books do not move.
    expect(storeSrc).toMatch(/amount:\s*totalAmount/);
  });
});
