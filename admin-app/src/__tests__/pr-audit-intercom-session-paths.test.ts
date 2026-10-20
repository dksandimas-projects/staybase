import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression net for the PR-AUDIT-B3/B4/B5/B6 intercom hardening
// (2026-10-20) — the production-readiness audit's intercom blockers.
//
// WHAT CHANGED
// The guest intercom and the WebRTC signalling moved from room-scoped
// collections to CAPABILITY-scoped ones whose path contains a random
// 32-hex `sessionToken` issued by the server at stay-verification:
//
//   intercoms/{roomId}/messages/{id}          → staff-only (legacy)
//   intercoms/{roomId}                        → staff-only
//   calls/{roomId}/{document=**}              → staff-only (legacy)
//   intercomSessions/{sessionToken}/messages  → capability read
//   callSessions/{sessionToken}               → capability read/write
//
// WHY: walk-in guests are not signed in, so Firestore rules cannot
// authorize them per-user — a rule can only compare against
// `request.auth`. Putting the credential in the path is the only way to
// keep the guest's LIVE chat while removing the public read.
//
// This file pins the contract at the source level (the FOL-02 pattern
// in `plan/docs/GOTCHAS.md`) so a future refactor that silently moves a
// path back to the room-scoped collection — or drops the server-side
// stay verification — breaks a test instead of re-opening the hole.

const repoRoot = resolve(__dirname, "../../..");
const adminSrc = readFileSync(resolve(repoRoot, "admin-app/src/context/AdminContext.tsx"), "utf8");
const guestSrc = readFileSync(resolve(repoRoot, "guest-app/src/pages/IntercomPage.tsx"), "utf8");
const intercomHandlerSrc = readFileSync(
  resolve(repoRoot, "guest-app/server/handlers/intercom.ts"),
  "utf8"
);
const firestoreRulesSrc = readFileSync(resolve(repoRoot, "firebase/firestore.rules"), "utf8");

describe("Intercom capability scoping — the legacy paths are staff-only", () => {
  it("the intercom thread document is staff-only", () => {
    const block = firestoreRulesSrc.match(
      /match \/intercoms\/\{roomId\}\s*\{[\s\S]*?\n    \}/
    );
    expect(block, "expected a match /intercoms/{roomId}/ block").toBeTruthy();
    expect(block![0]).toMatch(/allow read: if isStaff\(\)/);
    expect(block![0]).not.toMatch(/allow read, create, update: if true/);
  });

  it("the legacy message thread is staff-only", () => {
    const block = firestoreRulesSrc.match(
      /match \/messages\/\{messageId\}\s*\{[\s\S]*?\n      \}/
    );
    expect(block, "expected a match /messages/{messageId}/ block").toBeTruthy();
    expect(block![0]).toMatch(/allow read: if isStaff\(\)/);
    expect(block![0]).not.toMatch(/allow read: if true/);
  });

  it("the legacy call signalling path is staff-only", () => {
    const block = firestoreRulesSrc.match(
      /match \/calls\/\{roomId\}\/\{document=\*\*\}\s*\{[^}]+\}/
    );
    expect(block, "expected a match /calls/{roomId}/{document=**}/ block").toBeTruthy();
    expect(block![0]).toMatch(/allow read, write: if isStaff\(\)/);
    expect(block![0]).not.toMatch(/allow read, write: if true/);
  });

  it("the capability-scoped collections exist", () => {
    expect(firestoreRulesSrc).toMatch(/match \/intercomSessions\/\{sessionToken\}/);
    expect(firestoreRulesSrc).toMatch(/match \/callSessions\/\{sessionToken\}/);
  });
});

