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

export const WalkinBookingSchema = z.object({
  bookingId: z.string().trim().regex(/^[A-Za-z0-9]{10,32}$/),
  roomId: z.string().trim().min(1).max(64),
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
  reservationId: z.string().trim().regex(RESERVATION_ID_REGEX).optional()
}).strict();

export type BookingDatesInput = z.infer<typeof BookingDatesSchema>;
export type GuestDetailsInput = z.infer<typeof GuestDetailsSchema>;
export type PaymentReviewInput = z.infer<typeof PaymentReviewSchema>;
export type WalkinBookingInput = z.infer<typeof WalkinBookingSchema>;
