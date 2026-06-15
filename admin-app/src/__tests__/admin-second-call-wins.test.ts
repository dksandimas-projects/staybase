import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #7 (Phase 2 #94): when a new active call
// arrives while a previous one was being shown, the old call should be
// written as status: "ended" so the previous guest's UI sees the call
// end naturally via its snapshot listener. Per W2.6 / decision #94.

describe("AdminContext.tsx — second concurrent call wins (decision #94)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
    "utf8"
  );

  it("tracks the previous incoming call roomId in a ref", () => {
    expect(src).toMatch(/adminPreviousCallRoomIdRef\s*=\s*useRef/);
  });

  it("writes status: 'ended' to the previous call when a new active one arrives", () => {
    expect(src).toMatch(/updateDoc\(\s*doc\(db\s*,\s*["']calls["']\s*,\s*previousRoomId\s*\)/);
  });

  it("records endedAt timestamp and endedReason on the superseded call", () => {
    expect(src).toMatch(/endedAt:\s*serverTimestamp\(\)/);
    expect(src).toMatch(/endedReason:\s*["']superseded-by-other-call["']/);
  });

  it("the write only happens when nextCall differs from previousRoomId", () => {
    expect(src).toMatch(/nextCall && previousRoomId && nextCall\.roomId !== previousRoomId/);
  });

  it("calls cleanupAdminCall when superseding (to release peer connection)", () => {
    const fnStart = src.indexOf("const nextCall = activeCalls");
    const fnEnd = src.indexOf("\n    },", fnStart);
    const block = src.slice(fnStart, fnEnd);
    expect(block).toMatch(/nextCall\.roomId !== previousRoomId/);
    expect(block).toMatch(/cleanupAdminCall\(\)/);
  });
});
