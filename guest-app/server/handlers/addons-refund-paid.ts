// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the staff "mark refund paid" endpoint for
// other add-ons.
//
//   POST /api/bookings/addons/mark-refund-paid
//
// Mirrors `handleMarkRefundPaid` (BR-06 breakfast) but
// the refund category is `"otherAddOn"`. Delegates to the
// unified `markRefundPaid` helper which gained the new
// category discriminator in BR-12.
//
// STAFF-Token gated + Turnstile gated at the apiRouter layer.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../lib/firebase-admin";
import { OtherAddOnMarkRefundPaidSchema, type OtherAddOnSelectionEntry } from "@spark-inn/shared";
import {
  markRefundPaid,
  refundPaidErrorToMessage
} from "../lib/refunds";
import { auditOtherAddOnOp } from "../lib/otherAddOn-selections";

function readStaff(req: VercelRequest): { uid: string; role: "admin" | "front-desk" } | null {
  const anyReq = req as any;
  const staff = anyReq.staff;
  if (!staff || !staff.uid) return null;
  const role = String(staff.role || "");
  if (role !== "admin" && role !== "front-desk") return null;
  return { uid: String(staff.uid), role };
}

export async function handleMarkRefundPaidAddOns(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  const parsed = OtherAddOnMarkRefundPaidSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid mark-refund-paid payload." });
  }
  const staff = readStaff(req);
  if (!staff) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Access restricted to staff members."
    });
  }

  const { bookingId, refundId, method, transactionReference, note } = parsed.data;
  const trimmedReference = transactionReference ? String(transactionReference).trim() : null;
  const trimmedNote = note ? String(note).trim() : null;

  let opCode: string | null = null;
  let resultSummary: {
    refundEntry: Record<string, any>;
    newBookingPaidAmount: number;
    alreadyPaid: boolean;
  } | null = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const refundRef = adminDb
        .collection("bookings")
        .doc(bookingId)
        .collection("refunds")
        .doc(refundId);
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const [refundSnap, bookingSnap] = await Promise.all([
        transaction.get(refundRef),
        transaction.get(bookingRef)
      ]);
      if (!refundSnap.exists) {
        opCode = "REFUND_NOT_FOUND";
        return;
      }
      const refundData = refundSnap.data() || {};
      const bookingData = bookingSnap.data() || {};
      const selectionKey = String((refundData as any)?.otherAddOnRefundContext?.selectionKey || "");
      const liveSelections: Record<string, OtherAddOnSelectionEntry[]> =
        bookingData.otherAddOnSelections && typeof bookingData.otherAddOnSelections === "object"
          ? bookingData.otherAddOnSelections
          : {};
      const entry = selectionKey
        ? (() => {
            const parts = selectionKey.split("-");
            const date = parts.slice(0, 3).join("-");
            const addOnId = parts.slice(3).join("-");
            return (liveSelections[date] || []).find((e) => e && e.addOnId === addOnId);
          })()
        : null;

      try {
        const helperResult = markRefundPaid({
          category: "otherAddOn",
          bookingId,
          refundId,
          amount: Math.abs(Number(refundData.amount || 0)),
          method,
          transactionReference: trimmedReference,
          note: trimmedNote,
          actor: { uid: staff.uid, role: staff.role },
          transaction,
          existingDoc: refundSnap,
          currentPaidAmount: Number(bookingData.paidAmount || 0),
          slotKey: selectionKey
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
            category: helperResult.refundEntry.category || "otherAddOn",
            selectionKey: helperResult.refundEntry.slotKey
          },
          newBookingPaidAmount: helperResult.newBookingPaidAmount,
          alreadyPaid: helperResult.alreadyPaid
        };
        if (entry) {
          auditOtherAddOnOp({
            transaction,
            bookingId,
            selectionKey,
            action: "mark-served",
            addOnSnapshot: {
              addOnId: entry.addOnId,
              name: entry.nameSnapshot,
              price: entry.priceSnapshot,
              quantity: entry.quantity
            },
            actorUid: staff.uid,
            actorRole: staff.role,
            reasonOrCutoff: `Mark refund paid via ${method}.`
          });
        }
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
    return res.status(400).json({ success: false, error: refundPaidErrorToMessage(opCode) });
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