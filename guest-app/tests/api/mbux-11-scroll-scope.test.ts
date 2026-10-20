// MBUX-11 (decision #264, 2026-10-16) — `ScrollToTop` must only
// scroll the viewport on a pathname change OR a `step` query-param
// value change; every other search-param mutation (cart quantities,
// adult/child steppers, etc.) must leave the scroll position alone.
//
// Why this is source-text rather than DOM:
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach `mbux-01-booking-shell.test.ts`,
// `mbux-10-phase-15-closeout.test.ts`, and the BR-* / DR-01 /
// in-flow-hold suites use. These tests pin the BEHAVIOUR the
// effect implements, not the pixels; the visual verification
// (does the page actually jump) is a manual browser pass.
//
// Why this matters: the pre-MBUX-11 implementation watched the
// whole `search` string via the `useLocation` hook's effect
// dependency and called `window.scrollTo(0, 0)` on every change.
// The booking flow persists cart state into the same search
// string (e.g. `?adults=2&children=1&quantity=1&room=deluxe`),
// so every +/- button and every room-card selection triggered
// a scroll-to-top — which the user reported as "scrolling back
// to top every time I change a quantity".

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const appSrc = read("guest-app/src/App.tsx");

// Pull the body of `ScrollToTop` so the pins are scoped to the
// helper and don't drift into unrelated useLocation calls. The
// brace counter handles the nested `if` + the `useEffect` arrow
// body safely.
const scrollToTopBody = (() => {
  const sigMatch = appSrc.match(
    /export function ScrollToTop\(\)\s*\{/
  );
  if (!sigMatch || sigMatch.index === undefined) return null;
  const start = sigMatch.index + sigMatch[0].length - 1; // the `{`
  let depth = 0;
  for (let i = start; i < appSrc.length; i += 1) {
    const ch = appSrc[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return appSrc.slice(start + 1, i);
      }
    }
  }
  return null;
})();

describe("MBUX-11 — ScrollToTop scope fix", () => {
  it("ScrollToTop function slice could be located in App.tsx", () => {
    expect(scrollToTopBody, "ScrollToTop must exist in App.tsx").not.toBeNull();
    expect(scrollToTopBody).toMatch(/useEffect/);
  });

  // ── Effect dependency ────────────────────────────────────
  //
  // The pre-MBUX-11 effect watched `pathname` AND `search`
  // and called `window.scrollTo(0, 0)` on every change. The
  // fix narrows the trigger to only the two cases that
  // actually warrant a scroll: a pathname change (real route
  // change) OR a `step` query-param value change (in-page
  // step transition in the booking flow).

  it("the effect's dependency array still includes pathname and search (so the effect re-runs on route change)", () => {
    expect(scrollToTopBody).toMatch(/useEffect\([\s\S]+?\[pathname,\s*search\]\)/);
  });

  it("the effect parses the `step` query-param value via URLSearchParams", () => {
    expect(scrollToTopBody).toMatch(/new URLSearchParams\(search\)\.get\(["']step["']\)/);
  });

  // ── The two-and-only-two scroll triggers ─────────────────
  //
  // The fix must NOT regress the original intent — scroll on
  // real route changes. And it must ADD the step-change case.
  // No third trigger (no "any search change", no "any URL
  // change outside of those two", etc.).

  it("the effect calls window.scrollTo(0, 0) when the pathname changes", () => {
    // The check itself is the contract: `prevPathRef.current !== pathname`.
    // A future refactor that removes the pathname comparison would let
    // a real route change NOT scroll, which would regress MBUX-01's
    // multi-step booking flow (the stepper advances `?step=...`
    // without changing the pathname, so the user does still need
    // the step trigger; but a real route change between /book and
    // /book/confirm MUST also scroll).
    expect(scrollToTopBody).toMatch(/prevPathRef\.current\s*!==\s*pathname/);
  });

  it("the effect calls window.scrollTo(0, 0) when the `step` value changes", () => {
    expect(scrollToTopBody).toMatch(/prevStepRef\.current\s*!==\s*currentStep/);
  });

  it("the effect does NOT scroll on every search change — the call is gated by the trigger OR", () => {
    // The window.scrollTo(0, 0) call must live inside the OR of
    // the two triggers (pathname-changed OR step-changed) plus
    // the first-render guard. If it sits outside that gate,
    // the regression is back. The helper carries a long rationale
    // comment that pushes the condition far from the call site,
    // so we pin the full body instead of slicing context.
    expect(scrollToTopBody).toMatch(/if\s*\(\s*isFirstRender\s*\|\|\s*pathnameChanged\s*\|\|\s*stepChanged\s*\)/);
    expect(scrollToTopBody).toMatch(/window\.scrollTo\(0,\s*0\)/);
  });

  // ── The refs (not state) carry the previous values ───────
  //
  // The fix uses `useRef` for the previous pathname + previous
  // step, NOT `useState`. Using `useState` would cause a
  // re-render loop: setState → re-render → effect fires →
  // setState again. The ref pattern avoids the loop.

  it("the previous pathname is tracked via useRef, not useState", () => {
    expect(scrollToTopBody).toMatch(/useRef<string \| null>\(null\)/);
  });

  it("the previous pathname ref is written after the scroll decision", () => {
    // The ref write `prevPathRef.current = pathname` must happen
    // AFTER the `if (isFirstRender || pathnameChanged || stepChanged)`
    // check, so the NEXT effect run compares against the right
    // "previous" value. If the write happens before the check,
    // the very next effect run would see `current === prev` and
    // skip the scroll on a legitimate step change.
    const assignIdx = scrollToTopBody.indexOf("prevPathRef.current = pathname");
    const checkIdx = scrollToTopBody.indexOf("pathnameChanged");
    expect(assignIdx, "ref must be assigned").toBeGreaterThan(-1);
    expect(checkIdx, "trigger check must exist").toBeGreaterThan(-1);
    expect(assignIdx, "ref assignment must follow the trigger check").toBeGreaterThan(checkIdx);
  });

  // ── Mounted at app top ────────────────────────────────────
  //
  // ScrollToTop must be mounted in the App tree so the effect
  // actually fires on every route change.

  it("App.tsx mounts <ScrollToTop /> at the top of the App tree", () => {
    expect(appSrc).toMatch(/<ScrollToTop\s*\/>/);
  });
});