// AI-BROWSER-QA (2026-10-26) — scope reconciliation GATE.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// `plan/project/QA-REPORT-2026-10-23.md` closed as "no findings remain open".
// That verdict was true INSIDE the scope of its own scenario catalogue
// (`QA-SCENARIOS.md`, 108 ids) — but `plan/project/HANDOFF-2026-10-23.md` §6
// ("Still to do — Waves 2–5 of 'please fix all'") carried a SEPARATE list of
// ~27 defects confirmed against production, and 25 of those ids appeared
// NOWHERE in the report. Two of them were live money-permission holes in the
// deployed code. Nothing reconciled the two lists.
//
// A report scoped to its own catalogue will never contain defects tracked
// under a different id-prefix in a different document, and its closing
// verdict is scoped exactly as narrowly as its catalogue. THIS is the
// reconciliation, and it is a GATE, not a report.
//
// WHAT IT CHECKS
//   For every defect id in HANDOFF §6 (the sibling backlog):
//     (a) the id appears in the report text (whole word, case-insensitive)
//         → ACCOUNTED (the report covers it)
//     (b) the id appears in the reconciliation document
//         (`QA-BACKLOG-2026-10-26.md`) in a table row whose SECOND cell —
//         the reason/description — is NON-EMPTY
//         → ACCOUNTED (it is explicitly marked, with a reason)
//     otherwise
//         → MISSING → the gate FAILS (exit 1)
//   A reconciliation row that exists but whose reason cell is EMPTY does
//   NOT count as accounted for: "out of scope" has to be written down.
//
// READ-ONLY. It writes nothing and prints a verdict.
//
// USAGE
//   npx esbuild scripts/qa/verify-scope.ts --bundle --platform=node \
//     --format=esm --outfile=tmp/qa/verify-scope.mjs
//   node tmp/qa/verify-scope.mjs
//
//   Point it at other documents with env vars or flags:
//     QA_REPORT_FILE=… QA_HANDOFF_FILE=… QA_RECONCILIATION_FILE=… node tmp/qa/verify-scope.mjs
//     node tmp/qa/verify-scope.mjs --report=… --handoff=… --reconciliation=…
//
// The decision logic below is PURE and exported, so it can be unit-tested
// without touching the filesystem (`scripts/qa/__tests__/verify-scope.test.ts`).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

/**
 * A defect id: `SEC-2`, `RPT-18`, `F-A6`, `F-C3`, `NO-ID-A67`, `SR-05`, `H8`.
 *
 * The shape is deliberately narrow so the gate never mistakes a table cell
 * for an id. It rejects `—`, `§3.7 rules`, `booking-confirmed`, `Wave 2`,
 * `HANDOFF-2026-10-23.md` and ordinary prose. The id must additionally
 * carry at least one digit (the pattern already demands one).
 */
export const DEFECT_ID_PATTERN = /^[A-Z][A-Z0-9-]*[0-9][A-Za-z]?$/;

export interface ReconciliationRow {
  id: string;
  reason: string;
}

export interface ScopeReconciliationInput {
  reportText: string;
  siblingIds: string[];
  reconciliationRows: ReconciliationRow[];
}

export type ScopeStatus = "accounted-by-report" | "accounted-by-reconciliation" | "missing";

export interface ScopeReconciliationDetail {
  id: string;
  status: ScopeStatus;
  note: string;
}

