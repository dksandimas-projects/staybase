// AI-BROWSER-QA (2026-10-26) — add a domain to the Firebase project's
// authorized-domain list.
//
// WHY THIS EXISTS
// §3.22: the guest app is served from `www.sparkinnbohol.com`, but the
// Firebase project only authorizes the apex `sparkinnbohol.com`. Two
// production defects follow from that single missing entry:
//
//   1. The Spark Rewards verification email is NEVER sent. The server's
//      `generateEmailVerificationLink` refuses the action URL with
//      "Domain not allowlisted by project", and the client swallows the
//      error (the send is fire-and-forget), so the guest is told to
//      "check your inbox" for a mail that never left.
//   2. Google sign-in on the guest app fails on `www` with
//      `auth/unauthorized-domain` — the popup refuses the origin.
//
// The apex 308-redirects to `www`, so authorizing the apex alone does
// not help: the browser ends up on `www`.
//
// USAGE
//   ENV_FILE=guest-app/.env.spark-inn-prod \
//   node tmp/.../patch-authorized-domains.mjs www.sparkinnbohol.com
//
// The existing list is preserved — the new domain is appended, nothing
// is removed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GoogleAuth } from "google-auth-library";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const vars = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const projectId = vars.FIREBASE_PROJECT_ID;
const domain = (process.argv[2] || "").trim();

if (!domain) {
  console.error("no domain given.");
  process.exit(1);
}

const auth = new GoogleAuth({
  credentials: {
    client_email: vars.FIREBASE_CLIENT_EMAIL,
    private_key: vars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
});
const client = await auth.getClient();
const token = await client.getAccessToken();

const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
const headers = { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" };

const current: any = await (await fetch(base, { headers })).json();
const existing: string[] = Array.isArray(current.authorizedDomains) ? current.authorizedDomains : [];

if (existing.includes(domain)) {
  console.log(`already authorized: ${domain}`);
  console.log(`authorizedDomains: ${JSON.stringify(existing)}`);
  process.exit(0);
}

const next = [...existing, domain];

const res = await fetch(`${base}?updateMask=authorizedDomains`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ authorizedDomains: next })
});
if (!res.ok) {
  console.error(`the identity toolkit answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}

const after: any = await res.json();
console.log(`project: ${projectId}`);
console.log(`authorizedDomains: ${JSON.stringify(after.authorizedDomains, null, 2)}`);
