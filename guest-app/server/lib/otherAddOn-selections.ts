// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the server-side gate for the new
// `otherAddOnSelections` rich shape. Mirrors
// `breakfast-selections.ts` (BR-03) but the slot math is
// per-day × per-add-on (NOT per-day × per-guest). The
// helper handles:
//
//   1. Per-add-on cut-off validation (locked dates reject
//      add / change / remove ops; the per-add-on `isEnabled`
//      also locks every date).
//   2. Per-add-on catalog validation (every entry's
//      `addOnId` must exist in the live `addOns` catalog).
//   3. Quantity bounds (0..maxGuests; capped server-side).
//   4. Refund-liability creation when a `remove` op crosses
//      a paid selection (the BR-06 unified helper, with
//      `category: "otherAddOn"` — the unified helper gained
//      that discriminator in BR-12).
//
// The audit subcollection writer (`auditOtherAddOnOp`) and
// the `assertNotLocked` helpers are the equivalents of the
// `breakfast-selections.ts` versions. The unified shape
// keeps the BR-13 refactor tractable: a single extractor
// helper will pull both gates into a common base.

import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  computeOtherAddOnCutoffState,
  recomputeOtherAddOnTotal,
  hasAnyOtherAddOns,
  buildOtherAddOnSelectionKey,
  parseOtherAddOnSelectionKey,
  roundToTwoDecimals,
  type AddOn,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";
import { adminDb } from "./firebase-admin";

// ---------- error codes (mirror of BREAKFAST_OP_ERROR) ----------

export const OTHER_ADDON_OP_ERROR = {
  ADDON_NOT_AVAILABLE: "ADDON_NOT_AVAILABLE",
  LOCKED_DATE_PREFIX: "LOCKED_DATE:",
  SELECTION_ALREADY_ORDERED: "SELECTION_ALREADY_ORDERED",
  SELECTION_NOT_ORDERED: "SELECTION_NOT_ORDERED",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  SERVE_NOT_FOUND: "SERVE_NOT_FOUND",
  REFUND_NOT_FOUND: "REFUND_NOT_FOUND"
} as const;

export const otherAddOnEntryShape = z.object({
  addOnId: z.string().trim().min(1).max(80),
  nameSnapshot: z.string().trim().min(1).max(120),
  priceSnapshot: z.number().finite().min(0),
  quantity: z.number().int().min(0).max(50),
  unitSnapshot: z.enum(["per-person", "per-stay"]),
  addedBy: z.string().trim().max(120).optional().default(""),
  addedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedBy: z.string().trim().max(120).optional().default(""),
  removedAt: z.string().trim().max(64).nullable().optional().default(null),
  removedBy: z.string().trim().max(120).nullable().optional().default(null),
  cutoffHoursBeforeCheckInSnapshot: z.number().int().min(0).max(168)
});

export const otherAddOnSelectionsWireSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.array(otherAddOnEntryShape)
);

export type ValidatedOtherAddOnSelections = {
  entries: Record<string, OtherAddOnSelectionEntry[]>;
  total: number;
  hasAny: boolean;
};

// ---------- catalog lookup ----------

function buildAddOnLookup(addOns: unknown): Map<string, AddOn> {
  const lookup = new Map<string, AddOn>();
  if (!Array.isArray(addOns)) return lookup;
  for (const a of addOns) {
    if (!a || typeof a !== "object") continue;
    const id = typeof (a as any).id === "string" ? (a as any).id : "";
    if (!id) continue;
    lookup.set(id, a as AddOn);
  }
  return lookup;
}

// ---------- per-op validation ----------

export function assertAddOnExists(
  addOnLookup: Map<string, AddOn>,
  addOnId: string
): void {
  if (!addOnLookup.has(addOnId)) {
    throw new Error(OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE);
  }
}

