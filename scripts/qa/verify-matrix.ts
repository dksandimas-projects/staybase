// AI-BROWSER-QA (2026-10-23) — verify the report's scenario coverage matrix.
//
// Two things are checked, mechanically, against the source files:
//
//   1. COMPLETENESS — every scenario ID defined in
//      `plan/project/QA-SCENARIOS.md` appears exactly once as a row in
//      the matrix in `plan/project/QA-REPORT-2026-10-23.md`, and every
//      ID in the matrix is defined in the catalogue (except the
//      cross-cutting checks the report labels itself).
//   2. ARITHMETIC — the counts in the §7.15 summary table match the
//      number of rows actually carrying each status.
//
// READ-ONLY. It writes nothing and prints a verdict.

import { readFileSync } from "node:fs";

const CATALOGUE = "plan/project/QA-SCENARIOS.md";
const REPORT = "plan/project/QA-REPORT-2026-10-23.md";

/** Every heading that defines a scenario: `### BF-01 — title` etc. */
const catalogueIds = new Set<string>();
for (const line of readFileSync(CATALOGUE, "utf8").split("\n")) {
  const m = line.match(/^#{2,5}\s+([A-Z]{2,6}-[0-9]+[a-z]?)\b/);
  if (m) catalogueIds.add(m[1]);
}

// The matrix rows: a table row whose FIRST cell is an ID.
const reportText = readFileSync(REPORT, "utf8");
const matrixStart = reportText.indexOf("## 7. Scenario coverage matrix");
const matrixEnd = reportText.indexOf("## 8. Non-browser checks");
const matrix = reportText.slice(matrixStart, matrixEnd === -1 ? undefined : matrixEnd);
const summaryStart = matrix.indexOf("### 7.15 Matrix summary");
const matrixBody = matrix.slice(0, summaryStart === -1 ? undefined : summaryStart);

/** A matrix row: `| ID | scenario | status | evidence |`. */
const rows: { id: string; status: string }[] = [];
for (const line of matrixBody.split("\n")) {
  if (!line.trim().startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 4) continue;
  const id = cells[1].replace(/\*\*/g, "").trim();
  if (!/^[A-Z]{2,6}-[0-9]+[a-z]?$/.test(id)) continue;
  // The status cell may read `**PASS**`, `**PASS** (data)`, `**FAIL (minor)**`,
  // `**PARTIAL / FAIL**` … — take the leading token(s) inside the emphasis.
  const statusCell = cells[3];
  const emphasised = statusCell.match(/\*\*([^*]+)\*\*/);
  const status = (emphasised ? emphasised[1] : statusCell).trim();
  rows.push({ id, status });
}

// The cross-cutting checks the report labels itself (they have no
// catalogue heading — the catalogue's §11 lists seven unnamed checks).
const crossCutting = new Set(
  [...matrix.matchAll(/^\|\s*(XCC-\d+)\s*\|/gm)].map((m) => m[1])
);

const seen = new Map<string, number>();
for (const r of rows) seen.set(r.id, (seen.get(r.id) || 0) + 1);

const missing = [...catalogueIds].filter((id) => !seen.has(id));
const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);
const extra = [...seen.keys()].filter((id) => !catalogueIds.has(id) && !crossCutting.has(id));

console.log("=== matrix completeness ===");
console.log(`  catalogue scenario IDs        : ${catalogueIds.size}`);
console.log(`  cross-cutting checks (report) : ${crossCutting.size} [${[...crossCutting].join(", ")}]`);
console.log(`  matrix rows parsed            : ${rows.length}`);
console.log(`  unique matrix IDs             : ${seen.size}`);
console.log(`  MISSING from the matrix       : ${missing.length ? missing.join(", ") : "(none)"}`);
console.log(`  DUPLICATED rows               : ${duplicates.length ? duplicates.join(", ") : "(none)"}`);
console.log(`  in the matrix but not in the catalogue: ${extra.length ? extra.join(", ") : "(none)"}`);

// The summary table's own counts.
const summary = matrix.slice(summaryStart);
const normalise = (value: string) =>
  value
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** The leading status of a cell like "PARTIAL / FAIL" → "PARTIAL". */
const leading = (value: string) => {
  const t = normalise(value);
  if (t === "N/A") return "N/A";
  const i = t.indexOf(" / ");
  return (i === -1 ? t : t.slice(0, i)).trim();
};

const declared = new Map<string, number>();
for (const line of summary.split("\n")) {
  if (!line.trim().startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 3) continue;
  const label = cells[1].replace(/\*\*/g, "").trim();
  const count = Number(cells[2].replace(/\*\*/g, "").trim());
  if (!/^[A-Z /()a-z]+$/.test(label) || !Number.isFinite(count)) continue;
  if (/^total$/i.test(label)) continue;
  declared.set(normalise(label), count);
}

const actual = new Map<string, number>();
for (const r of rows) {
  const key = leading(r.status);
  actual.set(key, (actual.get(key) || 0) + 1);
}

console.log("\n=== summary arithmetic ===");
let mismatch = 0;
for (const [label, count] of declared) {
  const got = actual.get(label) ?? 0;
  const ok = got === count;
  if (!ok) mismatch += 1;
  console.log(`  ${ok ? "OK  " : "DIFF"}  ${label}: declared ${count}, rows ${got}`);
}
console.log(`  status values seen in the rows: ${[...actual.keys()].sort().join(", ")}`);

const totalDeclared = [...declared.values()].reduce((a, b) => a + b, 0);
console.log(`  declared total: ${totalDeclared} · matrix rows: ${rows.length}`);

const problems = missing.length + duplicates.length + extra.length + mismatch + (totalDeclared === rows.length ? 0 : 1);
console.log(`\nVERDICT: ${problems === 0 ? "COMPLETE — every catalogue ID is present exactly once and the counts add up" : `${problems} problem(s)`}`);
process.exit(problems === 0 ? 0 : 1);
