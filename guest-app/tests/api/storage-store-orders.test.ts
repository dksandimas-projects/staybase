import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #1: every guest who picks GCash at the in-room
// store was getting a 403 because firebase/storage.rules had no match
// block for store-orders/{roomNumber}/payment-proof/. See
// plan/project/AUDIT-E2E-2026-06-15.md §1.3 SEV-1 #1 and §1.7 SEV-1 (Storage).

describe("firebase/storage.rules — store-orders payment-proof path", () => {
  const rules = readFileSync(
    resolve(__dirname, "../../../firebase/storage.rules"),
    "utf8"
  );

  it("declares a match block for store-orders/{roomNumber}/payment-proof/", () => {
    expect(rules).toMatch(
      /match\s+\/store-orders\/\{roomNumber\}\/payment-proof\/\{fileName\}/
    );
  });

  it("allows staff to read the path", () => {
    const matchBlock = rules.match(
      /match\s+\/store-orders\/\{roomNumber\}\/payment-proof\/\{fileName\}\s*\{[^}]+\}/
    );
    expect(matchBlock, "store-orders match block not found").toBeTruthy();
    expect(matchBlock![0]).toMatch(/allow\s+read:\s+if\s+isStaff\(\)/);
    expect(matchBlock![0]).not.toMatch(/allow\s+get:\s+if\s+true/);
  });

  it("allows guests to write to the path, bounded by size and content type", () => {
    // Per PR-AUDIT-B7 (2026-10-20): the write was `if true`, so ANY
    // anonymous caller could upload an arbitrarily large object of any
    // type to any room's path. The write is now bound to the same
    // contract the client enforces (`image/jpeg` | `image/png` |
    // `image/webp`, ≤ 5 MB) and Firebase evaluates it server-side.
    const matchBlock = rules.match(
      /match\s+\/store-orders\/\{roomNumber\}\/payment-proof\/\{fileName\}\s*\{[^}]+\}/
    );
    expect(matchBlock, "store-orders match block not found").toBeTruthy();
    expect(matchBlock![0]).not.toMatch(/allow\s+write:\s*if\s+true/);
    expect(matchBlock![0]).toMatch(/request\.resource\.size\s*<\s*5 \* 1024 \* 1024/);
    expect(matchBlock![0]).toMatch(
      /request\.resource\.contentType\s+in\s+\[\s*"image\/jpeg"\s*,\s*"image\/png"\s*,\s*"image\/webp"\s*\]/
    );
  });
});
