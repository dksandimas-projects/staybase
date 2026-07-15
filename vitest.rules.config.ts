import { defineConfig } from "vitest/config";

// NC-02d: dedicated config for the emulator-based Firestore rules tests.
// Kept separate from the apps' unit tests because these require the Firestore
// emulator (Java) and run via `npm run test:rules` (firebase emulators:exec),
// NOT as part of the default `npm test`.
export default defineConfig({
  test: {
    include: ["firebase/tests/**/*.rules.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
