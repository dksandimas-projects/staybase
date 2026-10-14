import { z } from "zod";
import { RESERVATION_ID_REGEX } from "../utils/references";
import { HOLD_ID_REGEX } from "../utils/bookingInFlowHold";

export const BookingDatesSchema = z
  .object({
    checkIn: z.string().min(1, "Choose a check-in date"),
    checkOut: z.string().min(1, "Choose a check-out date"),
    numGuests: z.coerce.number().int().min(1, "At least one guest is required"),
    roomId: z.string().min(1, "Choose a room")
  })
  .refine((value) => new Date(value.checkOut) > new Date(value.checkIn), {
    message: "Check-out date must be after check-in",
    path: ["checkOut"]
  });

export const GuestDetailsSchema = z.object({
  guestName: z.string().min(2, "Enter the guest name"),
  guestEmail: z.string().email("Enter a valid email address"),
  guestPhone: z.string().min(7, "Enter a valid phone number"),
  companyName: z.string().optional(),
  specialRequests: z.string().optional(),
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: "Privacy consent is required" })
  })
});

export const PaymentReviewSchema = z.object({
  discountType: z.enum(["", "senior", "pwd"]).default(""),
  voucherCode: z.string().optional(),
  paymentMethod: z.string().min(1, "Choose a payment method"),
  turnstileToken: z.string().optional(),
  _hp: z.string().optional()
});

export const WalkinGuestDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().min(2).max(32),
  requests: z.string().trim().max(1000).optional().default(""),
  consent: z.boolean().optional()
}).strict();

// Per MRB-07 (2026-08-02, per decision #159): one room stay inside a
// staff-created multi-room reservation. The desk picks each physical
// room explicitly (unlike the public `/book` flow, which sends a
// `roomType` + `roomCount` and lets the server auto-assign), because a
// walk-in group is normally allocated at the counter. Each line carries
// its own occupancy so the reservation's guests are distributed across
// rooms rather than duplicated onto every room. The rooms in one
// reservation may be of different types — the server prices each line
// Per MRB-11 (2026-08-03, per decision #177): the
// stored per-stream revenue allocation. Every booking
// created after MRB-11 lands carries a snapshot of this
// shape on the doc, computed by the server's
// `computeBookingRevenueAllocation` helper before the
// write. The schema is `.optional()` because the input
// is optional — **per the 2026-08-03 design call, the
// server always computes the allocation before the
// write**; the input field exists for the rare
// pre-computed case (e.g. a future client preview that
// wants to show the breakdown before submitting). The
// `totalNet === booking.totalPrice` invariant is the
// contract — the schema accepts any 2dp-rounded
// non-negative numbers, the server asserts the
// invariant at the write boundary. `deductionNet` may
// be 0 (no discounts applied).
export const BookingRevenueAllocationSchema = z
  .object({
    roomNet: z.coerce.number().finite().min(0),
    breakfastNet: z.coerce.number().finite().min(0),
    addOnNet: z.coerce.number().finite().min(0),
    deductionNet: z.coerce.number().finite().min(0),
    totalNet: z.coerce.number().finite().min(0)
  })
  .strict();

export type BookingRevenueAllocationInput = z.infer<typeof BookingRevenueAllocationSchema>;

// against its own type entry and stores the per-room allocation.
export const WalkinRoomLineSchema = z.object({
  roomId: z.string().trim().min(1).max(64),
  numAdults: z.coerce.number().int().min(0).max(100),
  numChildren: z.coerce.number().int().min(0).max(100),
  extraBedCount: z.coerce.number().int().min(0).max(20).optional().default(0),
  // Per BR-08 (decision #238, 2026-10-14 — close-out):
  // the legacy EXB-12 `extraBedBreakfast: boolean` flat-rate
  // toggle is deleted. Extra-bed occupants are ordinary meal
  // slots in Step 2 (the per-meal picker), so the create
  // payload no longer carries a breakfast flag for them.
  // The BR-08 audit-trail comment is kept here as a record
  // of the close-out — see `plan/features/BREAKFAST.md
  // §Decisions Locked` (decision 4 — extra-bed occupants
  // are ordinary meal slots).
}).strict();

