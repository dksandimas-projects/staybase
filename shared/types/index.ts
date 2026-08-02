import type {
  BOOKING_STATUSES,
  HOUSEKEEPING_STATUSES,
  ROOM_STATUSES
} from "../constants";
import type { DiscountScope } from "../utils/bookingDiscounts";
import type { CancellationSource } from "../utils/bookingOccupancy";
import type { CancellationPolicySnapshot } from "../utils/cancellation";

export type RoomType = string;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
// Per NBS-03 (2026-07-31): widened from the historical union
// ("online" | "walk-in" | "phone" | "facebook" | "corporate") to
// `string` so new configured entries (e.g. "agoda" per CVQ-08) flow
// through without a schema change. The `BOOKING_SOURCES` constant
// stays as the seed/default array. Server-side validation against the
// configured list (`settings/hotelConfig.bookingSources[]`) is the
// authoritative gate; the union is no longer the source of truth.
export type BookingSource = string;
export type DiscountType = "" | "senior" | "pwd";
export type PaymentMethod = "pay-at-hotel" | "gcash" | "paypal" | string;

// Per-method configuration for the dynamic booking payment list
// managed from Settings → Payment Methods. The admin can add, remove,
// reorder, enable/disable, and edit any method — including "Pay at
// Hotel" which is just another method (no separate global toggle).
// QR codes are uploaded to `assets/payment-methods/{method}/{fileName}`
// in Firebase Storage. The Zod schema lives in
// `shared/schemas/paymentMethod.ts`; derive the TS type from there
// for any new code, but keep this interface in sync — the two
// declarations are mirrored (TypeScript cannot `z.infer` across the
// shared/admin boundary without a workspace import).
//
// Per #111 (per-method surface toggles): each method owns three
// independent surface toggles so the admin can hide a method from
// one surface without removing it from the others:
//   - `isEnabled` — controls visibility on the **regular booking**
//     flow (`/book` Step 3). The original master toggle.
//   - `showInStore` — controls visibility on the **in-room store**
//     checkout (`/intercom/:roomId` Shop tab). Defaults to `true`
//     for legacy custom methods; built-in methods are normalized
//     by `AdminContext`.
//   - `showInCorporate` — controls visibility on the **corporate
//     booking** personal-pay selector. The company charge-back path
//     is unaffected (it doesn't show a method picker). Defaults
//     to `true`.
export interface PaymentMethodConfig {
  method: string;
  label: string;
  accountName: string;
  accountNumber: string;
  qrUrl: string;
  isEnabled: boolean;
  showInStore?: boolean;
  showInCorporate?: boolean;
  requireReferenceNumber?: boolean;
}

// Legacy per-method configuration for the in-room store. These
// fields may still exist on older `settings/storeConfig` documents,
// but new code uses `settings/hotelConfig.paymentMethods[]` plus
// each method's `showInStore` flag as the single source of truth.
export interface StorePaymentMethodConfig {
  method: string;
  label: string;
  isEnabled: boolean;
  qrUrl?: string;
  accountInfo?: string;
}

// Runtime-editable configuration for the in-room store, stored at
// `settings/storeConfig`. Payment methods are intentionally not
// configured here anymore; the store checkout reads
// `settings/hotelConfig.paymentMethods[]` and filters by
// `showInStore !== false`.
export interface StoreConfig {
  isEnabled: boolean;
  lowStockThreshold: number;
  // Legacy fields retained for old Firestore documents. The admin
  // UI no longer writes them and the guest/server checkout ignores
  // them.
  paymentMethods: StorePaymentMethodConfig[];
  useBookingPaymentMethods: boolean;
}

