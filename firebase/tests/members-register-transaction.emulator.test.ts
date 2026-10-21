// PERM-01 (2026-10-21, Spark Inn production QA pass) — behavioral
// test for the Spark Rewards registration transaction.
//
// BACKGROUND
// ----------
// On 2026-10-21 the production QA pass found that
// `POST /api/members/register` returned HTTP 500
// ("We could not join Spark Rewards right now. Please try again.")
// for EVERY signed-in guest — i.e. joining Spark Rewards was
// completely broken in production.
//
// Root cause: `guest-app/server/handlers/members.ts` →
// `handleRegisterMember` → the `adminDb.runTransaction(...)` body
// wrote the member-number counter (`transaction.update(counterRef)`)
// and THEN read the welcome-bonus history row
// (`await transaction.get(welcomeHistoryRef)`). The Firestore
// Admin SDK requires all reads to be executed before all writes; the
// violation throws
//   "Firestore transactions require all reads to be executed before all writes."
// and aborts the transaction.
//
// WHY THE EXISTING SUITE MISSED IT
// --------------------------------
// - `guest-app/tests/api/members-register.test.ts` fully mocks
//   `firebase-admin` (mockSet / mockUpdate / mockBatchCommit), so the
//   mocked transaction enforces NO ordering rule.
// - `guest-app/tests/api/spark-rewards-tier-system-welcome-points.test.ts`
//   is a SOURCE-TEXT regex test: it asserts the *string*
//   `rewardsDoc = await adminDb.collection("settings").doc("rewardsConfig").get()`
//   appears in the file, and its comment claims "the read happens
//   before the `runTransaction` block so the `welcomePoints` value is
//   known before any writes (FOL-03)". That claim was about the
//   `rewardsConfig` read (which IS outside the transaction) — NOT
//   about the `pointsHistory/welcome` read, which IS inside the
//   transaction and was reading AFTER a write.
//
// So both existing layers were blind to it: the mock cannot express
// the constraint, and the regex cannot see ordering. This file is the
// missing layer.
//
// WHY THIS FILE USES THE ADMIN SDK (and not the web SDK)
// --------------------------------------------------------
// The production handler runs on the Firebase **Admin** SDK, and the
// Admin SDK enforces the read-before-write rule CLIENT-SIDE (it
// throws before the request is ever sent). The web SDK does not — it
// lets the transaction reach the server. Since this test must
// reproduce the exact production failure, it uses `firebase-admin`
// against the emulator via `FIRESTORE_EMULATOR_HOST` (which
// `firebase emulators:exec` sets for the command it runs). The other
// `*.emulator.test.ts` files use the web SDK because they assert
// rules-evaluated write paths; this one asserts a transaction-ordering
// contract, so it must use the SDK the handler uses.
//
// WHAT THIS FILE PINS
// -------------------
//   1. The OLD ordering (write → read) FAILS with the read-before-
//      write error. This is the regression sentinel: if a future
//      change re-introduces a read after a write in this
//      transaction, this assertion fails.
//   2. The NEW ordering (all reads → all writes) COMMITS and
//      produces the expected three writes: the member-number
//      counter, the member doc, and the `pointsHistory/welcome`
//      row.
//   3. The source file's ordering — the counter write must appear
//      AFTER the welcome-history read — so a silent revert of the
//      handler (which this file cannot import) is still caught.
//
// HOW TO RUN — requires the Firestore emulator (Java). Not part of
// `npm run test:fast`. From the repo root:
//     npm run test:rules
// or as part of the full suite:
//     npm test
// See `plan/docs/CONTRIBUTING.md §Testing` for the test-layer
// overview and the `*.emulator.test.ts` convention.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const MEMBER_UID = "qa-member-uid-0001";
const WELCOME_POINTS = 50;

// `firebase emulators:exec` exports FIRESTORE_EMULATOR_HOST for the
// command it runs, so the Admin SDK talks to the emulator instead of
// production. Assert it loudly — without it this test would touch
// the real project, which must never happen.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — this test must run under `npm run test:rules` (firebase emulators:exec). Refusing to run against a real project.",
  );
}

if (!getApps().length) {
  initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore();

beforeAll(() => {
  // Nothing to boot — the Admin SDK connects lazily to the emulator.
});

afterAll(async () => {
  await db.terminate();
});

beforeEach(async () => {
  // The Admin SDK has no `clearFirestore()`. The test only touches
  // three documents, so reset exactly those.
  await db.collection(`members/${MEMBER_UID}/pointsHistory`).doc("welcome").delete().catch(() => {});
  await db.collection("members").doc(MEMBER_UID).delete().catch(() => {});
  await db.collection("counters").doc("memberNumbers").delete().catch(() => {});
});

/**
 * The OLD (broken) ordering: the counter write lands BEFORE the
 * welcome-history read. The Admin SDK must reject this.
 */
async function runOldOrdering(): Promise<void> {
  const memberRef = db.collection("members").doc(MEMBER_UID);
  const counterRef = db.collection("counters").doc("memberNumbers");
  const welcomeHistoryRef = db.collection(`members/${MEMBER_UID}/pointsHistory`).doc("welcome");
  const now = new Date();

  await db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.get(memberRef);
    const existingMember = memberDoc.exists ? memberDoc.data() : {};
    if (existingMember?.memberNumber) return;

    const counterDoc = await transaction.get(counterRef);
    const sequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;

    // ← the write that broke it
    if (counterDoc.exists) transaction.update(counterRef, { count: sequence, updatedAt: now });
    else transaction.set(counterRef, { count: sequence, createdAt: now, updatedAt: now });

    // ← the read that came too late
    const welcomeDocSnap = await transaction.get(welcomeHistoryRef);
    const welcomeAmount = welcomeDocSnap.exists ? 0 : WELCOME_POINTS;

    transaction.set(
      memberRef,
      { memberNumber: `SR-${String(sequence).padStart(5, "0")}`, rewardsPoints: welcomeAmount, updatedAt: now },
      { merge: true },
    );
  });
}

