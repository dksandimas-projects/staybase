// AI-BROWSER-QA (2026-10-23) — final config probes: email delivery health,
// the senior/PWD discount flag, the other-add-on catalogue, and the
// store-order folio landing. READ-ONLY.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
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
const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  }),
  projectId: env.FIREBASE_PROJECT_ID
});
const db = getFirestore(app);

console.log("=== failed_emails (email delivery health) ===");
for (const id of ["failed_emails", "emails", "emailLog"]) {
  const snap = await db.collection(id).get();
  if (snap.empty) {
    console.log(`  ${id}: EMPTY`);
    continue;
  }
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    console.log(
      `  ${id}/${d.id}: action=${JSON.stringify(x.action ?? x.template)} ` +
        `to=${JSON.stringify(String(x.to ?? x.recipient ?? "").replace(/^(.).*(@.*)$/, "$1***$2"))} ` +
        `error=${JSON.stringify(x.error)} at=${JSON.stringify(x.createdAt ?? x.sentAt)}`
    );
  }
}

console.log("\n=== senior / PWD discount configuration ===");
const hotel = await db.collection("settings").doc("hotelConfig").get();
const h = hotel.data() as Record<string, unknown>;
console.log(`  seniorPwdOnlineEnabled = ${JSON.stringify(h.seniorPwdOnlineEnabled)}`);
console.log(`  discountScope = ${JSON.stringify(h.discountScope)}`);

console.log("\n=== addOns catalogue (other add-ons) ===");
const addOns = await db.collection("addOns").get();
for (const d of addOns.docs) {
  const x = d.data() as Record<string, unknown>;
  console.log(`  ${d.id}: ${JSON.stringify(x).slice(0, 700)}`);
}

console.log("\n=== store order folio landing (ST-02) ===");
const storeOrders = await db.collection("storeOrders").get();
const bookings = await db.collection("bookings").get();
for (const o of storeOrders.docs) {
  const x = o.data() as Record<string, unknown>;
  if (x.paymentMethod !== "add-to-bill") continue;
  const b = bookings.docs.find((d) => d.id === x.bookingId);
  console.log(
    `  ${x.orderRef} status=${x.status} total=${x.totalAmount} isBilled=${x.isBilled} ` +
      `bookingId=${x.bookingId} → booking found: ${!!b}`
  );
}

console.log("\n=== the 4 corporate bookings (MRB-11c / CO-04) ===");
for (const b of bookings.docs) {
  const x = b.data() as Record<string, unknown>;
  if (x.source !== "corporate") continue;
  console.log(
    `  ${x.bookingRef} totalPrice=${x.totalPrice} reservationId=${x.reservationId ?? "<none>"} ` +
      `allocation=${JSON.stringify(x.revenueAllocation)} corporateCode=${JSON.stringify(x.corporateCode ?? null)} ` +
      `company=${JSON.stringify(x.companyName ?? null)}`
  );
}
