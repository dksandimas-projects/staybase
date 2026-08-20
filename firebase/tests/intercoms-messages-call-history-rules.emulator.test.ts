// Decision #216 (2026-08-19) closure: emulator-based rules test for
// the `intercoms/{roomId}/messages` create rule's `keys().hasOnly([...])`
// allowlist. Pins that the rule accepts the full 14-key payload
// `AdminContext.recordCallHistory` emits (the 10 always-on
// message fields + the 4 call-history fields), AND that a
// non-allowlisted key is rejected (the cross-file contract is
// enforced, not just declared).
//
// Why this exists: the pre-#216 rule was missing `callAnsweredByName`
// from the allowlist, so every post-#214 call-history write was
// rejected by the rule and the "Call answered" message never
// landed in the chat thread. The bug surfaced 2026-08-19 when
// the operator reported "i am not seeing the call history on
// the thread after the call, why is this?" — the cause was
// the rule's silent rejection of the writer's payload.
//
// The source-text test in
// `admin-app/src/__tests__/fol-02-call-history-mapper-drops.test.ts`
// pins the field is in the allowlist text. This test loads the
// real `firestore.rules` into the Firestore emulator and
// exercises the actual access decisions, so an
// invalid-but-present rule (NC-02c's `keys().union(...)` shape
// bug) fails here even though every source-text test would
// pass. Pattern matches the existing
// `firebase/tests/notifications.rules.test.ts` and
// `firebase/tests/guests-audio-routing-rules.emulator.test.ts`.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is
// NOT part of the default `npm test`. From the repo root:
//
//     npm run test:rules
//
// which wraps this file in `firebase emulators:exec --only firestore`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";

let testEnv: RulesTestEnvironment;

// `isStaff()` in firestore.rules reads `request.auth.token.role`,
// so we only need to mint auth contexts with the right custom
// claim — no `guests` doc seeding required for this test (the
// intercoms.messages rule is gated solely on `isStaff()`).
const staffCtx = (uid = STAFF_UID) =>
  testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = STAFF_UID) =>
  testEnv.authenticatedContext(uid, { role: "admin" });
const guestCtx = (uid = "guest-1") =>
  testEnv.authenticatedContext(uid, { role: "guest" });
const unauthCtx = () => testEnv.unauthenticatedContext();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed a `intercoms/{roomId}` thread doc (the create rule on
  // the parent collection is `allow read, create, update: if
  // true;` so seeding with rules disabled is unnecessary, but
  // we keep the test idempotent across runs).
});

// Per decision #216: the FULL payload `AdminContext.recordCallHistory`
// emits, mirroring `admin-app/src/context/AdminContext.tsx:3547-3575`.
// Any future change to that write payload that adds a new key MUST
// be accompanied by a rule change + a new pin in this file + the
// source-text test in `fol-02-call-history-mapper-drops.test.ts`.
const callHistoryMessage = (roomId: string) => ({
  text: "Call answered by Maria at 2:14 PM · 3m 22s",
  sender: "system" as const,
  guestName: "Front Desk",
  timestamp: serverTimestamp(),
  isRead: true,
  isQuickRequest: false,
  isStoreOrder: false,
  isEarlyCheckInRequest: false,
  currentStayId: null,
  messageType: "call-answered" as const,
  callStartedAt: Timestamp.fromMillis(Date.now() - 3 * 60 * 1000),
  callDuration: 202,
  callAnsweredByName: "Maria",
});

