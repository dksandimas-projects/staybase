/**
 * The staff COLLECTION-GROUP read on `callSessions`.
 *
 * Found in production on 2026-10-23 by the AI browser QA pass: the admin
 * app logs
 *
 *     Error listening to WebRTC calls: FirebaseError:
 *     Missing or insufficient permissions.
 *
 * on EVERY sign-in, for BOTH the admin and the front-desk identity. The
 * listener is `collectionGroup(db, "callSessions")` in
 * `admin-app/src/context/AdminContext.tsx` — it is how the desk sees an
 * incoming room call.
 *
 * A Firestore collection-group query is DENIED unless the rules can prove
 * access for EVERY document in the group. The rules grant
 * `callSessions/{sessionToken}` and `callSessions/{sessionToken}/iceCandidates/{id}`
 * unconditionally, so this test pins whether the staff group read actually
 * works — and, because the desk's whole incoming-call surface depends on
 * it, it also pins the single-doc read the guest relies on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
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

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
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

  it("STAFF can run the collection-group query the desk's call listener uses", async () => {
    const fs = env.authenticatedContext("staff-uid").firestore();
    const snap = await getDocs(collectionGroup(fs, "callSessions"));
    expect(snap.size).toBe(1);
    expect(snap.docs[0].data().roomId).toBe("101");
  });

  it("STAFF can read one session document directly", async () => {
    const fs = env.authenticatedContext("staff-uid").firestore();
    const snap = await getDoc(doc(fs, "callSessions", TOKEN));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.status).toBe("ringing");
  });

  it("the token holder (the guest) can read its own session document", async () => {
    const fs = env.unauthenticatedContext().firestore();
    const snap = await getDoc(doc(fs, "callSessions", TOKEN));
    expect(snap.exists()).toBe(true);
  });

  it("an unrelated anonymous caller cannot read the collection group", async () => {
    const fs = env.unauthenticatedContext().firestore();
    await expect(getDocs(collectionGroup(fs, "callSessions"))).rejects.toThrow();
  });
});