export const WalkinBookingSchema = z.object({
  bookingId: z.string().trim().regex(/^[A-Za-z0-9]{10,32}$/),
  roomId: z.string().trim().min(1).max(64),
  // Per MRB-07 (2026-08-02, per decision #159): the optional N-room
  // room list. When absent (every pre-MRB-07 caller), the server
  // derives a single line from the top-level `roomId` + `numAdults` +
  // `numChildren` + `extraBedCount` — byte-equivalent to the
  // single-room walk-in. When present, it is the canonical room list;
  // the server rejects the request unless `roomId === rooms[0].roomId`
  // and `guests` equals the summed per-line occupancy, so neither the
  // room nor the guest total is trusted from two disagreeing places.
  rooms: z.array(WalkinRoomLineSchema).min(1).max(50).optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.coerce.number().int().min(1).max(100),
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy flat-rate `hasBreakfast: boolean` +
  // `breakfastIncludesChildren: boolean` pair is deleted from
  // the walk-in schema. The walk-in modal now sends the rich
  // `breakfastSelections: Record<key, BreakfastSelectionEntry>`
  // shape (per-date × per-guest meal entries) which is
  // captured by `WalkinBreakfastGrid` and validated by the
  // BR-01 `BreakfastSelectionSchema`. The BR-08 audit-trail
  // comment is kept here as a record of the close-out — see
  // `plan/features/BREAKFAST.md §Decisions Locked` (decision
  // 5 — Step 1 carries no breakfast data).
  breakfastSelections: z.record(z.string(), z.unknown()).optional(),
  breakfastTotal: z.coerce.number().finite().min(0).optional(),
  // Per CHD-01 (2026-08-01, per decision #144): adults/children
  // split. Both optional — when absent, the server derives
  // `numAdults = guests`, `numChildren = 0` (the historical
  // "all guests are adults" shape). When present, the server
  // validates `numAdults + numChildren === guests` and rejects
  // any client-supplied `numGuests` that disagrees (the
  // spec's "no trusting either value from the client" rule).
  numAdults: z.coerce.number().int().min(0).max(100).optional(),
  numChildren: z.coerce.number().int().min(0).max(100).optional(),
  // Per EXB-01 (2026-07-31): extra-bed count. Optional — when
  // absent, the server treats it as 0 (the "no extra bed" case).
  // Bounded server-side by the room type's `maxExtraBeds` (a
  // booking with `extraBedCount > maxExtraBeds` is rejected). The
  // server snapshots the room type's `extraBedRate` onto the
  // booking doc alongside this field.
  extraBedCount: z.coerce.number().int().min(0).max(20).optional(),
  // Per BR-08 (decision #238, 2026-10-14 — close-out): the
  // legacy EXB-12 `extraBedBreakfast: boolean` flat-rate
  // toggle is deleted from the walk-in schema. Extra-bed
  // occupants are ordinary meal slots in Step 2 (the
  // per-meal picker) — the walk-in modal captures them via
  // `WalkinBreakfastGrid` which writes the rich
  // `breakfastSelections` shape (per-date × per-guest
  // meal entries) validated by `BreakfastSelectionSchema`.
  // The BR-08 audit-trail comment is kept here as a record
  // of the close-out — see `plan/features/BREAKFAST.md
  // §Decisions Locked` (decision 4 — extra-bed occupants
  // are ordinary meal slots).
  guestDetails: WalkinGuestDetailsSchema,
  paymentMethod: z.string().trim().min(1).max(80),
  // Per NBS-02 (2026-07-31): optional with `"walk-in"` default so
  // every existing caller keeps working with no migration. The
  // server validates the submitted value against the configured list
  // (`settings/hotelConfig.bookingSources[]`) and derives `notes` from
  // it — a phone / Agoda / Facebook booking no longer ships with a
  // note claiming it was created at the desk.
  source: z.string().trim().min(1).max(80).optional().default("walk-in"),
  status: z.enum(["confirmed", "checked-in"]).optional().default("confirmed"),
  totalPriceOverride: z.coerce.number().finite().min(0).max(1_000_000).optional(),
  discountType: z.enum(["", "senior", "pwd"]).optional().default(""),
  voucherCode: z.string().trim().max(40).optional().default(""),
  linkedInquiryId: z.string().trim().max(64).nullable().optional(),
  testRunId: z.string().trim().max(64).nullable().optional(),
  // Per MRB-02.x (2026-08-02, per decision #164): the
  // optional client-preallocated `reservationId` (UUIDv4)
  // for the reservation-level idempotency matrix. When
  // absent (the current walk-in modal doesn't preallocate),
  // the server auto-mints a UUIDv4 via `generateReservationId()`
  // — same pattern as the public `/api/bookings/create` path.
  // Walk-ins are staff-created, so the staff modal doesn't
  // need to preallocate for retry-after-uncertain-response
  // (the staff tab is open; the next submit starts a fresh
  // form with a new `bookingId`); the optional field is here
  // so a future walk-in client that does preallocate can
  // ride the same idempotency contract.
  reservationId: z.string().trim().regex(RESERVATION_ID_REGEX).optional(),
  // Per MRB-11 (2026-08-03, per decision #177): the
  // optional revenue allocation. Per the 2026-08-03
  // design call, the server always computes this before
  // the write — the input is accepted but the server
  // recomputes via the same pricing chain and asserts
  // the `totalNet === booking.totalPrice` invariant at
  // the write boundary. Pre-MRB-11 callers omit it; the
  // server fills it in. A future client preview may
  // supply it to skip the server recompute, but the
  // server's value is the only one written to the doc.
  revenueAllocation: BookingRevenueAllocationSchema.optional()
}).strict();