export interface AssertNotLockedInput {
  selectionKey: string;
  serverNow: Date;
  addOn: Pick<AddOn, "isEnabled" | "cutoffHoursBeforeCheckIn">;
  /**
   * The BOOKING's check-in date (`yyyy-mm-dd`) — the cut-off
   * anchor.
   *
   * Per OCT-M5 (2026-10-20, decision #292) this parameter is
   * REQUIRED. It used to be optional and fell back to the
   * selection's own service date:
   *
   *   const date = checkInDate || parsed.date;
   *
   * but **no caller ever passed it**, so the lock slid forward
   * one day per service date — for an Oct 20 check-in with
   * `cutoffHoursBeforeCheckIn: 24` the policy lock was Oct 19
   * 00:00Z, yet the Oct 21 selection locked at Oct 20 00:00Z and
   * the Oct 22 selection at Oct 21 00:00Z. The guest could add
   * transfers a full day past the hotel's stated cut-off.
   *
   * Per `plan/features/OTHER-ADD-ONS.md` §Cutoff Model the rule is
   * "`cutoffHoursBeforeCheckIn` hours before each **`checkIn`**
   * date" — and the field is literally named
   * `cutoffHoursBeforeCheckIn`. Making the parameter required
   * means the compiler forces every call site to pass the
   * booking's real check-in, so the per-service-date fallback
   * cannot be reintroduced.
   */
  checkInDate: string;
}

export function assertNotLocked(input: AssertNotLockedInput): void {
  const { selectionKey, serverNow, addOn, checkInDate } = input;
  const parsed = parseOtherAddOnSelectionKey(selectionKey);
  if (!parsed) {
    throw new Error(`${OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX}${selectionKey}`);
  }
  const state = computeOtherAddOnCutoffState({
    checkInDate,
    addOn,
    now: serverNow
  });
  if (state.isLocked) {
    throw new Error(`${OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX}${parsed.date}`);
  }
}

export function assertSelectionForAdd(
  next: Record<string, OtherAddOnSelectionEntry[]>,
  selectionKey: string
): void {
  const parsed = parseOtherAddOnSelectionKey(selectionKey);
  if (!parsed) return;
  const prior = next[parsed.date]?.find((e) => e && e.addOnId === parsed.addOnId);
  if (prior && prior.removedAt === null) {
    throw new Error(OTHER_ADDON_OP_ERROR.SELECTION_ALREADY_ORDERED);
  }
}

export function assertSelectionForChange(
  next: Record<string, OtherAddOnSelectionEntry[]>,
  selectionKey: string
): void {
  const parsed = parseOtherAddOnSelectionKey(selectionKey);
  if (!parsed) return;
  const prior = next[parsed.date]?.find((e) => e && e.addOnId === parsed.addOnId);
  if (!prior || prior.removedAt !== null) {
    throw new Error(OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED);
  }
}

// ---------- audit writer ----------

export interface AuditOtherAddOnOpInput {
  transaction: FirebaseFirestore.Transaction;
  bookingId: string;
  selectionKey: string;
  action:
    | "add"
    | "change"
    | "remove"
    | "mark-served"
    | "override-add"
    | "override-change"
    | "override-remove";
  addOnSnapshot: { addOnId: string; name: string; price: number; quantity: number } | null;
  actorUid: string;
  actorRole: "guest" | "front-desk" | "admin";
  reasonOrCutoff?: string | boolean | AuditOtherAddOnReasonAndCutoff;
}

/**
 * Per OCT-H7 (2026-10-20, decision #286): the object form carries
 * BOTH the free-text reason and the cut-off flag. The previous
 * two-way overload (`string | boolean`) could not express "a staff
 * override with a reason", so every add-on override wrote
 * `occurredAfterCutoff: false` and the late-change counter was
 * permanently zero.
 */
export interface AuditOtherAddOnReasonAndCutoff {
  /** The free-text reason for the change (staff override reason, etc.). */
  reason?: string | null;
  /** `true` when the change happened after the date's cut-off. */
  occurredAfterCutoff?: boolean;
}

