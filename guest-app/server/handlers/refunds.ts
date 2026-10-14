// Per BR-06 (Phase 13 — Breakfast Redesign, decision
// #235, 2026-10-13): the admin-side "Mark as paid"
// endpoint for the standalone Refunds admin view.
//
//   POST /api/refunds/mark-paid
//
// Body: { bookingId, refundId, method, transactionReference?, note? }
//
// Behavior: delegates to the unified `markRefundPaid`
// helper in `server/lib/refunds.ts` with
// `category: "breakfast"`. The helper handles the
// existing pending entry → paid transition + the
// booking `paidAmount` decrement + the breakfast
// audit row (`breakfastAudit/{autoId}` with
// `reason: "mark-refund-paid:{refundId}"`).
//
// Auth: STAFF-Token gated (admin or front-desk —
// both can clear a pending refund liability from the
// admin Refunds view).
//
// The cancellation category does NOT use this
// endpoint — cancellation refunds are created in
// the paid state directly through `handleAddRefund`
// (CRL-01), which also delegates to the unified
// helper for the entry-creation + paidAmount step.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";
import { markRefundPaid, refundPaidErrorToMessage } from "../lib/refunds";

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
    method: z.string().trim().min(1).max(60),
    transactionReference: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .default(null),
    note: z.string().trim().max(500).nullable().optional().default(null)
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

/**
 * Handler for the standalone Refunds admin view. The
 * spec requires a 404 when the refund doesn't exist
 * (the BR-06 acceptance criterion). Returns the
 * helper's `newBookingPaidAmount` + `refundEntry` +
 * `alreadyPaid` fields at the top level.
 */
export async function handleMarkRefundPaidStandalone(
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

  let resultSummary: {
    refundEntry: Record<string, any>;
    newBookingPaidAmount: number;
    alreadyPaid: boolean;
  } | null = null;
  let opCode: string | null = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const refundRef = adminDb
        .collection("bookings")
        .doc(bookingId)
        .collection("refunds")
        .doc(refundId);
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      // Pre-read both docs so the helper can do
      // idempotency + booking paidAmount lookup
      // synchronously inside the transaction (Firestore
      // rule: reads before writes).
      const [refundSnap, bookingSnap] = await Promise.all([
        transaction.get(refundRef),
        transaction.get(bookingRef)
      ]);
      try {
        const helperResult = markRefundPaid({
          category: "breakfast",
          bookingId,
          refundId,
          amount: Math.abs(Number(refundSnap.data()?.amount || 0)),
          method,
          transactionReference: trimmedReference,
          note: trimmedNote,
          actor: { uid: staff.uid, role: staff.role },
          transaction,
          existingDoc: refundSnap,
          currentPaidAmount: Number(bookingSnap.data()?.paidAmount || 0),
          slotKey: String(refundSnap.data()?.slotKey || "")
        });
        resultSummary = {
          refundEntry: {
            refundId,
            status: helperResult.refundEntry.status || "paid",
            paidAt: helperResult.refundEntry.paidAt,
            paidBy: helperResult.refundEntry.paidBy,
            method: helperResult.refundEntry.method,
            transactionReference: helperResult.refundEntry.transactionReference,
            note: helperResult.refundEntry.note,
            amount: helperResult.refundEntry.amount,
            category: helperResult.refundEntry.category || "breakfast",
            slotKey: helperResult.refundEntry.slotKey
          },
          newBookingPaidAmount: helperResult.newBookingPaidAmount,
          alreadyPaid: helperResult.alreadyPaid
        };
      } catch (err: any) {
        opCode = String(err?.message || "UNKNOWN");
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: refundPaidErrorToMessage("UNKNOWN")
    });
  }

  if (opCode) {
    if (opCode === "REFUND_NOT_FOUND") {
      return res.status(404).json({ success: false, error: refundPaidErrorToMessage(opCode) });
    }
    return res.status(400).json({
      success: false,
      error: refundPaidErrorToMessage(opCode)
    });
  }

  if (!resultSummary) {
    return res.status(500).json({
      success: false,
      error: refundPaidErrorToMessage("UNKNOWN")
    });
  }

  return res.status(200).json({
    success: true,
    newBookingPaidAmount: resultSummary.newBookingPaidAmount,
    refundEntry: resultSummary.refundEntry,
    alreadyPaid: resultSummary.alreadyPaid
  });
}
