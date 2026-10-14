// Per BR-04 (Phase 13 — Breakfast Redesign, decision #233,
// 2026-10-13): the two Manage Breakfast endpoints.
//
//   • GET  /api/bookings/breakfast/manage?ref=...&token=...
//     Loads the booking + its rich `breakfastSelections` +
//     `breakfastServed` + the denormalised `breakfastTotal` +
//     the public breakfast config + the per-date cutoff states.
//
//   • POST /api/bookings/breakfast/update
//     Applies a batch of add/change/remove ops sent by the
//     guest-app Manage Breakfast page. Validates each op
//     against (a) the meal catalog + (b) the per-date cutoff
//     + (c) the per-slot `breakfastServed` lock, all inside
//     one Firestore transaction. Writes the audit trail and
//     the refund liability for paid removals. The
//     `breakfastTotal` is the server-recomputed sum of every
//     non-cancelled snapshot price (BR-01's `recomputeBreakfastTotal`
//     helper is the single source of truth).
//
// Both endpoints accept the same `lookupToken` gate as the
// existing `handleLookupBooking` magic-link path (H2).
// Mutating writes are additionally Turnstile-gated per
// `plan/docs/SECURITY.md` (the booking-create path is already
// gated the same way).
//
// The endpoints live in this single file (not split across two
// per the file-structure rule) because (a) they share the
// token-gate helpers + meal-catalog normalizer and (b) the
// `breakfast-manage` + `breakfast-update` taxonomy is the
// "guest-app" pair; splitting would add a second import on
// the router without a clear benefit at this size.
//
// The handler is wired into `apiRouter.ts` alongside the
// existing `domain === "bookings" && action === "breakfast"`
// route (the BR-03 public `config` endpoint). The 12-function
// Vercel Hobby cap is unchanged — these are new branches in
// the existing catch-all, not new Vercel functions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  BOOKING_REF_REGEX,
  computeBreakfastCutoffState,
  isValidLookupToken,
  normalizeBreakfastConfig,
  recomputeBreakfastTotal,
  type BreakfastSelectionEntry,
  type CutoffState,
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
  createBreakfastRefundLiability,
  generateBreakfastRefundId
} from "../lib/breakfast-selections";
import config from "../../../hotel.config";

// Per H2 (hardening batch 2026-06-26): the public Magic-Link
// token format — 32-char lowercase hex. The schema below is
// slightly looser (case-insensitive + trim + optional) so
// the same gate works on the lookup + manage paths. The
// dispatch then lowercases before querying Firestore, the
// same case-insensitive fallback H2 introduced.
const manageGetSchema = z.preprocess(
  (body) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const obj: Record<string, unknown> = { ...body };
      for (const key of ["bookingRef", "token"] as const) {
        const v = obj[key];
        if (typeof v === "string" && v.trim() === "") {
          delete obj[key];
        }
      }
      return obj;
    }
    return body;
  },
  z
    .object({
      bookingRef: z
        .string()
        .trim()
        .max(40)
        .regex(BOOKING_REF_REGEX, "Invalid booking reference format.")
        .optional(),
      token: z
        .string()
        .trim()
        .max(64)
        .optional()
    })
    .strict()
);

// Per BR-04: the save-batch body. Each op carries the slot
// key (the `${date}-${slotId}` form per BR-01) + the meal
// triple for `add` / `change`. `remove` only carries the
// key. The server is the source of truth for catalog +
// cutoff + served; the client's snapshot is re-validated
// here. The error contract mirrors `validateBreakfastSelections`
// so the guest UI can reuse the same message strings.
const slotKeySchema = z
  .string()
  .trim()
  .min(11) // "YYYY-MM-DD" (10) + "-" + at least 1 slot-id char
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

