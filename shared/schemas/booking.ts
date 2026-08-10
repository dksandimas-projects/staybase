import { z } from "zod";
import { RESERVATION_ID_REGEX } from "../utils/references";

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
  // Per EXB-12 (2026-08-06, per decision #199): whether the
  // walk-in guest wants breakfast for the extra-bed occupant(s).
  // Optional — when absent, the server treats it as `false`.
  // The server validates the invariant: `extraBedBreakfast`
  // can only be `true` when `extraBedCount > 0`.
  extraBedBreakfast: z.boolean().optional()
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
  hasBreakfast: z.boolean(),
  // Per CHD-10 (2026-07-31, per CVQ-01): optional — when absent,
  // the server snapshots the admin default from
  // `settings/breakfastConfig.breakfastIncludesChildrenDefault` and
  // writes the result to the booking doc alongside `hasBreakfast`.
  // `true` is the safe default (matches the historical "children pay
  // the full rate" math).
  breakfastIncludesChildren: z.boolean().optional(),
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
  // Per EXB-12 (2026-08-06, per decision #199): whether the
  // guest wants breakfast for the extra-bed occupant(s). When
  // `true`, all `extraBedCount` beds in this room are counted
  // toward the breakfast total. Optional — when absent, the
  // server treats it as `false` (no breakfast for extra beds).
  // The server validates the invariant: `extraBedBreakfast`
  // can only be `true` when `extraBedCount > 0`.
  extraBedBreakfast: z.boolean().optional(),
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