export interface Room {
  id: string;
  name: string;
  roomNumber: string;
  type: RoomType;
  isActive: boolean;
  status: RoomStatus;
  housekeepingStatus: HousekeepingStatus;
  blockReason: string;
  remarks: string;
  blockedFrom?: string | Date | null;
  blockedTo?: string | Date | null;
  qrToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

// `bedDefinition`, `description`, `amenities`, `maxCapacity`,
// `pricePerNight`, `weekendRate`, and `corporateRate` were moved off the
// Room document and onto the RoomType entry (see `RoomTypeEntry` in
// `shared/constants/index.ts`) across W3.6 and W3.7. All rooms of a
// type now share the same bed, description, amenities, occupancy cap,
// and rate matrix. The Rates tab is the canonical edit surface for
// the rate matrix; the Room Types section of Settings (with its new
// Edit modal as of W3.7) is the canonical edit surface for the rest.
// Consumers join the type by `Room.type` at read time via `useRoomTypes`
// + the `getRoomTypeImages` / `getRoomTypeRates` helpers.

export interface EarlyCheckInDetails {
  status: "requested" | "approved" | "declined";
  requestedTime: string;
  notes: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  staffNote: string | null;
  confirmedTime?: string | null;
}

export interface SeasonalRateOverride {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  rate: number;
  roomTypeValues: string[];
  isActive: boolean;
}

export type BookingRateLineSource = "regular" | "weekend" | "seasonal" | "corporate" | "manual";

export interface BookingRateLine {
  source: BookingRateLineSource;
  label: string;
  startDate: string;
  endDate: string;
  nights: number;
  nightlyRate: number;
  subtotal: number;
}

export interface BookingRateAdjustmentLine {
  label: string;
  amount: number;
}

export interface BookingRateBreakdown {
  roomSubtotal: number;
  roomLines: BookingRateLine[];
  addOns: BookingRateAdjustmentLine[];
  deductions: BookingRateAdjustmentLine[];
  finalTotal: number;
}

export interface RoomBlock {
  id: string;
  roomId: string;
  roomNumber: string;
  roomType: string;
  startDate: string;
  endDate: string;
  reason: string;
  notes: string;
  status: "active" | "cancelled";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

// Per MRB-01 (2026-08-02, per decision #159): the reservation
// header. Every new booking (including a one-room stay) carries
// a server-assigned `reservationId` + denormalized `reservationRef`
// pointing at a `reservations/{id}` document. The header owns
// the public ref, lead booker / contact, source / corporate
// context, payment proof / state, voucher / member discount,
// consent, group totals, and (in MRB-04) the folio at
// `reservations/{id}/payments` + `reservations/{id}/charges`.
// Room-booking-authoritative fields (physical room, dates,
// occupancy, rate / add-on / tax snapshots, registration / ID /
// signature, check-in / out, housekeeping, room lifecycle) live
// on each child `bookings/{id}`.
//
// Compatibility copies (e.g. `reservationRef` denormalized onto
// each child booking) are read-only projections; the Firestore
// rules deny client writes to those copies and to `reservationId`
// itself. The header is the single authoritative source for the
// public ref + the lead booker + the group totals + the cancel
// scope (per MRB-13). Legacy null-`reservationId` bookings keep
// today's self-contained behavior; pre-live TEST DATA is reset,
// not migrated.
//
// Aggregate status is derived from the child rooms
// (decision #159, the reservation-summary table): `Awaiting payment`
// (any non-cancelled room is `pending` or `payment-uploaded`),
// `Confirmed` (all non-cancelled rooms are `payment-confirmed` or
// `confirmed`), `Partially checked in` (a mix of confirmed and
// checked-in rooms), `In house` (all active rooms checked in),
// `Partially checked out` (a mix of checked-in and checked-out),
// `Completed` (all active rooms checked out), `Cancelled` (all
// rooms cancelled). A reservation with a mix of cancelled and
// active rooms shows the active count + a "X of Y rooms cancelled"
// secondary label — cancellation is a secondary count, not a hidden
// state. This is the wire contract for MRB-12's admin affordance.
//
// Per MRB-04 Phase 3 (2026-08-02, per decision #159): the
// canonical money-state union at reservation scope. The 7 values
// map 1:1 to the booking's `status` enum (see
// `mapBookingStatusToReservationPaymentStatus` in
// `shared/utils/bookingFolio.ts` for the N=1 mapping) with two
// relabels: `pending` → `awaiting-payment` (the reservation's
// reservation-aware label) and `checked-in` → `in-house` (the
// reservation's "in the hotel right now" label). The other five
// values (`payment-uploaded`, `payment-confirmed`, `confirmed`,
// `checked-out`, `cancelled`) pass through unchanged. Extracted
// as a named type so the helper's return type + the
// `Reservation.paymentStatus` field + the
// `ReservationFolioSummary.status` field all reference one
// source — no drift between the mapping helper and the fields
// it feeds.
export type ReservationPaymentStatus =
  | "awaiting-payment"
  | "payment-uploaded"
  | "payment-confirmed"
  | "confirmed"
  | "in-house"
  | "completed"
  | "cancelled";

export interface Reservation {
  id: string;
  /** Public ref — `R-YYYYMMDD-NNNNN`. Distinct prefix from `SI-` booking refs. */
  reservationRef: string;

