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
    // Per PR-AUDIT-B4 (2026-10-20): the superseded call is now
    // addressed by its capability token when the call has one (the
    // call document lives at `callSessions/{sessionToken}`), falling
    // back to the legacy room-scoped path otherwise. The intent of
    // the pin — the desk ends the previous call — is unchanged.
    expect(src).toMatch(/updateDoc\(\s*[\s\S]{0,200}?doc\(db\s*,\s*["']callSessions["']\s*,\s*adminPreviousCallSessionTokenRef\.current\s*\)/);
    expect(src).toMatch(/adminPreviousCallSessionTokenRef\s*=\s*useRef/);
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