export type BookingDatesInput = z.infer<typeof BookingDatesSchema>;
export type GuestDetailsInput = z.infer<typeof GuestDetailsSchema>;
export type PaymentReviewInput = z.infer<typeof PaymentReviewSchema>;

// Per MRB-02.x (2026-08-02, per decision #164): the
// reschedule surface. The reschedule body is small —
// just the booking + the new room + the new dates + an
// optional reason. The `reservationId` is optional so the
// client (the staff modal) doesn't need to send it; the
// server derives it from the existing booking's
// `reservationId` field. When the existing booking has
// a `reservationId`, the server's transaction reads +
// updates the corresponding `reservations/{id}` header
// in lock-step with the booking update. When the
// existing booking has no `reservationId` (legacy
// null-reservationId self-contained behavior), the
// server leaves the booking as-is and no header is
// touched — same shape as the pre-MRB-02.x reschedule.
//
// The schema is `strict()` so a client can't add
// unexpected fields (the same posture as the create +
// walkin schemas). The `reason` is optional and capped
// at 500 chars (the same cap the existing handler used
// when stamping `rescheduleHistory[].reason`).
export const RescheduleBookingSchema = z.object({
  bookingId: z.string().trim().min(1).max(64),
  roomId: z.string().trim().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).optional().default(""),
  // The optional `reservationId` is here so a future
  // reschedule client that preallocates (e.g. a bulk
  // reschedule tool that wants the staff to be able to
  // retry the same reschedule without re-picking dates)
  // can ride the same idempotency contract. The
  // current staff modal doesn't preallocate, so the
  // server derives the id from the existing booking
  // (or, for legacy null-reservationId bookings, the
  // server auto-mints one if `body.reservationId` is
  // explicitly provided — a defensive path for a
  // future migration tool).
  reservationId: z.string().trim().regex(RESERVATION_ID_REGEX).optional()
}).strict();

export type RescheduleBookingInput = z.infer<typeof RescheduleBookingSchema>;
export type WalkinBookingInput = z.infer<typeof WalkinBookingSchema>;
export type WalkinRoomLineInput = z.infer<typeof WalkinRoomLineSchema>;

