/**
 * PRC-18 — Legacy status audit
 *
 * Identifies bookings where status is `payment-confirmed` or `confirmed`
 * but have no corresponding payment-ledger entry. These are bookings that
 * were confirmed via the old status-only `mark-payment-confirmed` flow
 * (before PRC-13 added atomic ledger creation).
 *
 * Run: `npx ts-node guest-app/server/janitor/audit-legacy-payment-status.ts`
 *
 * Output: JSON array of booking IDs + refs + totalPrice to stdout.
 * Review the list and decide whether to create manual payment entries.
 */

import * as admin from "firebase-admin";

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "spark-inn";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();

async function audit(): Promise<void> {
  const candidates: Array<{ id: string; bookingRef: string; totalPrice: number; status: string; paymentProofUrl: string | null }> = [];
  const seen = new Set<string>();

  const snapshot = await db.collection("bookings")
    .where("status", "in", ["payment-confirmed", "confirmed"])
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const id = doc.id;

    const paymentsSnap = await db.collection("bookings").doc(id).collection("payments").get();
    const hasLedgerEntry = paymentsSnap.docs.some((p) => p.data().type === "payment");

    if (!hasLedgerEntry) {
      candidates.push({
        id,
        bookingRef: data.bookingRef || "unknown",
        totalPrice: Number(data.totalPrice || 0),
        status: data.status,
        paymentProofUrl: data.paymentProofUrl || null
      });
      seen.add(id);
    }
  }

  console.log(JSON.stringify(candidates, null, 2));
  console.error(`\nFound ${candidates.length} booking(s) with confirmed status but no payment ledger entry.`);

  if (candidates.length > 0) {
    console.error("\nAction required: For each booking, create a manual payment entry or");
    console.error("use the verify-and-record flow in the admin dashboard to record the collection.");
    console.error("Do NOT auto-generate entries — each requires staff validation of amount, method, and date.");
  }
}

audit().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
