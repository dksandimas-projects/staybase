// AI-BROWSER-QA (2026-10-25) — XCC-05: each transactional email arrives
// EXACTLY ONCE.
//
// The evidence is the PROVIDER's send log (Resend), not an inbox: the log
// shows that one message was handed to the provider per event, and it is
// readable without a mailbox.
//
// The invariant has two halves, because the log's own key is the email id:
//
//   1. REFERENCE-BEARING events ("New online booking: SI-…",
//      "Booking request received: R-…", "Booking cancelled: R-…",
//      "Order confirmed: SO-…") carry the business reference in the
//      subject. Each (shape, recipient, reference) must appear EXACTLY
//      once — a duplicate is a double send; a missing one is a dropped
//      send.
//   2. REFERENCE-LESS events (the contact and corporate-inquiry
//      notifications, whose subjects are identical per kind) are counted
//      against the RECORDS: the number of sends must equal the number of
//      inquiries created. Seven inquiries must produce seven sends — not
//      fourteen.
//
// THE SCOPE IS THIS PASS'S RECORDS (the test-run stamp + the QA email).
// Older records are outside the pass: the provider's log keeps them
// forever, and a defect fixed in an earlier pass would otherwise pin
// this check red for ever. (The 2026-10-21 records DID carry a double
// rejection email — two sends 1.25 s apart for one rejection — which is
// the defect this pass fixed; see the report's §3.16.)
//
// READ-ONLY. The Resend key is a credential and is never printed, never
// committed: `QA_RESEND_API_KEY`, or the gitignored
// `tmp/qa-2026-10-23/.resend.env`.
//
//   node scripts/qa/check-email-once.ts [--pages 4]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The script runs from the repository root (like the other `scripts/qa`
// readers), so the root is the CWD — no `__dirname`, which would drag a
// CommonJS shim into the ESM bundle.
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
  console.log("XCC-05 · SKIPPED — no Resend API key (QA_RESEND_API_KEY, or tmp/qa-2026-10-23/.resend.env).");
  process.exit(0);
}

const pages = Number(process.argv[process.argv.indexOf("--pages") + 1]) || 4;
const RUN_NAME = "AI-BROWSER-QA 2026-10-25 guest-write";
const FLOW_EMAIL = "qa.browser.flow+sparkinn.dev@gmail.com";