// Per LOW-1 (reports audit 2026-08-10) +
// `DECISIONS-FEATURES.md #99` (LOU workflow):
// the staff-toggled LOU (Letter of Undertaking) flag
// for corporate chargeback bookings. The schema lives
// in the shared package (not co-located with the
// handler) so a future `setLouReceived` call site —
// or a future client-side preview / display — can
// import the same shape. The schema is `.strict()` so
// a client can't add unknown fields (matches the
// discipline of every other staff-mutation schema in
// this file). The handler enforces the
// `isCorporate + paymentMethod === "pay-at-hotel"`
// guard separately.
export const SetLouReceivedSchema = z.object({
  bookingId: z.string().trim().min(1).max(64),
  louReceived: z.boolean()
}).strict();

export type SetLouReceivedInput = z.infer<typeof SetLouReceivedSchema>;

// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// the add-room surface. Staff adds a room to an existing
// pre-arrival reservation using the header's current
// dates — the dates are NEVER in the body (the server
// reads them from the header). The schema is `strict()`
// (matches the create + walkin + reschedule posture).
// The room occupancy mirrors the per-line shape the
// walkin handler uses; the discount / voucher fields
// apply to the new child only (the header's existing
// discount / voucher stay untouched per the
// "per-child voucher + per-reservation corporate" rule
// from MRB-08). The optional `totalPriceOverride` is
// the same walkin escape hatch (manual pricing for
// staff-set walkin totals); the server still asserts
// the MRB-11 invariant via the same `assertBookingRevenueAllocationInvariant`
// write-boundary guard.
export const AddRoomBookingSchema = z
  .object({
    reservationId: z.string().trim().regex(RESERVATION_ID_REGEX),
    roomId: z.string().trim().min(1).max(64),
    numAdults: z.coerce.number().int().min(1).max(100),
    numChildren: z.coerce.number().int().min(0).max(100).optional().default(0),
    extraBedCount: z.coerce.number().int().min(0).max(20).optional().default(0),
    discountType: z.enum(["", "senior", "pwd"]).optional().default(""),
    voucherCode: z.string().trim().max(40).optional().default(""),
    // The optional `totalPriceOverride` matches the walkin
    // surface; absent → server-computed.
    totalPriceOverride: z.coerce.number().finite().min(0).max(1_000_000).optional(),
    // The optional `requestFingerprint` lets a future
    // client preallocate the idempotency key for a
    // retry-after-uncertain-response. The current staff
    // modal doesn't preallocate — the server auto-mints
    // `add-room-${reservationId}-${roomId}-${now}` and
    // writes it onto the header (the same pattern the
    // reschedule handler uses for `rescheduleFingerprint`).
    requestFingerprint: z.string().trim().min(1).max(256).optional()
  })
  .strict();

export type AddRoomBookingInput = z.infer<typeof AddRoomBookingSchema>;

// In-flow hold schemas for the public booking flow's
// Steps 2 + 3 countdown banner. The client preallocates a
// `holdId` (UUIDv4) and a `reservationId` (UUIDv4) on
// the Step 1 → Step 2 transition, calls
// `/api/holds/start` to stamp the hold server-side, and
// threads the `holdId` through to Step 3's
// `/api/bookings/create` body. The transaction reads the
// hold, marks it consumed, and proceeds.
//
// Per the in-flow hold decision: the hold is a UX signal,
// NOT a hard inventory lock. The authoritative
// double-booking guarantee remains the Firestore
// transaction. The schema below is strict about shape
// (UUIDv4, YYYY-MM-DD, positive numbers) but never
// cross-references the `bookings` collection — a stale
// hold for a stale room is just a stale hold; the
// transaction is what picks a winner when two guests race
// for the same room.
//
// The `holdId` regex matches the
// `generateHoldId` / `crypto.randomUUID` shape — UUIDv4
// with hyphen groups (8-4-4-4-12 hex). The Zod regex is
// lenient on case so a hand-typed `Hold-...` from a future
// admin override still validates.
export const StartBookingHoldSchema = z
  .object({
    holdId: z.string().trim().regex(HOLD_ID_REGEX, "Invalid hold id format"),
    reservationId: z.string().trim().regex(RESERVATION_ID_REGEX, "Invalid reservation id format"),
    roomType: z.string().trim().min(1).max(64),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD"),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD"),
    numNights: z.coerce.number().int().min(1).max(60)
  })
  .strict()
  .refine((value) => new Date(value.checkOut) > new Date(value.checkIn), {
    message: "Check-out must be after check-in",
    path: ["checkOut"]
  });