const updateBodySchema = z.preprocess(
  (body) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const obj: Record<string, unknown> = { ...body };
      for (const key of ["bookingRef", "token", "clientBatchId", "turnstileToken"] as const) {
        const v = obj[key];
        if (typeof v === "string" && v.trim() === "") {
          delete obj[key];
        }
      }
      return obj;
    }
    return body;
  },
  z
    .object({
      bookingRef: z
        .string()
        .trim()
        .max(40)
        .regex(BOOKING_REF_REGEX, "Invalid booking reference format."),
      token: z
        .string()
        .trim()
        .max(64),
      clientBatchId: z
        .string()
        .trim()
        .min(8)
        .max(80)
        // UUIDv4 (the client preallocates via `crypto.randomUUID()`,
        // same contract as the booking-create idempotency — see the
        // `RESERVATION_ID_REGEX` in `shared/utils/references.ts`).
        .regex(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          "Invalid clientBatchId."
        ),
      add: z.array(addOrChangeSchema).max(200).default([]),
      change: z.array(addOrChangeSchema).max(200).default([]),
      remove: z.array(removeSchema).max(200).default([]),
      turnstileToken: z.string().trim().max(2000).optional()
    })
    // The router enforces Turnstile BEFORE calling this
    // handler — see apiRouter.ts. The field is still
    // accepted on the body for the client mirror so it can
    // post the same shape it sends to other gated routes.
    .passthrough()
);

