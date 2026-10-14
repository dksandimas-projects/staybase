import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeBreakfastCutoffState } from "../utils/breakfastCutoff";
import { normalizeBreakfastConfig } from "../utils/breakfastConfig";
import { BreakfastConfigSchema } from "../schemas/booking";

// Per BR-10 (Phase 14 — Cut-off toggle + Skip add-ons,
// decision #244 reserved, 2026-10-14): the
// `cutoffsEnabled` admin toggle bypasses the lock.
// These tripwires pin:
//   1. `BreakfastConfigSchema` requires `cutoffsEnabled`
//      (the writer must always be explicit, no Zod default).
//   2. `normalizeBreakfastConfig` defaults the field to
//      `true` for legacy / missing values (so existing
//      docs hydrate without changing behaviour).
//   3. `computeBreakfastCutoffState` short-circuits to
//      `isLocked: false` + `reasonOrCutoff:
//      "cutoffs-disabled"` when the flag is `false`,
//      regardless of date / time.
//   4. Every known caller of the helper threads the flag
//      through (no caller reads `breakfastConfig.cutoffsEnabled`
//      and ignores the helper's lock math — the helper is
//      the single source of truth).
//
// The "now" timestamps are pinned to fixed instants so
// the timezone math is stable (Asia/Manila is UTC+8 with
// no DST).

const MANILA_TZ = "Asia/Manila";
const DEFAULT_CUTOFF = "20:00";

