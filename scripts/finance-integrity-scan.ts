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
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { config as dotenv } from "dotenv";

export type FinanceIntegrityFinding = {
  findingId: string;
  cohort: "FL-02" | "FL-03" | "pre-FL-05" | "pricing-drift" | "non-finite";
  entityPath: string;
  issue: string;
  observedValue: string;
  expectedValue: string;
  proposedAction: "set-booking-total" | "append-store-delivery-tender" | "manual-review";
  proposedValue: string;
  approved: "NO" | "YES";
  reviewNotes: string;
};

const CSV_COLUMNS: Array<keyof FinanceIntegrityFinding> = [
  "findingId",
  "cohort",
  "entityPath",
  "issue",
  "observedValue",
  "expectedValue",
  "proposedAction",
  "proposedValue",
  "approved",
  "reviewNotes"
];

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value: number): string {
  return value.toFixed(2);
}

export function scanBookingRecord(bookingId: string, data: Record<string, any>): FinanceIntegrityFinding[] {
  const entityPath = `bookings/${bookingId}`;
  const totalPrice = finiteNumber(data.totalPrice);
  const breakdownFinal = finiteNumber(data.rateBreakdown?.finalTotal);
  const roomLines = Array.isArray(data.rateBreakdown?.roomLines) ? data.rateBreakdown.roomLines : [];
  const roomGross = roomLines.reduce((sum: number, line: any) => sum + (finiteNumber(line?.subtotal) || 0), 0);

  if (totalPrice === null) {
    return [{
      findingId: `${entityPath}:non-finite-total`,
      cohort: "non-finite",
      entityPath,
      issue: "Booking totalPrice is missing or non-finite.",
      observedValue: String(data.totalPrice),
      expectedValue: breakdownFinal === null ? "unknown" : money(breakdownFinal),
      proposedAction: "manual-review",
      proposedValue: "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  if (Math.abs(totalPrice) < 0.005 && roomGross > 0) {
    const canUseBreakdown = breakdownFinal !== null && breakdownFinal > 0;
    return [{
      findingId: `${entityPath}:zero-total-with-room-lines`,
      cohort: "FL-03",
      entityPath,
      issue: "Booking total is zero despite non-empty positive room lines.",
      observedValue: money(totalPrice),
      expectedValue: canUseBreakdown ? money(breakdownFinal) : "manual reconstruction required",
      proposedAction: canUseBreakdown ? "set-booking-total" : "manual-review",
      proposedValue: canUseBreakdown ? money(breakdownFinal) : "",
      approved: "NO",
      reviewNotes: ""
    }];
  }

  if (breakdownFinal !== null && Math.abs(breakdownFinal - totalPrice) >= 0.01) {
    const isRejectedPointsCohort = data.discountRejected === true && finiteNumber(data.pointsRedeemedValue) !== null
      && Number(data.pointsRedeemedValue) > 0;
    return [{
      findingId: `${entityPath}:breakdown-total-mismatch`,
      cohort: isRejectedPointsCohort ? "FL-02" : "pricing-drift",
      entityPath,
      issue: "rateBreakdown.finalTotal does not match totalPrice.",
      observedValue: money(totalPrice),
      expectedValue: money(breakdownFinal),
      proposedAction: "set-booking-total",
      proposedValue: money(breakdownFinal),
      approved: "NO",
      reviewNotes: ""
    }];
  }

  return [];
}

export function scanStoreOrderRecord(
  orderId: string,
  data: Record<string, any>,
  hasTender: boolean
): FinanceIntegrityFinding[] {
  const isDirectPaid = data.paymentMethod !== "add-to-bill";
  if (data.status !== "delivered" || !isDirectPaid || hasTender) return [];
  const totalAmount = finiteNumber(data.totalAmount);
  const entityPath = `storeOrders/${orderId}`;
  return [{
    findingId: `${entityPath}:missing-delivery-tender`,
    cohort: "pre-FL-05",
    entityPath,
    issue: "Delivered direct-paid store order has no settlement tender.",
    observedValue: "no tender",
    expectedValue: totalAmount === null ? "finite order total required" : money(totalAmount),
    proposedAction: totalAmount !== null && totalAmount > 0 ? "append-store-delivery-tender" : "manual-review",
    proposedValue: totalAmount !== null && totalAmount > 0 ? money(totalAmount) : "",
    approved: "NO",
    reviewNotes: ""
  }];
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function findingsToCsv(findings: FinanceIntegrityFinding[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const finding of findings) {
    rows.push(CSV_COLUMNS.map((column) => csvEscape(String(finding[column] ?? ""))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function findingsFromCsv(csv: string): FinanceIntegrityFinding[] {
  const [header, ...rows] = parseCsvRows(csv);
  if (!header || header.join(",") !== CSV_COLUMNS.join(",")) {
    throw new Error("Unexpected finance integrity CSV columns.");
  }
  return rows.map((row) => Object.fromEntries(CSV_COLUMNS.map((column, index) => [column, row[index] || ""])) as FinanceIntegrityFinding);
}

function initializeAdmin() {
  dotenv({ path: resolve(process.cwd(), "guest-app/.env") });
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error("Missing Firebase Admin variables in guest-app/.env.");
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

  writeFileSync(outputPath, findingsToCsv(findings), { encoding: "utf8", flag: "wx" });
  console.log(`Finance integrity scan complete for project ${projectId}.`);
  console.log(`Reviewed ${bookings.size} bookings and ${orders.size} store orders; found ${findings.length} item(s).`);
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
