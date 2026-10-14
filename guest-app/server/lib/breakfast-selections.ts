// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the server-side gate for the new
// `breakfastSelections` rich shape. Validates each entry
// the guest submitted against the live `breakfastConfig`
// (meals + cutoff) and returns the denormalized
// `breakfastTotal` + `hasAnyBreakfast` flag the create
// write needs.
//
// The legacy `hasBreakfast` + `breakfastRate` flat-rate
// model is preserved for back-compat (older clients + the
// walkin modal per the BR-03 plan). When the new shape is
// provided, the create handler switches to the
// selections-driven path; the legacy fields are not
// written to the booking doc.
//
// The helper is intentionally split out of
// `handleCreateBooking` (and `handleCreateWalkin` when BR-04
// / BR-05 land) so the validation rules are written
// exactly once. The tests in
// `tests/api/br-03-breakfast-selections-snapshotting.test.ts`
// pin the shape + the rejection messages.

import { z } from "zod";
import {
  computeBreakfastCutoffState,
  recomputeBreakfastTotal,
  buildBreakfastRateBreakdownLines,
  type BreakfastConfig,
  type BreakfastMeal,
  type BreakfastSelectionEntry
} from "@spark-inn/shared";

// Per BR-01 (2026-10-12, decision #231): the entry shape
// on the wire + on the booking doc. `key` is the
// `yyyy-mm-dd-guestSlot` composite; the server doesn't
// need to know the slot shape (it's the client's job to
// pick a unique key), but the wire format carries it for
// the per-guest × per-date rendering on the email view +
// receipt PDF.
//
// The schema is intentionally permissive on the optional
// audit fields (`addedBy`, `addedAt`, `lastModifiedAt`,
// `overrideCutoff`, `overrideReason`, etc.) — the
// server's gate is "is this entry well-formed enough to
// be a valid breakfast line", not "is every metadata
// field populated". The `mealId` + `mealName` + `price`
// triple is the minimum snapshot; the rest is either
// client-supplied metadata or pre-stamped audit data the
// server overwrites.
const entryShape = z.object({
  mealId: z.string().trim().min(1).max(120),
  mealName: z.string().trim().min(1).max(200),
  price: z.number().finite().min(0),
  addedBy: z.string().trim().max(120).optional().default(""),
  addedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedAt: z.string().trim().max(64).optional().default(""),
  lastModifiedBy: z.string().trim().max(120).optional().default(""),
  removedAt: z.string().trim().max(64).nullable().optional().default(null),
  removedBy: z.string().trim().max(120).nullable().optional().default(null),
  overrideCutoff: z.boolean().optional().default(false),
  overrideReason: z.string().trim().max(500).nullable().optional().default(null)
});

export const breakfastSelectionsSchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}-[\s\S]{1,80}$/), entryShape);

export type ValidatedBreakfastSelections = {
  entries: Record<string, BreakfastSelectionEntry>;
  total: number;
  hasAny: boolean;
};

export class BreakfastSelectionValidationError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "BreakfastSelectionValidationError";
    this.status = status;
  }
}

// Lookup table for `mealId` → meal. Built once per request
// from the live `breakfastConfig.meals` so the validation
// step is O(1) per entry. Defensive: the helper tolerates
// missing / partial config (treats as "no meals available"
// → every entry is rejected) so a misconfigured settings
// doc never crashes the create handler.
function buildMealLookup(meals: unknown): Map<string, BreakfastMeal> {
  const lookup = new Map<string, BreakfastMeal>();
  if (!Array.isArray(meals)) return lookup;
  for (const meal of meals) {
    if (!meal || typeof meal !== "object") continue;
    const id = typeof (meal as any).id === "string" ? (meal as any).id : "";
    if (!id) continue;
    lookup.set(id, meal as BreakfastMeal);
  }
  return lookup;
}

export interface ValidateBreakfastSelectionsInput {
  selections: unknown;
  breakfastConfig: BreakfastConfig;
  now: Date;
}

