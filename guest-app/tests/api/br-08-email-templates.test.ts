// Per BR-08 (Phase 13 — Breakfast Redesign, decision #238,
// 2026-10-14 — close-out): tripwire test for the BR-08
// "Late served — please rate" email extension.
//
// Per decision #238: the email handler grew one new
// template (`lateServedEmail`) + one new exported trigger
// (`sendLateServedTrigger`) to fire when the BR-05 mark-
// served handler records a serve action whose service
// date has crossed `BreakfastConfig.cutoffTime`. The
// audit doc's existing `occurredAfterCutoff: true` flag
// (set by BR-07's kitchen list audit scan) is the
// discriminator — no new `BreakfastAuditAction` enum
// value is introduced.
//
// The 3 tripwires below cover:
//   1. `sendLateServedTrigger` is exported from
//      `guest-app/server/handlers/email.ts`.
//   2. The `lateServedEmail` template carries the
//      guest-facing "Late served" eyebrow + "please
//      rate" CTA label so the spec text is visible in
//      the wire body.
//   3. `breakfast-mark-served.ts` wires the late-serve
//      detector (via `computeBreakfastCutoffState`) +
//      the post-transaction `sendLateServedTrigger`
//      call.

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

describe("BR-08 — Late served email extension (guest-app)", () => {
  it("1. email.ts exports the `sendLateServedTrigger` function", () => {
    const source = readFileSafe(EMAIL_HANDLER_PATH);
    // The trigger is fired from the BR-05 mark-served
    // handler — a non-exported function would mean the
    // call resolves at compile-time but the import
    // `from "./email"` in `breakfast-mark-served.ts`
    // would resolve to `undefined` at runtime and the
    // post-transaction email fire would silently no-op.
    expect(source).toMatch(
      /export\s+(?:async\s+)?function\s+sendLateServedTrigger\b/
    );
  });

  it("2. lateServedEmail template carries the 'Late served' eyebrow + 'please rate' copy", () => {
    const source = readFileSafe(EMAIL_HANDLER_PATH);
    // The template literal lives inside
    // `lateServedEmail(booking, slotEntry, occurredAtIso)`
    // and uses `emailLayout({ eyebrow, title, ... })`.
    // The "Late served" phrase must appear in the
    // eyebrow OR the title slot (the marketing copy
    // the spec asked for), and the "please rate" copy
    // must appear as the CTA label OR a body sentence.
    // Both pieces of copy together identify the new
    // template as the BR-08 late-served email.
    expect(source).toMatch(/We served your breakfast late/);
    expect(source).toMatch(/please rate/i);
    // The exported trigger's subject line is the
    // guest-inbox row the operator skims — it must
    // include "Late served" so staff can identify a
    // late-served email at a glance.
    expect(source).toMatch(/Late served\s*—\s*please rate/i);
  });

  it("3. breakfast-mark-served.ts wires the late-serve detector + the email trigger", () => {
    const source = readFileSafe(MARK_SERVED_PATH);
    // The detector lives in
    // `@spark-inn/shared/breakfastCutoff.computeBreakfastCutoffState`
    // and returns `isLocked: true` when the per-date
    // cutoff has passed. A wiring regression that
    // never imports it means the audit doc's
    // `occurredAfterCutoff` flag never flips to `true`
    // and the BR-07 late-changes column + this email
    // both silently no-op.
    expect(source).toMatch(
      /import\s*\{\s*[^}]*computeBreakfastCutoffState[^}]*\}\s*from\s*["']@spark-inn\/shared["']/
    );
    // The post-transaction trigger call: the handler
    // emits `sendLateServedTrigger(...)` only when the
    // serve crossed the cutoff (the `isLateServe` gate).
    expect(source).toMatch(/sendLateServedTrigger\s*\(/);
    // The audit payload carries `reasonOrCutoff: isLateServe`
    // so the audit doc's `occurredAfterCutoff` flag is the
    // gate the BR-07 kitchen list reads.
    expect(source).toMatch(/reasonOrCutoff:\s*isLateServe/);
  });
});
