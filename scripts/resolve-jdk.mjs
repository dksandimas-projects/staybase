#!/usr/bin/env node
// Locate a JDK, then run the given command with JAVA_HOME + PATH set.
//
// WHY THIS EXISTS
//
// `npm run test:rules` runs the Firestore emulator, which needs a JVM.
// This machine had NO Java on PATH (macOS ships only the `/usr/bin/java`
// stub), so the whole rules suite was silently unrunnable — the gate
// looked like it existed, but nobody could have run it. The rules were
// therefore unverified for as long as that was true, and two real
// defects were sitting in `firebase/tests/` waiting for a JVM to
// appear.
//
// This script makes the gate self-sufficient:
//
//   1. It finds a JDK automatically (JAVA_HOME, the macOS
//      `/usr/libexec/java_home` helper, `~/.local/jdk/*`, the standard
//      macOS/JavaVirtualMachines locations, or a `java` on PATH), so
//      `npm run test:rules` works in a fresh shell with no setup.
//   2. If NO JDK is found it FAILS LOUDLY with an actionable message.
//      A missing JVM must never degrade into a silently skipped gate.
//
// Usage:
//   node scripts/resolve-jdk.mjs <command> [args...]
//
// Exit code: the child's exit code, or 1 when no JDK could be found.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { delimiter } from "node:path";

/**
 * A usable JDK home has a `bin/java` executable.
 *
 * Windows spells it `bin/java.exe` and puts it in the same place, so
 * both spellings are accepted. Before this was fixed the script could
 * NOT find a JDK on Windows even with `JAVA_HOME` set correctly —
 * `bin/java` never exists there — so `npm run test:rules` failed with
 * "no JDK found" on a machine that had Temurin installed. That is the
 * exact "a real gate that silently cannot run" failure this script was
 * written to prevent, reproduced on the other platform.
 */
function isJdkHome(candidate) {
  if (!candidate) return false;
  return existsSync(join(candidate, "bin", "java")) || existsSync(join(candidate, "bin", "java.exe"));
}