describe("Intercom capability scoping — the guest uses the session path", () => {
  it("the guest subscribes to the session-scoped message collection", () => {
    expect(guestSrc).toMatch(/collection\(db, "intercomSessions", sessionToken, "messages"\)/);
    expect(guestSrc).not.toMatch(/collection\(db, "intercoms", roomNumber, "messages"\)/);
  });

  it("the guest marks read in the session-scoped collection", () => {
    expect(guestSrc).toMatch(
      /doc\(db, "intercomSessions", sessionToken, "messages", message\.id\)/
    );
  });

  it("the guest writes its call session to the capability collection", () => {
    expect(guestSrc).toMatch(/doc\(db, "callSessions", sessionToken\)/);
    expect(guestSrc).toMatch(/collection\(db, "callSessions", sessionToken, "iceCandidates"\)/);
    expect(guestSrc).not.toMatch(/"calls", roomNumber/);
  });

  it("the guest sends the session token with its message", () => {
    expect(guestSrc).toMatch(/sessionToken,/);
  });

  it("the guest cannot send without a session token", () => {
    expect(guestSrc).toMatch(
      /if \(!roomNumber \|\| !guestName\.trim\(\) \|\| !currentStayId \|\| !sessionToken\) return;/
    );
  });
});

describe("Intercom capability scoping — the server re-verifies the stay (B6)", () => {
  it("the send endpoint requires a session token in the body", () => {
    expect(intercomHandlerSrc).toMatch(/sessionToken: z\.string\(\)\.trim\(\)\.min\(16\)/);
  });

  it("the server resolves the booking and checks the room", () => {
    expect(intercomHandlerSrc).toMatch(/async function resolveVerifiedStay/);
    expect(intercomHandlerSrc).toMatch(/bookingRoom !== roomNumber/);
  });

  it("the server requires the stay to be checked in", () => {
    expect(intercomHandlerSrc).toMatch(/booking\.status \|\| ""\) !== "checked-in"/);
  });

  it("the server validates the session token against the stored one", () => {
    expect(intercomHandlerSrc).toMatch(/storedToken !== sessionToken/);
  });

  it("the guest name comes from the booking, not from the request body", () => {
    // The request body's `guestName` is destructured out of the parsed
    // data and never used as the sender identity.
    expect(intercomHandlerSrc).toMatch(/const guestName = verified\.guestName \|\| parsed\.data\.guestName/);
  });

  it("the message is written to the session-scoped collection", () => {
    expect(intercomHandlerSrc).toMatch(
      /collection\("intercomSessions"\)\.doc\(sessionToken\)\.collection\("messages"\)\.add/
    );
  });

  it("verification issues the session token and returns it to the guest", () => {
    expect(intercomHandlerSrc).toMatch(/const sessionToken = sameStay && existingToken \? existingToken : generateLookupToken\(\)/);
    expect(intercomHandlerSrc).toMatch(/currentStayToken: sessionToken/);
    expect(intercomHandlerSrc).toMatch(/data: \{ \.\.\.getPublicBookingSummary\(currentStay\), sessionToken \}/);
  });
});

describe("Intercom capability scoping — the desk reads both threads", () => {
  it("the inbox uses one collection-group query over messages", () => {
    expect(adminSrc).toMatch(/collectionGroup\(db, "messages"\)/);
  });

  it("the mapper hydrates the session token from the document path", () => {
    expect(adminSrc).toMatch(/isSessionScoped \? docSnap\.ref\.parent\?\.parent\?\.id/);
    expect(adminSrc).toMatch(/sessionToken/);
  });

  it("the desk marks a session message read in the SESSION collection", () => {
    // Regression: marking only the legacy copy left the desk's unread
    // badge permanently stuck, because the badge is computed from the
    // collection-group listener that reads the session copy.
    expect(adminSrc).toMatch(
      /message\.sessionToken\s*\?\s*doc\(db, "intercomSessions", message\.sessionToken, "messages", message\.id\)/
    );
  });

  it("the desk's reply lands in the guest's session thread", () => {
    expect(adminSrc).toMatch(
      /collection\(db, "intercomSessions", sessionToken, "messages"\)/
    );
  });

  it("the desk reads the call session collection", () => {
    expect(adminSrc).toMatch(/collectionGroup\(db, "callSessions"\)/);
    expect(adminSrc).toMatch(/doc\(db, "callSessions", sessionToken\)/);
  });
});
