// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): the staff-side batch save endpoint
// that mirrors `handleUpdateBreakfast` (BR-04) but for
// the admin booking drawer. The same per-op rules
// (meal exists + per-date cutoff not passed + per-slot
// `breakfastServed` lock not flipped) apply — only the
// actor changes (staff, not guest).
//
// Differences from the guest path:
//
//   • STAFF-Token gated (handled in apiRouter via
//     `authenticateStaff`).
//
//   • Reads the booking by `bookingId`, not by the
//     guest lookup token (the staff drawer already has
//     the full booking loaded).
//
//   • When the per-date cutoff has passed, the staff
//     MAY still save the op IF `overrideCutoff: true`
//     + `overrideReason` (min `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH`
//     chars). The audit entry's `action` is then
//     `override-add | override-change | override-remove`
//     so the kitchen list's "Late changes" column
//     (BR-07) can filter on the override-prefixed
//     enum. The `frontDeskOverrideEnabled` setting
//     gate (default false) controls whether
//     front-desk may override — admin always can.
//
//   • Writes `actorRole: "front-desk" | "admin"` on
//     audit entries (vs. `"guest"` on the BR-04 path).
//
//   • Refund liability for paid `remove` ops is the
//     same shape — BR-01's `category: "breakfast"` +
//     `status: "pending"` is preserved end-to-end.
//
// The handler lives in this file (not split) because
// (a) it imports the same per-op helpers from
// `lib/breakfast-selections.ts` as the BR-04 handler
// + (b) the staff save path is one endpoint, no need
// for a second file. The 12-function Vercel Hobby cap
// is unchanged — this is a new branch in the existing
// catch-all, not a new Vercel function.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  BOOKING_REF_REGEX,
  computeBreakfastCutoffState,
  MIN_BREAKFAST_OVERRIDE_REASON_LENGTH,
  recomputeBreakfastTotal,
  sumBreakfastRateLines,
  computeBreakfastAdjustedTotalPrice,
  type BreakfastMeal,
  type BreakfastSelectionEntry,
  type PublicBreakfastConfig
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";
import {
  auditBreakfastOp,
  assertMealExists,
  assertNotLocked,
  assertSlotForAdd,
  assertSlotForChange,
  assertSlotNotServed,
  createBreakfastRefundLiability
} from "../lib/breakfast-selections";

// ---------- Wire schemas ----------

// The `actorRole` literals the apiRouter's
// `authenticateStaff` returns are `"admin"` and
// `"front-desk"`. The audit entry's enum is the
// same — see `shared/types/index.ts §BreakfastAuditEntry`.
const staffRoles = ["admin", "front-desk"] as const;
type StaffRole = (typeof staffRoles)[number];

const slotKeySchema = z
  .string()
  .trim()
  .min(11)
  .max(80)
  .regex(/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+$/, "Invalid slot key.");

const addOrChangeSchema = z.object({
  slotKey: slotKeySchema,
  mealId: z.string().trim().min(1).max(80),
  mealName: z.string().trim().min(1).max(120),
  price: z.number().finite().min(0).max(1_000_000)
});

const removeSchema = z.object({
  slotKey: slotKeySchema
});

const updateBodySchema = z
  .object({
    bookingId: z.string().trim().min(8).max(80),
    // Optional clientBatchId for the same idempotency-replay
    // model the BR-04 handler uses. A staff retry after
    // an uncertain response lands on the same batch slot.
    clientBatchId: z
      .string()
      .trim()
      .min(8)
      .max(80)
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        "Invalid clientBatchId."
      )
      .optional(),
    add: z.array(addOrChangeSchema).max(200).default([]),
    change: z.array(addOrChangeSchema).max(200).default([]),
    remove: z.array(removeSchema).max(200).default([]),
    overrideCutoff: z.boolean().optional().default(false),
    overrideReason: z.string().trim().max(500).nullable().optional().default(null),
    turnstileToken: z.string().trim().max(2000).optional()
  })
  .passthrough();

// ---------- Helpers ----------

// Read the public-ish breakfast config (same payload the
// BR-03 handler returns, no admin-only fields). The
// `frontDeskOverrideEnabled` flag is admin-only and is
// fetched separately below so a misconfigured settings
// doc never blocks the override path silently.
async function loadPublicBreakfastConfig(): Promise<PublicBreakfastConfig> {
  // `normalizeBreakfastConfig` lives in
  // `@spark-inn/shared` (it handles the `null` /
  // malformed-source case the same way the BR-03 +
  // BR-04 handlers do).
  const mod = await import("@spark-inn/shared");
  const normalize = (mod as any).normalizeBreakfastConfig;
  try {
    const snap = await adminDb.collection("settings").doc("breakfastConfig").get();
    const source = snap.exists ? snap.data() : null;
    return typeof normalize === "function"
      ? normalize(source)
      : (source as PublicBreakfastConfig) || {};
  } catch {
    return typeof normalize === "function" ? normalize(null) : {};
  }
}

