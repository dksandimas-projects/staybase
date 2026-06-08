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
writeFileSync(versionFile, `export const VERSION = "${nextVersion}";\n`);
execFileSync("git", ["add", versionFile], { stdio: "inherit" });
console.log(`Bumped shared VERSION to ${nextVersion}.`);
