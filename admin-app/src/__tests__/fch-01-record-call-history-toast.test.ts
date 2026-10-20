// `fix/record-call-history-toast` — defense-in-depth regression for
// FCH-01 (decision #263, 2026-10-16). The lesson learned from
// decision #216 was that `recordCallHistory`'s catch was a silent
// `console.warn` — Firestore rejected the write, the warn was
// invisible to the staff member, and the "Call answered by {Name}"
// audit trail never landed in the chat thread. The #216 rule fix
// unblocked the common case, but ANY future write failure
// (Firestore quota, network blip, a new rule field mismatch, the
// `intercoms/{roomId}/messages` parent doc missing, etc.) would
// still go to console without a UI signal.
//
// FCH-01 adds a `notify.error` toast inside the same `catch` block
// so the staff-facing primary signal is the toast and the
// `console.warn` is the secondary diagnostic for the operator's
// devtools. Both must remain — the toast is for staff, the console
// is for the operator — and the dispatch contract must NOT change
// shape (still best-effort, never throws, never breaks the call
// cleanup flow).
//
// References:
//   plan/docs/DECISIONS-FEATURES.md #263 (FCH-01)
//   plan/project/ROADMAP.md §Open Follow-Ups → FCH-01
//   admin-app/src/context/AdminContext.tsx (recordCallHistory, the
//     dispatcher every call-end path routes through)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");

const adminContext = read("admin-app/src/context/AdminContext.tsx");
const toastModule = read("admin-app/src/components/Toast.tsx");

// Extract the body of the recordCallHistory function so the catch
// pin is scoped to the helper itself, not any other call site that
// happens to mention "console.warn" (e.g. voucher toggles at
// ~line 3576, MarkAsRead at ~line 4562). The helper takes
// (roomId, outcome, durationMs) so the function signature anchors
// the slice. A regex can't match this safely — the body has nested
// braces (fmtClock, fmtDuration, and the try/catch) — so a small
// brace-counter extracts the full body from the opening `{` after
// the signature to its matching `}`.
const recordCallHistoryBody = (() => {
  const sigMatch = adminContext.match(
    /const recordCallHistory\s*=\s*async\s*\(\s*roomId: string,\s*outcome:[\s\S]+?durationMs: number \| null\s*\)\s*=>\s*\{/
  );
  if (!sigMatch || sigMatch.index === undefined) return null;
  const start = sigMatch.index + sigMatch[0].length - 1; // the `{`
  let depth = 0;
  for (let i = start; i < adminContext.length; i += 1) {
    const ch = adminContext[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return adminContext.slice(start + 1, i);
      }
    }
  }
  return null;
})();

