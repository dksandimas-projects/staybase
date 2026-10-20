import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const messageFile = process.argv[2];
const message = readFileSync(messageFile, "utf8").trim();
const firstLine = message.split("\n")[0] ?? "";
const match = firstLine.match(/^([a-z]+)(\([^)]+\))?: .+/);
const bumpByPrefix = {
  fix: "patch",
  refactor: "patch",
  feat: "minor",
  release: "major"
};
const bumpType = match ? bumpByPrefix[match[1]] : undefined;

if (!bumpType) {
  process.exit(0);
}

const versionFile = "shared/VERSION.ts";
const versionSource = readFileSync(versionFile, "utf8");
const versionMatch = versionSource.match(/VERSION = "(\d+)\.(\d+)\.(\d+)"/);

if (!versionMatch) {
  console.error(`Could not find VERSION constant in ${versionFile}.`);
  process.exit(1);
}

let major = Number(versionMatch[1]);
let minor = Number(versionMatch[2]);
let patch = Number(versionMatch[3]);

if (bumpType === "major") {
  major += 1;
  minor = 0;
  patch = 0;
}

if (bumpType === "minor") {
  minor += 1;
  patch = 0;
}

if (bumpType === "patch") {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;

// Surgically replace ONLY the version string. This file used to be
// rewritten wholesale, which silently destroyed every comment in it —
// including the BR-08 (decision #238) close-out note documenting the
// 2.0.0 MAJOR cutover and the deleted breakfast fields. That note was
// lost twice in one session because every subsequent Conventional
// Commit re-ran this write. If documentation belongs in this file, the
// bump must not be able to eat it.
//
// A regex replace is safe here because the hook has already proven the
// constant matches above (it exits 1 otherwise), so exactly one
// replacement is made and the rest of the file — comments, blank
// lines, anything — is preserved byte for byte.
const updatedSource = versionSource.replace(
  /VERSION\s*=\s*["']\d+\.\d+\.\d+["']/,
  `VERSION = "${nextVersion}"`
);
writeFileSync(versionFile, updatedSource);
execFileSync("git", ["add", versionFile], { stdio: "inherit" });
console.log(`Bumped shared VERSION to ${nextVersion}.`);
