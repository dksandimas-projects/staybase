import { defineConfig } from "vitest/config";

// NC-02d + PMH-03: dedicated config for the emulator-based tests. Two
// categories of file live under `firebase/tests/`:
//
//   1. `*.rules.test.ts` — security-rule evaluation tests
//      (e.g. `notifications.rules.test.ts`). They assert that the
//      `firestore.rules` text allows/denies the right requests.
//   2. `*.emulator.test.ts` — behavioral write-path tests that exercise
//      the real Firestore write semantics against the emulator. They
//      do not import application code (which is a React context that
//      is hard to load in a Node emulator environment); they replicate
//      the write pattern and assert the contract. First such file:
//      `room-types-array-write.emulator.test.ts` (PMH-03, pins the
//      RTS-01 fix at the Firestore layer).
//
// Both categories require the Firestore emulator (Java) and run via
// `npm run test:rules` (firebase emulators:exec) or as part of the
// default `npm test`. They are NOT part of `npm run test:fast` —
// the fast path skips the emulator for sub-30s feedback.
export default defineConfig({
  test: {
    include: [
      "firebase/tests/**/*.rules.test.ts",
      "firebase/tests/**/*.emulator.test.ts",
    ],
    // Per PR-AUDIT (2026-10-20): the emulator test files MUST run
    // SERIALLY. Every file boots the SAME Firestore emulator on the
    // SAME port and uses the SAME `projectId`
    // ("spark-inn-rules-test"), and most of them call
    // `testEnv.clearFirestore()` in a `beforeEach` to seed their own
    // fixture. With the default parallel file execution, one file's
    // `clearFirestore()` wipes another file's seed mid-test, which
    // surfaces as an unrelated-looking failure ("Cannot read
    // properties of undefined") in a test that passes perfectly well
    // on its own.
    //
    // This was invisible for as long as the emulator could not be
    // started (no Java runtime on the dev machine), so `npm run
    // test:rules` had never actually been run here. It surfaced the
    // moment a JVM became available: 9 failures, all of them
    // cross-file interference, and all of them green when the file
    // was run alone.
    fileParallelism: false,
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
