/**
 * The app dependency-closure gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-10-27 the ADMIN APP stopped deploying entirely. Every
 * deployment since v2.21.15 failed with:
 *
 *     ../scripts/finance-integrity-scan.ts(40,46): error TS2307:
 *       Cannot find module 'firebase-admin/app' or its corresponding
 *       type declarations.
 *     ../scripts/finance-integrity-scan.ts(41,42): error TS2307:
 *       Cannot find module 'firebase-admin/firestore' …
 *     ../scripts/finance-integrity-scan.ts(42,34): error TS2307:
 *       Cannot find module 'dotenv' …
 *
 * WHY IT HAPPENED
 * ---------------
 * The admin app's `tsconfig.json` includes `src`, and `src/__tests__`
 * sits inside it. A test file there imported the ROOT script
 * `scripts/finance-integrity-scan.ts`, which imports `firebase-admin`
 * and `dotenv`. Neither package is reachable from `admin-app`'s own
 * dependency closure — the Vercel project for the admin app has
 * `rootDirectory=admin-app`, so only the `admin-app` workspace is
 * installed, and the root `node_modules` hoisting that makes those
 * imports resolve on a developer machine does not exist there.
 *
 * The result was silent and severe: the production admin app stayed
 * on v2.21.9 for the whole period while the guest app moved to
 * v2.21.16. The admin app was missing the kitchen-list fix, the
 * store-report CSV export and the F-A6 instruction fix, and NOTHING
 * said so — the deploy failed, but the failure was never read.
 *
 * The rule this gate enforces
 * ---------------------------
 * An app's TypeScript program may only reference packages that are
 * REACHABLE from that app's own `package.json` closure (its declared
 * dependencies and their transitive dependencies), plus Node
 * built-ins and the repo's own path aliases.
 *
 * A file outside the app directory (a root `scripts/` file, say) is
 * only in the program because the app imports it — so the gate checks
 * the WHOLE program, not just the app's own sources. That is what
 * makes it catch this class of bug.
 *
 * WHAT IT DOES
 * ------------
 *   1. Reads each app's `tsconfig.json` and asks TypeScript for the
 *      exact file list of the program it would compile.
 *   2. Scans every non-`node_modules` file in that program for its
 *      import specifiers.
 *   3. Resolves every bare (non-relative) specifier to a package
 *      name and checks it against the app's dependency closure.
 *   4. FAILS (exit 1) when a referenced package is not reachable.
 *
 * READ-ONLY. It writes nothing.
 *
 * USAGE
 *   node scripts/check-app-dependency-closure.mjs
 *   node scripts/check-app-dependency-closure.mjs --app=admin-app
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "package.json"));

const APPS = ["admin-app", "guest-app"];

/** The repo's own path aliases — resolved from source, not from npm. */
const PATH_ALIASES = ["@config", "@shared/", "@spark-inn/shared"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The package name a bare specifier refers to (`a/b/c` → `a` or `@a/b`). */
function packageOf(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0];
}

/**
 * Every package reachable from `names` through the INSTALLED tree.
 *
 * The installed tree is what a Vercel build would resolve against
 * (minus the hoisting the isolated workspace install does not have),
 * so walking it gives the real transitive closure.
 */
function reachableClosure(names) {
  const seen = new Set();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const manifestPath = join(repoRoot, "node_modules", name, "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch {
      continue;
    }
    const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };
    const peerMeta = manifest.peerDependenciesMeta || {};
    const peers = Object.keys(manifest.peerDependencies || {}).filter(
      (key) => !(peerMeta[key] && peerMeta[key].optional)
    );
    queue.push(...Object.keys(deps), ...peers);
  }
  return seen;
}

/**
 * The files TypeScript would compile for an app.
 *
 * `tsc --listFilesOnly` prints the exact program, which is what the
 * app's own build compiles — the same list the failing admin build
 * had. Running the real compiler is the only way to be sure the
 * gate sees the same program the build sees.
 */
function programFiles(appDir) {
  const tsc = require.resolve("typescript/lib/tsc.js");
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(
    process.execPath,
    [tsc, "-p", join(appDir, "tsconfig.json"), "--listFilesOnly"],
    { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(`${sep}node_modules${sep}`) && !line.includes("/node_modules/"));
}

/**
 * The import specifiers in a source file.
 *
 * It uses TypeScript's OWN scanner (`ts.preProcessFile`) rather than a
 * regular expression, because a regex cannot tell an import
 * statement from prose that merely mentions the word "from" — and
 * this gate reports every finding, so a false positive would make it
 * noise that gets ignored. The scanner returns exactly the module
 * specifiers the compiler would try to resolve.
 */
function importSpecifiers(source) {
  const ts = require("typescript");
  const scanned = ts.preProcessFile(source, true, true);
  return [...scanned.importedFiles, ...scanned.referencedFiles].map((entry) => entry.fileName);
}

function isAllowed(specifier, closure) {
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith(".")) return true;
  if (PATH_ALIASES.some((alias) => specifier === alias || specifier.startsWith(alias))) return true;
  return closure.has(packageOf(specifier));
}

const only = process.argv.find((arg) => arg.startsWith("--app="));
const apps = only ? [only.slice("--app=".length)] : APPS;

let failures = 0;

for (const app of apps) {
  const appDir = join(repoRoot, app);
  const manifest = readJson(join(appDir, "package.json"));
  const declared = {
    ...manifest.dependencies,
    ...manifest.devDependencies
  };
  const closure = reachableClosure(Object.keys(declared));

  const files = programFiles(appDir);
  const offenders = [];

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const specifier of importSpecifiers(source)) {
      if (isAllowed(specifier, closure)) continue;
      offenders.push({
        file: relative(repoRoot, file).split(sep).join("/"),
        specifier,
        package: packageOf(specifier)
      });
    }
  }

  const label = `${app} (${files.length} file(s) in the program)`;
  if (offenders.length === 0) {
    console.log(`  OK  ${label} — every referenced package is inside the app's closure.`);
    continue;
  }

  failures += 1;
  console.error(`\n  FAIL  ${label}`);
  const seen = new Set();
  for (const offender of offenders) {
    const key = `${offender.file} -> ${offender.specifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`    ${offender.file}`);
    console.error(`      imports "${offender.specifier}"`);
    console.error(
      `      → "${offender.package}" is NOT reachable from ${app}'s package.json closure.`
    );
    console.error(
      `        The ${app} Vercel project installs only the ${app} workspace, so this`
    );
    console.error(
      `        import cannot resolve there and the ${app} BUILD WILL FAIL.`
    );
    console.error(
      `        Move the logic into a dependency-free module (or import it from a`
    );
    console.error(
      `        package ${app} actually declares).`
    );
  }
}

if (failures > 0) {
  console.error(`\nApp dependency-closure gate FAILED for ${failures} app(s).`);
  process.exit(1);
}
console.log("\nApp dependency-closure gate: OK for " + apps.join(", ") + ".");
