// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): the staff-side kitchen visibility
// endpoint for the breakfast service.
//
//   POST /api/bookings/breakfast/mark-served
//
// Body: `{ bookingId, slotKey, action: "serve" | "unserve", reason: string|null }`.
//
// Behaviour:
//
//   • STAFF-Token gated (handled in apiRouter via
//     `authenticateStaff`).
//
//   • Reads the booking, refuses if the booking is
//     cancelled or checked-out (kitchen visibility
//     only makes sense while the guest is in-house).
//
//   • Reads the breakfast config for `servedGraceMinutes`
//     (the un-mark grace window — default 15 min per
//     BR-01's `DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES`).
//
//   • `action: "serve"` writes
//     `breakfastServed[key] = { servedAt, servedBy,
//     unservedAt: null, unservedBy: null }` and
//     appends a `breakfastAudit/{autoId}` doc with
//     `action: "serve"`.
//
//   • `action: "unserve"` reads the existing entry,
//     computes `(now - servedAt)` in minutes, and:
//
//        – within the grace window (default 15 min),
//          or with a `reason` of
//          `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH`+
//          chars — stamps `unservedAt + unservedBy`
//          on the existing entry and writes an audit
//          entry.
//
//        – beyond the grace window without a reason
//          — returns 400 with the human message
//          "Served-grace window passed (XX min). Un-
//          serving requires a reason.".
//
// The handler lives in this file (not split across
// serve.ts + unserve.ts) because the BR-05 path is one
// endpoint with two actions — splitting would add a
// second router import without a clear benefit.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES,
  MIN_BREAKFAST_OVERRIDE_REASON_LENGTH
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";
import { auditBreakfastOp } from "../lib/breakfast-selections";

// ---------- Wire schemas ----------

const slotKeySchema = z
  .string()
  .trim()
  .min(11)
  .max(80)
  .regex(/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+$/, "Invalid slot key.");

const markServedBodySchema = z
  .object({
    bookingId: z.string().trim().min(8).max(80),
    slotKey: slotKeySchema,
    action: z.enum(["serve", "unserve"]),
    reason: z.string().trim().max(500).nullable().optional().default(null),
    turnstileToken: z.string().trim().max(2000).optional()
  })
  .passthrough();

const staffRoles = ["admin", "front-desk"] as const;
type StaffRole = (typeof staffRoles)[number];

// Read the staff's role + uid from the apiRouter's
// `req.staff` payload.
function readStaff(req: VercelRequest): { uid: string; role: StaffRole } | null {
  const anyReq = req as any;
  const staff = anyReq.staff;
  if (!staff || !staff.uid) return null;
  const role = String(staff.role || "");
  if (role !== "admin" && role !== "front-desk") return null;
  return { uid: String(staff.uid), role };
}

// Read the served-grace window from the live settings
// doc (the BR-02 admin-only field). Falls back to the
// BR-01 default so a missing / unconfigured settings
// doc doesn't break the kitchen path.
async function loadServedGraceMinutes(): Promise<number> {
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("breakfastConfig")
      .get();
    const source: any = snap.exists ? snap.data() : null;
    const raw = Number(source && source.servedGraceMinutes);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  } catch {
    // Fall through to default.
  }
  return DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES;
}

// Read the live selection entry that the serve /
// unserve is targeting. The handler refuses if the
// slot has no live entry (a served mark on an empty
// slot is meaningless — the kitchen can't plate what
// wasn't ordered).
async function readBookingSlotEntry(
  bookingId: string,
  slotKey: string
): Promise<
  | {
      ok: true;
      booking: { id: string; status: string; breakfastSelections: Record<string, any> };
      breakfastSelections: Record<string, any>;
    }
  | { ok: false; code: "NOT_FOUND" | "TERMINAL" }
> {
  const ref = adminDb.collection("bookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND" };
  const data: any = snap.data() || {};
  const status = String(data.status || "");
  if (status === "cancelled" || status === "checked-out") {
    return { ok: false, code: "TERMINAL" };
  }
  return {
    ok: true,
    booking: {
      id: snap.id,
      status,
      breakfastSelections:
        data.breakfastSelections && typeof data.breakfastSelections === "object"
          ? data.breakfastSelections
          : {}
    },
    breakfastSelections: data.breakfastSelections || {}
  };
}

// ---------- Handler ----------