describe("BR-10 — BreakfastConfigSchema requires cutoffsEnabled", () => {
  it("rejects a config that omits cutoffsEnabled", () => {
    // Per BR-10: `cutoffsEnabled` is required (no Zod
    // default — the writer must always be explicit).
    // The legacy fallback lives in
    // `normalizeBreakfastConfig`, not the schema,
    // because the writer should never silently lose
    // the field.
    const parsed = BreakfastConfigSchema.safeParse({
      isEnabled: true,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      frontDeskOverrideEnabled: true,
      servedGraceMinutes: 15,
      defaultMealInstructions: "",
      meals: []
    });
    expect(parsed.success).toBe(false);
    // Zod surfaces the missing field as a `cutoffsEnabled`
    // path on the issues array. We assert on the field name
    // rather than the literal issue text so this stays
    // robust against minor message tweaks in Zod versions.
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("cutoffsEnabled");
    }
  });

  it("accepts a config that explicitly sets cutoffsEnabled", () => {
    const parsed = BreakfastConfigSchema.safeParse({
      isEnabled: true,
      cutoffsEnabled: true,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      frontDeskOverrideEnabled: false,
      servedGraceMinutes: 15,
      defaultMealInstructions: "",
      meals: []
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts cutoffsEnabled === false (the admin-side bypass)", () => {
    const parsed = BreakfastConfigSchema.safeParse({
      isEnabled: true,
      cutoffsEnabled: false,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      frontDeskOverrideEnabled: true,
      servedGraceMinutes: 15,
      defaultMealInstructions: "",
      meals: []
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cutoffsEnabled).toBe(false);
    }
  });
});

describe("BR-10 — normalizeBreakfastConfig defaults cutoffsEnabled to true", () => {
  it("defaults cutoffsEnabled = true for a legacy doc that omits the field", () => {
    // A pre-BR-10 settings doc from Firestore: no
    // `cutoffsEnabled` field at all. The reader
    // normalises the missing field to `true` so the
    // pre-BR-10 locked behaviour is preserved.
    const legacyRaw = {
      isEnabled: true,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      frontDeskOverrideEnabled: false,
      servedGraceMinutes: 15,
      defaultMealInstructions: "",
      meals: []
    };
    const normalised = normalizeBreakfastConfig(legacyRaw as never);
    expect(normalised.cutoffsEnabled).toBe(true);
  });

  it("defaults cutoffsEnabled = true when the field is explicitly `undefined`", () => {
    const explicitUndefinedRaw = {
      isEnabled: false,
      cutoffsEnabled: undefined,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      defaultMealInstructions: "",
      meals: []
    };
    const normalised = normalizeBreakfastConfig(explicitUndefinedRaw as never);
    expect(normalised.cutoffsEnabled).toBe(true);
  });

  it("preserves cutoffsEnabled = false when the field is present", () => {
    const raw = {
      isEnabled: true,
      cutoffsEnabled: false,
      cutoffTime: "20:00",
      cutoffTimezone: "Asia/Manila",
      defaultMealInstructions: "",
      meals: []
    };
    const normalised = normalizeBreakfastConfig(raw as never);
    expect(normalised.cutoffsEnabled).toBe(false);
  });
});

describe("BR-10 — computeBreakfastCutoffState short-circuits when cutoffsEnabled === false", () => {
  it("returns isLocked: false for a date where the cutoff is in the FUTURE", () => {
    // Service date = 2026-10-14 → cutoff = 2026-10-13 20:00
    // Manila = 2026-10-13 12:00 UTC. "now" = 2026-10-13
    // 06:00 UTC (cutoff is 6h away — without the toggle
    // this would already be isLocked: false because the
    // cutoff is in the future).
    //
    // The BR-10 tripwire here is that the toggle ALSO
    // short-circuits when the cutoff is in the past — we
    // pin both arms below.
    const now = new Date("2026-10-13T06:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ,
      cutoffsEnabled: false
    });
    expect(state.isLocked).toBe(false);
    expect(state.reasonOrCutoff).toBe("cutoffs-disabled");
    // The cutoff moment is still populated so the UI can
    // render the "Cut-offs disabled — order any time" hint.
    expect(state.cutoffAt).toBe("2026-10-13T12:00:00.000Z");
    expect(state.serviceDate).toBe("2026-10-14");
  });

  it("returns isLocked: false for a date where the cutoff is already in the PAST", () => {
    // The BR-10 invariant in plain English: even if the
    // user tries to add a meal at 21:00 Manila on the
    // cutoff day, with the toggle off the gate is open.
    // Service date = 2026-10-14, now = 2026-10-13 14:00
    // UTC (22:00 Manila, well past the 20:00 cutoff).
    const now = new Date("2026-10-13T14:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ,
      cutoffsEnabled: false
    });
    expect(state.isLocked).toBe(false);
    expect(state.reasonOrCutoff).toBe("cutoffs-disabled");
    // cutoffAt is still computed (the rule always runs)
    // so any "would-be cutoff" UI hint can render.
    expect(state.cutoffAt).toBe("2026-10-13T12:00:00.000Z");
  });

  it("preserves the locked behaviour when cutoffsEnabled is omitted (back-compat default true)", () => {
    // Pre-BR-10 callers omit the field — the helper
    // must keep locking the past-cutoff date so a
    // missing flag is conservative, never permissive.
    const now = new Date("2026-10-13T14:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
      // cutoffsEnabled intentionally omitted.
    });
    expect(state.isLocked).toBe(true);
    expect(state.reasonOrCutoff).toBeUndefined();
  });

  it("locks normally when cutoffsEnabled === true (explicit on)", () => {
    // Sanity-check that the explicit-on path is
    // indistinguishable from the omitted path: the
    // toggle only changes behaviour when it is `false`.
    const now = new Date("2026-10-13T14:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ,
      cutoffsEnabled: true
    });
    expect(state.isLocked).toBe(true);
    expect(state.reasonOrCutoff).toBeUndefined();
  });
});