// Read the admin-only `frontDeskOverrideEnabled` flag
// (default false). When false, even a `front-desk`
// staff request with `overrideCutoff: true` is rejected
// with 403. Admins always pass (the spec says the
// admin path never gates behind this flag).
async function loadFrontDeskOverrideEnabled(): Promise<boolean> {
  try {
    const snap = await adminDb.collection("settings").doc("breakfastConfig").get();
    const source: any = snap.exists ? snap.data() : null;
    return Boolean(source && source.frontDeskOverrideEnabled === true);
  } catch {
    return false;
  }
}

// Read the staff's role + uid from the apiRouter's
// `req.staff` payload (populated by `authenticateStaff`).
// The cast is necessary because `VercelRequest` is
// intentionally type-loose for `req.any` extensions.
function readStaff(req: VercelRequest): { uid: string; role: StaffRole } | null {
  const anyReq = req as any;
  const staff = anyReq.staff;
  if (!staff || !staff.uid) return null;
  const role = String(staff.role || "");
  if (role !== "admin" && role !== "front-desk") return null;
  return { uid: String(staff.uid), role };
}

// Translate the shared per-op error codes into 4xx
// responses. Same shape as the BR-04 handler so the
// admin UI's `toast.error` strings stay consistent.
function translateOpError(code: string): { status: number; message: string } {
  if (code === "MEAL_NOT_AVAILABLE") {
    return {
      status: 400,
      message:
        "One of the selected meals is no longer available. Please refresh and try again."
    };
  }
  if (code.startsWith("LOCKED_DATE:")) {
    const date = code.split(":")[1] || "";
    return {
      status: 400,
      message: `Ordering closed for breakfast on ${date}.`
    };
  }
  if (code.startsWith("SLOT_SERVED:")) {
    return {
      status: 400,
      message: "This meal has already been served and cannot be edited."
    };
  }
  if (code === "SLOT_ALREADY_ORDERED") {
    return {
      status: 400,
      message: "This slot already has a meal selected. Use 'change' to update it."
    };
  }
  if (code === "SLOT_NOT_ORDERED") {
    return {
      status: 400,
      message: "This slot has no meal to change. Use 'add' instead."
    };
  }
  return { status: 500, message: "We couldn't save the changes. Please try again in a moment." };
}

// ---------- Handler ----------

