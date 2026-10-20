import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per the React #310 found live on stg /book (2026-10-16):
// `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef` were being
// called AFTER the loading-skeleton early return in BookingPage. On
// the first render `isScreenLoading` is true and the early return
// fires, so those hooks were skipped. On the second render — after
// the availability fetch resolved or failed — the early return was
// bypassed and React saw more hooks than the previous render, which
// crashes the whole tree.
//
// The structural rule that prevents this is simple and is now
// asserted as a source-text regression net: NO useX call may appear
// between the loading-skeleton early-return block and the next return
// of BookingPage's body. The block is identified by its distinctive
// JSX ("Checking room availability..."), and the entire BookingPage
// body up to the final return is scanned.

const repoRoot = resolve(__dirname, "../../..");

const booking = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);

/** Source with comments removed, so absence-assertions cannot be
 *  defeated by a comment that documents a moved hook. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const code = codeOnly(booking);

describe("fix(booking): no hook may be called after the loading-skeleton early return", () => {
  // Anchor: the loading-skeleton block. Anything between this and
  // the next `return` is the danger zone.
  const loadingStart = booking.indexOf("if (isScreenLoading) {");
  expect(loadingStart, "loading-skeleton early return must exist").toBeGreaterThan(-1);

  // Find the matching `}` that closes the early return. A naive
  // search for the next `return` after the early return is enough
  // for this regression net, because the loading block is a
  // self-contained JSX expression with no other returns inside it.
  const nextReturnAfterLoading = booking.indexOf(
    "\n  return bookingShell(",
    loadingStart
  );
  expect(nextReturnAfterLoading, "next bookingShell return must exist").toBeGreaterThan(loadingStart);

  const dangerZone = booking.slice(loadingStart, nextReturnAfterLoading);
  // Sanity: the zone should NOT contain the early return itself.
  // (It does, by construction. We're testing the part AFTER it.)
  // Re-anchor: skip past the `}` of the loading block.
  const loadingBlockEnd = dangerZone.indexOf("\n  }");
  expect(loadingBlockEnd, "loading block must close before the next return").toBeGreaterThan(-1);
  const afterLoading = dangerZone.slice(loadingBlockEnd);

  it("contains no useState / useEffect / useMemo / useCallback / useRef", () => {
    const hookCall = /\buse(State|Effect|Memo|Callback|Ref|TurnstileToken)\s*\(/;
    expect(afterLoading).not.toMatch(hookCall);
  });

  it("the breakfastCopyNotice useState is now declared BEFORE the loading early return", () => {
    // The bug was that this useState was 16 lines BELOW the early
    // return. It must now sit above it.
    //
    // Per OCT-M8 (decision #294) the notice's type argument changed
    // from `string` to `{ date, message } | null`. The anchor is the
    // declaration, so this net survives that shape change.
    const noticeIdx = code.indexOf(
      "const [breakfastCopyNotice, setBreakfastCopyNotice] = useState<"
    );
    const earlyReturnIdx = code.indexOf("if (isScreenLoading) {");
    expect(noticeIdx, "breakfastCopyNotice useState must exist").toBeGreaterThan(-1);
    expect(earlyReturnIdx, "loading early return must exist").toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(earlyReturnIdx);
  });

  it("the loading-skeleton early return is still in place", () => {
    expect(code).toContain("if (isScreenLoading) {");
    expect(code).toContain("Checking room availability...");
  });

  it("the comment that documents the load-bearing rule is present", () => {
    // The fix added a long comment explaining why every useState
    // must sit above this early return. If a future cleanup deletes
    // the comment, the rule will become invisible — and someone
    // will eventually move a hook below the return. The regression
    // net fails so the deletion is deliberate, not silent.
    expect(booking, "must be in raw source (comments are stripped from `code`)").toContain("REACT HOOKS RULE");
    expect(booking).toContain("breakfastCopyNotice");
  });
});

describe("fix(booking): the wider BookingPage hook-order invariant", () => {
  // A stronger guard against the same class of bug reappearing
  // elsewhere: every top-level `useX` call in BookingPage must be
  // reachable from the FIRST render (i.e. not behind any early
  // `return`). The simplest accurate check is "no useX at a brace
  // depth that comes AFTER a depth-1 return" — which is exactly the
  // brace-aware scan that initially missed this bug because the
  // scan treated the destructure of a custom hook as a new scope.
  // Now that we know the failure mode, we assert the specific
  // pattern instead.

  it("no useX call appears after a top-level `return` inside the BookingPage body", () => {
    // Find the function start and slice from there to the next
    // top-level closing brace. Within that slice, no `return` at
    // depth 1 may be followed by a `useX` at depth 1.
    const fnStart = booking.indexOf("export function BookingPage(");
    expect(fnStart).toBeGreaterThan(-1);
    // crude "end of function" — find the next function definition
    // or end-of-file after fnStart.
    const body = booking.slice(fnStart);
    const reReturn = /^\s*return\b/m;
    const reHook = /\buse(State|Effect|Memo|Callback|Ref|TurnstileToken)\s*\(/;

    const lines = body.split("\n");
    let depth = 0;
    let returnedAtDepth1 = false;
    const hits = [];
    let fnDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const before = depth;
      depth += line.split("{").length - line.split("}").length;
      if (fnDepth === 0 && line.includes("{")) fnDepth = depth;
      if (fnDepth > 0 && depth < fnDepth) break; // function body ended
      if (before === fnDepth) {
        if (reReturn.test(line)) {
          returnedAtDepth1 = true;
        } else if (returnedAtDepth1 && reHook.test(line) && !line.trim().startsWith("//")) {
          hits.push({ line: i + 1, src: line.trim().slice(0, 80) });
        }
      }
    }
    if (hits.length) {
      for (const h of hits) {
        console.error(`  L${h.line}: ${h.src}`);
      }
    }
    expect(hits).toEqual([]);
  });
});