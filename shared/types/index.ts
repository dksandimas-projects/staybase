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
/**
 * The Firestore `Timestamp` value type. The shared types
 * use a `Timestamp | string` union (see the BR-01
 * breakfast types below) for back-compat: writes may
 * stamp a `Timestamp` (server-side, via
 * `FieldValue.serverTimestamp()`) while reads may hydrate
 * to an ISO string (admin mappers + the public site's
 * `usePublicSiteContent`). Local to this file because
 * `firebase-admin` / `firebase` are not workspace
 * dependencies of `@spark-inn/shared` (the shared
 * package is intentionally Firebase-free per the
 * backend's no-Firebase-Cloud-Functions rule).
 */
export type Timestamp = { seconds: number; nanoseconds: number };
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
  source?: "guest-request" | "staff-granted";
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
  batchId?: string | null;
}

export interface StaffInventoryHold {
  id: string;
  roomIds: string[];
  roomNumbers: string[];
  startDate: string;
  endDate: string;
  status: "active" | "consumed" | "released" | "expired";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
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

  // Per SR-01..05 (2026-10-12): the guest-captured
  // special-requests fields. `additionalPreferences` is
  // an array of admin-configured preference keys
  // (cross-referenced against
  // `settings/hotelConfig.bookingPreferences[].value`).
  // `additionalRequest` is the free-text payload
  // (≤500 chars per `ADDITIONAL_REQUEST_MAX_LENGTH`).
  // `expectedArrivalTime` is the `HH:MM` string in the
  // hotel timezone, or `null` for "I don't know".
  // All three are optional for back-compat reads of
  // pre-SR reservations (the AdminContext hydration
  // treats absent values as their empty defaults).
  // The per-room `bedSetup` snapshot lives on each
  // child `Booking.bedSetup`, since different rooms may
  // carry different set-ups (a multi-room reservation
  // with a Twin + a Double would pick twin-beds for
  // one and large-bed for the other).
  additionalPreferences?: string[];
  additionalRequest?: string;
  expectedArrivalTime?: string | null;

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
  // Per feat/staff-special-requests-capture (2026-08-21):
  // `specialRequests` is a STAFF-ONLY closed-loop field. The
  // public /book form no longer collects the input (see
  // feat/special-requests-redirect, commit 78a79f7); the
  // front desk captures requests received via email or phone
  // into the booking doc from the booking drawer, the walk-in
  // modal, or the calendar-create modal. The two metadata
  // fields below track when the staff last touched the value
  // and which staff uid did — useful when the next shift opens
  // the drawer and wants context on the request's freshness.
  specialRequests: string;
  specialRequestsUpdatedAt: string | null;
  specialRequestsUpdatedBy: string | null;
  // Per SR-01..05 (2026-10-12): the per-room
  // bed-set-up snapshot. Guest-captured at booking
  // time (the public Step 2 radios mirror the
  // admin-configured catalog for the picked room
  // type). `null` when the guest left the radios
  // untouched. Server-validated against the room
  // type's `bedSetupValues` subset. The per-room
  // shape allows a multi-room reservation with two
  // different types to carry distinct choices
  // (Twin picks twin-beds, Double picks large-bed).
  bedSetup?: string | null;
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
  // In-flow hold (Steps 2 + 3 countdown banner). The
  // `inFlowHoldId` is the link back to the
  // `bookingHolds/{id}` doc that was consumed by the
  // create transaction. The `inFlowHoldMinutes` is a
  // snapshot of `IN_FLOW_HOLD_MINUTES` at create time so
  // future reports can attribute expired holds to a
  // specific window even if the constant changes. Both
  // fields are null for pre-hold-banner callers and for
  // walk-in bookings (the desk has the keys — no in-flow
  // hold is stamped). See
  // `shared/utils/bookingInFlowHold.ts` + the
  // `plan/features/BOOKING-FLOW.md §In-flow hold` spec.
  inFlowHoldId?: string | null;
  inFlowHoldMinutes?: number | null;
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
  /**
   * Per BR-01 (Phase 13 — Breakfast Redesign, decision #231,
   * 2026-10-12) + BR-08 (decision #238, 2026-10-14 — close-out):
   * per-meal-per-guest slot map. Each entry carries
   * the snapshotted meal triple (mealId / mealName / price)
   * + audit metadata. The slot key format is preserved from
   * the legacy `Record<string, string>` shape (`yyyy-mm-dd-guest-n`)
   * so existing views keep rendering until they migrate. Absent
   * on bookings that never had breakfast ordered; an empty `{}`
   * after a full remove. Cancelled meals are flagged via
   * `removedAt !== null` (and excluded from `breakfastTotal`).
   *
   * Replaces the legacy flat-rate `hasBreakfast: boolean` +
   * `breakfastRate: number` + `breakfastIncludesChildren:
   * boolean` + `extraBedBreakfast: boolean` shape — those
   * fields were deleted from the type and from the create
   * path in BR-08.
   */
  breakfastSelections?: Record<string, BreakfastSelectionEntry>;
  /**
   * Per BR-01: per-slot served record. The legacy
   * `Record<string, boolean>` shape is replaced with
   * `Record<string, BreakfastServedEntry>` to carry the
   * audit metadata (`servedBy`, `servedAt`, optional
   * `unservedAt` / `unservedBy` for the grace-window
   * un-mark).
   */
  breakfastServed?: Record<string, BreakfastServedEntry>;
  /**
   * Per BR-01: the denormalized breakfast total. Sum of every
   * non-cancelled entry's snapshotted `price`. Recomputed by
   * the server on every `breakfastSelections` write — never
   * client-written (per GOTCHAS §Firebase). The single source
   * of truth for the recompute is `recomputeBreakfastTotal`
   * in `shared/utils/breakfastTotal.ts`. `0` for bookings
   * that never had breakfast.
   */
  breakfastTotal?: number;
  /**
   * Per BR-01: replaces the legacy `hasBreakfast: boolean` for
   * read sites that just need "is there any breakfast on this
   * booking". `true` when `breakfastSelections` has at least
   * one non-cancelled entry. Maintained server-side alongside
   * `breakfastTotal` so the read is O(1).
   */
  hasAnyBreakfast?: boolean;
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

