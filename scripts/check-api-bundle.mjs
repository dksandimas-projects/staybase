import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guestRoot = join(repoRoot, "guest-app");
const committedBundle = join(guestRoot, "api", "[...route].js");
const forceCheck = process.argv.includes("--all");
const stagedFiles = execFileSync("git", ["diff", "--cached", "--name-only"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim().split("\n").filter(Boolean);
const bundleInputsChanged = stagedFiles.some((file) =>
  file.startsWith("guest-app/server/") || file.startsWith("shared/")
);

if (!forceCheck && !bundleInputsChanged) process.exit(0);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "spark-inn-api-bundle-"));
const generatedBundle = join(temporaryDirectory, "route.js");

try {
  execFileSync(resolve(repoRoot, "node_modules", ".bin", "esbuild"), [
    "server/apiRouter.ts",
    "--bundle",
    "--platform=node",
    "--target=node18",
    `--outfile=${generatedBundle}`
  ], { cwd: guestRoot, stdio: "pipe" });

  const generated = readFileSync(generatedBundle);
  const bundleIsStaged = stagedFiles.includes("guest-app/api/[...route].js");
  const unstagedBundleInputs = forceCheck ? [] : execFileSync(
    "git",
    ["diff", "--name-only", "--", "guest-app/server", "shared"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim().split("\n").filter(Boolean);
  const bundleToVerify = forceCheck
    ? readFileSync(committedBundle)
    : bundleIsStaged
      ? execFileSync("git", ["show", ":guest-app/api/[...route].js"], {
        cwd: repoRoot,
        maxBuffer: 20 * 1024 * 1024
      })
      : Buffer.alloc(0);

  if (unstagedBundleInputs.length > 0) {
    console.error(
      "API bundle inputs have unstaged changes. Stage or discard those changes before committing: " +
      unstagedBundleInputs.join(", ")
    );
    process.exitCode = 1;
  } else if (!generated.equals(bundleToVerify) || (!forceCheck && !bundleIsStaged)) {
    console.error(
      "The committed guest API bundle is stale or unstaged. " +
      "Run `npm run build:api -w guest-app`, stage guest-app/api/[...route].js, and retry."
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
