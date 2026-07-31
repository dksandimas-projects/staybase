// PMH-05 (generalization #3, NBS-08) behavioral test: pins the
// array-field merge hazard for `bookingSources[]` on
// `settings/hotelConfig`. Same shape as the PMH-03 roomTypes and
// WPM-04 paymentMethods tests.
//
// Background
// ----------
// NBS-08 (2026-07-31) — the Reports acquisition chart used to
// hardcode `const sources = ["online", "walk-in", "corporate", "phone",
// "facebook"]` and then count with `if (counts[b.source] !==
// undefined) counts[b.source] += 1`. Any source not in that array was
// silently dropped — the chart and the totals disagreed, the hotel
// discovered the discrepancy months later when they questioned the
// numbers. Adding a new source required editing ReportsPage.tsx in
// lockstep, or the new source was invisible.
//
// The fix: derive the slice list from `settings/hotelConfig.bookingSources[]`
// at runtime, surface an "Unconfigured: <raw-key>" slice for any
// orphan, and (in a separate concern) persist the list via a
// single-batched write — same PMH-03 lesson, applied to a third
// array field. This test pins the array-write hazard on the same
// field so a future code change that introduces the fan-out
// pattern fails here, just like the roomTypes and paymentMethods
// tests catch theirs.
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
  // Seed three booking sources that mirror the default
  // AdminContext state (the three selectable-at-front-desk ones —
  // the chart-relevant slice), so the test never depends on the
  // backfill running first.
  const fs = adminCtx().firestore();
  await setDoc(doc(fs, "settings/hotelConfig"), {
    bookingSources: [
      { source: "walk-in", label: "Walk-in Desk", isEnabled: true, selectableAtFrontDesk: false },
      { source: "phone", label: "Phone Call", isEnabled: true, selectableAtFrontDesk: true },
      { source: "agoda", label: "Agoda (OTA)", isEnabled: true, selectableAtFrontDesk: true }
    ],
    updatedAt: new Date(),
  });
});

const readBookingSources = async (): Promise<Array<{ source: string; isEnabled: boolean }>> => {
  const snap = await getDoc(doc(adminCtx().firestore(), "settings/hotelConfig"));
  const data = snap.data() as { bookingSources: Array<{ source: string; isEnabled: boolean }> };
  return data.bookingSources;
};

describe("NBS-08 array-field merge hazard — N concurrent setDoc calls on bookingSources[]", () => {
  it("N concurrent per-source writes lose all but the last write's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readBookingSources();
    expect(before.map((s) => s.source)).toEqual(["walk-in", "phone", "agoda"]);

    // Three concurrent writers, each toggling `isEnabled` on one
    // source. The "snapshot" they all see is the same `before` array
    // (because the JS closure captures it before the await fires).
    await Promise.all([
      setDoc(doc(fs, "settings/hotelConfig"), {
        bookingSources: before.map((s) =>
          s.source === "walk-in" ? { ...s, isEnabled: false } : s
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        bookingSources: before.map((s) =>
          s.source === "phone" ? { ...s, isEnabled: false } : s
        ),
      }, { merge: true }),
      setDoc(doc(fs, "settings/hotelConfig"), {
        bookingSources: before.map((s) =>
          s.source === "agoda" ? { ...s, isEnabled: false } : s
        ),
      }, { merge: true }),
    ]);

    const after = await readBookingSources();
    // Exactly ONE source's change survives. Which one depends on
    // which write lands last, so we don't pin the specific survivor.
    const changedSources = after.filter((s, i) => s.isEnabled !== before[i].isEnabled);
    expect(changedSources).toHaveLength(1);
    // The other two are unchanged.
    const unchangedCount = after.filter((s, i) => s.isEnabled === before[i].isEnabled).length;
    expect(unchangedCount).toBe(2);
  });
});

describe("NBS-08 fix — single batched setDoc on bookingSources[]", () => {
  it("a single setDoc with the fully-computed next array persists every source's change", async () => {
    const fs = adminCtx().firestore();
    const before = await readBookingSources();
    expect(before.map((s) => s.source)).toEqual(["walk-in", "phone", "agoda"]);

    // Compute the full next array ONCE.
    const next = before.map((s) => {
      if (s.source === "walk-in") return { ...s, isEnabled: false };
      if (s.source === "phone") return { ...s, isEnabled: false };
      if (s.source === "agoda") return { ...s, isEnabled: false };
      return s;
    });

    // Write it ONCE.
    await setDoc(doc(fs, "settings/hotelConfig"), { bookingSources: next }, { merge: true });

    const after = await readBookingSources();
    expect(after.map((s) => s.isEnabled)).toEqual([false, false, false]);
  });
});
