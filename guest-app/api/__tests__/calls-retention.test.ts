import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #6 (Phase 2 #98): the calls/{roomId}
// collection should not accumulate forever. Per W2.10 / decision #98,
// the call doc is deleted 30 seconds after status: "ended" is set.

describe("IntercomPage.tsx — calls/{roomId} retention (decision #98)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/IntercomPage.tsx"),
    "utf8"
  );

  it("deleteDoc is imported from firebase/firestore", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bdeleteDoc\b[^}]*\}\s*from\s*["']firebase\/firestore["']/);
  });

  it("handleEndCall schedules a setTimeout for the deletion", () => {
    // Slice the function body (greedy up to the next 'export async function'
    // or two newlines + closing brace)
    const fnStart = src.indexOf("const handleEndCall");
    const fnEnd = src.indexOf("\n  const ", fnStart + 10);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/setTimeout/);
    expect(fnBody).toMatch(/deleteDoc/);
  });

  it("the setTimeout fires after 30 seconds (30000 ms)", () => {
    // Two setTimeout calls in handleEndCall both target 30s — the
    // call-state-reset is at 1000ms (existing) and the call-doc-delete
    // is the new 30s one. Assert both exist.
    expect(src).toMatch(/\}\s*,\s*30000\s*\)/);
  });

  it("the deletion targets calls/{roomNumber}", () => {
    expect(src).toMatch(/deleteDoc\(doc\(db\s*,\s*["']calls["']\s*,\s*roomNumber\s*\)\)/);
  });
});
