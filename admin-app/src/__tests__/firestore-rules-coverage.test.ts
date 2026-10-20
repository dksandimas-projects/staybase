import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// Per PR-AUDIT-B1/B2 (2026-10-20): the recurrence guardrail for the
// "collection ships with no rule block" defect class.
//
// Background — this is the THIRD time this class has reached a
// release candidate:
//
//   * OCT-C3 (October 2026 audit): `addOns` and `auditLogs` shipped
//     with NO rule block. The admin surface died with a
//     permission-denied behind a misleading empty state.
//   * PR-AUDIT-B1: `settings/breakfastConfig/breakfastConfigChangeLog`
//     — a SUBCOLLECTION. `match /settings/{documentId}` matches only
//     the two-segment document; Firestore rules do NOT cascade into
//     subcollections. Every change-log write was PERMISSION_DENIED
//     for every role, swallowed by a `console.warn`, so the audit
//     trail was silently lost behind a successful save toast.
//   * PR-AUDIT-B2: `vouchers` was staff-read-only, so a signed-in
//     member's read was PERMISSION_DENIED and the Spark Rewards
//     portal rendered zero vouchers.
//
// OCT-C3 was fixed for two collections but no guardrail was added, so
// the class recurred twice more. THIS FILE is the guardrail: it
// enumerates every Firestore path that client code touches and fails
// if any of them is not covered by a rule block.
//
// It runs in `npm run test:fast` (no emulator, no Java) so it gates
// every commit — deliberately NOT in `firebase/tests/`, which needs
// the Firestore emulator.

const repoRoot = resolve(__dirname, "../../..");
const firestoreRulesSrc = readFileSync(resolve(repoRoot, "firebase/firestore.rules"), "utf8");
const storageRulesSrc = readFileSync(resolve(repoRoot, "firebase/storage.rules"), "utf8");

// ── Rule parsing ────────────────────────────────────────────────────
//
// The rules file nests `match` blocks (e.g. `intercoms/{roomId}` →
// `messages/{messageId}`), so a flat regex over the file would lose
// the parent path. This walks the file with a brace counter to
// reconstruct each block's FULL root-relative path.
//
// The rules file contains no empty-object literals and no braces
// inside `allow` conditions (verified), so plain brace counting is
// unambiguous here.

type RuleBlock = {
  /** Full root-relative path, e.g. "intercoms/{roomId}/messages/{messageId}" */
  path: string;
  /** The raw match pattern of this block only. */
  pattern: string;
  /** The block body (everything up to its closing brace). */
  body: string;
};

/**
 * Extract the path pattern from a `match` line.
 *
 * Firestore delimits the pattern with the FIRST `/` after `match` and
 * the block-opening `{` — NOT with the last slash. A pattern can
 * itself contain slashes (`rooms/{roomId}`, `calls/{roomId}/{document=**}`,
 * `{path=**}/charges/{chargeId}`), so slash-pairing truncates them.
 *
 * The block brace is the LAST `{` on the line: every `{...}` segment
 * inside the pattern is closed before it.
 *
 * Returns the pattern plus the offset (relative to the line start)
 * of the block's opening brace.
 */
function readPattern(line: string): { pattern: string; braceOffset: number } | null {
  const m = line.match(/\bmatch\s+(\/[^\n]*)/);
  if (!m) return null;

  // Work inside m[1] (everything from the first slash onward).
  const rest = m[1];
  const blockBrace = rest.lastIndexOf("{");
  if (blockBrace === -1) return null;

  const raw = rest.slice(1, blockBrace).trim();
  const pattern = raw.endsWith("/") ? raw.slice(0, -1) : raw;

  // Offset of m[1] within the line.
  const restOffset = (m.index ?? 0) + m[0].length - rest.length;
  return { pattern, braceOffset: restOffset + blockBrace };
}

