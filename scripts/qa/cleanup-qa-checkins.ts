// AI-BROWSER-QA (2026-10-26) — release the rooms held by QA check-ins.
//
// A checked-in booking sets its room to `occupied`, and the room's status is
// a single field — NOT date-aware. So a QA booking that is checked in holds
// its room for every other QA scenario, and the next run's check-in is
// refused with "Assigned room is already occupied by another checked-in
// booking".
//
// This script checks the QA bookings that are still checked in back out, so
// the room is released. It only touches bookings this pass created (the
// `isTestData` marker the repo's ETR-03 test-run mechanism stamps) — a real
// guest's booking is never touched.
//
//   node cleanup-qa-checkins.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
const qa = loadEnv("e2e/.qa.env.local");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY
    }),
    projectId: env.FIREBASE_PROJECT_ID
  });
}
const db = getFirestore();

const base = (qa.QA_GUEST_BASE_URL || "https://www.sparkinnbohol.com").replace(/\/$/, "");
const apiKey = qa.QA_FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY || "";
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
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Referer: `${base}/`
    },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }
);
const signInBody: any = await signIn.json().catch(() => ({}));
if (!signIn.ok || !signInBody?.idToken) {
  console.error("the QA admin sign-in failed.");
  process.exit(1);
}
const staffToken = signInBody.idToken as string;

const stuck = (await db.collection("bookings").get()).docs.filter(
  (d) =>
    d.data()?.isTestData === true &&
    d.data()?.status === "checked-in" &&
    String(d.data()?.roomNumber) === String(process.argv[2] || "101")
);
console.log(`QA bookings still checked in on room ${process.argv[2] || "101"}: ${stuck.length}`);

for (const doc of stuck) {
  const ref = String(doc.data()?.bookingRef || doc.id);
  const res = await fetch(`${base}/api/bookings/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({
      bookingId: doc.id,
      // The folio carries a positive balance (the stay was never paid), so
      // the departure needs an unpaid reason. "other" is one of the
      // server's accepted shortcuts.
      unpaidCheckoutReason: "other"
    })
  });
  const body = await res.text();
  console.log(`  ${ref} → checkout ${res.status} ${body.slice(0, 140)}`);
}

const rooms = (await db.collection("rooms").get()).docs
  .filter((d) => String(d.data()?.roomNumber) === "101")
  .map((d) => `${d.id}:${d.data()?.status}`);
console.log(`room 101 now: ${rooms.join(", ") || "(not found)"}`);

// ---- the store fixtures -------------------------------------------------
//
// The ST-04 scenario zeroes the probe item's stock while it is in the
// basket. If the scenario dies before its restore step, the fixture is
// left at 0 and every later run finds a sold-out probe item. The
// documented fixture value is 10.
const PROBE_ITEM_ID = "a7-stock-probe";
const PROBE_ITEM_STOCK = 10;
const probe = await db.collection("storeItems").doc(PROBE_ITEM_ID).get();
if (probe.exists) {
  const current = probe.data()?.stock;
  if (current !== PROBE_ITEM_STOCK) {
    await probe.ref.set(
      { stock: PROBE_ITEM_STOCK, updatedAt: new Date(), updatedBy: "qa-cleanup" },
      { merge: true }
    );
    console.log(`the probe item's stock was ${current} → restored to ${PROBE_ITEM_STOCK}`);
  } else {
    console.log(`the probe item's stock is already ${PROBE_ITEM_STOCK}`);
  }
} else {
  console.log("the probe item is missing — nothing to restore.");
}
