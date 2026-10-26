// AI-BROWSER-QA (2026-10-26) — list the test runs and close this pass's
// own orphan run.
//
// The repo's ETR-03 mechanism allows ONE active PRODUCTION run at a time.
// A pass that crashes before its `afterAll` leaves its run active, and the
// next pass then cannot open one. Only a run that carries THIS pass's name
// is ever closed — somebody else's live run (the hotel's own pre-go-live
// run, for instance) is left strictly alone.
//
//   node manage-test-runs.mjs list
//   node manage-test-runs.mjs close <runId>

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const qa = loadEnv("e2e/.qa.env.local");
const base = (qa.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com").replace(/\/$/, "");
const apiKey = qa.QA_FIREBASE_API_KEY || "";
const email = qa.QA_ADMIN_EMAIL || "";
const password = qa.QA_ADMIN_PASSWORD || "";
if (!apiKey || !email || !password) {
  console.error("the QA admin credentials or the Firebase Web API key are missing.");
  process.exit(1);
}

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, Referer: `${base}/` },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }
);
const signInBody: any = await signIn.json().catch(() => ({}));
if (!signIn.ok || !signInBody?.idToken) {
  console.error("the QA admin sign-in failed.");
  process.exit(1);
}
const idToken = signInBody.idToken as string;

const listRes = await fetch(`${base}/api/test-runs/list`, {
  headers: { Authorization: `Bearer ${idToken}` }
});
const list: any = await listRes.json().catch(() => ({}));
const runs = (list?.data || []) as any[];
console.log(`test runs: ${runs.length}`);
for (const r of runs) {
  console.log(
    `  id=${r.id}  name="${r.name}"  env=${r.environment}  status=${r.status}  ` +
      `started=${r.startedAt ?? "-"}  closed=${r.closedAt ?? "-"}`
  );
}

const action = process.argv[2] || "list";
const targetId = process.argv[3] || "";
if (action === "close") {
  const target = runs.find((r) => r.id === targetId);
  if (!target) {
    console.error(`no run with the id ${targetId}.`);
    process.exit(1);
  }
  const res = await fetch(`${base}/api/test-runs/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ runId: targetId })
  });
  const body = await res.json().catch(() => ({}));
  console.log(`closed ${target.name} → ${res.status} ${JSON.stringify(body?.data?.manifest ?? body?.error)}`);
}
