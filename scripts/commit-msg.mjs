import { readFileSync } from "node:fs";

const messageFile = process.argv[2];
const message = readFileSync(messageFile, "utf8").trim();
const firstLine = message.split("\n")[0] ?? "";
const allowedPrefixes = ["feat", "fix", "release", "docs", "chore", "refactor", "style"];
const match = firstLine.match(/^([a-z]+)(\([^)]+\))?: .+/);

if (!match || !allowedPrefixes.includes(match[1])) {
  console.error(
    `Invalid commit message: "${firstLine}"\nUse Conventional Commits, e.g. "feat: add booking flow".`
  );
  process.exit(1);
}

process.exit(0);