// `validateBreakfastSelections` is the single read-side
// gate. When the guest sends the new shape, this function
// either:
//   - returns the validated entries + the denormalized
//     `breakfastTotal` + `hasAnyBreakfast` flag, OR
//   - throws `BreakfastSelectionValidationError` (status
//     400) with a human message the create handler
//     surfaces in the response body.
//
// Returns `null` when `selections` is `null` / `undefined`
// (the legacy caller's path — handler continues with the
// flat-rate model). An empty object `{}` is treated as
// "guest explicitly opted out of breakfast"; the handler
// writes an empty `breakfastSelections` field and
// `breakfastTotal: 0`.
export function validateBreakfastSelections(
  input: ValidateBreakfastSelectionsInput
): ValidatedBreakfastSelections | null {
  const { selections, breakfastConfig, now } = input;
  if (selections === null || selections === undefined) return null;

  // Zod parse — the strict schema is the single source of
  // truth for "well-formed". A malformed wire request
  // throws BEFORE we touch the meal catalog.
  const parsed = breakfastSelectionsSchema.safeParse(selections);
  if (!parsed.success) {
    throw new BreakfastSelectionValidationError(
      "Invalid breakfast selection. Please refresh and try again."
    );
  }

  const entries = parsed.data;
  const mealLookup = buildMealLookup(breakfastConfig.meals);
  const validatedEntries: Record<string, BreakfastSelectionEntry> = {};

  for (const [key, entry] of Object.entries(entries)) {
    // Per BR-01 (2026-10-12, decision #231): the
    // `serviceDate` is the `yyyy-mm-dd` PREFIX of the
    // composite key (`${date}-${slotId}`). The schema's
    // `z.string().regex(/^\d{4}-\d{2}-\d{2}-.../)`
    // already enforced the prefix shape, so this
    // extraction is safe. A key without a valid
    // date prefix is rejected with a human message
    // (the schema would have rejected it at parse
    // time anyway, but a belt-and-suspenders check
    // here is cheap).
    const match = /^(\d{4}-\d{2}-\d{2})-/.exec(key);
    if (!match) {
      throw new BreakfastSelectionValidationError(
        "Invalid breakfast selection. Please refresh and try again."
      );
    }
    const serviceDate = match[1];

    // Per open item #7 (BR-01 / spec): the server
    // recomputes the `serviceDate` cutoff. A guest
    // who back-dated their clock to slip past the
    // cutoff still gets rejected.
    //
    // Per BR-10 (2026-10-14, decision #244 reserved —
    // Phase 14): when `breakfastConfig.cutoffsEnabled`
    // is `false`, the helper short-circuits to
    // `isLocked: false` regardless of `now` vs.
    // `cutoffAt`. The flag is required on the
    // `BreakfastConfig` shape — `normalizeBreakfastConfig`
    // defaults it to `true` for legacy docs.
    const cutoffState = computeBreakfastCutoffState({
      serviceDate,
      now,
      cutoffTime: breakfastConfig.cutoffTime,
      timezone: breakfastConfig.cutoffTimezone,
      cutoffsEnabled: breakfastConfig.cutoffsEnabled
    });
    if (cutoffState.isLocked) {
      throw new BreakfastSelectionValidationError(
        `Ordering closed for breakfast on ${serviceDate}. Please remove the selection or contact the hotel.`
      );
    }

    // Per open item #6 (BR-01 / spec): the mealId must
    // exist in the live catalog. A guest who screenshot
    // an old catalog (a meal the admin removed) is
    // rejected with a human message naming the missing
    // meal — the message intentionally does NOT name the
    // meal to avoid leaking the menu state to a probing
    // client, but a 400 with a clear "meal not available"
    // label is enough for the form to surface the error
    // and the user to pick a different meal.
    if (!mealLookup.has(entry.mealId)) {
      throw new BreakfastSelectionValidationError(
        `One of the selected meals is no longer available. Please refresh and try again.`
      );
    }

    // Defensive price floor: the helper rejects a negative
    // price (the Zod schema already enforces `min(0)`, this
    // is a belt-and-suspenders check for a future schema
    // relaxation). The recompute helper also enforces the
    // same rule, so the persisted `breakfastTotal` matches
    // the validated sum by construction.
    const price = Number(entry.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new BreakfastSelectionValidationError(
        `Invalid breakfast price. Please refresh and try again.`
      );
    }

    validatedEntries[key] = {
      mealId: entry.mealId,
      mealName: entry.mealName,
      price,
      addedBy: entry.addedBy || "guest",
      addedAt: entry.addedAt || new Date().toISOString(),
      lastModifiedAt: entry.lastModifiedAt || new Date().toISOString(),
      lastModifiedBy: entry.lastModifiedBy || "guest",
      removedAt: entry.removedAt ?? null,
      removedBy: entry.removedBy ?? null,
      overrideCutoff: entry.overrideCutoff === true,
      overrideReason: entry.overrideReason ?? null
    };
  }

  const total = recomputeBreakfastTotal(validatedEntries);
  const hasAny = Object.keys(validatedEntries).length > 0;
  return { entries: validatedEntries, total, hasAny };
}

