/**
 * One-off Finance Lifecycle historical integrity scanner (FLR-01).
 *
 * Report only:
 *   node --experimental-strip-types scripts/finance-integrity-scan.ts --output=/absolute/path/review.csv
 *
 * Apply only rows manually changed to approved=YES:
 *   node --experimental-strip-types scripts/finance-integrity-scan.ts --apply=/absolute/path/review.csv \
 *     --confirm=APPLY_APPROVED_FINANCE_REPAIRS
 *
 * Requires Firebase Admin variables in guest-app/.env. The default mode never
 * writes to Firestore. Apply mode revalidates every approved row transactionally.
 *
 * SCOPE (per F-D3, 2026-10-27)
 * ---------------------------
 * This scanner covers BOTH sides now:
 *
 *   * the PRICING invariants (the original FLR-01 scope): the booking
 *     total vs its rate breakdown, the revenue allocation, the
 *     corporate allocation, the other-add-on scope, and a delivered
 *     direct-paid store order's missing tender;
 *   * the LEDGER invariants: an orphan payment / refund / charge (one
 *     naming a booking that does not exist), a non-finite or negative
 *     money amount, and a refund larger than the money collected.
 *
 * The ledger findings are REPORT-ONLY (`manual-review`): this script's
 * automatic repairs are for pricing drift, and silently repairing a
 * ledger is the kind of wide repair the audit rules forbid.
 *
 * The CONTINUOUS coverage is the nightly reconciliation
 * (`scripts/qa/reconcile-production.ts` — checks I05, I06, I07, I08,
 * I12, I14, I17), which runs against production every night. This
 * script is the offline counterpart for the one-off repair workflow.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  type FinanceIntegrityFinding,
  CSV_COLUMNS,
  finiteNumber,
  money,
  scanBookingRecord,
  scanStoreOrderRecord,
  scanLedgerRecord,
  scanRefundCoverage,
  findingsToCsv,
  findingsFromCsv
} from "./finance-scan-core.ts";

// Re-export the pure half so the existing importers
// (`guest-app/tests/api/finance-integrity-scan.test.ts`)
// keep working against one entry point.
export * from "./finance-scan-core.ts";

/**
 * Load the env file WITHOUT `dotenv`.
 *
 * Per the admin-build fix (2026-10-27): `dotenv` is not reachable
 * from the admin app's dependency closure, so importing it here put
 * the script into the admin app's TypeScript program and broke every
 * admin deployment with `error TS2307: Cannot find module 'dotenv'`.
 *
 * This loader is the same one `scripts/qa/reconcile-production.ts`
 * and `scripts/qa/export-prod-data.ts` already use — a flat
 * KEY=VALUE file with `#` comments, optional surrounding quotes and
 * `\n` escapes. Keeping the script's dependency surface to
 * `firebase-admin` alone means it can no longer pull an undeclared
 * package into an app build even by accident.
 */
function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value.replace(/\\n/g, "\n");
  }
  return out;
}

function initializeAdmin() {
  const env = loadEnv(process.env.ENV_FILE || "guest-app/.env.spark-inn-prod");
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing Firebase Admin variables in guest-app/.env.spark-inn-prod.");
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return { db: getFirestore(), projectId: FIREBASE_PROJECT_ID };
}