  // ------------------------------------------------------------------
  // BR-12 — Other Add-Ons (Phase 14, decision #245, 2026-10-14)
  // ------------------------------------------------------------------
  // Additive on top of the BR-01 breakfast fields — the breakfast
  // shape is frozen per BR-08 (decision #238). Other add-ons use
  // their own per-day × per-add-on selection map (NOT a per-guest
  // slot — add-ons are quantity-based, not guest-slot-based).
  //
  // `otherAddOnSelections` is keyed by `yyyy-mm-dd` (the service
  // date). The value is a flat array of `OtherAddOnSelectionEntry`
  // items — one per add-on type on that date. The composite key
  // `${date}-${addOnId}` lives in the entry's `selectionKey`
  // mirror field so audit + refund lookups don't have to scan
  // arrays.
  //
  // `otherAddOnTotal` is the denormalized total recomputed by
  // `recomputeOtherAddOnTotal(selections)` on every write —
  // source of truth is the helper, `0` for bookings that never
  // had add-ons.
  //
  // `hasAnyOtherAddOns` mirrors `hasAnyBreakfast` so the read
  // sites that just need "is there any add-on on this booking"
  // are O(1).
  //
  // BR-13 refactor note: when a second add-on TYPE lands
  // (seaport), this shape stays — the BR-13 refactor pulls
  // the common patterns out without touching the booking
  // schema.
  // ------------------------------------------------------------------
  /**
   * `yyyy-mm-dd` → `OtherAddOnSelectionEntry[]`. Absent on
   * pre-BR-12 bookings; reads as `null` per `normalizeBooking`.
   */
  otherAddOnSelections?: Record<string, OtherAddOnSelectionEntry[]> | null;
  /** Denormalized sum, PHP. Recomputed by `recomputeOtherAddOnTotal`. */
  otherAddOnTotal?: number;
  /** O(1) "is there any other add-on on this booking" flag. */
  hasAnyOtherAddOns?: boolean;
}

// ----------------------------------------------------------------------------
// Per BR-01 (Phase 13 — Breakfast Redesign, decision #231,
// 2026-10-12): the new meal-based breakfast shapes.
//
// The legacy flat-rate toggle (`Booking.hasBreakfast: boolean` +
// `Booking.breakfastRate: number` +
// `PublicRoomSelection.hasBreakfast: boolean`) is replaced
// by a per-meal catalog (`BreakfastMeal[]`), a per-slot
// snapshot map (`breakfastSelections: Record<key,
// BreakfastSelectionEntry>`), and a per-slot served map
// (`breakfastServed: Record<key, BreakfastServedEntry>`).
//
// `Timestamp | string` is the existing codebase's
// back-compat pattern for Firestore Timestamp-on-write +
// string-on-read values (see `CancellationPolicySnapshot`
// + `Booking.revenueAllocation` for similar unions). The
// client never writes `Timestamp` directly — server
// writes via `FieldValue.serverTimestamp()` and the
// admin mapper hydrates to ISO strings on read.
// ----------------------------------------------------------------------------