export interface ScopeReconciliationResult {
  /** Sibling ids that are accounted for (by the report or by the reconciliation). */
  accounted: string[];
  /** Sibling ids that are accounted for by NEITHER — the gate fails on these. */
  missing: string[];
  /** One human-readable line per missing id (empty when nothing is missing). */
  problems: string[];
  /** Structural advisories (empty extraction, empty reason cells, …). */
  advisories: string[];
  /** Per-id breakdown, for the CLI's table. */
  detail: ScopeReconciliationDetail[];
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

/** Strip markdown emphasis and code ticks, then trim. */
function stripEmphasis(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .trim();
}

/** Is this cell an id we should track? */
export function isDefectId(value: string): boolean {
  const id = stripEmphasis(value);
  if (!DEFECT_ID_PATTERN.test(id)) return false;
  return /\d/.test(id);
}

/**
 * Split a markdown table row into its cells, ignoring ESCAPED pipes (`\|`).
 * A row that does not start with `|` is not a table row at all.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  const body = trimmed.replace(/^\|/, "").replace(/(?<!\\)\|\s*$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The body of one `##` section, exclusive of the heading itself and of the
 * next `##` heading. Returns "" when the heading is not found.
 */
function sliceSection(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** The section of the handoff that carries the sibling backlog. */
export const HANDOFF_SECTION = 6;

/**
 * The defect ids of the SIBLING backlog: the first cell of every table row
 * in HANDOFF §6 only. Rows whose first cell is not an id (`—`, `§3.7 rules`,
 * `booking-confirmed`, …) are ignored, as is the Wave-5 checklist (it is not
 * a table). First-seen order is preserved and duplicates are dropped.
 */
export function extractSiblingIds(handoffText: string): string[] {
  const heading = new RegExp(`^##\\s+${HANDOFF_SECTION}\\.\\s`);
  const body = sliceSection(handoffText, heading);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split("\n")) {
    const cells = splitRow(line);
    if (cells.length === 0) continue;
    const first = cells[0];
    if (!isDefectId(first)) continue;
    const id = stripEmphasis(first);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The reconciliation rows: every table row of the reconciliation document
 * whose first cell is a defect id, paired with its SECOND cell (the
 * reason/description). The reason is kept verbatim — emptiness is decided by
 * `hasReason`, so a row with an empty reason cell is still returned (and
 * still does NOT count as accounted for).
 *
 * A repeated id is merged: the first NON-EMPTY reason wins.
 */
export function extractReconciliationRows(reconciliationText: string): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];
  const index = new Map<string, number>();
  for (const line of reconciliationText.split("\n")) {
    const cells = splitRow(line);
    if (cells.length === 0) continue;
    const first = cells[0];
    if (!isDefectId(first)) continue;
    const id = stripEmphasis(first);
    const reason = cells.length > 1 ? cells[1].trim() : "";
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, rows.length);
      rows.push({ id, reason });
    } else if (!hasReason(rows[at].reason) && hasReason(reason)) {
      rows[at] = { id, reason };
    }
  }
  return rows;
}

/**
 * Does this reason cell actually say something? An empty cell — or a cell
 * that only holds a dash placeholder — is not a reason, so an id marked
 * "out of scope" with no explanation is still MISSING.
 */
export function hasReason(reason: string): boolean {
  const text = stripEmphasis(reason);
  if (!text) return false;
  if (/^[-–—]+$/.test(text)) return false;
  return true;
}

/** Whole-word, case-insensitive search of the report for an id. */
export function reportMentionsId(reportText: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(reportText);
}

/**
 * THE GATE. Pure: same input, same output, no filesystem, no clock.
 *
 * A sibling id is accounted for when it is in the report, or when the
 * reconciliation marks it with a non-empty reason. Everything else is
 * missing, and missing means the gate fails.
 */
export function checkScopeReconciliation(
  input: ScopeReconciliationInput
): ScopeReconciliationResult {
  const accounted: string[] = [];
  const missing: string[] = [];
  const problems: string[] = [];
  const advisories: string[] = [];
  const detail: ScopeReconciliationDetail[] = [];

  const reconciliationById = new Map<string, ReconciliationRow>();
  for (const row of input.reconciliationRows) {
    const id = stripEmphasis(row.id).toUpperCase();
    if (!id) continue;
    const at = reconciliationById.get(id);
    if (at === undefined) {
      reconciliationById.set(id, { id: stripEmphasis(row.id), reason: row.reason ?? "" });
    } else if (!hasReason(at.reason) && hasReason(row.reason ?? "")) {
      at.reason = row.reason;
    }
  }

  const siblingIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.siblingIds) {
    const id = stripEmphasis(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    siblingIds.push(id);
  }

  if (siblingIds.length === 0) {
    advisories.push(
      `no sibling defect ids were extracted from HANDOFF §${HANDOFF_SECTION} — ` +
        `the gate would pass vacuously, so this run proves nothing`
    );
  }

  for (const id of siblingIds) {
    const row = reconciliationById.get(id.toUpperCase());
    const inReport = reportMentionsId(input.reportText, id);
    const reconciled = row !== undefined && hasReason(row.reason);

    if (inReport) {
      accounted.push(id);
      detail.push({ id, status: "accounted-by-report", note: "mentioned in the report" });
      continue;
    }
    if (reconciled) {
      accounted.push(id);
      detail.push({
        id,
        status: "accounted-by-reconciliation",
        note: `reconciled: ${collapse(row!.reason)}`,
      });
      continue;
    }
    missing.push(id);
    const note =
      row === undefined
        ? "absent from the report and absent from the reconciliation"
        : "absent from the report; the reconciliation row has an EMPTY reason cell";
    detail.push({ id, status: "missing", note });
    problems.push(`${id}: ${note}`);
  }

  for (const id of siblingIds) {
    const row = reconciliationById.get(id.toUpperCase());
    if (row !== undefined && !hasReason(row.reason)) {
      advisories.push(
        `reconciliation row "${row.id}" has an EMPTY reason cell — ` +
          `it does not count as accounted for`
      );
    }
  }

  return { accounted, missing, problems, advisories, detail };
}

