// MBUX-16 (decision #269, 2026-10-16) — add an explanation for
// why breakfast add-ons are closed due to the cut-off. The
// pre-MBUX-16 status text on locked dates was just "Ordering
// closed" — no explanation of WHY the date was locked. The
// owner review asked: "for breakfast cut-off can you add an
// explanation why the breakfast add-ons is unavailable or
// closed due to the cut off policy?"
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach the MBUX-* / BR-* / DR-01 suites use. These tests
// pin the SHAPE (the new formatCutoffTime helper, the per-date
// sub-line on locked dates, the help text when at least one
// date is locked, the conditional rendering so unlocked dates
// don't get an extra sentence), not the pixels; the visual
// acceptance is the MBUX-10 manual browser pass when the
// owner confirms the Firebase env.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

// ── The formatCutoffTime helper ─────────────────────────────
//
// The helper takes a HH:MM (24-hour) string like "20:00" and
// returns a localized 12-hour string like "8:00 PM". This is
// a pure function — we exercise it directly so the test
// surfaces a real behaviour regression rather than just a
// string-shape regression.

import { formatCutoffTime } from "../../src/utils/formatCutoffTime";

describe("MBUX-16 — breakfast cut-off explanation", () => {
  describe("formatCutoffTime helper (pure 12-hour formatter)", () => {
    it("formats 20:00 as 8:00 PM (the staging config default)", () => {
      expect(formatCutoffTime("20:00")).toBe("8:00 PM");
    });

    it("formats 00:00 as 12:00 AM (midnight, not 0:00 AM)", () => {
      // 0:00 should render as 12:00 AM (clock face convention),
      // not 0:00 AM. A 0:00 AM string reads as a typo to most
      // guests — they would wonder if 0 means AM or PM.
      expect(formatCutoffTime("00:00")).toBe("12:00 AM");
    });

    it("formats 12:00 as 12:00 PM (noon, not 0:00 PM)", () => {
      // 12:00 (noon) should render as 12:00 PM, not 0:00 PM.
      expect(formatCutoffTime("12:00")).toBe("12:00 PM");
    });

    it("formats 12:30 as 12:30 PM", () => {
      expect(formatCutoffTime("12:30")).toBe("12:30 PM");
    });

    it("formats 07:00 as 7:00 AM (no leading zero on the hour)", () => {
      // The pre-MBUX-16 helper used toLocaleTimeString which
      // can produce "07:00 AM" with a leading zero. The new
      // helper normalizes to "7:00 AM" to match the hotel's
      // existing date formatting (formatStayDate also drops
      // the leading zero — month-day format).
      expect(formatCutoffTime("07:00")).toBe("7:00 AM");
    });

    it("formats 23:59 as 11:59 PM (boundary)", () => {
      expect(formatCutoffTime("23:59")).toBe("11:59 PM");
    });

    it("falls back to the raw input on a malformed value (so a misconfigured admin value can't break the page)", () => {
      expect(formatCutoffTime("not-a-time")).toBe("not-a-time");
      expect(formatCutoffTime("")).toBe("");
      expect(formatCutoffTime("25:00")).toBe("25:00");
      expect(formatCutoffTime("12:60")).toBe("12:60");
    });
  });

  // ── The helper is wired into the BookingPage JSX ──────────

  it("BookingPage imports the formatCutoffTime helper from `../utils/formatCutoffTime`", () => {
    // The helper lives in `src/utils/formatCutoffTime.ts` so
    // it can be imported directly by the test suite (no
    // indirection through this file's compilation). Pin the
    // import path here so a future refactor that inlines the
    // helper back into this file surfaces at this layer.
    expect(bookingPageSrc).toMatch(/import\s*\{\s*formatCutoffTime\s*\}\s*from\s*["']\.\.\/utils\/formatCutoffTime["']/);
  });

  it("the helper module lives at `src/utils/formatCutoffTime.ts`", () => {
    const helperSrc = read("guest-app/src/utils/formatCutoffTime.ts");
    expect(helperSrc).toMatch(/export\s+function\s+formatCutoffTime\s*\(\s*hhmm:\s*string\s*\)/);
  });

  it("BookingPage uses formatCutoffTime in the cut-off explanation", () => {
    expect(bookingPageSrc).toMatch(/formatCutoffTime\(breakfastConfig\.cutoffTime \|\| "20:00"\)/);
  });

  // ── The per-date sub-line on locked dates ─────────────────
  //
  // The pre-MBUX-16 status text on locked dates was a single
  // `<p>` carrying "Ordering closed". MBUX-16 keeps that as
  // line 1 (so the existing `Order by 24 Oct, 8:00 PM` test
  // surface doesn't churn) and adds a new line 2 (text-amber-700,
  // data-testid="breakfast-cutoff-explanation") that names the
  // cut-off time + suggests two workarounds ("skip this day"
  // or "contact the front desk"). The sub-line is conditional
  // on `cutoff.isLocked` so unlocked dates don't get an extra
  // sentence — that would be visual noise competing with the
  // existing deadline text.

  it("the locked-state sub-line carries `data-testid=\"breakfast-cutoff-explanation\"` for the test surface", () => {
    expect(bookingPageSrc).toMatch(/data-testid="breakfast-cutoff-explanation"/);
  });

  it("the locked-state sub-line names the cut-off time + the 'skip this day or contact the front desk' workaround", () => {
    // The text is the explanation itself — anchor it on the
    // unique phrase "skip this day or contact the front desk"
    // (vs the title line which says "Ordering closed"). The
    // cut-off time is interpolated via formatCutoffTime so the
    // actual rendered time is config-driven.
    expect(bookingPageSrc).toMatch(/skip this day or contact the front desk/);
  });

  it("the locked-state sub-line uses the `text-amber-700` accent (matches the existing cut-off / Fits-invalidity banner)", () => {
    expect(bookingPageSrc).toMatch(/breakfast-cutoff-explanation[\s\S]+?text-amber-700/);
  });

  // ── The unlocked-state line stays byte-equivalent ─────────
  //
  // MBUX-16 is locked-only. The pre-MBUX-16 line
  // `Order by ${formatStayDate(date)}` (just the date — no
  // time) is the existing unlocked contract and must be
  // preserved.

  it("the unlocked state still renders `Order by ${formatStayDate(date)}` (byte-equivalent to pre-MBUX-16)", () => {
    expect(bookingPageSrc).toMatch(/Order by \$\{formatStayDate\(date\)\}/);
  });

  // ── The new help text appears only when at least one date
  //    is locked ─────────────────────────────────────────────

  it("BookingPage conditionally renders the breakfast-cutoff-help line via a `dates.some(c => c.isLocked)` check", () => {
    // The help text explains the cut-off policy before the
    // guest hits a locked date. It must NOT appear when every
    // date is still open — it would be noise that competes
    // with the existing "Skipping a day is fine" line.
    expect(bookingPageSrc).toMatch(/dates\.some\([\s\S]+?c\.isLocked/);
  });

  it("the help-text element carries `data-testid=\"breakfast-cutoff-help\"` for the test surface", () => {
    expect(bookingPageSrc).toMatch(/data-testid="breakfast-cutoff-help"/);
  });

  it("the help text uses the `text-amber-700` accent (matches the cut-off sub-line)", () => {
    expect(bookingPageSrc).toMatch(/breakfast-cutoff-help[\s\S]+?text-amber-700/);
  });

  it("the help text names the cut-off time + the 'when it passes, that day's menu locks' contract + 'the rest of the stay is still editable'", () => {
    // The "rest of the stay is still editable" suffix is
    // critical — without it a guest might think the WHOLE
    // breakfast flow is locked, when actually only the one
    // past-deadline date is. The "per-day" prefix makes the
    // cut-off shape clear (it is NOT a global lock).
    expect(bookingPageSrc).toMatch(/per-day cut-off/);
    expect(bookingPageSrc).toMatch(/that day's menu locks/);
    expect(bookingPageSrc).toMatch(/the rest of the stay is still editable/);
  });

  // ── The existing "Skipping a day is fine" line is preserved ─

  it("the existing `Skipping a day is fine` line is still rendered (MBUX-16 is additive, not a replacement)", () => {
    expect(bookingPageSrc).toMatch(/Skipping a day is fine — leave any slot as .No breakfast./);
  });
});