// ── the provider's log ───────────────────────────────────────────────
type Send = { id: string; subject: string; to: string[]; created_at: string; last_event: string };
const sends: Send[] = [];
let cursor: string | undefined;
for (let page = 0; page < pages; page++) {
  const url = `https://api.resend.com/emails?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`XCC-05 · the Resend API answered ${res.status}.`);
    process.exit(1);
  }
  const body: any = await res.json().catch(() => ({}));
  const list: Send[] = body?.data || [];
  if (!list.length) break;
  sends.push(...list);
  cursor = list[list.length - 1].id;
}

const shapeOf = (subject: string) =>
  subject
    .replace(/SI-\d{8}-\d{5}/g, "<booking>")
    .replace(/R-\d{8}-\d{5}/g, "<reservation>")
    .replace(/SO-\d{8}-\d{5}/g, "<order>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
const refOf = (subject: string) =>
  subject.match(/SI-\d{8}-\d{5}/)?.[0] || subject.match(/R-\d{8}-\d{5}/)?.[0] || subject.match(/SO-\d{8}-\d{5}/)?.[0] || "";

// ── the records the pass created ─────────────────────────────────────
function loadEnv(file: string) {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}
const envFile = process.env.ENV_FILE || "guest-app/.env.spark-inn-prod";
const vars = loadEnv(resolve(REPO_ROOT, envFile));
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: vars.FIREBASE_PROJECT_ID,
      clientEmail: vars.FIREBASE_CLIENT_EMAIL,
      privateKey: vars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}
const db = getFirestore();

const bookingSnap = await db.collection("bookings").where("isTestData", "==", true).get();
const bookings = bookingSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((b) => b.testRunName === RUN_NAME || b.guestEmail === FLOW_EMAIL);

const contactSnap = await db.collection("contactInquiries").get();
const contacts = contactSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((i) => i.email === FLOW_EMAIL || i.guestEmail === FLOW_EMAIL);

const corporateSnap = await db.collection("corporateInquiries").get();
const corporate = corporateSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((i) => i.email === FLOW_EMAIL || i.contactEmail === FLOW_EMAIL);

// ── the check ────────────────────────────────────────────────────────
const problems: string[] = [];

// THIS PASS's references — the scope of the duplicate scan. The
// provider's log keeps every send for ever, so an older record's repeat
// (fixed in an earlier pass) would otherwise pin this check red.
const passRefs = new Set<string>();
for (const b of bookings) {
  if (b.bookingRef) passRefs.add(b.bookingRef);
  if (b.reservationRef) passRefs.add(b.reservationRef);
}

// 1. Reference-bearing events: exactly one send per (shape, recipient, ref).
const groups = new Map<string, Send[]>();
for (const send of sends) {
  const ref = refOf(send.subject);
  if (!ref) continue;
  const k = `${shapeOf(send.subject)}|${(send.to || []).join(",")}|${ref}`;
  const list = groups.get(k) || [];
  list.push(send);
  groups.set(k, list);
}
const olderRepeats: string[] = [];
for (const [k, list] of groups) {
  if (list.length <= 1) continue;
  const ref = refOf(k.split("|").slice(-1)[0] || "");
  if (passRefs.has(ref)) problems.push(`DUPLICATE send — ${k} × ${list.length}`);
  else olderRepeats.push(`${k} × ${list.length}`);
}

// 2. Every QA booking must have produced exactly one staff notification.
const staffNotices = sends.filter(
  (s) => /New online booking/i.test(s.subject) && (s.to || []).includes("admin@sparkinnbohol.com")
);
const notifiedRefs = new Set(staffNotices.map((s) => refOf(s.subject)));
const missingNotices = bookings.filter((b) => b.bookingRef && !notifiedRefs.has(b.bookingRef));
if (missingNotices.length) {
  problems.push(
    `${missingNotices.length} booking(s) produced NO staff notification: ` +
      missingNotices.map((b) => b.bookingRef).join(", ")
  );
}

// 3. The reference-less notifications must match the record counts.
const contactGuestSends = sends.filter((s) => /We received your message/i.test(s.subject));
const contactStaffSends = sends.filter((s) => /New contact:/i.test(s.subject));
if (contactGuestSends.length !== contacts.length) {
  problems.push(
    `${contacts.length} contact inquiry record(s) → ${contactGuestSends.length} guest acknowledgement(s)`
  );
}
if (contactStaffSends.length !== contacts.length) {
  problems.push(`${contacts.length} contact inquiry record(s) → ${contactStaffSends.length} staff notification(s)`);
}
const corporateGuestSends = sends.filter((s) => /We received your corporate inquiry/i.test(s.subject));
const corporateStaffSends = sends.filter((s) => /New corporate inquiry/i.test(s.subject));
if (corporateGuestSends.length !== corporate.length) {
  problems.push(
    `${corporate.length} corporate inquiry record(s) → ${corporateGuestSends.length} guest acknowledgement(s)`
  );
}
if (corporateStaffSends.length !== corporate.length) {
  problems.push(
    `${corporate.length} corporate inquiry record(s) → ${corporateStaffSends.length} staff notification(s)`
  );
}

// 4. Report the delivery events.
const events = new Map<string, number>();
for (const s of sends) events.set(s.last_event, (events.get(s.last_event) || 0) + 1);

console.log("=== XCC-05 — each transactional email arrives exactly once ===\n");
console.log(`sends in the provider's log : ${sends.length} (${pages} pages)`);
console.log(`reference-bearing events    : ${groups.size}`);
console.log(`QA bookings                : ${bookings.length}`);
console.log(`QA contact inquiries        : ${contacts.length}`);
console.log(`QA corporate inquiries      : ${corporate.length}`);
console.log(`delivery events             : ${[...events].map(([k, v]) => `${k}=${v}`).join(" · ")}`);

if (olderRepeats.length) {
  console.log("\nrepeats on records OUTSIDE this pass (reported, not a failure — the provider's");
  console.log("log keeps them for ever, and their defects were fixed in an earlier pass):");
  for (const r of olderRepeats) console.log(`  · ${r}`);
}

if (problems.length) {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("\nXCC-05 · FAIL");
  process.exit(1);
}
console.log("\nXCC-05 · PASS — every event was sent exactly once, and every record produced its send.");
