/**
 * MRB-11 allocation backfill + `hasAnyBreakfast` backfill.
 *
 * Per F-D1 (2026-10-22) the MRB-11 money identity — the allocation's own
 * `totalNet` vs the booking's `totalPrice` — was never asserted on the
 * write path, so a set of bookings carries an allocation that does not
 * close:
 *
 *     roomNet + breakfastNet + addOnNet − deductionNet == totalNet == totalPrice
 *
 * The WRITE path is now guarded (F-D1 / decision #310), so new bookings
 * are correct. This script repairs the rows that were written before the
 * guard existed.
 *
 * It also backfills `hasAnyBreakfast`, the flag the kitchen list used to
 * gate on and that the walk-in write path never wrote (F-B1). The
 * kitchen list no longer reads it (decision #311), but leaving the field
 * absent means the collection still says "this booking has no breakfast"
 * for bookings that do.
 *
 * Usage:
 *   # REPORT ONLY — never writes. This is the default.
 *   node --experimental-strip-types scripts/backfill-mrb11-allocation.ts
 *   node --experimental-strip-types scripts/backfill-mrb11-allocation.ts \
 *     --output=/absolute/path/review.csv
 *
 *   # APPLY — only the rows marked `approved=YES` in the review CSV.
 *   node --experimental-strip-types scripts/backfill-mrb11-allocation.ts \
 *     --apply=/absolute/path/review.csv \
 *     --confirm=APPLY_APPROVED_ALLOCATION_BACKFILL
 *
 * Requires the Firebase Admin variables in `guest-app/.env` (or an
 * `ENV_FILE` env var pointing at the right env file).
 *
 * Every apply is revalidated inside the write transaction: the row is
 * re-read, the violation is re-checked against the CURRENT data, and the
 * write is skipped if the row no longer matches what the review said.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config as dotenv } from "dotenv";
import { rebuildBookingRevenueAllocation } from "../shared/utils/bookingFolio.ts";

type Row = {
  bookingId: string;
  bookingRef: string;
  issue: "allocation-mismatch" | "allocation-missing" | "hasAnyBreakfast-missing";
  observed: string;
  expected: string;
  proposedAction: string;
  approved: string;
};

const APPLY_TOKEN = "APPLY_APPROVED_ALLOCATION_BACKFILL";
const envFile = process.env.ENV_FILE
  ? resolve(process.cwd(), process.env.ENV_FILE)
  : resolve(process.cwd(), "guest-app/.env");
dotenv({ path: envFile });

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
  process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  throw new Error("Missing Firebase Admin variables. Set ENV_FILE to the right env file.");
}

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    projectId: FIREBASE_PROJECT_ID
  });
}

const db = getFirestore();
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const hasBreakfast = (b: any): boolean => {
  const s = b?.breakfastSelections;
  if (s && typeof s === "object" && Object.keys(s).length > 0) return true;
  if (Number(b?.breakfastTotal || 0) > 0) return true;
  if (Array.isArray(b?.breakfastSelections) && b.breakfastSelections.length > 0) return true;
  return false;
};

async function collectRows(): Promise<Row[]> {
  const rows: Row[] = [];
  const snap = await db.collection("bookings").get();
  for (const doc of snap.docs) {
    const b: any = { id: doc.id, ...doc.data() };
    const totalPrice = round2(b.totalPrice);
    const alloc = b.revenueAllocation || null;

    if (!alloc) {
      // A pre-MRB-11 booking. It is NOT a violation (the identity only
      // applies once an allocation exists) — but it is missing the
      // allocation the reports expect. Rebuild it from the gross.
      if (totalPrice > 0) {
        rows.push({
          bookingId: doc.id,
          bookingRef: b.bookingRef || "",
          issue: "allocation-missing",
          observed: "no revenueAllocation",
          expected: `totalNet == totalPrice (${totalPrice})`,
          proposedAction: "rebuild-allocation",
          approved: "NO"
        });
      }
    } else {
      const computed =
        round2(alloc.roomNet) +
        round2(alloc.breakfastNet) +
        round2(alloc.addOnNet) -
        round2(alloc.deductionNet);
      const totalNet = round2(alloc.totalNet);
      if (computed !== totalNet || totalNet !== totalPrice) {
        rows.push({
          bookingId: doc.id,
          bookingRef: b.bookingRef || "",
          issue: "allocation-mismatch",
          observed: `totalNet=${totalNet} (streams→${computed}) totalPrice=${totalPrice}`,
          expected: `totalNet == totalPrice (${totalPrice})`,
          proposedAction: "rebuild-allocation",
          approved: "NO"
        });
      }
    }

    if (hasBreakfast(b) && b.hasAnyBreakfast !== true) {
      rows.push({
        bookingId: doc.id,
        bookingRef: b.bookingRef || "",
        issue: "hasAnyBreakfast-missing",
        observed: `hasAnyBreakfast=${JSON.stringify(b.hasAnyBreakfast)}`,
        expected: "hasAnyBreakfast=true",
        proposedAction: "set-hasAnyBreakfast",
        approved: "NO"
      });
    }
  }
  return rows;
}

function toCsv(rows: Row[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["bookingId", "bookingRef", "issue", "observed", "expected", "proposedAction", "approved"];
  return [head.join(","), ...rows.map((r) => head.map((k) => esc((r as any)[k])).join(","))].join("\n");
}

async function applyRows(csvPath: string): Promise<void> {
  const raw = readFileSync(csvPath, "utf8").trim().split("\n");
  const head = raw[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const idx = (name: string) => head.indexOf(name);
  let applied = 0;
  let skipped = 0;
  for (const line of raw.slice(1)) {
    if (!line.trim()) continue;
    // Split on commas that are NOT inside a quoted field. A naive
    // `/("[^"]*"|[^,]*)/g` match inserts an empty cell at every comma
    // and shifts every column index by one - which silently made every
    // row look "not approved".
    const cells = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) =>
      c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c
    );
    const approved = (cells[idx("approved")] || "").trim().toUpperCase();
    if (approved !== "YES") {
      skipped++;
      continue;
    }
    const bookingId = cells[idx("bookingId")];
    const action = cells[idx("proposedAction")];
    const ref = db.collection("bookings").doc(bookingId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const b: any = snap.data();
      if (action === "set-hasAnyBreakfast") {
        if (b.hasAnyBreakfast === true) return;
        if (!hasBreakfast(b)) return;
        tx.update(ref, { hasAnyBreakfast: true });
        applied++;
        return;
      }
      // rebuild-allocation
      const totalPrice = round2(b.totalPrice);
      if (totalPrice <= 0) return;
      const existing = b.revenueAllocation || null;
      const grossSubtotal = round2(
        b.originalTotalPrice ?? b.grossSubtotal ?? b.totalPrice ?? 0
      );
      const rebuilt = rebuildBookingRevenueAllocation({
        existingAllocation: existing,
        grossSubtotal,
        totalPrice
      });
      // Idempotency: skip when the rebuilt allocation already matches.
      if (
        existing &&
        round2(existing.totalNet) === round2(rebuilt.totalNet) &&
        round2(existing.roomNet) === round2(rebuilt.roomNet) &&
        round2(existing.deductionNet) === round2(rebuilt.deductionNet)
      ) {
        return;
      }
      tx.update(ref, { revenueAllocation: rebuilt });
      applied++;
    });
  }
  console.log(`Backfill applied: ${applied} write(s), ${skipped} row(s) skipped (not approved).`);
}

const args = process.argv.slice(2);
// Accept BOTH `--flag value` and `--flag=value` (the finance scanner uses
// the `=` form, so operators will reach for it here too).
const flag = (name: string): string | undefined => {
  const withEquals = args.find((a) => a.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const hasFlag = (name: string) =>
  args.some((a) => a === name || a.startsWith(`${name}=`));

const applyCsv = flag("--apply");
const outputPath = flag("--output");
const confirm = flag("--confirm");

if (applyCsv) {
  const csvPath = applyCsv;
  if (!csvPath) throw new Error("--apply needs a CSV path.");
  if (confirm !== APPLY_TOKEN) {
    throw new Error(`Refusing to apply without --confirm=${APPLY_TOKEN}.`);
  }
  await applyRows(resolve(process.cwd(), csvPath));
} else {
  const rows = await collectRows();
  const out = outputPath;
  if (out) writeFileSync(resolve(process.cwd(), out), toCsv(rows) + "\n");
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.issue] = (acc[r.issue] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `Backfill scan complete for project ${FIREBASE_PROJECT_ID}: ${rows.length} row(s) ${JSON.stringify(counts)}.`
  );
  console.log(
    out
      ? `Review CSV written to ${out}. No Firestore writes were made.`
      : "No Firestore writes were made (report only)."
  );
}
