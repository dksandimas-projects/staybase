// A source-text helper that strips comments has a trap.
//
// Per OCT-L7 (2026-10-20, decision #307): the repo's `stripComments` /
// `codeOnly` helpers used to remove BLOCK comments first and line
// comments second:
//
//   src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
//
// A `//` comment may legitimately contain `/*` — the codebase says
// `bookings/*` and `bookings/*/otherAddOnAudit/*` all over the place,
// because that is how Firestore subcollection paths are written. The
// block-strip regex sees that `/*` as a BLOCK OPENER and pairs it with
// the next `*/` in the file, swallowing everything in between.
//
// The failure is silent and poisonous:
//
//   1. The swallowed region is REAL CODE, so every source-text pin
//      inside it becomes vacuous — the test passes while asserting
//      nothing.
//   2. A pin placed in the swallowed region FAILS for a reason the
//      author cannot see.
//
// This file pins the fix: wherever a test helper strips BOTH kinds of
// comment, it must strip the LINE comments first, and it must use the
// `[^:]`-guarded line regex so a URL (`https://…`) inside a string is
// not mistaken for a comment.
//
// A helper that strips only blocks, or only lines, is fine — it has
// no ordering to get wrong.
//
// The tripwire walks the test files, finds every comment-strip helper,
// and asserts the ordering inside it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, execSync } from "node:child_process";

const repoRoot = resolve(__dirname, "../../..");

function listTestFiles(): string[] {
  // Use `execFileSync` with an argument ARRAY, not a shell command string.
  // The pathspecs used to be single-quoted inside an `execSync` string,
  // which only works where the shell strips single quotes. On Windows
  // `cmd.exe` passes the quotes through literally, so the pathspecs
  // matched NOTHING and this tripwire policed zero helpers — its
  // ordering assertions "passed" while asserting nothing, which is
  // exactly the failure mode this file exists to prevent. Passing the
  // pathspecs as separate argv entries removes the shell entirely.
  const out = execFileSync(
    "git",
    ["ls-files", "*__tests__/*.ts", "*tests/api/*.ts"],
    {
      cwd: repoRoot,
      encoding: "utf-8"
    }
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Every `.replace(/<pattern>/<flags>, …)` call in the source, with the
 * pattern's RAW text captured.
 *
 * The pattern body allows escaped slashes (`\/`) so a regex literal
 * like `/\/\*[\s\S]*?\*\//g` is captured whole.
 */
const REPLACE_CALL = /\.replace\(\s*\/((?:[^/\n]|\\\/)*)\/[gimsuy]*,/g;

/**
 * Classify a captured pattern body.
 *
 *   • BLOCK strip — the raw text contains the escaped star-slash
 *     sequence (the escaped form of a block-comment terminator).
 *   • LINE  strip — the raw text contains the escaped double-slash
 *     and is not a block strip.
 */
function classify(body: string): "block" | "line" | null {
  if (body.includes("\\*\\/")) return "block";
  if (body.includes("\\/\\/")) return "line";
  return null;
}

/**
 * Split a file into helper regions.
 *
 * A region starts at a top-level `function` / `const` / `let` / `var`
 * declaration and runs to the next blank line. The repo's helpers are
 * all short, top-level and blank-line separated, so a declaration-to-
 * blank-line window cannot span two helpers.
 */
function helperRegions(src: string): string[] {
  const regions: string[] = [];
  const declRe = /^(?:function |const |let |var )/gm;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src)) !== null) {
    const start = m.index;
    const next = src.indexOf("\n\n", start);
    const region = src.slice(start, next === -1 ? src.length : next);
    REPLACE_CALL.lastIndex = 0;
    const kinds = [...region.matchAll(REPLACE_CALL)].map((x) => classify(x[1]));
    REPLACE_CALL.lastIndex = 0;
    if (kinds.includes("block") || kinds.includes("line")) {
      regions.push(region);
    }
  }
  return regions;
}

/** The positions of the block / line strips inside one region. */
function stripsIn(region: string): { blockAt: number; lineAts: number[] } {
  REPLACE_CALL.lastIndex = 0;
  const blockAt: number[] = [];
  const lineAts: number[] = [];
  for (const m of region.matchAll(REPLACE_CALL)) {
    const kind = classify(m[1]);
    if (kind === "block") blockAt.push(m.index ?? 0);
    if (kind === "line") lineAts.push(m.index ?? 0);
  }
  REPLACE_CALL.lastIndex = 0;
  return { blockAt: blockAt[0] ?? -1, lineAts };
}

describe("OCT-L7 — the comment-strip helpers cannot swallow real code", () => {
  const files = listTestFiles();
  const offenders: string[] = [];
  const unguarded: string[] = [];
  const helpersSeen: string[] = [];

  for (const file of files) {
    const src = readFileSync(resolve(repoRoot, file), "utf-8");
    for (const region of helperRegions(src)) {
      const { blockAt, lineAts } = stripsIn(region);
      if (blockAt < 0 || lineAts.length === 0) continue; // no ordering to get wrong
      helpersSeen.push(file);
      if (Math.min(...lineAts) > blockAt) {
        offenders.push(`${file}: strips blocks before lines`);
      }
      // The line strip must be `[^:]`-guarded, or a URL inside a
      // string reads as the start of a comment.
      for (const at of lineAts) {
        const text = region.slice(at, at + 80);
        if (text.includes("[^:]")) continue;
        if (text.includes("line.replace")) continue; // the per-line `.map()` form
        unguarded.push(`${file}: ${text.split("\n")[0]}`);
      }
    }
  }

  it("found the helpers it is meant to police", () => {
    // A guard against the tripwire itself going vacuous.
    expect(helpersSeen.length).toBeGreaterThan(0);
  });

  it("no helper strips BLOCK comments before LINE comments", () => {
    // The bug: a `//` comment containing `/*` (the codebase writes
    // `bookings/*` constantly) is read as a block opener, and the next
    // `*/` in the file closes it — swallowing real code and making
    // every pin inside that window vacuous.
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("every helper that strips line comments uses the `[^:]`-guarded regex", () => {
    // Without the guard, a URL inside a string (`https://…`) is read as
    // the start of a comment and the rest of the line is deleted.
    expect([...new Set(unguarded)]).toEqual([]);
  });

  it("the codebase really does write `/*` inside `//` comments", () => {
    // If this ever stops being true the ordering rule above could be
    // relaxed — but until then the ordering must hold.
    //
    // `execFileSync` with an argument array, for the same reason as
    // `listTestFiles`: a shell string with single-quoted arguments and
    // a `| head -3` pipe only works on a POSIX shell.
    const phantom = execFileSync(
      "grep",
      [
        "-rn",
        "--include=*.ts",
        "--include=*.tsx",
        "-E",
        "^\\s*//.*\\*/",
        "guest-app/src",
        "admin-app/src",
        "shared"
      ],
      { cwd: repoRoot, encoding: "utf-8" }
    );
    expect(phantom.length).toBeGreaterThan(0);
  });
});