export async function handleMarkServed(req: VercelRequest, res: VercelResponse) {
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

  const parsed = markServedBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid mark-served payload."
    });
  }

  const { bookingId, slotKey, action, reason } = parsed.data;
  const trimmedReason = String(reason || "").trim() || null;

  // Read the served-grace window once so the un-serve
  // branch uses a single canonical value.
  const graceMinutes = await loadServedGraceMinutes();

  // Read the booking + target slot entry outside the
  // transaction — both fields are read once per request,
  // and the transaction still re-reads them inside its
  // own snapshot for atomicity (the writes below
  // happen in the transaction).
  const slotLookup = await readBookingSlotEntry(bookingId, slotKey);
  if (!slotLookup.ok) {
    if (slotLookup.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    return res.status(400).json({
      success: false,
      error: "This booking is checked-out or cancelled; kitchen visibility is locked."
    });
  }

  const selection =
    (slotLookup.breakfastSelections as Record<string, any>)[slotKey] || null;

  if (action === "serve") {
    if (!selection || selection.removedAt) {
      return res.status(400).json({
        success: false,
        error:
          "This slot has no meal to serve. Add a meal before marking it served."
      });
    }
  } else {
    // `unserve`: a served record must already exist.
    const existingServed: Record<string, any> = {};
    // Reading the served map needs the same booking doc
    // — pull it via a small targeted query inside the
    // transaction below. For now, sanity-check that the
    // slot was ordered (the kitchen can't un-serve what
    // wasn't on the ticket).
    if (!selection || selection.removedAt) {
      return res.status(400).json({
        success: false,
        error: "This slot has no meal to unserve."
      });
    }
  }

  // The transaction commits one of two shapes:
  //   - serve: set `breakfastServed[key] = { servedAt,
  //     servedBy, unservedAt: null, unservedBy: null }`
  //   - unserve: patch `breakfastServed[key]`
  //     in-place adding `unservedAt + unservedBy`
  //
  // We re-read the served map inside the transaction so
  // the un-serve branch sees the latest servedAt.
  let resultPayload: any = null;
  let opError: { status: number; error: string } | null = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const freshSnap = await transaction.get(bookingRef);
      if (!freshSnap.exists) {
        opError = { status: 404, error: "Booking not found." };
        return;
      }
      const fresh: any = freshSnap.data() || {};
      const freshServed: Record<string, any> =
        fresh.breakfastServed && typeof fresh.breakfastServed === "object"
          ? fresh.breakfastServed
          : {};

      const now = Timestamp.now();
      if (action === "serve") {
        const newEntry = {
          servedAt: now,
          servedBy: staff.uid,
          unservedAt: null,
          unservedBy: null
        };
        const nextServed = { ...freshServed, [slotKey]: newEntry };
        transaction.update(bookingRef, {
          breakfastServed: nextServed,
          updatedAt: now,
          updatedBy: staff.uid
        });
        auditBreakfastOp({
          transaction,
          bookingId,
          slotKey,
          action: "serve",
          mealSnapshot: {
            mealId: String(selection.mealId),
            mealName: String(selection.mealName),
            price: Number(selection.price || 0)
          },
          actorUid: staff.uid,
          actorRole: staff.role,
          reasonOrCutoff: false
        });
        resultPayload = {
          servedAt: now,
          servedBy: staff.uid,
          unservedAt: null,
          unservedBy: null
        };
        return;
      }

      // `unserve` branch
      const existing = freshServed[slotKey];
      if (!existing || !existing.servedAt) {
        opError = {
          status: 400,
          error: "This slot has not been marked served yet."
        };
        return;
      }
      const servedAt: Date =
        typeof existing.servedAt?.toDate === "function"
          ? existing.servedAt.toDate()
          : new Date(existing.servedAt);
      const nowDate = new Date();
      const elapsedMinutes = Math.max(
        0,
        Math.floor((nowDate.getTime() - servedAt.getTime()) / 60000)
      );
      if (elapsedMinutes > graceMinutes && !trimmedReason) {
        opError = {
          status: 400,
          error: `Served-grace window passed (${graceMinutes} min). Un-serving requires a reason.`
        };
        return;
      }
      if (trimmedReason && trimmedReason.length < MIN_BREAKFAST_OVERRIDE_REASON_LENGTH) {
        opError = {
          status: 400,
          error: `Reason must be at least ${MIN_BREAKFAST_OVERRIDE_REASON_LENGTH} characters when un-serving past the grace window.`
        };
        return;
      }

      const updatedEntry = {
        ...existing,
        unservedAt: now,
        unservedBy: staff.uid
      };
      const nextServed = { ...freshServed, [slotKey]: updatedEntry };
      transaction.update(bookingRef, {
        breakfastServed: nextServed,
        updatedAt: now,
        updatedBy: staff.uid
      });
      auditBreakfastOp({
        transaction,
        bookingId,
        slotKey,
        action: "unserve",
        mealSnapshot: {
          mealId: String(selection.mealId),
          mealName: String(selection.mealName),
          price: Number(selection.price || 0)
        },
        actorUid: staff.uid,
        actorRole: staff.role,
        // The grace-window un-serve (no reason) records
        // `false` so `occurredAfterCutoff` stays false.
        // The beyond-grace un-serve (with reason) carries
        // the staff's free-text — the kitchen list's
        // "Late un-serves" column (BR-07) filters on
        // either `action: "unserve"` or the reason
        // presence.
        reasonOrCutoff: trimmedReason ? trimmedReason : false
      });
      resultPayload = {
        servedAt: existing.servedAt,
        servedBy: existing.servedBy,
        unservedAt: now,
        unservedBy: staff.uid
      };
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[breakfast-mark-served] failed:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "We couldn't update the kitchen visibility. Please try again in a moment."
    });
  }

  if (opError) {
    return res.status(opError.status).json({ success: false, error: opError.error });
  }

  return res.status(200).json({ success: true, data: resultPayload });
}
