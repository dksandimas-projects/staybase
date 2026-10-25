import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// MBUX-10 — Phase 15 close-out contract test.
//
// This file does NOT re-test MBUX-01..08 (those slices have their own
// suites). It pins the cross-cutting invariants that the slice suites
// can't reach on their own:
//
//   1. Shared shell components are used by BOTH the public booking
//      flow and the corporate booking flow — silent drift between
//      the two has been the most common kind of MBUX bug.
//   2. The hooks-rule regression net still holds everywhere the
//      pattern is non-trivial (BookingPage, CorporateBookingPage,
//      BookingConfirmPage, BookingLookupPage, ManageBreakfastPage).
//   3. The CSP permits the Google auth iframe script in ALL THREE
//      vercel.json files (the production bug found after MBUX-08,
//      and the guest-only regression found 2026-10-23: the fix
//      landed in two of three files and this assertion only
//      covered two of three, so the guest deployment stayed
//      broken in production).
//   4. VERSION and VERSION2 drift are documented; the bundle may
//      be one version behind shared/VERSION.ts and that is INTENTIONAL.
//   5. The `apis.google.com` reference in source is exactly one
//      call site (GuestAuthContext) and all three CSPs allow it.

const repoRoot = resolve(__dirname, "../../..");

const vercelRoot = readFileSync(resolve(repoRoot, "vercel.json"), "utf8");
const vercelAdmin = readFileSync(
  resolve(repoRoot, "admin-app/vercel.json"),
  "utf8"
);
const vercelGuest = readFileSync(
  resolve(repoRoot, "guest-app/vercel.json"),
  "utf8"
);
const guestAuth = readFileSync(
  resolve(repoRoot, "guest-app/src/context/GuestAuthContext.tsx"),
  "utf8"
);
const version = readFileSync(
  resolve(repoRoot, "shared/VERSION.ts"),
  "utf8"
);
const bookingPage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const corporatePage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/CorporateBookingPage.tsx"),
  "utf8"
);
const confirmPage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);

const sharedShellComponents = [
  "StepIndicator",
  "BookingStickyFooter"
];

/** Source with comments and string literals stripped, so absence
 *  assertions cannot be satisfied by a comment that names the
 *  thing that was removed. */
function codeOnly(src: string): string {
  return src
    // Per OCT-L7 (2026-10-20, decision #307): LINE comments are
    // stripped FIRST. A `//` comment may contain `/*` (the codebase
    // writes `bookings/*`), and a block-strip-first order reads that
    // as a block opener and swallows the real code that follows.
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

describe("MBUX-10 — shared shell components appear in BOTH booking flows", () => {
  for (const component of sharedShellComponents) {
    it(`guest-app BookingPage imports ${component}`, () => {
      expect(bookingPage).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${component}\\b`));
    });
    it(`guest-app CorporateBookingPage imports ${component}`, () => {
      expect(corporatePage).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${component}\\b`));
    });
  }
});