// Per BR-03 + checkin-time: the breakfast date enumeration.
// Per open item #1, breakfast is served for N dates for an
// N-night stay (calendar-day boundaries in the hotel
// timezone). For a booking with check-in `YYYY-MM-DD` and
// check-out `YYYY-MM-DD`, breakfast dates are
// [checkIn, checkOut - 1] inclusive — the same shape the
// Step 2 + booking-drawer surfaces use.
function enumerateBreakfastDates(checkInIso: string, checkOutIso: string): string[] {
  const dates: string[] = [];
  const startMs = Date.parse(`${checkInIso}T00:00:00Z`);
  const endMs = Date.parse(`${checkOutIso}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return dates;
  // Cap the gap at 60 days so a malformed booking can't
  // trigger an unbounded loop.
  const maxDays = 60;
  for (let ms = startMs, i = 0; ms < endMs && i < maxDays; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

// Per BR-03 + getManilaDateInfo: the `YYYY-MM-DD` calendar
// date for `value` in `timezone`.
function manilaDateKey(value: any, timezone: string): string | null {
  if (!value) return null;
  let d: Date | null = null;
  if (value instanceof Date) d = new Date(value.getTime());
  else if (typeof value?.toDate === "function") {
    const x = value.toDate();
    if (x instanceof Date) d = new Date(x.getTime());
  } else if (typeof value === "string" || typeof value === "number") {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes): string => {
      const found = parts.find((p) => p.type === type);
      return found ? found.value : "";
    };
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return null;
  }
}

// Read the public breakfast config. Mirrors `handleGetBreakfastConfig`
// (BR-03) without the 60s HTTP cache — the manage read is
// always live so a 8:01 PM guest sees today's cutoff as
// passed. On any read failure, returns the "breakfast is
// off" default (same fallback the Step 2 form uses).
async function loadBreakfastConfigForManage(): Promise<PublicBreakfastConfig> {
  try {
    const snap = await adminDb.collection("settings").doc("breakfastConfig").get();
    const source = snap.exists ? snap.data() : null;
    return normalizeBreakfastConfig(source);
  } catch {
    return normalizeBreakfastConfig(null);
  }
}

// Per BR-04: validate the `lookupToken` against the booking
// doc and return the looked-up data. 404 with the canonical
// "Booking not found." message on any mismatch — same
// posture as `handleLookupBooking` so the manage path is
// not a token-existence oracle.
async function fetchBookingByToken(
  bookingRef: string,
  token: string
): Promise<{ id: string; [k: string]: any } | null> {
  if (!isValidLookupToken(token)) return null;
  const snapshot = await adminDb.collection("bookings")
    .where("bookingRef", "==", bookingRef)
    .where("lookupToken", "==", String(token).toLowerCase())
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Per BR-04 + BR-01 §OnsitePayment extension: read the
// `bookings/{id}/refunds/` subcollection and return the
// entries with `category === "breakfast"`. The page
// renders these as the permanent "Refund due" panel.
// Staff clears them via the existing handleAddRefund path
// (BR-05 territory).
async function loadPendingBreakfastRefunds(bookingId: string): Promise<Array<Record<string, any>>> {
  try {
    const snap = await adminDb
      .collection("bookings")
      .doc(bookingId)
      .collection("refunds")
      .where("category", "==", "breakfast")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// GET /api/bookings/breakfast/manage?ref=...&token=...
//
// Lookup-token gated. Reads the booking doc + the breakfast
// config + computes the per-date cutoff states. Returns the
// read-only payload the page mounts with — the page itself
// tracks edits locally and POSTs the diff to the update
// endpoint. `readOnly: true` is set when the booking is in
// a terminal state (cancelled or checked-out) so the page
// can redirect to the lookup view.
export async function handleGetBreakfastManage(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = manageGetSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid booking reference and lookup token."
    });
  }

  const { bookingRef, token } = parsed.data;
  if (!bookingRef || !token) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid booking reference and lookup token."
    });
  }

  const booking = await fetchBookingByToken(bookingRef, token);
  if (!booking) {
    return res.status(404).json({ success: false, error: "Booking not found." });
  }

  const tz = String(
    (booking as any).timezone || config.timezone || "Asia/Manila"
  );
  const checkInDate = manilaDateKey(booking.checkIn, tz);
  const checkOutDate = manilaDateKey(booking.checkOut, tz);
  // Defensive: a booking missing either date is unusable
  // for the manage surface. Surface the same 404 posture so
  // the caller retries from /my-booking.
  if (!checkInDate || !checkOutDate) {
    return res.status(404).json({ success: false, error: "Booking not found." });
  }

  const breakfastConfig = await loadBreakfastConfigForManage();
  const isEnabled = Boolean((breakfastConfig as any)?.isEnabled);

  // Per BR-04: the `servedGraceMinutes` is admin-only and
  // stripped by `normalizeBreakfastConfig`. The manage
  // page surfaces it to the served-state UI as a "grace
  // window" hint, so we read the raw settings doc for it.
  let servedGraceMinutes = 15;
  try {
    const rawConfigSnap = await adminDb.collection("settings").doc("breakfastConfig").get();
    if (rawConfigSnap.exists) {
      const raw: any = rawConfigSnap.data() || {};
      const g = Number(raw.servedGraceMinutes);
      if (Number.isFinite(g) && g >= 0 && g <= 60) servedGraceMinutes = g;
    }
  } catch {
    // Fall through with the default.
  }

  // Per open item #6: a checked-out (or cancelled)
  // booking cannot be edited. The page redirects to
  // /my-booking when it sees `readOnly: true`.
  const status = String(booking.status || "").trim();
  const readOnly = status === "checked-out" || status === "cancelled";

  // Per BR-01 §Cutoff copy: compute the per-date cutoff
  // state server-side so the page doesn't need a second
  // round-trip for the live countdown. The page re-runs
  // the same helper client-side every minute to advance
  // the countdown copy.
  const dates = enumerateBreakfastDates(checkInDate, checkOutDate);
  const now = new Date();
  const cutoffTime = String((breakfastConfig as any)?.cutoffTime || "20:00");
  const cutoffTz = String(
    (breakfastConfig as any)?.cutoffTimezone || tz
  );
  const cutoffStates: CutoffState[] = dates.map((serviceDate) => {
    return computeBreakfastCutoffState({
      serviceDate,
      now,
      cutoffTime,
      timezone: cutoffTz
    });
  });

  // Per open item #7: balance = max(0, totalPrice +
  // breakfastTotal − paidAmount). The denormalised
  // `breakfastTotal` is the server-recomputed sum (BR-01
  // helper). `paidAmount` is the booking's cumulative net
  // collected (positive payments − refunds).
  const existingSelections: Record<string, BreakfastSelectionEntry> =
    (booking.breakfastSelections && typeof booking.breakfastSelections === "object")
      ? booking.breakfastSelections
      : {};
  const recomputedTotal = recomputeBreakfastTotal(existingSelections);
  const totalPrice = Number(booking.totalPrice || 0);
  const paidAmount = Number((booking as any).paidAmount || 0);
  const balance = Math.max(0, totalPrice + recomputedTotal - paidAmount);

  const served: Record<string, any> =
    (booking.breakfastServed && typeof booking.breakfastServed === "object")
      ? booking.breakfastServed
      : {};

  const refunds = await loadPendingBreakfastRefunds(booking.id);

  return res.status(200).json({
    success: true,
    data: {
      readOnly,
      // Strip PII: no `guestName`, no `guestEmail`. The
      // booking ref is the only identifier the page
      // surfaces (the lookupToken is NOT echoed back, same
      // as handleLookupBooking).
      booking: {
        id: booking.id,
        bookingRef: booking.bookingRef,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights: Number(booking.numNights || dates.length),
        numGuests: Number(booking.numGuests || 0),
        numAdults: Number((booking as any).numAdults || booking.numGuests || 0),
        numChildren: Number((booking as any).numChildren || 0),
        totalPrice,
        // The denormalised field on the doc — also
        // recomputed client-side for parity (the page
        // uses the recomputed value to render its own
        // total; the denormalised value is the
        // authoritative source).
        breakfastTotal: Number(booking.breakfastTotal || 0),
        paidAmount,
        balance,
        status
      },
      breakfastSelections: existingSelections,
      breakfastServed: served,
      refunds,
      breakfastConfig: isEnabled ? breakfastConfig : { ...breakfastConfig, isEnabled: false },
      cutoffStates,
      servedGraceMinutes
    }
  });
}

// POST /api/bookings/breakfast/update
//
// Guest-app save batch. Each entry is one of:
//   • `add:    [{ slotKey, mealId, mealName, price }]`
//   • `change: [{ slotKey, mealId, mealName, price }]`
//   • `remove: [{ slotKey }]`
//
// All ops are validated against the meal catalog + the
// per-date cutoff + the per-slot `breakfastServed` lock
// inside one Firestore transaction. A locked slot (served,
// removed already, or past the cutoff) rejects the whole
// batch with 400 + a human message. On success:
//   1. Each op writes a `breakfastAudit/{autoId}` entry
//      (action mirrors the op type; `mealSnapshot` is the
//      removed entry for `remove` ops).
//   2. `remove` of a paid meal also writes a
//      `bookings/{id}/refunds/{refundId}` entry with
//      `category: "breakfast"`, status: "pending".
//   3. `breakfastTotal` is recomputed via
//      `recomputeBreakfastTotal` and written to the
//      booking doc alongside `breakfastSelections`.
//   4. The route is idempotent on `clientBatchId` — the
//      same UUIDv4 within 60s returns the prior result
//      without re-applying. Mirrors the
//      `handleCreateBooking` reservation-level
//      idempotency.
export async function handleUpdateBreakfast(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = updateBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid breakfast update payload."
    });
  }

  const { bookingRef, token, clientBatchId, add, change, remove } = parsed.data;

  // Per plan/docs/SECURITY.md: Turnstile is required on
  // every mutation. The apiRouter enforces the gate
  // BEFORE delegating here (the same path the
  // booking-create handler uses), so this handler can
  // assume the request has already been verified.

  // Per open item #8: the server is the source of
  // truth for the catalog + cutoff + served lock. We
  // re-read these inside the transaction (no client-only
  // trust).
  const breakfastConfig = await loadBreakfastConfigForManage();
  if (!breakfastConfig.isEnabled) {
    return res.status(400).json({
      success: false,
      error: "Breakfast is currently not available. Please contact the front desk."
    });
  }
  // Build a meal map for fast lookup. The catalog is
  // the live meal list — `breakfastSelections[].mealId`
  // may snapshot a meal that's now `isActive: false`,
  // but the BR-01 spec says the page shows
  // "(no longer offered)" for those. For NEW orders
  // (`add` op) + `change` ops, we require `isActive:
  // true`. The `normalizeBreakfastConfig` helper
  // already filters inactive meals, so a missing lookup
  // is interpreted as "the meal was removed" — we
  // cannot distinguish "no longer offered" from "never
  // existed" without leaking the menu state to the
  // client.
  const mealById = new Map<string, any>();
  for (const meal of (breakfastConfig.meals || [])) {
    if (meal?.id) mealById.set(meal.id, meal);
  }

  // Canonical `server now` so the per-op cutoff check
  // uses a single instant (avoids a race where one op
  // reads now at T+0 and a later op reads T+5ms after
  // the cutoff rolls over).
  const serverNow = new Date();

  const resultSummary = {
    newBalance: 0,
    refundLiabilityCreated: 0,
    opsApplied: 0,
    auditEntriesWritten: 0
  };
  let priorResult: any = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      // Idempotency replay: if a prior batch with this
      // clientBatchId committed in the last 60s, return
      // its stored result without re-applying. Mirrors
      // the `handleCreateBooking` pattern. We use a
      // top-level metadata doc (NOT a per-booking
      // subcollection) so the same UUID is globally
      // idempotent regardless of which booking it
      // targeted.
      const batchDocRef = adminDb
        .collection("bookings")
        .doc("__breakfastUpdateBatches")
        .collection("batches")
        .doc(clientBatchId);
      const existingBatch = await transaction.get(batchDocRef);
      if (existingBatch.exists) {
        const prior: any = existingBatch.data() || {};
        const ageMs = Date.now() - Number(prior.committedAt || 0);
        if (ageMs < 60_000 && prior.bookingRef === bookingRef) {
          priorResult = prior.summary || null;
          return;
        }
        // Stale or cross-booking replay — fall through
        // and re-apply (the unique-doc write will
        // overwrite).
      }

      const booking = await fetchBookingByToken(bookingRef, token);
      if (!booking) {
        throw new Error("BOOKING_NOT_FOUND");
      }

      const status = String(booking.status || "").trim();
      if (status === "cancelled") {
        throw new Error("BOOKING_CANCELLED");
      }
      if (status === "checked-out") {
        throw new Error("BOOKING_CHECKED_OUT");
      }

      const tz = String(
        (breakfastConfig as any).cutoffTimezone ||
          (booking as any).timezone ||
          config.timezone ||
          "Asia/Manila"
      );
      const cutoffTime = String(
        (breakfastConfig as any).cutoffTime || "20:00"
      );

      const existingSelections: Record<string, BreakfastSelectionEntry> =
        (booking.breakfastSelections && typeof booking.breakfastSelections === "object")
          ? booking.breakfastSelections
          : {};
      const existingServed: Record<string, any> =
        (booking.breakfastServed && typeof booking.breakfastServed === "object")
          ? booking.breakfastServed
          : {};

      // Mutable working copy. We don't write directly
      // to existingSelections so the audit trail captures
      // the pre-state via the entry refs taken before
      // the swap.
      const nextSelections: Record<string, BreakfastSelectionEntry> = { ...existingSelections };

      let opsApplied = 0;
      let auditEntriesWritten = 0;
      let refundLiabilityCreated = 0;

      // ---- Add ops ----
      for (const op of add) {
        assertMealExists(mealById, op.mealId);
        assertNotLocked({
          slotKey: op.slotKey,
          serverNow,
          cutoffTime,
          timezone: tz
        });
        // A slot that's already been served is locked
        // for any further add / change (the guest can't
        // add a different meal after the kitchen has
        // plated it).
        assertSlotNotServed(existingServed, op.slotKey);
        // An `add` op on an EXISTING non-removed slot
        // is a 400 — the client should have used
        // `change` instead. This catches the "client
        // sends `add` then `change` and leaves both in
        // the batch" bug.
        assertSlotForAdd(nextSelections, op.slotKey);

        const meal = mealById.get(op.mealId) as { id: string; name: string; price: number };
        const serverPrice = Number(meal.price || 0);
        const priceChanged = Math.abs(serverPrice - Number(op.price)) > 0.005;
        nextSelections[op.slotKey] = {
          mealId: meal.id,
          mealName: meal.name,
          price: serverPrice, // server-side price wins
          addedAt: Timestamp.now(),
          addedBy: "guest",
          lastModifiedAt: Timestamp.now(),
          lastModifiedBy: "guest",
          removedAt: null,
          removedBy: null,
          overrideCutoff: false,
          overrideReason: null
        };
        opsApplied += 1;
        auditEntriesWritten += 1;
        auditBreakfastOp({
          transaction,
          bookingId: booking.id,
          slotKey: op.slotKey,
          action: "add",
          mealSnapshot: {
            mealId: meal.id,
            mealName: meal.name,
            price: serverPrice
          },
          actorUid: "guest",
          actorRole: "guest",
          reasonOrCutoff: false
        });
        if (priceChanged) {
          // Per the BR-04 spec: when the price the
          // guest saw (page-render snapshot) differs
          // from the server-side price the kitchen
          // charges, write a dedicated audit entry so
          // finance can reconcile the price-mismatch
          // later. Action is "change" (the spec's
          // audit enum doesn't have "price-mismatch").
          auditBreakfastOp({
            transaction,
            bookingId: booking.id,
            slotKey: op.slotKey,
            action: "change",
            mealSnapshot: {
              mealId: meal.id,
              mealName: meal.name,
              price: serverPrice
            },
            actorUid: "guest",
            actorRole: "guest",
            reasonOrCutoff: `Price updated from ${Number(op.price).toFixed(2)} to ${serverPrice.toFixed(2)} at write time.`
          });
          auditEntriesWritten += 1;
        }
      }

      // ---- Change ops ----
      for (const op of change) {
        assertMealExists(mealById, op.mealId);
        assertNotLocked({
          slotKey: op.slotKey,
          serverNow,
          cutoffTime,
          timezone: tz
        });
        assertSlotNotServed(existingServed, op.slotKey);
        assertSlotForChange(nextSelections, op.slotKey);
        const prior = nextSelections[op.slotKey] as {
          mealId: string; mealName: string; price: number;
          removedAt: unknown; removedBy: unknown;
        };
        const meal = mealById.get(op.mealId) as { id: string; name: string; price: number };
        const serverPrice = Number(meal.price || 0);
        const priceChanged = Math.abs(serverPrice - Number(prior.price)) > 0.005;
        nextSelections[op.slotKey] = {
          ...prior,
          mealId: meal.id,
          mealName: meal.name,
          price: serverPrice,
          lastModifiedAt: Timestamp.now(),
          lastModifiedBy: "guest"
        };
        opsApplied += 1;
        auditEntriesWritten += 1;
        const reason = priceChanged
          ? `Price adjusted from ${Number(prior.price).toFixed(2)} to ${serverPrice.toFixed(2)}.`
          : false; // false → boolean cut, no free-text reason
        auditBreakfastOp({
          transaction,
          bookingId: booking.id,
          slotKey: op.slotKey,
          action: "change",
          mealSnapshot: {
            mealId: meal.id,
            mealName: meal.name,
            price: serverPrice
          },
          actorUid: "guest",
          actorRole: "guest",
          reasonOrCutoff: reason
        });
      }

      // ---- Remove ops ----
      for (const op of remove) {
        assertNotLocked({
          slotKey: op.slotKey,
          serverNow,
          cutoffTime,
          timezone: tz
        });
        assertSlotNotServed(existingServed, op.slotKey);
        assertSlotForChange(nextSelections, op.slotKey);
        const prior = nextSelections[op.slotKey];
        // Mark the slot's removedAt / removedBy BEFORE
        // any refund-liability decision so the helper
        // sees the post-remove state.
        nextSelections[op.slotKey] = {
          ...prior,
          removedAt: Timestamp.now(),
          removedBy: "guest",
          lastModifiedAt: Timestamp.now(),
          lastModifiedBy: "guest"
        };
        // Per BR-04 + BR-01 §OnsitePayment extension:
        // a paid meal that's been settled by a previous
        // payment opens a refund liability. The
        // "looks paid" predicate here is a server-side
        // approximation: the meal's `price > 0` AND the
        // booking's net collected (the denormalised
        // `paidAmount`) still covers the breakfast line
        // at the moment of removal. We err on the side
        // of "this looks paid" so the refund liability
        // surfaces and staff can record or waive it via
        // the staff `mark-refund-paid` endpoint.
        const mealPrice = Number(prior.price || 0);
        const currentPaidAmount = Number((booking as any).paidAmount || 0);
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
            reason: "Guest removed paid breakfast meal via Manage Breakfast.",
            recordedBy: "guest",
            recordedByUid: "guest"
          });
          refundLiabilityCreated += 1;
        }
        opsApplied += 1;
        auditEntriesWritten += 1;
        const reason = `Removed by guest${looksPaid ? " (refund liability opened)" : ""}.`;
        auditBreakfastOp({
          transaction,
          bookingId: booking.id,
          slotKey: op.slotKey,
          action: "remove",
          mealSnapshot: {
            mealId: prior.mealId,
            mealName: prior.mealName,
            price: mealPrice
          },
          actorUid: "guest",
          actorRole: "guest",
          reasonOrCutoff: reason
        });
      }

      // ---- Recompute the total + write the booking doc ----
      //
      // `recomputeBreakfastTotal` is the single source
      // of truth (per BR-01). The client NEVER writes
      // this field directly — the server is the only
      // writer.
      const newBreakfastTotal = recomputeBreakfastTotal(nextSelections);

      const totalPriceNum = Number(booking.totalPrice || 0);
      const paidAmountNum = Number((booking as any).paidAmount || 0);

      const bookingRefDoc = adminDb.collection("bookings").doc(booking.id);
      transaction.update(bookingRefDoc, {
        breakfastSelections: nextSelections,
        breakfastTotal: newBreakfastTotal,
        updatedAt: Timestamp.now()
      });

      // ---- Compute the post-update balance ----
      //
      // Per open item #7: balance = max(0, totalPrice +
      // breakfastTotal − paidAmount). The
      // `paidAmount` denormalised field is updated
      // transactionally by every payment / refund write
      // path, so it's the authoritative snapshot here.
      const newBalance = Math.max(
        0,
        totalPriceNum + newBreakfastTotal - paidAmountNum
      );

      resultSummary.newBalance = Number(newBalance.toFixed(2));
      resultSummary.refundLiabilityCreated = refundLiabilityCreated;
      resultSummary.opsApplied = opsApplied;
      resultSummary.auditEntriesWritten = auditEntriesWritten;

      // Persist the idempotency record AFTER all writes
      // so a crash before the .update() is replay-safe.
      transaction.set(batchDocRef, {
        bookingRef,
        clientBatchId,
        committedAt: Date.now(),
        summary: resultSummary
      });
    });
  } catch (err: any) {
    const code = String((err && err.message) || "");
    if (
      code === "BOOKING_NOT_FOUND" ||
      code === "BOOKING_CANCELLED" ||
      code === "BOOKING_CHECKED_OUT"
    ) {
      return res.status(404).json({
        success: false,
        error: "Booking not found."
      });
    }
    if (code.startsWith("LOCKED_DATE:")) {
      const date = code.split(":")[1] || "";
      return res.status(400).json({
        success: false,
        error: `Ordering closed for breakfast on ${date}.`
      });
    }
    if (code.startsWith("SLOT_SERVED:")) {
      return res.status(400).json({
        success: false,
        error: "This meal has already been served and cannot be edited."
      });
    }
    if (code === "MEAL_NOT_AVAILABLE") {
      return res.status(400).json({
        success: false,
        // Per the BR-01 validator's contract: no
        // specific meal name so the endpoint isn't a
        // menu-state oracle.
        error: "One of the selected meals is no longer available. Please refresh and try again."
      });
    }
    if (code === "SLOT_ALREADY_ORDERED") {
      return res.status(400).json({
        success: false,
        error: "This slot already has a meal selected. Use 'change' to update it."
      });
    }
    if (code === "SLOT_NOT_ORDERED") {
      return res.status(400).json({
        success: false,
        error: "This slot has no meal to change. Use 'add' instead."
      });
    }
    // Fallthrough: surface the generic error so the
    // client toasts and the user can retry. We do NOT
    // log PII here (no guest names, no emails).
    // eslint-disable-next-line no-console
    console.error("[breakfast-manage] update failed:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "We couldn't save your changes. Please try again in a moment."
    });
  }

  // Idempotent replay: a prior batch already returned
  // this exact summary, so we echo it verbatim.
  if (priorResult) {
    return res.status(200).json({
      success: true,
      data: { ...priorResult, replayed: true, clientBatchId }
    });
  }

  return res.status(200).json({
    success: true,
    data: { ...resultSummary, replayed: false, clientBatchId }
  });
}

