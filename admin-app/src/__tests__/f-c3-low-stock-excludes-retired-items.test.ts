// F-C3 (handoff-2026-10-23 §6, Wave 3): the "Low Stock Alerts" panel
// listed SOFT-DELETED store items.
//
// WHAT WAS WRONG
// --------------
//   `deleteStoreItem` in the admin context is a SOFT delete: it sets
//   `isActive: false` + `deletedAt`, it does not remove the document.
//   The "Low Stock Alerts" panel on Reports → Sales filtered ONLY on
//   the stock level:
//
//     storeItems
//       .filter(item => item.stock !== null && item.stock <= threshold)
//
//   so a RETIRED item still raised a purchasing flag. The operator is
//   told to go and buy stock for a product the hotel no longer sells.
//
// PROVEN LIVE (2026-10-27)
// -------------------------
//   `settings/storeConfig.lowStockThreshold = 5`
//   `storeItems` = 11 documents
//   The panel flagged 3:
//     "A7 Inactive Test Item"  stock=3  isActive=false  <- RETIRED
//     "A7 Out Of Stock Test Item" stock=0 isActive=true
//     "Fresh Leche Flan"        stock=4  isActive=true
//
// WHAT THIS TEST DOES
// -------------------
// It extracts the REAL filter predicate from `ReportsPage.tsx` and
// runs it against the production-shaped fixture, so the test asserts
// what the panel actually renders — not that a string is present.
//
// The rule: a retired item must never raise a purchasing flag, and an
// ACTIVE item at the threshold still must.

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

// ── Extract the real low-stock predicate ──────────────────────────
//
// `lowStockItems` is a `useMemo` whose body is:
//
//   const lowStockItems = useMemo(() =>
//     storeItems
//       .filter(item => item.stock !== null && item.stock <= (storeConfig.lowStockThreshold || 3))
//       .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)),
//     [storeItems, storeConfig.lowStockThreshold]
//   );
//
// We lift the `.filter(...)` predicate out of the source and compile
// it, so the test breaks if the predicate changes shape.
function extractLowStockPredicate(): (item: any, threshold: number) => boolean {
  const memoStart = reports.indexOf("const lowStockItems = useMemo(");
  expect(memoStart, "ReportsPage.tsx no longer has a `lowStockItems` memo").toBeGreaterThan(-1);

  const memoEnd = reports.indexOf("[storeItems, storeConfig.lowStockThreshold]", memoStart);
  expect(memoEnd, "the lowStockItems memo's dependency array moved").toBeGreaterThan(memoStart);

  const body = reports.slice(memoStart, memoEnd);

  // The memo may chain SEVERAL `.filter(...)` calls — the retired-item
  // rule is one of them. Collect every filter's argument and apply
  // them all, in order, so the test asserts the panel's real
  // behaviour rather than one link of the chain.
  const filterArgs: string[] = [];
  let cursor = 0;
  while (true) {
    const filterStart = body.indexOf(".filter(", cursor);
    if (filterStart === -1) break;

    // Take the balanced parenthesis group that starts at `.filter(`.
    let depth = 0;
    let end = -1;
    for (let i = filterStart + ".filter".length; i < body.length; i++) {
      const ch = body[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    expect(end, "the .filter( call is not balanced").toBeGreaterThan(-1);

    filterArgs.push(body.slice(filterStart + ".filter(".length, end - 1));
    cursor = end;
  }
  expect(filterArgs.length, "the lowStockItems memo no longer filters").toBeGreaterThan(0);

  // Combine the chain into ONE predicate. Each `.filter(arg)` applies
  // `arg` to every item, so the chain is `arg1(item) && arg2(item)`.
  // (Joining the arrow functions with `&&` would evaluate the
  // FUNCTIONS, not their results — only the last filter would apply.)
  const combined = filterArgs
    .map((a) => `(${a.replace(/\bstoreConfig\.lowStockThreshold\s*\|\|\s*3\b/g, "threshold")})(item)`)
    .join(" && ");

  // The predicate is an arrow function taking ONE argument:
  //   item => item.stock !== null && item.stock <= threshold
  // The threshold comes from `storeConfig.lowStockThreshold || 3`,
  // which we rewrite to the injected `threshold` parameter.
  // Compile it as an EXPRESSION and CALL it, so the arrow function is
  // invoked with the item and the boolean comes back.
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "item",
    "threshold",
    `return (${combined});`
  );

  expect(typeof fn).toBe("function");
  return fn as (item: any, threshold: number) => boolean;
}

describe("F-C3 — the Low Stock Alerts panel must not flag RETIRED store items", () => {
  const isLowStock = extractLowStockPredicate();

  // ── The production-shaped fixture ───────────────────────────────
  //
  // These are the live production documents, as read on 2026-10-27.
  const productionItems = [
    { name: "A7 Inactive Test Item", stock: 3, isActive: false },
    { name: "A7 Out Of Stock Test Item", stock: 0, isActive: true },
    { name: "Fresh Leche Flan", stock: 4, isActive: true },
    { name: "Sprite Can", stock: 12, isActive: true },
    { name: "Cola Can", stock: null, isActive: true },
  ];
  const THRESHOLD = 5;

  it("flags the two ACTIVE low-stock items", () => {
    const flagged = productionItems.filter((i) => isLowStock(i, THRESHOLD));
    const names = flagged.map((i) => i.name).sort();
    expect(names).toEqual(["A7 Out Of Stock Test Item", "Fresh Leche Flan"]);
  });

  it("does NOT flag a retired item", () => {
    const retired = productionItems.find((i) => i.name === "A7 Inactive Test Item")!;
    expect(retired.isActive).toBe(false);
    expect(isLowStock(retired, THRESHOLD)).toBe(false);
  });

  it("does not flag an item with no stock tracked (null)", () => {
    const untracked = productionItems.find((i) => i.name === "Cola Can")!;
    expect(isLowStock(untracked, THRESHOLD)).toBe(false);
  });

  it("still flags an ACTIVE item exactly at the threshold", () => {
    expect(isLowStock({ name: "At threshold", stock: THRESHOLD, isActive: true }, THRESHOLD)).toBe(true);
  });

  it("does not flag an ACTIVE item above the threshold", () => {
    expect(isLowStock({ name: "Plenty", stock: THRESHOLD + 1, isActive: true }, THRESHOLD)).toBe(false);
  });

  // ── The source-level anchor ────────────────────────────────────
  //
  // The behavioural test above could pass if the predicate were
  // refactored into a helper that the memo no longer calls. Pin the
  // filter's own text so the rule travels with the code.
  it("the filter itself excludes inactive items", () => {
    const memoStart = reports.indexOf("const lowStockItems = useMemo(");
    const memoEnd = reports.indexOf("[storeItems, storeConfig.lowStockThreshold]", memoStart);
    const body = reports.slice(memoStart, memoEnd);
    expect(body).toMatch(/isActive/);
  });
});
