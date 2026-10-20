// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the guest Manage Other Add-Ons save-batch
// endpoint.
//
//   POST /api/bookings/addons/update
//
// Body shape mirrors `handleUpdateBreakfast` but the
// per-day × per-add-on selection map replaces the
// per-day × per-guest slot map. Each op is one of:
//
//   • add:      [{ selectionKey, addOnId, quantity, priceSnapshot, nameSnapshot, unitSnapshot, cutoffHoursBeforeCheckInSnapshot }]
//   • change:   [{ selectionKey, addOnId, quantity, priceSnapshot, nameSnapshot, unitSnapshot }]
//   • remove:   [{ selectionKey }]
//
// Per OCT-C2 (2026-10-20): the `priceSnapshot` / `nameSnapshot` /
// `unitSnapshot` / `cutoffHoursBeforeCheckInSnapshot` fields on
// the wire are ADVISORY ONLY — the server sources every snapshot
// field from the LIVE `addOns` catalog (an `add`) or keeps the
// entry's existing snapshot (a `change`, where only `quantity` is
// guest-editable). They are still accepted so a cached guest
// bundle keeps working. DO NOT reintroduce `op.priceSnapshot ??
// liveAddOn.price` — the client always sends the field, so the
// catalog fallback could never fire and a guest could set their
// own price.
//
// All ops are validated against the live `addOns` catalog
// + the per-add-on cut-off + the per-selection
// `otherAddOnServed` lock inside one Firestore transaction.
// A locked or served selection rejects the whole batch with
// 400 + a human message. On success:
//
//   1. Each op writes an `otherAddOnAudit/{autoId}` entry.
//   2. `remove` of a paid selection also writes a
//      `bookings/{id}/refunds/{refundId}` entry with
//      `category: "otherAddOn"`, status: "pending".
//   3. `otherAddOnTotal` + `hasAnyOtherAddOns` are
//      recomputed via the BR-12 helpers.
//   4. Idempotent on `clientBatchId` (60s window).
//
// Lookup-token gated (same as `handleGetAddOnsManage`).
// Turnstile gated by apiRouter layer.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase-admin";
import {
  OtherAddOnUpdateSchema,
  computeOtherAddOnCutoffState,
  recomputeOtherAddOnTotal,
  hasAnyOtherAddOns,
  normalizeAddOn,
  parseOtherAddOnSelectionKey,
  buildOtherAddOnSelectionKey,
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
import { hasAnyOtherAddOns } from "@spark-inn/shared";

const IDEMPOTENCY_WINDOW_MS = 60_000;

interface SaveOp {
  kind: "add" | "change" | "remove";
  selectionKey: string;
  addOnId: string;
  quantity?: number;
  priceSnapshot?: number;
  nameSnapshot?: string;
  unitSnapshot?: "per-person" | "per-stay";
  cutoffHoursBeforeCheckInSnapshot?: number;
}

function readOps(body: any): {
  add: SaveOp[];
  change: SaveOp[];
  remove: SaveOp[];
} {
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
  if (code === OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED) return "Nothing to change — add the add-on first.";
  if (code === OTHER_ADDON_OP_ERROR.INVALID_QUANTITY) return "Quantity must be between 0 and 50.";
  if (code.startsWith(OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX)) {
    const date = code.slice(OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX.length);
    return `Ordering closed for ${date}.`;
  }
  return "Could not save the add-on change.";
}

export async function handleUpdateAddOns(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = OtherAddOnUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid other-add-ons update payload." });
  }

  const { bookingRef, lookupToken, clientBatchId } = parsed.data;
  const ops = readOps(req.body || {});
  const totalOps = ops.add.length + ops.change.length + ops.remove.length;
  if (totalOps === 0) {
    return res.status(400).json({ success: false, error: "No add-on changes supplied." });
  }
  if (totalOps > 80) {
    return res.status(400).json({ success: false, error: "Too many add-on changes in one batch." });
  }

  // Idempotency: a 60s cache keyed on `clientBatchId` per
  // booking. Mirrors the BR-04 breakfast idempotency.
  const idempotencyRef = adminDb.collection("idempotencyLog").doc(`addons-update:${bookingRef}:${clientBatchId}`);
  try {
    const existing = await idempotencyRef.get();
    if (existing.exists) {
      const stamp = existing.data() || {};
      const ageMs = Date.now() - Number(stamp.createdAtMs || 0);
      if (ageMs < IDEMPOTENCY_WINDOW_MS) {
        return res.status(200).json({
          success: true,
          idempotent: true,
          otherAddOnTotal: Number(stamp.otherAddOnTotal || 0),
          hasAnyOtherAddOns: Boolean(stamp.hasAnyOtherAddOns),
          pendingRefunds: stamp.pendingRefunds || []
        });
      }
    }
  } catch {
    // Fall through — treat as a fresh request.
  }

  // Look up the booking by ref + token.
  const bookingQ = await adminDb
    .collection("bookings")
    .where("bookingRef", "==", bookingRef)
    .limit(1)
    .get();
  if (bookingQ.empty) {
    return res.status(404).json({ success: false, error: "Booking not found." });
  }
  const bookingDoc = bookingQ.docs[0];
  if (String(bookingDoc.data().lookupToken || "") !== lookupToken) {
    return res.status(403).json({ success: false, error: "Invalid token." });
  }
  const bookingId = bookingDoc.id;
  const bookingData = bookingDoc.data();
  const status = String(bookingData.status || "").trim();
  if (status === "checked-out" || status === "cancelled") {
    return res.status(400).json({ success: false, error: "Booking is read-only." });
  }

  // Load the add-on catalog inside the transaction's
  // setup phase (read-before-write rule). Defensive: an
  // empty catalog rejects every op with 400.
  const addOnSnap = await adminDb.collection("addOns").get();
  const addOnById = new Map<string, AddOn>();
  for (const d of addOnSnap.docs) {
    const norm = normalizeAddOn({ id: d.id, ...d.data() }, d.id);
    if (norm) addOnById.set(norm.id, norm);
  }

  if (addOnById.size === 0) {
    return res.status(400).json({ success: false, error: "No add-ons available right now." });
  }

  let opCode: string | null = null;
  let pendingRefundKeys: string[] = [];
  let newTotal = 0;
  let newHasAny = false;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const bookingRefInTx = adminDb.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRefInTx);
      if (!bookingSnap.exists) {
        opCode = "BOOKING_NOT_FOUND";
        return;
      }
      const liveBooking = bookingSnap.data() || {};
      const liveSelections: Record<string, OtherAddOnSelectionEntry[]> =
        liveBooking.otherAddOnSelections && typeof liveBooking.otherAddOnSelections === "object"
          ? { ...liveBooking.otherAddOnSelections }
          : {};
      const liveServed: Record<string, unknown> =
        liveBooking.otherAddOnServed && typeof liveBooking.otherAddOnServed === "object"
          ? liveBooking.otherAddOnServed
          : {};

      // Build the next state by replaying ops in
      // `add → change → remove` order (so a remove-then-
      // re-add doesn't race).
      const next: Record<string, OtherAddOnSelectionEntry[]> = { ...liveSelections };
      const auditWrites: Array<{
        op: SaveOp;
        addOnSnapshot: { addOnId: string; name: string; price: number; quantity: number } | null;
        actorRole: "guest";
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

      // 1) REMOVEs first.
      for (const op of ops.remove) {
        const parsedKey = parseOtherAddOnSelectionKey(op.selectionKey);
        if (!parsedKey) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        const liveAddOn = addOnById.get(op.addOnId);
        if (!liveAddOn) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        try {
          assertNotLocked({
            selectionKey: op.selectionKey,
            serverNow: now,
            addOn: liveAddOn
          });
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX);
          return;
        }
        if (liveServed[op.selectionKey]) {
          opCode = `SERVE_BLOCKED:${op.selectionKey}`;
          return;
        }
        assertSelectionForChange(next, op.selectionKey);
        const dateKey = parsedKey.date;
        const prior = (next[dateKey] || []).find((e) => e && e.addOnId === parsedKey.addOnId);
        if (!prior) continue;
        const quantity = Math.max(0, Math.floor(Number(prior.quantity) || 0));
        const price = Math.max(0, Number(prior.priceSnapshot) || 0);
        const totalAmt = price * quantity;
        const marked: OtherAddOnSelectionEntry = {
          ...prior,
          removedAt: nowIso,
          removedBy: "guest",
          lastModifiedAt: nowIso,
          lastModifiedBy: "guest"
        };
        next[dateKey] = (next[dateKey] || []).map((e) =>
          e && e.addOnId === parsedKey.addOnId ? marked : e
        );
        if (totalAmt > 0 && livePaidAmount > 0) {
          refundWrites.push({
            selectionKey: op.selectionKey,
            entry: marked,
            amount: totalAmt
          });
        }
        auditWrites.push({
          op,
          addOnSnapshot: { addOnId: op.addOnId, name: prior.nameSnapshot, price, quantity },
          actorRole: "guest",
          reason: "Guest removed add-on.",
          occurredAfterCutoff: false
        });
      }

      // 2) ADDs.
      for (const op of ops.add) {
        const parsedKey = parseOtherAddOnSelectionKey(op.selectionKey);
        if (!parsedKey) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        const liveAddOn = addOnById.get(op.addOnId);
        if (!liveAddOn) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        try {
          assertNotLocked({
            selectionKey: op.selectionKey,
            serverNow: now,
            addOn: liveAddOn
          });
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX);
          return;
        }
        if (liveServed[op.selectionKey]) {
          opCode = `SERVE_BLOCKED:${op.selectionKey}`;
          return;
        }
        try {
          assertAddOnExists(addOnById, op.addOnId);
          assertSelectionForAdd(next, op.selectionKey);
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.SELECTION_ALREADY_ORDERED);
          return;
        }
        const dateKey = parsedKey.date;
        // Per OCT-C2 (2026-10-20, audit
        // `plan/project/AUDIT-OCTOBER-2026.md`): the snapshot
        // fields come from the LIVE CATALOG, never from the
        // request. The pre-fix code preferred the client's
        // `op.priceSnapshot` (`op.priceSnapshot ?? liveAddOn.price`
        // — the client always sends it, so the catalog fallback
        // could never fire), which let a guest buy a ₱500
        // airport transfer for ₱1 and permanently snapshot that
        // price onto the booking.
        //
        // The client still sends `priceSnapshot` / `nameSnapshot` /
        // `unitSnapshot` / `cutoffHoursBeforeCheckInSnapshot` (an
        // older guest bundle may be cached) — they are accepted
        // and IGNORED. The catalog price is the only price.
        const entry: OtherAddOnSelectionEntry = {
          addOnId: op.addOnId,
          nameSnapshot: liveAddOn.name,
          priceSnapshot: Math.max(0, Number(liveAddOn.price) || 0),
          quantity: Math.max(0, Math.floor(Number(op.quantity ?? 0) || 0)),
          unitSnapshot: liveAddOn.unit,
          addedAt: nowIso,
          addedBy: "guest",
          lastModifiedAt: nowIso,
          lastModifiedBy: "guest",
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
          actorRole: "guest",
          reason: null,
          occurredAfterCutoff: false
        });
      }

      // 3) CHANGEs.
      for (const op of ops.change) {
        const parsedKey = parseOtherAddOnSelectionKey(op.selectionKey);
        if (!parsedKey) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        const liveAddOn = addOnById.get(op.addOnId);
        if (!liveAddOn) {
          opCode = OTHER_ADDON_OP_ERROR.ADDON_NOT_AVAILABLE;
          return;
        }
        try {
          assertNotLocked({
            selectionKey: op.selectionKey,
            serverNow: now,
            addOn: liveAddOn
          });
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.LOCKED_DATE_PREFIX);
          return;
        }
        if (liveServed[op.selectionKey]) {
          opCode = `SERVE_BLOCKED:${op.selectionKey}`;
          return;
        }
        try {
          assertSelectionForChange(next, op.selectionKey);
        } catch (err: any) {
          opCode = String(err?.message || OTHER_ADDON_OP_ERROR.SELECTION_NOT_ORDERED);
          return;
        }
        const dateKey = parsedKey.date;
        const prior = (next[dateKey] || []).find((e) => e && e.addOnId === parsedKey.addOnId);
        if (!prior) continue;
        const updated: OtherAddOnSelectionEntry = {
          ...prior,
          // Per OCT-C2 (2026-10-20): a CHANGE may only alter the
          // QUANTITY. The name / price / unit are the entry's
          // existing snapshot — the pre-fix code preferred the
          // client's `op.priceSnapshot` here too, so a guest
          // could re-price an existing line item on the way in.
          //
          // The snapshot is intentionally NOT re-read from the
          // catalog on a change: per OTHER-ADD-ONS.md the guest
          // keeps the price they ordered at, even if the admin
          // changes the catalog price afterwards. A NEW order
          // takes the current catalog price (see the add op).
          nameSnapshot: prior.nameSnapshot,
          priceSnapshot: prior.priceSnapshot,
          quantity: Math.max(0, Math.floor(Number(op.quantity ?? prior.quantity) || 0)),
          unitSnapshot: prior.unitSnapshot,
          lastModifiedAt: nowIso,
          lastModifiedBy: "guest"
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
          actorRole: "guest",
          reason: null,
          occurredAfterCutoff: false
        });
      }

      // Compute the new total + hasAny.
      newTotal = recomputeOtherAddOnTotal(next);
      newHasAny = hasAnyOtherAddOns(next);

      // Write the booking update.
      transaction.update(bookingRefInTx, {
        otherAddOnSelections: next,
        otherAddOnTotal: newTotal,
        hasAnyOtherAddOns: newHasAny,
        updatedAt: Timestamp.now()
      });

      // Write refund liab + audit.
      for (const r of refundWrites) {
        createOtherAddOnRefundLiability({
          transaction,
          booking: { id: bookingId, bookingRef },
          selectionKey: r.selectionKey,
          addOnEntry: {
            addOnId: r.entry.addOnId,
            nameSnapshot: r.entry.nameSnapshot,
            priceSnapshot: r.entry.priceSnapshot,
            quantity: r.entry.quantity
          },
          amount: r.amount,
          reason: `Guest removed ${r.entry.nameSnapshot} on ${parseOtherAddOnSelectionKey(r.selectionKey)?.date || ""}.`,
          recordedBy: "guest",
          recordedByUid: "guest"
        });
        pendingRefundKeys.push(r.selectionKey);
      }

      for (const a of auditWrites) {
        auditOtherAddOnOp({
          transaction,
          bookingId,
          selectionKey: a.op.selectionKey,
          action:
            a.op.kind === "add"
              ? "add"
              : a.op.kind === "change"
                ? "change"
                : "remove",
          addOnSnapshot: a.addOnSnapshot,
          actorUid: "guest",
          actorRole: a.actorRole,
          // Per OCT-H7 (2026-10-20, decision #286): the object form
          // carries BOTH the free-text reason and the cut-off flag.
          // On the guest surface the flag is always `false` (the
          // guest is blocked once a date locks), but passing it
          // explicitly keeps the intent visible instead of
          // relying on the default.
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
      error: "Failed to save add-on changes."
    });
  }

  if (opCode) {
    return res.status(400).json({
      success: false,
      error: opErrorToMessage(opCode)
    });
  }

  // Write the idempotency stamp.
  try {
    await idempotencyRef.set({
      bookingRef,
      clientBatchId,
      createdAtMs: Date.now(),
      otherAddOnTotal: newTotal,
      hasAnyOtherAddOns: newHasAny,
      pendingRefunds: pendingRefundKeys
    });
  } catch {
    // Non-fatal — the operation already succeeded.
  }

  return res.status(200).json({
    success: true,
    otherAddOnTotal: newTotal,
    hasAnyOtherAddOns: newHasAny,
    pendingRefunds: pendingRefundKeys
  });
}