describe("MBUX-10 — Google auth iframe is configured and allowed in ALL THREE CSPs", () => {
  it("GuestAuthContext uses signInWithPopup with GoogleAuthProvider", () => {
    expect(guestAuth).toMatch(/new GoogleAuthProvider\(\)/);
    expect(guestAuth).toMatch(/signInWithPopup\(auth,\s*provider\)/);
  });

  it("every vercel.json file allows apis.google.com in script-src", () => {
    // The CSP value is a single big string with semicolon-separated
    // directives; match the host in script-src's URL list, not the
    // directive opener.
    //
    // All THREE files are asserted — the 2026-10-23 QA pass found
    // the guest deployment's CSP still missing the host even though
    // the root and admin files had it, because this assertion only
    // covered two of the three. `guest-app/vercel.json` is the file
    // that governs the GUEST deployment (www.sparkinnbohol.com),
    // the one whose sign-in page ships "Continue with Google".
    const inScriptSrc = (v: string) =>
      /script-src[^;]*https:\/\/apis\.google\.com/.test(v);
    expect(
      inScriptSrc(vercelGuest),
      "guest-app/vercel.json (the guest deployment's CSP) must allow https://apis.google.com"
    ).toBe(true);
    expect(
      inScriptSrc(vercelRoot),
      "vercel.json (the root deployment's CSP) must allow https://apis.google.com"
    ).toBe(true);
    expect(
      inScriptSrc(vercelAdmin),
      "admin-app/vercel.json (the admin deployment's CSP) must allow https://apis.google.com"
    ).toBe(true);
  });

  it("Google sign-in uses Firebase's GoogleAuthProvider + signInWithPopup in exactly one source location", () => {
    // The CSP block on https://apis.google.com is a side effect of
    // Firebase Auth's Google sign-in popup, NOT a URL that
    // application code references by name. The runtime host is
    // injected by Firebase itself when the popup opens. So the
    // test pins the *call site* instead — the one place in source
    // that triggers the auth iframe load. If Google sign-in moves
    // (or is added to admin), this assertion changes.
    const matches: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
          if (full.includes("node_modules") || full.includes("/dist/")) continue;
          const src = readFileSync(full, "utf8");
          if (/GoogleAuthProvider/.test(src) && /signInWithPopup/.test(src)) {
            matches.push(full);
          }
        }
      }
    };
    walk(resolve(repoRoot, "guest-app/src"));
    walk(resolve(repoRoot, "admin-app/src"));
    if (matches.length !== 1) {
      throw new Error(
        `expected exactly one source location that uses GoogleAuthProvider + signInWithPopup, found ${matches.length}:\n  ` +
          matches.map((m) => m.replace(repoRoot + "/", "")).join("\n  ")
      );
    }
  });
});

describe("MBUX-10 — the hooks-rule regression net applies across every page that has any", () => {
  // The fix for the React #310 on /book (76ad458) was a single
  // `useState` after a top-level early return. The wider test in
  // `fix-hooks-after-early-return.test.ts` covers BookingPage; this
  // file pins the same invariant in every other page file that has
  // a non-trivial hook surface.
  const pagesToCheck = [
    "guest-app/src/pages/BookingPage.tsx",
    "guest-app/src/pages/CorporateBookingPage.tsx",
    "guest-app/src/pages/BookingConfirmPage.tsx",
    "guest-app/src/pages/BookingLookupPage.tsx",
    "guest-app/src/pages/ManageBreakfastPage.tsx"
  ];

  for (const rel of pagesToCheck) {
    it(`${rel.split("/").pop()} — no top-level return precedes a useX call`, () => {
      const src = readFileSync(resolve(repoRoot, rel), "utf8");
      const lines = codeOnly(src).split("\n");
      const reHook = /\buse(State|Effect|Memo|Callback|Ref|TurnstileToken|SearchParams|Navigate|Nav|NavigateFunction|Params|Location|Location2|Pub|Reducer|Id|Transition|ImperativeHandle|LayoutEffect|DebugValue)\s*\(/;
      const reReturn = /^\s*return\b/;
      let braceDepth = 0;
      let fnDepth = 0;
      let returned = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const before = braceDepth;
        braceDepth += line.split("{").length - line.split("}").length;
        if (fnDepth === 0 && /^\s*(export\s+)?function\s+[A-Z]/.test(line)) {
          fnDepth = before;
        }
        if (fnDepth > 0 && braceDepth < fnDepth) break; // function body ended
        if (before === fnDepth) {
          if (reReturn.test(line)) returned = true;
          if (returned && reHook.test(line)) {
            throw new Error(
              `${rel}:${i + 1}  hook call AFTER a top-level return: ${line.trim().slice(0, 80)}`
            );
          }
        }
      }
    });
  }
});

