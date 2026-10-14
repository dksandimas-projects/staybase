// Per BR-06 (Phase 13 — Breakfast Redesign, decision
// #235, 2026-10-13): the unified refund-write helper.
//
// This file consolidates the refund-mark-paid logic that
// previously lived inline in `breakfast-refund-paid.ts`
// (BR-05) and `handleAddRefund` (CRL-01). The two entry
// points stayed byte-incompatible:
//
//   • BR-05's breakfast path UPDATEd an EXISTING pending
//     entry to `status: "paid"` (the BR-04 guest-remove
//     path opens the pending liability, the BR-05 staff
//     drawer flips it to paid).
//
//   • CRL-01's cancellation path CREATEd a refund doc
//     directly in the paid state (no pending stage —
//     staff records the refund in one shot through the
//     drawer).
//
// `markRefundPaid` collapses both paths into one helper
// that ALWAYS:
//   1. Writes the refund doc (create OR update).
//   2. Updates the booking's `paidAmount`.
//   3. Writes the per-category audit row (breakfast
//      → `breakfastAudit/{autoId}`; cancellation does
//      NOT write a separate audit doc — the refund doc
//      itself is the audit trail).
//   4. Returns the new `paidAmount` + the refund entry
//      + an `alreadyPaid` idempotency flag.
//
// The helper is **transaction-internal** — the CALLER
// owns the Firestore transaction (per project convention:
// every refund mutation runs inside the booking-side
// transaction so the audit + the booking read stay
// atomic with the write).
//
// USAGE (breakfast — the BR-05 path):
//
//   await adminDb.runTransaction(async (tx) => {
//     const refundSnap = await tx.get(refundRef);
//     const bookingSnap = await tx.get(bookingRef);
//     return markRefundPaid({
//       category: "breakfast",
//       bookingId, refundId, amount, method, transactionReference, note,
//       actor: { uid: staffUid, role: "front-desk" },
//       transaction: tx,
//       existingDoc: refundSnap,
//       currentPaidAmount: bookingSnap.data()?.paidAmount || 0,
//       slotKey: "...",
//       mealSnapshot: { mealId, mealName, price }
//     });
//   });
//
// USAGE (cancellation — the CRL-01 path):
//
//   await adminDb.runTransaction(async (tx) => {
//     const refundSnap = await tx.get(refundRef);
//     const bookingSnap = await tx.get(bookingRef);
//     return markRefundPaid({
//       category: "cancellation",
//       bookingId, refundId, amount, method, transactionReference,
//       reason: liabilityReason,
//       actor: { uid: adminUid, role: "admin" },
//       transaction: tx,
//       existingDoc: refundSnap,
//       currentPaidAmount: bookingSnap.data()?.paidAmount || 0,
//       reservationId: bookingSnap.data()?.reservationId || null
//     });
//   });
//
// @throws Error("REFUND_NOT_FOUND") when the breakfast path
//         reads a missing entry (the staff tapped "Mark as paid"
//         on a liability that no longer exists).
// @throws Error("REFUND_NOT_PENDING") when the breakfast entry
//         is in an unexpected state.
// @throws Error("CATEGORY_MISMATCH") when the breakfast entry
//         doesn't carry `category: "breakfast"`.

import { Timestamp } from "firebase-admin/firestore";
import type { Transaction, DocumentReference, DocumentSnapshot } from "firebase-admin/firestore";

/** Staff actor that signs the refund payment. */
export interface RefundActor {
  uid: string;
  role: "front-desk" | "admin";
}

/** Refund category discriminator (per BR-01 §OnsitePayment extension). */
export type RefundCategory = "cancellation" | "breakfast";

/** Free-text refund reason / note (nullable). */
export type RefundReasonString = string | null | undefined;

/** Meal-snapshot stamp on a `breakfastAudit` row. */
export interface RefundMealSnapshot {
  mealId: string;
  mealName: string;
  price: number;
}

/** Input payload for `markRefundPaid`. */
export interface MarkRefundPaidInput {
  /** The booking whose `paidAmount` gets decremented. */
  bookingId: string;
  /** Refund subcollection doc id. UUIDv4 per BR-04 / CRL-01. */
  refundId: string;
  /** Positive refund amount (the helper stores as `-amount` for cancellation). */
  amount: number;
  /** Payment method (cash / gcash / bank-transfer / …). */
  method: string;
  /** Optional transaction reference (e.g. bank slip #). */
  transactionReference?: string | null;
  /** Optional note (visible on the receipt + the audit trail). */
  note?: RefundReasonString;
  /** Required CRL-01 reason ("reason" field on the refund doc). */
  reason?: RefundReasonString;
  /** Staff actor signing the payment. */
  actor: RefundActor;
  /** Caller-owned Firestore transaction. */
  transaction: Transaction;
  /** Refund category discriminator (per BR-01). */
  category: RefundCategory;
  /** The `slotKey` (breakfast only). The audit row carries it for BR-07. */
  slotKey?: string;
  /** The meal snapshot stamped on the breakfast audit row (breakfast only). */
  mealSnapshot?: RefundMealSnapshot | null;
  /**
   * Reservation scope (cancellation only). For new reservations
   * (post-MRB-01), the refund doc lives at
   * `reservations/{rid}/refunds/{refundId}`. For legacy null-
   * reservation, at `bookings/{id}/payments/{refundId}`.
   */
  reservationId?: string | null;
  /**
   * The pre-read refund doc snapshot. The caller fetches this
   * in the SAME transaction (Firestore rule: reads before
   * writes) so the helper can do idempotency + path resolution
   * synchronously.
   */
  existingDoc?: DocumentSnapshot | null;
  /** The booking's current `paidAmount` (pre-write). */
  currentPaidAmount?: number;
}

