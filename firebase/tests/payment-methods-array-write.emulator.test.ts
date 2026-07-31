// PMH-05 (generalization of PMH-03 + WPM-04) behavioral test: pins the
// array-field merge hazard for the `paymentMethods[]` field on
// `settings/hotelConfig`, the same shape as
// `room-types-array-write.emulator.test.ts`.
//
// Background
// ----------
// WPM-01 (2026-07-31) replaced the walk-in modal's three literal
// payment options with a map over `settings/hotelConfig.paymentMethods[]`.
// That change turned a single-source (the hardcoded JSX) into a
// dynamic list driven by a Firestore array field. The same merge-write
// hazard RTS-01 documented applies: N concurrent per-method writers
// each reading the same snapshot and writing the whole array back
// would lose all but the last write's change.
//
// This test demonstrates the hazard and the fix on `paymentMethods[]`
// specifically, so a future code change that introduces the same
// fan-out pattern on this field fails here.
//
// Pattern is the same as PMH-03's `room-types-array-write` test:
// seed via the admin context, exercise the write pattern, assert the
// contract. See `plan/docs/CONTRIBUTING.md §Testing` for the test-layer
// overview and the `*.emulator.test.ts` convention.
//
// HOW TO RUN — requires the Firestore emulator (Java). Not part of
// `npm run test:fast`. From the repo root:
//     npm run test:rules
// or as part of the full suite:
//     npm test

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
  // Seed three payment methods that mirror the default AdminContext
  // state (gcash / bank / pay-at-hotel), so the test never depends on
  // the backfill running first.
  const fs = adminCtx().firestore();
  await setDoc(doc(fs, "settings/hotelConfig"), {
    paymentMethods: [
      { method: "gcash", label: "GCash", isEnabled: true, showInStore: true, showInCorporate: true },
      { method: "bank", label: "Bank Transfer", isEnabled: true, showInStore: true, showInCorporate: true },
      { method: "pay-at-hotel", label: "Pay at Hotel", isEnabled: true, showInStore: false, showInCorporate: false }
    ],
    updatedAt: new Date(),
  });
});

const readPaymentMethods = async (): Promise<Array<{ method: string; isEnabled: boolean }>> => {
  const snap = await getDoc(doc(adminCtx().firestore(), "settings/hotelConfig"));
  const data = snap.data() as { paymentMethods: Array<{ method: string; isEnabled: boolean }> };
  return data.paymentMethods;
};

describe("WPM-04 array-field merge hazard — N concurrent setDoc calls on paymentMethods[]", () => {
  it("N concurrent per-method writes lose all but the last write's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readPaymentMethods();
    expect(before.map((m) => m.method)).toEqual(["gcash", "bank", "pay-at-hotel"]);

    // Three concurrent writers, each toggling `isEnabled` on one method.
    // The "snapshot" they all see is the same `before` array (because
    // the JS closure captures it before the await fires).
    await Promise.all([
      setDoc(doc(fs, "settings/hotelConfig"), {
        paymentMethods: before.map((m) =>
          m.method === "gcash" ? { ...m, isEnabled: false } : m
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        paymentMethods: before.map((m) =>
          m.method === "bank" ? { ...m, isEnabled: false } : m
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        paymentMethods: before.map((m) =>
          m.method === "pay-at-hotel" ? { ...m, isEnabled: false } : m
        ),
      }, { merge: true }),
    ]);

    const after = await readPaymentMethods();
    // Exactly ONE method's change survives. Which one depends on
    // which write lands last, so we don't pin the specific survivor.
    const changedMethods = after.filter((m, i) => m.isEnabled !== before[i].isEnabled);
    expect(changedMethods).toHaveLength(1);
    // The other two are unchanged.
    const unchangedCount = after.filter((m, i) => m.isEnabled === before[i].isEnabled).length;
    expect(unchangedCount).toBe(2);
  });
});

describe("WPM-04 fix — single batched setDoc on paymentMethods[]", () => {
  it("a single setDoc with the fully-computed next array persists every method's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readPaymentMethods();
    expect(before.map((m) => m.method)).toEqual(["gcash", "bank", "pay-at-hotel"]);

    // Compute the full next array ONCE.
    const next = before.map((m) => {
      if (m.method === "gcash") return { ...m, isEnabled: false };
      if (m.method === "bank") return { ...m, isEnabled: false };
      if (m.method === "pay-at-hotel") return { ...m, isEnabled: false };
      return m;
    });

    // Write it ONCE.
    await setDoc(doc(fs, "settings/hotelConfig"), { paymentMethods: next }, { merge: true });

    const after = await readPaymentMethods();
    expect(after.map((m) => m.isEnabled)).toEqual([false, false, false]);
  });
});
