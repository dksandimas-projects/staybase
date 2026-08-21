# TypeScript Types
> Requires: CLAUDE.md, docs/BACKEND.md

---

## Overview

All shared TypeScript types live in `shared/types/`. Both apps import from here via `@shared/types`.

Never redefine these types in app-level files. Never duplicate type definitions across apps.

Types are derived from Zod schemas where validation is needed — use `z.infer<typeof Schema>` to get the TypeScript type.

---

## Room

```
// RoomType is NOT a fixed enum — it is a free-form string matching a value
// managed dynamically in the Admin App Settings UI (prefilled from hotel.config.ts)
// e.g. "single", "deluxe-sea-view", "garden-suite"
// Use the roomTypes state list from global context to populate dropdowns and filters — never hardcode type values

RoomType = string   // matches AdminContext roomTypes value

RoomStatus = "available" | "occupied" | "blocked"
HousekeepingStatus = "clean" | "dirty" | "in-progress"

// Room-level fields are intentionally narrow: a room is just a
// bookable unit of a type. Pricing, capacity, photos, bed
// description, description, and amenities all live on the RoomType
// entry (see below). Consumers join the type at read time.

Room {
  id: string
  name: string                  // may vary per room (e.g. "Deluxe — Sea View"); defaults to type label on create
  roomNumber: string
  type: RoomType
  isActive: boolean
  status: RoomStatus
  housekeepingStatus: HousekeepingStatus
  blockReason: string
  remarks: string
  qrToken?: string             // regenerated QR route token; fallback is room id
  createdAt: Date
  updatedAt: Date
}

// `maxCapacity`, `pricePerNight`, `weekendRate`, `corporateRate` (W3.6),
// and `bedDefinition`, `description`, `amenities` (W3.7) all moved off
// the Room document and onto the RoomType entry. The Settings →
// Room Types table is the single edit surface for every type field
// (Add / Edit / Photos / Delete). The room type's `maxCapacity`,
// `bedDefinition`, `description`, and `amenities` are inherited by
// every room of that type; consumers join by `Room.type` at read
// time. See `plan/features/RATE-MANAGEMENT.md §W3.6` and
// `plan/features/ROOM-MANAGEMENT.md §W3.7` for the migration notes.
//
// EXB-01: missing extra-bed fields normalize to 0.

RoomType {
  value: string                 // unique key, lowercase, kebab-case
  label: string                 // human-readable display name
  shortLabel: string            // compact abbreviation for badges
  imageUrls: string[]           // Firebase Storage URLs, max 10
  bedDefinition: string         // e.g. "1 queen size bed"
  description: string           // one-paragraph marketing copy
  amenities: string[]           // e.g. ["WiFi", "AC", "Hot Shower", "Cable TV"]
  maxCapacity: number           // adult cap (ages 12+) for every room of this type
  maxChildren?: number          // child cap (ages 0–11); legacy values normalize by adult cap
  maxExtraBeds?: number         // per EXB-01: hard cap on per-booking extraBedCount (0 = not allowed)
  extraBedRate?: number         // per EXB-01: per-bed-per-night rate, snapshotted onto Booking
  pricePerNight: number         // base rate per night
  weekendRate: number           // applied for stays including Sat/Sun nights
  corporateRate: number         // flat public rate used at /corporate/book
}

SeasonalRateOverride {
  id: string
  name: string
  startDate: string             // yyyy-mm-dd, inclusive
  endDate: string               // yyyy-mm-dd, inclusive
  rate: number
  roomTypeValues: string[]      // empty = all room types
  isActive: boolean
}

RoomBlock {
  id: string
  roomId: string
  roomNumber: string
  roomType: string
  startDate: string              // yyyy-mm-dd, inclusive
  endDate: string                // yyyy-mm-dd, exclusive
  reason: string
  notes: string
  status: "active" | "cancelled"
  createdBy: string
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  cancelledBy: string | null
}
```

---

## Booking

