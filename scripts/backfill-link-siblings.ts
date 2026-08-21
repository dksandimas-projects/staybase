/**
 * One-off MED-3 G2 sibling-link backfill (2026-08-20).
 *
 * Per `plan/features/SPARK-REWARDS.md §Front-desk manual
 * link` follow-up note + the spec at
 * `plan/project/ROADMAP.md §MED-3 build-variant follow-ups
 * (G2)`: the pre-G2 front-desk manual link handler only
 * stamped `memberId` on the resolved booking doc, so any
 * post-MRB-01 (2026-08-02) reservation link via the
 * pre-existing raw-doc-id lookup orphaned the siblings —
 * the member's My Stays list
 * (`handleListMemberStays` at `members.ts:192` queries
 * `bookings.where("memberId", "==", uid)` on the flat
 * `bookings` collection with no reservation expansion) only
 * showed the lead child.
 *
 * G2 (this commit's shipping handler) fans the
 * `memberId` write out to every sibling in the same
 * `runTransaction`, so NEW links from the G1 surface
 * (the just-shipped `fix/med-3-lookup-by-ref` branch)
 * don't orphan siblings. This backfill cleans up
 * PRE-EXISTING orphans: every `bookings` doc that has
 * `memberId != null && reservationId != null` but
 * whose siblings in the same reservation are missing
 * `memberId`.
 *
 * Report only (default — never writes):
 *
 *   node --experimental-strip-types scripts/backfill-link-siblings.mjs \
 *     --output=/absolute/path/orphans.csv
 *
 * Apply only rows manually changed to approved=YES:
 *
 *   node --experimental-strip-types scripts/backfill-link-siblings.mjs \
 *     --apply=/absolute/path/orphans.csv \
 *     --confirm=APPLY_APPROVED_MED3_BACKFILLS
 *
 * Gate: refuses to run if NODE_ENV === "production" unless
 * --confirm=APPLY_APPROVED_MED3_BACKFILLS is passed
 * explicitly (per the MED-3 spec's "gated on
 * `NODE_ENV !== "production"` first-pass review"
 * instruction; mirrors `finance-integrity-scan.ts`).
 *
 * Requires the same Firebase Admin credentials in
 * guest-app/.env (FIREBASE_PROJECT_ID +
 * FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) that the
 * other admin scripts use.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config as dotenv } from "dotenv";

export type Med3BackfillFinding = {
  findingId: string;
  reservationId: string;
  leadBookingId: string;
  orphanBookingIds: string[];
  totalOrphans: number;
  action: "stamp-member-id-siblings";
  proposedUpdates: Array<{ bookingId: string; fromMemberId: string | null; toMemberId: string }>;
  approved: "YES" | "NO";
};

function hashFindingId(reservationId: string, leadBookingId: string, orphanBookingIds: string[]): string {
  return createHash("sha256")
    .update(`${reservationId}:${leadBookingId}:${orphanBookingIds.sort().join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

async function loadFirestore() {
  // The script reuses the same `.env` shape the
  // guest-app server uses (FIREBASE_PROJECT_ID +
  // FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).
  // The `.env` path is resolved relative to the
  // repo root, not the script's CWD.
  const repoRoot = resolve(import.meta.dirname, "..");
  dotenv({ path: resolve(repoRoot, "guest-app/.env") });
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials missing. Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in guest-app/.env."
    );
  }
  if (getApps().length === 0) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore();
}

async function discoverOrphans(db: FirebaseFirestore.Firestore): Promise<Med3BackfillFinding[]> {
  // The "orphan" pattern per the spec: a reservation
  // where at least one child has `memberId != null`
  // (the lead was linked pre-G2) AND at least one
  // sibling has `memberId == null` (the orphans).
  // We group by `reservationId` + dedupe per
  // reservation.
  const linkedChildrenSnap = await db
    .collection("bookings")
    .where("memberId", "!=", null)
    .where("reservationId", "!=", null)
    .get();
  const groupedByReservation = new Map<string, Array<{ id: string; data: FirebaseFirestore.DocumentData }>>();
  for (const doc of linkedChildrenSnap.docs) {
    const data = doc.data() || {};
    const reservationId = String(data.reservationId || "").trim();
    if (!reservationId) continue;
    const arr = groupedByReservation.get(reservationId) || [];
    arr.push({ id: doc.id, data });
    groupedByReservation.set(reservationId, arr);
  }

  const findings: Med3BackfillFinding[] = [];
  for (const [reservationId, linkedChildren] of groupedByReservation.entries()) {
    // Find the lead (the linked child is the
    // canonical lead in the pre-G2 surface; pick
    // the one with the lowest `reservationPosition`
    // — same MRB-07 contract the FOL-05 surface
    // uses).
    const lead = linkedChildren
      .slice()
      .sort((a, b) => Number(a.data.reservationPosition || 0) - Number(b.data.reservationPosition || 0))[0];
    const leadMemberId = String(lead.data.memberId || "").trim();
    if (!leadMemberId) continue;

    // Query the siblings in the same reservation
    // and find the orphans (memberId == null).
    const siblingsSnap = await db
      .collection("bookings")
      .where("reservationId", "==", reservationId)
      .get();
    const orphans = siblingsSnap.docs
      .map((d) => ({ id: d.id, data: d.data() || {} }))
      .filter((b) => !b.data.memberId);
    if (orphans.length === 0) continue;

    findings.push({
      findingId: hashFindingId(reservationId, lead.id, orphans.map((o) => o.id)),
      reservationId,
      leadBookingId: lead.id,
      orphanBookingIds: orphans.map((o) => o.id),
      totalOrphans: orphans.length,
      action: "stamp-member-id-siblings",
      proposedUpdates: orphans.map((o) => ({
        bookingId: o.id,
        fromMemberId: null,
        toMemberId: leadMemberId
      })),
      approved: "NO"
    });
  }
  // Sort by findingId for deterministic output.
  return findings.sort((a, b) => a.findingId.localeCompare(b.findingId));
}

function toCsv(findings: Med3BackfillFinding[]): string {
  const header = [
    "findingId",
    "reservationId",
    "leadBookingId",
    "orphanBookingIds",
    "totalOrphans",
    "action",
    "proposedUpdates",
    "approved"
  ];
  const rows = findings.map((f) => [
    f.findingId,
    f.reservationId,
    f.leadBookingId,
    f.orphanBookingIds.join("|"),
    String(f.totalOrphans),
    f.action,
    f.proposedUpdates.map((u) => `${u.bookingId}:${u.fromMemberId ?? "null"}→${u.toMemberId}`).join("|"),
    f.approved
  ]);
  return [header, ...rows].map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

async function runReport(outputPath: string) {
  const db = await loadFirestore();
  const findings = await discoverOrphans(db);
  writeFileSync(outputPath, toCsv(findings), "utf8");
  console.log(`[report] wrote ${findings.length} findings to ${outputPath}`);
  console.log(`[report] total orphans: ${findings.reduce((s, f) => s + f.totalOrphans, 0)}`);
}

async function runApply(applyPath: string) {
  // Gate: refuse to run against production unless
  // the explicit confirmation is passed (per the
  // MED-3 spec + the `finance-integrity-scan.ts`
  // pattern).
  if (process.env.NODE_ENV === "production") {
    if (process.argv.includes("--confirm=APPLY_APPROVED_MED3_BACKFILLS")) {
      console.warn("[apply] running against production with explicit confirmation");
    } else {
      throw new Error(
        "Refusing to run apply against production. Pass --confirm=APPLY_APPROVED_MED3_BACKFILLS to acknowledge."
      );
    }
  }
  const db = await loadFirestore();
  const raw = readFileSync(applyPath, "utf8");
  // Minimal CSV parser — header + quoted fields, no
  // embedded newlines. Sufficient for the script's
  // own output shape.
  const lines = raw.split("\n").filter(Boolean);
  const approved = lines
    .slice(1)
    .map((line) => {
      const cols = line.match(/"((?:[^"]|"")*)"/g) || [];
      return {
        findingId: (cols[0] || "").slice(1, -1).replace(/""/g, '"'),
        reservationId: (cols[1] || "").slice(1, -1).replace(/""/g, '"'),
        leadBookingId: (cols[2] || "").slice(1, -1).replace(/""/g, '"'),
        orphanBookingIds: ((cols[3] || "").slice(1, -1).replace(/""/g, '"')).split("|").filter(Boolean),
        approved: (cols[7] || "").slice(1, -1).replace(/""/g, '"')
      };
    })
    .filter((f) => f.approved === "YES");

  console.log(`[apply] ${approved.length} approved findings`);
  let updated = 0;
  for (const f of approved) {
    // Per-finding transaction: read the lead
    // (canonical source of truth for the member
    // mapping) + the orphans, then stamp
    // `memberId` on every orphan. The lead
    // shouldn't change.
    await db.runTransaction(async (tx) => {
      const leadSnap = await tx.get(db.collection("bookings").doc(f.leadBookingId));
      const leadMemberId = leadSnap.exists ? String(leadSnap.data()?.memberId || "").trim() : "";
      if (!leadMemberId) {
        console.warn(`[apply] skipping ${f.findingId}: lead has no memberId`);
        return;
      }
      for (const orphanId of f.orphanBookingIds) {
        const orphanRef = db.collection("bookings").doc(orphanId);
        tx.update(orphanRef, {
          memberId: leadMemberId,
          // Mirror the G2 handler's stamp set
          // exactly so the backfill is
          // byte-equivalent to a fresh G2 link.
          // `linkedByStaff` is empty (it's a
          // backfill, not a staff action);
          // `linkedReason` flags the backfill so a
          // future auditor can see the provenance.
          linkedByStaff: "",
          linkedAt: new Date(),
          linkedReason: "MED-3 G2 backfill (per find-or-create audit row)",
          updatedAt: new Date()
        });
        updated++;
      }
    });
    // Write a `manual-link-member` audit row per
    // finding so the backfill is auditable (the
    // existing G2 audit-row shape reads
    // `linkedBookingIds` for the fan-out set).
    await db
      .collection("bookings")
      .doc("audit")
      .collection("records")
      .doc(`med3-g2-backfill-${f.findingId}`)
      .set({
        action: "med3-g2-backfill",
        reservationId: f.reservationId,
        leadBookingId: f.leadBookingId,
        orphanBookingIds: f.orphanBookingIds,
        staffUid: "system-backfill",
        staffRole: "system",
        reason: "MED-3 G2 sibling-link backfill (per script backfill-link-siblings.mjs)",
        at: new Date()
      });
  }
  console.log(`[apply] updated ${updated} orphan booking(s)`);
}

async function main() {
  const args = process.argv.slice(2);
  const outputIdx = args.findIndex((a) => a.startsWith("--output="));
  const applyIdx = args.findIndex((a) => a.startsWith("--apply="));
  if (outputIdx >= 0) {
    const outputPath = args[outputIdx].slice("--output=".length);
    await runReport(outputPath);
    return;
  }
  if (applyIdx >= 0) {
    const applyPath = args[applyIdx].slice("--apply=".length);
    await runApply(applyPath);
    return;
  }
  console.error("Usage:");
  console.error("  Report:  node --experimental-strip-types scripts/backfill-link-siblings.mjs --output=/path/orphans.csv");
  console.error("  Apply:   node --experimental-strip-types scripts/backfill-link-siblings.mjs --apply=/path/orphans.csv --confirm=APPLY_APPROVED_MED3_BACKFILLS");
  process.exit(1);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});