describe("intercoms/{roomId}/messages — call-history fields in the create allowlist (decision #216, 2026-08-19)", () => {
  it("staff can create a system call-answered message with the full 14-key payload (the happy path)", async () => {
    // This is the exact payload `recordCallHistory` emits. The
    // pre-#216 rule rejected this create because
    // `callAnsweredByName` was missing from the allowlist.
    await assertSucceeds(
      addDoc(
        collection(staffCtx().firestore(), "intercoms", "room-202", "messages"),
        callHistoryMessage("room-202")
      )
    );
  });

  it("admin can create a system call-missed message with the full payload (no `callStartedAt`/duration for missed)", async () => {
    // `call-missed` messages still emit `callAnsweredByName`
    // (the field is `null` for the miss case, but the KEY is
    // always present in the writer's payload). The
    // `callStartedAt` is null and `callDuration` is the
    // ringing duration — the keys are still in the payload,
    // so the rule must allowlist both.
    await assertSucceeds(
      addDoc(
        collection(adminCtx().firestore(), "intercoms", "room-203", "messages"),
        {
          ...callHistoryMessage("room-203"),
          text: "Missed call at 2:14 PM · rang 18s",
          messageType: "call-missed" as const,
          callStartedAt: null,
          callDuration: 18,
          callAnsweredByName: null, // null for the missed path
        }
      )
    );
  });

  it("admin can create a system call-declined message with the full payload", async () => {
    await assertSucceeds(
      addDoc(
        collection(adminCtx().firestore(), "intercoms", "room-204", "messages"),
        {
          ...callHistoryMessage("room-204"),
          text: "Call declined at 2:14 PM",
          messageType: "call-declined" as const,
          callStartedAt: null,
          callDuration: null,
          callAnsweredByName: null, // null for the declined path
        }
      )
    );
  });

  // Per decision #217 (2026-08-19): the new "call-failed" outcome
  // joins the enum. The closed-enum rule
  // (`messageType in ["call-answered", "call-missed", "call-declined", "call-failed"]`)
  // must accept it. Without this test, a future refactor that
  // forgets to add "call-failed" to the rule's enum list would
  // silently break the accept-failed audit trail (the same shape
  // of bug as decision #216).
  it("admin can create a system call-failed message with the full payload", async () => {
    await assertSucceeds(
      addDoc(
        collection(adminCtx().firestore(), "intercoms", "room-207", "messages"),
        {
          ...callHistoryMessage("room-207"),
          text: "Call failed at 2:14 PM",
          messageType: "call-failed" as const,
          callStartedAt: null, // call-failed has no connected timestamp
          callDuration: 0,     // 0ms — claim committed but audio plumbing failed instantly
          callAnsweredByName: null, // null: the staff never actually answered
        }
      )
    );
  });

  // Per decision #217 (2026-08-19): the rule rejects a messageType
  // outside the closed enum. This is the regression-in-reverse for
  // the new "call-failed" outcome — a future typo on the client
  // (e.g. "call-fail" or "callFailed") is caught by the rule, not
  // silently written as a malformed audit-trail doc.
  it("rejects a system message with a messageType outside the closed enum", async () => {
    await assertFails(
      addDoc(
        collection(adminCtx().firestore(), "intercoms", "room-208", "messages"),
        {
          ...callHistoryMessage("room-208"),
          messageType: "call-typo" as any, // intentional typo
        }
      )
    );
  });

  it("rejects a system message with a non-allowlisted key (the cross-file contract is enforced, not just declared)", async () => {
    // A staff member tries to sneak a `role: "admin"` field
    // into a system call-history message (a privilege-
    // escalation attempt that the per-write gate should
    // block). The `keys().hasOnly([...])` rule fires and the
    // create fails.
    //
    // This negative case is the gold-standard pin: it proves
    // the rule is actually enforced at evaluation time, not
    // just present in the text. The source-text test catches a
    // future refactor that drops a field from the allowlist;
    // THIS test catches a future refactor that uses an invalid
    // rule shape (NC-02c's `keys().union(...)` shape bug would
    // pass every source-text test but fail this one).
    await assertFails(
      addDoc(
        collection(staffCtx().firestore(), "intercoms", "room-205", "messages"),
        {
          ...callHistoryMessage("room-205"),
          role: "admin", // <-- non-allowlisted key
        }
      )
    );
  });

  it("rejects a system message where `callAnsweredByName` is the ONLY key added (catches a future refactor that drops the #216 allowlist extension)", async () => {
    // This is the exact pre-#216 bug, in reverse: a writer
    // emits `callAnsweredByName` but the rule's allowlist
    // doesn't include it. If a future refactor accidentally
    // drops `callAnsweredByName` from the `hasOnly` list,
    // this test will fail — the rule rejects the create.
    // (The pre-#216 bug was the same shape: rule missing
    // `callAnsweredByName` → write rejected → thread never
    // receives the "Call answered" message.)
    await assertFails(
      addDoc(
        collection(staffCtx().firestore(), "intercoms", "room-206", "messages"),
        {
          // Minimal payload: only the call-history fields. The
          // rule fires if any of these is not in the allowlist.
          text: "Call answered by Maria at 2:14 PM · 3m 22s",
          sender: "system" as const,
          guestName: "Front Desk",
          timestamp: serverTimestamp(),
          isRead: true,
          isQuickRequest: false,
          isStoreOrder: false,
          isEarlyCheckInRequest: false,
          currentStayId: null,
          messageType: "call-answered" as const,
          callStartedAt: Timestamp.fromMillis(Date.now()),
          callDuration: 60,
          // If `callAnsweredByName` is missing from the
          // allowlist, this addDoc fails with
          // `permission-denied`. The test catches the #216
          // regression in reverse.
          callAnsweredByName: "Maria",
          // Add a genuinely non-allowlisted key to force a
          // specific failure: the test asserts `assertFails`,
          // so it needs SOME key to trip the rule. A
          // `randomExtraField` is the canonical "this is
          // outside the allowlist" trigger.
          randomExtraField: "should-not-be-here",
        }
      )
    );
  });
});

describe("intercoms/{roomId}/messages — staff / non-staff auth gates (regression guard)", () => {
  // The create rule is `allow create: if isStaff() && …`. The
  // contract tests below pin that the auth gate is intact —
  // a future refactor that accidentally drops the `isStaff()`
  // check would let any signed-in user write a system call-
  // history message, which would break the chat-thread audit
  // trail (the messageType discriminator is the only thing
  // that makes the structured render trustworthy).
  it("a non-staff signed-in user (role: 'guest') CANNOT create a system call-answered message", async () => {
    await assertFails(
      addDoc(
        collection(guestCtx().firestore(), "intercoms", "room-207", "messages"),
        callHistoryMessage("room-207")
      )
    );
  });

  it("an unauthenticated client CANNOT create a system call-answered message", async () => {
    await assertFails(
      addDoc(
        collection(unauthCtx().firestore(), "intercoms", "room-208", "messages"),
        callHistoryMessage("room-208")
      )
    );
  });

  it("a non-staff signed-in user CANNOT create a regular front-desk chat message (the auth gate is universal)", async () => {
    // Sanity check: the `isStaff()` gate is universal across
    // all message creates, not just the call-history subset.
    // A future refactor that narrows the gate to "only
    // call-history requires staff" would be a privilege
    // escalation — this test catches that.
    await assertFails(
      addDoc(
        collection(guestCtx().firestore(), "intercoms", "room-209", "messages"),
        {
          text: "Hi, how can I help?",
          sender: "front-desk" as const,
          guestName: "Front Desk",
          timestamp: serverTimestamp(),
          isRead: true,
          isQuickRequest: false,
          isStoreOrder: false,
          isEarlyCheckInRequest: false,
          currentStayId: null,
        }
      )
    );
  });
});