/**
 * One meal in the breakfast catalog. `id` is the
 * kebab-case key referenced by
 * `BreakfastSelectionEntry.mealId`; immutable once a
 * booking snapshots it (per spec §Decisions Locked #9).
 * `price` is the live catalog price in PHP. The booking
 * snapshots its own copy at order time so later edits
 * never rewrite existing bills. `isActive: false` hides
 * the meal from new orders but keeps existing snapshots
 * visible (the view appends "(no longer offered)" to the
 * meal name per the spec).
 */
export interface BreakfastMeal {
  id: string;
  name: string;
  /** Optional marketing copy (max 200 chars). Free-text today; per-meal dietary flags are a follow-up (Open Item #2). */
  description: string;
  /** PHP; >= 0. The booking snapshots its own copy at order time. */
  price: number;
  /** `false` hides the meal from new order UIs; existing snapshots remain visible. */
  isActive: boolean;
  /** Asc; drives the meal-picker sort. */
  displayOrder: number;
  /**
   * Per MBUX-04 (decision #256, 2026-10-15): optional guest-safe
   * download URL for a meal thumbnail. OMITTED entirely (not empty
   * string) when no image is set, so "no image" is unambiguous.
   *
   * Deliberately NOT snapshotted onto a booking. `breakfastSelections`
   * entries are built field-by-field (`mealId` + `mealName` + `price`),
   * so a catalog image can never leak into, or later mutate, a
   * historical booking or financial record — see
   * `BOOKING-MOBILE-UX.md §Snapshot invariant`.
   */
  imageUrl?: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

/**
 * The settings doc shape at
 * `settings/breakfastConfig`. `cutoffTime` is `HH:MM` 24h
 * (default `20:00`); `cutoffTimezone` is IANA (falls back
 * to the hotel-config timezone, default `Asia/Manila`).
 * `frontDeskOverrideEnabled: false` is the strict-policy
 * switch — when off, staff cannot override the cutoff for
 * walk-ins / late changes. `defaultMealInstructions` is
 * shown in Step 2, Manage Booking, and the booking review.
 */
export interface BreakfastConfig {
  /** Master toggle. When `false`, the Step 2 section + Manage Booking + the booking-drawer breakfast tab all hide. */
  isEnabled: boolean;
  /**
   * Per BR-10 (decision #244 reserved, 2026-10-14 — Phase 14):
   * the cut-off enforcement toggle. Default `true`. When `false`,
   * `computeBreakfastCutoffState` short-circuits to `isLocked: false`
   * for every date — guests can edit breakfast meals right up
   * until the morning of service, and the staff override flow
   * becomes a no-op (no date ever locks). The `cutoffTime` +
   * `cutoffTimezone` settings stay on the doc so flipping the
   * toggle back on doesn't lose the configured time.
   */
  cutoffsEnabled: boolean;
  /** `HH:MM` 24h, default `"20:00"`. */
  cutoffTime: string;
  /** IANA timezone, defaults to the hotel-config timezone. */
  cutoffTimezone: string;
  /** When `false`, staff cannot override the cutoff for any write. */
  frontDeskOverrideEnabled: boolean;
  /**
   * Per decision #231 + open item #5: how long after a meal is
   * marked `served` can staff un-serve it without an override
   * reason. After this window, un-serve requires a reason. Configurable
   * in admin Settings; default 15 minutes. Range 0..60.
   */
  servedGraceMinutes: number;
  /** Multi-line text shown to guests in Step 2 + Manage Booking + booking review. */
  defaultMealInstructions: string;
  meals: BreakfastMeal[];
  updatedAt: Timestamp | string;
  /** Staff UID who last edited the config. */
  updatedBy: string;
}

/**
 * One per-meal-per-guest slot on a booking. The
 * `mealId` + `mealName` + `price` triple is the snapshot
 * at order time; later catalog edits never rewrite it.
 * `removedAt` / `removedBy` track cancellations (a paid
 * removal opens a refund liability in BR-06).
 * `overrideCutoff: true` + `overrideReason` track late
 * changes from staff (audit trail for the kitchen's
 * "Late changes" column).
 */
export interface BreakfastSelectionEntry {
  /** Snapshotted `BreakfastMeal.id`. */
  mealId: string;
  /** Snapshotted name; views may append " (no longer offered)" when the catalog meal is now `isActive: false`. */
  mealName: string;
  /** Snapshotted price (PHP). */
  price: number;
  addedAt: Timestamp | string;
  /** Staff UID or the literal `"guest"`. */
  addedBy: string;
  lastModifiedAt: Timestamp | string;
  lastModifiedBy: string;
  /** Non-null when the meal was cancelled (before / after the cutoff). */
  removedAt: Timestamp | string | null;
  removedBy: string | null;
  /** `true` for any staff write that crossed the cutoff. */
  overrideCutoff: boolean;
  /** Required when `overrideCutoff === true`; `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH` chars min. */
  overrideReason: string | null;
}

/**
 * The served record per slot. `servedBy` + `servedAt`
 * capture the staff mark; `unservedAt` + `unservedBy`
 * capture the grace-window un-mark (within
 * `BreakfastConfig.servedGraceMinutes`, default 15).
 * Beyond the grace window the un-serve writes to the
 * `BreakfastAuditEntry` instead of mutating this record.
 */
export interface BreakfastServedEntry {
  servedAt: Timestamp | string;
  servedBy: string;
  unservedAt: Timestamp | string | null;
  unservedBy: string | null;
}

/**
 * The audit subcollection entry at
 * `bookings/{id}/breakfastAudit/{auditId}`. The `action`
 * enum distinguishes the regular lifecycle (add / change /
 * remove / serve / unserve) from the override variants
 * (override-add / override-change / override-remove). The
 * kitchen list's "Late changes" column filters on
 * `occurredAfterCutoff === true` — a separate flag from
 * the per-slot `overrideCutoff` (the override-marker
 * stamped onto `BreakfastSelectionEntry`).
 */
export interface BreakfastAuditEntry {
  id?: string;
  action:
    | "add"
    | "change"
    | "remove"
    | "serve"
    | "unserve"
    | "override-add"
    | "override-change"
    | "override-remove";
  /** `yyyy-mm-dd-guest-n` (the same slot-key shape as `breakfastSelections`). */
  slotKey: string;
  /** Snapshotted meal triple; `null` on remove / unserve. */
  mealSnapshot: { mealId: string; mealName: string; price: number } | null;
  /** Staff UID or the literal `"guest"`. */
  actorUid: string;
  actorRole: "guest" | "front-desk" | "admin";
  /** Required for any `override-*` action; `null` otherwise. */
  reason: string | null;
  occurredAt: Timestamp | string;
  /** `true` when `now > cutoffForDate(slotKey.date)` at the moment of the write. */
  occurredAfterCutoff: boolean;
}

/**
 * Per BR-01 (decision #231 §OnsitePayment extension): the
 * refund-context blob stamped onto a
 * `bookings/{id}/refunds/{refundId}` doc when the refund
 * is for a removed breakfast meal (vs. the legacy
 * cancellation refund). The `category` discriminator is
 * added to `OnsitePayment` (defined in the admin app's
 * `AdminContext`) — this interface is the
 * `breakfastRefundContext` payload that follows the
 * discriminator. Mirror values from
 * `BreakfastSelectionEntry` so a later catalog price
 * change never rewrites the refund amount.
 *
 * NOTE: BR-01 is shared-only by ticket scope. The
 * `OnsitePayment` interface itself lives in
 * `admin-app/src/context/AdminContext.tsx` (per the
 * pre-existing layout) — the admin type gains the
 * `category: "cancellation" | "breakfast"` field +
 * `breakfastRefundContext: BreakfastRefundContext | null`
 * in the same BR-01 follow-up. This file defines the
 * payload shape; the admin-app extension is tracked
 * separately.
 */
export interface BreakfastRefundContext {
  mealId: string;
  slotKey: string;
  mealName: string;
  priceSnapshot: number;
}

// ============================================================================
// BR-12 — Other Add-Ons (Phase 14, 2026-10-14, decision #245 reserved)
// ============================================================================
//
// v1 ships the "Airport transfer" catalog and readies the
// schema for the BR-13 generic-add-on refactor that will
// pull out common patterns when a second add-on TYPE (e.g.
// seaport transfer with its own booking-time semantics)
// lands. The data model is intentionally close to the
// breakfast shape (per-day × per-guest selections,
// denormalized total, audit subcollection, refund
// context) but lives in its own Firestore collection +
// separate booking fields — *no* shared base type, per
// the BR-12 brief ("DO NOT add a generic-add-on abstract
// base class"). The BR-13 refactor is expected to be a
// non-breaking extraction, not a schema migration.

/**
 * One entry in the admin-managed add-on catalog at
 * `addOns/{addOnId}`. v1 only ships
 * `unit: "per-person"` (airport transfer is per-person),
 * but `unit: "per-stay"` is reserved for the BR-13
 * refactor — the spec accepts the union now to avoid a
 * future schema migration.
 *
 * `cutoffHoursBeforeCheckIn` is the per-add-on lead
 * window (default 24h). The shared
 * `computeOtherAddOnCutoffState` helper computes
 * `cutoffAt = checkInDate - cutoffHoursBeforeCheckIn`.
 * When `isEnabled === false`, the helper short-circuits
 * to `isLocked: true, reasonOrCutoff: "addons-disabled"`
 * — same UX as breakfast's `cutoffsEnabled: false`.
 */
export interface AddOn {
  id: string;
  name: string;
  description: string;
  /** PHP; >= 0. The booking snapshots its own copy at order time (the `priceSnapshot` on the entry). */
  price: number;
  /** v1 only uses `"per-person"`; `"per-stay"` is reserved for the BR-13 refactor. */
  unit: "per-person" | "per-stay";
  /** Master per-add-on switch. `false` hides the add-on from new orders + locks existing bookings for new writes. */
  isEnabled: boolean;
  /** Cut-off lead time in hours before each check-in date (default 24). */
  cutoffHoursBeforeCheckIn: number;
  /** Asc; drives the catalog sort. */
  displayOrder: number;
  updatedAt: Timestamp | string;
  updatedBy: string;
}

/**
 * Per-day × per-add-on selection entry on a booking.
 * Mirrors `BreakfastSelectionEntry` exactly: the
 * `priceSnapshot` + `nameSnapshot` triple is frozen at
 * order time so a later catalog price edit never
 * rewrites existing bills; `quantity` is the count of
 * guests using the add-on that day (default = the
 * booking's total guest count, editable 0..guest count).
 *
 * `cutoffHoursBeforeCheckInSnapshot` is frozen so a
 * later admin edit to the catalog lead time never
 * rewrites the per-booking lock (the BR-13 refactor
 * may move to a hotel-wide `otherAddOnCutoffsEnabled`
 * toggle, which is why this is captured separately from
 * the live catalog).
 */
export interface OtherAddOnSelectionEntry {
  addOnId: string;
  /** Snapshotted `AddOn.name`. */
  nameSnapshot: string;
  /** Snapshotted price (PHP, per unit). */
  priceSnapshot: number;
  /** Number of guests using the add-on that day. 0 means "removed but keep history". */
  quantity: number;
  /** Snapshotted `unit` so the receipt stays correct even if the catalog later flips. */
  unitSnapshot: "per-person" | "per-stay";
  addedAt: Timestamp | string;
  addedBy: string;
  lastModifiedAt: Timestamp | string;
  lastModifiedBy: string;
  removedAt: Timestamp | string | null;
  removedBy: string | null;
  /** Snapshotted at first add. */
  cutoffHoursBeforeCheckInSnapshot: number;
}

/**
 * Audit subcollection entry at
 * `bookings/{id}/otherAddOnAudit/{auditId}`. Mirrors
 * `BreakfastAuditEntry`. `occurredAfterCutoff === true`
 * drives any "Late changes" UI surface (BR-12 v1 has
 * none — the add-ons are served at check-in/by-arrival
 * and don't need a kitchen list).
 */
export interface OtherAddOnAuditEntry {
  id?: string;
  action: "add" | "change" | "remove" | "mark-served" | "override-add" | "override-change" | "override-remove";
  /** `yyyy-mm-dd-{addOnId}` — composite per-day × per-add-on key (analog of breakfast's slotKey). */
  selectionKey: string;
  /** Snapshotted add-on triple; `null` on remove. */
  addOnSnapshot: { addOnId: string; name: string; price: number; quantity: number } | null;
  actorUid: string;
  actorRole: "guest" | "front-desk" | "admin";
  reason: string | null;
  occurredAt: Timestamp | string;
  occurredAfterCutoff: boolean;
}

/**
 * Refund-context blob stamped onto a
 * `bookings/{id}/refunds/{refundId}` doc when the
 * refund is for a removed add-on selection. Mirror
 * values from `OtherAddOnSelectionEntry` so a later
 * catalog price change never rewrites the refund amount.
 * Mirrors `BreakfastRefundContext` — kept in a separate
 * type (not a discriminated union) so the BR-13
 * refactor can normalize without a breaking change.
 */
export interface OtherAddOnRefundContext {
  addOnId: string;
  selectionKey: string;
  addOnName: string;
  priceSnapshot: number;
  quantitySnapshot: number;
}

/**
 * Per BR-08 (decision #238, 2026-10-14 — close-out):
 * `PublicRoomSelection` is deleted from the type. The
 * legacy flat-rate `hasBreakfast: boolean` +
 * `breakfastIncludesChildren: boolean` +
 * `extraBedBreakfast: boolean` fields never appear in
 * the BR-03+ create payload (the per-room selection is
 * the Step 1 shape; meals are picked in Step 2). The
 * `@deprecated` JSDoc above is kept as an audit trail
 * for the BR-08 close-out — see
 * `plan/features/BREAKFAST.md §Decisions Locked`
 * (decision 4 — children + extra-bed occupants are
 * ordinary meal slots, and decision 5 — Step 1 carries
 * no breakfast data).
 */

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
// desk has a permanent record. The four outcomes map directly
// to the values staff see on screen:
//
//   "call-answered" — staff accepted via Accept Voice;
//                     duration is recorded
//   "call-missed"   — call went ringing → ended without anyone
//                     connecting (guest hung up, network drop,
//                     or the call timed out before staff picked up)
//   "call-declined" — staff explicitly pressed Ignore
//   "call-failed"   — staff pressed Accept, the claim transaction
//                     committed, but the post-claim audio plumbing
//                     failed (getUserMedia denied, createAnswer
//                     failed, writeDoc rejected). The staff TRIED
//                     to answer — the chat thread says so
//                     explicitly so the audit trail is accurate.
//                     Per decision #217 (2026-08-19).
//
// All four produce a `intercoms/{roomNumber}/messages` doc with
// `sender: "system"`, formatted `text`, and (for answered) call-
// duration metadata. Future-proofing: an undefined messageType
// means the doc is a regular guest/staff chat message — old clients
// continue to render the text body normally.
export type IntercomMessageType =
  | "call-answered"
  | "call-missed"
  | "call-declined"
  | "call-failed"
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
  // When messageType === "call-failed": how long the call rang
  // before the post-claim audio plumbing failed (typically
  // <500ms). Computed at write time from `Date.now()` on the
  // dispatcher's clock, not from Firestore server time, because
  // the duration is a client-relative measurement that doesn't
  // need a server round-trip to compute.
  callDuration?: number;
  // Per decision #206 (2026-08-19): the staff display name
  // attributed to the `call-answered` system message — mirrors
  // the `calls/{roomId}.acceptedBy.name` field that the
  // `runTransaction` claim in `AdminContext.acceptCall` writes
  // when the first staff to click Accept commits. `null` on
  // pre-#206 messages, on `call-missed` / `call-declined` (no
  // claim committed), or when the staff member's display name
  // was unavailable at message-write time. The free-text `text`
  // field still carries the human-readable line ("Call answered
  // by Maria at 2:14 PM · 3m 22s") for legacy readers; this
  // structured field lets future renderers style the name
  // distinctly without parsing the line.
  callAnsweredByName?: string | null;
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
  | "cancellation-refund"
  // Per EC-01 (2026-08-21): the early-checkin-request surface.
  // Fires from the guest-app
  // `/api/email?action=early-checkin-request` handler after the
  // booking `earlyCheckIn` map is persisted. The bell panel
  // picks it up via the existing `onSnapshot` listener and
  // deep-links to the dashboard widget
  // (`/dashboard?focus=early-checkin&bookingId=…`) so staff
  // land directly on the Approve / Decline controls. The
  // existing staff email (per `plan/features/EMAIL-PDF-STORAGE.md
  // §earlyCheckinRequestEmail`) is unchanged — the
  // notification is additive. Read state is per-staff via the
  // existing `readBy` map; the 30-day retention cron covers
  // it for free.
  | "early-checkin-request";

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

// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11
// row`): the canonical shape of a row in the
// `failed_emails` Firestore collection (the DLQ for
// every Resend send failure). The DLQ is written by
// `sendEmail` in `guest-app/server/handlers/email.ts`;
// the admin banner reads the same shape. Fields are
// the minimum needed for the operator's audit trail
// (recipient + subject + error + timestamps + retry
// count) — the `error` field is the canonical message
// from Resend's API response. The shape is also
// pinned by the backfill / retention tooling so future
// crons (e.g. "retry after 24h") have a stable contract
// to read.
export interface FailedEmail {
  id: string;
  /** Resend's destination address (the guest's email). */
  recipient: string;
  /** The email's subject line (the template's resolved subject). */
  subject: string;
  /** Resend's error message (or `String(error)` for non-Error rejections). */
  error: string;
  /** Server-side `new Date()` at DLQ write time. */
  lastAttemptAt: Date;
  /** Number of retry attempts (always 0 today; reserved for the future retry-cron). */
  retryCount: number;
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

// In-flow hold for the public booking flow's Steps 2 + 3
// countdown banner. See
// `shared/utils/bookingInFlowHold.ts` for the lifecycle
// helpers and `plan/features/BOOKING-FLOW.md §In-flow hold`
// for the UX contract. The hold is a soft UX signal — the
// authoritative double-booking guarantee remains the
// Firestore transaction in `handleCreateBooking`; this
// collection lets the banner show "Your room is held for
// you until {time} · {MM:SS} left" while the guest fills
// out the form.
export interface BookingHold {
  id: string;
  // Mirrors the booking flow's preallocated `reservationId`
  // (per MRB-02). The server's `handleCreateBooking`
  // transaction reads the hold by `holdId`, then matches
  // `reservationId` to the booking being created to detect
  // a stale hold (a guest who restarted the flow).
  reservationId: string;
  // The room type the guest picked on Step 1. Server uses
  // it as a sanity check (a hold for type A is irrelevant
  // if the guest is now creating a booking for type B),
  // but the authoritative room assignment is still the
  // transaction's type→physical-room pick.
  roomType: string;
  // yyyy-mm-dd, the same shape Step 1 already stamps.
  checkIn: string;
  checkOut: string;
  numNights: number;
  // The hold deadline. Server-stamped from `IN_FLOW_HOLD_MINUTES`
  // at start time; never refreshed. A second call to
  // `/api/holds/start` from the same client with the same
  // `holdId` is rejected as a duplicate.
  expiresAt: Date;
  // "active" → banner shows the live countdown.
  // "consumed" → booking transaction succeeded; banner hides.
  // "expired" → past `expiresAt`; banner shows the red expired
  //   state. Set by the Janitor / cron, or by
  //   `isInFlowHoldActive`'s read-time evaluation.
  status: "active" | "consumed" | "expired";
  createdAt: Date;
  // For analytics + future per-hotel tuning — the snapshot
  // of `IN_FLOW_HOLD_MINUTES` at start time. Future commit
  // will move this to `settings/hotelConfig.inFlowHoldMinutes`.
  holdMinutes: number;
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

// Per Phase 2 of the Spark Rewards tier system (2026-10-12, decision
// pending). A tier is the editable row in the Settings → Rewards
// tab: a name, a stay-completion threshold, a room-rate discount
// percentage, a points multiplier applied at earn time, and a free-
// text perks blurb shown to the member on their rewards portal. The
// `fromStays` is integer ≥ 0 and must be unique within the array
// (one tier per threshold). The `id` is stable so admin can rename
// the tier without breaking existing `members/{uid}.currentLevel`
// caches. Decimals allowed on `pointsMultiplier` (e.g. 1.25, 1.5)
// so admins can tune earn rate per tier.
export interface LevelDef {
  id: string;
  name: string;                  // 1..24 chars
  fromStays: number;             // integer ≥ 0, unique within the array
  discountPct: number;           // 0..100
  pointsMultiplier: number;      // > 0, decimals allowed
  perks: string;                  // ≤ 280 chars, free-text
}

// Canonical `settings/rewardsConfig` document. Phase 1 fields are
// required at read time (callers coalesce defaults when absent).
// Phase 2 fields are all optional with safe defaults — admin can
// leave them at "off" until they tune. The booking engine falls
// back to `memberDiscountPct` for tier-less members (decision #,
// 2026-10-12 — see DECISIONS-FEATURES.md). `welcomePoints` is
// credited on `POST /api/members/register` (idempotency via
// `pointsHistory` `type: "welcome"` row check). `minPointsToRedeem`
// guards the redeem-points endpoint. `pointsCanPayUpToBillPct` caps
// how much of a booking's subtotal can be paid with points (0..100,
// `100` = no cap, default). `freeNightEvery` writes a voucher when
// `completedStays % N === 0` at checkout.
export interface RewardsConfig {
  // Phase 1 fields:
  pointsEnabled: boolean;
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  memberDiscountEnabled: boolean;
  memberDiscountPct: number;
  pointsRedemptionRate: number;
  earlyCheckInEnabled?: boolean;
  updatedAt?: Date;
  // Phase 2 fields (all optional, safe defaults):
  welcomePoints?: number;            // 0 = off
  minPointsToRedeem?: number;        // 0 = no minimum
  pointsCanPayUpToBillPct?: number;  // 0..100, default 100 (no cap)
  freeNightEvery?: number;           // integer, 0 = off
  levels?: LevelDef[];               // ordered ascending by fromStays
  // Per PR #9 (2026-10-13): admin opt-in toggle for member
  // self-service points redemption at booking Step 3. Default false
  // (front-desk-mediated). When true, the booking flow exposes an
  // "Apply my points" input alongside the voucher code, and the
  // member-authenticated /api/members/redeem-points-self endpoint
  // is enabled. All 7 guards (min-redeem, bill cap, balance, one-
  // per-booking, status pre-checkin, member match, booking exists)
  // still run server-side.
  allowMemberPointsRedemption?: boolean;
}

// Canonical `members/{memberId}` document. Same UID as
// `guests/{userId}` — member accounts are guest accounts with the
// Spark Rewards fields populated. All Phase 2 fields are optional
// with safe defaults. `completedStays` is incremented at checkout
// (in the same transaction as the points earn step, with a
// cancellation clawback per the existing MRB-05 / CRL-02 pattern).
// `currentLevel` is a cached snapshot — refreshed at checkout +
// on settings save — and falls back to null for members who haven't
// earned enough stays for the lowest configured tier.
export interface Member {
  memberNumber: string;        // e.g. "SR-10023"
  uid: string;                 // Firebase Auth UID
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  rewardsPoints: number;
  status: "active" | "suspended";
  // Phase 2 fields (all optional):
  completedStays?: number;          // default 0
  currentLevel?: LevelDef | null;   // cache, default null
  createdAt?: Date;
  updatedAt?: Date;
}

// Per Phase 2 (2026-10-12, decision pending): extended to cover
// the new entry types wired up in subsequent PRs ("welcome" on
// register, "free-night" when a tier promotion completes). Today
// the live points ledger writes "earn" / "redeem" / "adjust" /
// "clawback"; "welcome" and "free-night" join the union now so
// the type is honest and downstream consumers (Reports, audit
// logs) can render them without a TS cast.
export type PointsHistoryType =
  | "earn"
  | "redeem"
  | "adjust"
  | "clawback"
  | "welcome"        // Phase 2 — register bonus, wired in Phase 6
  | "free-night";    // Phase 2 — tier reward, wired in Phase 5

// Canonical `members/{memberId}/pointsHistory/{historyId}` entry.
// The ledger is append-only — cancellations claw back via a
// compensating entry of `type: "clawback"` rather than by
// mutating the original row. `points` is signed: positive for
// earn / welcome / free-night, negative for redeem / clawback.
export interface PointsHistoryEntry {
  id: string;
  memberId: string;
  type: PointsHistoryType;
  points: number;
  bookingRef?: string | null;
  note?: string;
  createdAt: Date;
  createdBy?: string;        // staff uid for adjust / welcome / free-night
}

// Per F09 / SEC-6 (2026-10-22): the PUBLIC projection contract of
// `settings/hotelConfig` — the corporate-rate-free, bank-detail-free
// shape served by `GET /api/public/hotel-config`. Re-exported from
// here (and therefore from the `@spark-inn/shared` barrel) so the
// guest app and the server agree on one contract. Type-only: the
// runtime shape is built by the server-side projection module.
export * from "./publicHotelConfig";