function parseWithDepth(src: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  type StackEntry = { kind: "match" | "plain"; pattern?: string; bodyStart?: number };
  const stack: StackEntry[] = [];
  let i = 0;

  while (i < src.length) {
    // `match` keyword → read the pattern from the current line and
    // open a block.
    if (src.startsWith("match", i) && !/[A-Za-z0-9_]/.test(src[i - 1] ?? " ")) {
      const lineEnd = src.indexOf("\n", i);
      const line = src.slice(i, lineEnd === -1 ? src.length : lineEnd);
      const parsed = readPattern(line);
      if (parsed !== null) {
        const bodyStart = i + parsed.braceOffset + 1;
        stack.push({ kind: "match", pattern: parsed.pattern, bodyStart });
        i = bodyStart;
        continue;
      }
      i += 5;
      continue;
    }

    if (src[i] === "{") {
      stack.push({ kind: "plain" });
      i++;
      continue;
    }

    if (src[i] === "}") {
      const popped = stack.pop();
      if (popped?.kind === "match" && popped.pattern !== undefined && popped.bodyStart !== undefined) {
        const ancestors = stack
          .filter((e) => e.kind === "match")
          .map((e) => e.pattern as string);
        blocks.push({
          path: [...ancestors, popped.pattern].join("/"),
          pattern: popped.pattern,
          body: src.slice(popped.bodyStart, i)
        });
      }
      i++;
      continue;
    }

    i++;
  }

  return blocks;
}

/** The outermost block is `databases/{database}/documents` — not a real path. */
function stripDatabaseRoot(path: string): string {
  return path.startsWith("databases/{database}/documents/")
    ? path.slice("databases/{database}/documents/".length)
    : path;
}

const ruleBlocks = parseWithDepth(firestoreRulesSrc).map((b) => ({
  ...b,
  path: stripDatabaseRoot(b.path)
}));

// ── Client path discovery ───────────────────────────────────────────

function listSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "dist" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const clientFiles = [
  ...listSourceFiles(resolve(repoRoot, "guest-app/src")),
  ...listSourceFiles(resolve(repoRoot, "admin-app/src"))
];

type Segment =
  | { kind: "static"; value: string }
  | { kind: "alternatives"; values: string[] }
  | { kind: "dynamic" };

type ClientPath = {
  segments: Segment[];
  /** True when the path addresses a single document (doc(db, ...)). */
  isDoc: boolean;
  file: string;
  line: number;
  source: string;
};

/**
 * Classify one argument of a Firestore path call.
 *
 * - A plain string literal → static.
 * - A ternary of string literals (`cond ? "a" : "b"`) → alternatives:
 *   the runtime value is one of a known set, so BOTH branches must be
 *   covered by a rule.
 * - Anything else (a variable, a template literal, a function call) →
 *   dynamic: the value is unknowable at analysis time.
 */
function classifyArg(arg: string): Segment {
  const trimmed = arg.trim();

  const asString = trimmed.match(/^["'`](.*)["'`]$/);
  if (asString) return { kind: "static", value: asString[1] };

  if (trimmed.includes("?")) {
    const literals = [...trimmed.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    // Only treat it as a known-set when every alternative is a plain
    // literal and none of them is a comparison operand.
    const operands = trimmed.split("?").length - 1;
    if (literals.length >= operands && literals.length >= 2) {
      return { kind: "alternatives", values: [...new Set(literals)] };
    }
  }

  return { kind: "dynamic" };
}

/** Split a call's argument list on top-level commas. */
function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let inString: string | null = null;

  for (const ch of raw) {
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current);
  return args;
}

function collectClientPaths(): ClientPath[] {
  const found: ClientPath[] = [];

  for (const file of clientFiles) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");

    lines.forEach((line, idx) => {
      // collection(db, "a", "b") / collection(db, "a")
      const collectionRe = /collection\(\s*db\s*,\s*([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = collectionRe.exec(line)) !== null) {
        found.push({
          segments: splitArgs(m[1]).map(classifyArg),
          isDoc: false,
          file,
          line: idx + 1,
          source: m[0]
        });
      }

      // doc(db, "a", id) / doc(db, "a", "b", id)
      const docRe = /doc\(\s*db\s*,\s*([^)]+)\)/g;
      while ((m = docRe.exec(line)) !== null) {
        found.push({
          segments: splitArgs(m[1]).map(classifyArg),
          isDoc: true,
          file,
          line: idx + 1,
          source: m[0]
        });
      }
    });
  }

  return found;
}

const clientPaths = collectClientPaths();

// ── Matching ────────────────────────────────────────────────────────

function isWildcard(segment: string): boolean {
  // "{fileName}", "{bookingId}", "{path=**}", "{allPaths=**}" are all
  // wildcards; "{path=**}" uses TWO stars, so `\*+` not `\*?`.
  return /^\{[A-Za-z0-9_]+(=+\*+)?\}$/.test(segment);
}

function isRecursiveWildcard(segment: string): boolean {
  // "{path=**}", "{allPaths=**}", "{document=**}" — matches zero or
  // more trailing segments.
  return /=\*+\}$/.test(segment);
}