```
BookingStatus =
  "pending" | "payment-uploaded" | "payment-confirmed" |
  "confirmed" | "checked-in" | "checked-out" | "cancelled"

// Per NBS-03 (2026-07-31): widened from the 5-value union to
// `string` so configured entries (e.g. "agoda" per CVQ-08) flow
// through without a schema change. The configured list lives on
// `settings/hotelConfig.bookingSources[]`; `BOOKING_SOURCES`
// in `shared/constants` stays as the seed/default array. Server-
// side validation against the configured list is the authoritative
// gate. `shared/types/index.ts` carries the same widening.
BookingSource = string

DiscountType = "" | "senior" | "pwd"

PaymentMethod = "pay-at-hotel" | "gcash" | "paypal" | string

PublicRoomSelection {
  bookingId?: string                     // first selection uses the public flow's preallocated upload ID
  roomType: string
  numAdults: number                      // at least one adult per room
  numChildren: number
  extraBedCount: number
  hasBreakfast: boolean
  breakfastIncludesChildren: boolean
}

Reservation {
  // Per MRB-01 (2026-08-02, per decision #159): the reservation
  // header. Every new booking (including a one-room stay) is
  // linked to a `reservations/{id}` document. The header owns
  // the public ref, lead booker / contact, source / corporate
  // context, payment proof / state, voucher / member discount,
  // consent, group totals, and (in MRB-04) the folio at
  // `reservations/{id}/payments` + `reservations/{id}/charges`.
  // Per-room fields (physical room, dates per room, occupancy,
  // rate / add-on / tax snapshots, registration, check-in / out,
  // housekeeping) live on each child `bookings/{id}`.

  id: string                              // Firestore doc ID = the preallocated UUIDv4
  reservationRef: string                  // "R-YYYYMMDD-NNNNN" — public ref, distinct prefix from SI-

  leadGuestName: string
  leadGuestEmail: string
  leadGuestPhone: string
  memberId: string | null                 // server-mapped from verified email token

  checkIn: Date                           // shared date range (one per reservation)
  checkOut: Date
  numNights: number

  originalSubtotal: number               // pre-discount sum of every child room's subtotal
  discountScopeSnapshot: DiscountScope | null   // DSC-01 snapshot
  subtotal: number                        // sum of every child room's subtotal
  totalPrice: number                      // sum of every child room's totalPrice

  source: BookingSource                   // single value per reservation
  isCorporate: boolean
  corporateCode: string                   // snapshotted
  companyName: string
  voucherCode: string                     // flat voucher applies once (per MRB-09)
  memberDiscountPct: number

  paymentStatus?: "awaiting-payment" | "payment-uploaded" | "payment-confirmed" | "confirmed" | "in-house" | "completed" | "cancelled"   // Per BAR-02 (#203, 2026-08-08): derived at read time via `computeReservationAggregatePaymentStatus(children.map(c => c.status))`; no longer written to the reservation header. Optional for back-compat reads of pre-BAR-02 reservations.
  paymentMethod: PaymentMethod
  paymentProofUrl: string | null          // canonical "no payment proof" is null
  paymentProofPath: string | null

  termsAccepted: boolean                  // single per reservation, covers all rooms
  termsAcceptedAt: Date | null
  termsVersion: string
  privacyAccepted: boolean
  privacyAcceptedAt: Date | null
  privacyVersion: string

  // Per BAR-02 (#203, 2026-08-08): the 5 aggregate
  // counter fields are derived at read time via
  // `deriveReservationCounters(children)` in
  // `shared/utils/bookingFolio.ts`. No handler
  // writes them. The fields are retained as
  // optional `?` for back-compat reads of pre-BAR-02
  // reservations that still carry them in
  // Firestore (harmless dead data).
  roomCount?: number
  activeRoomCount?: number
  cancelledRoomCount?: number
  checkedInRoomCount?: number
  checkedOutRoomCount?: number

  holdExpiresAt: Date | null              // unified PEX hold (no separate large-group timer, per MRB-08)

  requestFingerprint: string              // server-only; includes every room's type, occupancy, extra beds, and breakfast choices

  // Per CRL-07 (2026-08-03, per decision #173): the
  // durable refund-liability snapshot stamped onto
  // the reservation header by reservation-scope
  // cancels (MRB-13) + by N=1 cancels (the entire
  // active surface today). Per-child cancels inside
  // a multi-room reservation stamp the snapshot
  // onto the cancelled booking instead; surviving
  // children carry no liability. Absence / `null` /
  // `undefined` means "no liability work to do" —
  // typically because `policyRefund === 0` or the
  // reservation was cancelled before CRL-07 shipped.
  // See `CancellationLiability` + the pure
  // `computeCancellationLiabilityState` helper in
  // `shared/utils/cancellation.ts` for the state
  // machine + the breakdown.
  cancellationLiability?: CancellationLiability | null

  createdAt: Date
  updatedAt: Date
  createdBy: string                       // staff UID or the literal "guest"
}

Booking {
  id: string
  bookingRef: string
  // Per MRB-01 (2026-08-02, per decision #159): the reservation
  // header linkage. Every new booking (including a one-room
  // stay) carries server-assigned `reservationId`, denormalized
  // `reservationRef`, `reservationPosition` (1-indexed), and
  // `reservationRoomCount`. These are read-only projections of
  // the parent reservation — the Firestore rules deny client
  // writes to all four. Legacy null-reservationId bookings
  // keep today's self-contained behavior.
  reservationId: string | null
  reservationRef: string | null
  reservationPosition: number | null
  reservationRoomCount: number | null
  roomId: string
  roomNumber: string
  roomType: RoomType
  guestName: string
  guestEmail: string
  guestPhone: string
  numGuests: number        // persisted total; must equal numAdults + numChildren when split exists
  numAdults?: number       // absent derives to numGuests
  numChildren?: number     // absent derives to 0
  extraBedCount?: number   // absent derives to 0; capped by RoomType.maxExtraBeds
  extraBedRate?: number     // snapshotted at create time from room type's `extraBedRate`
  extraBedTotal?: number    // canonical computed total = extraBedCount × extraBedRate × numNights
  checkIn: Timestamp        // Firestore Timestamp — see `DECISIONS-FEATURES.md #84`
  checkOut: Timestamp       // (always stored as `Timestamp.fromDate(jsDate)`, never raw Date or ISO string)
  numNights: number
  ratePerNight: number
  rateBreakdown: BookingRateBreakdown | null
  totalPrice: number
  originalTotalPrice: number | null   // canonical pre-discount room/add-on subtotal; all new writers always set it, null is legacy-only
  discountType: DiscountType
  discountPct: number
  discountIdPhotoUrl: string | null   // OSCA/PWD ID uploaded by guest at Step 3
  discountIdPhotoPath?: string | null // new private uploads; staff resolves a short-lived signed URL
  discountVerified: boolean           // staff marked ID as valid
  discountVerifiedBy: string | null   // staff UID
  discountRejected: boolean           // staff rejected the ID
  discountRejectedBy: string | null   // staff UID
  discountRejectionReason: string     // optional reason entered by staff
  voucherCode: string
  voucherDiscount: number
  isCorporate: boolean
  corporateCode: string
  companyName: string
  // Per feat/special-requests-redirect (commit 78a79f7) +
  // feat/staff-special-requests-capture (2026-08-21): the
  // public `/book` form does NOT collect `specialRequests`
  // (replaced with a redirect card pointing to the hotel's
  // support email + front desk phone). The field is captured
  // by the front desk from email or phone through three staff
  // surfaces: the booking drawer's "Special requests" editor
  // (in `BookingDrawerWorkspace.tsx`), the admin walk-in modal,
  // and the calendar-create modal. The two metadata fields
  // below track when the staff last touched the value and
  // which staff uid did. The firestore.rules staff-allowed
  // update list includes all three fields; the server endpoint
  // `/api/bookings/set-special-requests` stamps the metadata
  // in the same transaction.
  specialRequests: string
  specialRequestsUpdatedAt: string | null
  specialRequestsUpdatedBy: string | null
  status: BookingStatus
  paymentMethod: PaymentMethod
  // Per BF-45 (booking-flow audit 2026-06-26): the
  // canonical "no payment proof" value is `null` (not
  // `""`). Writes coalesce `""` to `null` so all read
  // sites can rely on `!!booking.paymentProofUrl` /
  // `paymentProofUrl === null` checks without a string
  // comparison.
  paymentProofUrl: string | null
  paymentProofPath?: string | null    // new private uploads; staff resolves a short-lived signed URL
  // Per H2 (hardening batch 2026-06-26): 32-char hex
  // random token generated at booking-create time. The
  // email magic link carries `?ref={bookingRef}&token={
  // lookupToken}` instead of `?ref={...}&email={...}` so
  // PII (the guest's email) never appears in URLs.
  lookupToken: string
  source: BookingSource
  linkedInquiryId: string | null     // set when created from a converted corporate inquiry (per `DECISIONS-FEATURES.md #102`)
  louReceived: boolean               // staff-toggled flag for chargeback bookings (per `DECISIONS-FEATURES.md #99` + LOW-1 in the 2026-08-10 reports audit)
  louReceivedAt: Date | null         // stamp on the LOU toggle — null while pending, server timestamp when received
  louReceivedBy: string | null       // staff UID who toggled the flag (matches the `discountVerifiedBy` / `cancelledBy` audit pattern)
  notes: string
  memberId: string | null
  pointsRedeemed: number              // points redeemed by staff (0 if none)
  pointsRedeemedValue: number         // ₱ value deducted from totalPrice (0 if none)
  pointsRedeemedBy: string | null     // staff UID who applied redemption
  pointsRedeemedAt: Date | null
  pointsAwarded?: number
  pendingLoyaltyPoints?: number
  loyaltyAwardStatus?: "pending-payment" | "awarded" | "ineligible"
  pointsAwardedAt?: Date | null
  checkedOutWithBalance?: number
  checkedOutFolioTotal?: number
  checkedOutCollectedTotal?: number
  earlyCheckoutOriginalCheckOut?: Timestamp | null
  hasBreakfast: boolean
  breakfastRate: number
  guestIdPhotoUrl: string | null      // guest ID photo uploaded by front desk at check-in
  guestRegistration?: {
    nationality: string
    address: string
    dateOfBirth: Date | string
    gender: string
    idType: string
    idNumber: string
    emergencyContact: string
    vehiclePlate: string
    signatureStatus: "pending" | "signed"
  }
  breakfastSelections?: Record<string, string> // key format: yyyy-mm-dd-guest-n → silog item name
  // Per BSP-01 (fix/breakfast-served-persistence, 2026-07-25): per-date/per-guest
  // served flag written by the dashboard's "Mark Served" toggle. Same key
  // format as `breakfastSelections`. Hydrated by the admin client's snapshot
  // mapper so the state survives real-time refresh and is visible across
  // staff sessions. Absent on legacy bookings → mapper defaults to `{}`.
  breakfastServed?: Record<string, boolean>
  handledBy: string
  cancellationReason: string
  // Per CRL-02 (2026-08-02): the full cancellation audit metadata.
  // All three fields are nullable on legacy bookings; CRL-02 stamps
  // them in the same Firestore transaction as the status flip, so a
  // partial failure cannot leave a half-stamped cancellation. The
  // parallel `cancellationSource` discriminator supersedes the
  // earlier "read the reason string" pattern; both are preserved
  // (the `cancellationReason` field stays for backwards-compatibility
  // with PEX-05's email-template switch + Reports' legacy grouping).
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationSource: "guest" | "staff" | "system" | null
  // Per CRL-07 (2026-08-03, per decision #173): the
  // durable refund-liability snapshot stamped onto
  // the booking doc by per-child + legacy
  // null-`reservationId` cancels (the per-child
  // path lives in the `else` arm of the
  // `if (isReservationScope)` dispatch in
  // `handleCancelBooking`; the legacy path
  // falls through to the same branch because
  // legacy bookings have no `reservationId`).
  // Reservation-scope cancels stamp the snapshot
  // onto the reservation header instead (see
  // `Reservation.cancellationLiability`) — the
  // booking doc's field is `undefined` for that
  // path. Absence / `null` / `undefined` means
  // "no liability work to do" — typically because
  // `policyRefund === 0` (the destructive cancel
  // never auto-refunds per CRL-04, so a no-refund
  // cancel doesn't need a snapshot) or because
  // the booking was cancelled before CRL-07
  // shipped. The field is hydration-safe — the
  // admin client's snapshot mapper defaults it to
  // `null` when the Firestore doc has no field.
  // See `CancellationLiability` + the pure
  // `computeCancellationLiabilityState` helper in
  // `shared/utils/cancellation.ts` for the state
  // machine + the breakdown (state, outstanding,
  // retention are derived; the stored field is
  // the policy result + approved amount + the
  // latest exception audit).
  cancellationLiability?: CancellationLiability | null
  // Per BF-37 (booking-flow audit 2026-06-26) and W4.4 /
  // decision #104: per-booking email idempotency markers.
  // Written by the server when a transactional email fires so
  // retries (and manual re-fires via /api/email/*) do not
  // duplicate. Set on `staff-new-booking` and `staff-new-payment`;
  // `reminderSentAt` is the cron idempotency key (per
  // DECISIONS-FEATURES.md #83).
  emailNotificationsSent?: {
    staffNewBooking?: Date
    staffNewPayment?: Date
    reminderSentAt?: Date
  }
  // Same field as `emailNotificationsSent.reminderSentAt`; the
  // schema uses both names — keep `reminderSentAt` at the top
  // level for the cron query (DECISIONS-FEATURES.md #83) and
  // the nested form for the other two.
  earlyCheckIn?: EarlyCheckInDetails | null
  reminderSentAt?: Date
  createdAt: Date
  updatedAt: Date
}

