// PR-AUDIT rules hardening — emulator verification for the 7 blockers
// closed on 2026-10-20 (see
// `plan/project/AUDIT-PRODUCTION-READINESS-2026-10-20.md`).
//
// This is the GOLD-STANDARD test for that change: it loads the real
// `firestore.rules` into the Firestore emulator and exercises the
// actual access decisions, so a rule that is present-but-wrong fails
// here even when every source-text test passes.
//
// It covers the five rule-level blockers:
//
//   B1  `settings/breakfastConfig/breakfastConfigChangeLog` had NO rule
//       block at all (subcollections do not inherit the parent match),
//       so every breakfast-config audit write was PERMISSION_DENIED and
//       swallowed by a `console.warn` — the audit trail silently lost.
//   B2  `vouchers` was staff-read-only, so a signed-in member's Spark
//       Rewards free-night voucher read was PERMISSION_DENIED and the
//       portal rendered an empty list.
//   B3  `intercoms/{roomId}/messages` was `allow read: if true` — every
//       room's guest↔desk conversation was world-readable.
//   B4  `calls/{roomId}/{document=**}` was `allow read, write: if true` —
//       world-readable AND forgeable (SDP injection).
//   B5  `intercoms/{roomId}` was `allow read, create, update: if true` —
//       any anonymous caller could set `resolved: true` and silence a
//       live guest request to the front desk.
//
// …plus the capability model that replaced the public guest paths: the
// guest's thread and call session now live under paths containing a
// random 32-hex session token, so access is capability-based.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is NOT part of
// the default `npm test`. From the repo root:
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
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";
const ADMIN_UID = "admin-bob";
const MEMBER_UID = "member-maria";
const OTHER_MEMBER_UID = "member-santo";

let testEnv: RulesTestEnvironment;

// `isStaff()` / `isAdmin()` read `request.auth.token.role`, so the
// contexts only need the right custom claim — no `guests` doc seeding.
const staffCtx = (uid = STAFF_UID) =>
  testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = ADMIN_UID) =>
  testEnv.authenticatedContext(uid, { role: "admin" });
const memberCtx = (uid = MEMBER_UID) =>
  testEnv.authenticatedContext(uid, { role: "guest" });
const unauthCtx = () => testEnv.unauthenticatedContext();

const SESSION_TOKEN = "a".repeat(32);

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
});

describe("B1 — settings/breakfastConfig/breakfastConfigChangeLog has a rule block", () => {
  it("an admin CAN write the breakfast-config change log (it was PERMISSION_DENIED before)", async () => {
    await assertSucceeds(
      setDoc(
        doc(adminCtx().firestore(), "settings", "breakfastConfig", "breakfastConfigChangeLog", "log-1"),
        { field: "cutoffTime", before: "06:00", after: "07:00", changedBy: ADMIN_UID, changedAt: serverTimestamp() }
      )
    );
  });

  it("front-desk staff CANNOT write the change log (admin-only, mirroring the parent settings doc)", async () => {
    await assertFails(
      setDoc(
        doc(staffCtx().firestore(), "settings", "breakfastConfig", "breakfastConfigChangeLog", "log-2"),
        { field: "cutoffTime", before: "06:00", after: "07:00", changedBy: STAFF_UID, changedAt: serverTimestamp() }
      )
    );
  });

  it("an unauthenticated client CANNOT write the change log", async () => {
    await assertFails(
      setDoc(
        doc(unauthCtx().firestore(), "settings", "breakfastConfig", "breakfastConfigChangeLog", "log-3"),
        { field: "cutoffTime", before: "06:00", after: "07:00", changedBy: "anon", changedAt: serverTimestamp() }
      )
    );
  });

  it("staff CAN read the change log", async () => {
    await assertSucceeds(
      getDoc(doc(staffCtx().firestore(), "settings", "breakfastConfig", "breakfastConfigChangeLog", "log-1"))
    );
  });
});