export type StartBookingHoldInput = z.infer<typeof StartBookingHoldSchema>;

// ============================================================================
// Per BR-01 (Phase 13 — Breakfast Redesign, decision #231,
// 2026-10-12): the new meal-based breakfast schemas.
//
// The legacy flat-rate toggle (`hasBreakfast: boolean` +
// `breakfastRate: number`) is replaced by a per-meal catalog
// (`BreakfastMeal[]`), a per-slot snapshot map on the booking
// (`breakfastSelections: Record<key, BreakfastSelectionEntry>`),
// and a per-slot served map (`breakfastServed: Record<key,
// BreakfastServedEntry>`). See `plan/features/BREAKFAST.md
// §Data Model` for the full spec and rationale.
//
// `Timestamp | string` fields use `z.union([z.string(), z.any()])`
// — the existing codebase's permissive pattern for Firestore
// Timestamp-on-write / string-on-read values (the `z.any()`
// half covers both the hydrated `Date` shape and the raw
// `_seconds/_nanoseconds` payload from the client). Server-side
// validators that need the strict shape do an explicit
// `instanceof Date` check after the schema passes.
// ============================================================================

/**
 * The meal catalog. `id` is the kebab-case key used in
 * `BreakfastSelectionEntry.mealId`. `price` is the live
 * (non-snapshot) price in PHP; the booking snapshots its
 * own copy at order time so later edits never rewrite
 * existing bills. `description` is capped at 200 chars
 * per the spec.
 */
export const BreakfastMealSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(200).default(""),
  price: z.number().min(0).max(10000),
  isActive: z.boolean(),
  displayOrder: z.number().int().min(0).max(1000),
  createdAt: z.union([z.string(), z.any()]).optional(),
  updatedAt: z.union([z.string(), z.any()]).optional()
});
export type BreakfastMealInput = z.infer<typeof BreakfastMealSchema>;

/**
 * The settings doc shape at `settings/breakfastConfig`. The
 * `cutoffTime` regex matches the `HH:MM` 24h format. The
 * `cutoffTimezone` is IANA (validated by
 * `isValidTimezone` in the runtime helper, not by Zod —
 * IANA has no fixed list). `meals` is the catalog; the
 * individual rows validate against `BreakfastMealSchema`.
 */
export const BreakfastConfigSchema = z.object({
  isEnabled: z.boolean(),
  cutoffTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h format"),
  cutoffTimezone: z.string().min(1),
  frontDeskOverrideEnabled: z.boolean(),
  /**
   * Per decision #231 + open item #5: 0..60 minute window after
   * `served` during which staff can un-serve without a reason.
   * Default 15; min 0; max 60.
   */
  servedGraceMinutes: z.number().int().min(0).max(60).default(15),
  defaultMealInstructions: z.string().max(2000).default(""),
  meals: z.array(BreakfastMealSchema),
  updatedAt: z.union([z.string(), z.any()]).optional(),
  updatedBy: z.string().default("")
});
export type BreakfastConfigInput = z.infer<typeof BreakfastConfigSchema>;

/**
 * One per-meal-per-guest slot on a booking. The
 * `mealId` + `mealName` + `price` triple is the snapshot
 * — later edits to the meal catalog never rewrite the
 * booking's price. `removedAt` / `removedBy` track
 * cancellations (a paid removal opens a refund liability
 * in BR-06). `overrideCutoff` + `overrideReason` track
 * late changes from staff (audit trail for the kitchen).
 */