export interface MarkRefundPaidResult {
  /** `true` when the refund was already paid (idempotent replay). */
  alreadyPaid: boolean;
  /** The refund doc data after the write (or the existing row on replay). */
  refundEntry: Record<string, any>;
  /** The booking's new `paidAmount` after the write. */
  newBookingPaidAmount: number;
  /**
   * `true` only for the cancellation path when the existing refund
   * doc carries a DIFFERENT field shape than the new request (the
   * CRL-01 409 conflict — the staff reused an ID for a different
   * refund). The caller surfaces this as a 409.
   */
  conflict?: boolean;
}

/** UTF-8-safe trim + length cap (mirrors the BR-05 handler's contract). */
function trimOrNull(input: RefundReasonString, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

/**
 * Computes the new `paidAmount` on a booking after a refund of
 * `amount` (positive value on the wire) is recorded. The refund
 * amount stored in the refund doc is `-amount` (negative); adding
 * the negative to `paidAmount` reduces the total.
 */
export function computeRefundPaidAmountDelta(
  currentPaidAmount: number,
  refundAmountPositive: number
): number {
  const safe = Number.isFinite(currentPaidAmount) ? currentPaidAmount : 0;
  const safeRefund = Number.isFinite(refundAmountPositive) ? refundAmountPositive : 0;
  return safe - Math.max(0, safeRefund);
}

/** Resolves the refund-doc parent (cancellation follows MRB-04 Phase 2.x). */
function resolveRefundDocParent(
  transaction: Transaction,
  bookingId: string,
  category: RefundCategory,
  reservationId: string | null | undefined
): { parent: DocumentReference; collection: "refunds" | "payments" } {
  const bookingRef = transaction.firestore.collection("bookings").doc(bookingId);
  if (category === "breakfast") {
    return { parent: bookingRef, collection: "refunds" };
  }
  if (reservationId && String(reservationId).trim().length > 0) {
    return {
      parent: transaction.firestore.collection("reservations").doc(String(reservationId)),
      collection: "refunds"
    };
  }
  return { parent: bookingRef, collection: "payments" };
}

/**
 * Core refund-write helper. See file header for usage examples.
 * Returns either the freshly-written refund entry (a CREATE for
 * cancellation, an UPDATE for breakfast) or the existing paid
 * entry on replay (idempotent).
 */
export function markRefundPaid(input: MarkRefundPaidInput): MarkRefundPaidResult {
  const {
    bookingId,
    refundId,
    amount,
    method,
    transactionReference,
    note,
    reason,
    actor,
    transaction,
    category,
    slotKey,
    mealSnapshot,
    reservationId,
    existingDoc,
    currentPaidAmount
  } = input;

  const safeMethod = (typeof method === "string" ? method.trim() : "").slice(0, 80);
  const safeReference = trimOrNull(transactionReference, 200);
  const safeNote = trimOrNull(note, 500);
  const safeReason = trimOrNull(reason, 500);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const currentPaid = Number.isFinite(currentPaidAmount) ? Number(currentPaidAmount) || 0 : 0;

  // Path resolution: breakfast always at `bookings/{id}/refunds/{refundId}`.
  // Cancellation follows MRB-04 Phase 2.x (reservation header for new
  // reservations, booking payments subcollection for legacy).
  const pathParent = resolveRefundDocParent(transaction, bookingId, category, reservationId);
  const bookingRef: DocumentReference = transaction.firestore.collection("bookings").doc(bookingId);
  const refundRef: DocumentReference = pathParent.parent.collection(pathParent.collection).doc(refundId);

  if (category === "breakfast") {
    // ----- BR-05 path: UPDATE an existing pending entry to paid -----
    if (!existingDoc || !existingDoc.exists) {
      throw new Error("REFUND_NOT_FOUND");
    }
    const existingData: any = existingDoc.data() || {};
    if (String(existingData.status || "") === "paid") {
      return {
        alreadyPaid: true,
        refundEntry: existingData,
        newBookingPaidAmount: currentPaid
      };
    }
    if (String(existingData.status || "") !== "pending") {
      throw new Error("REFUND_NOT_PENDING");
    }
    if (String(existingData.category || "") !== "breakfast") {
      throw new Error("CATEGORY_MISMATCH");
    }

    const now = Timestamp.now();
    const safeSlotKey = typeof slotKey === "string" && slotKey.length > 0
      ? slotKey
      : String(existingData.slotKey || "");
    const update: Record<string, any> = {
      status: "paid",
      paidAt: now,
      paidBy: actor.uid,
      method: safeMethod,
      transactionReference: safeReference,
      // Preserve the prior note if the new note is empty
      // (CRL-01 allows appending; the BR-05 prototype overwrote).
      note: safeNote !== null ? safeNote : existingData.note || null,
      approvedBy: actor.uid,
      lastModifiedAt: now
    };

    // Update the refund doc (in the caller's transaction).
    transaction.update(refundRef, update);

    // Decrement the booking's `paidAmount`. The refund entry
    // stores `amount` as a negative; `|amount|` is the refund
    // magnitude to subtract from `paidAmount`.
    const refundMagnitude = Math.abs(Number(existingData.amount || 0));
    const newBookingPaidAmount = computeRefundPaidAmountDelta(currentPaid, refundMagnitude);
    transaction.update(bookingRef, {
      paidAmount: newBookingPaidAmount,
      lastRefundClearedAt: now
    });

    // Append the breakfast audit row. The action enum stays
    // inside the BR-04/BR-05 surface; the `reason` carries
    // the BR-06 discriminator (`mark-refund-paid:{refundId}`).
    const auditRef = bookingRef.collection("breakfastAudit").doc();
    transaction.create(auditRef, {
      action: "serve", // sentinel — same as BR-05
      slotKey: safeSlotKey,
      mealSnapshot: mealSnapshot || null,
      actorUid: actor.uid,
      actorRole: actor.role,
      reason: `mark-refund-paid:${refundId}`,
      occurredAt: now,
      occurredAfterCutoff: false
    });

    return {
      alreadyPaid: false,
      refundEntry: { ...existingData, ...update },
      newBookingPaidAmount
    };
  }

  // ----- CRL-01 path: CREATE a refund entry from scratch -----
  // Idempotency + 409 conflict check on the existing doc.
  if (existingDoc && existingDoc.exists) {
    const existingData: any = existingDoc.data() || {};
    const sameRequest = Math.abs(Number(existingData.amount || 0)) === safeAmount
      && String(existingData.method || "") === safeMethod
      && String(existingData.note || "") === (safeReason || "")
      && (existingData.transactionReference || null) === safeReference;
    if (sameRequest) {
      return {
        alreadyPaid: true,
        refundEntry: existingData,
        newBookingPaidAmount: currentPaid
      };
    }
    return {
      alreadyPaid: false,
      refundEntry: existingData,
      newBookingPaidAmount: currentPaid,
      conflict: true
    };
  }

  // Build the new refund record. CRL-01 shape: `type: "refund"`,
  // `amount: -amount`, `method`, `note`, `reason`, `approvedBy`,
  // `recordedBy`, `recordedAt`. `category: "cancellation"` is
  // stamped explicitly (BR-01 reads legacy `null` as
  // `"cancellation"` — the explicit stamp is back-compat-safe).
  const now = Timestamp.now();
  const newRecord: Record<string, any> = {
    type: "refund",
    amount: -safeAmount,
    method: safeMethod,
    note: safeReason || safeNote || null,
    reason: safeReason || null,
    approvedBy: actor.uid,
    recordedBy: actor.uid,
    recordedAt: now,
    category: "cancellation"
  };
  if (safeReference) newRecord.transactionReference = safeReference;
  if (reservationId && String(reservationId).trim().length > 0) {
    newRecord.reservationId = String(reservationId);
    newRecord.bookingId = bookingId;
  }

  // Use create() so a server-side race that lost the existingDoc
  // lookup still throws ALREADY_EXISTS rather than overwriting
  // the original ledger entry.
  transaction.create(refundRef, newRecord);

  // Decrement paidAmount.
  const newBookingPaidAmount = computeRefundPaidAmountDelta(currentPaid, safeAmount);
  transaction.update(bookingRef, {
    paidAmount: newBookingPaidAmount,
    lastRefundClearedAt: now
  });

  return {
    alreadyPaid: false,
    refundEntry: newRecord,
    newBookingPaidAmount
  };
}

/**
 * Convenience error-code → human-message translator. Mirrors
 * the per-handler translator strings so the unified helper's
 * error surface stays byte-equivalent to the existing
 * `breakfast-refund-paid.ts` surface (the BR-05 admin test
 * pins these strings).
 */
export function refundPaidErrorToMessage(code: string): string {
  if (code === "REFUND_NOT_FOUND") return "Refund liability not found.";
  if (code === "REFUND_NOT_PENDING") return "This refund is already paid (or has been resolved).";
  if (code === "CATEGORY_MISMATCH") return "This refund does not belong to the breakfast category.";
  return "We couldn't record the refund payment. Please try again in a moment.";
}
