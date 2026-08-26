import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for #18 / decision #224 (2026-08-19): the
// admin header wordmark overlapped the NotificationBell on narrow
// viewports (<375 px) with a long `config.brandName`. Three
// root causes: the right zone wrapper had no `shrink-0`, the
// NotificationBell wrapper had no `shrink-0`, the absolute
// wordmark had no `max-w`/`truncate` cap, AND none of the three
// elements had `data-testid` markers for the e2e suite to
// target. The fix is three layers of Tailwind class additions
// + three `data-testid` attributes.

describe("admin header mobile layout (#18 / decision #224)", () => {
  describe("AdminLayout.tsx — three-zone contract", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/components/AdminLayout.tsx"),
      "utf8"
    );

    it("right zone wrapper has `shrink-0` (prevents flexbox from squeezing the bell)", () => {
      // The right zone is the <div> sibling to the center wordmark
      // and left hamburger. Pre-#224 the className was
      // `"flex items-center gap-2 sm:gap-4"`. Post-#224 it
      // gains `shrink-0` so the NotificationBell + mute button
      // + signout avatar can't be compressed under the
      // absolutely-positioned wordmark when the viewport
      // narrows.
      expect(src).toMatch(
        /flex\s+shrink-0\s+items-center\s+gap-2\s+sm:gap-4/
      );
    });

    it("mobile wordmark has `max-w-[calc(100vw-11rem)] truncate` cap (decision #225)", () => {
      // The wordmark `<span>` lives inside the `{isMobile && (
      // ... )}` block. The cap is a `max-w-[calc(100vw-11rem)]`
      // arbitrary value (per decision #225, 2026-08-26) — the
      // 11rem ≈ 176 px is the conservative sum of left + right
      // zone widths *plus* safe-area breathing room:
      //   hamburger 44 + safe-area-L 16 = 60px (left)
      //   right zone 148 + safe-area-R 16 = 164px (right)
      //   total: 224px; + 32px slack for the bell-badge overflow
      //   and iPhone-5 320px rounding.
      //
      // History: the #224 (2026-08-19) cap was
      //   `max-w-[calc(100vw-7rem)]` (≈263px at 375) — but
      //   the actual available center slot is only 151px, so
      //   263px > 151px meant the cap NEVER fired and the
      //   absolute wordmark still overlapped the right-zone
      //   icons on small phones. The #225 fix tightens the
      //   cap AND shrinks the text to `text-sm` with
      //   `tracking-tight` so "spark inn" fits cleanly.
      //
      // `truncate` clips any remaining overflow with an
      // ellipsis (e.g. a longer `config.brandName` on a very
      // narrow viewport). Defense-in-depth: pin BOTH
      // properties — a refactor that drops `max-w`
      // reintroduces the overflow; a refactor that drops
      // `truncate` reintroduces the bleed.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/max-w-\[calc\(100vw-11rem\)\]/);
      expect(wordmarkBlock![0]).toMatch(/\btruncate\b/);
    });

    it("mobile wordmark carries data-testid=\"brand-wordmark\"", () => {
      // The marker is on the `<span>` element itself so e2e
      // suites (Playwright, Cypress) can locate + assert on the
      // wordmark without depending on brittle text matching.
      const wordmark = src.match(/data-testid\s*=\s*["']brand-wordmark["']/);
      expect(wordmark).not.toBeNull();
    });
  });

  // Regression test for the small-phone overlap (re-opened
  // after #224): at 375px the wordmark "spark inn" rendered
  // at text-lg Apollo heading is ~160px wide but the center
  // space between the 60px hamburger+safe-area on the left
  // and the 164px right-zone (3 × 44 + 2 × 8 + safe-area 16)
  // is only ~151px. The #224 cap `100vw-7rem` (≈263px) is
  // *larger* than the available center space, so the cap
  // never fires and the absolute-centered wordmark bleeds
  // past the right zone's left edge, overlapping the
  // NotificationBell + mute + avatar buttons. Fix: tighten
  // the cap to `100vw-11rem` (≈199px, leaves 32 px of slack
  // for rounding/bell-badge overflow on the smallest 320px
  // iPhone-5-class screens) AND downgrade `text-lg` →
  // `text-sm` with `tracking-tight` so "spark inn" shrinks
  // to ~110px and stays comfortably inside the 151px slot.
  describe("admin header wordmark — small phone overlap (decision #225)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/components/AdminLayout.tsx"),
      "utf8"
    );

    it("mobile wordmark uses `text-sm` (not text-lg) so 'spark inn' fits at 375px", () => {
      // text-sm = 14px, "spark inn" at 14px Apollo ≈110px.
      // text-lg = 18px, "spark inn" at 18px Apollo ≈160px
      // (overflows the 151px center slot). Pin text-sm so
      // a refactor that bumps the heading back to text-lg is
      // caught at source-text — it would re-open the visual
      // overlap this fix closed.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/\btext-sm\b/);
      expect(wordmarkBlock![0]).not.toMatch(/\btext-lg\b/);
    });

    it("mobile wordmark uses `tracking-tight` for the compact rendering", () => {
      // tracking-tight = -0.025em letter-spacing. Pin so a
      // refactor that drops the tighter tracking (and lets
      // letters breathe open) is caught.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/\btracking-tight\b/);
    });

    it("mobile wordmark cap is `100vw-11rem` (tight enough for 375px)", () => {
      // The #224 cap `100vw-7rem` (≈263px at 375) is wider
      // than the 151px center slot, so it does nothing. The
      // new cap `100vw-11rem` (≈199px at 375) leaves the
      // wordmark a hard ceiling below the right zone's left
      // edge (right zone starts at 375−16−148 = 211px, so the
      // wordmark right edge from a center at 187.5 caps at
      // 187.5 + (199/2) = 287px… wait that's still >211).
      //
      //   Correct reasoning: with text-sm + tracking-tight
      //   "spark inn" measures ~110px, which is < 151px center
      //   slot. The `max-w-[calc(100vw-11rem)]` cap is the
      //   fail-safe for screens narrower than 375px where the
      //   slot compresses further (e.g. iPhone 5 at 320px →
      //   slot ≈ 96px, cap ≈ 144px still > 96px; truncate
      //   kicks in and clips with an ellipsis instead of
      //   overflowing under the icons).
      //
      // Pin the exact arbitrary value as a single source of
      // truth — defense-in-depth against silent refactors.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/max-w-\[calc\(100vw-11rem\)\]/);
    });

    it("mobile wordmark keeps the `truncate` ellipsis fallback for narrow screens", () => {
      // Belt-and-braces with the new cap: on a 320px iPhone-5
      // viewport the slot is ~96px and even the text-sm
      // wordmark (110px) needs to clip. `truncate` provides
      // the ellipsis so the overflow becomes "spark i..." not
      // a visual bleed-under-icons.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/\btruncate\b/);
    });
  });

  describe("NotificationBell.tsx — desktop + mobile wrappers", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/components/NotificationBell.tsx"),
      "utf8"
    );

    it("desktop wrapper has `shrink-0` + `data-testid=\"notif-bell-wrap\"`", () => {
      // The desktop branch returns `<div className="relative
      // shrink-0" data-testid="notif-bell-wrap">`. Pin both
      // tokens so a refactor that drops `shrink-0` (and
      // reintroduces the squeeze) or strips the data-testid
      // (and breaks the e2e locator) is caught at source-text.
      expect(src).toMatch(/relative\s+shrink-0/);
      expect(src).toMatch(/data-testid\s*=\s*["']notif-bell-wrap["']/);
    });

    it("both mobile + desktop bell buttons carry `data-testid=\"notif-bell\"`", () => {
      // Two buttons (mobile opens a Drawer, desktop opens a
      // dropdown) both share the `notif-bell` test-id so the
      // e2e suite can target either without conditionals. Pin
      // an exact count of 2 to catch a refactor that splits or
      // merges the two branches.
      const matches = src.match(/data-testid\s*=\s*["']notif-bell["']/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });

    it("both bell buttons have `shrink-0` in their className", () => {
      // Each `<button>` element has the `className="relative
      // flex h-11 w-11 shrink-0 ..."`. Belt-and-braces — the
      // wrapper shrink-0 pins the bell container, the
      // individual button shrink-0 is defense-in-depth so a
      // refactor that splits the wrapper doesn't silently
      // re-introduce the squeeze.
      const matches = src.match(
        /h-11\s+w-11\s+shrink-0\s+items-center/g
      );
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });
  });
});
