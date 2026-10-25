// AI-BROWSER-QA (2026-10-25) — the side-effects tracker.
//
// Every production record this QA pass CREATED, listed by kind and
// reference. The QA brief requires every created record to be tracked.
//
// READ-ONLY.
//
// The QA guest email domain is `+sparkinn.dev@gmail.com`. The pass's
// own guest-flow email is `qa.browser.flow+sparkinn.dev@gmail.com`.

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

const vars = loadEnv("guest-app/.env.spark-inn-prod");
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

/** Anything whose email ends in the QA domain is a QA record. */
const isQaEmail = (v: unknown) => typeof v === "string" && v.endsWith("@gmail.com") && v.includes("+sparkinn.dev");

console.log("=== side effects — records CREATED by this QA pass ===\n");

// ── bookings ─────────────────────────────────────────────────────────
const bookings = await db.collection("bookings").get();
const flowBookings = bookings.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((b) => b.guestEmail === FLOW_EMAIL);
console.log(`bookings with ${FLOW_EMAIL}: ${flowBookings.length}`);
for (const b of flowBookings) {
  console.log(
    `  ${b.bookingRef} · id=${b.id} · status=${b.status} · room=${b.roomNumber} · ` +
      `checkIn=${JSON.stringify(b.checkIn)} · checkOut=${JSON.stringify(b.checkOut)} · ` +
      `total=${b.totalPrice} · otherAddOnTotal=${b.otherAddOnTotal ?? 0} · ` +
      `paymentMethod=${b.paymentMethod} · proof=${b.paymentProofPath ? "yes" : "no"} · ` +
      `createdAt=${b.createdAt ?? "?"}`
  );
  if (b.otherAddOnSelections) {
    const dates = Object.keys(b.otherAddOnSelections);
    console.log(`    other add-ons: ${dates.map((d) => `${d}=${b.otherAddOnSelections[d].length}`).join(", ") || "(none)"}`);
  }
}

// ── reservations ─────────────────────────────────────────────────────
const reservations = await db.collection("reservations").get();
const flowReservations = reservations.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((r) => isQaEmail(r.guestEmail) || flowBookings.some((b) => b.reservationId === r.id));
console.log(`\nreservations linked to the flow bookings: ${flowReservations.length}`);
for (const r of flowReservations) {
  console.log(`  ${r.reservationRef ?? "(no ref)"} · id=${r.id} · status=${r.status} · createdAt=${r.createdAt ?? "?"}`);
}

// ── inquiries + contact messages ──────────────────────────────────────
const inquiries = await db.collection("inquiries").get();
const flowInquiries = inquiries.docs
  .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
  .filter((i) => isQaEmail(i.email) || isQaEmail(i.guestEmail) || isQaEmail(i.contactEmail));
console.log(`\ninquiries/contact records from the QA domain: ${flowInquiries.length}`);
for (const i of flowInquiries) {
  console.log(
    `  id=${i.id} · status=${i.status ?? "?"} · company=${i.company ?? i.name ?? "?"} · ` +
      `email=${i.email ?? i.guestEmail ?? i.contactEmail} · createdAt=${i.createdAt ?? "?"}`
  );
}

// ── anything else the QA flow could have left behind ─────────────────
for (const collection of ["holds", "bookingHolds", "notifications", "failed_emails"]) {
  const snap = await db.collection(collection).get();
  const hits = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }))
    .filter((r) => isQaEmail(r.email) || isQaEmail(r.guestEmail) || r.email === FLOW_EMAIL);
  if (hits.length) {
    console.log(`\n${collection} from the QA domain: ${hits.length}`);
    for (const h of hits) console.log(`  id=${h.id} · ${JSON.stringify(h).slice(0, 180)}`);
  }
}

console.log("\n=== end ===");