export function auditOtherAddOnOp(input: AuditOtherAddOnOpInput): void {
  const {
    transaction,
    bookingId,
    selectionKey,
    action,
    addOnSnapshot,
    actorUid,
    actorRole,
    reasonOrCutoff
  } = input;

  let reason: string | null = null;
  let occurredAfterCutoff = false;
  if (typeof reasonOrCutoff === "string") {
    reason = reasonOrCutoff;
  } else if (typeof reasonOrCutoff === "boolean") {
    occurredAfterCutoff = reasonOrCutoff;
  } else if (reasonOrCutoff && typeof reasonOrCutoff === "object") {
    // Per OCT-H7: the object form carries BOTH the reason and the
    // cut-off flag (the two-way overload could not express the
    // combination, so every override logged `false`).
    reason = reasonOrCutoff.reason ?? null;
    occurredAfterCutoff = reasonOrCutoff.occurredAfterCutoff === true;
  }

  const auditRef = adminDb
    .collection("bookings")
    .doc(bookingId)
    .collection("otherAddOnAudit")
    .doc();

  transaction.set(auditRef, {
    action,
    selectionKey,
    addOnSnapshot,
    actorUid,
    actorRole,
    reason,
    occurredAt: Timestamp.now(),
    occurredAfterCutoff
  });
}

// ---------- refund liability ----------

export interface CreateOtherAddOnRefundLiabilityInput {
  transaction: FirebaseFirestore.Transaction;
  booking: { id: string; bookingRef: string };
  selectionKey: string;
  addOnEntry: { addOnId: string; nameSnapshot: string; priceSnapshot: number; quantity: number };
  amount: number;
  reason: string;
  recordedBy: "guest" | "front-desk" | "admin";
  recordedByUid: string;
}

export function createOtherAddOnRefundLiability(
  input: CreateOtherAddOnRefundLiabilityInput
): void {
  const {
    transaction,
    booking,
    selectionKey,
    addOnEntry,
    amount,
    reason,
    recordedBy,
    recordedByUid
  } = input;

  const refundId = generateOtherAddOnRefundId();
  const refundLiabilityRef = adminDb
    .collection("bookings")
    .doc(booking.id)
    .collection("refunds")
    .doc(refundId);

  const qty = Math.max(0, Math.floor(Number(addOnEntry.quantity) || 0));
  const unitPrice = Math.max(0, Number(addOnEntry.priceSnapshot) || 0);
  // Per OCT-L3 (2026-10-20, decision #299): the liability amount
  // uses the same 2dp rule as the billed total. Before this, the
  // liability was left at full precision while the total was rounded
  // to whole pesos — so a ₱499.99 add-on billed ₱500 but refunded
  // ₱499.99. The refund and the bill now reconcile exactly.
  const totalAmount = roundToTwoDecimals(Math.abs(Number(amount || 0)) || unitPrice * qty);

  const refundRecord: Record<string, any> = {
    id: refundId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    type: "refund",
    category: "otherAddOn",
    status: "pending",
    amount: -totalAmount,
    method: "pending",
    note: "Pending — staff processes the payout.",
    transactionReference: null,
    reason,
    approvedBy: null,
    recordedBy,
    recordedByUid,
    recordedAt: Timestamp.now(),
    otherAddOnRefundContext: {
      addOnId: addOnEntry.addOnId,
      selectionKey,
      addOnName: addOnEntry.nameSnapshot,
      priceSnapshot: unitPrice,
      quantitySnapshot: qty
    }
  };

  transaction.set(refundLiabilityRef, refundRecord);
}

export function generateOtherAddOnRefundId(): string {
  const g: any = globalThis as any;
  if (typeof g.crypto?.randomUUID === "function") {
    const id = String(g.crypto.randomUUID());
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id
      )
    ) {
      return id;
    }
  }
  const part = () =>
    Math.floor(Math.random() * 0xffff_ffff).toString(16).padStart(8, "0");
  const part4 = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  const part4b = (Math.floor(Math.random() * 0x0fff) | 0x4000)
    .toString(16)
    .padStart(4, "0");
  const part4c = (Math.floor(Math.random() * 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  return `${part()}-${part4}-${part4b}-${part4c}-${part().slice(0, 8)}${part().slice(0, 4)}`;
}

// ---------- re-exports ----------

export { buildOtherAddOnSelectionKey, parseOtherAddOnSelectionKey, recomputeOtherAddOnTotal };