export const BreakfastSelectionEntrySchema = z.object({
  mealId: z.string().min(1),
  mealName: z.string().min(1),
  price: z.number().min(0),
  addedAt: z.union([z.string(), z.any()]),
  addedBy: z.string().min(1),
  lastModifiedAt: z.union([z.string(), z.any()]),
  lastModifiedBy: z.string().min(1),
  removedAt: z.union([z.string(), z.any()]).nullable().default(null),
  removedBy: z.string().nullable().default(null),
  overrideCutoff: z.boolean().default(false),
  overrideReason: z.string().nullable().default(null)
});
export type BreakfastSelectionEntryInput = z.infer<typeof BreakfastSelectionEntrySchema>;

/**
 * The served record per slot. `unservedAt` +
 * `unservedBy` capture the grace-window un-mark (within
 * `BreakfastConfig.servedGraceMinutes`); after the grace
 * window the un-serve action requires an override reason
 * — that override writes to the `BreakfastAuditEntry`
 * rather than mutating this record.
 */
export const BreakfastServedEntrySchema = z.object({
  servedAt: z.union([z.string(), z.any()]),
  servedBy: z.string().min(1),
  unservedAt: z.union([z.string(), z.any()]).nullable().default(null),
  unservedBy: z.string().nullable().default(null)
});
export type BreakfastServedEntryInput = z.infer<typeof BreakfastServedEntrySchema>;

/**
 * The audit subcollection entry. The `action` enum
 * distinguishes the regular lifecycle (add / change /
 * remove / serve / unserve) from the override variants
 * (override-add / override-change / override-remove) —
 * the kitchen list's "Late changes" column filters on
 * `occurredAfterCutoff === true` (a separate flag from
 * `overrideCutoff`, which is the per-slot
 * override-marker; both are written for an
 * `override-*` action).
 */
export const BreakfastAuditEntrySchema = z.object({
  id: z.string().optional(),
  action: z.enum([
    "add",
    "change",
    "remove",
    "serve",
    "unserve",
    "override-add",
    "override-change",
    "override-remove"
  ]),
  slotKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}-\d+$/, "serviceDate-guestIndex format"),
  mealSnapshot: z
    .object({
      mealId: z.string(),
      mealName: z.string(),
      price: z.number().min(0)
    })
    .nullable(),
  actorUid: z.string().min(1),
  actorRole: z.enum(["guest", "front-desk", "admin"]),
  reason: z.string().nullable().default(null),
  occurredAt: z.union([z.string(), z.any()]),
  occurredAfterCutoff: z.boolean()
});
export type BreakfastAuditEntryInput = z.infer<typeof BreakfastAuditEntrySchema>;

/**
 * The refund-context blob stamped onto a
 * `bookings/{id}/refunds/{refundId}` doc when the
 * refund is for a removed breakfast meal (vs. the
 * legacy cancellation refund). Mirrors the snapshot
 * `price` so a later meal-catalog price change never
 * rewrites the refund amount.
 */
export const BreakfastRefundContextSchema = z.object({
  mealId: z.string().min(1),
  slotKey: z.string().regex(/^\d{4}-\d{2}-\d{2}-\d+$/),
  mealName: z.string().min(1),
  priceSnapshot: z.number().min(0)
});
export type BreakfastRefundContextInput = z.infer<typeof BreakfastRefundContextSchema>;

// NOTE: The `BreakfastUpdateSchema` + `StaffBreakfastUpdateSchema`
// payloads (the Manage Booking save-batch + the staff-override
// variant) are intentionally NOT in BR-01. They belong in BR-04
// (Guest Manage Breakfast page) + BR-05 (Staff drawer) — both
// depend on the route handlers + the audit-subcollection writer,
// which BR-01 deliberately doesn't add (no new Vercel functions,
// no new Firestore collections, per the BR-01 ticket scope).
// See `plan/features/BREAKFAST.md §Implementation order` (BR-04
// + BR-05 bullet points).