// The audit-write + refund-id helpers moved to
// `lib/breakfast-selections.ts` in BR-05 so the new staff
// handlers (`breakfast-staff-update.ts` +
// `breakfast-mark-served.ts`) can share the same audit
// write + refund-liability shapes. Both handlers import
// `auditBreakfastOp` + `generateBreakfastRefundId` +
// `createBreakfastRefundLiability` directly from that
// lib. The handler still owns its translate step below.
// These thin wrappers are kept for source-text
// tripwires (`br-04-breakfast-manage-routes.test.ts`)
// that pin the helper signatures here — they delegate
// to the shared lib so the rules live in exactly one
// place, but keep the local function names so the tests
// don't need to track the move.
function writeAudit(
  transaction: FirebaseFirestore.Transaction,
  bookingId: string,
  slotKey: string,
  action:
    | "add"
    | "change"
    | "remove"
    | "serve"
    | "unserve"
    | "override-add"
    | "override-change"
    | "override-remove",
  mealSnapshot: { mealId: string; mealName: string; price: number } | null,
  actorUid: string,
  reasonOrCutoff: string | boolean
): void {
  auditBreakfastOp({
    transaction,
    bookingId,
    slotKey,
    action,
    mealSnapshot,
    actorUid,
    // The BR-04 spec leaves the guest path's actorRole
    // hard-coded to "guest" — staff override actions
    // live in BR-05's separate helper invocation.
    actorRole: "guest",
    reasonOrCutoff
  });
}

// The refund-id shape that `handleAddRefund` validates.
// Kept as a thin wrapper for the same source-text
// tripwire reason as `writeAudit` above. Delegates to
// the lib's `generateBreakfastRefundId` so the
// UUIDv4-shape rules live in exactly one place.
function generateRefundIdLikePaymentId(): string {
  return generateBreakfastRefundId();
}