function ruleSegmentCoversClientSegment(ruleSeg: string, clientSeg: Segment): boolean {
  if (isWildcard(ruleSeg)) return true;
  if (clientSeg.kind === "static") return ruleSeg === clientSeg.value;
  if (clientSeg.kind === "alternatives") return clientSeg.values.includes(ruleSeg);
  // The client value is unknown at analysis time. A static rule
  // segment cannot be proven to match it, but the rule may still be
  // correct (the usual case: the dynamic segment is a document id
  // and the rule's wildcard covers it). Accept — a wildcard rule
  // segment is the only PROVEN match, but rejecting static segments
  // here would flag every legitimate dynamic path.
  return true;
}

/**
 * Does this rule block apply to the document at `pathSegs`?
 *
 * A rule whose final segment is a recursive wildcard (`{document=**}`,
 * `{allPaths=**}`) matches that prefix plus ZERO OR MORE trailing
 * segments, so its length is compared as a minimum.
 */
function ruleCoversPath(rulePath: string, pathSegs: Segment[]): boolean {
  const ruleSegs = rulePath.split("/");
  const last = ruleSegs[ruleSegs.length - 1];

  if (last && isRecursiveWildcard(last)) {
    const prefix = ruleSegs.slice(0, -1);
    if (pathSegs.length < prefix.length) return false;
    return prefix.every((seg, i) => ruleSegmentCoversClientSegment(seg, pathSegs[i]));
  }

  if (ruleSegs.length !== pathSegs.length) return false;
  return ruleSegs.every((seg, i) => ruleSegmentCoversClientSegment(seg, pathSegs[i]));
}

/**
 * The path of the DOCUMENT a client collection access touches — the
 * collection path plus one document-id segment.
 */
function documentPathFor(collectionSegs: Segment[]): Segment[] {
  return [...collectionSegs, { kind: "dynamic" }];
}

function describeSegments(segments: Segment[]): string {
  return segments
    .map((s) =>
      s.kind === "static"
        ? s.value
        : s.kind === "alternatives"
          ? `(${s.values.join("|")})`
          : "?"
    )
    .join("/");
}

// ── The guardrail ───────────────────────────────────────────────────

describe("Firestore rules coverage — every client-touched path has a rule block", () => {
  it("parses the rules file into rule blocks", () => {
    expect(ruleBlocks.length).toBeGreaterThan(20);
  });

  it("finds client-side Firestore access to check", () => {
    // Sanity: the scanner must actually be finding things, otherwise
    // the coverage test below would pass vacuously.
    expect(clientPaths.length).toBeGreaterThan(40);
  });

  /**
   * A path whose ROOT collection is only known at runtime (e.g.
   * `collection(db, parentPath)`) cannot be statically verified — there
   * is no single rule block that "covers" an unknown root. Those are
   * excluded from the coverage assertion and surfaced separately so a
   * human can eyeball them.
   */
  const unverifiable = clientPaths.filter(
    (cp) => cp.segments.length > 0 && cp.segments[0].kind === "dynamic"
  );

  const uncovered = clientPaths
    .filter((cp) => !(cp.segments.length > 0 && cp.segments[0].kind === "dynamic"))
    .filter((cp) => {
      const target = cp.isDoc ? cp.segments : documentPathFor(cp.segments);
      return !ruleBlocks.some((rule) => ruleCoversPath(rule.path, target));
    });

  it("covers every client-touched Firestore path", () => {
    const report = uncovered
      .map(
        (cp) =>
          `  ${cp.file.replace(repoRoot + "/", "")}:${cp.line}  ${cp.source}` +
          `  → no rule block covers "${describeSegments(cp.segments)}"`
      )
      .join("\n");
    expect(
      uncovered.length,
      `Firestore paths touched by client code with NO covering rule block.\n` +
        `Firestore rules do NOT cascade into subcollections, so each path needs its own block:\n${report}`
    ).toBe(0);
  });

  it("has no unverifiable dynamic-root paths beyond the known set", () => {
    // A NEW dynamic-root path means a collection is being addressed by
    // a runtime string, which the coverage check cannot verify. Keep
    // the count pinned so the set is reviewed rather than silently
    // growing.
    const report = unverifiable
      .map((cp) => `  ${cp.file.replace(repoRoot + "/", "")}:${cp.line}  ${cp.source}`)
      .join("\n");
    expect(unverifiable.length, `Unverifiable dynamic-root paths:\n${report}`).toBeLessThanOrEqual(2);
  });
});