export async function handleStaffUpdateBreakfast(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  // Staff gate is enforced in apiRouter before the handler
  // call — `req.staff` is populated. Re-verify the role
  // here so the handler is the source of truth for any
  // future caller (no double defense = bug surface).
  const staff = readStaff(req);
  if (!staff) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Access restricted to staff members."
    });
  }

  const parsed = updateBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid breakfast update payload."
    });
  }

  const {
    bookingId,
    clientBatchId,
    add,
    change,
    remove,
    overrideCutoff,
    overrideReason
  } = parsed.data;

  // Per BR-05: the override reason is required when
  // `overrideCutoff: true`. The min length matches the
  // BR-01 `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH` constant
  // (5 chars — short but enough to filter accidentally-
  // pasted whitespace from a deliberate reason).
  if (overrideCutoff) {
    const reason = String(overrideReason || "").trim();
    if (reason.length < MIN_BREAKFAST_OVERRIDE_REASON_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Override reason required (min ${MIN_BREAKFAST_OVERRIDE_REASON_LENGTH} characters) when continuing past the cutoff.`
      });
    }
    // Per BR-02: front-desk override is gated behind a
    // settings flag (default off). Admin always passes.
    if (staff.role === "front-desk") {
      const enabled = await loadFrontDeskOverrideEnabled();
      if (!enabled) {
        return res.status(403).json({
          success: false,
          error: "Front-desk overrides are disabled in Settings. Ask an admin to perform this change."
        });
      }
    }
  }

  // Load the live breakfast config — same payload as
  // the BR-03 + BR-04 handlers use. The
  // `cutoffTime` + `cutoffTimezone` are the cutoff
  // source for the per-op `assertNotLocked` call.
  const publicConfig = await loadPublicBreakfastConfig();
  const breakfastConfigAny: any = publicConfig as any;
  const cutoffTime = String(
    breakfastConfigAny.cutoffTime || "20:00"
  );
  const tz = String(
    breakfastConfigAny.cutoffTimezone ||
      breakfastConfigAny.timezone ||
      "Asia/Manila"
  );
  // Per BR-10 (2026-10-14, decision #244 reserved —
  // Phase 14): thread the cut-off enforcement toggle
  // through the per-op `assertNotLocked` calls. When
  // `false`, the staff override flow becomes a no-op
  // (no date ever locks, nothing to bypass) but the
  // audit + write paths stay symmetric with the guest
  // manage flow.
  const cutoffsEnabled =
    (publicConfig as { cutoffsEnabled?: boolean }).cutoffsEnabled !== false;

  const mealById = new Map<string, BreakfastMeal>();
  for (const meal of (breakfastConfigAny.meals || [])) {
    if (meal && (meal as any).id) mealById.set((meal as any).id, meal as BreakfastMeal);
  }

  if (!breakfastConfigAny.isEnabled) {
    return res.status(400).json({
      success: false,
      error: "Breakfast is currently not available. Please contact the front desk."
    });
  }

  const serverNow = new Date();

  const resultSummary = {
    newBalance: 0,
    refundLiabilityCreated: 0,
    opsApplied: 0,
    overrideCount: 0,
    auditEntriesWritten: 0
  };
  let priorResult: any = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      // Optional idempotency replay for retry-safe
      // submissions. The collection lives at
      // `bookings/__breakfastStaffUpdateBatches/batches/{clientBatchId}`
      // — separate from the BR-04 collection so the
      // audit + replay windows don't collide across
      // actor roles.
      if (clientBatchId) {
        const batchDocRef = adminDb
          .collection("bookings")
          .doc("__breakfastStaffUpdateBatches")
          .collection("batches")
          .doc(clientBatchId);
        const existingBatch = await transaction.get(batchDocRef);
        if (existingBatch.exists) {
          const prior: any = existingBatch.data() || {};
          const ageMs = Date.now() - Number(prior.committedAt || 0);
          if (ageMs < 60_000 && prior.bookingId === bookingId) {
            priorResult = prior.summary || null;
            return;
          }
        }
      }

      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      const booking: any = { id: bookingSnap.id, ...bookingSnap.data() };

      const status = String(booking.status || "").trim();
      if (status === "cancelled" || status === "checked-out") {
        throw new Error("BOOKING_TERMINAL");
      }

      const existingSelections: Record<string, BreakfastSelectionEntry> =
        (booking.breakfastSelections &&
          typeof booking.breakfastSelections === "object")
          ? booking.breakfastSelections
          : {};
      const existingServed: Record<string, any> =
        (booking.breakfastServed && typeof booking.breakfastServed === "object")
          ? booking.breakfastServed
          : {};

      const nextSelections: Record<string, BreakfastSelectionEntry> = {
        ...existingSelections
      };

      let opsApplied = 0;
      let auditEntriesWritten = 0;
      let refundLiabilityCreated = 0;
      let overrideCount = 0;

      // Wrap the per-op validation so the staff override
      // path can convert a `LOCKED_DATE` throw into the
      // `override-*` audit action + skip the cutoff
      // check. All other error codes propagate.
      const applyAddOrChange = (
        op: { slotKey: string; mealId: string; mealName: string; price: number },
        actionKind: "add" | "change"
      ) => {
        assertMealExists(mealById, op.mealId);
        let isOverride = false;
        try {
          assertNotLocked({
            slotKey: op.slotKey,
            serverNow,
            cutoffTime,
            timezone: tz,
            cutoffsEnabled
          });
        } catch (err: any) {
          if (String(err?.message || "").startsWith("LOCKED_DATE:") && overrideCutoff) {
            isOverride = true;
          } else {
            throw err;
          }
        }
        assertSlotNotServed(existingServed, op.slotKey);
        if (actionKind === "add") {
          assertSlotForAdd(nextSelections, op.slotKey);
        } else {
          assertSlotForChange(nextSelections, op.slotKey);
        }

        const meal = mealById.get(op.mealId)!;
        const serverPrice = Number(meal.price || 0);
        const reason = String(overrideReason || "").trim() || null;

        if (actionKind === "add") {
          nextSelections[op.slotKey] = {
            mealId: meal.id,
            mealName: meal.name,
            price: serverPrice,
            addedAt: Timestamp.now() as any,
            addedBy: staff.uid,
            lastModifiedAt: Timestamp.now() as any,
            lastModifiedBy: staff.uid,
            removedAt: null,
            removedBy: null,
            overrideCutoff: isOverride,
            overrideReason: isOverride ? reason : null
          };
        } else {
          // `assertSlotForChange` throws `SLOT_NOT_ORDERED`
          // when the slot has no live prior entry; TS does
          // not narrow the type through a throws-only
          // helper, so the cast is required.
          const prior = nextSelections[op.slotKey] as BreakfastSelectionEntry;
          nextSelections[op.slotKey] = {
            ...prior,
            mealId: meal.id,
            mealName: meal.name,
            price: serverPrice,
            lastModifiedAt: Timestamp.now() as any,
            lastModifiedBy: staff.uid,
            overrideCutoff: isOverride ? true : prior.overrideCutoff === true,
            overrideReason: isOverride ? reason : prior.overrideReason ?? null
          };
        }

        opsApplied += 1;
        auditEntriesWritten += 1;
        auditBreakfastOp({
          transaction,
          bookingId: booking.id,
          slotKey: op.slotKey,
          action: isOverride
            ? (actionKind === "add" ? "override-add" : "override-change")
            : actionKind,
          mealSnapshot: {
            mealId: meal.id,
            mealName: meal.name,
            price: serverPrice
          },
          actorUid: staff.uid,
          actorRole: staff.role,
          // Per OCT-H7 (2026-10-20, decision #286): the object
          // form carries BOTH the free-text reason and the
          // cut-off flag.
          //
          // The previous call passed the reason STRING (or
          // `false`) through the two-way `string | boolean`
          // overload, so the helper could set EITHER the reason
          // OR the flag — never both. An override therefore
          // wrote `reason: "<text>"` with
          // `occurredAfterCutoff: false`, and the "Late changes"
          // metric (which filters
          // `occurredAfterCutoff == true`) was permanently empty
          // for precisely the case it exists to count: a staff
          // member overriding a locked date after cut-off.
          //
          // Non-override actions still stamp `false` (they mirror
          // the BR-04 guest path, which is always pre-cutoff).
          reasonOrCutoff: {
            reason: isOverride ? reason : null,
            occurredAfterCutoff: isOverride
          }
        });
        if (isOverride) overrideCount += 1;
      };

      const applyRemove = (op: { slotKey: string }) => {
        let isOverride = false;
        try {
          assertNotLocked({
            slotKey: op.slotKey,
            serverNow,
            cutoffTime,
            timezone: tz,
            cutoffsEnabled
          });
        } catch (err: any) {
          if (String(err?.message || "").startsWith("LOCKED_DATE:") && overrideCutoff) {
            isOverride = true;
          } else {
            throw err;
          }
        }
        assertSlotNotServed(existingServed, op.slotKey);
        assertSlotForChange(nextSelections, op.slotKey);
        const prior = nextSelections[op.slotKey] as BreakfastSelectionEntry;
        const reason = String(overrideReason || "").trim() || null;

        nextSelections[op.slotKey] = {
          ...prior,
          removedAt: Timestamp.now() as any,
          removedBy: staff.uid,
          lastModifiedAt: Timestamp.now() as any,
          lastModifiedBy: staff.uid,
          overrideCutoff: isOverride ? true : (prior.overrideCutoff || false),
          overrideReason: isOverride ? reason : prior.overrideReason || null
        };

        // Per BR-04 + BR-01 §OnsitePayment extension: a
        // paid meal that's been settled by a previous
        // payment opens a refund liability.
        const mealPrice = Number(prior.price || 0);
        const currentPaidAmount = Number(booking.paidAmount || 0);
        const looksPaid = mealPrice > 0 && currentPaidAmount >= mealPrice;
        if (looksPaid) {
          createBreakfastRefundLiability({
            transaction,
            booking,
            slotKey: op.slotKey,
            mealEntry: {
              mealId: prior.mealId,
              mealName: prior.mealName,
              price: mealPrice
            },
            amount: mealPrice,
            reason: "Staff removed paid breakfast meal via booking drawer.",
            recordedBy: staff.role,
            recordedByUid: staff.uid
          });
          refundLiabilityCreated += 1;
        }

        opsApplied += 1;
        auditEntriesWritten += 1;
        auditBreakfastOp({
          transaction,
          bookingId: booking.id,
          slotKey: op.slotKey,
          action: isOverride ? "override-remove" : "remove",
          mealSnapshot: {
            mealId: prior.mealId,
            mealName: prior.mealName,
            price: mealPrice
          },
          actorUid: staff.uid,
          actorRole: staff.role,
          // Per OCT-H7 (2026-10-20, decision #286): the object
          // form carries BOTH the free-text reason and the
          // cut-off flag. The previous two-way overload could
          // only carry one of them, so a staff override of a
          // locked date logged `occurredAfterCutoff: false` and
          // the "Late changes" metric never counted it.
          reasonOrCutoff: {
            reason,
            occurredAfterCutoff: isOverride
          }
        });
        if (isOverride) overrideCount += 1;
      };

      for (const op of add) applyAddOrChange(op, "add");
      for (const op of change) applyAddOrChange(op, "change");
      for (const op of remove) applyRemove(op);

      const newBreakfastTotal = recomputeBreakfastTotal(nextSelections as any);

      const totalPriceNum = Number(booking.totalPrice || 0);
      const paidAmountNum = Number(booking.paidAmount || 0);
      // Per OCT-H1 (2026-10-20, decision #282) the breakfast
      // inside `totalPrice` must be SUBTRACTED before the new
      // breakfast total is added — `totalPrice` already contains
      // the original breakfast (per BR-01 / BR-03), so the
      // pre-fix `totalPrice + newBreakfastTotal - paidAmount`
      // charged the guest for the breakfast TWICE. The anchor is
      // the booking's `rateBreakdown.addOns[]`, which still holds
      // the ORIGINAL breakfast amount.
      //
      // The helper is the SINGLE source of truth for that
      // arithmetic — the guest Manage path routes through the
      // same one, so the guest and the desk can never disagree
      // about the same booking.
      const breakfastInTotalPrice = sumBreakfastRateLines(
        (booking as any).rateBreakdown as any
      );
      const currentTotalPrice = computeBreakfastAdjustedTotalPrice({
        totalPrice: totalPriceNum,
        breakfastInTotalPrice,
        breakfastTotal: newBreakfastTotal
      });
      const newBalance = Math.max(0, currentTotalPrice - paidAmountNum);

      transaction.update(bookingRef, {
        breakfastSelections: nextSelections,
        breakfastTotal: newBreakfastTotal,
        updatedAt: Timestamp.now(),
        updatedBy: staff.uid
      });

      resultSummary.newBalance = Number(newBalance.toFixed(2));
      resultSummary.refundLiabilityCreated = refundLiabilityCreated;
      resultSummary.opsApplied = opsApplied;
      resultSummary.overrideCount = overrideCount;
      resultSummary.auditEntriesWritten = auditEntriesWritten;

      if (clientBatchId) {
        const batchDocRef = adminDb
          .collection("bookings")
          .doc("__breakfastStaffUpdateBatches")
          .collection("batches")
          .doc(clientBatchId);
        transaction.set(batchDocRef, {
          bookingId,
          clientBatchId,
          committedAt: Date.now(),
          summary: resultSummary
        });
      }
    });
  } catch (err: any) {
    const code = String((err && err.message) || "");
    if (code === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (code === "BOOKING_TERMINAL") {
      return res.status(400).json({
        success: false,
        error: "This booking is checked-out or cancelled; breakfast edits are not allowed."
      });
    }
    const translated = translateOpError(code);
    if (translated.status !== 500) {
      return res.status(translated.status).json({ success: false, error: translated.message });
    }
    // eslint-disable-next-line no-console
    console.error("[breakfast-staff-update] update failed:", err?.message || err);
    return res.status(500).json({ success: false, error: translated.message });
  }

  if (priorResult) {
    return res.status(200).json({
      success: true,
      data: { ...priorResult, replayed: true, clientBatchId: clientBatchId || null }
    });
  }

  return res.status(200).json({
    success: true,
    data: { ...resultSummary, replayed: false, clientBatchId: clientBatchId || null }
  });
}

// `frontDeskOverrideEnabled` read is exported for the
// admin UI to surface the toggle state without a second
// query (the request payload carries the flag from the
// `bookings/breakfast/config` payload the BR-03 endpoint
// already serves — exposed here for completeness /
// future single-flight fetches).
export async function readFrontDeskOverrideEnabled(): Promise<boolean> {
  return await loadFrontDeskOverrideEnabled();
}

// Re-exported to keep the BR-04 → BR-05 surface consistent
// (the admin UI imports the helpers from one place).
export const __test = {
  translateOpError,
  readStaff
};
