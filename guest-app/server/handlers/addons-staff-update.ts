// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the staff booking-drawer batch-save endpoint
// for other add-ons.
//
//   POST /api/bookings/addons/staff-update
//
// Mirrors `handleStaffUpdateBreakfast` (BR-05) but operates
// on the `otherAddOnSelections` shape. STAFF-Token gated +
// Turnstile gated at the apiRouter layer. Supports the
// `overrideReason` path for late writes past the
// per-add-on cutoff.
//
// On success:
//   1. Each op writes an `otherAddOnAudit/{autoId}` entry
//      with `action: override-*` when past the cutoff.
//   2. `remove` of a paid selection writes a
//      `bookings/{id}/refunds/{refundId}` entry with
//      `category: "otherAddOn"`, status: "pending".
//   3. `otherAddOnTotal` + `hasAnyOtherAddOns` recomputed.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase-admin";
import {
  StaffOtherAddOnUpdateSchema,
  recomputeOtherAddOnTotal,
  hasAnyOtherAddOns,
  normalizeAddOn,
  parseOtherAddOnSelectionKey,
  // Per OCT-M3 (2026-10-20, decision #291): the shared
  // read-only-booking rule.
  isOtherAddOnBookingMutable,
  OTHER_ADD_ON_READ_ONLY_ERROR,
  // Per OCT-M5 (2026-10-20, decision #292): the shared UTC
  // calendar-date key helper (the cut-off anchor).
  toUtcDateKey,
  // Per OCT-L3 (2026-10-20, decision #299): the shared 2dp money
  // rule — the refund liability must match the billed total.
  roundToTwoDecimals,
  // Per MRB-11b (QA pass 2026-10-25): the BR-12 other add-ons sit on
  // top of the room bill (OCT-FOL-01), so the MRB-11 revenue
  // allocation has to be re-derived when they change.
  rebuildBookingRevenueAllocation,
  type AddOn,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";
import {
  OTHER_ADDON_OP_ERROR,
  assertAddOnExists,
  assertNotLocked,
  assertSelectionForAdd,
  assertSelectionForChange,
  auditOtherAddOnOp,
  createOtherAddOnRefundLiability
} from "../lib/otherAddOn-selections";

interface SaveOp {
  kind: "add" | "change" | "remove";
  selectionKey: string;
  addOnId: string;
  quantity?: number;
  // Per OCT-C2 (2026-10-20): the snapshot fields below are
  // ADVISORY ONLY. The server sources them from the LIVE
  // `addOns` catalog (an `add`) or keeps the entry's existing
  // snapshot (a `change`, where only `quantity` is editable).
  // They are still parsed so a cached client bundle keeps
  // working — but they must never be persisted as-is.
  priceSnapshot?: number;
  nameSnapshot?: string;
  unitSnapshot?: "per-person" | "per-stay";
  cutoffHoursBeforeCheckInSnapshot?: number;
}

function readOps(body: any): { add: SaveOp[]; change: SaveOp[]; remove: SaveOp[] } {
  const out = { add: [] as SaveOp[], change: [] as SaveOp[], remove: [] as SaveOp[] };
  const mapOp = (raw: any, kind: SaveOp["kind"]): SaveOp | null => {
    if (!raw || typeof raw !== "object") return null;
    const selectionKey = String(raw.selectionKey || "").trim();
    const addOnId = String(raw.addOnId || "").trim();
    if (!selectionKey || !addOnId) return null;
    const op: SaveOp = { kind, selectionKey, addOnId };
    if (kind !== "remove") {
      op.quantity = Math.max(0, Math.floor(Number(raw.quantity ?? 0)));
      op.priceSnapshot = Math.max(0, Number(raw.priceSnapshot ?? 0));
      op.nameSnapshot = String(raw.nameSnapshot || "").trim().slice(0, 120);
      op.unitSnapshot = raw.unitSnapshot === "per-stay" ? "per-stay" : "per-person";
      op.cutoffHoursBeforeCheckInSnapshot = Math.max(
        0,
        Math.min(168, Math.floor(Number(raw.cutoffHoursBeforeCheckInSnapshot ?? 24)))
      );
    }
    return op;
  };
  if (Array.isArray(body?.add)) for (const r of body.add) { const m = mapOp(r, "add"); if (m) out.add.push(m); }
  if (Array.isArray(body?.change)) for (const r of body.change) { const m = mapOp(r, "change"); if (m) out.change.push(m); }
  if (Array.isArray(body?.remove)) for (const r of body.remove) { const m = mapOp(r, "remove"); if (m) out.remove.push(m); }
  return out;
}

function opErrorToMessage(code: string): string {
  if (code === OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE) return "That add-on is not available.";
  if (code === OTHER_ADDON_OP_ERROR.SELECTION_ALREADY_ORDERED) return "Add-on already ordered for that day.";
  if (code === OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED) return "Nothing to change.";
  if (code === OTHER_ADDON_OP_ERROR.INVALID_QUANTITY) return "Quantity must be between 0 and 50.";
  if (code.startsWith(OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX)) {
    return `Ordering closed — use overrideReason for late changes.`;
  }
  // Per OCT-M5 (2026-10-20, decision #292): the booking has no
  // usable check-in date, so the cut-off anchor cannot be
  // computed. Refuse rather than fall back to the per-service-date
  // anchor (which is the bug this fix removes).
  if (code === "BOOKING_CHECK_IN_MISSING") {
    return "This booking has no check-in date, so the add-on cut-off cannot be applied.";
  }
  return "Could not save the staff add-on update.";
}

export async function handleStaffUpdateAddOns(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = StaffOtherAddOnUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid staff other-add-ons update payload." });
  }

  const { bookingId, overrideReason } = parsed.data;
  const ops = readOps(req.body || {});
  const totalOps = ops.add.length + ops.change.length + ops.remove.length;
  if (totalOps === 0) {
    return res.status(400).json({ success: false, error: "No add-on changes supplied." });
  }
  if (totalOps > 200) {
    return res.status(400).json({ success: false, error: "Too many add-on changes in one batch." });
  }

  // Look up the booking directly.
  const bookingRef = adminDb.collection("bookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    return res.status(404).json({ success: false, error: "Booking not found." });
  }
  const bookingData = bookingSnap.data() || {};
  const bookingRefValue = String(bookingData.bookingRef || "");

  // Per OCT-M3 (2026-10-20, decision #291): a closed booking's
  // add-on selections are READ-ONLY for the staff path too, not
  // just the guest path. Per `plan/features/OTHER-ADD-ONS.md`
  // §Edge cases: "Both guest and staff update endpoints reject
  // with 400 'Booking is read-only.'"
  //
  // Without this the front desk could add an airport transfer to
  // a CHECKED-OUT booking, and (when `paidAmount > 0`) write a
  // `category: "otherAddOn"` pending refund liability against a
  // closed booking — inflating the Liability tab with a refund for
  // something that was already served.
  if (!isOtherAddOnBookingMutable(bookingData.status)) {
    return res.status(400).json({ success: false, error: OTHER_ADD_ON_READ_ONLY_ERROR });
  }

  // Load the add-on catalog (defensive: missing catalog
  // rejects every op).
  const addOnSnap = await adminDb.collection("addOns").get();
  const addOnById = new Map<string, AddOn>();
  for (const d of addOnSnap.docs) {
    const norm = normalizeAddOn({ id: d.id, ...d.data() }, d.id);
    if (norm) addOnById.set(norm.id, norm);
  }

  let opCode: string | null = null;
  let newTotal = 0;
  let newHasAny = false;
  let pendingRefundKeys: string[] = [];
  const actorUid = (req as any).staff?.uid || "staff";
  const actorRole = ((req as any).staff?.role === "admin" ? "admin" : "front-desk") as "front-desk" | "admin";

  try {
    await adminDb.runTransaction(async (transaction) => {
      const live = await transaction.get(bookingRef);
      const liveBooking = live.data() || {};
      // Per OCT-M5 (2026-10-20, decision #292): the booking's
      // check-in date — the cut-off anchor for every op in this
      // transaction.
      const liveCheckInDate = toUtcDateKey(liveBooking.checkIn as any);
      if (!liveCheckInDate) {
        opCode = "BOOKING_CHECK_IN_MISSING";
        return false;
      }
      const liveSelections: Record<string, OtherAddOnSelectionEntry[]> =
        liveBooking.otherAddOnSelections && typeof liveBooking.otherAddOnSelections === "object"
          ? { ...liveBooking.otherAddOnSelections }
          : {};
      const liveServed: Record<string, unknown> =
        liveBooking.otherAddOnServed && typeof liveBooking.otherAddOnServed === "object"
          ? liveBooking.otherAddOnServed
          : {};

      const next: Record<string, OtherAddOnSelectionEntry[]> = { ...liveSelections };
      const auditWrites: Array<{
        op: SaveOp;
        addOnSnapshot: { addOnId: string; name: string; price: number; quantity: number } | null;
        reason: string | null;
        occurredAfterCutoff: boolean;
      }> = [];
      const refundWrites: Array<{
        selectionKey: string;
        entry: OtherAddOnSelectionEntry;
        amount: number;
      }> = [];
      const now = new Date();
      const nowIso = now.toISOString();
      const livePaidAmount = Number(liveBooking.paidAmount || 0);

      const runOp = (op: SaveOp, kind: SaveOp["kind"]) => {
        const parsedKey = parseOtherAddOnSelectionKey(op.selectionKey);
        if (!parsedKey) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return false;
        }
        const liveAddOn = addOnById.get(op.addOnId);
        if (!liveAddOn) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return false;
        }
        // For staff, `assertNotLocked` is informational —
        // a locked selection requires an override reason.
        let isLateCutoff = false;
        try {
          assertNotLocked({
            selectionKey: op.selectionKey,
            serverNow: now,
            addOn: liveAddOn,
            // Per OCT-M5 (2026-10-20, decision #292): the
            // cut-off anchor is the BOOKING's check-in, not the
            // selection's own service date. The parameter is now
            // required, so the compiler enforces it.
            checkInDate: liveCheckInDate
          });
        } catch (err: any) {
          if (!overrideReason || overrideReason.length < 8) {
            opCode = `${OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX}${parsedKey.date}`;
            return false;
          }
          isLateCutoff = true;
        }
        if (liveServed[op.selectionKey] && kind !== "remove") {
          opCode = `SERVE_BLOCKED:${op.selectionKey}`;
          return false;
        }
        const dateKey = parsedKey.date;

        if (kind === "remove") {
          try {
            assertSelectionForChange(next, op.selectionKey);
          } catch (err: any) {
            opCode = String(err?.message || OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED);
            return false;
          }
          const prior = (next[dateKey] || []).find((e) => e && e.addOnId === parsedKey.addOnId);
          if (!prior) return true;
          const price = Math.max(0, Number(prior.priceSnapshot) || 0);
          const quantity = Math.max(0, Math.floor(Number(prior.quantity) || 0));
          // Per OCT-L3 (2026-10-20, decision #299): the shared 2dp
          // money rule — the refund liability must match the billed
          // total exactly.
          const totalAmt = roundToTwoDecimals(price * quantity);
          const marked: OtherAddOnSelectionEntry = {
            ...prior,
            removedAt: nowIso,
            removedBy: actorUid,
            lastModifiedAt: nowIso,
            lastModifiedBy: actorUid
          };
          next[dateKey] = (next[dateKey] || []).map((e) =>
            e && e.addOnId === parsedKey.addOnId ? marked : e
          );
          if (totalAmt > 0 && livePaidAmount > 0) {
            refundWrites.push({ selectionKey: op.selectionKey, entry: marked, amount: totalAmt });
          }
          auditWrites.push({
            op,
            addOnSnapshot: { addOnId: op.addOnId, name: prior.nameSnapshot, price, quantity },
            reason: isLateCutoff ? overrideReason || null : "Staff removed add-on.",
            occurredAfterCutoff: isLateCutoff
          });
          return true;
        }

        if (kind === "add") {
          try {
            assertAddOnExists(addOnById, op.addOnId);
            assertSelectionForAdd(next, op.selectionKey);
          } catch (err: any) {
            opCode = String(err?.message || OTHER_ADDON_OP_ERROR.SELECTION_ALREADY_ORDERED);
            return false;
          }
          const entry: OtherAddOnSelectionEntry = {
            addOnId: op.addOnId,
            // Per OCT-C2 (2026-10-20, audit
            // `plan/project/AUDIT-OCTOBER-2026.md`): the snapshot
            // fields come from the LIVE CATALOG, never from the
            // request body. The pre-fix code preferred the
            // client's `op.priceSnapshot` (`op.priceSnapshot ??
            // liveAddOn.price` — the client always sends it, so
            // the catalog fallback could never fire). That
            // defeated the `priceSnapshot` audit trail on the
            // staff path too: the `addOnSnapshot.price` written
            // to `otherAddOnAudit` recorded the REQUEST's price,
            // not the catalog's.
            nameSnapshot: liveAddOn.name,
            priceSnapshot: Math.max(0, Number(liveAddOn.price) || 0),
            quantity: Math.max(0, Math.floor(Number(op.quantity ?? 0) || 0)),
            unitSnapshot: liveAddOn.unit,
            addedAt: nowIso,
            addedBy: actorUid,
            lastModifiedAt: nowIso,
            lastModifiedBy: actorUid,
            removedAt: null,
            removedBy: null,
            cutoffHoursBeforeCheckInSnapshot: Math.max(
              0,
              Math.min(168, Math.floor(Number(liveAddOn.cutoffHoursBeforeCheckIn) || 24))
            )
          };
          next[dateKey] = [...(next[dateKey] || []), entry];
          auditWrites.push({
            op,
            addOnSnapshot: {
              addOnId: entry.addOnId,
              name: entry.nameSnapshot,
              price: entry.priceSnapshot,
              quantity: entry.quantity
            },
            reason: isLateCutoff ? overrideReason || null : null,
            occurredAfterCutoff: isLateCutoff
          });
          return true;
        }

        // change
        try {
          assertSelectionForChange(next, op.selectionKey);
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED);
          return false;
        }
        const prior = (next[dateKey] || []).find((e) => e && e.addOnId === parsedKey.addOnId);
        if (!prior) return true;
        const updated: OtherAddOnSelectionEntry = {
          ...prior,
          // Per OCT-C2 (2026-10-20): a CHANGE may only alter the
          // QUANTITY. Name / price / unit stay the entry's
          // existing snapshot — the pre-fix code preferred the
          // client's `op.priceSnapshot` here too.
          nameSnapshot: prior.nameSnapshot,
          priceSnapshot: prior.priceSnapshot,
          quantity: Math.max(0, Math.floor(Number(op.quantity ?? prior.quantity) || 0)),
          unitSnapshot: prior.unitSnapshot,
          lastModifiedAt: nowIso,
          lastModifiedBy: actorUid
        };
        next[dateKey] = (next[dateKey] || []).map((e) =>
          e && e.addOnId === parsedKey.addOnId ? updated : e
        );
        auditWrites.push({
          op,
          addOnSnapshot: {
            addOnId: updated.addOnId,
            name: updated.nameSnapshot,
            price: updated.priceSnapshot,
            quantity: updated.quantity
          },
          reason: isLateCutoff ? overrideReason || null : null,
          occurredAfterCutoff: isLateCutoff
        });
        return true;
      };

      for (const op of ops.remove) {
        if (!runOp(op, "remove")) return;
      }
      for (const op of ops.add) {
        if (!runOp(op, "add")) return;
      }
      for (const op of ops.change) {
        if (!runOp(op, "change")) return;
      }

      newTotal = recomputeOtherAddOnTotal(next);
      newHasAny = hasAnyOtherAddOns(next);

      // Per MRB-11b (QA pass 2026-10-25): the BR-12 other add-ons sit
      // on top of the room bill (OCT-FOL-01), so the MRB-11 revenue
      // allocation has to be RE-DERIVED when they change. This path
      // used to write only `otherAddOnTotal`, leaving the stored
      // allocation describing the OLD bill — so every revenue stream
      // that reads it under-reported by exactly this amount.
      const previousOtherAddOnTotal = recomputeOtherAddOnTotal(liveSelections);
      const revenueAllocation = rebuildBookingRevenueAllocation({
        existingAllocation: liveBooking.revenueAllocation,
        grossSubtotal: Number(liveBooking.originalTotalPrice) || 0,
        totalPrice: Number(liveBooking.totalPrice) || 0,
        otherAddOnTotal: newTotal,
        previousOtherAddOnTotal
      });

      transaction.update(bookingRef, {
        otherAddOnSelections: next,
        otherAddOnTotal: newTotal,
        hasAnyOtherAddOns: newHasAny,
        revenueAllocation,
        updatedAt: Timestamp.now()
      });

      for (const r of refundWrites) {
        createOtherAddOnRefundLiability({
          transaction,
          booking: { id: bookingId, bookingRef: bookingRefValue },
          selectionKey: r.selectionKey,
          addOnEntry: {
            addOnId: r.entry.addOnId,
            nameSnapshot: r.entry.nameSnapshot,
            priceSnapshot: r.entry.priceSnapshot,
            quantity: r.entry.quantity
          },
          amount: r.amount,
          reason: `Staff removed ${r.entry.nameSnapshot} on ${parseOtherAddOnSelectionKey(r.selectionKey)?.date || ""}.`,
          recordedBy: actorRole,
          recordedByUid: actorUid
        });
        pendingRefundKeys.push(r.selectionKey);
      }

      for (const a of auditWrites) {
        const baseAction =
          a.op.kind === "add"
            ? "add"
            : a.op.kind === "change"
              ? "change"
              : "remove";
        auditOtherAddOnOp({
          transaction,
          bookingId,
          selectionKey: a.op.selectionKey,
          action: (a.occurredAfterCutoff ? `override-${baseAction}` : baseAction) as
            | "add"
            | "change"
            | "remove"
            | "mark-served"
            | "override-add"
            | "override-change"
            | "override-remove",
          addOnSnapshot: a.addOnSnapshot,
          actorUid,
          actorRole,
          // Per OCT-H7 (2026-10-20, decision #286): the object form
          // carries BOTH the free-text reason and the cut-off flag.
          // The previous two-way `string | boolean` overload could
          // only carry one, so an override (which the action name
          // already flagged as `override-*`) still wrote
          // `occurredAfterCutoff: false` and the late-change
          // counter stayed at zero.
          reasonOrCutoff: {
            reason: a.reason,
            occurredAfterCutoff: a.occurredAfterCutoff
          }
        });
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: "Failed to save staff add-on updates."
    });
  }

  if (opCode) {
    return res.status(400).json({
      success: false,
      error: opErrorToMessage(opCode)
    });
  }

  return res.status(200).json({
    success: true,
    otherAddOnTotal: newTotal,
    hasAnyOtherAddOns: newHasAny,
    pendingRefunds: pendingRefundKeys
  });
}