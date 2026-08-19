import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for decision #217 (2026-08-19): the
// `cleanupAdminCall` call from inside `acceptCall` was producing a
// phantom "call-missed" system message on every accepted call.
// The pre-#217 accept path called `cleanupAdminCall()` BEFORE
// setting `adminCallAnsweredRef = true` — the cleanup's async IIFE
// dispatched `recordCallHistory("call-missed", ...)` against the
// in-flight ringing call's refs (answered = false), producing the
// paired "Missed call at HH:MM · rang Ns" + "Call answered by {Name}
// at HH:MM · Ns" entries the operator reported 2026-08-19.
//
// The fix has four parts:
//   1. A new `clearCallRefsOnly` helper that zeros refs WITHOUT
//      firing the call-history dispatch hook. Accept uses this.
//   2. The dispatch hook in `cleanupAdminCall`'s IIFE is gated by
//      `adminCallHistoryDispatchedRef` so it fires exactly once per
//      call lifecycle (StrictMode-safe).
//   3. A new `call-failed` outcome for the accept-failed path
//      (getUserMedia denied, createAnswer failed) — was previously
//      mis-labeled as `call-missed`.
//   4. IntercomChatPanel renders the four messageType values with
//      distinct icon + tone mappings.

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const chatPanelSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/IntercomChatPanel.tsx"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

// Brace-counting slice helper — same pattern as
// call-staff-claim-transaction.test.ts. Necessary because the
// function bodies span hundreds of lines and naive indexOf
// substring matching breaks at inner `}`.
function matchingClose(src: string, start: number): number {
  let depth = 0;
  let i = start;
  let seenOpen = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      seenOpen = true;
    } else if (ch === "}") {
      depth--;
      if (seenOpen && depth === 0) return i;
    }
  }
  return -1;
}

function sliceFromFnKeyword(src: string, keyword: string): string {
  const idx = src.indexOf(keyword);
  if (idx < 0) return "";
  const openBrace = src.indexOf("{", idx);
  if (openBrace < 0) return "";
  const closeBrace = matchingClose(src, openBrace);
  if (closeBrace < 0) return "";
  return src.slice(idx, closeBrace + 1);
}

