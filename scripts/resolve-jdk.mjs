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

/** A usable JDK home has a `bin/java` executable. */
function isJdkHome(candidate) {
  return Boolean(candidate) && existsSync(join(candidate, "bin", "java"));
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
  const which = spawnSync("which", ["java"], { encoding: "utf8" });
  if (which.status !== 0) return null;
  const bin = which.stdout.trim();
  if (!bin) return null;
  // `<home>/bin/java` → `<home>`
  const home = join(bin, "..", "..");
  return isJdkHome(home) ? home : null;
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

  const onPath = javaOnPath();
  if (onPath) candidates.push(onPath);

  for (const candidate of candidates) {
    if (isJdkHome(candidate)) return candidate;
  }
  return null;
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
  console.error("        export JAVA_HOME=\"/path/to/jdk/Contents/Home\"");
  console.error("    • extract a JDK into ~/.local/jdk/ (this script looks there), or");
  console.error("    • put a `java` on PATH");
  console.error("");
  process.exit(1);
}

const javaBin = join(javaHome, "bin");
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${javaBin}${process.env.PATH ? `:${process.env.PATH}` : ""}`
};

const result = spawnSync(command, args, { stdio: "inherit", env, shell: false });

if (result.error) {
  console.error(`resolve-jdk: failed to run \`${command}\`: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`resolve-jdk: \`${command}\` was terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
