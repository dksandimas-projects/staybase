import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for decision #206 (2026-08-19): when two front-desk
// staff race to accept the same incoming call, the first one to commit
// the `runTransaction` claim wins. The pre-#206 `updateDoc` write was
// a best-effort last-write-wins race that let the wrong staff end up
// with a half-built WebRTC connection. The fix is a `runTransaction`
// claim that atomically reads the call doc, checks `status === "ringing"`,
// and writes `status: "active" + acceptedBy: { uid, name, claimedAt }`.
// The losing staff's acceptCall catches the transaction's abort and
// surfaces a friendly toast instead of silently no-op-ing the
// half-built peer connection. The snapshot listener hydrates
// `acceptedBy` so the losing tab can render an
// "Already answered by {Name}" banner instead of a Connect/Mute
// surface. The `call-answered` system message also carries the staff
// display name in `callAnsweredByName` for the chat-thread audit trail.

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const inboxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/IntercomInboxPage.tsx"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

// Locate the matching `}` for a function whose body opens at `start`.
// The function body starts right after the `=>` / `(` open and the
// matching `}` is at the same indentation level as the keyword that
// started the function. We walk the string counting `{` / `}` after
// the first `{` to find the true close — naive `indexOf` returns an
// inner `}` substring and breaks the slice (FOL-02 / MRB-15-10
// hydrate-mapper pattern: dropped fields because the slice ended
// at a nested `}`).
function matchingClose(src: string, start: number): number {
  // Find the first `{` at-or-after start
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
  // Find the first `{` after the keyword — that's the function body open.
  const openBrace = src.indexOf("{", idx);
  if (openBrace < 0) return "";
  const closeBrace = matchingClose(src, openBrace);
  if (closeBrace < 0) return "";
  return src.slice(idx, closeBrace + 1);
}

