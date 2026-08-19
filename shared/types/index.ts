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
  // Per BAR-02 (2026-08-08, per decision #203): the
  // `paymentStatus` field is no longer written to the
  // reservation header. Consumers that need it call
  // `computeReservationAggregatePaymentStatus(childStatuses)`
  // over the children at read time. Existing
  // pre-BAR-02 reservations may still carry the field in
  // Firestore (harmless dead data) — the helper ignores
  // the header and always derives from the children. The
  // Reservation type retains the field as optional `?`
  // for back-compat reads (the AdminContext mapper may
  // still surface it for pre-BAR-02 reservations), but no
  // handler writes it.
  paymentStatus?: ReservationPaymentStatus;
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

  // Per BAR-02 (2026-08-08, per decision #203): the
  // five aggregate counter fields are no longer written
  // to the reservation header. Consumers that need them
  // call `deriveReservationCounters(children)` at read
  // time. The 2026-08-08 audit verified that no
  // `where()` or `orderBy()` anywhere in the codebase
  // references any of the five fields — they are
  // render-time projections only. The fields are
  // retained as optional `?` for back-compat reads of
  // pre-BAR-02 reservations; no handler writes them.
  roomCount?: number;
  activeRoomCount?: number;
  cancelledRoomCount?: number;
  checkedInRoomCount?: number;
  checkedOutRoomCount?: number;

  // Per MRB-14 (2026-08-03, per decision #180 — proposed):
  // the per-child date spread. The header's `checkIn` /
  // `checkOut` / `numNights` are the ORIGINAL shared-dates
  // snapshot from create time (now immutable — MRB-14
  // froze them so a reschedule of one room no longer
  // mutates the "shared" range every other surface reads).
  // `actualDateRange` is the denormalized
  // MIN(children.checkIn) / MAX(children.checkOut) +
  // an `isDivergent` flag. `null` when the field has
  // never been computed (pre-MRB-14 reservations,
  // backfilled lazily on the next reschedule or
  // add-room). The header + per-child dates are
  // independent: a single-room reservation's
  // `actualDateRange` always equals the header's
  // `checkIn` / `checkOut` and `isDivergent` is `false`.
  // N=1 + legacy null-`reservationId` paths keep the
  // existing byte-equivalent behaviour (the header's
  // `checkIn` / `checkOut` are the only range the UI /
  // email surface reads).
  actualDateRange?: {
    earliestCheckIn: Date;
    latestCheckOut: Date;
    isDivergent: boolean;
  } | null;

  /** Per PEX-01 (decision #147): the unified hold window for the whole reservation. No separate large-group timer per MRB-08. `null` after the hold transitions to `payment-uploaded` or beyond. */
  holdExpiresAt: Date | null;

  /** Per decision #159: the canonical request fingerprint. The same `reservationId` + same fingerprint is an idempotent replay; a same-ID-different-fingerprint replay is a 409. Computed by `computeRequestFingerprint` at create time. Server-only — never read or set by clients. */
  requestFingerprint: string;

  createdAt: Date;
  updatedAt: Date;
  /** Staff UID for staff-created reservations, or the literal `"guest"` for self-service. Same pattern as CRL-02's `cancelledBy`. */
  createdBy: string;
  // CRL-07 (2026-08-03, per decision #173): the durable refund-
  // liability snapshot stamped onto the reservation header by
  // reservation-scope cancels (MRB-13) and by N=1 cancels (the
  // entire active surface today). Per-child cancels inside a
  // multi-room reservation stamp the snapshot onto the cancelled
  // booking instead; surviving children carry no liability.
  // Absence (or `null`) means "no liability work to do" —
  // typically because `policyRefund === 0`. See
  // `CancellationLiability` + `computeCancellationLiabilityState`
  // for the state machine.
  cancellationLiability?: CancellationLiability | null;

  // Per MRB-11 (2026-08-03, per decision #177): the
  // aggregate of every child booking's `revenueAllocation`,
  // recomputed transactionally in MRB-04 whenever a child
  // is created / rescheduled / cancelled. Reports reads
  // this for fast reservation-level revenue stream totals
  // (no need to iterate the children in the common case).
  // Absence (or `null`) means "no stored children yet" —
  // a freshly-minted reservation before the first child
  // commits. `getReservationRevenueStreams` handles this
  // case by summing whatever children are available.
  aggregateRevenueAllocation?: BookingRevenueAllocation | null;
}

