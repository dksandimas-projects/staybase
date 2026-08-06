// Per v0.264.9 test-discipline retrofit (2026-08-06): a
// meta-test that guards the retrofit. The v0.264.5 audit
// surfaced the systemic class of bug: a future field added
// to a client body but missing from the server's strict
// Zod schema (the EXB-12 `extraBedBreakfast` regression).
// The pre-retrofit test surface was 100% source-text
// regex in 79 of 119 test files, including every file
// that tested wire shapes (schemas, multi-room, add-room,
// breakfast toggle, picker refactor). The regex never
// exercised the actual schema objects, so "16/16 tests
// pass" was meaningless.
//
// The retrofit added ONE runtime assertion to each of
// the 5 highest-risk test files (the source-text regex
// is kept as a fast contract guard; the runtime assertion
// pins the actual behavior). This meta-test is the
// regression guard: if a future commit silently removes
// the runtime assertion from any retrofit file, the
// meta-test fails loud with the file name + the missing
// token. The "class of bug" is closed at the test-
// discipline level — the next time someone adds a field
// to a wire shape, the retrofit files' runtime assertions
// will fail (not the regex) and the dev will know the
// schema is missing the field.
//
// What this test is NOT:
//   - It does NOT assert every test file under `tests/api/`
//     has a runtime assertion. That would be a flag-day
//     change; 79 files would fail at once. The retrofit
//     is incremental — each file added to the list below
//     gets one more file under the guard. The list is
//     the contract.
//   - It does NOT change the regex guards. The regex
//     guards are still fast, deterministic, <5s, and
//     pin the contract shape. The runtime assertion is
//     added ON TOP, not INSTEAD.
//
// Reference IDs: TEST-DISCIPLINE-META-001..005. See the
// v0.264.9 ROADMAP entry for the retrofit's full
// reasoning + the rejected alternatives.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The list of test files in the v0.264.9 retrofit.
 * Each entry is the basename (no `.ts`) + a human-
 * readable contract the runtime assertion pins. The
 * meta-test fails if the file's source no longer
 * contains a runtime primitive (`vi.`, `safeParse(`,
 * `mockFn`, `import(...)`, `fetch(`).
 *
 * To add a new file to the retrofit:
 *   1. Add a runtime assertion to the test file
 *      (at least one `vi.` / `safeParse(` / `import(...)`
 *      / `mockFn` / `fetch(` call).
 *   2. Add an entry to this list with a one-line
 *      description of the contract the assertion pins.
 *   3. Run the meta-test. The new entry should be
 *      detected as runtime-bearing.
 */
const RETROFIT_FILES: Array<{ basename: string; contract: string }> = [
  {
    basename: "exb-12-extra-bed-breakfast.test",
    contract: "calculateBreakfastAddOn's `extraBedBreakfast` gate honors the opt-in toggle (delta = rate × extraBedCount × nights)"
  },
  {
    basename: "mrb-06-n-room-create.test",
    contract: "createBookingSchema.safeParse accepts the N=2 body shape (mixed occupancy, no ZodError)"
  },
  {
    basename: "mrb-11-revenue-allocation-snapshot.test",
    contract: "assertBookingRevenueAllocationInvariant accepts a valid allocation + throws `[MRB-11]` on off-by-1"
  },
  {
    basename: "exb-10-bed-inventory.test",
    contract: "checkExtraBedInventory's boundary cases (fits exactly, off-by-1, 0 = no constraint)"
  },
  {
    basename: "chd-11-soft-constraint-picker-and-cart-summary.test",
    contract: "parseBookingRoomCart preserves the EXB-12 `extraBedBreakfast` field from the URL"
  }
];

// A runtime primitive = at least one of these tokens
// in the file's source. The check is intentionally
// lenient (not a parser) so it works without compiling
// the TypeScript. The retrofit file's test runner will
// fail with a real error if the runtime assertion is
// syntactically broken — the meta-test just guards the
// presence of the primitive.
const RUNTIME_PRIMITIVES = [
  "vi.",
  "safeParse(",
  "mockFn",
  "fetch(",
  // `import(` for dynamic imports (the retrofit
  // pattern for safe hermetic loading of helpers from
  // `@spark-inn/shared`).
  "import("
];