describe("MBUX-10 — VERSION / VERSION2 drift is documented, not a bug", () => {
  it("shared/VERSION.ts is the canonical version constant", () => {
    expect(version).toMatch(/export const VERSION = "\d+\.\d+\.\d+"/);
  });

  it("the API bundle's embedded VERSION2 is never ahead of shared VERSION", () => {
    // The committed `guest-app/api/[...route].js` is built BEFORE
    // the prepare-commit-msg bump, so its embedded VERSION2 may LAG
    // by one or more versions. It must NEVER be AHEAD — a bundle
    // ahead of the source would be a real divergence bug. The exact
    // lag depends on how many commits touched shared/ or
    // guest-app/server/ since the last `npm run build:api`. A
    // deliberate rebuild at release cutover is the discipline that
    // closes the gap, not a per-commit test (env-drift would make a
    // rebuild here a 20k-line spurious diff — see plan/project/ROADMAP.md).
    const bundle = readFileSync(
      resolve(repoRoot, "guest-app/api/[...route].js"),
      "utf8"
    );
    const m = bundle.match(/VERSION2\s*=\s*"(\d+\.\d+\.\d+)"/);
    expect(m, "bundle must contain VERSION2 constant").not.toBeNull();
    const bundleVersion = m![1];
    const srcVersion = version.match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/)![1];
    const parse = (v: string) => v.split(".").map(Number);
    const [sbMaj, sbMin, sbPat] = parse(srcVersion);
    const [bbMaj, bbMin, bbPat] = parse(bundleVersion);
    const a = sbMaj * 10000 + sbMin * 100 + sbPat;
    const b = bbMaj * 10000 + bbMin * 100 + bbPat;
    expect(b, "bundle VERSION2 must not be ahead of shared VERSION")
      .toBeLessThanOrEqual(a);
  });
});

describe("MBUX-10 — the Phase 15 close-out pins stay in place", () => {
  it("the React #310 fix's load-bearing comment is still in BookingPage", () => {
    expect(bookingPage).toContain("REACT HOOKS RULE");
  });

  it("the breakfastCopyNotice useState sits above the loading early return", () => {
    // Per OCT-M8 (decision #294) the notice became a
    // `{ date, message } | null` object so it renders exactly once —
    // the anchor is the declaration itself, not the type argument, so
    // a future shape change does not silently unpin this net.
    const noticeIdx = bookingPage.indexOf(
      "const [breakfastCopyNotice, setBreakfastCopyNotice] = useState<"
    );
    const earlyReturnIdx = bookingPage.indexOf("if (isScreenLoading) {");
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(noticeIdx, "breakfastCopyNotice must precede the loading early return")
      .toBeLessThan(earlyReturnIdx);
  });

  it("MBUX-09's two refused items are still in place (audit declaration + vacant add-ons)", () => {
    // termsConsent must still exist; the corporate audit declaration
    // is a real compliance control, not a duplicate of the privacy
    // consent.
    expect(corporatePage).toMatch(/const \[termsConsent, setTermsConsent\] = useState\(false\)/);
    expect(corporatePage).toContain("I declare the travel information is correct");
    // The add-on step is still a placeholder — BR-10 consolidation was
    // vacuous here and inventing a grid would be a fake.
    expect(corporatePage).toMatch(/no add-ons available/i);
  });

  it("MBUX-08's two-state copy: cancel state is still rendered with a distinct tone", () => {
    // The fix added a `cancelled` state; this assertion is the only
    // way to confirm it didn't quietly drop.
    const src = readFileSync(
      resolve(repoRoot, "guest-app/src/utils/confirmationStatus.ts"),
      "utf8"
    );
    expect(src).toContain("cancelled");
    expect(src).toContain('"This booking was cancelled."');
  });

  it("BookingConfirmPage has no `termsConsent` (the MBUX-06 deletion stays deleted)", () => {
    // The corporate audit declaration is a different control.
    // The public privacy consent is the single value the server
    // validates, used by gate AND payload.
    expect(confirmPage).not.toMatch(/termsConsent\b/);
  });
});