// `buildBreakfastRateBreakdownLines` is re-exported from
// `@spark-inn/shared` (the canonical location per the
// BR-03 plan). The server re-uses the shared helper so
// the per-date lines are byte-equivalent to the
// client-side rendering (same labels, same rounding).
export { buildBreakfastRateBreakdownLines } from "@spark-inn/shared";
export type { BreakfastRateLine } from "@spark-inn/shared";

// ============================================================================
// Per-op validation helpers (BR-04 + BR-05)
//
// The guest Manage Breakfast handler (`breakfast-manage.ts`)
// and the staff booking-drawer handler (`breakfast-staff-update.ts`,
// BR-05) both apply the same per-op rules — meal exists in
// the live catalog, per-date cutoff not passed, per-slot
// `breakfastServed` lock not flipped, per-slot prior entry
// shape matches the op kind — only the actor + override
// behaviour differ.
//
// To keep the rules in one place, this section exposes
// the assertion helpers + the audit-write helper +
// the refund-liability-write helper. Both handlers throw
// and translate the same error codes so the response body
// stays in one shape (the staff handler additionally
// catches `LOCKED_DATE` to allow the `overrideCutoff` path).
// ============================================================================

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

// String error codes thrown by the assertion helpers below.
// The translate step (guest AND staff handlers) maps these
// to the 4xx response shape. Using string-thrown errors
// keeps the helpers free of HTTP concerns.
export const BREAKFAST_OP_ERROR = {
  MEAL_NOT_AVAILABLE: "MEAL_NOT_AVAILABLE",
  LOCKED_DATE_PREFIX: "LOCKED_DATE:",
  SLOT_SERVED_PREFIX: "SLOT_SERVED:",
  SLOT_ALREADY_ORDERED: "SLOT_ALREADY_ORDERED",
  SLOT_NOT_ORDERED: "SLOT_NOT_ORDERED"
} as const;

// `auditBreakfastOp` writes one `breakfastAudit/{autoId}`
// doc inside the caller's transaction. Mirrors the schema in
// `shared/types/index.ts §BreakfastAuditEntry`. The
// `reasonOrCutoff` argument is overloaded to accept either
// a boolean (the cutoff-overrun flag — `true` means
// `occurredAfterCutoff` is set) or a string (a free-text
// reason — `occurredAfterCutoff` stays `false`).
//
// The action enum covers both the guest Manage Breakfast
// surface (BR-04) and the staff booking-drawer surface
// (BR-05). The override-prefixed variants are reserved
// for staff actions past the cutoff window.
export type BreakfastAuditAction =
  | "add"
  | "change"
  | "remove"
  | "serve"
  | "unserve"
  | "override-add"
  | "override-change"
  | "override-remove";

