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
  DEFAULT_BREAKFAST_CUTOFF_TIME,
  DEFAULT_BREAKFAST_CUTOFF_TIMEZONE,
  MIN_BREAKFAST_OVERRIDE_REASON_LENGTH,
  computeBreakfastCutoffState
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";
import { auditBreakfastOp } from "../lib/breakfast-selections";
// Per BR-08 (decision #238, 2026-10-14 — close-out): the
// `sendLateServedTrigger` carries the guest-facing "Late
// served — please rate" email fired from this handler
// when a serve action crosses the per-date cutoff window.
// The email is the guest's first signal that the meal was
// delivered past the published cutoff.
import { sendLateServedTrigger } from "./email";

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

// Read the BR-02 per-date cutoff triple
// (`cutoffTime` + `cutoffTimezone`) + the BR-10
// `cutoffsEnabled` toggle so the serve branch can
// detect a late serve without re-reading the settings
// doc. Falls back to the BR-01 defaults so a missing /
// unconfigured settings doc still gates (the defaults
// match the documented hotel posture). `cutoffsEnabled`
// defaults to `true` (pre-BR-10 behaviour) for legacy
// / missing values — the same defensive shape
// `normalizeBreakfastConfig` uses on the read side.
async function loadCutoffConfig(): Promise<{
  cutoffTime: string;
  cutoffTimezone: string;
  cutoffsEnabled: boolean;
}> {
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("breakfastConfig")
      .get();
    const source: any = snap.exists ? snap.data() : null;
    const rawCutoff = String(source && source.cutoffTime || "").trim();
    const rawZone = String(source && source.cutoffTimezone || "").trim();
    if (
      /^([01]\d|2[0-3]):[0-5]\d$/.test(rawCutoff) &&
      rawZone.length > 0
    ) {
      return {
        cutoffTime: rawCutoff,
        cutoffTimezone: rawZone,
        cutoffsEnabled: source?.cutoffsEnabled !== false
      };
    }
  } catch {
    // Fall through to defaults.
  }
  return {
    cutoffTime: DEFAULT_BREAKFAST_CUTOFF_TIME,
    cutoffTimezone: DEFAULT_BREAKFAST_CUTOFF_TIMEZONE,
    cutoffsEnabled: true
  };
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

  // Read the per-date cutoff triple so the serve branch
  // can flag a late serve (a serve action whose slot date
  // has crossed `cutoffTime` — per BR-08 + decision #238).
  // The cut-off is a single canonical value keyed off the
  // BR-02 settings doc; a missing / unconfigured doc falls
  // back to the BR-01 defaults (`20:00 Asia/Manila`).
  const { cutoffTime, cutoffTimezone, cutoffsEnabled } = await loadCutoffConfig();

  // Detect a late serve up-front so the audit doc carries
  // `occurredAfterCutoff: true` AND the post-transaction
  // email fires. The `computeBreakfastCutoffState` helper
  // returns `isLocked: true` when `now >= cutoffAt`; we
  // use the same gate as the BR-04 manage + BR-07
  // kitchen-list late-change column (BR-08 ships this
  // single detector as the source of truth). The
  // fallback path inside `computeBreakfastCutoffState`
  // already returns `isLocked: true` on any bad input,
  // so a misconfigured settings doc means every serve is
  // flagged late — the conservative posture.
  const slotDate = slotKey.slice(0, 10);
  let isLateServe = false;
  if (action === "serve") {
    // Per BR-10 (2026-10-14, decision #244 reserved —
    // Phase 14): thread the cut-off enforcement toggle
    // through. When `cutoffsEnabled === false`, the
    // late-serve detector (which stamps the
    // `BreakfastAuditEntry.occurredAfterCutoff` flag)
    // never fires — every serve is "on time" by
    // construction. The `cutoffTime` + `cutoffTimezone`
    // settings still flow through so the helper
    // populates `cutoffAt` for any future UI hint.
    const cutoffState = computeBreakfastCutoffState({
      serviceDate: slotDate,
      now: new Date(),
      cutoffTime,
      timezone: cutoffTimezone,
      cutoffsEnabled
    });
    isLateServe = cutoffState.isLocked;
  }

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
          // Per BR-08 (decision #238, 2026-10-14 — close-out):
          // late serves (a serve action after the per-date
          // cutoff window) carry `true` so the audit doc
          // stamps `occurredAfterCutoff: true`. The kitchen
          // list's "Late changes" column (BR-07) and the new
          // late-served guest email both read this flag.
          // On-time serves (`isLocked === false`) keep the
          // historical `false` (no flag).
          reasonOrCutoff: isLateServe
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

  // Per BR-08 (decision #238, 2026-10-14 — close-out):
  // fire the guest-facing "Late served — please rate"
  // email after the transaction commits, only when the
  // serve action crossed the per-date cutoff. Fire-and-
  // log: an email send failure must NOT mask the 200
  // response — the audit doc + kitchen list are already
  // correct, the email is the guest-comms icing.
  if (isLateServe && action === "serve") {
    try {
      const detail = await adminDb.collection("bookings").doc(bookingId).get();
      const data: any = detail.exists ? detail.data() || {} : {};
      const guestEmail = String(data.guestEmail || "").trim();
      if (guestEmail) {
        const slotEntry = {
          slotKey,
          mealId: String(selection.mealId),
          mealName: String(selection.mealName),
          price: Number(selection.price || 0)
        };
        const occurredAtIso = new Date().toISOString();
        await sendLateServedTrigger(
          {
            id: bookingId,
            bookingRef: data.bookingRef || data.reservationRef || bookingId,
            reservationRef: data.reservationRef || null,
            guestEmail,
            guestName: data.guestName || "",
            isTestData: data.isTestData === true,
            testRunName: typeof data.testRunName === "string" ? data.testRunName : undefined,
            testRunEnvironment:
              data.testRunEnvironment === "staging" || data.testRunEnvironment === "production"
                ? data.testRunEnvironment
                : undefined
          },
          slotEntry,
          occurredAtIso
        );
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("[breakfast-mark-served] late-served email failed:", err?.message || err);
    }
  }

  return res.status(200).json({ success: true, data: resultPayload });
}
