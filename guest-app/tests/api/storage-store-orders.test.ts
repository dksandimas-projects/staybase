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

  it("allows guests to write to the path (unauthenticated upload)", () => {
    const matchBlock = rules.match(
      /match\s+\/store-orders\/\{roomNumber\}\/payment-proof\/\{fileName\}\s*\{[^}]+\}/
    );
    expect(matchBlock, "store-orders match block not found").toBeTruthy();
    expect(matchBlock![0]).toMatch(/allow\s+write:\s+if\s+true/);
  });
});
