/**
 * The server typecheck gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The repo's `npm run typecheck` runs `tsc -b` over the guest app's
 * `tsconfig.json`, whose `include` is `["src", "../hotel.config.ts",
 * "../shared"]` — it does NOT include `server/`. Every handler lives
 * in `server/`, so the entire server surface was outside the
 * typecheck.
 *
 * That gap is how a fix with TWO compile errors shipped: a read
 * hoisted into the wrong branch, referencing `freshBooking` and
 * `clawbackMemberSnapshot` where neither is in scope. The tests were
 * source-text pins, so they passed. The typecheck could not see it.
 * The bundle build would have failed — but the bundle was not rebuilt
 * before the change was reviewed.
 *
 * WHAT IT DOES
 * ------------
 * It typechecks `server/` too (via `tsconfig.server-check.json`) and
 * compares the result against a COMMITTED BASELINE of the errors that
 * already exist. The gate FAILS when a NEW error appears. Fixing a
 * baseline error is always welcome — the baseline is a floor, not a
 * ceiling.
 *
 * The baseline is stored with the error's identity (file + code +
 * message), NOT its line number, so an unrelated edit that shifts a
 * line does not make the gate flap.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const GUEST_APP = resolve(process.cwd(), "guest-app");
const BASELINE_PATH = resolve(GUEST_APP, "tsconfig.server-baseline.json");
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// The TypeScript compiler that is actually installed in this repo,
// invoked as `node <typescript>/lib/tsc.js`.
//
// The `node_modules/.bin/tsc` shim is a POSIX shell script (and
// `tsc.cmd` a batch file), and neither can be spawned reliably from
// Node on every platform — `npx.cmd` under `spawnSync` on Windows
// returns a null result, and the shell shim needs a shell. Running
// the compiler's own JS entry point with the current Node binary has
// no such caveat and behaves identically everywhere.
const TSC_JS = resolve(GUEST_APP, "..", "node_modules", "typescript", "lib", "tsc.js");
if (!existsSync(TSC_JS)) {
  console.error(`The TypeScript compiler was not found at ${TSC_JS}.`);
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  [TSC_JS, "--noEmit", "-p", "tsconfig.server-check.json"],
  { cwd: GUEST_APP, encoding: "utf8", windowsHide: true }
);
const output = `${result.stdout || ""}${result.stderr || ""}`;

/**
 * Parse a tsc diagnostic into a stable identity.
 *
 * The line/column are DELIBERATELY EXCLUDED: a baseline that pins
 * line numbers makes the gate fail every time an unrelated edit moves
 * a line, and a gate that cries wolf gets ignored.
 */
function parseDiagnostics(text) {
  const out = [];
  // `path(line,col): error TSxxxx: message`
  const re = /^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s+(.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const file = m[1].replace(/\\/g, "/");
    // The file is relative to the guest-app dir; strip the prefix so
    // the identity is stable across machines.
    const rel = file.includes("guest-app/") ? file.split("guest-app/")[1] : file;
    out.push(`${rel} ${m[2]}: ${m[3]}`);
  }
  return out;
}

const current = parseDiagnostics(output);

if (process.env.DEBUG_TSC) {
  console.log("--- raw tsc output (first 1200 chars) ---");
  console.log(output.slice(0, 1200));
  console.log("--- status:", result.status, "signal:", result.signal, "---");
  console.log("--- parsed:", current.length, "diagnostic(s) ---");
}

// The `--write-baseline` escape hatch: regenerate the baseline.
if (WRITE_BASELINE) {
  const { writeFileSync } = await import("node:fs");
  const sorted = [...new Set(current)].sort();
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${sorted.length} baseline error(s) to ${BASELINE_PATH}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `The server-typecheck baseline is missing: ${BASELINE_PATH}\n` +
      `Run "npm run typecheck:server -- --write-baseline" to create it.`
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const baselineSet = new Set(baseline);
const currentSet = new Set(current);

const added = [...currentSet].filter((e) => !baselineSet.has(e));
const removed = [...baselineSet].filter((e) => !currentSet.has(e));

console.log(`Server typecheck: ${current.length} error(s) (baseline ${baseline.length})`);

if (removed.length) {
  console.log(`\nFIXED since the baseline (${removed.length}) — regenerate the baseline to record them:`);
  for (const e of removed) console.log(`  - ${e}`);
  console.log('\nRun: npm run typecheck:server -- --write-baseline');
}

if (added.length) {
  console.error(`\nNEW type errors in the server (${added.length}) — the gate FAILS:`);
  for (const e of added) console.error(`  + ${e}`);
  console.error(
    "\nThe repo's `npm run typecheck` does NOT cover `server/` (its tsconfig\n" +
      "includes only `src` + `../shared`). This gate does. Fix the errors above."
  );
  process.exit(1);
}

if (!removed.length) {
  console.log("No new type errors. OK.");
}