async function scan(outputPath: string) {
  const { db, projectId } = initializeAdmin();
  const findings: FinanceIntegrityFinding[] = [];
  const bookings = await db.collection("bookings").get();
  for (const booking of bookings.docs) findings.push(...scanBookingRecord(booking.id, booking.data()));

  const orders = await db.collection("storeOrders").get();
  for (const order of orders.docs) {
    const deliveryTender = await order.ref.collection("payments").doc("delivery-tender").get();
    findings.push(...scanStoreOrderRecord(order.id, order.data(), deliveryTender.exists));
  }

  // Per F-D3 (2026-10-27): the LEDGER pass. The scanner previously
  // read only the pricing side, so running it gave false confidence
  // that the money was sound.
  //
  // `payments` and `refunds` live in SUBcollections (under a booking or
  // a reservation), so they are read with a collection group. `charges`
  // is a root collection.
  //
  // The store orders' own `payments/delivery-tender` documents are
  // included by the group query; a tender names no `bookingId`, so it
  // never trips the orphan check.
  const knownBookingIds = new Set(bookings.docs.map((b) => b.id));

  const paymentGroups = await db.collectionGroup("payments").get();
  for (const doc of paymentGroups.docs) {
    findings.push(
      ...scanLedgerRecord("payments", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  const refundGroups = await db.collectionGroup("refunds").get();
  for (const doc of refundGroups.docs) {
    findings.push(
      ...scanLedgerRecord("refunds", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  const chargeDocs = await db.collection("charges").get();
  for (const doc of chargeDocs.docs) {
    findings.push(
      ...scanLedgerRecord("charges", doc.ref.path, doc.data(), knownBookingIds)
    );
  }

  // L4: refunds larger than what was collected, per booking.
  const collectedByBooking = new Map<string, number>();
  for (const doc of paymentGroups.docs) {
    const d = doc.data() || {};
    const bookingId = String(d.bookingId ?? "").trim();
    const amount = finiteNumber(d.amount);
    if (!bookingId || amount === null) continue;
    collectedByBooking.set(
      bookingId,
      (collectedByBooking.get(bookingId) || 0) + amount
    );
  }
  const refundedByBooking = new Map<string, number>();
  for (const doc of refundGroups.docs) {
    const d = doc.data() || {};
    const bookingId = String(d.bookingId ?? "").trim();
    const amount = finiteNumber(d.amount);
    if (!bookingId || amount === null) continue;
    refundedByBooking.set(
      bookingId,
      (refundedByBooking.get(bookingId) || 0) + Math.abs(amount)
    );
  }
  for (const [bookingId, refunded] of refundedByBooking) {
    const collected = collectedByBooking.get(bookingId) || 0;
    findings.push(
      ...scanRefundCoverage(`bookings/${bookingId}`, collected, refunded)
    );
  }

  writeFileSync(outputPath, findingsToCsv(findings), { encoding: "utf8", flag: "wx" });
  console.log(`Finance integrity scan complete for project ${projectId}.`);
  console.log(
    `Reviewed ${bookings.size} bookings, ${orders.size} store orders, ` +
    `${paymentGroups.size} payment(s), ${refundGroups.size} refund(s) and ` +
    `${chargeDocs.size} charge(s); found ${findings.length} item(s).`
  );
  console.log(`Review CSV written to ${outputPath}. No Firestore writes were made.`);
}

function auditId(findingId: string): string {
  return createHash("sha256").update(findingId).digest("hex").slice(0, 32);
}

async function applyApproved(csvPath: string, confirmation: string) {
  if (confirmation !== "APPLY_APPROVED_FINANCE_REPAIRS") {
    throw new Error("Apply mode requires --confirm=APPLY_APPROVED_FINANCE_REPAIRS.");
  }
  const approved = findingsFromCsv(readFileSync(csvPath, "utf8")).filter((row) => row.approved === "YES");
  const { db, projectId } = initializeAdmin();
  let applied = 0;
  let skipped = 0;

  for (const finding of approved) {
    const [collectionName, documentId] = finding.entityPath.split("/");
    if (!collectionName || !documentId || finding.entityPath.split("/").length !== 2) {
      throw new Error(`Invalid entity path in approved row: ${finding.entityPath}`);
    }
    const entityRef = db.collection(collectionName).doc(documentId);
    const repairAuditRef = db.collection("financeIntegrityRepairs").doc(auditId(finding.findingId));

    const outcome = await db.runTransaction(async (transaction) => {
      const entityDoc = await transaction.get(entityRef);
      const existingAudit = await transaction.get(repairAuditRef);
      if (existingAudit.exists) return "skipped";
      if (!entityDoc.exists) throw new Error(`Approved entity no longer exists: ${finding.entityPath}`);
      const data = entityDoc.data()!;

      if (finding.proposedAction === "set-booking-total" && collectionName === "bookings") {
        const observed = finiteNumber(data.totalPrice);
        const expectedObserved = finiteNumber(finding.observedValue);
        const proposed = finiteNumber(finding.proposedValue);
        const currentBreakdownFinal = finiteNumber(data.rateBreakdown?.finalTotal);
        if (observed === null || expectedObserved === null || proposed === null
          || Math.abs(observed - expectedObserved) >= 0.01
          || currentBreakdownFinal === null || Math.abs(currentBreakdownFinal - proposed) >= 0.01) {
          throw new Error(`Booking changed after review; refusing repair: ${finding.entityPath}`);
        }
        transaction.update(entityRef, { totalPrice: proposed, updatedAt: FieldValue.serverTimestamp() });
        transaction.create(repairAuditRef, {
          findingId: finding.findingId,
          cohort: finding.cohort,
          entityPath: finding.entityPath,
          action: finding.proposedAction,
          before: observed,
          after: proposed,
          reviewNotes: finding.reviewNotes,
          appliedAt: FieldValue.serverTimestamp(),
          appliedBy: "finance-integrity-scan"
        });
        return "applied";
      }

      if (finding.proposedAction === "append-store-delivery-tender" && collectionName === "storeOrders") {
        const amount = finiteNumber(data.totalAmount);
        const proposed = finiteNumber(finding.proposedValue);
        if (data.status !== "delivered" || data.paymentMethod === "add-to-bill" || amount === null || proposed === null
          || amount <= 0 || Math.abs(amount - proposed) >= 0.01) {
          throw new Error(`Store order changed after review; refusing repair: ${finding.entityPath}`);
        }
        const tenderRef = entityRef.collection("payments").doc("delivery-tender");
        const tenderDoc = await transaction.get(tenderRef);
        if (tenderDoc.exists) return "skipped";
        const recordedAt = data.deliveredAt || data.createdAt || FieldValue.serverTimestamp();
        transaction.create(tenderRef, {
          type: "payment",
          amount,
          method: data.paymentMethod === "cod" ? "cash" : String(data.paymentMethod || "unknown"),
          note: `Historical direct store payment for ${String(data.orderRef || documentId)}`.slice(0, 500),
          reason: null,
          approvedBy: null,
          recordedBy: "finance-integrity-scan",
          recordedAt,
          source: "store-order",
          sourceId: documentId,
          orderRef: String(data.orderRef || documentId),
          roomNumber: String(data.roomNumber || ""),
          guestName: String(data.guestName || "")
        });
        transaction.create(repairAuditRef, {
          findingId: finding.findingId,
          cohort: finding.cohort,
          entityPath: finding.entityPath,
          action: finding.proposedAction,
          amount,
          reviewNotes: finding.reviewNotes,
          appliedAt: FieldValue.serverTimestamp(),
          appliedBy: "finance-integrity-scan"
        });
        return "applied";
      }

      throw new Error(`Approved row has no supported repair action: ${finding.findingId}`);
    });
    if (outcome === "applied") applied += 1;
    else skipped += 1;
  }

  console.log(`Finance integrity apply complete for project ${projectId}: ${applied} applied, ${skipped} already resolved.`);
}

function argValue(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

async function main() {
  const output = argValue("output");
  const apply = argValue("apply");
  if (Boolean(output) === Boolean(apply)) {
    throw new Error("Choose exactly one mode: --output=/absolute/review.csv or --apply=/absolute/review.csv.");
  }
  if (output) await scan(resolve(output));
  else await applyApproved(resolve(apply), argValue("confirm"));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

