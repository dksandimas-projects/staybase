// NC-02d (post-ship review 2026-07-15): emulator-based rules test for the
// `notifications` collection.
//
// Why this exists: the `phase-12-notification-center.test.ts` rules tests are
// SOURCE-PATTERN (grep) tests — they assert the rule *text* is present but
// never evaluate it. That blind spot let NC-02c ship: a rule that used
// `keys().union(...)` (invalid — `keys()` is a List, `.union()` is Set-only)
// passed every grep test while actually erroring at evaluation time and
// denying all mark-read writes in production. This test loads the real
// `firestore.rules` into the Firestore emulator and exercises the actual
// access decisions, so an invalid-but-present rule fails here.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is NOT part of the
// default `npm test`. From the repo root:
//     npm run test:rules
// which wraps this file in `firebase emulators:exec --only firestore`. See
// README §"Firebase emulator tests".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";
const OTHER_UID = "staff-bob";

let testEnv: RulesTestEnvironment;

// isStaff() in firestore.rules reads request.auth.token.role, so we only need
// to mint auth contexts with the right custom claim — no `guests` doc seeding.
const staffCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "admin" });
const guestCtx = (uid = "guest-1") => testEnv.authenticatedContext(uid, { role: "guest" });

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
  // Seed one notification that already carries a readBy entry for OTHER_UID,
  // so removal/forgery of a *foreign* entry is exercised against real data.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "notifications/n1"), {
      type: "booking",
      title: "New booking — SI-1 (Room 1)",
      entityType: "booking",
      entityId: "b1",
      roomNumber: "1",
      bookingRef: "SI-1",
      readBy: { [OTHER_UID]: new Date() },
      createdBy: "system",
      createdAt: new Date(),
    });
  });
});

describe("notifications rules — read/create/delete", () => {
  it("staff can read", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "notifications/n1")));
  });

  it("non-staff (guest role) cannot read", async () => {
    await assertFails(getDoc(doc(guestCtx().firestore(), "notifications/n1")));
  });

  it("unauthenticated cannot read", async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "notifications/n1")));
  });

  it("staff cannot create (Admin-SDK-only)", async () => {
    await assertFails(
      setDoc(doc(staffCtx().firestore(), "notifications/n2"), {
        type: "booking",
        title: "x",
        entityType: "booking",
        entityId: "b2",
        readBy: {},
        createdBy: "system",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("admin cannot delete (retention runs via Admin SDK)", async () => {
    await assertFails(deleteDoc(doc(adminCtx().firestore(), "notifications/n1")));
  });
});

describe("notifications rules — readBy update scope (NC-02 / NC-02b / NC-02c)", () => {
  it("staff can mark their OWN uid read (the core happy path NC-02c broke)", async () => {
    await assertSucceeds(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        [`readBy.${STAFF_UID}`]: serverTimestamp(),
      }),
    );
  });

  it("NC-02b: cannot REMOVE another staff member's readBy entry", async () => {
    // Replacing the whole map with only my uid drops OTHER_UID.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        readBy: { [STAFF_UID]: serverTimestamp() },
      }),
    );
  });

  it("NC-02: cannot ADD a foreign uid (injection)", async () => {
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        [`readBy.someone-else`]: serverTimestamp(),
      }),
    );
  });

  it("NC-02: own readBy value must be a timestamp (no junk-value injection)", async () => {
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        [`readBy.${STAFF_UID}`]: "not-a-timestamp",
      }),
    );
  });

  it("cannot touch any field other than readBy", async () => {
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        title: "tampered",
        [`readBy.${STAFF_UID}`]: serverTimestamp(),
      }),
    );
  });

  it("non-staff cannot update readBy", async () => {
    await assertFails(
      updateDoc(doc(guestCtx().firestore(), "notifications/n1"), {
        [`readBy.guest-1`]: serverTimestamp(),
      }),
    );
  });

  // KNOWN, KNOWINGLY-ACCEPTED RESIDUAL (SEV-4): a staff member can overwrite
  // the *value* of another staff member's existing readBy entry, as long as
  // the key set only grows by their own uid. Firestore rules can't loop over
  // map values to assert each unchanged, so this stays reachable. Encoded as
  // an assertSucceeds so the limitation is documented and any future change
  // in behavior surfaces here. See ROADMAP §Notification Center NC-02b.
  it("KNOWN RESIDUAL: forging another staff member's existing timestamp still succeeds", async () => {
    await assertSucceeds(
      updateDoc(doc(staffCtx().firestore(), "notifications/n1"), {
        readBy: { [OTHER_UID]: serverTimestamp(), [STAFF_UID]: serverTimestamp() },
      }),
    );
  });
});
