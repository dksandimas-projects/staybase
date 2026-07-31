// PMH-03 (2026-07-31): behavioral test that pins the array-field merge-write
// hazard on the real Firestore emulator, demonstrating the bug class that
// RTS-01 fixed.
//
// Background
// ----------
// The rates matrix save (RTS-01) used to fire N concurrent `updateRoomType`
// calls; each one read the same render-time `roomTypes` snapshot and wrote
// the WHOLE array back via `setDoc(..., { merge: true })`. Merge of an
// array field replaces the field wholesale, so the last write to land won
// and every other type's edit was silently dropped.
//
// The 938 source-text admin tests caught none of this. They asserted that
// strings like `Promise.all` and `updateRoomType` appeared together; none
// of them exercised a real Firestore write, so the "wrong answer, no error,
// no test failure" class of bug slipped through.
//
// This test does NOT import AdminContext (which is a React context — hard
// to load in a Node emulator environment). Instead, it replicates the same
// write semantics directly against the emulator and asserts the hazard +
// the fix:
//
//   1. Seed hotelConfig.roomTypes with three types at base prices 1000 /
//      2000 / 3000.
//   2. Simulate the OLD broken pattern: N concurrent setDoc calls, each
//      computing "the original array with one type changed" from the same
//      snapshot. After all writes resolve, assert that only ONE type's
//      change persisted and the other two reverted to their original
//      prices. This is the bug.
//   3. Simulate the NEW fixed pattern: a single setDoc with the fully-
//      computed next array. After it resolves, assert that ALL three
//      types' changes persisted. This is the fix.
//
// Future behavioral tests should follow this template: seed via the
// emulator, exercise the write pattern, assert the contract. The
// `firestore.rules` is loaded automatically by `initializeTestEnvironment`,
// so any rule change that breaks a write will surface here too.
//
// HOW TO RUN — requires the Firestore emulator (Java). Not part of
// `npm run test:fast`. From the repo root:
//     npm run test:rules
// or as part of the full suite:
//     npm test
// See `plan/docs/CONTRIBUTING.md §Testing` for the test-layer overview.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";

let testEnv: RulesTestEnvironment;

// Admin-SDK-style context for seeding. Tests below use the same path
// (settings/hotelConfig) that the real AdminContext writes to.
const adminCtx = () =>
  testEnv.authenticatedContext("admin-seeder", { role: "admin" });

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
  // Seed three room types via the admin context, so the test never
  // depends on the "loaded and legitimately empty" branch.
  const fs = adminCtx().firestore();
  await setDoc(doc(fs, "settings/hotelConfig"), {
    roomTypes: [
      { value: "single", label: "Single", pricePerNight: 1000 },
      { value: "twin", label: "Twin", pricePerNight: 2000 },
      { value: "family", label: "Family", pricePerNight: 3000 },
    ],
    updatedAt: new Date(),
  });
});

const readRoomTypes = async (): Promise<Array<{ value: string; pricePerNight: number }>> => {
  const snap = await getDoc(doc(adminCtx().firestore(), "settings/hotelConfig"));
  const data = snap.data() as { roomTypes: Array<{ value: string; pricePerNight: number }> };
  return data.roomTypes;
};

describe("RTS-01 array-field merge hazard — N concurrent setDoc calls", () => {
  // The broken shape. Each concurrent writer reads the SAME original
  // array (because the JS closure captures the same snapshot) and
  // computes "the original array with one type changed". They all
  // `setDoc(..., { merge: true })` on the shared `roomTypes[]` field,
  // and merge of an array field replaces the field wholesale. The last
  // write to land wins; every other type's edit is silently dropped.
  it("N concurrent single-type writes lose all but the last write's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readRoomTypes();
    expect(before.map((t) => t.pricePerNight)).toEqual([1000, 2000, 3000]);

    // Three concurrent writers, each changing one type. The "snapshot"
    // they all see is the same `before` array.
    await Promise.all([
      setDoc(doc(fs, "settings/hotelConfig"), {
        roomTypes: before.map((t) =>
          t.value === "single" ? { ...t, pricePerNight: 1100 } : t
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        roomTypes: before.map((t) =>
          t.value === "twin" ? { ...t, pricePerNight: 2200 } : t
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        roomTypes: before.map((t) =>
          t.value === "family" ? { ...t, pricePerNight: 3300 } : t
        ),
      }, { merge: true }),
    ]);

    const after = await readRoomTypes();
    const byValue = Object.fromEntries(after.map((t) => [t.value, t.pricePerNight]));
    // Exactly ONE type's change survives. Which one depends on which
    // write lands last, so we don't pin the specific survivor — we
    // pin the count: the other two revert to the original prices.
    const changedTypes = after.filter((t, i) => t.pricePerNight !== before[i].pricePerNight);
    expect(changedTypes).toHaveLength(1);
    // The other two are unchanged.
    const unchangedCount = after.filter((t, i) => t.pricePerNight === before[i].pricePerNight).length;
    expect(unchangedCount).toBe(2);
    // Sanity: the changed value matches one of the new values we tried
    // to write.
    expect([1100, 2200, 3300]).toContain(byValue[changedTypes[0].value]);
  });
});

describe("RTS-01 fix — single batched setDoc call", () => {
  // The fixed shape. Compute the full next array ONCE from a single
  // snapshot and write it ONCE. No race; every type's change persists.
  it("a single setDoc with the fully-computed next array persists every type's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readRoomTypes();
    expect(before.map((t) => t.pricePerNight)).toEqual([1000, 2000, 3000]);

    // Compute the full next array ONCE.
    const next = before.map((t) => {
      if (t.value === "single") return { ...t, pricePerNight: 1100 };
      if (t.value === "twin") return { ...t, pricePerNight: 2200 };
      if (t.value === "family") return { ...t, pricePerNight: 3300 };
      return t;
    });

    // Write it ONCE.
    await setDoc(doc(fs, "settings/hotelConfig"), { roomTypes: next }, { merge: true });

    const after = await readRoomTypes();
    expect(after.map((t) => t.pricePerNight)).toEqual([1100, 2200, 3300]);
  });
});
