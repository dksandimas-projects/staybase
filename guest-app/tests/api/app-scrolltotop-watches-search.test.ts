import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the booking flow scroll bug:
//
// The booking flow at `/book` advances steps via the `?step=` search param
// (e.g. `?step=guest-details` → `?step=review`) without changing the
// pathname. The pre-fix `ScrollToTop` component in `guest-app/src/App.tsx`
// only watched `pathname` from `useLocation()`, so advancing a step left
// the viewport pinned at the previous step's scroll offset — confusing on
// long forms where the next step's primary CTA sits at the top of the new
// view. The same shape applied to `/corporate/book` (gate → details →
// review → confirm) and any future step-driven single-page flow.
//
// The fix: destructure `search` from `useLocation()` and add it to the
// `useEffect` dep array so the effect fires on every URL change,
// including pure search-param changes. This test pins the contract at the
// source level so a future refactor that drops `search` from the deps is
// caught instead of silently regressing.

describe("App.tsx — ScrollToTop watches pathname AND search", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/App.tsx"),
    "utf8"
  );

  // Scope regexes to the ScrollToTop function body — `useLocation()`
  // appears twice in the file (once at the import, once inside the
  // function). Anchoring at the function declaration skips the import.
  const scrollToTopBody = (() => {
    const start = src.indexOf("export function ScrollToTop()");
    if (start < 0) return "";
    const end = src.indexOf("return null;", start);
    return end < 0 ? src.slice(start) : src.slice(start, end);
  })();

  it("ScrollToTop destructures 'search' from useLocation()", () => {
    // Tolerant of either ordering (pathname, search) or (search, pathname).
    // The destructure lives on the LHS of `useLocation()`.
    expect(scrollToTopBody).toMatch(
      /\{\s*(?:pathname\s*,\s*search|search\s*,\s*pathname)\s*\}\s*=\s*useLocation\(\)/
    );
  });

  it("ScrollToTop's scrollTo(0, 0) effect lists 'search' in the dep array", () => {
    // The useEffect block must include both `pathname` and `search` so
    // pure search-param changes (e.g. the booking step transition) also
    // reset the scroll offset. Pattern: `[pathname, search]`.
    expect(scrollToTopBody).toMatch(/useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?window\.scrollTo\(0,\s*0\)[\s\S]*?\}\s*,\s*\[pathname\s*,\s*search\]\s*\)/);
  });

  it("ScrollToTop does not regress to the old [pathname]-only dep array", () => {
    // Guard against the pre-fix shape returning.
    expect(scrollToTopBody).not.toMatch(/useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?window\.scrollTo\(0,\s*0\)[\s\S]*?\}\s*,\s*\[pathname\]\s*\)/);
  });
});