/**
 * Per MRB-11 (2026-08-03, per decision #177): the
 * stored per-stream revenue allocation. Every booking
 * created after MRB-11 lands carries a snapshot of this
 * shape on the doc, computed by `computeBookingRevenueAllocation`
 * in `shared/utils/bookingFolio.ts` before the write. The
 * `roomNet` + `breakfastNet` + `addOnNet` - `deductionNet`
 * equals `totalNet` by construction; the invariant is
 * asserted at the write boundary. The reservation header
 * carries the aggregate (`Reservation.aggregateRevenueAllocation`)
 * for fast Reports reads.
 */
export interface BookingRevenueAllocation {
  /** Room rate share the guest pays (roomGross − room's pro-rated share of deductions). */
  roomNet: number;
  /** Breakfast add-on share the guest pays (breakfastGross − breakfast's pro-rated share of deductions). */
  breakfastNet: number;
  /** Add-on (extra bed + future add-ons) share the guest pays. */
  addOnNet: number;
  /** Total deductions applied (sum of senior + voucher + member + corporate code adjustments). The per-stream nets above already net this out — this is the headline "discounts given" number for reporting. */
  deductionNet: number;
  /** The final bill. Equals `booking.totalPrice` by construction. */
  totalNet: number;
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

// Per CRL-07 (2026-08-03, per decision #173): the durable
// refund-liability snapshot stamped onto the cancelled entity
// in the same transaction as the status flip. The destructive
// cancel never auto-refunds (CRL-04); the snapshot is the
// contract — `policyResult` is read-only post-cancel, the
// server + UI + future Reports (CRL-08) read it for display
// and never recompute it. `approvedAmount` is admin-controlled
// (default = `policyResult.policyRefund`, reduced only via
// the new admin-only `POST /api/bookings/cancellation-exception`
// endpoint that requires a reason). The `exception` field is
// the latest audit row (overwritten on each new exception);
// the historical trail lives in the admin notifications
// collection CRL-08 adds. `processedAmount` is NOT stored —
// it's derived from the refunds subcollection (the spec
// body: "derived from immutable ledger entries"), so Reports
// + the admin UI recompute on every render and stale counters
// never drift. The `state` is also derived — see the pure
// `computeCancellationLiabilityState` helper in
// `shared/utils/cancellation.ts`.
//
// Lives at:
//   - `reservations/{id}.cancellationLiability` for new reservations
//     when the cancel is reservation-scope (MRB-13) OR for
//     N=1 cancels (the entire active surface today).
//   - `bookings/{id}.cancellationLiability` for per-child cancels
//     inside a multi-room reservation (the surviving children
//     carry no liability — the cancelled child carries the
//     snapshot) AND for legacy null-`reservationId` bookings
//     (pre-MRB-01) where the booking IS the reservation.
//
// Absence means "no liability work to do" — typically because
// `policyRefund === 0` (no money owed, retention-only cancel)
// or because the cancel happened before CRL-07 shipped. The
// UI falls through to the pre-CRL-07 no-refund-needed view.

/** Snapshotted at cancel time. Immutable post-cancel. */
export interface CancellationPolicyResult {
  /** MIN per-room `refundPct` — the worst-case floor the staff can guarantee without an exception. A higher per-room refund (e.g. a corporate override) is visible in the per-room projection; the aggregate is the floor. */
  refundPct: number;
  /** Aggregate policy refund at the moment of cancel, in PHP. Computed as the per-room `netCollected × (refundPct / 100)` sum, rounded to 2dp. */
  policyRefund: number;
  /** Aggregate net collected at the moment of cancel, in PHP. The reservation folio's `paymentsTotal` (sign-aware, refunds are negative) for the cancelled scope. */
  netCollected: number;
  /** Aggregate retained amount at the moment of cancel, in PHP. `netCollected - policyRefund`. Money the policy does NOT refund and the hotel keeps. */
  retainedAmount: number;
  /** The cutoff window in hours at the time of cancel (the snapshotted value, NOT the live settings value). */
  cutoffHours: number;
  /** Which source the policy snapshot came from. "settings" = websiteContent has a `cancellationPolicy`; "corporate-override" = a corporate code overrode the standard policy; "legacy-fallback" = null snapshot fell back to 48h/100%/0% (per CRL-05). */
  source: "settings" | "corporate-override" | "legacy-fallback";
  /** When the policy was evaluated. Captured at the same `now` the cancel's `cancelledAt` uses (one Date per request, no skew). */
  snapshottedAt: Date;
}

/** The latest discretionary exception audit. Overwritten on each new exception. */
export interface CancellationExceptionAudit {
  /** The new `approvedAmount` after this exception. The previous `approvedAmount` is `policyResult.policyRefund` for the first exception, or the prior `exception.approvedAmount` for subsequent ones. */
  approvedAmount: number;
  /** Required, capped at 500 chars. Why the admin is reducing the approved amount. */
  reason: string;
  /** Admin UID — required (the exception is admin-only). */
  approvedBy: string;
  /** When the exception was recorded. */
  approvedAt: Date;
}

/** The durable liability snapshot stamped at cancel time. */
export interface CancellationLiability {
  policyResult: CancellationPolicyResult;
  /** Admin-controlled refund cap. Defaults to `policyResult.policyRefund` at cancel time. Reduced only via `POST /api/bookings/cancellation-exception`. NEVER exceeds `policyResult.policyRefund` (an exception can only reduce, never increase). */
  approvedAmount: number;
  /** The latest exception audit. `null` when no exception has been applied. */
  exception: CancellationExceptionAudit | null;
}

/** The five derived states. NEVER stored — computed by `computeCancellationLiabilityState` from the stored liability + the derived `processedAmount`. */
export type CancellationLiabilityState =
  /** `policyRefund === 0` — no money to refund. The hotel keeps everything the guest paid (or the guest paid nothing). No admin action required. */
  | "not-required"
  /** `approvedAmount < policyRefund` — admin applied an exception to reduce the refund. The retention `policyRefund - approvedAmount` is the "extra we kept beyond what the policy gave". Includes the fully-processed exception case (`processedAmount >= approvedAmount`). */
  | "retained"
  /** `approvedAmount === policyRefund` AND `processedAmount === 0` — full policy refund approved, nothing refunded yet. Admin needs to record the refund. */
  | "pending-processing"
  /** `0 < processedAmount < approvedAmount` — some refunds recorded, more to go. */
  | "partially-processed"
  /** `processedAmount >= approvedAmount` — fully refunded. Lifecycle complete. */
  | "processed";

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
  // Per FOL-01 (2026-08-06, off-roadmap bug fix, decision #197):
  // the durable "payment was verified" signal. Stamped by
  // `handleVerifyAndRecordPayment` (and `handleMarkPaymentConfirmed`
  // / `handleConfirmBookingWithBalance`) on the full-payment
  // transition, then NEVER cleared by any other lifecycle handler.
  // Differs from `status === "payment-confirmed"` in that
  // `paymentConfirmedAt` survives the subsequent transitions to
  // `confirmed` / `checked-in` / `checked-out` — so a confirmed
  // booking whose payment was verified at some earlier point
  // still reads as "verified" in the admin UI. The admin
  // `isPaymentVerified()` helper in
  // `shared/utils/paymentVerification.ts` is the single source of
  // truth for that read; the per-render inline checks against
  // `status === "payment-confirmed"` are the bug this field
  // fixes. `null` for legacy bookings and any booking whose
  // payment has not been staff-verified yet. The server writes
  // it as a `Date`; the admin mapper hydrates it as an ISO string
  // (the `parseDateTimeString` convention).
  paymentConfirmedAt?: Date | null;
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
   * Per EXB-12 (2026-08-06, per decision #199): whether the
   * guest opted in to breakfast for the extra-bed occupant(s).
   * When `true`, all `extraBedCount` beds in this room are
   * counted toward the breakfast total (priced as
   * `breakfastRate × extraBedCount × nights`). Snapshotted
   * from the cart at booking time. The server validates that
   * `extraBedBreakfast` can only be `true` when `extraBedCount > 0`.
   * Defaults to `false` (no breakfast for extra beds).
   */
  extraBedBreakfast?: boolean;
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
  // CRL-07 (2026-08-03, per decision #173): the durable refund-
  // liability snapshot stamped onto per-child cancels (a single
  // room in a multi-room reservation, or any legacy null-
  // `reservationId` booking). Reservation-scope cancels (MRB-13)
  // stamp the snapshot onto the reservation header instead, so
  // the per-child row is `undefined` for that path. Absence
  // (or `null`) means "no liability work to do" — typically
  // because `policyRefund === 0`. See `CancellationLiability` +
  // `computeCancellationLiabilityState` for the state machine.
  cancellationLiability?: CancellationLiability | null;
  earlyCheckIn?: EarlyCheckInDetails | null;

  // Per MRB-11 (2026-08-03, per decision #177): the
  // stored revenue allocation snapshotted at create time
  // (and recomputed on reschedule). The four per-stream
  // nets sum to `totalPrice` by construction:
  //   `roomNet + breakfastNet + addOnNet - deductionNet === totalNet`
  // where `totalNet === booking.totalPrice`. The invariant is
  // asserted at the create-write boundary (see
  // `assertBookingRevenueAllocationInvariant` in
  // `shared/utils/bookingFolio.ts`). Absence (or `null`)
  // means "pre-MRB-11 booking" — the helper
  // `getBookingRevenueStreams` falls back to the legacy
  // proportional split and tags the export row
  // `"allocation: legacy-heuristic"`. The field-on-entity
  // is simpler than a separate `revenueAllocations/` collection
  // (rejected in #177) and the `rateBreakdown` already carries
  // the per-line gross + deduction data needed to compute it.
  revenueAllocation?: BookingRevenueAllocation | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Per MRB-11 (2026-08-03, per decision #177): the
 * stored per-stream revenue allocation. Every booking
 * created after MRB-11 lands carries a snapshot of this
 * shape on the doc, computed by `computeBookingRevenueAllocation`
 * in `shared/utils/bookingFolio.ts` before the write. The
 * `roomNet` + `breakfastNet` + `addOnNet` − `deductionNet`
 * equals `totalNet` by construction; the invariant is
 * asserted at the write boundary. The reservation header
 * carries the aggregate (`Reservation.aggregateRevenueAllocation`)
 * for fast Reports reads.
 */
export interface BookingRevenueAllocation {
  /** Room rate share the guest pays (roomGross − room's pro-rated share of deductions). */
  roomNet: number;
  /** Breakfast add-on share the guest pays (breakfastGross − breakfast's pro-rated share of deductions). */
  breakfastNet: number;
  /** Add-on (extra bed + future add-ons) share the guest pays. */
  addOnNet: number;
  /** Total deductions applied (sum of senior + voucher + member + corporate code adjustments). The per-stream nets above already net this out — this is the headline "discounts given" number for reporting. */
  deductionNet: number;
  /** The final bill. Equals `booking.totalPrice` by construction. */
  totalNet: number;
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

export type IntercomSender = "guest" | "front-desk" | "system";

// Per `feat/call-history-messages`: call lifecycle events now
// surface as system messages in the chat thread so the front
// desk has a permanent record. The three outcomes map directly
// to the three values staff see on screen:
//
//   "call-answered" — staff accepted via Accept Voice;
//                     duration is recorded
//   "call-missed"   — call went ringing → ended without anyone
//                     connecting (guest hung up, network drop,
//                     or the call timed out before staff picked up)
//   "call-declined" — staff explicitly pressed Ignore
//
// All three produce a `intercoms/{roomNumber}/messages` doc with
// `sender: "system"`, formatted `text`, and (for answered) call-
// duration metadata. Future-proofing: an undefined messageType
// means the doc is a regular guest/staff chat message — old clients
// continue to render the text body normally.
export type IntercomMessageType =
  | "call-answered"
  | "call-missed"
  | "call-declined"
  | undefined;

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
  // Set when sender === "system" — drives the muted / italic
  // render branch in IntercomChatPanel. Undefined for normal
  // guest and staff chat messages.
  messageType?: IntercomMessageType;
  // When messageType === "call-answered": the Firestore server
  // timestamp at which the call connected (i.e. when the staff
  // accepted and the audio stream went live).
  callStartedAt?: Date;
  // When messageType === "call-answered": the call duration in
  // seconds (connected → hung up). When messageType ===
  // "call-missed": how long the call rang before it ended.
  // Computed at write time from `Date.now()` on the dispatcher's
  // clock, not from Firestore server time, because the
  // duration is a client-relative measurement that doesn't need
  // a server round-trip to compute.
  callDuration?: number;
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
  | "store-order"
  // Per CRL-08 (2026-08-03, per decision #174):
  // the cancellation-refund surface. Fires from
  // `handleCancelBooking` when a destructive cancel
  // stamps a non-null `cancellationLiability` (the
  // desk sees a new "money to process" alert) and
  // from `handleAddRefund` when a successful commit
  // changes the liability state (the desk sees the
  // lifecycle progressed — pending → partial → done,
  // or pending → retained). The bell panel picks it
  // up via the existing `onSnapshot` listener; the
  // persistent trail lives in the `notifications`
  // collection (per decision #120). The
  // `cancellationLiability` field on the cancelled
  // entity is the canonical source — the
  // notification is best-effort and can be
  // reconstructed from the stored snapshot + the
  // refunds subcollection.
  | "cancellation-refund";

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


// Per CRL-06 (2026-08-02): the cancellation preview
// response. The new `POST /api/bookings/cancel-preview`
// endpoint returns this shape — same `kind` discriminator
// as the lookup endpoint (`"single"` for N=1 / legacy
// per-child, `"reservation"` for N>1). The endpoint is
// rate-limited and reads the same `ref + (email | token)`
// credential as the destructive cancel; it never writes
// anything. The two scopes share the policy-derived
// `refundPct` / `isBeforeCutoff` / `cutoffTimeMs` /
// `hoursRemaining` fields — the staff + guest modals
// render the breakdown before the user taps confirm.
//
// Financial fields (per room + aggregate):
// - `subtotal`: the room's `totalPrice` (or the sum
//   across cancellable children for the reservation).
// - `netCollected`: the room's pro-rata share of the
//   reservation's collected payments (sign-aware;
//   refunds counted as negative). For a legacy
//   per-booking path this is the booking's own net.
// - `policyRefund`: `netCollected * refundPct` (a
//   refund cannot exceed money the guest paid).
// - `retainedAmount`: `netCollected - policyRefund`
//   (the collected portion the hotel keeps under
//   the policy; unpaid balance is not "retained").
// - `staffProcessingRequired`: `true` when the
//   policy refunds money AND the guest has paid
//   (so a staff action is required to issue the
//   refund). The destructive cancel never
//   auto-refunds per CRL-04.
//
// The `rooms[]` array is only present on
// `kind: "reservation"`; it carries the per-room
// preview the staff can show alongside the aggregate.
// The `policyText` echoes the snapshotted policy
// the reservation captured at create time
// (CRL-05, decision #165) so the modal can render
// the "no refund is issued automatically" callout
// next to the breakdown.
export interface CancellationPreviewRoom {
  bookingId: string;
  bookingRef: string;
  position: number | null;
  roomType: string;
  status: string;
  subtotal: number;
  netCollected: number;
  policyRefund: number;
  retainedAmount: number;
  refundPct: number;
  isBeforeCutoff: boolean;
  hoursRemaining: number;
}

export interface CancellationPreview {
  kind: "single" | "reservation";
  scope: "room" | "reservation";
  bookingRef: string;
  reservationRef: string | null;
  // Per-scope breakdown — for `"single"` the `room` field
  // is populated and `rooms` is `null`; for `"reservation"`
  // `rooms` carries the per-room projections and `room` is
  // `null`. The aggregate fields are populated for both
  // kinds (a `"single"` preview's aggregate == its `room`).
  room: CancellationPreviewRoom | null;
  rooms: CancellationPreviewRoom[] | null;
  subtotal: number;
  netCollected: number;
  policyRefund: number;
  retainedAmount: number;
  staffProcessingRequired: boolean;
  // Policy fields (shared across scope — the snapshot
  // comes from the looked-up booking's `cancellationPolicySnapshot`).
  cutoffHours: number;
  cutoffTimeMs: number;
  hoursRemaining: number;
  isBeforeCutoff: boolean;
  refundPct: number;
  policyText: string;
  policySource: "settings" | "corporate-override" | "legacy-fallback";
}

// Per-staff intercom audio routing — see `plan/features/INTERCOM-AUDIO-ROUTING.md`.
// The Web Audio API doesn't support per-stream output device selection
// portably (Safari/Firefox don't), so routing is implemented by attaching
// a `deviceId` to the HTMLMediaElement (`<audio>`) used for each audio
// surface. The shape is intentionally narrow: one boolean master toggle +
// two device IDs, all optional, all default to "system default output".
export interface AudioRouting {
  enabled: boolean;
  // Output device for the call's WebRTC remote stream. Typically a USB
  // headset. `null` = system default output.
  callOutputDeviceId: string | null;
  // Output device for notification sounds (incoming chat + incoming call
  // ringtones) and the IntercomInbox unread-message chime. Typically the
  // built-in speaker so the operator notices new activity even while
  // wearing a headset. `null` = system default output.
  ringtoneOutputDeviceId: string | null;
  updatedAt?: Date;
}