describe("BR-10 — every caller of computeBreakfastCutoffState threads cutoffsEnabled", () => {
  // Per BR-10 (decision #244 reserved, 2026-10-14):
  // the helper is the SINGLE source of the lock. No
  // caller is allowed to read `breakfastConfig.cutoffsEnabled`
  // and decide `isLocked` outside the helper (a
  // side-channel bypass would defeat the toggle).
  // These tripwires scan the source files for the
  // known caller sites and confirm they all forward
  // the flag.

  type CallerProbe = {
    /** Repo-relative path from the worktree root. */
    path: string;
    /** A snippet unique to that call site's `computeBreakfastCutoffState({...}` invocation. The test asserts the file contains both this snippet and `cutoffsEnabled`. */
    signature: string;
  };

  const callers: CallerProbe[] = [
    {
      path: "guest-app/src/pages/BookingPage.tsx",
      signature: "cutoffTime: breakfastConfig.cutoffTime || \"20:00\""
    },
    {
      path: "guest-app/src/pages/ManageBreakfastPage.tsx",
      signature: "cutoffTime: hhmm,"
    },
    {
      path: "admin-app/src/components/BookingDrawerWorkspace.tsx",
      signature: "cutoffTime,\n        timezone: tz,"
    },
    {
      path: "admin-app/src/components/breakfast/WalkinBreakfastGrid.tsx",
      signature: "cutoffTime,\n        timezone: tz,"
    },
    {
      // The kitchen-list handler's internal
      // `computeBreakfastCutoffStateSafe` is the
      // canonical server-side call site — its
      // underlying `computeBreakfastCutoffState({...`
      // must forward the flag too.
      path: "guest-app/server/handlers/breakfast-kitchen-list.ts",
      signature: "cutoffTime: DEFAULT_BREAKFAST_CUTOFF_TIME,\n      timezone: DEFAULT_BREAKFAST_CUTOFF_TIMEZONE,\n      cutoffsEnabled"
    },
    {
      path: "guest-app/server/handlers/breakfast-mark-served.ts",
      signature: "cutoffTime,\n      timezone: cutoffTimezone,\n      cutoffsEnabled"
    },
    {
      path: "guest-app/server/handlers/breakfast-manage.ts",
      signature: "cutoffTime,\n      timezone: cutoffTz,\n      cutoffsEnabled"
    },
    {
      // The shared lib's `assertNotLocked` wrapper is
      // the single gateway used by both the
      // guest-facing manage handler and the staff
      // update handler. Pinning the lib here ensures
      // any future reader of `assertNotLocked` sees the
      // flag in the helper's `computeBreakfastCutoffState`
      // call too. Both call sites (assertNotLocked +
      // the entry-by-entry helper used at write time)
      // are anchored to the same shared surface.
      path: "guest-app/server/lib/breakfast-selections.ts",
      signature: "timezone,\n    cutoffsEnabled\n  });"
    }
  ];

  for (const caller of callers) {
    it(`threads cutoffsEnabled in ${caller.path}`, () => {
      // Resolve relative to the worktree root. The
      // shared package's vitest root is the `shared/`
      // dir, so `..` lands in the repo root for these
      // off-tree callers.
      const repoRoot = resolve(__dirname, "../../");
      const fullPath = resolve(repoRoot, caller.path);
      const src = readFileSync(fullPath, "utf8");
      // Defensive: if the unique signature isn't
      // present, the caller was refactored away — fail
      // loud so the test list mirrors reality.
      expect(src, `signature not found in ${caller.path}: ${caller.signature}`).toContain(caller.signature);
      // The BR-10 invariant: the same caller file
      // also references `cutoffsEnabled` somewhere
      // — either as an object-literal key
      // (`cutoffsEnabled,\n` — the form the
      // helpers use), as an explicit property
      // (`cutoffsEnabled:`), as a default-parameter
      // assignment (`cutoffsEnabled = ...`), or in
      // a `const cutoffsEnabled =` capture near the
      // helper call. The simple presence check pins
      // the threading without coupling to whatever
      // punctuation the next refactor chooses.
      expect(src, `cutoffsEnabled not forwarded in ${caller.path}`).toMatch(/cutoffsEnabled/);
    });
  }

  it("no caller hard-codes `isLocked` outside the helper itself", () => {
    // BR-10 invariant: the only place that decides
    // `isLocked` is `computeBreakfastCutoffState` (the
    // shared helper). A side-channel like
    // `const isLocked = now.getTime() >= cutoffMs.getTime()`
    // in a caller would bypass the toggle and silently
    // regress the bypass. Scan every caller file for
    // the forbidden pattern.
    const repoRoot = resolve(__dirname, "../../");
    const callFiles = callers.map((c) => resolve(repoRoot, c.path));
    for (const f of callFiles) {
      const src = readFileSync(f, "utf8");
      // The forbidden pattern is a local
      // `let isLocked = ...` or
      // `const isLocked = ...now(...) >= ...cutoff...`
      // assignment. Routed reads via
      // `cutoff.isLocked` / `Boolean(c.isLocked)` are
      // allowed (those flow through the helper). We
      // detect a direct assignment by requiring the
      // RHS to mention both `now` (the wall-clock
      // ref) and `cutoff` (the cutoff-time ref) — a
      // routed read does not match because the RHS
      // is just `c.isLocked` or `cutoff.isLocked`.
      expect(src, `${f} appears to set isLocked outside the helper`).not.toMatch(/isLocked\s*=[^=].*\bnow\b.*\bcutoff\b/is);
    }
  });
});
