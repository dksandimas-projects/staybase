// Per BR-08 (Phase 13 — Breakfast Redesign, decision #238,
// 2026-10-14 — close-out): tripwire test for the BR-08
// "Late served — please rate" email extension.
//
// Per CNE-01 (2026-11-19): that guest email is REMOVED. The
// client asked to cut the guest's service-solicitation
// notifications — a late-served breakfast is an OPERATIONAL
// fact, and the guest is standing at the breakfast table when
// it happens.
//
// So this tripwire INVERTED. It now pins:
//   1. the trigger + the template are GONE (so nothing can
//      re-introduce the email);
//   2. the OPERATIONAL half of BR-08 survives — the late-serve
//      detector (`computeBreakfastCutoffState`) and the audit
//      payload's `reasonOrCutoff: isLateServe` flag, which is
//      what the BR-07 kitchen-list late-changes column reads.
//      Those are the artifacts the kitchen actually needs; only
//      the guest email goes away.
//
// The original file pinned the three email tripwires (export +
// template copy + the post-transaction call). Those three
// assertions are the ones that had to change — the feature they
// guarded is gone by client request.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const EMAIL_HANDLER_PATH = path.resolve(
  __dirname,
  "../../server/handlers/email.ts"
);
const MARK_SERVED_PATH = path.resolve(
  __dirname,
  "../../server/handlers/breakfast-mark-served.ts"
);

function readFileSafe(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("BR-08 — the late-served guest email is removed (CNE-01)", () => {
  it("1. the `sendLateServedTrigger` export is GONE", () => {
    const source = readFileSafe(EMAIL_HANDLER_PATH);
    // A leftover export would let a future edit re-wire the
    // email without noticing the removal.
    expect(source).not.toMatch(
      /export\s+(?:async\s+)?function\s+sendLateServedTrigger\b/
    );
  });

  it("2. the `lateServedEmail` template + its copy are GONE", () => {
    const source = readFileSafe(EMAIL_HANDLER_PATH);
    expect(source).not.toMatch(/function\s+lateServedEmail\b/);
    expect(source).not.toMatch(/We served your breakfast late/);
    expect(source).not.toMatch(/please rate/i);
    expect(source).not.toMatch(/Late served\s*—\s*please rate/i);
  });

  it("3. breakfast-mark-served.ts no longer calls the email trigger", () => {
    const source = readFileSafe(MARK_SERVED_PATH);
    expect(source).not.toMatch(/sendLateServedTrigger/);
    expect(source).not.toMatch(/from\s+["']\.\/email["']/);
  });

  it("4. the OPERATIONAL half of BR-08 survives — the late-serve detector", () => {
    const source = readFileSafe(MARK_SERVED_PATH);
    // The detector lives in
    // `@spark-inn/shared/breakfastCutoff.computeBreakfastCutoffState`
    // and returns `isLocked: true` when the per-date cutoff has
    // passed. A wiring regression that never imports it means
    // the audit doc's `occurredAfterCutoff` flag never flips to
    // `true` and the BR-07 late-changes column silently no-ops.
    expect(source).toMatch(
      /import\s*\{\s*[^}]*computeBreakfastCutoffState[^}]*\}\s*from\s*["']@spark-inn\/shared["']/
    );
    // The audit payload carries `reasonOrCutoff: isLateServe`
    // so the audit doc's `occurredAfterCutoff` flag is the gate
    // the BR-07 kitchen list reads.
    expect(source).toMatch(/reasonOrCutoff:\s*isLateServe/);
    // The `isLateServe` gate itself still exists — only the
    // email behind it was removed.
    expect(source).toMatch(/isLateServe/);
  });
});
