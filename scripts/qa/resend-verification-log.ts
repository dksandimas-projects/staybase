// AI-BROWSER-QA (2026-10-26) — did the Spark Rewards verification email
// actually leave the building?
//
// READ-ONLY: it reads the provider's send log and prints the RECIPIENT
// (a QA alias) + the subject + the event. No guest address is printed.
//
//   node tmp/qa-2026-10-23/resend-verification-log.mjs

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();

function readLocalKey(): string | undefined {
  if (process.env.QA_RESEND_API_KEY) return process.env.QA_RESEND_API_KEY;
  const local = resolve(REPO_ROOT, "tmp/qa-2026-10-23/.resend.env");
  if (!existsSync(local)) return undefined;
  for (const raw of readFileSync(local, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    if (name === "RESEND_FULL_ACCESS_KEY" || name === "QA_RESEND_API_KEY") {
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const key = readLocalKey();
if (!key) {
  console.log("no Resend API key.");
  process.exit(0);
}

type Send = { id: string; subject: string; to: string[]; created_at: string; last_event: string };
const sends: Send[] = [];
let cursor: string | undefined;
for (let page = 0; page < 3; page++) {
  const url = `https://api.resend.com/emails?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`the Resend API answered ${res.status}.`);
    process.exit(1);
  }
  const body: any = await res.json().catch(() => ({}));
  const list: Send[] = body?.data || [];
  if (!list.length) break;
  sends.push(...list);
  cursor = list[list.length - 1].id;
}

console.log(`scanned ${sends.length} send(s)`);
const qa = sends.filter((s) => (s.to || []).some((t) => t.includes("+sparkinn.dev@gmail.com")));
console.log(`\n=== sends to a QA alias (${qa.length}) ===`);
for (const s of qa.slice(0, 40)) {
  console.log(
    `${s.created_at}  ${s.last_event}  ${(s.to || []).join(",")}  — ${String(s.subject || "").slice(0, 70)}`
  );
}
const verifyish = qa.filter((s) => /verif|confirm|email/i.test(String(s.subject || "")));
console.log(`\n=== verification-looking subjects (${verifyish.length}) ===`);
for (const s of verifyish.slice(0, 20)) {
  console.log(`${s.created_at}  ${s.last_event}  ${(s.to || []).join(",")}  — ${String(s.subject || "").slice(0, 70)}`);
}