describe("B2 — a member can read their OWN Spark Rewards voucher", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", "reward-maria"), {
        kind: "reward",
        memberId: MEMBER_UID,
        code: "FREE-NIGHT-MARIA",
        valueType: "free-night",
        discountValue: 0,
        usageCount: 0,
        usageCap: 1,
        isActive: true,
      });
      await setDoc(doc(ctx.firestore(), "vouchers", "reward-santo"), {
        kind: "reward",
        memberId: OTHER_MEMBER_UID,
        code: "FREE-NIGHT-SANTO",
        valueType: "free-night",
        discountValue: 0,
        usageCount: 0,
        usageCap: 1,
        isActive: true,
      });
      await setDoc(doc(ctx.firestore(), "vouchers", "promo-summer"), {
        kind: "promo",
        code: "SUMMER-10",
        discountType: "flat",
        discountValue: 100,
        usageCount: 0,
        usageCap: 100,
        isActive: true,
      });
    });
  });

  it("the portal's OWN query succeeds (the exact query RewardsPage.tsx issues)", async () => {
    // The portal query is
    //   query(collection(db,"vouchers"),
    //         where("kind","==","reward"),
    //         where("memberId","==",user.uid))
    // This was PERMISSION_DENIED before the owner-scoped branch.
    await assertSucceeds(
      getDocs(
        query(
          collection(memberCtx().firestore(), "vouchers"),
          where("kind", "==", "reward"),
          where("memberId", "==", MEMBER_UID)
        )
      )
    );
  });

  it("the member's own voucher is actually returned", async () => {
    const snapshot = await getDocs(
      query(
        collection(memberCtx().firestore(), "vouchers"),
        where("kind", "==", "reward"),
        where("memberId", "==", MEMBER_UID)
      )
    );
    expect(snapshot.docs.map((d) => d.id)).toEqual(["reward-maria"]);
  });

  it("a member CANNOT read another member's voucher by id", async () => {
    await assertFails(getDoc(doc(memberCtx().firestore(), "vouchers", "reward-santo")));
  });

  it("a member CANNOT query for another member's voucher", async () => {
    await assertFails(
      getDocs(
        query(
          collection(memberCtx().firestore(), "vouchers"),
          where("kind", "==", "reward"),
          where("memberId", "==", OTHER_MEMBER_UID)
        )
      )
    );
  });

  it("a member CANNOT list every voucher (the promo codes stay staff-only)", async () => {
    await assertFails(
      getDocs(query(collection(memberCtx().firestore(), "vouchers"), where("kind", "==", "promo")))
    );
  });

  it("staff can still read every voucher", async () => {
    await assertSucceeds(
      getDocs(query(collection(staffCtx().firestore(), "vouchers"), where("kind", "==", "promo")))
    );
  });
});

describe("B3/B5 — the intercom thread and its messages are staff-only", () => {
  it("an unauthenticated client CANNOT read the intercom thread document", async () => {
    await assertFails(getDoc(doc(unauthCtx().firestore(), "intercoms", "room-101")));
  });

  it("an unauthenticated client CANNOT read the guest messages", async () => {
    await assertFails(
      getDocs(collection(unauthCtx().firestore(), "intercoms", "room-101", "messages"))
    );
  });

  it("an unauthenticated client CANNOT SILENCE a live guest request (the `resolved` attack)", async () => {
    // This is the B5 hole: `intercoms/{roomId}` used to be
    // `allow read, create, update: if true`, so setting `resolved: true`
    // made the desk stop showing a real guest's open request.
    await assertFails(
      setDoc(doc(unauthCtx().firestore(), "intercoms", "room-101"), {
        roomId: "room-101",
        roomNumber: "room-101",
        resolved: true,
        updatedAt: serverTimestamp()
      }, { merge: true })
    );
  });

  it("a non-staff signed-in user CANNOT write the intercom thread either", async () => {
    await assertFails(
      setDoc(doc(memberCtx().firestore(), "intercoms", "room-101"), {
        roomId: "room-101",
        roomNumber: "room-101",
        resolved: true,
        updatedAt: serverTimestamp()
      }, { merge: true })
    );
  });

  it("staff CAN read the thread and its messages", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "intercoms", "room-101")));
    await assertSucceeds(
      getDocs(collection(staffCtx().firestore(), "intercoms", "room-101", "messages"))
    );
  });
});

