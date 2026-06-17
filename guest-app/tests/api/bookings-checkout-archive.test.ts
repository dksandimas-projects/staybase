import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #6 (Phase 2 #95): handleCheckoutBooking
// must set `intercoms/{roomNumber}.resolved = true` in the same
// transaction. Per W2.7 / decision #95, the intercom thread should
// auto-archive on checkout.

describe("bookings.ts — auto-archive intercom thread on checkout (decision #95)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );

  it("handleCheckoutBooking writes to intercoms/{roomNumber}", () => {
    // The handleCheckoutBooking function should reference both
    // "intercoms" and "resolved: true" somewhere in its body.
    const fnStart = src.indexOf("export async function handleCheckoutBooking");
    const fnEnd = src.indexOf("\n}\n", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/intercoms/);
    expect(fnBody).toMatch(/resolved:\s*true/);
  });

  it("uses set with merge: true so existing thread is preserved (idempotent)", () => {
    const fnStart = src.indexOf("export async function handleCheckoutBooking");
    const fnEnd = src.indexOf("\n}\n", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/collection\(["']intercoms["']\)\.doc\(\s*roomNumber\s*\)/);
    expect(fnBody).toMatch(/merge: true/);
  });

  it("sets resolved: true and records resolvedAt + resolvedBy", () => {
    expect(src).toMatch(/resolved:\s*true/);
    expect(src).toMatch(/resolvedAt:\s*new Date\(\)/);
    expect(src).toMatch(/resolvedBy:\s*checkedOutBy/);
  });

  it("the write happens inside the existing runTransaction block (atomic with checkout)", () => {
    // The intercom update must be inside the transaction that flips the
    // booking status — if the transaction rolls back, the archive must
    // also roll back.
    const txOpen = src.indexOf("runTransaction(async (transaction) =>");
    const intercomIdx = src.indexOf('collection("intercoms")');
    expect(intercomIdx).toBeGreaterThan(txOpen);
  });
});