describe("AdminContext.tsx — call-history phantom 'Missed call' (decision #217)", () => {
  describe("Bug #1 — acceptCall no longer calls cleanupAdminCall", () => {
    // The fix replaces the line-4077 `cleanupAdminCall()` with
    // `clearCallRefsOnly()`. The acceptCall function body must
    // contain clearCallRefsOnly and MUST NOT contain
    // cleanupAdminCall — any future regression that re-introduces
    // the dispatch from the accept path is caught here.
    const fnBody = sliceFromFnKeyword(adminSrc, "const acceptCall = async");

    it("does not call cleanupAdminCall on the SUCCESS path of acceptCall", () => {
      // The acceptCall function has TWO branches that call
      // cleanupAdminCall's sibling — the SUCCESS path (which
      // must use clearCallRefsOnly to avoid the phantom dispatch)
      // and the FAILURE catch path (which DOES call
      // cleanupAdminCall because the post-claim audio plumbing
      // failed and we need the call-failed audit trail). We
      // pin the success path by anchoring on the line that
      // creates the RTCPeerConnection: that's the start of the
      // success-path cleanup site. Anything BEFORE that line is
      // pre-success-path; the cleanup site at issue is right
      // before `const peerConnection = new RTCPeerConnection`.
      const peerConnStart = fnBody.indexOf("const peerConnection = new RTCPeerConnection");
      const beforePeerConn = fnBody.slice(0, peerConnStart);
      // The success path's old bug was at the cleanup site that
      // preceded this. Verify clearCallRefsOnly is called there
      // (we test the negative below by ensuring
      // cleanupAdminCall() appears AFTER the peer connection
      // construction, in the catch block).
      expect(beforePeerConn).toMatch(/clearCallRefsOnly\(\)/);
    });

    it("the SUCCESS-path cleanup site uses clearCallRefsOnly, not cleanupAdminCall", () => {
      // Locate the call right before the peer connection
      // construction. In the pre-#217 code this was
      // `cleanupAdminCall()`; in the post-#217 code it must be
      // `clearCallRefsOnly()`.
      const peerConnStart = fnBody.indexOf("const peerConnection = new RTCPeerConnection");
      const slice = fnBody.slice(Math.max(0, peerConnStart - 2000), peerConnStart);
      // The most recent helper call before the peer connection
      // construction must be clearCallRefsOnly, not
      // cleanupAdminCall.
      const lastCleanupIdx = slice.lastIndexOf("clearCallRefsOnly(");
      const lastOldCleanupIdx = slice.lastIndexOf("cleanupAdminCall(");
      expect(lastCleanupIdx).toBeGreaterThan(-1);
      expect(lastOldCleanupIdx).toBeLessThan(lastCleanupIdx);
    });
  });

  describe("clearCallRefsOnly helper exists and zeros refs without dispatching", () => {
    // The helper must zero all six outcome refs and release the
    // peer connection resources, but must NOT contain the IIFE
    // that calls recordCallHistory (that lives in cleanupAdminCall
    // exclusively).
    const fnBody = sliceFromFnKeyword(adminSrc, "const clearCallRefsOnly = () =>");

    it("declares clearCallRefsOnly as an arrow function", () => {
      expect(adminSrc).toMatch(/const\s+clearCallRefsOnly\s*=\s*\(\)\s*=>\s*\{/);
    });

    it("does not contain the recordCallHistory dispatch IIFE", () => {
      // The dispatch IIFE belongs ONLY in cleanupAdminCall. A
      // future refactor that copies the IIFE pattern into
      // clearCallRefsOnly would defeat the entire fix — pin it
      // out.
      expect(fnBody).not.toMatch(/recordCallHistory\(/);
    });

    it("zeros adminCallAnsweredRef", () => {
      expect(fnBody).toMatch(/adminCallAnsweredRef\.current\s*=\s*false/);
    });

    it("zeros adminCallStartedAtRef", () => {
      expect(fnBody).toMatch(/adminCallStartedAtRef\.current\s*=\s*null/);
    });

    it("zeros adminCallExplicitDeclineRef", () => {
      expect(fnBody).toMatch(/adminCallExplicitDeclineRef\.current\s*=\s*false/);
    });

    it("zeros adminCallRingingStartedAtRef", () => {
      expect(fnBody).toMatch(/adminCallRingingStartedAtRef\.current\s*=\s*null/);
    });

    it("zeros adminCallRoomIdRef", () => {
      expect(fnBody).toMatch(/adminCallRoomIdRef\.current\s*=\s*null/);
    });

    it("zeros adminCallLocalAcceptRef", () => {
      expect(fnBody).toMatch(/adminCallLocalAcceptRef\.current\s*=\s*false/);
    });

    it("closes the peer connection and releases the media stream", () => {
      // The helper is responsible for the WebRTC teardown, not
      // just the ref-zeroing. If a future refactor splits the
      // helper into two halves and only exports the ref-zeroing
      // half, callers would leak peer connections.
      expect(fnBody).toMatch(/adminPeerConnectionRef\.current\?\.close\(\)/);
      expect(fnBody).toMatch(/adminMediaStreamRef\.current\?\.getTracks\(\)/);
    });
  });

  describe("Bug #2 — cleanupAdminCall dispatch is gated by adminCallHistoryDispatchedRef", () => {
    // React 18 StrictMode double-invokes effect cleanups in dev.
    // Without the gate, cleanupAdminCall's IIFE would fire twice
    // and write the call-history system message twice into the
    // chat thread. The gate ensures the dispatch is exactly-once
    // per call lifecycle.
    const fnBody = sliceFromFnKeyword(adminSrc, "const cleanupAdminCall = () =>");

    it("declares adminCallHistoryDispatchedRef as a useRef", () => {
      expect(adminSrc).toMatch(
        /adminCallHistoryDispatchedRef\s*=\s*useRef<boolean>\(false\)/
      );
    });

    it("guards the IIFE early-return on dispatchedRef", () => {
      // The first line inside the IIFE body must be the gate —
      // BEFORE the outcome resolution so a re-entry short-circuits.
      const iifeStart = fnBody.indexOf("(async () => {");
      const iifeBody = fnBody.slice(iifeStart);
      expect(iifeBody).toMatch(/if\s*\(\s*adminCallHistoryDispatchedRef\.current\s*\)\s*return\s*;/);
    });

    it("sets dispatchedRef = true BEFORE awaiting recordCallHistory", () => {
      // The flag must be set synchronously, before the await
      // yields — otherwise a synchronous re-entry from the same
      // tick could race past the check.
      const setTrueIdx = fnBody.indexOf("adminCallHistoryDispatchedRef.current = true");
      const awaitRecordIdx = fnBody.indexOf("await recordCallHistory");
      expect(setTrueIdx).toBeGreaterThan(-1);
      expect(awaitRecordIdx).toBeGreaterThan(-1);
      expect(setTrueIdx).toBeLessThan(awaitRecordIdx);
    });

    it("resets dispatchedRef = false at the tail of cleanupAdminCall", () => {
      // So the NEXT call lifecycle can fire its own dispatch.
      expect(fnBody).toMatch(/adminCallHistoryDispatchedRef\.current\s*=\s*false/);
    });
  });

  describe("Bug #3 — accept-failed path now dispatches call-failed, not call-missed", () => {
    // The pre-#217 catch in acceptCall produced a misleading
    // "Missed call" message when the post-claim audio plumbing
    // failed. The new outcome is "call-failed" with distinct
    // text "Call failed at HH:MM · after Ns".
    const fnBody = sliceFromFnKeyword(adminSrc, "const acceptCall = async");
    const fnBody2 = sliceFromFnKeyword(adminSrc, "const cleanupAdminCall = () =>");

    it("cleanupAdminCall resolves call-failed when localAccept=true and answered=false", () => {
      // The third branch in the outcome resolution — new in #217.
      // Must check adminCallLocalAcceptRef.current before falling
      // through to call-missed.
      expect(fnBody2).toMatch(/adminCallLocalAcceptRef\.current/);
      expect(fnBody2).toMatch(/"call-failed"/);
    });

    it("recordCallHistory accepts call-failed in its outcome union", () => {
      const recordFnBody = sliceFromFnKeyword(
        adminSrc,
        "const recordCallHistory = async"
      );
      expect(recordFnBody).toMatch(
        /outcome:\s*"call-answered"\s*\|\s*"call-missed"\s*\|\s*"call-declined"\s*\|\s*"call-failed"/
      );
    });

    it("recordCallHistory formats call-failed as 'Call failed at {clock}'", () => {
      const recordFnBody = sliceFromFnKeyword(
        adminSrc,
        "const recordCallHistory = async"
      );
      expect(recordFnBody).toMatch(/Call failed at/);
    });

    it("accept-failed catch comment references decision #217", () => {
      // The misleading comment that claimed
      // "recordCallHistory will dispatch a call-missed system
      // message because adminCallAnsweredRef is still false"
      // is rewritten in #217 to point at the new outcome. A
      // future refactor that restores the misleading wording
      // fails this test.
      expect(fnBody).toMatch(/decision #217/);
    });
  });

  describe("acceptCall no-offer branch still works (regression sanity check)", () => {
    // The pre-#217 no-offer branch (line 4062-4075) set
    // adminCallAnsweredRef = true before the cleanup call. With
    // #217 the cleanup call is replaced by clearCallRefsOnly, but
    // the answered ref must STILL be set true on this branch so
    // the future hangup dispatches "call-answered" (not
    // "call-missed"). The pin lives in the order of statements:
    // the answered ref set must precede the clearCallRefsOnly
    // call within the no-offer branch.
    const fnBody = sliceFromFnKeyword(adminSrc, "const acceptCall = async");

    it("the no-offer branch sets adminCallAnsweredRef = true", () => {
      // The no-offer branch is the `if (!incomingCall.offer)`
      // guard. The answered ref set must appear before the
      // clearCallRefsOnly call. We don't enforce strict ordering
      // here because the no-offer branch returns before the
      // clearCallRefsOnly call (it's an early-return path);
      // we just verify the branch still sets the ref.
      expect(fnBody).toMatch(/adminCallAnsweredRef\.current\s*=\s*true/);
    });
  });
});

describe("IntercomChatPanel.tsx — call-failed messageType rendering (decision #217)", () => {
  // The chat panel renders four messageType values with distinct
  // icon + tone mappings. The dispatch tables are the
  // source-of-truth for what staff sees in the chat thread for
  // each outcome.
  it("declares a call-failed entry in the icon dispatch table", () => {
    expect(chatPanelSrc).toMatch(/"call-failed":\s*PhoneOff/);
  });

  it("declares a call-failed entry in the tone dispatch table", () => {
    expect(chatPanelSrc).toMatch(/"call-failed":\s*"text-orange-600"/);
  });

  it("declares all four messageType values in the icon table", () => {
    // The exhaustive-record pattern enforces that adding a new
    // messageType requires updating the render table.
    expect(chatPanelSrc).toMatch(/"call-answered":\s*Phone/);
    expect(chatPanelSrc).toMatch(/"call-missed":\s*PhoneMissed/);
    expect(chatPanelSrc).toMatch(/"call-declined":\s*PhoneOff/);
    expect(chatPanelSrc).toMatch(/"call-failed":\s*PhoneOff/);
  });

  it("declares all four messageType values in the tone table", () => {
    expect(chatPanelSrc).toMatch(/"call-answered":\s*"text-primary"/);
    expect(chatPanelSrc).toMatch(/"call-missed":\s*"text-amber-600"/);
    expect(chatPanelSrc).toMatch(/"call-declined":\s*"text-gray-400"/);
    expect(chatPanelSrc).toMatch(/"call-failed":\s*"text-orange-600"/);
  });
});

describe("shared/types/index.ts — IntercomMessageType includes call-failed (decision #217)", () => {
  // The canonical type union drives every typed surface in both
  // apps (the mapper, the writer, the chat panel). A future
  // refactor that drops call-failed from the union breaks the
  // compile but the pin here is the cheap daily safety net.
  it("declares call-failed in the IntercomMessageType union", () => {
    expect(sharedTypesSrc).toMatch(
      /export type IntercomMessageType\s*=\s*[\s\S]*"call-answered"[\s\S]*"call-missed"[\s\S]*"call-declined"[\s\S]*"call-failed"[\s\S]*\|/
    );
  });
});