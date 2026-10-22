// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): the staff-side "Mark as paid"
// endpoint for the BR-01 `breakfastRefundContext`
// refund-liability entries.
//
//   POST /api/bookings/breakfast/mark-refund-paid
//
// Per BR-06 (#235, 2026-10-13): the underlying refund-write
// logic now lives in `lib/refunds.ts` (`markRefundPaid`),
// which is the SINGLE source of truth for the
// `status: "paid"` transition. The breakfast UPDATE path
// + the cancellation CREATE path (CRL-01) both flow
// through this helper — see the file header in
// `lib/refunds.ts` for the unification rationale.
//
// Behaviour (mirrors the BR-05 prototype, now delegate):
//
//   • STAFF-Token gated (handled in apiRouter via
//     `authenticateStaff`).
//
//   • Refuses if the refund entry doesn't exist, isn't
//     a `breakfast` category entry, or is already
//     marked paid (idempotent re-POST returns the
//     existing paid entry — same shape as CRL-01's
//     idempotency, normalised via the helper).
//
//   • Writes a transactional update that flips
//     `status: "pending" → "paid"`, stamps `paidAt +
//     paidBy + method + transactionReference + note`.
//     The helper also updates the booking's
//     `paidAmount` (the pre-BR-06 prototype skipped
//     this; the unification fixes the bug).
//
//   • Appends a `breakfastAudit/{autoId}` entry with
//     `action: "serve"` (sentinel) + reason
//     `mark-refund-paid:{refundId}` — the BR-07
//     kitchen-list filter picks it up via
//     `reason.startsWith("mark-refund-paid")`.
//
//   • Idempotent on re-POST (refundId, BR-04 / CRL-01
//     contract).

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
// responses. Re-exported from the helper so the admin
// UI's `toast.error` strings stay consistent.
function refundIdToMessage(code: string): string {
  return refundPaidErrorToMessage(code);
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
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      // Pre-read both docs (Firestore requires reads before writes)
      // so the helper can do idempotency + booking paidAmount lookup
      // synchronously inside the transaction.
      const [refundSnap, bookingSnap] = await Promise.all([
        transaction.get(refundRef),
        transaction.get(bookingRef)
      ]);
      let helperResult;
      try {
        helperResult = markRefundPaid({
          category: "breakfast",
          bookingId,
          refundId,
          amount: Math.abs(Number(refundSnap.data()?.amount || 0)),
          method,
          transactionReference: trimmedReference,
          note: trimmedNote,
          actor: { uid: staff.uid, role: staff.role },
          transaction,

          db: adminDb,
          existingDoc: refundSnap,
          // Per BR-08 (P1 MONEY, 2026-10-22): the `|| 0` fallback
          // STAYS — a booking created before the fix carries no
          // `paidAmount` at all, and "no money collected" is the
          // correct reading for it. The field is now written by the
          // two production payment-record paths
          // (`handleAddPayment` + `handleVerifyAndRecordPayment`), so
          // a booking with money collected against it carries the
          // real running total and this decrement has a real base.
          currentPaidAmount: Number(bookingSnap.data()?.paidAmount || 0),
          slotKey: String(refundSnap.data()?.slotKey || "")
        });
      } catch (err: any) {
        // Map helper-thrown error codes to the BR-05 op-code contract
        // (the admin test pins REFUND_NOT_FOUND / REFUND_NOT_PENDING /
        // CATEGORY_MISMATCH; surfacing them via the same `opCode`
        // variable keeps the wire shape byte-equivalent to the
        // pre-BR-06 handler).
        opCode = String(err?.message || "UNKNOWN");
        return;
      }
      resultPayload = {
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
      };
      replayed = helperResult.alreadyPaid;
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
