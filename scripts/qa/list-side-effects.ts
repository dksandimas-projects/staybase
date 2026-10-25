// AI-BROWSER-QA (2026-10-25) — the side-effects tracker.
//
// Every production record this QA pass CREATED, listed by kind and
// reference. The QA brief requires every created record to be tracked.
//
// READ-ONLY.
//
// The pass's own records are identified two ways, so nothing is missed and
// nothing else is touched:
//   1. the TEST-RUN STAMP — every booking the browser flow created carries
//      `isTestData: true` + `testRunName` (the repo's own ETR-03
//      mechanism), and
//   2. the QA EMAIL — the guest-flow alias
//      `qa.browser.flow+sparkinn.dev@gmail.com`.
//
// The guest-write scenarios also run as a signed-in MEMBER, so the member
// identity's bookings are included by their test-run stamp rather than by
// their email — the member's own bookings from earlier passes are not
// this pass's records.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

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

const vars = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
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

const FLOW_EMAIL = "qa.browser.flow+sparkinn.dev@gmail.com";
const RUN_NAME = "AI-BROWSER-QA 2026-10-25 guest-write";

/** Anything whose email ends in the QA domain is a QA record. */
const isQaEmail = (v: unknown) => typeof v === "string" && v.endsWith("@gmail.com") && v.includes("+sparkinn.dev");

/** A Firestore Timestamp renders as an ISO string; anything else as-is. */
const stamp = (v: unknown): string => {
  if (!v) return "?";
  const anyV = v as any;
  if (typeof anyV.toDate === "function") return anyV.toDate().toISOString();
  if (typeof anyV === "object" && anyV._seconds) return new Date(anyV._seconds * 1000).toISOString();
  return String(v);
};

/** The check-in / check-out of a booking (Firestore Timestamp or ISO). */
const day = (v: unknown): string => {
  if (!v) return "?";
  const anyV = v as any;
  if (typeof anyV.toDate === "function") return anyV.toDate().toISOString().slice(0, 10);
  if (typeof anyV === "object" && anyV._seconds) return new Date(anyV._seconds * 1000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

console.log("=== side effects — records CREATED by this QA pass ===\n");
console.log(`test run: ${RUN_NAME}\n`);

// ── bookings ─────────────────────────────────────────────────────────
// One equality filter — a composite index would be needed for two.
const bookings = await db.collection("bookings").where("isTestData", "==", true).get();
const flowBookings = bookings.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((b) => b.testRunName === RUN_NAME || b.guestEmail === FLOW_EMAIL);

console.log(`bookings created by this pass: ${flowBookings.length}`);
for (const b of flowBookings) {
  console.log(
    `  ${b.bookingRef} · id=${b.id} · status=${b.status} · room=${b.roomNumber} · ` +
      `checkIn=${day(b.checkIn)} · checkOut=${day(b.checkOut)} · ` +
      `total=${b.totalPrice} · memberDiscountPct=${b.memberDiscountPct ?? 0} · ` +
      `otherAddOnTotal=${b.otherAddOnTotal ?? 0} · paymentMethod=${b.paymentMethod} · ` +
      `proof=${b.paymentProofPath ? "yes" : "no"} · createdAt=${stamp(b.createdAt)}`
  );
  const bedSetup = (b.resolvedRoomSelections || []).map((r: any) => r.bedSetup).filter(Boolean);
  if (bedSetup.length) console.log(`    bed setup: ${bedSetup.join(", ")}`);
  if (b.otherAddOnSelections) {
    const dates = Object.keys(b.otherAddOnSelections);
    console.log(
      `    other add-ons: ` +
        dates
          .map((d) => {
            const list = b.otherAddOnSelections[d] || [];
            const live = list.filter((e: any) => !e.removedAt && Number(e.quantity) > 0);
            const removed = list.filter((e: any) => e.removedAt);
            const bits = [`${d}=${live.length} live`];
            if (removed.length) bits.push(`${removed.length} removed`);
            return bits.join(" ");
          })
          .join(", ") ||
        "(none)"
    );
  }
  if (b.specialRequests) console.log(`    specialRequests: ${JSON.stringify(b.specialRequests)}`);
}

// ── reservations ─────────────────────────────────────────────────────
const reservations = await db.collection("reservations").get();
const flowReservations = reservations.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter(
    (r) =>
      flowBookings.some((b) => b.reservationId === r.id) ||
      r.testRunName === RUN_NAME ||
      isQaEmail(r.guestEmail)
  );
console.log(`\nreservations created by this pass: ${flowReservations.length}`);
for (const r of flowReservations) {
  console.log(
    `  ${r.reservationRef ?? "(no ref)"} · id=${r.id} · status=${r.status ?? "?"} · ` +
      `additionalRequest=${JSON.stringify(r.additionalRequest ?? "")} · createdAt=${stamp(r.createdAt)}`
  );
}

// ── corporate inquiries ──────────────────────────────────────────────
const corporate = await db.collection("corporateInquiries").get();
const corporateDocs = corporate.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
const flowCorporate = corporateDocs.filter((i) => i.email === FLOW_EMAIL || i.contactEmail === FLOW_EMAIL);
const earlierCorporate = corporateDocs.filter(
  (i) => isQaEmail(i.email) && i.email !== FLOW_EMAIL && i.contactEmail !== FLOW_EMAIL
);
console.log(`\ncorporate inquiries created by this pass: ${flowCorporate.length}`);
for (const i of flowCorporate) {
  console.log(
    `  id=${i.id} · status=${i.status ?? "?"} · company=${i.company ?? i.companyName ?? "?"} · ` +
      `email=${i.email ?? i.contactEmail} · createdAt=${stamp(i.createdAt)}`
  );
}
if (earlierCorporate.length) {
  console.log(`  (earlier QA pass, already tracked: ${earlierCorporate.length} corporate inquiries)`);
}

// ── contact messages ─────────────────────────────────────────────────
const contact = await db.collection("contactInquiries").get();
const contactDocs = contact.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
const flowContact = contactDocs.filter((i) => i.email === FLOW_EMAIL || i.guestEmail === FLOW_EMAIL);
const earlierContact = contactDocs.filter(
  (i) => (isQaEmail(i.email) || isQaEmail(i.guestEmail)) && i.email !== FLOW_EMAIL && i.guestEmail !== FLOW_EMAIL
);
console.log(`\ncontact inquiries created by this pass: ${flowContact.length}`);
for (const i of flowContact) {
  console.log(
    `  id=${i.id} · status=${i.status ?? "?"} · name=${i.name ?? "?"} · email=${i.email ?? i.guestEmail} · ` +
      `createdAt=${stamp(i.createdAt)}`
  );
}
if (earlierContact.length) {
  console.log(`  (earlier QA pass, already tracked: ${earlierContact.length} contact inquiries)`);
}

// ── anything else the QA flow could have left behind ─────────────────
for (const collection of ["bookingHolds", "holds", "notifications", "failed_emails"]) {
  const snap = await db.collection(collection).get();
  const hits = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
    .filter((r) => isQaEmail(r.email) || isQaEmail(r.guestEmail) || r.email === FLOW_EMAIL);
  if (hits.length) {
    console.log(`\n${collection} from the QA domain: ${hits.length}`);
    for (const h of hits) {
      const { lookupToken, ...rest } = h as Record<string, any>;
      console.log(`  id=${h.id} · ${JSON.stringify(rest).slice(0, 200)}`);
    }
  }
}

console.log("\n=== end ===");
