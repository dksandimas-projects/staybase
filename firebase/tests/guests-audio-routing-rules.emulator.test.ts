// INTERCOM-AUDIO-ROUTING — emulator-based rules test for the
// `guests/{userId}.audioRouting` self-write allowlist (Finding C,
// audit pass 2026-08-18).
//
// Why this exists: the existing `feature-intercom-audio-routing.test.ts`
// pins the contract with source-text regex (cheap, useful), but a regex
// test that just checks `"audioRouting"` is present in the rules block
// will pass even if the field-allowlist drifts to include `role` —
// which would let a staff member self-promote, exactly the privilege
// escalation the spec calls out. This test loads the real
// `firestore.rules` into the Firestore emulator and exercises the
// actual access decisions so an invalid-but-present rule fails here.
//
// The non-audioRouting cases (e.g. "staff can change their own fullName")
// are covered by the existing `mrb-15-10-room-types-hydration` +
// family of emulator tests; this file only pins the audioRouting
// allowlist itself.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is NOT part
// of the default `npm test`. From the repo root:
//     npm run test:rules
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
import { doc, deleteDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";
const OTHER_UID = "staff-bob";

let testEnv: RulesTestEnvironment;

// `guests/{userId}` rule: `isStaff() || (signedIn() && request.auth.uid == userId)`
// The `isStaff()` branch is admin-only for create/delete; the
// self-update branch is gated on `request.auth.uid == userId`. So we
// only need the right `role` claim (or no claim at all) plus a matching
// auth uid — no `guests` doc seeding for the read/update path.
const staffCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "admin" });
const guestCtx = (uid = "guest-1") => testEnv.authenticatedContext(uid, { role: "guest" });
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
  // Seed the staff doc directly (admin-disabled security rules) so
  // self-update tests have a real document to write against.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "guests", STAFF_UID), {
      uid: STAFF_UID,
      email: "alice@sparkinnbohol.com",
      fullName: "Alice",
      role: "front-desk",
      isActive: true,
    });
    await setDoc(doc(ctx.firestore(), "guests", OTHER_UID), {
      uid: OTHER_UID,
      email: "bob@sparkinnbohol.com",
      fullName: "Bob",
      role: "front-desk",
      isActive: true,
    });
  });
});

const audioRoutingPayload = {
  audioRouting: {
    enabled: true,
    callOutputDeviceId: "device-headset-1",
    ringtoneOutputDeviceId: "device-speakers-1",
    updatedAt: serverTimestamp(),
  },
  audioRoutingUpdatedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

describe("guests/{userId}.audioRouting — self-write allowlist", () => {
  it("staff can write their OWN audioRouting + audioRoutingUpdatedAt + updatedAt (happy path)", async () => {
    await assertSucceeds(
      updateDoc(doc(staffCtx().firestore(), "guests", STAFF_UID), audioRoutingPayload),
    );
  });

  it("admin can write audioRouting on any staff member", async () => {
    await assertSucceeds(
      updateDoc(doc(adminCtx().firestore(), "guests", OTHER_UID), audioRoutingPayload),
    );
  });

  it("cannot write audioRouting on ANOTHER staff member (the request.auth.uid == userId gate)", async () => {
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "guests", OTHER_UID), audioRoutingPayload),
    );
  });

  it("cannot write audioRouting when unauthenticated", async () => {
    await assertFails(
      updateDoc(doc(unauthCtx().firestore(), "guests", STAFF_UID), audioRoutingPayload),
    );
  });

  it("guest (non-staff signed-in user) cannot self-write audioRouting onto a staff doc", async () => {
    await assertFails(
      updateDoc(doc(guestCtx().firestore(), "guests", STAFF_UID), audioRoutingPayload),
    );
  });
});

describe("guests/{userId}.audioRouting — field-allowlist discipline", () => {
  it("CANNOT self-promote role in the same write (the privilege-escalation guard)", async () => {
    // Per plan/docs/SECURITY.md §guests: writing `role` is admin-only.
    // The affectedKeys().hasOnly([...]) gate fires when the staff
    // member tries to sneak `role: "admin"` into the same update.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "guests", STAFF_UID), {
        ...audioRoutingPayload,
        role: "admin",
      }),
    );
  });

  it("CANNOT set isActive in the same write (admin-only flag)", async () => {
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "guests", STAFF_UID), {
        ...audioRoutingPayload,
        isActive: false,
      }),
    );
  });

  it("CANNOT write a non-allowlisted field like phone in the same write as audioRouting", async () => {
    // phone IS in the allowlist — this would actually pass. Use a
    // genuinely out-of-list field instead to prove the gate.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "guests", STAFF_UID), {
        ...audioRoutingPayload,
        email: "attacker@evil.example",
      }),
    );
  });

  it("CANNOT write audioRouting without the companion audioRoutingUpdatedAt audit stamp", async () => {
    // The spec (§D&L 46) requires the audit stamp on every write.
    // The rules allowlist only has audioRouting + audioRoutingUpdatedAt
    // + updatedAt, so writing just one of the pair fails the
    // hasOnly([...]) gate.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "guests", STAFF_UID), {
        audioRouting: audioRoutingPayload.audioRouting,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("guests/{userId}.audioRouting — create/delete lifecycle", () => {
  it("create is admin-only (front-desk cannot self-create a doc with audioRouting)", async () => {
    // Front-desk authed context, writing to a uid that doesn't exist yet.
    await assertFails(
      setDoc(doc(staffCtx("brand-new-uid").firestore(), "guests", "brand-new-uid"), {
        ...audioRoutingPayload,
        email: "new@sparkinnbohol.com",
        fullName: "New Staff",
        role: "front-desk",
      }),
    );
  });

  it("admin can create a staff doc seeded with audioRouting", async () => {
    await assertSucceeds(
      setDoc(doc(adminCtx("new-staff-uid").firestore(), "guests", "new-staff-uid"), {
        ...audioRoutingPayload,
        email: "new@sparkinnbohol.com",
        fullName: "New Staff",
        role: "front-desk",
        isActive: true,
      }),
    );
  });

  it("non-admin cannot delete a staff doc", async () => {
    // Front-desk attempting delete — only admin can.
    await assertFails(deleteDoc(doc(staffCtx().firestore(), "guests", STAFF_UID)));
  });
});