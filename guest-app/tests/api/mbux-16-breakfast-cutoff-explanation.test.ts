// MBUX-16 (decision #269, 2026-10-16) — add an explanation for
// why breakfast add-ons are closed due to the cut-off. The
// pre-MBUX-16 status text on locked dates was just "Ordering
// closed" — no explanation of WHY the date was locked. The
// owner review asked: "for breakfast cut-off can you add an
// explanation why the breakfast add-ons is unavailable or
// closed due to the cut off policy?"
//
// MBUX-17 (decision #272, 2026-10-16) — the MBUX-16 surface
// produced visible duplication on mobile (the cut-off TIME
// appeared in the top-of-section help text AND in every locked
// date card's sub-line). MBUX-17 collapses the per-date
// sub-line into a single compact pill ("Ordering closed due
// to cut-off") and removes the pre-MBUX-17 "Skipping a day is
// fine — leave any slot as 'No breakfast'" reassurance line
// (the default `<option>` on every guest slot is already "No
// breakfast", so the instruction was redundant). The top
// help text is now the single source for the cut-off time.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach the MBUX-* / BR-* / DR-01 suites use. These tests
// pin the SHAPE (the new formatCutoffTime helper, the
// per-date pill on locked dates, the help text when at least
// one date is locked, the conditional rendering so unlocked
// dates don't get the pill, the negative-space pins for the
// removed sub-line + reassure line), not the pixels; the
// visual acceptance is the MBUX-10 manual browser pass when
// the owner confirms the Firebase env.

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

  it("BookingPage uses formatCutoffTime in the cut-off help text (top-of-section, rendered only when at least one date is locked)", () => {
    expect(bookingPageSrc).toMatch(/formatCutoffTime\(breakfastConfig\.cutoffTime \|\| "20:00"\)/);
  });

  // ── The per-date locked marker is a single compact pill ───
  //
  // MBUX-17 (decision #272, 2026-10-16) replaces the
  // pre-MBUX-17 two-line stack ("Ordering closed" + an
  // amber-700 sub-line that named the cut-off time + the
  // "skip this day / contact the front desk" workarounds) with
  // a single compact pill that carries the full reason inline:
  // "Ordering closed due to cut-off". The top-of-section help
  // text is the single source for the cut-off TIME so it does
  // not need to be duplicated per-date. Style mirrors the
  // in-file "Tight — at the cap" / "Doesn't fit your group"
  // pills (rounded-full + amber-100 + amber-800 + the same
  // inline-flex items-center gap-1 + px-2.5 py-1 text-xs
  // font-semibold shape) so the cut-off indicator reads as part
  // of the same vocabulary rather than a separate one-off
  // element.

  it("the locked-state marker carries `data-testid=\"breakfast-cutoff-pill\"` for the test surface", () => {
    expect(bookingPageSrc).toMatch(/data-testid="breakfast-cutoff-pill"/);
  });

  it("the locked-state pill reads exactly `Past cut-off` (MBUX-17.1 shortened it from `Ordering closed due to cut-off`, which wrapped to `cut-/off` on a 375px phone)", () => {
    // The MBUX-17.1 follow-up shortened the pre-#### four-word pill
    // copy to a two-word short-form label that fits one line on
    // every viewport. Asserted by a literal substring match — the
    // BookingPage source intentionally does not mention the phrase
    // elsewhere, so a substring match is safe.
    expect(bookingPageSrc).toMatch(/Past cut-off/);
  });

  it("the pre-MBUX-17.1 `Ordering closed due to cut-off` copy is removed", () => {
    expect(bookingPageSrc).not.toMatch(/Ordering closed due to cut-off/);
  });

  it("the locked-state pill carries `whitespace-nowrap` so a future copy edit cannot reintroduce the wrap on mobile", () => {
    expect(bookingPageSrc).toMatch(
      /inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2\.5 py-1 text-xs font-semibold text-amber-800/
    );
  });

  it("the locked-state pill is rendered with a `<span>` (inline — the A-B comparison vs the unlocked state's `<p>` matters for the right-aligned layout)", () => {
    expect(bookingPageSrc).toMatch(/<span[\s\S]+?data-testid="breakfast-cutoff-pill"/);
  });

  // ── The pre-MBUX-17 per-date sub-line is gone ─────────────
  //
  // The pre-MBUX-17 sub-line (`data-testid="breakfast-cutoff-explanation"`)
  // and the unique "skip this day or contact the front desk"
  // workaround text are removed — the pill is the only locked
  // marker. The pre-MBUX-17 sub-line was the source of the
  // duplication the owner flagged: the cut-off time appeared
  // both in the top-of-section help text AND in every locked
  // date card.

  it("the pre-MBUX-17 per-date sub-line (data-testid=\"breakfast-cutoff-explanation\") is removed — the pill is the only locked marker", () => {
    expect(bookingPageSrc).not.toMatch(/data-testid="breakfast-cutoff-explanation"/);
  });

  it("the pre-MBUX-17 `skip this day or contact the front desk` workaround text is removed (the pill replaces it)", () => {
    expect(bookingPageSrc).not.toMatch(/skip this day or contact the front desk/);
  });

  it("the pre-MBUX-17 standalone `Ordering closed` title line is removed (the pill's first word IS `Ordering closed` — no need for a separate title)", () => {
    expect(bookingPageSrc).not.toMatch(/["']Ordering closed["']/);
  });

  // ── The unlocked-state line stays byte-equivalent ─────────
  //
  // MBUX-17 is locked-only. The pre-MBUX-16 line
  // `Order by ${formatStayDate(date)}` (just the date — no
  // time) is the existing unlocked contract and must be
  // preserved. MBUX-17 keeps it byte-equivalent.

  it("the unlocked state still renders `Order by ${formatStayDate(date)}` (byte-equivalent to pre-MBUX-17)", () => {
    expect(bookingPageSrc).toMatch(/Order by \$\{formatStayDate\(date\)\}/);
  });

  // ── The "Skipping a day is fine" reassurance line is gone ──
  //
  // MBUX-17 removes the pre-MBUX-17 "Skipping a day is fine —
  // leave any slot as 'No breakfast'" line above the date cards.
  // The default `<option>` on every guest slot is "No breakfast"
  // (the first entry in the meal list), so the instruction was
  // redundant — a guest who never opens a dropdown already gets
  // "No breakfast" for that guest/date. Saying it again above
  // the date cards added an extra sentence of mobile real estate
  // without changing any outcome.

  it("the pre-MBUX-17 `Skipping a day is fine` reassurance line is removed (default `No breakfast` selection already implies it)", () => {
    expect(bookingPageSrc).not.toMatch(/Skipping a day is fine/);
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

  // ── The pre-MBUX-17 "Skipping a day is fine" reassurance line is
  //    now gone (MBUX-17 removed it). The negative-space pin above
  //    is the contract.
});