/** One line, no newlines, no collapsed spaces — for the CLI table. */
function collapse(value: string): string {
  return stripEmphasis(value).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_REPORT = "plan/project/QA-REPORT-2026-10-23.md";
const DEFAULT_HANDOFF = "plan/project/HANDOFF-2026-10-23.md";
const DEFAULT_RECONCILIATION = "plan/project/QA-BACKLOG-2026-10-26.md";

function pickPath(flag: string, envName: string, fallback: string): string {
  const fromArgv = process.argv.find((a) => a.startsWith(`--${flag}=`));
  if (fromArgv) return fromArgv.slice(`--${flag}=`.length);
  return process.env[envName] || fallback;
}

/**
 * Only run the CLI when this file IS the program being executed — importing
 * the module (e.g. from a vitest test) must never read files or exit.
 */
function isDirectRun(): boolean {
  if (process.env.VITEST) return false;
  if (process.env.QA_SCOPE_NO_CLI) return false;
  const entry = process.argv[1] || "";
  return /[\\/]verify-scope(\.[cm]?[jt]s)?$/.test(entry);
}

function main(): void {
  const reportPath = pickPath("report", "QA_REPORT_FILE", DEFAULT_REPORT);
  const handoffPath = pickPath("handoff", "QA_HANDOFF_FILE", DEFAULT_HANDOFF);
  const reconciliationPath = pickPath(
    "reconciliation",
    "QA_RECONCILIATION_FILE",
    DEFAULT_RECONCILIATION
  );

  const read = (path: string): string => {
    try {
      return readFileSync(resolve(process.cwd(), path), "utf8");
    } catch (error) {
      console.error(`cannot read ${path}: ${(error as Error).message}`);
      process.exit(2);
    }
  };

  const reportText = read(reportPath);
  const handoffText = read(handoffPath);
  const reconciliationText = read(reconciliationPath);

  const siblingIds = extractSiblingIds(handoffText);
  const reconciliationRows = extractReconciliationRows(reconciliationText);
  const result = checkScopeReconciliation({ reportText, siblingIds, reconciliationRows });

  console.log("=== scope reconciliation (sibling backlog vs report) ===");
  console.log(`  handoff §${HANDOFF_SECTION} sibling ids : ${siblingIds.length}`);
  console.log(`  report                               : ${reportPath}`);
  console.log(`  reconciliation                       : ${reconciliationPath}`);
  console.log(`  reconciliation rows (id + reason)    : ${reconciliationRows.length}`);

  console.log("\n=== per-id status ===");
  const idWidth = Math.max(6, ...result.detail.map((d) => d.id.length));
  const statusWidth = Math.max(24, ...result.detail.map((d) => d.status.length));
  for (const row of result.detail) {
    const note = row.note.length > 90 ? `${row.note.slice(0, 87)}...` : row.note;
    console.log(`  ${row.id.padEnd(idWidth)}  ${row.status.padEnd(statusWidth)}  ${note}`);
  }

  const byReport = result.detail.filter((d) => d.status === "accounted-by-report").length;
  const byReconciliation = result.detail.filter(
    (d) => d.status === "accounted-by-reconciliation"
  ).length;
  console.log("\n=== summary ===");
  console.log(`  accounted by the report        : ${byReport}`);
  console.log(`  accounted by the reconciliation : ${byReconciliation}`);
  console.log(`  accounted (total)               : ${result.accounted.length}`);
  console.log(`  MISSING                         : ${result.missing.length}`);
  console.log(
    `  MISSING ids                     : ${
      result.missing.length ? result.missing.join(", ") : "(none)"
    }`
  );

  if (result.problems.length) {
    console.log("\n=== missing ===");
    for (const problem of result.problems) console.log(`  ! ${problem}`);
  }
  if (result.advisories.length) {
    console.log("\n=== advisories ===");
    for (const advisory of result.advisories) console.log(`  ~ ${advisory}`);
  }

  const vacuous = siblingIds.length === 0;
  console.log(
    `\nVERDICT: ${
      result.missing.length !== 0
        ? `${result.missing.length} sibling defect id(s) are missing from the report AND ` +
          `unreconciled: ${result.missing.join(", ")}`
        : vacuous
          ? `INCONCLUSIVE — no sibling defect ids were found in HANDOFF §${HANDOFF_SECTION}, ` +
            `so this run reconciled nothing`
          : `RECONCILED — every one of the ${siblingIds.length} sibling defect ids is accounted for ` +
            `(${byReport} in the report, ${byReconciliation} reconciled with a reason)`
    }`
  );
  process.exit(result.missing.length === 0 ? 0 : 1);
}

if (isDirectRun()) main();
