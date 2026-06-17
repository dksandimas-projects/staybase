#!/usr/bin/env node
/**
 * Pre-launch verification script.
 * Run before tagging the staging release to catch config / dependency issues.
 *
 * Usage: node scripts/preflight.mjs
 * Exits non-zero on any failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const failures = [];
const warnings = [];
const passes = [];

function ok(msg) {
  passes.push(msg);
  console.log(`  \u2713 ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.log(`  \u26A0 ${msg}`);
}

function fail(msg) {
  failures.push(msg);
  console.error(`  \u2717 ${msg}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

// 1. Tests pass
section("1. Tests");
try {
  execSync("npm test", { cwd: repoRoot, stdio: "pipe" });
  ok("All tests pass (shared + guest-app)");
} catch (err) {
  fail("Tests failed. Run `npm test` to see errors.");
}

// 2. Typecheck
section("2. Typecheck");
try {
  execSync("npm run typecheck", { cwd: repoRoot, stdio: "pipe" });
  ok("TypeScript compiles cleanly (guest-app + admin-app)");
} catch (err) {
  fail("Typecheck failed. Run `npm run typecheck` to see errors.");
}

// 3. Builds
section("3. Production builds");
try {
  execSync("npm run build:guest", { cwd: repoRoot, stdio: "pipe" });
  ok("guest-app production build succeeds");
} catch (err) {
  fail("guest-app build failed.");
}
try {
  execSync("npm run build:admin", { cwd: repoRoot, stdio: "pipe" });
  ok("admin-app production build succeeds");
} catch (err) {
  fail("admin-app build failed.");
}

// 4. Env templates
section("4. Environment templates");
for (const envFile of [
  "guest-app/.env.example",
  "admin-app/.env.example"
]) {
  if (existsSync(resolve(repoRoot, envFile))) {
    ok(`${envFile} present`);
  } else {
    fail(`${envFile} missing — required for new contributors / deployments`);
  }
}

// 5. Required env variables in .env.example
section("5. Required env variables");
const guestEnv = existsSync(resolve(repoRoot, "guest-app/.env.example"))
  ? readFileSync(resolve(repoRoot, "guest-app/.env.example"), "utf8")
  : "";
const requiredGuestVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_TURNSTILE_SITE_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "ADMIN_NOTIFICATION_EMAIL",
  "TURNSTILE_SECRET_KEY"
];
for (const v of requiredGuestVars) {
  if (guestEnv.includes(v)) ok(`guest-app env example references ${v}`);
  else fail(`guest-app env example missing ${v}`);
}

const adminEnv = existsSync(resolve(repoRoot, "admin-app/.env.example"))
  ? readFileSync(resolve(repoRoot, "admin-app/.env.example"), "utf8")
  : "";
const requiredAdminVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_GUEST_APP_URL"
];
for (const v of requiredAdminVars) {
  if (adminEnv.includes(v)) ok(`admin-app env example references ${v}`);
  else fail(`admin-app env example missing ${v}`);
}

// 6. Firebase rules
section("6. Firebase security rules");
for (const rulesFile of [
  "firebase/firestore.rules",
  "firebase/storage.rules"
]) {
  if (existsSync(resolve(repoRoot, rulesFile))) {
    ok(`${rulesFile} present`);
  } else {
    fail(`${rulesFile} missing`);
  }
}

// 7. Vercel config
section("7. Vercel deployment config");
if (existsSync(resolve(repoRoot, "vercel.json"))) {
  const vercel = JSON.parse(readFileSync(resolve(repoRoot, "vercel.json"), "utf8"));
  const allHeaderKeys = (vercel.headers || []).flatMap((block) =>
    (block.headers || []).map((h) => (h.key || "").toLowerCase())
  );
  const hasSecurityHeaders = ["content-security-policy", "x-frame-options", "x-content-type-options"]
    .every((k) => allHeaderKeys.includes(k));
  if (hasSecurityHeaders) ok("vercel.json has security headers (CSP, X-Frame-Options, X-Content-Type-Options)");
  else fail("vercel.json missing required security headers");

  const hasCron = vercel.crons?.some((c) => c.path?.includes("checkin-reminder"));
  if (hasCron) ok("vercel.json has checkin-reminder cron");
  else warn("vercel.json missing checkin-reminder cron (add it before staging)");
} else {
  fail("vercel.json missing");
}

// 8. Firestore private key handling
section("8. Firebase Admin SDK init");
const firebaseAdminPath = "guest-app/server/lib/firebase-admin.ts";
if (existsSync(resolve(repoRoot, firebaseAdminPath))) {
  const content = readFileSync(resolve(repoRoot, firebaseAdminPath), "utf8");
  if (content.includes(".replace(/\\\\n/g, \"\\n\")") || content.includes('replace(/\\\\n/g, "\\n")')) {
    ok("FIREBASE_PRIVATE_KEY newline handling present");
  } else {
    fail("FIREBASE_PRIVATE_KEY newline handling missing in firebase-admin.ts");
  }
} else {
  fail(`${firebaseAdminPath} missing`);
}

// 9. Version
section("9. Version");
const versionPath = "shared/VERSION.ts";
if (existsSync(resolve(repoRoot, versionPath))) {
  const version = readFileSync(resolve(repoRoot, versionPath), "utf8");
  const match = version.match(/VERSION = "([^"]+)"/);
  if (match) {
    const ver = match[1];
    ok(`Current version: ${ver}`);
    if (ver.startsWith("0.")) {
      ok("Pre-release version (0.x) — appropriate for staging");
    } else if (ver === "1.0.0") {
      ok("Production-ready version (1.0.0)");
    } else {
      warn(`Version ${ver} is past 1.0.0 — ensure this is intentional`);
    }
  }
}

// 10. No uncommitted changes
section("10. Working tree");
try {
  const status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
  if (status.trim() === "") {
    ok("Working tree is clean");
  } else {
    warn(`Working tree has ${status.trim().split("\n").length} uncommitted change(s)`);
  }
} catch (err) {
  warn("Could not check git status (not a git repo or no git installed)");
}

// Summary
console.log("\n=== Summary ===");
console.log(`  ${passes.length} passed`);
console.log(`  ${warnings.length} warning(s)`);
console.log(`  ${failures.length} failure(s)`);

if (failures.length > 0) {
  console.error("\n\u2717 Preflight FAILED. Fix the issues above before tagging the release.");
  process.exit(1);
} else if (warnings.length > 0) {
  console.log("\n\u26A0 Preflight passed with warnings. Review before proceeding.");
  process.exit(0);
} else {
  console.log("\n\u2713 Preflight passed. Ready to tag the release.");
  process.exit(0);
}
