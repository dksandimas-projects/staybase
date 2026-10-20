// READ-ONLY: capture the LIVE Firestore + Storage security rules from a
// Firebase project, so a deploy has a verified rollback point and a
// drift check against the repo.
//
// The access token never leaves this process and is never printed.
//
// Usage: node scripts/capture-live-rules.mjs [projectId] [outDir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const api = require("firebase-tools/lib/api");

const projectId = process.argv[2] || "spark-inn-prod";
const outDir = process.argv[3] || "tmp/prod-rules-backup";

const store = JSON.parse(
  readFileSync(`${process.env.HOME}/.config/configstore/firebase-tools.json`, "utf8")
);
const tokens = store.tokens || {};

async function accessToken() {
  const expiresAt = Number(tokens.expires_at || 0);
  const now = Date.now();
  if (tokens.access_token && expiresAt > now + 60_000) return tokens.access_token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: api.clientId(),
      client_secret: api.clientSecret(),
      refresh_token: tokens.refresh_token
    })
  });
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

const token = await accessToken();
const authHeaders = { Authorization: `Bearer ${token}` };

async function getJson(url) {
  const res = await fetch(url, { headers: authHeaders });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 300)}`);
  return JSON.parse(text);
}

mkdirSync(outDir, { recursive: true });

// ---- Firestore rules ----
const rulesets = await getJson(
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`
);

if (!rulesets.rulesets?.length) {
  console.log("no firestore rulesets found — nothing to capture");
} else {
  const current = rulesets.rulesets[0];
  // `name` is already the full resource path
  // ("projects/<id>/rulesets/<uuid>") in the list response.
  const rulesetPath = current.name.startsWith("projects/")
    ? current.name
    : `projects/${projectId}/rulesets/${current.name}`;
  const detail = await getJson(
    `https://firebaserules.googleapis.com/v1/${rulesetPath}`
  );
  const source = detail.source?.files?.map((f) => f.content).join("\n") || "";
  const file = `${outDir}/${projectId}-firestore.rules`;
  writeFileSync(file, source);
  console.log(`firestore ruleset : ${current.name}`);
  console.log(`  bytes            : ${source.length}`);
  console.log(`  match blocks     : ${(source.match(/^\s*match\s/gm) || []).length}`);
  console.log(`  saved to         : ${file}`);
}

// ---- Storage rules ----
// The bucket list endpoint is not reachable with the CLI's OAuth scope,
// so use the bucket name the prod env file points at.
const bucketName = (() => {
  try {
    const env = readFileSync("guest-app/.env.spark-inn-prod", "utf8");
    const match = env.match(/^FIREBASE_STORAGE_BUCKET=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* fall through */
  }
  return `${projectId}.firebasestorage.app`;
})();

const res = await fetch(
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/buckets/${bucketName}/ruleset`,
  { headers: authHeaders }
);
if (!res.ok) {
  console.log(`storage rules     : unavailable (HTTP ${res.status}) for ${bucketName}`);
} else {
  const detail = await res.json();
  const source = detail.source?.files?.map((f) => f.content).join("\n") || "";
  const file = `${outDir}/${projectId}-${bucketName}-storage.rules`;
  writeFileSync(file, source);
  console.log(`storage rules     : ${bucketName} (${source.length} bytes) -> ${file}`);
}

process.exit(0);
