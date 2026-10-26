// AI-BROWSER-QA (2026-10-26) — read the Firebase project's authorized
// domains.
//
// Per §3.22: the Spark Rewards verification email is NEVER sent — the
// server's `generateEmailVerificationLink` refuses the action URL with
// "Domain not allowlisted by project", and the client swallows the
// error (the send is fire-and-forget), so the guest is told to "check
// your inbox" for a mail that never left.
//
// READ-ONLY.

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

const auth = new GoogleAuth({
  credentials: {
    client_email: vars.FIREBASE_CLIENT_EMAIL,
    private_key: vars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
});
const client = await auth.getClient();
const token = await client.getAccessToken();

const res = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
  { headers: { Authorization: `Bearer ${token.token}` } }
);
if (!res.ok) {
  console.error(`the identity toolkit answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const config: any = await res.json();
console.log(`project: ${projectId}`);
console.log(`authorizedDomains: ${JSON.stringify(config.authorizedDomains, null, 2)}`);
