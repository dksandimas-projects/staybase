// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): the staff-side "Mark as paid"
// endpoint for the BR-01 `breakfastRefundContext`
// refund-liability entries.
//
//   POST /api/bookings/breakfast/mark-refund-paid
//
// Body: `{ bookingId, refundId, method, transactionReference?, note? }`.
//
// Behaviour:
//
//   • STAFF-Token gated (handled in apiRouter via
//     `authenticateStaff`).
//
//   • Refuses if the refund entry doesn't exist, isn't
//     a `breakfast` category entry, or is already
//     marked paid (idempotent re-POST returns the
//     existing paid entry — same shape as `handleAddRefund`'s
//     CRL-01 idempotency).
//
//   • Writes a transactional update that flips
//     `status: "pending" → "paid"`, stamps `paidAt +
//     paidBy + method + transactionReference + note`.
//     Uses the same `refunds/{refundId}` doc shape the
//     BR-04 guest path creates (the doc ID matches the
//     pending entry so the staff "Mark as paid" is
//     idempotent + atomic with the booking mutation
//     when the entry was created by a remove op).
//
//   • Appends a `breakfastAudit/{autoId}` entry with
//     `action: "serve"` action variant `mark-refund-paid`
//     (added by BR-05 — the action enum stays inside
//     the same BR-04 spec so the kitchen list filters
//     can pick it up later via the `reason` field).
//
//   • Same idempotency rule as CRL-01: a re-POST with
//     the same `refundId` returns the existing paid
//     entry's payload unchanged. The
//     `transactionReference` + `note` + `method` are
//     captured on FIRST apply; subsequent POSTs don't
//     mutate the doc.
//
// The handler lives in this file (separate from
// `breakfast-mark-served.ts`) because the kitchen-
// visibility surface + the refund-liability surface
// don't share a transaction (separate staff roles
// may own them) and the per-op validation is
// sufficiently different.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase-admin";
import { auditBreakfastOp } from "../lib/breakfast-selections";

const staffRoles = ["admin", "front-desk"] as const;
type StaffRole = (typeof staffRoles)[number];

const refundIdSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Invalid refundId."
  );

const markRefundPaidBodySchema = z
  .object({
    bookingId: z.string().trim().min(8).max(80),
    refundId: refundIdSchema,
    // The paid-by method (e.g. "cash", "gcash",
    // "bank-transfer"). Free-form per the existing
    // onsite-payment surface — settings-driven list
    // resolved on the client. Server keeps the value
    // as-is so the entry is faithful to the receipt.
    method: z.string().trim().min(1).max(60),
    transactionReference: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .default(null),
    note: z.string().trim().max(500).nullable().optional().default(null),
    turnstileToken: z.string().trim().max(2000).optional()
  })
  .passthrough();

function readStaff(req: VercelRequest): { uid: string; role: StaffRole } | null {
  const anyReq = req as any;
  const staff = anyReq.staff;
  if (!staff || !staff.uid) return null;
  const role = String(staff.role || "");
  if (role !== "admin" && role !== "front-desk") return null;
  return { uid: String(staff.uid), role };
}

// Translate the shared per-op error codes into 4xx
// responses. Mirrors the BR-04 + staff-update translate
// step so the admin UI's `toast.error` strings stay
// consistent.
function refundIdToMessage(code: string): string {
  if (code === "REFUND_NOT_FOUND") return "Refund liability not found.";
  if (code === "REFUND_NOT_PENDING") return "This refund is already paid (or has been resolved).";
  if (code === "CATEGORY_MISMATCH") return "This refund does not belong to the breakfast category.";
  return "We couldn't record the refund payment. Please try again in a moment.";
}

// ---------- Handler ----------

export async function handleMarkRefundPaid(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = readStaff(req);
  if (!staff) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Access restricted to staff members."
    });
  }

  const parsed = markRefundPaidBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid mark-refund-paid payload."
    });
  }

  const { bookingId, refundId, method, transactionReference, note } = parsed.data;
  const trimmedReference = transactionReference ? String(transactionReference).trim() : null;
  const trimmedNote = note ? String(note).trim() : null;

  let resultPayload: any = null;
  let opCode: string | null = null;
  let replayed = false;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const refundRef = adminDb
        .collection("bookings")
        .doc(bookingId)
        .collection("refunds")
        .doc(refundId);
      const snap = await transaction.get(refundRef);
      if (!snap.exists) {
        opCode = "REFUND_NOT_FOUND";
        return;
      }
      const data: any = snap.data() || {};

      // Idempotent re-POST: a paid entry already
      // returns the same payload unchanged.
      if (data.status === "paid") {
        resultPayload = {
          refundId,
          status: data.status,
          paidAt: data.paidAt,
          paidBy: data.paidBy,
          method: data.method,
          transactionReference: data.transactionReference,
          note: data.note,
          amount: data.amount,
          category: data.category,
          slotKey: data.slotKey
        };
        replayed = true;
        return;
      }

      if (String(data.category || "") !== "breakfast") {
        opCode = "CATEGORY_MISMATCH";
        return;
      }
      if (String(data.status || "") !== "pending") {
        opCode = "REFUND_NOT_PENDING";
        return;
      }

      const now = Timestamp.now();
      const update = {
        status: "paid",
        paidAt: now,
        paidBy: staff.uid,
        method,
        transactionReference: trimmedReference,
        note: trimmedNote || data.note || null,
        // The "approved by" gets the same staff UID —
        // a single front-desk click both approves
        // and records. Admin clearing also flows
        // through this path; the audit entry's
        // `actorRole` carries the discriminator.
        approvedBy: staff.uid,
        lastModifiedAt: now
      };
      transaction.update(refundRef, update);

      // Append the breakfast audit. The action enum
      // doesn't include "mark-refund-paid" yet (it
      // stays inside the BR-04 spec surface — the
      // staff handler picks the variant via the
      // audit's `reason` field to keep the schema
      // narrow). The staff audit later surfaces in
      // the manage page's "Refund activity" feed.
      auditBreakfastOp({
        transaction,
        bookingId,
        slotKey: String(data.slotKey || ""),
        action: "serve", // sentinel — see note above
        mealSnapshot: null,
        actorUid: staff.uid,
        actorRole: staff.role,
        // The `reason` doubles as the audit
        // discriminator: `mark-refund-paid:{refundId}`.
        // Kitchen list (BR-07) + kitchen refunder
        // dashboard can group by `reason.startsWith("mark-refund-paid")`
        // if they need a dedicated column.
        reasonOrCutoff: `mark-refund-paid:${refundId}`
      });
      resultPayload = {
        refundId,
        status: "paid",
        paidAt: now,
        paidBy: staff.uid,
        method,
        transactionReference: trimmedReference,
        note: trimmedNote || data.note || null,
        amount: data.amount,
        category: data.category,
        slotKey: data.slotKey
      };
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[breakfast-refund-paid] failed:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: refundIdToMessage("UNKNOWN")
    });
  }

  if (opCode) {
    return res.status(400).json({
      success: false,
      error: refundIdToMessage(opCode)
    });
  }

  return res.status(200).json({
    success: true,
    data: { ...resultPayload, replayed }
  });
}