/** Expand a glob-ish directory of JDK homes into the ones that work. */
function jdkHomesIn(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    // macOS bundles live at `<dir>/<name>/Contents/Home`; a plain
    // tarball extraction lands the home directly at `<dir>/<name>`.
    for (const candidate of [join(dir, entry, "Contents", "Home"), join(dir, entry)]) {
      if (isJdkHome(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }
  return found;
}

/** Ask macOS where its JDKs live. */
function javaHomeHelper() {
  const result = spawnSync("/usr/libexec/java_home", [], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}

/** Resolve a `java` on PATH back to its JDK home. */
function javaOnPath() {
  // `which` is not on Windows; `where` is. Try both.
  const finder = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(finder, ["java"], { encoding: "utf8" });
  if (which.status !== 0) return null;
  // `where` can print several lines; the first is the one on PATH.
  const bin = (which.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!bin) return null;
  // `<home>/bin/java` → `<home>`
  const home = join(bin, "..", "..");
  return isJdkHome(home) ? home : null;
}

/**
 * The Windows JDK install roots. Temurin 21 (what this repo is tested
 * on) lands in `C:\Program Files\Eclipse Adoptium\jdk-<version>`; the
 * other vendors use their own folder under `C:\Program Files`.
 */
function windowsJdkHomes() {
  const roots = [
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Microsoft",
    "C:\\Program Files\\Amazon Corretto",
    "C:\\Program Files\\Zulu",
    "C:\\Program Files (x86)\\Java"
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry);
      if (isJdkHome(candidate)) found.push(candidate);
    }
  }
  return found;
}

function findJdk() {
  const candidates = [];

  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  const helper = javaHomeHelper();
  if (helper) candidates.push(helper);

  const home = homedir();
  candidates.push(
    ...jdkHomesIn(join(home, ".local", "jdk")),
    ...jdkHomesIn(join(home, "Library", "Java", "JavaVirtualMachines")),
    ...jdkHomesIn("/Library/Java/JavaVirtualMachines")
  );

  if (process.platform === "win32") candidates.push(...windowsJdkHomes());

  const onPath = javaOnPath();
  if (onPath) candidates.push(onPath);

  for (const candidate of candidates) {
    if (isJdkHome(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the command to something `spawnSync` can actually start.
 *
 * On Windows, npm installs its CLI shims as `<name>.cmd`, and Node's
 * `spawn` with `shell: false` does NOT apply PATHEXT — it only tries
 * the exact name and `.exe`. Worse, since Node 22 (the CVE-2024-27980
 * fix) it REFUSES to start a `.cmd`/`.bat` at all without a shell. So
 * `spawnSync("firebase")` fails with ENOENT even though
 * `node_modules/.bin/firebase.cmd` exists, and would fail with EINVAL
 * even when the shim is named explicitly.
 *
 * So on Windows the shim is found AND the child is started through
 * `cmd.exe`, with the argument list quoted here (Node's own `shell:
 * true` joins the arguments without escaping them).
 */
function resolveCommand(command) {
  if (process.platform !== "win32") return { file: command, shell: false };
  // An explicit path or extension is used as-is.
  if (command.includes("/") || command.includes("\\") || /\.[a-z0-9]+$/i.test(command)) {
    return { file: command, shell: false };
  }
  const searchDirs = (process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean);
  // npm puts the workspace bins first in PATH for `npm run` scripts; add
  // the repo-local one too so a direct `node scripts/resolve-jdk.mjs`
  // invocation works as well.
  searchDirs.unshift(join(process.cwd(), "node_modules", ".bin"));
  for (const dir of searchDirs) {
    for (const ext of [".cmd", ".exe", ".bat"]) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) {
        return { file: candidate, shell: /\.(cmd|bat)$/i.test(candidate) };
      }
    }
  }
  return { file: command, shell: false };
}

/** Quote one argument for `cmd.exe`. */
function quoteForCmd(arg) {
  if (arg === "") return '""';
  if (!/[\s"^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("resolve-jdk: no command given. Usage: node scripts/resolve-jdk.mjs <command> [args...]");
  process.exit(1);
}

const javaHome = findJdk();

if (!javaHome) {
  console.error("");
  console.error("resolve-jdk: no JDK found — the Firestore emulator cannot start.");
  console.error("");
  console.error("  The rules suite (`npm run test:rules`) is a REAL gate. It is");
  console.error("  failing here on purpose, rather than being skipped quietly.");
  console.error("");
  console.error("  Fix it with any one of:");
  console.error("    • install a JDK (Temurin 21 is what this repo is tested on)");
  console.error("      and re-run, or");
  console.error("    • point JAVA_HOME at an existing JDK:");
  console.error("        export JAVA_HOME=\"/path/to/jdk/Contents/Home\"   # macOS");
  console.error("        set JAVA_HOME=C:\\Program Files\\Eclipse Adoptium\\jdk-21   # Windows");
  console.error("    • extract a JDK into ~/.local/jdk/ (this script looks there), or");
  console.error("    • put a `java` on PATH");
  if (process.platform === "win32") {
    console.error("");
    console.error("  This script also looks in C:\\Program Files\\Eclipse Adoptium,");
    console.error("  C:\\Program Files\\Java, C:\\Program Files\\Microsoft,");
    console.error("  C:\\Program Files\\Amazon Corretto and C:\\Program Files\\Zulu.");
  }
  console.error("");
  process.exit(1);
}

const javaBin = join(javaHome, "bin");
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  // `delimiter` is `;` on Windows and `:` everywhere else — a hardcoded
  // `:` silently produces a broken PATH there.
  PATH: `${javaBin}${process.env.PATH ? delimiter + process.env.PATH : ""}`
};

const resolved = resolveCommand(command);
const spawnFile = resolved.shell
  ? [resolved.file, ...args.map(quoteForCmd)].join(" ")
  : resolved.file;
const result = spawnSync(spawnFile, resolved.shell ? [] : args, {
  stdio: "inherit",
  env,
  shell: resolved.shell
});

if (result.error) {
  console.error(`resolve-jdk: failed to run \`${command}\`: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`resolve-jdk: \`${command}\` was terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