OnsitePayment {
  id: string              // client-preallocated for idempotent onsite payment OR refund creation (CRL-01, 2026-08-01: refundId shares the paymentId shape)
  type: "payment" | "refund"
  amount: number          // absolute value capped at 1,000,000; refund entries are negative
  method: PaymentMethod
  note: string
  /** Tender-specific identifier for this individual ledger entry
   *  (GCash ref, bank trace). As of 2026-07-24
   *  (`refactor/unify-payment-reference-fields`), this is the
   *  canonical payment reference for a booking — the previous
   *  top-level `Booking.paymentReferenceNumber` is retired.
   *  Required only when the method's `requireReferenceNumber`
   *  config says so; cash and legacy entries omit it. Part of
   *  the idempotency comparison for both payments and refunds
   *  (amount + method + reference + note). */
  transactionReference: string | null
  reason: string | null
  approvedBy: string | null
  recordedBy: string   // staff UID
  recordedAt: Date
}

IncidentalCharge {
  id: string
  bookingId?: string
  bookingRef?: string
  roomNumber?: string
  label: string
  amount: number          // positive charge or negative reversal; absolute value capped at 1,000,000
  category: "late-checkout" | "early-checkin" | "extra-person" | "damage" | "laundry" | "other"
  note: string
  addedBy: string
  addedAt: Date
  voidOf: string | null   // reversal document ID is deterministically `void-{voidOf}`
}