  /** Lead booker / contact. Captured at create time. Per-room occupant identities are captured at check-in where registration already happens. */
  leadGuestName: string;
  leadGuestEmail: string;
  leadGuestPhone: string;
  /** Server-mapped from the verified email token; `null` for non-member guests. */
  memberId: string | null;

  /** Shared date range. Every room in the reservation shares these dates at creation. */
  checkIn: Date;
  checkOut: Date;
  numNights: number;

  /** Group totals — recomputed transactionally in MRB-04 whenever a child is created / rescheduled / cancelled. */
  originalSubtotal: number;
  /** Per DSC-01: the discount scope at the moment the reservation was created. Snapshotted. */
  discountScopeSnapshot: DiscountScope | null;
  /** Sum of every child room's `subtotal` (room + add-ons after the chain math). The reservation total is the sum of these, not a separate derivation. */
  subtotal: number;
  /** Final bill — the sum of every child room's `totalPrice` after discounts + VAT. */
  totalPrice: number;

  /** Source / corporate context — single value per reservation, properties of the guest's intent, not per-room. */
  source: BookingSource;
  isCorporate: boolean;
  /** Snapshotted — a later code change never rewrites an existing reservation. */
  corporateCode: string;
  companyName: string;
  /** Flat voucher applies once to the reservation (per MRB-09); percentage vouchers are reapplied per-eligible-line. */
  voucherCode: string;
  /** Member discount pct applied to the lead member's eligible room lines. */
  memberDiscountPct: number;

  /** Money state — mirrors the child rooms but at reservation scope. A reservation is "awaiting payment" while any non-cancelled room is `pending` or `payment-uploaded`. */
  paymentStatus: ReservationPaymentStatus;
  paymentMethod: PaymentMethod;
  /** Per BF-45: canonical "no payment proof" is `null` (not `""`). */
  paymentProofUrl: string | null;
  /** Private Storage object path; staff resolves a short-lived signed URL. */
  paymentProofPath: string | null;

  /** Consent — single per reservation, same T&C + privacy acceptance covers all rooms. */
  termsAccepted: boolean;
  termsAcceptedAt: Date | null;
  termsVersion: string;
  privacyAccepted: boolean;
  privacyAcceptedAt: Date | null;
  privacyVersion: string;
  cancellationPolicySnapshot?: CancellationPolicySnapshot | null;

  /** Aggregate counters — denormalized for fast UI; recomputed transactionally in MRB-04 / MRB-13. */
  roomCount: number;
  activeRoomCount: number;
  cancelledRoomCount: number;
  checkedInRoomCount: number;
  checkedOutRoomCount: number;

  /** Per PEX-01 (decision #147): the unified hold window for the whole reservation. No separate large-group timer per MRB-08. `null` after the hold transitions to `payment-uploaded` or beyond. */
  holdExpiresAt: Date | null;

