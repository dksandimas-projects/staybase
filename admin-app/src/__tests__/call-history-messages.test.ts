// `feat/call-history-messages` — regression tests for the
// per-call system-message audit trail. Source-text assertions
// (matching the audio-routing regression style) — cheap,
// deterministic, no Firestore emulator needed. The runtime
// behaviour is covered by the manual repro in the commit
// message.
//
// References:
//   plan/features/INTERCOM-INBOX.md §"Call history as system messages"
//   plan/docs/BACKEND.md §intercoms/{roomNumber}/messages
//   firebase/firestore.rules §intercoms.messages

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");

const adminContext = read("admin-app/src/context/AdminContext.tsx");
const inboxPage = read("admin-app/src/components/IntercomChatPanel.tsx");
const sharedTypes = read("shared/types/index.ts");
const firestoreRules = read("firebase/firestore.rules");

describe("call-history-messages — chat audit trail for WebRTC call lifecycle", () => {
  // ── Type contract ────────────────────────────────────────
  //
  // Both the canonical shared type AND the local AdminContext
  // duplicate must carry the new optional fields. The
  // duplicate exists for historical reasons (intercom
  // snapshot uses string timestamps locally, shared uses
  // Date) and IntERCOM consumers like IntercomChatPanel import
  // from AdminContext. If either drifts the render breaks.

  it("shared/types exports IntercomMessageType and IntercomMessage with the three optional call fields", () => {
    expect(sharedTypes).toMatch(/export type IntercomMessageType\b/);
    expect(sharedTypes).toMatch(/"call-answered"/);
    expect(sharedTypes).toMatch(/"call-missed"/);
    expect(sharedTypes).toMatch(/"call-declined"/);
    // Optional fields on IntercomMessage
    expect(sharedTypes).toMatch(/messageType\?:\s*IntercomMessageType/);
    expect(sharedTypes).toMatch(/callStartedAt\?:\s*Date/);
    expect(sharedTypes).toMatch(/callDuration\?:\s*number/);
    // Sender widened to include "system"
    expect(sharedTypes).toMatch(/IntercomSender\s*=\s*"guest"\s*\|\s*"front-desk"\s*\|\s*"system"/);
  });

  it("AdminContext's local IntercomMessage duplicate mirrors the new fields", () => {
    // Local re-declaration is intentional per-file (AdminContext's
    // data shape uses string timestamps, the shared one uses Date);
    // a future refactor that drops the local copy in favour of the
    // shared type will make this assertion obsolete.
    expect(adminContext).toMatch(/sender:\s*"guest"\s*\|\s*"front-desk"\s*\|\s*"system"/);
    expect(adminContext).toMatch(/messageType\?:\s*"call-answered"\s*\|\s*"call-missed"\s*\|\s*"call-declined"/);
    expect(adminContext).toMatch(/callStartedAt\?:\s*string/);
    expect(adminContext).toMatch(/callDuration\?:\s*number/);
  });

  // ── Dispatcher ───────────────────────────────────────────
  //
  // recordCallHistory is the single funnel every call-end path
  // routes through. It must (a) exist in AdminContext, (b) take
  // outcome + durationMs + roomId, (c) write to intercoms/{id}
  // and intercoms/{id}/messages, (d) carry the structured
  // messageType, (e) use serverTimestamp() so the Firestore
  // timestamp == request.time rule accepts the write.

  it("AdminContext exposes a recordCallHistory helper that writes the structured system message", () => {
    expect(adminContext).toMatch(/const recordCallHistory\s*=\s*async\s*\(/);
    expect(adminContext).toMatch(/recordCallHistory\([\s\S]+?outcome[\s\S]+?durationMs/);
    expect(adminContext).toMatch(/messageType:\s*outcome/);
    expect(adminContext).toMatch(/sender:\s*"system"/);
    expect(adminContext).toMatch(/callDuration:\s*durationSec/);
    expect(adminContext).toMatch(
      /timestamp:\s*serverTimestamp\(\),\s*\n\s*isRead:\s*true/
    );
    // Three distinct duration-text templates per outcome.
    expect(adminContext).toMatch(/Call answered at/);
    expect(adminContext).toMatch(/Missed call at/);
    expect(adminContext).toMatch(/Call declined at/);
    // Failure path: a failed write logs but never throws.
    // The catch block may sit anywhere inside the helper body
    // (after the await, before the catch — single async fn),
    // so match the warn call loosely against the call-history
    // log prefix.
    expect(adminContext).toMatch(/\[\s*call-history\s*\]/);
    expect(adminContext).toMatch(/console\.warn\([\s\S]*?\[call-history\]/);
  });

  it("cleanupAdminCall is the single funnel that dispatches the system message", () => {
    // cleanupAdminCall must read every outcome ref BEFORE the
    // refs are reset, and must call recordCallHistory based on
    // the answered / explicitDecline / neither branch.
    const block = adminContext.match(
      /const cleanupAdminCall\s*=\s*\(\)\s*=>\s*\{[\s\S]+?recordCallHistory\([\s\S]+?\}\);/
    );
    expect(block, "cleanupAdminCall must call recordCallHistory").toBeTruthy();
    expect(block![0]).toMatch(/adminCallAnsweredRef\.current\s*===\s*true/);
    expect(block![0]).toMatch(/adminCallExplicitDeclineRef\.current\s*===\s*true/);
    expect(block![0]).toMatch(/"call-answered"/);
    expect(block![0]).toMatch(/"call-missed"/);
    expect(block![0]).toMatch(/"call-declined"/);
  });

  // ── Telemetry refs ────────────────────────────────────────
  //
  // All five refs (roomId, answered, startedAt, ringing,
  // explicitDecline) must be declared and reset by
  // cleanupAdminCall. Missing the reset leaves stale state
  // across calls — the next call would be misattributed.

  it("cleanupAdminCall resets the five call-history refs at its tail", () => {
    expect(adminContext).toMatch(
      /adminCallAnsweredRef\.current\s*=\s*false/
    );
    expect(adminContext).toMatch(
      /adminCallStartedAtRef\.current\s*=\s*null/
    );
    expect(adminContext).toMatch(
      /adminCallExplicitDeclineRef\.current\s*=\s*false/
    );
    expect(adminContext).toMatch(
      /adminCallRingingStartedAtRef\.current\s*=\s*null/
    );
    expect(adminContext).toMatch(
      /adminCallRoomIdRef\.current\s*=\s*null/
    );
  });

  // ── Lifecycle hookup ────────────────────────────────────
  //
  // Each call site that triggers cleanup must set the
  // outcome-relevant ref BEFORE calling cleanupAdminCall.
  // declineCall is the most explicit — it sets the
  // explicitDecline flag before calling cleanup.

  it("declineCall sets the explicit-decline flag before calling cleanupAdminCall", () => {
    // The flag must be set inline so the dispatcher in
    // cleanupAdminCall sees the right value when it reads
    // the ref. Order matters: set first, then cleanup.
    const block = adminContext.match(
      /const declineCall\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]+?\}\s*\n\s*\};/
    );
    expect(block, "declineCall must exist").toBeTruthy();
    expect(block![0]).toMatch(/adminCallExplicitDeclineRef\.current\s*=\s*true/);
    expect(block![0]).toMatch(/cleanupAdminCall\(\)/);
  });

  it("the snapshot listener captures the ringing-start timestamp on a fresh call", () => {
    // The snapshot's onSnapshot handler must update
    // adminCallRingingStartedAtRef for a fresh roomId (not the
    // same room persisting across a tick). Otherwise missed-call
    // duration will be wrong (or 0) on a call that started
    // before the admin even opened the inbox.
    const block = adminContext.match(
      /nextCall\s*&&\s*[\s\S]+?previousRoomId[\s\S]+?adminCallRingingStartedAtRef\.current\s*=\s*Date\.now\(\)/
    );
    expect(block, "snapshot must set ringing start on fresh roomId").toBeTruthy();
  });

  it("acceptCall sets the answered + startedAt refs BEFORE the next cleanup can fire", () => {
    // The refs must be set right after addTrack so they're
    // visible to any subsequent cleanupAdminCall (from error
    // path, snapshot supersede, logoff).
    const block = adminContext.match(
      /const acceptCall\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]+?addTrack\([\s\S]+?\}\);?/
    );
    expect(block, "acceptCall must exist").toBeTruthy();
    expect(block![0]).toMatch(/adminCallAnsweredRef\.current\s*=\s*true/);
    expect(block![0]).toMatch(/adminCallStartedAtRef\.current\s*=\s*Date\.now\(\)/);
  });

  // ── Firestore rules ──────────────────────────────────────
  //
  // The rules layer is the security boundary — a missing
  // entry would silently break call history writes. We pin
  // the three new keys on the allowlist AND the third
  // "system" sender value AND the system-vs-messageType
  // correlation predicate.

  it("firestore.rules allows the new messageType/callStartedAt/callDuration keys", () => {
    expect(firestoreRules).toMatch(/"messageType"/);
    expect(firestoreRules).toMatch(/"callStartedAt"/);
    expect(firestoreRules).toMatch(/"callDuration"/);
    expect(firestoreRules).toMatch(/sender in \["guest", "front-desk", "system"\]/);
  });

  it("firestore.rules requires messageType when sender is system", () => {
    // Without this predicate, ad-hoc system docs could land in
    // the chat thread with no audit type. The rule must reject
    // sender === "system" + messageType absent or unrecognised.
    expect(firestoreRules).toMatch(
      /request\.resource\.data\.sender\s*!=\s*"system"/
    );
    expect(firestoreRules).toMatch(
      /sender != "system"/
    );
    expect(firestoreRules).toMatch(
      /messageType in \["call-answered", "call-missed", "call-declined", "call-failed"\]/
    );
  });

  // ── Render ──────────────────────────────────────────────
  //
  // IntercomChatPanel is the single consumer (verified via grep
  // during the survey step). It must render system messages
  // with the right icon, the right tone, and a data-testid pin
  // for future e2e.

  it("IntercomChatPanel renders system messages with the call-state iconography", () => {
    // Three icons imported (one per outcome).
    expect(inboxPage).toMatch(/Phone,?\s*\n?\s*PhoneMissed,?\s*\n?\s*PhoneOff/);
    // The system-message branch reads msg.messageType and picks
    // the icon by outcome.
    expect(inboxPage).toMatch(/sender\s*===\s*"system"\s*&&\s*msg\.messageType/);
    // Per decision #217 (2026-08-19): the icon + tone dispatch
    // tables replace the pre-#217 chained ternaries. The four
    // outcomes must all appear in BOTH tables with distinct
    // mappings. The `Record<...>` shape forces TypeScript to
    // complain if a future messageType is added without a table
    // entry — the source-text tests below mirror that gate.
    expect(inboxPage).toMatch(/"call-answered":\s*Phone/);
    expect(inboxPage).toMatch(/"call-missed":\s*PhoneMissed/);
    expect(inboxPage).toMatch(/"call-declined":\s*PhoneOff/);
    expect(inboxPage).toMatch(/"call-failed":\s*PhoneOff/);
    // data-testid pin per outcome so cypress can target each.
    expect(inboxPage).toMatch(
      /data-testid=\{`call-system-message-\$\{msg\.messageType\}`\}/
    );
    // Tone differentiation per outcome (so missed stands out as
    // amber, declined is gray, failed is orange — at a glance).
    expect(inboxPage).toMatch(/call-missed.*text-amber|text-amber-600/);
    expect(inboxPage).toMatch(/call-declined.*text-gray-400|text-gray-400/);
    expect(inboxPage).toMatch(/call-failed.*text-orange-600|text-orange-600/);
  });
});