CorporateInvoice {
  id: string
  companyName: string
  bookingIds: string[]
  bookingRefs: string[]
  amount: number
  status: "issued" | "paid"
  issuedAt: Date
  issuedBy: string
  paidAt: Date | null
  paidBy: string | null
}

EarlyCheckInDetails {
  status: "requested" | "approved" | "declined"
  requestedTime: string
  notes: string
  requestedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  staffNote: string | null
  confirmedTime?: string | null
}
```

### BookingRateBreakdown

Locked, guest-safe explanation of booking price at creation time. Used by booking review, confirmation, lookup, emails, and admin receipts. Server-side money mutations must rebuild its deduction lines and final total in the same transaction as `totalPrice`. Existing bookings may omit it and must render with the legacy `ratePerNight × numNights` fallback.

Required shape:

- `currencySymbol`, `currency`, and `locale` from config at booking time.
- `roomLines[]` grouped by rate source: regular, weekend, seasonal, corporate, or manual. Each line carries label, source, start/end dates, night count, nightly rate, subtotal, and optional seasonal override label.
- `addOnLines[]` for breakfast and future guest-safe add-ons.
- `deductionLines[]` for Senior/PWD discount, voucher, member discount, and points redemption.
- `roomSubtotal`, `addOnsSubtotal`, `deductionsSubtotal`, and `finalTotal`.
- `generatedAt` timestamp for audit/debug context.

Public guest responses may include `BookingRateBreakdown` because it contains no payment proof URLs, admin notes, or unrelated booking PII.

---

## Staff (guests collection)

```
StaffRole = "front-desk" | "admin"

Staff {
  id: string
  fullName: string
  email: string
  phone: string
  nationality: string
  role: StaffRole
  createdAt: Date
  // Per-staff intercom audio routing — see `features/INTERCOM-AUDIO-ROUTING.md`.
  // Optional; absence is the "system default output" equivalent.
  audioRouting?: AudioRouting
}
```

---

## Member (Spark Rewards)

```
MemberTier = "standard"  // Phase 2: add Silver, Gold, etc.
MemberAuthProvider = "google" | "email"
PointsEntryType = "earn" | "redeem" | "manual" | "expire"