  /** Per decision #159: the canonical request fingerprint. The same `reservationId` + same fingerprint is an idempotent replay; a same-ID-different-fingerprint replay is a 409. Computed by `computeRequestFingerprint` at create time. Server-only — never read or set by clients. */
  requestFingerprint: string;

  createdAt: Date;
  updatedAt: Date;
  /** Staff UID for staff-created reservations, or the literal `"guest"` for self-service. Same pattern as CRL-02's `cancelledBy`. */
  createdBy: string;
}

// Per MRB-04 (2026-08-02, per decision #159): the
// reservation-level folio. New payments and financial
// adjustments live under `reservations/{id}/payments`
// and `reservations/{id}/charges`; child-specific
// entries carry `bookingId` for per-room attribution.
// The reservation header is the single source of
// truth for the reservation's money state; the legacy
// `bookings/{id}/payments` + `bookings/{id}/charges`
// subcollections remain for legacy bookings (those
// pre-date the reservation-header model — pre-MRB-01,
// i.e. created before 2026-08-02). The behavior-frozen
// `getReservationFolioSummary` helper in
// `shared/utils/bookingFolio.ts` is the canonical
// resolver: it reads from the new subcollections for
// reservations with a `reservationId`, and falls back
// to the legacy `bookings/{id}/payments` +
// `bookings/{id}/charges` for legacy null-`reservationId`
// bookings. The "money state mirror" rule — the
// reservation header's `paymentStatus` + `totalPrice`
// + `subtotal` MUST match the sum of the per-room
// payment + charge entries — is enforced transactionally
// in MRB-04's payment write paths (the create handler
// seeds the header; subsequent writes recompute the
// header in the same `runTransaction`).

/** A payment entry on the reservation folio. Positive amount for a payment collected; negative for a refund. Lives at `reservations/{id}/payments/{paymentId}`. */
export interface ReservationPayment {
  id: string;
  reservationId: string;
  /** Optional — for per-room attribution (e.g. a payment that pays for a specific room's add-on). Most reservation-level payments leave this null. */
  bookingId: string | null;
  type: "payment" | "refund";
  /** Positive for a payment collected, negative for a refund. The negative-amount convention is the same as the existing `bookings/{id}/payments/` ledger — see CRL-01's refund-idempotency contract. */
  amount: number;
  method: string;
  note: string;
  /** Tender-specific identifier (GCash ref, bank trace). Per the 2026-07-24 payment-reference unification, this is the canonical reference — the legacy `Booking.paymentReferenceNumber` was retired. */
  transactionReference: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: Date;
}

/** Per MRB-04 Phase 2.x (2026-08-02, per decision #159): a refund entry on the reservation folio. The canonical refund source for new reservations (post-MRB-04 Phase 2.x) lives at `reservations/{id}/refunds/{refundId}`. The shape mirrors the existing legacy `bookings/{id}/refunds/` entry — admin-only, requires an approver UID + a reason + a method. Per the "both, as separate paths" design: the helper `getReservationFolioSummary` reads BOTH `reservations/{id}/payments` (for any negative-amount entries — belt-and-suspenders) AND `reservations/{id}/refunds` (canonical). The writer (`handleAddRefund`) only writes to `refunds/`, so a refund in BOTH subcollections would be a writer bug, not a normal state. */
export interface ReservationRefund {
  id: string;
  reservationId: string;
  /** Optional — for per-room attribution. Most reservation-level refunds leave this null; per-room refunds (e.g. a refund for a specific room's add-on) carry the bookingId. */
  bookingId: string | null;
  /** Always negative — the refund amount as a positive number is `Math.abs(amount)`. The sign convention matches the CRL-01 negative-amount convention on the legacy `bookings/{id}/payments/` ledger. */
  amount: number;
  method: string;
  /** Always required for refunds — admin-only, the staff must supply a reason. */
  reason: string;
  /** Tender-specific identifier (GCash ref, bank trace). Same convention as the `ReservationPayment` field. */
  transactionReference: string | null;
  /** The admin who approved the refund (required — refunds are admin-only). Mirrors the legacy `bookings/{id}/refunds.approvedBy`. */
  approvedBy: string;
  /** The admin who recorded the refund. May be the same as `approvedBy` when a single admin does both steps. */
  recordedBy: string;
  recordedAt: Date;
}

/** A charge (incidental or adjustment) on the reservation folio. Lives at `reservations/{id}/charges/{chargeId}`. The `voidOf` field mirrors the existing `bookings/{id}/charges` ledger — a non-null `voidOf` voids a prior charge. */
export interface ReservationCharge {
  id: string;
  reservationId: string;
  /** Optional — for per-room attribution. Most reservation-level charges leave this null; per-room charges (e.g. a room-specific minibar) carry the bookingId. */
  bookingId: string | null;
  label: string;
  amount: number;
  category: IncidentalChargeCategory;
  note: string;
  addedBy: string;
  addedAt: Date;
  /** Mirrors the existing `bookings/{id}/charges.voidOf` — a non-null `voidOf` voids the prior charge with the same id. Per the existing per-creator + bounds + void semantics. */
  voidOf: string | null;
}

/** Per MRB-04 (2026-08-02, per decision #159): the behavior-frozen folio summary returned by `getReservationFolioSummary`. The balance invariant is `reservation balance == sum(charges) − sum(payments)`. The `chargesTotal` + `paymentsTotal` are signed sums (refunds are negative, voids are zeroed). */
export interface ReservationFolioSummary {
  reservationId: string;
  /** Reservation total — the sum of per-room `totalPrice`. Set at create time; recomputed transactionally in MRB-04's payment write paths. */
  reservationTotal: number;
  /** Sum of every charge (positive for charges, zero for voided). */
  chargesTotal: number;
  /** Sum of every payment (positive for payments, negative for refunds). */
  paymentsTotal: number;
  /** Outstanding balance: `reservationTotal + chargesTotal − paymentsTotal`. Positive = guest owes money. Negative = overpaid (refunds pending). */
  balance: number;
  /** Derived status — mirrors the header's `paymentStatus` derivation but at folio scope. */
  status: ReservationPaymentStatus;
  /** Whether the source is the new reservation subcollections or the legacy `bookings/{id}/payments` + `bookings/{id}/charges`. The legacy adapter is for null-`reservationId` bookings (pre-MRB-01). */
  source: "reservation-subcollection" | "booking-subcollection-legacy";
}

export interface Booking {
  id: string;
  bookingRef: string;
  // Per MRB-01 (2026-08-02, per decision #159): the reservation
  // header linkage. Every new booking (including a one-room stay)
  // carries server-assigned `reservationId`, denormalized
  // `reservationRef`, `reservationPosition` (1-indexed room
  // position), and `reservationRoomCount`. These are read-only
  // projections of the parent reservation — no UI or rule may edit
  // them independently. The Firestore rules deny client writes to
  // all four (see `firebase/firestore.rules §reservations`).
  // Legacy null-`reservationId` bookings keep today's self-contained
  // behavior; pre-live TEST DATA is reset, not migrated. Every new
  // booking, including a one-room stay, is linked to a reservation
  // header so the public ref + the lead booker + the group totals +
  // the cancel scope (per MRB-13) all read from a single
  // authoritative source — no dual single/group implementation.
  reservationId: string | null;
  reservationRef: string | null;
  reservationPosition: number | null;
  reservationRoomCount: number | null;
  roomId: string;
  roomNumber: string;
  roomType: RoomType;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  numGuests: number;
  // Per CHD-01 (2026-08-01, per CVQ-01 + decision #144):
  // adults/children split. `numGuests` is the persisted total
  // and is derived server-side from `numAdults + numChildren`
  // (the client may supply a `numGuests` for legacy callers
  // and the server derives the split). Legacy bookings
  // without these fields read as `numAdults = numGuests`,
  // `numChildren = 0` (the historical "all guests are
  // adults" shape, preserved so every existing read site keeps
  // working). The fields are optional in the type (legacy)
  // but always present on bookings created after this
  // change. Children are free of the **room** rate; whether
  // they are charged breakfast is a separate flag
  // (`breakfastIncludesChildren` from CHD-10, per CVQ-01).
  numAdults?: number;
  numChildren?: number;
  checkIn: Date;
  checkOut: Date;
  numNights: number;
  ratePerNight: number;
  totalPrice: number;
  rateBreakdown?: BookingRateBreakdown | null;
  /** Pre-discount room/add-on subtotal. New writers always set it; null is legacy-only. */
  originalTotalPrice: number | null;
  discountType: DiscountType;
  discountPct: number;
  memberDiscountPct?: number;
  discountIdPhotoUrl: string | null;
  /** Private Firebase Storage object path; staff resolves a short-lived signed URL. */
  discountIdPhotoPath?: string | null;
  discountVerified: boolean;
  discountVerifiedBy: string | null;
  discountRejected: boolean;
  discountRejectedBy: string | null;
  discountRejectionReason: string;
  voucherCode: string;
  voucherDiscount: number;
  isCorporate: boolean;
  corporateCode: string;
  companyName: string;
  specialRequests: string;
  status: BookingStatus;
  paymentMethod: PaymentMethod;
  // Per BF-45 (booking-flow audit 2026-06-26): the
  // canonical "no payment proof" value is `null` (not
  // `""`). Writes coalesce `""` to `null` so all read
  // sites can rely on `!!booking.paymentProofUrl` /
  // `paymentProofUrl === null` checks without a string
  // comparison.
  paymentProofUrl: string | null;
  /** Private Firebase Storage object path; staff resolves a short-lived signed URL. */
  paymentProofPath?: string | null;
  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15): staff can reject a pending
  // payment proof from the dashboard, bouncing the
  // booking back to `pending` with a required reason.
  // The guest is emailed + sees the reason in the lookup
  // page. `paymentProofUrl` is intentionally **kept**
  // (not cleared) for audit trail — the re-upload flow
  // is guest-driven via the existing pending UI. The
  // payment reference number (e.g. GCash ref / bank
  // trace) lives on each entry in the
  // `bookings/{id}/payments/` ledger as `transactionReference`;
  // it is no longer carried on the booking itself.
  paymentRejectionReason?: string | null;
  paymentRejectedAt?: Date | null;
  paymentRejectedBy?: string | null;
  // Per PEX-01 (2026-08-01, per CVQ-12 + decision #147): the
  // snapshotted deadline at which a `pending` booking's hold on
  // the room expires. Written by `handleCreateBooking` (and the
  // walk-in / reject-proof paths) using the admin-configured
  // `settings/hotelConfig.paymentHoldWindowHours`. Snapshotted —
  // a later Settings change never shortens or lengthens an
  // existing guest's promise. `null` for legacy bookings,
  // `payment-uploaded` bookings (staff-review state, no auto-expiry),
  // and any status that is not `pending`. The `isBookingOccupyingRoom`
  // helper in `shared/utils/bookingOccupancy.ts` is the only authority
  // that should read this field.
  holdExpiresAt?: Date | null;
  rescheduleHistory?: any[];
  // Per H2 (hardening batch 2026-06-26): 32-char hex
  // random token generated at booking-create time. The
  // email magic link carries `?ref={bookingRef}&token={
  // lookupToken}` instead of `?ref={...}&email={...}` so
  // PII (the guest's email) never appears in URLs /
  // browser history / Vercel access logs. The lookup +
  // cancel endpoints accept either `{ bookingRef,
  // guestEmail }` (legacy) or `{ bookingRef, token }`
  // (new). See `server/handlers/bookings.ts`.
  lookupToken: string;
  source: BookingSource;
  notes: string;
  memberId: string | null;
  pointsRedeemed: number;
  pointsRedeemedValue: number;
  pointsRedeemedBy: string | null;
  pointsRedeemedAt: Date | null;
  pointsAwarded?: number;
  pendingLoyaltyPoints?: number;
  loyaltyAwardStatus?: "pending-payment" | "awarded" | "ineligible";
  pointsAwardedAt?: Date | null;
  checkedOutWithBalance?: number;
  checkedOutFolioTotal?: number;
  checkedOutCollectedTotal?: number;
  earlyCheckoutOriginalCheckOut?: Date | null;
  // Per CWB (decision #122, 2026-07-23): staff can confirm a
  // `payment-uploaded` booking with a positive balance when the
  // outstanding amount will be collected at check-in. The four
  // fields below are stamped atomically by
  // `POST /api/bookings/confirm-with-balance`. All are nullable —
  // existing bookings have all four as `null` (no migration).
  // The balance-owed indicator renders only when
  // `confirmedWithBalance != null && getCurrentBalance() > 0`.
  /** Original charge-inclusive balance at the moment the booking was confirmed with money owed. Never rewritten. */
  confirmedWithBalance?: number | null;
  /** Required staff reason (≤500 chars) for confirming with an outstanding balance. */
  confirmedWithBalanceReason?: string | null;
  /** Server timestamp set by the confirm-with-balance transaction. */
  confirmedWithBalanceAt?: Date | null;
  /** Staff UID who approved the confirm-with-balance transition. */
  confirmedWithBalanceBy?: string | null;
  hasBreakfast: boolean;
  breakfastRate: number;
  /**
   * Per CHD-10 (2026-07-31, per CVQ-01): whether children are included
   * in the breakfast charge. Snapshotted from the admin default
   * (`settings/breakfastConfig.breakfastIncludesChildrenDefault`) at
   * booking time so a later policy change never rewrites an existing
   * bill. `undefined` on legacy bookings reads as `true` for back-compat
   * (the historical "children pay the full rate" default).
   */
  breakfastIncludesChildren?: boolean | null;
  breakfastSelections?: Record<string, string>;
  breakfastServed?: Record<string, boolean>;
  /**
   * Per EXB-01 (2026-07-31): extra-bed count + snapshotted rate.
   * `extraBedCount` is the number of extra beds the guest is renting
   * (0 by default; bounded server-side by the room type's
   * `maxExtraBeds`). `extraBedRate` is the per-bed-per-night rate
   * snapshotted from the room type at booking time, so a later rate
   * change never rewrites an existing bill — same pattern as
   * `breakfastRate`. Absent fields normalize to 0 on read, the same
   * permissive pattern used for the #111 surface flags and CHD.
   */
  extraBedCount?: number;
  extraBedRate?: number;
  /**
   * Per DSC-01..05 (2026-08-01, per CVQ-06): the admin's
   * per-class discount scope at the moment this booking was
   * created. Snapshotted from `settings/hotelConfig.discountScope`
   * by `handleCreateBooking` / `handleCreateWalkin` so a later
   * scope change never rewrites an existing bill. Legacy bookings
   * (and reschedule transactions that pre-date this field) read
   * as the broad scope — byte-equivalent to pre-DSC-01 behavior.
   * Optional; absent reads as `undefined` and `normalizeDiscountScope`
   * fills in the broad default at read time.
   */
  discountScopeSnapshot?: DiscountScope | null;
  reminderSentAt: string | null;
  guestIdPhotoUrl: string | null;
  handledBy: string;
  cancellationReason: string;
  // CRL-02 (2026-08-02): full cancellation audit metadata. `cancelledAt`
  // and `cancelledBy` were already on the type (PEX-03 stamped them for
  // system expiry); CRL-02 extends stamping to the main cancel handler
  // and adds `cancellationSource` as a parallel discriminator to the
  // reason string. Legacy bookings without these fields read as `null`.
  // Source: "guest" | "staff" | "system" — see shared/utils/bookingOccupancy.ts
  // `CANCELLATION_SOURCES`. For the "guest" source `cancelledBy` is the
  // literal "guest" (no PII); for "staff" it is the staff UID; for
  // "system" it is the literal "system". All four fields are written in
  // the same Firestore transaction as the status flip, so a partial
  // failure cannot leave a half-stamped cancellation.
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationSource: CancellationSource | null;
  earlyCheckIn?: EarlyCheckInDetails | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentalChargeCategory =
  | "late-checkout"
  | "early-checkin"
  | "extra-person"
  | "damage"
  | "laundry"
  | "other";

export interface IncidentalCharge {
  id: string;
  bookingId?: string;
  bookingRef?: string;
  roomNumber?: string;
  label: string;
  amount: number;
  category: IncidentalChargeCategory;
  note: string;
  addedBy: string;
  addedAt: Date;
  voidOf: string | null;
}

export interface PaymentEntry {
  id: string;
  type: "payment" | "refund";
  amount: number;
  method: string;
  note: string;
  /** Tender-specific identifier for this individual ledger entry
   *  (e.g. GCash ref, bank trace). This is the canonical payment
   *  reference for the booking — the previous top-level
   *  `Booking.paymentReferenceNumber` (guest-entered at booking
   *  time) was retired in 2026-07-24; the reference is now
   *  exclusively staff-populated on the relevant payment ledger
   *  entry (via Record Payment / Verify & Record Payment). Not
   *  set for cash or legacy entries. */
  transactionReference?: string | null;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: Date;
}

export interface CorporateInvoice {
  id: string;
  companyName: string;
  bookingIds: string[];
  bookingRefs: string[];
  amount: number;
  status: "issued" | "paid";
  issuedAt: Date;
  issuedBy: string;
  paidAt: Date | null;
  paidBy: string | null;
}

export type IntercomSender = "guest" | "front-desk";

export interface IntercomMessage {
  id: string;
  text: string;
  sender: IntercomSender;
  guestName: string;
  timestamp: Date;
  isRead: boolean;
  isQuickRequest: boolean;
  isStoreOrder: boolean;
  orderRef?: string;
  isEarlyCheckInRequest?: boolean;
}

export interface IntercomThread {
  roomId: string;
  roomNumber: string;
  guestName: string;
  resolved: boolean;
  updatedAt: Date;
  resolvedAt?: Date | null;
  currentStayId?: string;
}

// Per Phase 12 — Notification Center (decision #120):
// persisted operational alerts for staff. One document per
// event, written **server-side via the Admin SDK** from the
// existing API routes (booking create / add-payment / confirm
// / check-in / check-out / store order placed) — guests never
// create these directly. Live-derived from the `intercoms`
// listener (B1) for chat alerts; the persisted collection
// only covers actionable operational events.
//
// `readBy` is a map keyed by staff UID; the absence of my UID
// = unread for me. The retention cron prunes docs older than
// 30 days so the collection doesn't grow unbounded on Blaze
// (the FLR-03 trap).
export type NotificationType =
  | "booking"
  | "payment"
  | "message"
  | "arrival"
  | "departure"
  | "store-order";

export type NotificationEntityType = "booking" | "storeOrder" | "intercom";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  entityType: NotificationEntityType;
  entityId: string;
  roomNumber: string | null;
  bookingRef: string | null;
  readBy: Record<string, Date | null>;
  createdBy: "system";
  createdAt: Date;
}

export type TestRunStatus = "active" | "closed" | "cleanup-in-progress" | "cleaned";

export interface TestRunManifest {
  bookings: number;
  storeOrders: number;
  affectedRooms: string[];
  affectedStockItems: string[];
}

export interface TestRunCleanupResult {
  bookingsDeleted: number;
  storeOrdersDeleted: number;
  failedItems: number;
}

export interface TestRun {
  id: string;
  name: string;
  environment: "staging" | "production";
  createdBy: string;
  createdByUid: string;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  status: TestRunStatus;
  tokenHash: string;
  manifest?: TestRunManifest | null;
  cleanupResult?: TestRunCleanupResult | null;
}

