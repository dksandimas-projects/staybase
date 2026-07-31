import { z } from "zod";

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
  testRunId: z.string().trim().max(64).nullable().optional()
}).strict();

export type BookingDatesInput = z.infer<typeof BookingDatesSchema>;
export type GuestDetailsInput = z.infer<typeof GuestDetailsSchema>;
export type PaymentReviewInput = z.infer<typeof PaymentReviewSchema>;
export type WalkinBookingInput = z.infer<typeof WalkinBookingSchema>;