describe("FCH-01 — recordCallHistory catch surfaces a toast, not a silent console.warn", () => {
  // ── Anchor ───────────────────────────────────────────────
  //
  // If this test fails, every other test in this file is a
  // false positive. The slice must match — the helper shape is
  // not negotiable.

  it("the recordCallHistory function slice could be located in AdminContext.tsx", () => {
    expect(
      recordCallHistoryBody,
      "recordCallHistory helper must exist in AdminContext.tsx with the (roomId, outcome, durationMs) signature"
    ).not.toBeNull();
    expect(recordCallHistoryBody).toMatch(/try\s*\{/);
    expect(recordCallHistoryBody).toMatch(/}\s*catch\s*\(/);
  });

  // ── Primary signal: the toast ────────────────────────────
  //
  // The toast must fire inside the SAME catch block, with the
  // staff-facing title "Call history not recorded" so it
  // matches the pattern of `acceptCall`'s "Call taken"
  // (AdminContext.tsx:5152). The toast must NOT throw — the
  // outer try/catch that wraps the dispatch hook
  // (AdminContext.tsx:4880-4889) catches dispatch errors and
  // would mask a toast failure as a "dispatch hook threw",
  // making it harder to debug.

  it("catch block calls notify.error with the staff-facing title", () => {
    expect(recordCallHistoryBody).toMatch(
      /catch\s*\([\s\S]+?notify\.error\(\s*["']Call history not recorded["']/
    );
  });

  it("notify.error second argument mentions the room id so the staff can correlate the failure", () => {
    // The roomId parameter is in scope inside the helper body;
    // the template literal must interpolate it so the staff
    // sees which room's audit entry failed. A static string
    // would defeat the purpose (the operator would still have
    // to open devtools to correlate).
    expect(recordCallHistoryBody).toMatch(
      /notify\.error\([\s\S]+?\$\{roomId\}[\s\S]+?\)/
    );
  });

  it("notify.error second argument points the staff at the browser console for details", () => {
    // The toast is the primary signal; the console is the
    // secondary diagnostic. The toast message must explicitly
    // point staff at the console so they don't double-book the
    // failure into a chat thread or a Report entry.
    expect(recordCallHistoryBody).toMatch(
      /notify\.error\([\s\S]+?See the browser console for details\./
    );
  });

  // ── Secondary signal: the console.warn ───────────────────
  //
  // The console.warn MUST STAY. The toast is for staff; the
  // console is for the operator's devtools. Dropping the warn
  // would lose the actual error object (toasts carry strings,
  // not error stacks), and decision #216's "Known follow-up"
  // explicitly required both surfaces to remain.

  it("catch block still calls console.warn with the [call-history] log prefix", () => {
    expect(recordCallHistoryBody).toMatch(
      /console\.warn\([\s\S]+?\[call-history\][\s\S]+?roomId/
    );
  });

  it("console.warn second arg is the actual error so the operator can debug it", () => {
    // The warn signature is `console.warn("[call-history] failed to record {outcome} for {roomId}:", error)`
    // — the actual error object must reach the console, not a
    // stringified version. A `String(error)` would lose the
    // stack + the Firestore error code.
    expect(recordCallHistoryBody).toMatch(
      /console\.warn\([\s\S]+?\[call-history\][\s\S]+?,\s*error\s*\)/
    );
  });

  // ── The toast itself ────────────────────────────────────
  //
  // Pin the toast module's contract: `notify.error(title,
  // message?)` exists, the error variant produces a role="alert"
  // toast with an ERROR_DURATION_MS, and the call shape is
  // identical to the existing `acceptCall` "Call taken" toast
  // pattern at AdminContext.tsx:5152. If a future refactor
  // renames `notify.error`, this fails.

  it("Toast module exposes notify.error with the (title, message?) signature", () => {
    expect(toastModule).toMatch(
      /error:\s*\(title: string, message\?:\s*string\)\s*=>/
    );
  });

  it("Toast module's error variant uses role=\"alert\" so screen readers announce it immediately", () => {
    // The staff-facing toast must be a live-region alert, not
    // a status. A role=status toast is announced only when the
    // screen reader is idle; a role=alert toast interrupts.
    // Failing this means a future refactor accidentally softens
    // the error signal for visually-impaired staff.
    expect(toastModule).toMatch(
      /role=\{toast\.variant === "error"\s*\?\s*"alert"\s*:\s*"status"\}/
    );
  });

  // ── Best-effort guard ────────────────────────────────────
  //
  // The whole `try/catch` must NOT rethrow — recordCallHistory
  // is documented as best-effort (the active-call banner /
  // hang-up already succeeded before the helper runs). A
  // future refactor that adds `throw error;` at the catch tail
  // would let a Firestore failure break the cleanup flow, which
  // is exactly the bug the try/catch was added to avoid.

  it("the catch block does NOT rethrow — recordCallHistory is best-effort", () => {
    expect(recordCallHistoryBody).not.toMatch(/catch\s*\([\s\S]+?throw\s+/);
  });

  // ── Cross-file contract ─────────────────────────────────
  //
  // AdminContext.tsx already imports `notify` from
  // `../components/Toast` at line 124 — pin that import so a
  // future move of the Toast module surfaces at this layer.

  it("AdminContext.tsx imports notify from ../components/Toast (the same module as the existing toast call sites)", () => {
    expect(adminContext).toMatch(
      /import\s*\{[^}]*\bnotify\b[^}]*\}\s*from\s*["']\.\.\/components\/Toast["']/
    );
  });
});