export interface AuditBreakfastOpInput {
  transaction: FirebaseFirestore.Transaction;
  bookingId: string;
  slotKey: string;
  action: BreakfastAuditAction;
  mealSnapshot: { mealId: string; mealName: string; price: number } | null;
  actorUid: string;
  // The `actorRole` mirrors the `BreakfastAuditEntry` enum
  // in `shared/types/index.ts` — `"guest"` for the BR-04
  // save path, `"front-desk"` or `"admin"` for the BR-05
  // staff paths. The schema discriminator lets the
  // kitchen list filter on role later.
  actorRole: "guest" | "front-desk" | "admin";
  reasonOrCutoff?: string | boolean;
}

export function auditBreakfastOp(input: AuditBreakfastOpInput): void {
  const {
    transaction,
    bookingId,
    slotKey,
    action,
    mealSnapshot,
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
  }

  const auditRef = adminDb
    .collection("bookings")
    .doc(bookingId)
    .collection("breakfastAudit")
    .doc();

  transaction.set(auditRef, {
    action,
    slotKey,
    mealSnapshot,
    actorUid,
    actorRole,
    reason,
    occurredAt: Timestamp.now(),
    occurredAfterCutoff
  });
}

// `assertMealExists` ensures `op.mealId` is in the
// server-side catalog. Throws `MEAL_NOT_AVAILABLE`.
// Per BR-01 (decision #231): the message intentionally does
// NOT name the meal so the endpoint isn't a menu-state
// oracle for an unauthenticated prober.
export function assertMealExists(
  mealById: Map<string, BreakfastMeal>,
  mealId: string
): void {
  if (!mealById.has(mealId)) {
    throw new Error(BREAKFAST_OP_ERROR.MEAL_NOT_AVAILABLE);
  }
}

// `assertNotLocked` throws `LOCKED_DATE:{serviceDate}` when
// the slot's date has already crossed the cutoff. The
// staff handler catches this to allow the
// `overrideCutoff + overrideReason` path; the guest handler
// surfaces 400 directly. The helper accepts the `now: Date`
// + `cutoffTime` + `timezone` triple so the same source
// values flow through both handlers.
//
// Per BR-10 (2026-10-14, decision #244 reserved —
// Phase 14): the `cutoffsEnabled` flag is threaded through
// so callers can honor the admin-side "Cut-offs enabled"
// toggle. `true` (or omitted, defaulting in the helper to
// `true`) keeps the pre-BR-10 locked behaviour.
export function assertNotLocked(input: {
  slotKey: string;
  serverNow: Date;
  cutoffTime: string;
  timezone: string;
  cutoffsEnabled?: boolean;
}): void {
  const { slotKey, serverNow, cutoffTime, timezone, cutoffsEnabled } = input;
  const serviceDate = slotKey.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    // A malformed slotKey is the caller's fault; surface as
    // a locked error so the same translate path picks it up.
    throw new Error(`${BREAKFAST_OP_ERROR.LOCKED_DATE_PREFIX}${slotKey}`);
  }
  const cutoff = computeBreakfastCutoffState({
    serviceDate,
    now: serverNow,
    cutoffTime,
    timezone,
    cutoffsEnabled
  });
  if (cutoff.isLocked) {
    throw new Error(`${BREAKFAST_OP_ERROR.LOCKED_DATE_PREFIX}${serviceDate}`);
  }
}

// `assertSlotNotServed` throws `SLOT_SERVED:{slotKey}` when
// the kitchen has already plated the meal for the slot.
// Adding / changing / removing a served slot is forbidden
// for both guests and staff (the override path also can't
// un-serve past the grace window without a reason — that's
// `breakfast-mark-served.ts` territory).
export function assertSlotNotServed(
  existingServed: Record<string, unknown> | null | undefined,
  slotKey: string
): void {
  if (existingServed && existingServed[slotKey]) {
    throw new Error(`${BREAKFAST_OP_ERROR.SLOT_SERVED_PREFIX}${slotKey}`);
  }
}

// `assertSlotForAdd` throws `SLOT_ALREADY_ORDERED` when the
// slot already has a non-removed entry. An `add` op on an
// existing slot should be a `change` op instead. Catches the
// "client sends `add` then `change`" multi-op bug.
export function assertSlotForAdd(
  nextSelections: Record<string, { removedAt: unknown } | null | undefined>,
  slotKey: string
): void {
  const prior = nextSelections[slotKey];
  if (prior && prior.removedAt === null) {
    throw new Error(BREAKFAST_OP_ERROR.SLOT_ALREADY_ORDERED);
  }
}