describe("B4 — the call signalling path is staff-only", () => {
  it("an unauthenticated client CANNOT read a call document (it carries guestName)", async () => {
    await assertFails(getDoc(doc(unauthCtx().firestore(), "calls", "room-101")));
  });

  it("an unauthenticated client CANNOT write a call document (SDP injection)", async () => {
    // Writing `status: "active"` with an attacker-supplied SDP answer
    // would point the guest's peer connection at the attacker.
    await assertFails(
      setDoc(doc(unauthCtx().firestore(), "calls", "room-101"), {
        status: "active",
        offer: { type: "offer", sdp: "v=0 attacker-controlled" },
        answer: { type: "answer", sdp: "v=0 attacker-controlled" },
        guestName: "Attacker",
        startedAt: serverTimestamp(),
        endedAt: null
      }, { merge: true })
    );
  });

  it("an unauthenticated client CANNOT write ICE candidates", async () => {
    await assertFails(
      addDoc(collection(unauthCtx().firestore(), "calls", "room-101", "iceCandidates"), {
        candidate: { candidate: "attacker", sdpMid: "0" },
        from: "guest",
        createdAt: serverTimestamp()
      })
    );
  });

  it("staff CAN read and write the call document", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "calls", "room-101")));
    await assertSucceeds(
      setDoc(doc(staffCtx().firestore(), "calls", "room-101"), {
        status: "ringing",
        guestName: "Maria",
        startedAt: serverTimestamp(),
        endedAt: null
      }, { merge: true })
    );
  });
});

describe("The capability model — the guest's session path", () => {
  it("a caller holding the session token CAN read the session thread", async () => {
    // Access is capability-based: the token is IN THE PATH, so a caller
    // who cannot construct the path cannot read the thread. The token
    // itself is not a Firestore credential.
    await assertSucceeds(
      getDocs(collection(unauthCtx().firestore(), "intercomSessions", SESSION_TOKEN, "messages"))
    );
  });

  it("the guest CANNOT create message documents directly (the server endpoint writes them)", async () => {
    await assertFails(
      addDoc(collection(unauthCtx().firestore(), "intercomSessions", SESSION_TOKEN, "messages"), {
        text: "spoofed",
        sender: "guest",
        guestName: "Attacker",
        timestamp: serverTimestamp(),
        isRead: false,
        isQuickRequest: false,
        isStoreOrder: false,
        isEarlyCheckInRequest: false,
        currentStayId: "forged"
      })
    );
  });

  it("a caller holding the session token CAN write the call session (offer + ICE)", async () => {
    await assertSucceeds(
      setDoc(doc(unauthCtx().firestore(), "callSessions", SESSION_TOKEN), {
        status: "ringing",
        offer: { type: "offer", sdp: "v=0 guest-offer" },
        answer: null,
        guestName: "Maria",
        roomNumber: "101",
        startedAt: serverTimestamp(),
        endedAt: null
      })
    );
    await assertSucceeds(
      addDoc(collection(unauthCtx().firestore(), "callSessions", SESSION_TOKEN, "iceCandidates"), {
        candidate: { candidate: "guest-candidate", sdpMid: "0" },
        from: "guest",
        createdAt: serverTimestamp()
      })
    );
  });

  it("the capability IS the path — a session the caller was never given is still readable", async () => {
    // This is the honest shape of the capability model, stated as a
    // test so nobody mistakes it for a bug: the rule is unconditional,
    // so ANY caller who can construct the path can read it. Access
    // therefore rests entirely on the token being (a) 128 bits of
    // entropy and (b) unguessable — which is why `intercoms/{roomId}`
    // became staff-only (so the token cannot be enumerated) and why the
    // token is regenerated whenever the stay changes.
    await assertSucceeds(
      getDocs(collection(unauthCtx().firestore(), "intercomSessions", "b".repeat(32), "messages"))
    );
  });
});
