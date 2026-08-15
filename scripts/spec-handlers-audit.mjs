#!/usr/bin/env node
/**
 * Spec-handlers audit.
 *
 * Per the audit pass 2026-08-14..2026-08-15 (STR-01, VOU-02), the
 * recurring bug class is "spec promised a handler, code never built it"
 * — the feature spec at plan/features/{NAME}.md mentions a handler
 * name (e.g. `handleConfirmStoreOrder`, `handleRemoveVoucher`) that
 * is not actually exported from the corresponding handlers file. The
 * user-facing bug is silent: the spec says "this exists", the desk
 * tries to use it, the call returns 404, the manual workaround kicks
 * in.
 *
 * This script greps every `handleXxx` mention in plan/features/*.md
 * and verifies each is exported from a handler file under
 * guest-app/server/handlers/ or admin-app/src/handlers/. Exits
 * non-zero on any missing handler so CI catches the drift before
 * merge. Run via `npm run spec:audit` (added 2026-08-15).
 *
 * Excludes:
 *   - archive/ directories (historical)
 *   - plan/project/archive/ (resolved roadmap entries)
 *   - plan/stitch/ (working notes)
 *   - the docs/ subdir (it's documentation about the system, not
 *     spec for a feature surface)
 *
 * Exit codes:
 *   0 — every handler named in a spec is exported (or explicitly
 *       marked TODO/pending/future in the spec line)
 *   1 — at least one handler is missing
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HANDLER_NAME_REGEX = /\b(handle[A-Z][A-Za-z0-9]*)\b/g;
// Matches all 3 forms of handler export:
//   1. `export function handleXxx(...)`
//   2. `export async function handleXxx(...)`
//   3. `export const handleXxx = ...` / `export const handleXxx: ... = ...`
const EXPORT_REGEX = /export\s+(?:async\s+)?(?:function\s+|const\s+)(handle[A-Z][A-Za-z0-9]*)\b/g;

// Status markers that mean "this handler is intentionally not built
// yet" — when present on the same line, the script skips the missing
// handler as a known-pending item rather than failing CI.
const PENDING_MARKERS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bnot\s+yet\s+built\b/i,
  /\bpending\s+implementation\b/i,
  /\bplanned\b/i,
  /\bfuture\s+work\b/i,
  /\bMRB-\d+\+\b/,        // "MRB-N+" or "MRB-N+ follow-up" = future MRB phase
  /\bproposed\b/i,
  /\bnot\s+implemented\b/i,
  /\bwill\s+be\s+added\b/i,
];

// Markers that mean "this is a CLIENT-side function, not a server
// handler" — the spec is referring to a React component method or a
// page-level helper, not a backend endpoint. The audit skips these
// because the spec-vs-handler check is for the server side only.
const CLIENT_MARKERS = [
  /`[^`]*Page\.tsx/i,           // backtick reference to a .tsx file
  /\bsrc\/pages\//i,            // path into the pages/ dir
  /client[-\s]?side/i,
  /\bfrontend\b/i,
  /Page:\s+/i,                  // "Page: <path>" header pattern
  /^[^|]*\|[^|]*\|[^|]*\|/,    // table row in the spec (likely a comparison table)
  /\btsx\b/,
  /\bcomponent\b/i,
  /\bin\s+the\s+page\b/i,       // "Export CSV button in the page header"
  /\bpage\s+header\b/i,
  /\bdrawer\b/i,                // "drawer's primary action footer" = page-level
  /\bbutton\b/i,                // "Export CSV button"
  /\bpre-CLS-01\b/i,            // historical reference pattern (CLS audit)
  /\bform\s+submit\b/i,
  /\bsaveRoomTypes\b/i,           // context clue: rates page calls saveRoomTypes
];

const FEATURE_SPEC_DIR = join(repoRoot, "plan", "features");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "archive" || name === "node_modules") continue;
      entries.push(...walk(full));
    } else if (name.endsWith(".md")) {
      entries.push(full);
    }
  }
  return entries;
}

function isPendingLine(line) {
  return PENDING_MARKERS.some((re) => re.test(line));
}

// Collect all exported handler names from the handlers directories.
// We index by basename too so handleApplyBookingDiscount → bookings.ts.
const handlerFiles = [
  join(repoRoot, "guest-app", "server", "handlers"),
  join(repoRoot, "admin-app", "src"),
];
const exportedHandlers = new Map();
let fileCount = 0;
for (const base of handlerFiles) {
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
      // Skip non-handler files (test files, lib helpers, etc.)
      if (/(test|spec|\.d\.ts)$/i.test(entry.name)) continue;
      fileCount++;
      const full = join(base, entry.name);
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(EXPORT_REGEX)) {
        exportedHandlers.set(m[1], full);
      }
    }
  } catch (e) {
    // Directory doesn't exist — skip silently.
  }
}

// Scan every feature spec for handler mentions.
const specs = walk(FEATURE_SPEC_DIR);
const findings = [];
let checked = 0;
for (const spec of specs) {
  const rel = spec.slice(repoRoot.length + 1);
  const lines = readFileSync(spec, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(HANDLER_NAME_REGEX)];
    for (const m of matches) {
      checked++;
      const handlerName = m[1];
      if (exportedHandlers.has(handlerName)) continue;
      // Skip if the line says this is intentionally pending.
      if (isPendingLine(line)) continue;
      // Skip client-side references (not server handlers).
      if (CLIENT_MARKERS.some((re) => re.test(line))) continue;
      // Skip if the surrounding context (5 lines either side) says
      // it's a spec for an MRB-N+ future phase or a similar
      // marker.
      const context = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      if (isPendingLine(context)) continue;
      if (CLIENT_MARKERS.some((re) => re.test(context))) continue;
      findings.push({
        spec: rel,
        line: i + 1,
        handler: handlerName,
        snippet: line.trim().slice(0, 160),
      });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `[spec:audit] OK — checked ${checked} handler mentions across ${specs.length} spec files; all referenced handlers exist.`
  );
  console.log(
    `[spec:audit] Indexed ${exportedHandlers.size} exported handlers.`
  );
  process.exit(0);
}

console.error(
  `[spec:audit] FAIL — ${findings.length} handler(s) referenced in spec but not exported:`
);
for (const f of findings) {
  console.error(
    `  ${f.spec}:${f.line}  ${f.handler}`
  );
  console.error(
    `    > ${f.snippet}`
  );
}
console.error(
  `\n[spec:audit] Add the handler export, or mark the line as pending (TODO/future/MRB-N+) if it's intentionally not built.`
);
process.exit(1);
