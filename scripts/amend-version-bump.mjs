import { execFileSync } from "node:child_process";

const stagedFiles = execFileSync("git", ["diff", "--cached", "--name-only"], {
  encoding: "utf8"
})
  .split("\n")
  .filter(Boolean);

if (!stagedFiles.includes("shared/VERSION.ts")) {
  process.exit(0);
}

execFileSync("git", ["commit", "--amend", "--no-edit"], {
  env: { ...process.env, HUSKY: "0" },
  stdio: "inherit"
});