// `assertSlotForChange` throws `SLOT_NOT_ORDERED` when the
// slot has no live entry to change. The client should have
// used `add` instead. Reused for `remove` — a remove
// requires an existing live entry too.
export function assertSlotForChange(
  nextSelections: Record<string, { removedAt: unknown } | null | undefined>,
  slotKey: string
): void {
  const prior = nextSelections[slotKey];
  if (!prior || prior.removedAt !== null) {
    throw new Error(BREAKFAST_OP_ERROR.SLOT_NOT_ORDERED);
  }
}

// The refund-id shape that `handleAddRefund` validates.
// The existing `PREALLOCATED_PAYMENT_ID_REGEX` in
// `bookings.ts` accepts the UUIDv4 form
// (`{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}`) — same shape
// as the booking-create idempotency. We don't import the
// regex from `bookings.ts` (no shared export); the
// hand-rolled UUIDv4 covers it. Used by both the guest
// (BR-04) and the staff (BR-05) refund-liability paths so
// the same id-generation policy applies.
export function generateBreakfastRefundId(): string {
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
  // Deterministic-but-unique-enough fallback (32 hex
  // chars in the UUIDv4 shape). Server runtime tests
  // mock `crypto.randomUUID` anyway.
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

// `createBreakfastRefundLiability` writes a
// `bookings/{id}/refunds/{refundId}` doc with the
// BR-01 `category: "breakfast"` shape. Used by both the
// guest Manage Breakfast save path (BR-04) and the staff
// `staff-update` path (BR-05) when an `remove` op crosses
// a paid meal. Caller's `transaction` owns the write so the
// refund entry commits atomically with the booking
// mutation.
export interface CreateBreakfastRefundLiabilityInput {
  transaction: FirebaseFirestore.Transaction;
  booking: { id: string; bookingRef: string };
  slotKey: string;
  mealEntry: { mealId: string; mealName: string; price: number };
  amount: number;
  reason: string;
  // `recordedBy` mirrors the BR-01 refund entry —
  // `"guest"` for the BR-04 path,
  // `"front-desk"` / `"admin"` for the BR-05 path.
  // `recordedByUid` is the staff UID for staff
  // entries; for guests it's the literal `"guest"`.
  recordedBy: "guest" | "front-desk" | "admin";
  recordedByUid: string;
}

export function createBreakfastRefundLiability(
  input: CreateBreakfastRefundLiabilityInput
): void {
  const {
    transaction,
    booking,
    slotKey,
    mealEntry,
    amount,
    reason,
    recordedBy,
    recordedByUid
  } = input;

  const refundId = generateBreakfastRefundId();
  const refundLiabilityRef = adminDb
    .collection("bookings")
    .doc(booking.id)
    .collection("refunds")
    .doc(refundId);

  const refundRecord: Record<string, any> = {
    id: refundId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    type: "refund",
    category: "breakfast",
    status: "pending",
    // Refunds are negative-amount entries on the wire
    // (per CRL-01's contract — `handleAddRefund` and the
    // folio math both rely on the sign).
    amount: -Math.abs(Number(amount || 0)),
    method: "pending",
    note: "Pending — staff processes the payout.",
    transactionReference: null,
    reason,
    approvedBy: null,
    recordedBy,
    recordedByUid,
    recordedAt: Timestamp.now(),
    // Per BR-01 §OnsitePayment extension: the
    // `breakfastRefundContext` is the immutable
    // snapshot the staff uses to reconcile the
    // meal that was removed.
    breakfastRefundContext: {
      mealId: mealEntry.mealId,
      slotKey,
      mealName: mealEntry.mealName,
      priceSnapshot: Math.abs(Number(amount || 0))
    }
  };

  transaction.set(refundLiabilityRef, refundRecord);
}
