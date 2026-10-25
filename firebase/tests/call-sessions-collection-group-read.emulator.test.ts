/**
 * The staff COLLECTION-GROUP read on `callSessions`.
 *
 * Found in production on 2026-10-23 by the AI browser QA pass
 * (`plan/project/QA-REPORT-2026-10-23.md` §3.10): the admin app logs
 *
 *     Error listening to WebRTC calls: FirebaseError:
 *     Missing or insufficient permissions.
 *
 * on EVERY sign-in, for BOTH the admin and the front-desk identity. The
 * listener is `collectionGroup(db, "callSessions")` in
 * `admin-app/src/context/AdminContext.tsx` — it is how the desk sees an
 * incoming room call.
 *
 * WHY THE GROUP QUERY WAS DENIED
 *
 * A Firestore collection-group query is DENIED unless the rules can prove
 * access for EVERY document in the group, at EVERY depth. The capability
 * block granted only the TOP-LEVEL shapes
 * (`callSessions/{sessionToken}` + `callSessions/{sessionToken}/iceCandidates/{id}`)
 * unconditionally — and a `match` block does NOT cascade into
 * subcollections, so a nested `<any-depth>/callSessions/{sessionToken}` path
 * had NO rule at all. Unprovable → denied, for staff and guests alike, even
 * though `collection("callSessions")` (top level only) returned 200.
 *
 * The fix is the same shape the `messages` group already uses (and the
 * shape the `charges` / `payments` / `refunds` groups use further down
 * the rules file): a recursive wildcard that grants STAFF the read at any
 * depth — `match /{path=**}/callSessions/{sessionToken}`.
 *
 * What this file pins:
 *   1. the desk's group read works for BOTH staff roles (admin + front-desk);
 *   2. the group returns the SESSION documents (not the ICE candidates);
 *   3. the guest's own single-document read still works (capability model);
 *   4. a non-staff caller — signed in as a member, or anonymous — is STILL
 *      refused the group query, i.e. the fix did not widen the guest's
 *      access.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const TOKEN = "call-session-token-0123456789abcdef01234567";

describe("callSessions — the desk can listen for incoming calls", () => {
  let env: RulesTestEnvironment;

  // `isStaff()` in firestore.rules reads `request.auth.token.role`, so a
  // STAFF context has to be minted with the role CLAIM — an authenticated
  // context without it is NOT staff (and a group query it cannot be
  // proved for is refused). The two roles are exercised separately because
  // the production defect hit both of them identically.
  const staffCtx = (role: "admin" | "front-desk") =>
    env.authenticatedContext(`${role}-uid`, { role });

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
  });

  beforeEach(async () => {
    // Every file in this suite boots the SAME emulator on the SAME port
    // with the SAME projectId, so the fixture is reset per test — the
    // group-size assertions below must not depend on what another file
    // left behind.
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "callSessions", TOKEN), {
        status: "ringing",
        roomId: "101",
        guestName: "Maria Santos",
        createdAt: serverTimestamp()
      });
      await setDoc(doc(fs, "callSessions", TOKEN, "iceCandidates", "c1"), {
        candidate: "candidate:1",
        from: "guest"
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("ADMIN can run the collection-group query the desk's call listener uses", async () => {
    const snap = await getDocs(collectionGroup(staffCtx("admin").firestore(), "callSessions"));
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe(TOKEN);
    expect(snap.docs[0].data().roomId).toBe("101");
  });

  it("FRONT-DESK can run the same collection-group query", async () => {
    const snap = await getDocs(collectionGroup(staffCtx("front-desk").firestore(), "callSessions"));
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe(TOKEN);
    expect(snap.docs[0].data().status).toBe("ringing");
  });

  it("the group query returns the SESSION documents, not the ICE candidates", async () => {
    // The ICE candidate lives in the `iceCandidates` collection, so it is
    // NOT part of the `callSessions` group — one session document in the
    // group, one candidate document outside it.
    const snap = await getDocs(collectionGroup(staffCtx("admin").firestore(), "callSessions"));
    expect(snap.docs.map((d) => d.ref.path)).toEqual([`callSessions/${TOKEN}`]);
  });

  it("STAFF can read one session document directly", async () => {
    const snap = await getDoc(doc(staffCtx("front-desk").firestore(), "callSessions", TOKEN));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.status).toBe("ringing");
  });

  it("STAFF can read the session's ICE candidates (the desk's answer path)", async () => {
    const snap = await getDocs(
      collection(staffCtx("admin").firestore(), "callSessions", TOKEN, "iceCandidates")
    );
    expect(snap.size).toBe(1);
  });

  it("the token holder (the guest) can read its own session document", async () => {
    const snap = await getDoc(doc(env.unauthenticatedContext().firestore(), "callSessions", TOKEN));
    expect(snap.exists()).toBe(true);
  });

  it("a signed-in NON-STAFF caller (a member) cannot read the collection group", async () => {
    const fs = env.authenticatedContext("member-uid").firestore();
    await expect(getDocs(collectionGroup(fs, "callSessions"))).rejects.toThrow();
  });

  it("an unrelated anonymous caller cannot read the collection group", async () => {
    const fs = env.unauthenticatedContext().firestore();
    await expect(getDocs(collectionGroup(fs, "callSessions"))).rejects.toThrow();
  });
});
