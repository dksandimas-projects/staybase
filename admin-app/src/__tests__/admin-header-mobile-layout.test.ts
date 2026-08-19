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

    it("mobile wordmark has `max-w-[calc(100vw-7rem)] truncate` cap", () => {
      // The wordmark `<span>` lives inside the `{isMobile && (
      // ... )}` block at line ~150 (post-fix). The cap is
      // a `max-w-[calc(100vw-7rem)]` arbitrary value (the 7rem
      // ≈ 112 px is the conservative sum of left + right zone
      // widths — hamburger 44 + right zone 132 + 2 × safe-area
      // 16). `truncate` clips overflow with an ellipsis.
      // Defense-in-depth: pin BOTH properties — a refactor that
      // drops `max-w` reintroduces the overflow; a refactor that
      // drops `truncate` reintroduces the bleed.
      const wordmarkBlock = src.match(
        /\{\s*isMobile\s*&&\s*\(\s*<span[\s\S]*?<\/span>\s*\)\s*\}/
      );
      expect(wordmarkBlock).not.toBeNull();
      expect(wordmarkBlock![0]).toMatch(/max-w-\[calc\(100vw-7rem\)\]/);
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