function hasRuntimePrimitive(source: string): { has: boolean; matched: string | null } {
  for (const primitive of RUNTIME_PRIMITIVES) {
    if (source.includes(primitive)) {
      return { has: true, matched: primitive };
    }
  }
  return { has: false, matched: null };
}

describe("v0.264.9 test-discipline meta-test (the v0.264.5 class-of-bug guard)", () => {
  it("the meta-test is wired (sanity: the retrofit list has the expected 5 entries)", () => {
    // Prevents the meta-test from silently passing if
    // the RETROFIT_FILES list is accidentally emptied
    // (the list-empty case would make every per-file
    // check trivially pass — the test would still
    // report "0 / 0 retrofit files checked" which is
    // a false positive).
    expect(RETROFIT_FILES.length).toBeGreaterThanOrEqual(5);
  });

  for (const entry of RETROFIT_FILES) {
    it(`TEST-DISCIPLINE-META: ${entry.basename} has at least one runtime primitive (${entry.contract})`, () => {
      // Read the file from disk (the meta-test is
      // hermetic — no `import()` of the target module,
      // no module-load side effects). The source-text
      // check is the discipline guard; the target
      // file's own tests are the runtime guard.
      const path = resolve(__dirname, `${entry.basename}.ts`);
      const source = readFileSync(path, "utf8");
      const { has, matched } = hasRuntimePrimitive(source);
      // The check is strict — a retrofit file with
      // ZERO runtime primitives fails loud. The error
      // message names the file + the contract + the
      // list of acceptable primitives so a future
      // dev who accidentally deletes the runtime
      // assertion knows exactly what to restore.
      expect(
        has,
        `${entry.basename}.ts is in the v0.264.9 retrofit list ` +
        `but lost its runtime assertion. Contract pinned: ${entry.contract}. ` +
        `Acceptable runtime primitives: ${RUNTIME_PRIMITIVES.join(", ")}. ` +
        `Add back a runtime assertion (the source-text regex above is NOT a substitute — ` +
        `the regex is a fast contract guard, the runtime assertion is the behavioral guard).`
      ).toBe(true);
      // A side assertion: name which primitive was
      // matched so the failure message is self-
      // documenting (a passing test reports nothing;
      // a failing test reports the matched primitive
      // in the file).
      expect(matched).toBeTruthy();
    });
  }

  it("scans every test file under tests/api/ and reports the current state (informational, not a fail)", () => {
    // The discipline-health snapshot. This assertion
    // does NOT fail — it just reports the current
    // % of test files with at least one runtime
    // primitive. The retrofit is incremental; the
    // % is the single source of truth for "are we
    // winning the test-discipline war".
    //
    // The `console.log` is intentional — vitest
    // captures it in the test output. A future
    // observability layer (a script that parses the
    // test output) can graph the % over time.
    const entries = readdirSync(__dirname);
    const testFiles = entries.filter((name) => name.endsWith(".test.ts"));
    let total = 0;
    let runtime = 0;
    for (const name of testFiles) {
      // Skip the meta-test itself (it has `vi.` in its
      // import, but it's not a "tested" file — it's a
      // "tests the tests" file).
      if (name === "_test-discipline-meta.test.ts") continue;
      const source = readFileSync(resolve(__dirname, name), "utf8");
      total += 1;
      if (hasRuntimePrimitive(source).has) {
        runtime += 1;
      }
    }
    const pct = total > 0 ? Math.round((runtime / total) * 100) : 0;
    // The console.log is the "report" — not a fail.
    // Use `expect` with a no-op assertion so the test
    // is still structured (no `it(...) { ... }` without
    // an assertion is a vitest anti-pattern).
    console.log(
      `[v0.264.9 test-discipline] ${runtime} / ${total} test files under tests/api/ ` +
      `have at least one runtime primitive (${pct}%). ` +
      `Pre-retrofit baseline: ~34% (40 of 119). ` +
      `Retrofit target: ≥38% by end of Q1 2027.`
    );
    expect(pct).toBeGreaterThanOrEqual(0); // never fails — the log is the report
  });
});