Member {
  id: string             // Firebase Auth UID
  memberNumber: string   // e.g. "SR-00042" — sequential, generated server-side on registration
  fullName: string
  email: string
  phone: string
  photoUrl: string
  authProvider: MemberAuthProvider
  isMember: boolean
  memberSince: Date
  rewardsPoints: number
  tier: MemberTier
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

PointsHistoryEntry {
  id: string
  type: PointsEntryType
  points: number
  description: string
  reason: string
  bookingId: string | null
  by: string
  at: Date
}
```

---

## Voucher

```
DiscountKind = "percent" | "flat"

Voucher {
  id: string
  code: string
  discountType: DiscountKind
  discountValue: number
  usageCap: number | null
  usageCount: number
  expiresAt: Date | null
  applicableRoomTypes: RoomType[]
  isActive: boolean
  createdBy: string
  createdAt: Date
}
```

---

## Corporate Code

```
CorporateCode {
  code: string
  companyName: string
  ratePerRoomType: Record<string, number>  // keys match hotel.config.ts → roomTypes[].value
  expiresAt: Date | null
  usageCap: number | null
  usageCount: number
  linkedInquiryId: string
  createdBy: string
  createdAt: Date
  isActive: boolean
}
```

---

## Corporate Inquiry

```
InquiryStatus = "new" | "contacted" | "negotiating" | "converted" | "declined"

InquiryNote {
  text: string
  by: string
  at: Date
}

CorporateInquiry {
  id: string
  companyName: string
  contactPerson: string
  email: string
  phone: string
  numRooms: number
  preferredDates: { from: Date; to: Date }
  specialRequirements: string
  status: InquiryStatus
  handler: string
  notes: InquiryNote[]
  accessCodeId: string
  createdAt: Date
}
```

---

## Settings

```
PaymentMethodConfig {
  method: string          // unique key, e.g. "gcash", "bank", "paypal", "pay-at-hotel"; the schema is open so admins can add custom keys
  label: string           // display name shown to guests (e.g. "GCash", "Bank Transfer", "Pay at Hotel")
  accountName: string     // recipient name shown to guests beside the QR (e.g. "Spark Inn Hotel Corp")
  accountNumber: string   // account number / PayPal email / digital wallet number
  qrUrl: string           // public Firebase Storage URL; empty string = no QR uploaded
  isEnabled: boolean      // per #111: visibility on the REGULAR BOOKING surface (`/book` Step 3). When false, the method is hidden from the guest booking page.
  // Per #111 (per-method surface toggles). Each method owns
  // three independent visibility switches — `isEnabled` for
  // the regular booking flow, and these two optional flags
  // for the in-room store and the corporate booking. All
  // three default to "visible" when the flag is missing or
  // explicitly `true`; only an explicit `false` hides the
  // method from that surface. The optional Zod fields and
  // permissive TypeScript reads let pre-#111 entries
  // continue to work without a migration.
  showInStore?: boolean   // per #111: visibility on the IN-ROOM STORE surface. Filtered by `getEffectiveStorePaymentMethods` in `shared/utils/storePaymentMethods.ts`.
  showInCorporate?: boolean // per #111: visibility on the CORPORATE BOOKING personal-pay surface. The company charge-back path is unaffected. Filtered by `CorporateBookingPage.tsx`.
}
// The list of method keys that are protected from admin-side
// deletion is `PROTECTED_PAYMENT_METHODS` in `shared/constants`
// (currently `["pay-at-hotel", "add-to-bill"]`). Protected entries still appear
// in the UI (with a blue "Required" pill and no delete button)
// and remain subject to the per-method `isEnabled` toggle. See
// `plan/features/SETTINGS.md §Payment Methods → Delete` for the
// full UX spec and rationale.

HotelConfig {
  // Phase 11.8 PR 3 — every field below is now admin-editable
  // from Settings → Hotel Info. Each is a runtime override of
  // the deploy-time `hotel.config.ts` value. The public hook
  // (`usePublicSiteContent.contact.*`) returns the override when
  // set. Missing values fall back to `config.*`; explicitly empty
  // social fields hide their public icons. Address stays a single
  // display string (structured address is deferred).
  address: string         // display string for UI (single-line)
  frontDeskPhone: string  // used as tel: fallback in WebRTC intercom call
  supportEmail: string    // public-facing support email (Footer / Contact)
  dpoEmail: string        // Data Protection Officer email (Privacy page)
  facebookUrl: string
  instagramUrl: string
  twitterHandle: string
  checkInTime: string
  checkOutTime: string
  // Dynamic booking payment methods. Per
  // `plan/features/SETTINGS.md §Payment Methods` the list is
  // fully admin-managed from the Payment Methods tab. "Pay at
  // Hotel" is just another method (`method: "pay-at-hotel"`,
  // `isEnabled: true/false`); the previous standalone
  // `payAtHotelEnabled` flag was removed in favour of the
  // per-method `isEnabled` toggle.
  paymentMethods: PaymentMethodConfig[]
  intercomQuickRequests: string[]
  notificationSoundUrl: string
  extraBedInventory?: number // EXB-10: 0/absent = no hotel-wide constraint
}

// HotelConfig additions (in hotel.config.ts)
// memberNumberPrefix: string  — e.g. "SR" → "SR-00042"
// storeName: string           — e.g. "Spark Essentials"
// priceRange: string          — schema.org relative price band, e.g. "₱₱"
// twitterHandle: string       — X/Twitter handle for twitter:site; blank omits the tag

RewardsEarningMode = "per-booking" | "per-spend"

RewardsConfig {
  pointsEnabled: boolean
  earningMode: RewardsEarningMode
  pointsPerBooking: number       // flat pts per completed stay (earningMode = "per-booking")
  pointsPerHundred: number       // pts per ₱100 of totalPrice (earningMode = "per-spend")
  memberDiscountEnabled: boolean
  memberDiscountPct: number
  pointsRedemptionRate: number   // ₱ value per 100 points (e.g. 100 = 100pts → ₱100)
}

WebsiteContentItem {
  title: string
  description: string
  icon: string
}

SparkRewardsPromo {
  heading: string
  description: string
  perks: (WebsiteContentItem & { isEnabled: boolean })[]
  isEnabled: boolean
}

WebsiteContent {
  homepage: {
    heroEyebrow: string         // optional override of `config.tagline` (admin-editable from Settings → Branding)
    heroHeading: string
    heroSubtext: string
    heroPhotoUrl: string
    amenities: WebsiteContentItem[]
    // Room TYPE values featured on the homepage "Stay with us"
    // section. The page resolves each value to its first
    // active room and renders one card per type. Capped at
    // MAX_FEATURED_TYPES (3) at the editor and at the renderer.
    // Previously `featuredRoomIds: string[]` (physical room
    // doc IDs) — see MAX_FEATURED_TYPES in shared/constants for
    // the rationale; AdminContext.mergeWebsiteContent does a
    // one-time migration on read.
    featuredTypeValues: string[]
    services: (WebsiteContentItem & { isEnabled: boolean })[]
    sparkRewards: SparkRewardsPromo
  }
  about: {
    heroEyebrow: string         // optional override of the page's hard-coded "Our Story" pill
    heroHeading: string
    heroSubtext: string          // optional override of the page's deploy-time subtext
    heroPhotoUrl: string
  }
  corporate: {
    heroEyebrow: string
    heroHeading: string
    heroSubtext: string
    heroPhotoUrl: string
    perks: WebsiteContentItem[]
  }
  rewards: {
    heroEyebrow: string        // rendered as "{config.rewardsName} {rewards.heroEyebrow}"
    heroHeading: string
    heroSubtext: string
    heroPhotoUrl: string
  }
  branding: {
    logoNavbar: string         // colored logo — scrolled/solid state + non-hero pages
    logoNavbarOnDark: string   // light/white logo — over-hero transparent state
    logoFooter: string         // white logo — dark footer
  }
  privacyPolicyBody: string
  cancellationPolicy: string
  houseRules: string
}
```

**Zod schemas** for the public content shape live in `shared/schemas/websiteContent.ts` (`PublicHeroSchema`, `HomepageContentSchema`, `AboutContentSchema`, `CorporateContentSchema`, `RewardsContentSchema`, `BrandingConfigSchema`, `WebsiteContentSchema`). All fields default to empty string so partial Firestore docs validate cleanly.

---

## Intercom Message

```
SilogItem {
  id: string
  name: string          // e.g. "Tapsilog", "Longsilog", "Tocilog"
  isActive: boolean
}

BreakfastConfig {
  isEnabled: boolean
  ratePerPersonPerNight: number
  silogItems: SilogItem[]
}

// Breakfast selections are stored on Booking.breakfastSelections.
// Key format: yyyy-mm-dd-guest-n. Value: selected silog item name.
```

---

## Intercom Message

```
IntercomSender = "guest" | "front-desk"

IntercomMessage {
  id: string
  text: string
  sender: IntercomSender
  guestName: string
  timestamp: Date
  isRead: boolean
  isQuickRequest: boolean
  isStoreOrder: boolean
  orderRef?: string
  isEarlyCheckInRequest?: boolean
}

IntercomThread {
  roomId: string
  roomNumber: string
  guestName: string
  resolved: boolean
  updatedAt: Date
  resolvedAt?: Date | null
}
```

---

## Notification (Phase 12 — Notification Center, decision #120)

Persisted operational alerts for staff. One document per event,
written server-side via the Admin SDK from the existing API routes
(booking create / add-payment / confirm / check-in / check-out /
store order placed). Live-derived from the `intercoms` listener
(B1) for chat alerts — chat messages are **not** persisted here.

```
NotificationType = "booking" | "payment" | "message"
                 | "arrival" | "departure" | "store-order"
                 | "cancellation-refund"  // CRL-08 (2026-08-03, #174)

NotificationEntityType = "booking" | "storeOrder" | "intercom"

Notification {
  id: string
  type: NotificationType
  title: string                   // capped at 160 chars
  entityType: NotificationEntityType
  entityId: string                // bookingId | storeOrderId | roomId
  roomNumber: string | null       // denormalized; capped at 12 chars
  bookingRef: string | null       // e.g. "SI-20260715-00001"; capped at 40 chars
  readBy: Record<string, Date | null>
                                  // per-staff read trail; absence of my UID = unread for me
  createdBy: "system"             // always "system" (Admin SDK)
  createdAt: Date                 // server timestamp; the panel orders by this desc
}
```

**Hard Rule:** never store guest email, payment data, or any other
PII in a `notifications` doc. The doc carries room number + booking
ref + order ref + entity id only. See `plan/features/NOTIFICATION-CENTER.md`
and decision #120.

---

## Store

```
StoreItem {
  id: string
  name: string
  description: string
  price: number
  stock: number | null       // null = unlimited
  photoUrl: string
  isActive: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

StoreOrderItem {
  itemId: string
  name: string               // snapshot at order time
  price: number              // snapshot at order time
  quantity: number
}

StoreOrderStatus = "placed" | "confirmed" | "out-for-delivery" | "delivered" | "cancelled"
// `paymentMethod` is the open string key from
// `settings/hotelConfig.paymentMethods[]`. The in-room store
// filters that list by `showInStore !== false`, excluding
// `pay-at-hotel`. The server-side allowlist is computed by
// `getEffectiveStorePaymentMethods(...)` in
// `shared/utils/storePaymentMethods.ts` — no hardcoded list.
StorePaymentMethod = "cod" | "add-to-bill" | "gcash" | string

StoreOrder {
  id: string
  orderRef: string
  roomId: string
  roomNumber: string
  bookingId: string | null
  guestName: string
  items: StoreOrderItem[]
  totalAmount: number
  paymentMethod: StorePaymentMethod
  // Payment proof is required for any non-`cod`/non-`add-to-bill`
  // method (any "online" method). Empty string for `cod` and
  // `add-to-bill`. The server enforces this rule — see
  // `guest-app/server/handlers/store.ts → handleCreateStoreOrder`.
  paymentProofUrl: string
  paymentProofPath?: string           // private object path for new guest uploads
  status: StoreOrderStatus
  stockRestoredAt: Date | null
  deliveredAt: Date | null
  isBilled: boolean
  billedAt: Date | null
  cancellationReason: string
  handledBy: string
  notes: string
  createdAt: Date
  updatedAt: Date
}

StorePaymentMethodConfig {
  // Legacy shape retained only for old `settings/storeConfig`
  // documents. New store payment configuration lives in
  // `settings/hotelConfig.paymentMethods[]`.
  method: string
  label: string
  qrUrl: string
  accountInfo: string
  isEnabled: boolean
}

StoreConfig {
  isEnabled: boolean
  lowStockThreshold: number
  // Legacy fields. Checkout ignores them.
  paymentMethods: StorePaymentMethodConfig[]
  useBookingPaymentMethods: boolean
}
```

---

## WebRTC Voice Call

```
WebRTCCallStatus = "ringing" | "active" | "ended"

// Per decision #214 (2026-08-19): the staff attribution written
// atomically by the `runTransaction` claim in `AdminContext.acceptCall`.
// The first staff to commit the claim wins; every subsequent staff
// that tries the same room hits `data.status !== "ringing"` and the
// transaction aborts. Pre-#214 docs have `acceptedBy === null` (the
// field never existed) — the snapshot mapper normalizes to `null` so
// the legacy "Connected" UI keeps working on legacy data.
CallAcceptedBy {
  uid: string
  name: string
  claimedAt?: Date | null
}

WebRTCCall {
  roomId: string            // document ID = roomId
  offer: RTCSessionDescriptionInit
  answer: RTCSessionDescriptionInit | null
  status: WebRTCCallStatus
  guestName: string
  startedAt: Date
  endedAt: Date | null
  // Per decision #94 (W2.6): a new call displaced this one
  // ("superseded-by-other-call"); per decision #214: the claim
  // committed but getUserMedia / createAnswer / answer write failed
  // ("accept-failed"); per the guest's natural hangup
  // ("cancelled"). Null while the call is alive.
  endedReason?: "superseded-by-other-call" | "accept-failed" | "cancelled" | null
  // Per decision #214 (2026-08-19): the staff claim. Set by the
  // `runTransaction` in `acceptCall`; null on pre-#214 calls and on
  // the sub-second window between `triggerIncomingCall` and the
  // first claim.
  acceptedBy?: CallAcceptedBy | null
}

IceCandidate {
  id: string
  candidate: RTCIceCandidateInit
  from: "guest" | "staff"
  createdAt: Date
}
```

---

## API Response

```
ApiSuccess<T> {
  success: true
  data: T
}

ApiError {
  success: false
  error: string
}

ApiResponse<T> = ApiSuccess<T> | ApiError
```

---

## Booking Form (Zod — Step by Step)

Zod schemas for the 4-step booking form live in `shared/schemas/booking.ts`. TypeScript types are derived via `z.infer`. See `plan/features/BOOKING-FLOW.md` for field-level validation rules. EXB shared helper behavior is owned by decisions #145, #153, and #157 and covered by the shared room-type, booking-add-on, and extra-bed-inventory tests.

---

## Cancellation Liability (CRL-07 — 2026-08-03)

Per decision #173: the durable refund-liability snapshot stamped onto the cancelled entity in the same `runTransaction` as the status flip. Lives on the reservation header (`reservations/{id}.cancellationLiability`) for reservation-scope cancels + new-path N=1, and on the booking doc (`bookings/{id}.cancellationLiability`) for per-child cancels + legacy null-`reservationId` bookings. The stored fields are the immutable `policyResult` + the admin-controlled `approvedAmount` + the latest `exception` audit row. The derived fields — `state`, `outstandingAmount`, `retentionAmount` — are NEVER stored; the pure `computeCancellationLiabilityState` helper in `shared/utils/cancellation.ts` reads the stored snapshot + the cumulative `processedAmount` (from the refunds subcollection) and returns the projection.

```
CancellationPolicyResult {           // snapshot at cancel time; immutable post-cancel
  refundPct: number                    // MIN per-room refundPct (the worst-case floor)
  policyRefund: number                 // aggregate policy refund, 2dp
  netCollected: number                 // aggregate net collected at cancel time
  retainedAmount: number               // netCollected - policyRefund (what the hotel keeps under the policy)
  cutoffHours: number                  // snapshotted cutoff (NOT the live settings value)
  source: "settings" | "corporate-override" | "legacy-fallback"
  snapshottedAt: Date                  // the same `now` as the cancel's `cancelledAt` — no clock skew
}

CancellationExceptionAudit {          // latest exception; overwritten on each new exception
  approvedAmount: number               // the new approvedAmount after this exception
  reason: string                       // required, ≤500 chars (the audit trail)
  approvedBy: string                   // admin UID (the exception is admin-only)
  approvedAt: Date
}

CancellationLiability {               // the stored snapshot (the contract)
  policyResult: CancellationPolicyResult
  approvedAmount: number               // defaults to policyResult.policyRefund; reduced only via exception
  exception: CancellationExceptionAudit | null
}

CancellationLiabilityState {          // derived; never stored
  "not-required"                        // policyRefund === 0 — nothing to refund
  "retained"                            // approvedAmount < policyRefund — admin applied an exception
  "pending-processing"                  // approvedAmount === policyRefund AND processedAmount === 0
  "partially-processed"                 // 0 < processedAmount < approvedAmount
  "processed"                           // processedAmount >= approvedAmount
}

// computed by the pure helper (input → output):
computeCancellationLiabilityState({ liability, processedAmount }) → {
  state: CancellationLiabilityState,
  liability: CancellationLiability | null,
  processedAmount: number,
  outstandingAmount: number,           // approvedAmount - processedAmount, clamped ≥ 0
  retentionAmount: number,             // policyRefund - approvedAmount, clamped ≥ 0
  stateLabel: string                   // human-readable badge label per state
}

// The five-state machine is pinned by behavioural
// tests in `shared/__tests__/crl-07-liability-state.test.ts`
// (23 tests) covering the null fall-through, each
// state, partial exception, fully-processed
// exception, defensive coercion (negative inputs,
// NaN, approvedAmount > policyRefund writer bug),
// and the breakdown invariants. The pure
// `buildCancellationLiabilitySnapshot` helper
// produces the stored snapshot from a cancel-time
// preview — used by the destructive cancel handler
// in both branches (per-child + reservation-scope).
//
// Server projection endpoint (admin UI + future
// Reports consumer):
//   POST /api/bookings/cancellation-liability
//     body: { reservationId } | { bookingId }
//     returns: { success, data: { state, liability, processedAmount, outstandingAmount, retentionAmount, stateLabel } }
//
// Admin exception endpoint (the "reduce approved
// amount" mutation):
//   POST /api/bookings/cancellation-exception
//     body: { reservationId | bookingId, approvedAmount: 0..policyRefund, reason: ≤500 chars }
//     admin-only (403 for any other role)
//     idempotency: same (amount, reason) replays the original commit
//     never increases approvedAmount above the stored policy result
```

---

## Loyalty Earn + Clawback Pairing (MRB-15-07)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-07 sub-item, shipped v0.254.0). The `pointsHistory` ledger uses paired doc ids: `earn-${bookingId}` for the positive earn entry (written on check-out) and `clawback-${bookingId}` for the negative clawback entry (written on cancel). The pairing is the deterministic link between an earn and its subsequent clawback — the same `bookingId` appears in both.

### Pairing contract

- `earn-${bookingId}` is the doc id for the positive earn `pointsHistory` entry on a successful check-out. **Exactly 2 constructions** of `earn-${bookingId}` exist in the codebase: the check-out's `awardNow` flag (the standard path) and the post-settlement path (the deferred award, used when the check-out runs without a confirmed payment). The JSDoc reference is not a construction.
- `clawback-${bookingId}` is the doc id for the negative clawback `pointsHistory` entry on a cancel. **Exactly 1 construction** of `clawback-${bookingId}` exists in the codebase: `handleCancelBooking`'s per-child CRL-02 + MRB-05 audit stamp block.
- The map-based invariant `rewardsPoints == sum(pointsHistory.points)` is preserved end-to-end: the earn entry's `+N` is balanced by the clawback entry's `-N` when a check-out is followed by a cancel (the cancel is a destructive action on a checked-out booking — the points were earned, then clawed back).
- The pairing is the source-text guard for the cross-cutting "no duplicate earn" + "no duplicate clawback" invariants MRB-15-01 pins across the full create → cancel lifecycle.

### Test coverage

`guest-app/tests/api/mrb-15-01-lifecycle-invariants.test.ts` (14 tests) + `mrb-15-07-checkout-loyalty-earn.test.ts` (13 tests) — 27 source-text tests pin the earn/clawback pairing + the no-duplicate-earn + no-duplicate-clawback invariants.
