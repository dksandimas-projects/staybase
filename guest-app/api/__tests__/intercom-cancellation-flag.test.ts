import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #6 (Phase 2 #96): when a guest cancels a
// store order, the chat message should set isCancelledOrder: true so
// the admin Inbox renders it as a distinct greyed-out "Cancelled" card
// instead of a normal placed-order card. Per W2.8 / decision #96.

describe("IntercomPage.tsx — cancellation message flag (decision #96)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/IntercomPage.tsx"),
    "utf8"
  );

  it("Message interface declares the isCancelledOrder flag", () => {
    expect(src).toMatch(/isCancelledOrder\?:\s*boolean/);
  });

  it("handleCancelOrder sends a guest message with isCancelledOrder: true", () => {
    const fnStart = src.indexOf("const handleCancelOrder");
    const fnEnd = src.indexOf("\n  }", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/isCancelledOrder:\s*true/);
  });

  it("the cancelled order tracker message still identifies the order", () => {
    const fnStart = src.indexOf("const handleCancelOrder");
    const fnEnd = src.indexOf("\n  }", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/orderRef:\s*activeOrder\.orderRef/);
  });

  it("the render path branches on isCancelledOrder for visual styling", () => {
    expect(src).toMatch(/msg\.isCancelledOrder\s*\?/);
  });
});