/**
 * The NEW (fixed) ordering: every read completes before any write.
 */
async function runNewOrdering(): Promise<{ memberNumber: string; welcomeAmount: number }> {
  const memberRef = db.collection("members").doc(MEMBER_UID);
  const counterRef = db.collection("counters").doc("memberNumbers");
  const welcomeHistoryRef = db.collection(`members/${MEMBER_UID}/pointsHistory`).doc("welcome");
  const now = new Date();
  let memberNumber = "";
  let welcomeAmount = 0;

  await db.runTransaction(async (transaction) => {
    // ── reads ──
    const memberDoc = await transaction.get(memberRef);
    const existingMember = memberDoc.exists ? memberDoc.data() : {};
    if (existingMember?.memberNumber) {
      memberNumber = existingMember.memberNumber;
      return;
    }
    const counterDoc = await transaction.get(counterRef);
    const sequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;
    memberNumber = `SR-${String(sequence).padStart(5, "0")}`;
    const welcomeDocSnap = await transaction.get(welcomeHistoryRef);
    welcomeAmount = welcomeDocSnap.exists ? 0 : WELCOME_POINTS;

    // ── writes (all reads complete) ──
    if (counterDoc.exists) transaction.update(counterRef, { count: sequence, updatedAt: now });
    else transaction.set(counterRef, { count: sequence, createdAt: now, updatedAt: now });

    transaction.set(
      memberRef,
      {
        fullName: "QA Reward Member",
        email: "qa.member+sparkinn.dev@gmail.com",
        phone: "09170000000",
        photoUrl: "",
        authProvider: "email",
        memberNumber,
        isMember: true,
        memberSince: now,
        rewardsPoints: (Number(existingMember?.rewardsPoints) || 0) + welcomeAmount,
        completedStays: Number(existingMember?.completedStays || 0),
        currentLevel: existingMember?.currentLevel ?? null,
        tier: existingMember?.tier || "standard",
        isActive: existingMember?.isActive !== false,
        createdAt: existingMember?.createdAt || now,
        updatedAt: now,
      },
      { merge: true },
    );

    if (welcomeAmount > 0) {
      transaction.set(welcomeHistoryRef, {
        type: "welcome",
        points: welcomeAmount,
        memberId: MEMBER_UID,
        note: `Welcome bonus (${welcomeAmount} points)`,
        createdAt: now,
        createdBy: "system",
      });
    }
  });

  return { memberNumber, welcomeAmount };
}

describe("PERM-01 — Spark Rewards registration transaction ordering", () => {
  it("REJECTS a read that follows a write (the 2026-10-21 production bug)", async () => {
    await expect(runOldOrdering()).rejects.toThrow(
      /all reads to be executed before all writes/i,
    );
  });

  it("COMMITS when every read precedes every write", async () => {
    const { memberNumber, welcomeAmount } = await runNewOrdering();

    expect(memberNumber).toBe("SR-00001");
    expect(welcomeAmount).toBe(WELCOME_POINTS);

    const memberSnap = await db.collection("members").doc(MEMBER_UID).get();
    expect(memberSnap.exists).toBe(true);
    expect(memberSnap.data()?.memberNumber).toBe("SR-00001");
    expect(memberSnap.data()?.rewardsPoints).toBe(WELCOME_POINTS);
    expect(memberSnap.data()?.isMember).toBe(true);

    const counterSnap = await db.collection("counters").doc("memberNumbers").get();
    expect(counterSnap.exists).toBe(true);
    expect(counterSnap.data()?.count).toBe(1);

    const welcomeSnap = await db
      .collection(`members/${MEMBER_UID}/pointsHistory`)
      .doc("welcome")
      .get();
    expect(welcomeSnap.exists).toBe(true);
    expect(welcomeSnap.data()?.type).toBe("welcome");
    expect(welcomeSnap.data()?.points).toBe(WELCOME_POINTS);
  });

  it("is idempotent — a second run preserves memberNumber and does not double-credit", async () => {
    await runNewOrdering();
    const second = await runNewOrdering();

    // The `existingMember.memberNumber` short-circuit path returns
    // early, so the welcome bonus is NOT credited twice.
    expect(second.memberNumber).toBe("SR-00001");
    expect(second.welcomeAmount).toBe(0);

    const memberSnap = await db.collection("members").doc(MEMBER_UID).get();
    expect(memberSnap.data()?.rewardsPoints).toBe(WELCOME_POINTS);
  });

  it("SOURCE GUARD — the handler's counter write must come after the welcome-history read", () => {
    const src = readFileSync(
      resolve(__dirname, "../../guest-app/server/handlers/members.ts"),
      "utf8",
    );

    const welcomeReadIdx = src.indexOf("await transaction.get(welcomeHistoryRef)");
    const counterWriteIdx = src.indexOf("transaction.update(counterRef,");
    expect(welcomeReadIdx).toBeGreaterThan(-1);
    expect(counterWriteIdx).toBeGreaterThan(-1);

    // The counter write must NOT precede the welcome-history read.
    expect(counterWriteIdx).toBeGreaterThan(welcomeReadIdx);
  });
});