describe("Firestore rules coverage — collection-group access is covered", () => {
  const groupSegments = new Set<string>();
  for (const file of clientFiles) {
    const src = readFileSync(file, "utf8");
    const re = /collectionGroup\(\s*db\s*,\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) groupSegments.add(m[1]);
  }

  it("finds collection-group reads in client code", () => {
    expect(groupSegments.size).toBeGreaterThan(0);
  });

  for (const group of groupSegments) {
    it(`has a collection-group rule for "${group}"`, () => {
      const covered = ruleBlocks.some((rule) => {
        const segs = rule.path.split("/");
        const wildcardIdx = segs.findIndex((s) => /=\*+\}$/.test(s));
        // A `{path=**}/{group}/{doc}` block covers the group anywhere
        // in the tree.
        if (wildcardIdx !== -1) {
          return segs[wildcardIdx + 1] === group && isWildcard(segs[wildcardIdx + 2] ?? "");
        }
        // A top-level `{group}/{doc}` block covers the group's direct
        // children — enough for a collection group whose documents
        // live directly in it (e.g. `callSessions/{sessionToken}`).
        return segs.length === 2 && segs[0] === group && isWildcard(segs[1]);
      });
      expect(
        covered,
        `No collection-group rule covers "${group}". ` +
          `Expected a block like match /{path=**}/${group}/{...} or match /${group}/{...}.`
      ).toBe(true);
    });
  }
});

// ── Targeted regressions for the findings this file exists to prevent ──

describe("Firestore rules — regression pins for the PR-AUDIT findings", () => {
  it("B1: settings/breakfastConfigChangeLog has its own rule block", () => {
    // `match /settings/{documentId}` alone does NOT cover the
    // subcollection — this is the whole point of B1.
    expect(firestoreRulesSrc).toMatch(
      /match \/settings\/\{[A-Za-z]+\}\/breakfastConfigChangeLog\/\{[A-Za-z]+\}\s*\{/
    );
  });

  it("B2: vouchers lets a member read their OWN vouchers", () => {
    const block = ruleBlocks.find((r) => r.pattern === "vouchers/{voucherId}");
    expect(block, "expected a match /vouchers/{voucherId}/ block").toBeTruthy();
    expect(block!.body).toMatch(/allow read:[\s\S]*isStaff\(\)/);
    expect(block!.body).toMatch(/resource\.data\.memberId\s*==\s*request\.auth\.uid/);
  });

  it("B3: intercom messages are NOT world-readable", () => {
    const block = ruleBlocks.find((r) => r.path === "intercoms/{roomId}/messages/{messageId}");
    expect(block, "expected a match for intercoms/.../messages/...").toBeTruthy();
    expect(block!.body).not.toMatch(/allow read:\s*if true/);
  });

  it("B4: call signaling is not publicly readable/writable", () => {
    const block = ruleBlocks.find((r) => r.pattern.startsWith("calls/{roomId}"));
    expect(block, "expected a match for calls/{roomId}/...").toBeTruthy();
    expect(block!.body).not.toMatch(/allow read, write:\s*if true/);
  });

  it("B5: the intercom document is not publicly writable", () => {
    const block = ruleBlocks.find((r) => r.path === "intercoms/{roomId}");
    expect(block, "expected a match /intercoms/{roomId}/ block").toBeTruthy();
    expect(block!.body).not.toMatch(/allow read, create, update:\s*if true/);
  });
});

describe("Storage rules — guest upload paths are bounded", () => {
  const guestWritablePaths = [
    "bookings/{bookingId}/payment-proof/{fileName}",
    "bookings/{bookingId}/discount-id/{fileName}",
    "store-orders/{roomNumber}/payment-proof/{fileName}"
  ];

  for (const path of guestWritablePaths) {
    it(`bounds ${path} by size and content type`, () => {
      const escaped = path.replace(/[{}*]/g, (c) => `\\${c}`);
      const re = new RegExp(`match\\s+/${escaped}\\s*\\{[\\s\\S]*?\\n\\s*\\}`);
      const block = storageRulesSrc.match(re);
      expect(block, `expected match /${path}/ block`).toBeTruthy();
      expect(block![0]).not.toMatch(/allow write:\s*if true;/);
      expect(block![0]).toMatch(/request\.resource\.size\s*<\s*5 \* 1024 \* 1024/);
      expect(block![0]).toMatch(/request\.resource\.contentType\s+in\s+\[/);
    });
  }
});
