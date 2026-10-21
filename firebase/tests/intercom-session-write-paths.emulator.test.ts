/**
 * The session-thread WRITE paths — the ones the desk and the guest
 * actually use, asserted against the real rules.
 *
 * This file exists because of a live production bug found on
 * 2026-10-21, AFTER the 2.18.5 release had already shipped the
 * capability-session rules to production:
 *
 *   The desk's reply is a client-side `addDoc` into
 *   `intercomSessions/{sessionToken}/messages` (AdminContext —
 *   `collection(db, "intercomSessions", sessionToken, "messages")`).
 *   The rule said `allow create: if false`. `create` and `update` are
 *   DISTINCT operations, so `allow update: if isStaff()` did not
 *   cover a new reply document — every desk reply came back
 *   PERMISSION_DENIED. The guest's message arrived (the server writes
 *   it), the desk saw it in the inbox, and the reply was rejected.
 *
 * It shipped because the suite had no test that exercised the desk's
 * actual write path against the rules, and because the intercom
 * refactor had never been run end-to-end.
 *
 * The second test pins the DELETE semantics: a separate
 * `allow delete: if isStaff()` next to an unconditional
 * `allow write: if true` is DEAD CODE (`write` ⊇ `create` + `update` +
 * `delete`, and matching allows are OR'd). The guest legitimately
 * deletes its own call session on hang-up, so the token holder owns
 * the document and the rule says so explicitly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const TOKEN = "regression-token-0123456789abcdef0123456789ab";

describe("session-thread write paths — the desk can actually reply", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT_ID });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "intercomSessions", TOKEN), { createdAt: serverTimestamp() });
      await setDoc(doc(fs, "intercomSessions", TOKEN, "messages", "guest-1"), {
        text: "Good morning, could I get an extra towel?",
        sender: "guest",
        guestName: "Maria Santos",
        isRead: false,
        timestamp: serverTimestamp()
      });
      await setDoc(doc(fs, "callSessions", TOKEN), { status: "ringing" });
      await setDoc(doc(fs, "callSessions", TOKEN, "iceCandidates", "c1"), {
        candidate: "candidate:1",
        from: "guest"
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("STAFF can create a reply in the session thread (the desk's real write path)", async () => {
    const staffDb = env.authenticatedContext("staff-uid", { role: "front-desk" }).firestore();
    const reply = await addDoc(collection(staffDb, "intercomSessions", TOKEN, "messages"), {
      text: "Of course, I will bring one right away.",
      sender: "front-desk",
      guestName: "Front Desk",
      isRead: true,
      timestamp: serverTimestamp()
    });
    expect(reply.id).toBeTruthy();

    const snap = await getDoc(reply);
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.sender).toBe("front-desk");
  });

  it("an UNAUTHENTICATED caller still cannot create in the session thread", async () => {
    const anonDb = env.unauthenticatedContext().firestore();
    await expect(
      addDoc(collection(anonDb, "intercomSessions", TOKEN, "messages"), {
        text: "forged reply",
        sender: "front-desk",
        guestName: "Front Desk",
        isRead: true,
        timestamp: serverTimestamp()
      })
    ).rejects.toThrow(/PERMISSION_DENIED/i);
  });

  it("the guest can flip isRead on a message but cannot rewrite its text", async () => {
    const guestDb = env.unauthenticatedContext().firestore();
    const ref = doc(guestDb, "intercomSessions", TOKEN, "messages", "guest-1");

    await updateDoc(ref, { isRead: true });
    const after = await getDoc(ref);
    expect(after.data()?.isRead).toBe(true);

    await expect(updateDoc(ref, { text: "rewritten by the guest" })).rejects.toThrow(
      /PERMISSION_DENIED/i
    );
  });

  it("the token holder owns the call session, including DELETE (the guest's hang-up cleanup)", async () => {
    const guestDb = env.unauthenticatedContext().firestore();

    // create + update + read
    await setDoc(doc(guestDb, "callSessions", TOKEN), { status: "ringing", offer: { type: "offer" } });
    await updateDoc(doc(guestDb, "callSessions", TOKEN), { status: "active" });
    const snap = await getDoc(doc(guestDb, "callSessions", TOKEN));
    expect(snap.data()?.status).toBe("active");

    // delete — IntercomPage.tsx does this on hang-up
    await deleteDoc(doc(guestDb, "callSessions", TOKEN));
    const gone = await getDoc(doc(guestDb, "callSessions", TOKEN));
    expect(gone.exists()).toBe(false);
  });

  it("the token holder can add and read its own ICE candidates", async () => {
    const guestDb = env.unauthenticatedContext().firestore();
    await addDoc(collection(guestDb, "callSessions", TOKEN, "iceCandidates"), {
      candidate: "candidate:2",
      from: "guest"
    });
    const snap = await getDoc(doc(guestDb, "callSessions", TOKEN, "iceCandidates", "c1"));
    expect(snap.exists()).toBe(true);
  });
});