describe("AdminContext.tsx — concurrent call claim transaction (decision #206)", () => {
  describe("acceptCall wraps the claim in runTransaction", () => {
    const fnBody = sliceFromFnKeyword(adminSrc, "const acceptCall = async");

    it("uses runTransaction with the call doc reference as the gate", () => {
      // The claim must be a runTransaction (not a plain updateDoc) so
      // the read-and-write is atomic. The transaction body must read
      // the callRef before any writes.
      expect(fnBody).toMatch(/runTransaction\(\s*db\s*,\s*async\s*\(/);
      expect(fnBody).toMatch(/transaction\.get\(\s*callRef\s*\)/);
    });

    it("aborts when status is not 'ringing' (someone else already claimed)", () => {
      // The transaction body checks status === "ringing" and throws
      // to abort if the call is no longer claimable.
      expect(fnBody).toMatch(/data\.status\s*!==\s*["']ringing["']/);
      expect(fnBody).toMatch(/throw\s+new\s+Error\(\s*["']call-already-claimed["']/);
    });

    it("writes acceptedBy { uid, name, claimedAt: serverTimestamp() } on the claim commit", () => {
      expect(fnBody).toMatch(/acceptedBy:\s*\{/);
      expect(fnBody).toMatch(/uid:\s*currentUser\?\.uid/);
      expect(fnBody).toMatch(/name:\s*currentUser\?\.displayName/);
      expect(fnBody).toMatch(/claimedAt:\s*serverTimestamp\(\)/);
    });

    it("sets status: 'active' + endedAt: null inside the same transaction", () => {
      // The claim transaction is the single source of truth for the
      // active state — both fields must be written in the same
      // transaction body so they're committed atomically.
      expect(fnBody).toMatch(/transaction\.update\(\s*callRef\s*,\s*\{/);
      expect(fnBody).toMatch(/status:\s*["']active["']/);
      expect(fnBody).toMatch(/endedAt:\s*null/);
    });

    it("toasts and returns when the transaction aborts", () => {
      // The catch must surface a friendly notice to the losing staff
      // — no console.error, no half-built peer connection leak.
      expect(fnBody).toMatch(/catch\s*\(\s*claimError\s*\)/);
      expect(fnBody).toMatch(/notify\.info\(/);
    });

    it("ends the call with endedReason: 'accept-failed' if the claim committed but a later step threw", () => {
      // The post-claim catch (getUserMedia denied, createAnswer
      // failed, etc.) must end the call for the guest too — otherwise
      // the call would be stuck at status: "active" with no working
      // peer connection. The `acceptedBy` stays on the doc as the
      // audit trail of who tried to answer.
      expect(fnBody).toMatch(/claimCommitted/);
      expect(fnBody).toMatch(/endedReason:\s*["']accept-failed["']/);
    });
  });

  describe("snapshot mapper hydrates acceptedBy", () => {
    // The calls collection onSnapshot mapper is the .map() inside
    // the snapshot callback. Find it by anchoring on the type
    // assertion + the data.acceptedBy read.
    it("reads acceptedBy from the call doc snapshot", () => {
      expect(adminSrc).toMatch(/data\.acceptedBy/);
      expect(adminSrc).toMatch(/CallAcceptedBy/);
    });

    it("attaches acceptedBy to the IncomingCall mapper output", () => {
      // The mapper output object must include `acceptedBy,` as a
      // property to surface it on the IncomingCall state.
      expect(adminSrc).toMatch(/acceptedBy\s*,\s*\n\s*startedAt/);
    });
  });

  describe("IncomingCall type carries acceptedBy", () => {
    it("declares acceptedBy as optional on the IncomingCall interface", () => {
      const ifaceStart = adminSrc.indexOf("export interface IncomingCall");
      // Find the interface's matching close brace
      const close = matchingClose(adminSrc, ifaceStart);
      const iface = adminSrc.slice(ifaceStart, close + 1);
      expect(iface).toMatch(/acceptedBy\?:\s*CallAcceptedBy\s*\|\s*null/);
    });

    it("declares a CallAcceptedBy sub-interface with uid + name + claimedAt", () => {
      const subStart = adminSrc.indexOf("export interface CallAcceptedBy");
      const close = matchingClose(adminSrc, subStart);
      const sub = adminSrc.slice(subStart, close + 1);
      expect(sub).toMatch(/uid:\s*string/);
      expect(sub).toMatch(/name:\s*string/);
      expect(sub).toMatch(/claimedAt\?:\s*Date\s*\|\s*null/);
    });
  });

  describe("adminCallLocalAcceptRef lifecycle", () => {
    it("declares a useRef<boolean> for the local-claim flag", () => {
      expect(adminSrc).toMatch(/adminCallLocalAcceptRef\s*=\s*useRef<boolean>\(false\)/);
    });

    it("resets the local-claim flag in cleanupAdminCall", () => {
      const fnBody = sliceFromFnKeyword(adminSrc, "const cleanupAdminCall = () =>");
      expect(fnBody).toMatch(/adminCallLocalAcceptRef\.current\s*=\s*false/);
    });

    it("sets the local-claim flag to true immediately after the claim transaction commits", () => {
      // The flag must be set BEFORE any post-claim async work so
      // even if getUserMedia fails the inbox state still attributes
      // the call to this tab.
      const fnBody = sliceFromFnKeyword(adminSrc, "const acceptCall = async");
      expect(fnBody).toMatch(/claimCommitted\s*=\s*true/);
      expect(fnBody).toMatch(/adminCallLocalAcceptRef\.current\s*=\s*true/);
    });
  });

  describe("call-answered system message carries callAnsweredByName", () => {
    const fnBody = sliceFromFnKeyword(adminSrc, "const recordCallHistory = async");

    it("recordCallHistory writes callAnsweredByName on call-answered", () => {
      expect(fnBody).toMatch(/callAnsweredByName:/);
    });

    it("only sets callAnsweredByName when the local-claim flag is true (this tab won)", () => {
      expect(fnBody).toMatch(/adminCallLocalAcceptRef\.current/);
    });

    it("prefixes the human-readable text with the staff display name when claimed locally", () => {
      expect(fnBody).toMatch(/Call answered by \$\{staffName\}/);
    });
  });

  describe("snapshot mapper hydrates the new callAnsweredByName field on read", () => {
    it("maps data.callAnsweredByName onto the IntercomMessage shape", () => {
      expect(adminSrc).toMatch(/callAnsweredByName:\s*typeof data\.callAnsweredByName === ["']string["']/);
    });
  });
});

describe("IntercomInboxPage.tsx — claimed-by-other banner (decision #206)", () => {
  it("imports currentUser from useAdmin to compare against acceptedBy.uid", () => {
    expect(inboxSrc).toMatch(/currentUser\s*\n\s*\}\s*=\s*useAdmin\(\)/);
  });

  it("renders the 'Call Already Answered' surface when acceptedBy is another staff", () => {
    // The banner branches on isClaimedByOtherStaff which is true
    // exactly when status === "active" AND acceptedBy exists AND
    // acceptedBy.uid !== currentUser.uid.
    expect(inboxSrc).toMatch(/isClaimedByOtherStaff/);
    expect(inboxSrc).toMatch(/incomingCall\.acceptedBy\.uid\s*!==\s*currentUser\.uid/);
    expect(inboxSrc).toMatch(/Call Already Answered/);
  });

  it("shows the claimer's display name in the loser banner", () => {
    expect(inboxSrc).toMatch(/Answered by/);
    expect(inboxSrc).toMatch(/incomingCall\.acceptedBy\?\.name/);
  });

  it("uses a testid on the claimed-by-other banner for downstream tests", () => {
    expect(inboxSrc).toMatch(/data-testid="call-already-claimed-banner"/);
  });

  it("does not render Accept/Ignore/Mute/Disconnect buttons in the claimed-by-other state", () => {
    // The loser banner is an informational surface — no call-control
    // buttons. The check is at the render branch level: the original
    // "ringing" + "active" CTA stacks are only rendered when
    // isClaimedByOtherStaff is false.
    const claimBannerStart = inboxSrc.indexOf("isClaimedByOtherStaff");
    const renderedCtas = inboxSrc.slice(claimBannerStart);
    // The Accept Voice / Ignore Call / Mute / Disconnect buttons
    // appear in the non-claim path, but the claim path must not
    // include them. Slice from the `if (isClaimedByOtherStaff)`
    // branch to the `return (` that opens its JSX — that window
    // must contain zero call-control buttons.
    const claimPathStart = renderedCtas.indexOf("if (isClaimedByOtherStaff) {");
    const claimPathEnd = renderedCtas.indexOf("return (", claimPathStart);
    const claimPath = renderedCtas.slice(claimPathStart, claimPathEnd);
    expect(claimPath).not.toMatch(/Accept Voice/);
    expect(claimPath).not.toMatch(/Ignore Call/);
    expect(claimPath).not.toMatch(/Disconnect Call/);
  });
});

describe("shared/types/index.ts — IntercomMessage.callAnsweredByName (decision #206)", () => {
  it("declares callAnsweredByName on the canonical IntercomMessage type", () => {
    const ifaceStart = sharedTypesSrc.indexOf("export interface IntercomMessage");
    const close = matchingClose(sharedTypesSrc, ifaceStart);
    const iface = sharedTypesSrc.slice(ifaceStart, close + 1);
    expect(iface).toMatch(/callAnsweredByName\?:\s*string\s*\|\s*null/);
  });
});
