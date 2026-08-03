#!/usr/bin/env node
/**
 * Documentation audit.
 * Checks broken local MD references, per-file context budgets, always-read
 * budget, active-total warning, historical-source markers, feature metadata,
 * and historical-log headings in the active roadmap.
 *
 * Usage: node scripts/docs-audit.mjs   (or `npm run docs:audit`)
 * Exits non-zero only on deterministic violations; warns at 90% of a budget.
 * Budgets and exclusions are documented in plan/docs/CONTRIBUTING.md
 * §Documentation Budgets & Lifecycle. No git comparison base required.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `.worktrees` / `.claude` hold git worktrees checked out INSIDE the repo.
// Each contains a full copy of `plan/`, so without these the audit walks
// every branch's docs at once: measured from the main checkout on
// 2026-08-02 that reported 250 files, ~1.2M tokens and 31 "broken
// reference" errors that were really just cross-worktree paths. The audit
// must describe THIS checkout only, or it reports garbage from whichever
// directory it happens to be run in.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".vercel", ".firebase",
  ".worktrees", ".claude"
]);

// Historical / generated / template sources — excluded from active totals and budgets.
// Markers inside them are still verified.
function isExcluded(rel) {
  return (
    rel.startsWith("plan/project/archive/") ||
    rel.startsWith("plan/stitch/") ||
    /^plan\/project\/AUDIT-/.test(rel) ||
    rel === "plan/project/AI-MD-SYSTEM-PROMPT.md" ||
    rel === "plan/project/context/spark-inn-MD-PLAN.md"
  );
}

// Estimated tokens ≈ chars / 4. Ceilings per CONTRIBUTING.md.
// Ratchet exceptions: known-oversized pre-existing contract docs get a ceiling
// just above their current size so any FURTHER growth fails. Compact them back
// under the standard ceiling the next time the feature is materially touched.
const FILE_BUDGETS = [
  { match: (r) => r === "CLAUDE.md", ceiling: 5000, label: "agent entry" },
  { match: (r) => r === "plan/project/ROADMAP.md", ceiling: 6000, label: "roadmap (elevated pre-launch; re-tighten to 3000 after launch)" },
  { match: (r) => r === "plan/project/context/spark-inn-MASTER-CONTEXT.md", ceiling: 5000, label: "master context" },
  { match: (r) => r === "plan/features/ADMIN-MOBILE.md", ceiling: 10500, label: "ratchet — compact toward 8000 on next touch", ratchet: true },
  { match: (r) => r === "plan/features/SETTINGS.md", ceiling: 9000, label: "ratchet — compact toward 8000 on next touch", ratchet: true },
  { match: (r) => r === "plan/docs/BACKEND.md", ceiling: 12500, label: "ratchet — grew for PRC/UCO/ETR schema sync 2026-07-17; compact toward 10000 on next touch", ratchet: true },
  { match: (r) => r.startsWith("plan/features/"), ceiling: 8000, label: "feature spec" },
  { match: (r) => r.startsWith("plan/docs/"), ceiling: 10000, label: "domain doc" }
];
const ALWAYS_READ = ["CLAUDE.md", "plan/docs/GOTCHAS.md"];
const ALWAYS_READ_CEILING = 10000;
// Ratchet, set 2026-08-02. The previous 120,000 target was written on
// 2026-07-17 in the same commit that introduced this script, when the
// active corpus already measured ~212,000 — so it warned on every run
// from day one and never signalled anything. The corpus today is
// slightly SMALLER than it was then, which is the opposite of the
// regression the warning implied.
//
// This is the same ratchet pattern CONTRIBUTING.md already applies to
// oversized per-file docs: set the ceiling just above current size so
// further GROWTH fails while the existing body of specification passes.
// Lower it deliberately when a restructure actually reduces the corpus;
// do not raise it to accommodate growth without a compaction review.
const ACTIVE_TOTAL_WARN = 230000;

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

const allFiles = walk(repoRoot).map((p) => relative(repoRoot, p).split(sep).join("/"));
const activeFiles = allFiles.filter((r) => !isExcluded(r));

// ---- 1. Broken local references (markdown links + backtick repo paths) ----
// Historical/generated sources are excluded: their text is preserved as
// written and may reference files that have since moved.
for (const rel of activeFiles) {
  const text = readFileSync(resolve(repoRoot, rel), "utf8");
  const refs = new Set();
  for (const m of text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    if (!/^https?:/.test(m[1])) refs.add(m[1]);
  }
  for (const m of text.matchAll(/`((?:plan|guest-app|admin-app|shared|firebase|scripts|api)\/[A-Za-z0-9._\/-]+\.md)/g)) {
    refs.add(m[1]);
  }
  for (const ref of refs) {
    if (/[*{}[\]]/.test(ref)) continue; // globs / brace shorthand, not real paths
    const candidates = [resolve(repoRoot, dirname(rel), ref), resolve(repoRoot, ref)];
    if (!candidates.some((c) => existsSync(c))) {
      errors.push(`broken reference: ${rel} -> ${ref}`);
    }
  }
}

// ---- 2. Per-file budgets (active docs only) ----
function tokens(rel) {
  return Math.round(statSync(resolve(repoRoot, rel)).size / 4);
}
for (const rel of activeFiles) {
  const budget = FILE_BUDGETS.find((b) => b.match(rel));
  if (!budget) continue;
  const t = tokens(rel);
  if (t > budget.ceiling) errors.push(`over budget: ${rel} ~${t} tokens (ceiling ${budget.ceiling}, ${budget.label})`);
  // Ratchet ceilings sit just above current size by design — only growth matters
  else if (!budget.ratchet && t >= budget.ceiling * 0.9) warnings.push(`near budget (90%): ${rel} ~${t} of ${budget.ceiling} tokens`);
}

// ---- 3. Combined always-read budget ----
const alwaysReadTotal = ALWAYS_READ.reduce((sum, rel) => sum + tokens(rel), 0);
if (alwaysReadTotal > ALWAYS_READ_CEILING) {
  errors.push(`always-read bundle ~${alwaysReadTotal} tokens exceeds ${ALWAYS_READ_CEILING} (${ALWAYS_READ.join(" + ")})`);
} else if (alwaysReadTotal >= ALWAYS_READ_CEILING * 0.9) {
  warnings.push(`always-read bundle at ~${alwaysReadTotal} of ${ALWAYS_READ_CEILING} tokens`);
}

// ---- 4. Active total ----
const activeTotal = activeFiles.reduce((sum, rel) => sum + tokens(rel), 0);
if (activeTotal > ACTIVE_TOTAL_WARN) {
  warnings.push(`active MD system ~${activeTotal} tokens (warn threshold ${ACTIVE_TOTAL_WARN}) — schedule a compaction review (CONTRIBUTING.md §Review triggers)`);
}

// ---- 5. Historical-source markers ----
for (const rel of allFiles) {
  const text = readFileSync(resolve(repoRoot, rel), "utf8");
  if (rel.startsWith("plan/project/archive/") && !text.includes("HISTORICAL ARCHIVE")) {
    errors.push(`missing HISTORICAL ARCHIVE marker: ${rel}`);
  }
  if (/^plan\/project\/AUDIT-/.test(rel) && !text.includes("HISTORICAL AUDIT")) {
    errors.push(`missing HISTORICAL AUDIT marker: ${rel}`);
  }
}

// ---- 6. Feature metadata ----
for (const rel of activeFiles) {
  if (!rel.startsWith("plan/features/")) continue;
  const text = readFileSync(resolve(repoRoot, rel), "utf8");
  if (!/^> Requires:/m.test(text)) errors.push(`missing "> Requires:" header: ${rel}`);
}

// ---- 7. Historical-log headings inside the active roadmap ----
{
  const roadmap = readFileSync(resolve(repoRoot, "plan/project/ROADMAP.md"), "utf8");
  const badHeadings = roadmap
    .split("\n")
    .filter((l) => /^#{2,3} /.test(l) && (/Batch \d+/.test(l) || /post-ship review/i.test(l) || /all closed\)/i.test(l)));
  for (const h of badHeadings) {
    errors.push(`historical-log heading in active ROADMAP.md (move detail to the archive): "${h.trim()}"`);
  }
}

// ---- Report ----
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✗ ${e}`);
console.log(
  `docs-audit: ${activeFiles.length} active MD files, ~${activeTotal} est. tokens (always-read ~${alwaysReadTotal}) — ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`
);
process.exit(errors.length > 0 ? 1 : 0);
