// MBUX-15 (decision #268, 2026-10-16) — the hold-expired banner
// stacks vertically on mobile and goes inline on `sm:`+,
// instead of always-inline. Pre-MBUX-15 the outer container
// was `flex flex-wrap items-center` — on a 375px phone the
// text block (with `flex-1`) got squeezed into a narrow
// column next to the two buttons, and the buttons themselves
// were narrow because they were sharing the row. The owner
// flagged this with a screenshot of the banner on mobile
// and asked for a UI improvement.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning. The visual
// acceptance (does the banner stack cleanly at 375px) is the
// MBUX-10 manual browser pass when the owner confirms the
// Firebase env.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const bannerSrc = read("guest-app/src/components/HoldCountdownBanner.tsx");

describe("MBUX-15 — hold-expired banner stacks vertically on mobile", () => {
  // ── Locate the expired-state JSX block ───────────────────
  //
  // The expired state is the only one with a
  // `data-state="expired"` attribute (the active state has
  // `data-state="active"`, the error state has
  // `data-state="error"`, and the transient-error state has
  // `data-state="error"` too). Anchor on `data-state="expired"`
  // so the pin is scoped to the expired state and doesn't
  // accidentally satisfy via the active or error states.

  function expiredStateBlock(): string {
    // The expired state is the only <motion.div> in the file
    // with `role="alert"`. Anchor on the `<motion.div`
    // opening tag that contains `role="alert"` (the active
    // state has no role; the loading skeleton has no role;
    // the transient-error state has role="status" not
    // role="alert"). Walk forward from there to the matching
    // `</motion.div>` with a simple depth counter.
    const marker = '<motion.div';
    let startIdx = -1;
    for (let i = 0; i < bannerSrc.length - marker.length; i += 1) {
      if (!bannerSrc.startsWith(marker, i)) continue;
      // Capture the opening tag.
      const tagEnd = bannerSrc.indexOf(">", i);
      const openingTag = bannerSrc.slice(i, tagEnd + 1);
      if (!openingTag.includes('role="alert"')) continue;
      startIdx = i;
      // Walk forward to the matching </motion.div>.
      let depth = 1;
      for (let j = tagEnd + 1; j < bannerSrc.length; j += 1) {
        if (bannerSrc.startsWith("<motion.div", j)) depth += 1;
        else if (bannerSrc.startsWith("</motion.div>", j)) {
          depth -= 1;
          if (depth === 0) {
            return bannerSrc.slice(startIdx, j + "</motion.div>".length);
          }
        }
      }
    }
    return "";
  }

  // ── The outer container stacks on mobile ─────────────────
  //
  // Pre-MBUX-15 was `flex flex-wrap items-center gap-3` —
  // always-inline, the buttons were always-right. MBUX-15
  // changes this to `flex flex-col ... sm:flex-row
  // sm:flex-wrap sm:items-center sm:gap-3` so the text +
  // buttons stack on mobile and only go inline on `sm:`+.

  it("the outer expired-state container stacks on mobile (`flex-col`) and inlines on `sm:`+ (`sm:flex-row sm:flex-wrap`)", () => {
    const block = expiredStateBlock();
    expect(block, "the expired-state block must exist").not.toBe("");
    expect(block, "the outer container must use `flex-col` for the mobile stack").toMatch(/className="mx-auto flex max-w-5xl flex-col/);
    expect(block, "the outer container must restore inline on `sm:`+").toMatch(/sm:flex-row sm:flex-wrap sm:items-center/);
  });

  // ── The buttons container also stacks ────────────────────
  //
  // Pre-MBUX-15 was `flex flex-wrap items-center gap-2` —
  // the two buttons shared the row, narrow widths. MBUX-15
  // changes this to `flex flex-col gap-2 sm:flex-row
  // sm:flex-wrap sm:items-center sm:gap-2` so on mobile the
  // two buttons stack vertically with full widths (one per
  // row), and on `sm:`+ they go inline.

  it("the buttons container stacks on mobile (`flex-col gap-2`) and inlines on `sm:`+ (`sm:flex-row sm:flex-wrap sm:items-center`)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2"/);
  });

  // ── The buttons themselves go full-width on mobile ───────
  //
  // Pre-MBUX-15 the buttons were `inline-flex min-h-11` —
  // sized by content. MBUX-15 adds `w-full sm:w-auto` so
  // they fill the row width on mobile and restore auto
  // width on `sm:`+.

  it("the 'I need more time' primary button is full-width on mobile (`w-full sm:w-auto`)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/data-testid="hold-extend-cta"[\s\S]+?className="inline-flex min-h-11 w-full items-center justify-center gap-1\.5 rounded-lg bg-primary px-3 text-xs font-semibold text-gray-900 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"/);
  });

  it("the 'Pick a new room' secondary button is full-width on mobile (`w-full sm:w-auto`)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/data-testid="hold-pick-new-room-cta"[\s\S]+?className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-red-300 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-100 sm:w-auto"/);
  });

  // ── The IMT-03 primary/secondary emphasis is preserved ───
  //
  // Per IMT-03, "I need more time" is the PRIMARY action
  // (filled `bg-primary`) and "Pick a new room" is the
  // SECONDARY action (ghost `border-red-300`). MBUX-15 only
  // adjusts the layout; the emphasis hierarchy stays. A
  // future refactor that swaps them must be a separate
  // decision entry.

  it("the 'I need more time' primary button keeps the IMT-03 `bg-primary` filled emphasis (MBUX-15 is layout only, not emphasis)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/data-testid="hold-extend-cta"[\s\S]+?bg-primary/);
    expect(block).toMatch(/data-testid="hold-extend-cta"[\s\S]+?hover:bg-primary-dark/);
  });

  it("the 'Pick a new room' secondary button keeps the IMT-03 `border-red-300 bg-white` ghost emphasis", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/data-testid="hold-pick-new-room-cta"[\s\S]+?border border-red-300 bg-white/);
    expect(block).toMatch(/data-testid="hold-pick-new-room-cta"[\s\S]+?hover:bg-red-100/);
  });

  // ── The text block + heading + body are preserved ────────
  //
  // MBUX-15 only adjusts layout; the headline, body copy,
  // and `min-w-0 flex-1` text-block anchor are unchanged.

  it("the 'Your hold has expired.' headline is preserved", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/Your hold has expired\./);
  });

  it("the body copy branches on `canExtend` are preserved (extend / can't-extend)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/Need a bit more time\? Ask for more and carry on where you left off/);
    expect(block).toMatch(/This hold can.{0,3}t be extended any further/);
  });

  it("the text block still carries `min-w-0 flex-1` (so it shrinks on inline-on-desktop without forcing horizontal overflow)", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/min-w-0 flex-1/);
  });

  // ── The accessibility surface is preserved ───────────────
  //
  // The `<motion.div role="alert">` + `data-testid="hold-countdown-banner"`
  // + `data-state="expired"` are the contract the rest of
  // the app + screen readers + tests depend on. MBUX-15 must
  // not touch any of these.

  it("the expired-state wrapper still carries `role=\"alert\"` so screen readers announce it immediately", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/role="alert"/);
  });

  it("the expired-state wrapper still carries `data-testid=\"hold-countdown-banner\"` and `data-state=\"expired\"`", () => {
    const block = expiredStateBlock();
    expect(block).toMatch(/data-testid="hold-countdown-banner"/);
    expect(block).toMatch(/data-state="expired"/);
  });
});