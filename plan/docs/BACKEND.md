# Backend — Firestore & Firebase
> Requires: CLAUDE.md

---

## Firebase Usage

**Auth + Firestore + Storage ONLY.**
No Firebase Hosting. No Cloud Functions. All server-side logic runs in Vercel API routes.
See `plan/docs/API-ROUTES.md` for API layer.

---

## Collections & Schemas

### `rooms/{roomId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "Room 202 — Executive" |
| `roomNumber` | string | e.g. "202" — unique across collection |
| `type` | string | Matches dynamic room type `value` from `@spark-inn/shared` |
| `isActive` | boolean | `false` = hidden from guest site |
| `status` | string | `"available"` \| `"occupied"` \| `"blocked"` |
| `housekeepingStatus` | string | `"clean"` \| `"dirty"` \| `"in-progress"` |
| `blockedFrom` | timestamp \| null | Optional date-range block |
| `blockedTo` | timestamp \| null | Optional date-range block |
| `qrToken` | string \| null | Optional regenerated QR route token |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps |

> **Photos, pricing, capacity, bed description, and amenities are NOT stored on individual rooms.** They all live on the **room type** — see `settings/hotelConfig.roomTypes[]` below. Upload path for type photos: Firebase Storage `room-types/{typeValue}/{filename}`.

> **Lifecycle:** Create/Update = Staff; Delete = Admin. Deletion is blocked client-side when any active booking references the room. On delete, the cascade cleans up Storage photos under `rooms/{roomId}/*`, `intercoms/{roomNumber}`, and `calls/{roomNumber}`.

*Note: Staff-only room notes live in `roomPrivate/{roomId}`. Room type pricing, photos, capacity, and amenities live on `settings/hotelConfig.roomTypes[]`.*

---

### `roomPrivate/{roomId}`

| Field | Type | Notes |
|---|---|---|
| `remarks` | string | Internal staff notes |
| `blockReason` | string | `"Maintenance"` \| `"Hold"` \| `"Other"` \| custom note |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps |

---

### `roomBlocks/{blockId}`

| Field | Type | Notes |
|---|---|---|
| `roomId` / `roomNumber` / `roomType` | string | Room identification |
| `startDate` / `endDate` | timestamp | Inclusive start / exclusive end date |
| `reason` / `notes` | string | Reason and optional staff note |
| `status` | string | `"active"` \| `"cancelled"` |
| `createdBy` / `createdAt` / `updatedAt` | string / timestamp | Audit |

---

### `reservations/{reservationId}` *(MRB-01..06)*

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID = preallocated UUIDv4 |
| `reservationRef` | string | Public ref (`R-YYYYMMDD-NNNNN`) |
| `leadGuestName` / `leadGuestEmail` / `leadGuestPhone` | string | Lead booker contact details |
| `memberId` | string \| null | Server-mapped member ID |
| `checkIn` / `checkOut` / `numNights` | timestamp / number | Shared date range across all rooms |
| `originalSubtotal` / `subtotal` / `totalPrice` | number | Aggregated reservation financial totals |
| `discountScopeSnapshot` | object \| null | Snapshotted `DiscountScope` at creation |
| `source` / `isCorporate` / `corporateCode` / `companyName` / `voucherCode` | string / bool | Reservation-level booking origin & corporate/voucher context |
| `paymentStatus` | enum | `"awaiting-payment"` \| `"payment-uploaded"` \| `"payment-confirmed"` \| `"confirmed"` \| `"in-house"` \| `"completed"` \| `"cancelled"` |
| `paymentMethod` / `paymentProofUrl` / `paymentProofPath` | string \| null | Money-state mirrors at reservation level |
| `termsAccepted` / `termsVersion` / `privacyAccepted` / `privacyVersion` | bool / string | Consent versioning |
| `roomCount` / `activeRoomCount` / `cancelledRoomCount` / `checkedInRoomCount` / `checkedOutRoomCount` | number | Aggregate counters. Per MRB-07, a staff-created reservation stamps these from its actual room count (N), so the admin reservation row reads room count, status and balance without fanning out to the children |
| `holdExpiresAt` | timestamp \| null | Unified payment hold deadline (PEX-01) |
| `requestFingerprint` | string | Canonical SHA-256 create request fingerprint for idempotency |
| `cancellationLiability` | object \| null | **CRL-07 (2026-08-03, per decision #173):** durable refund-liability snapshot stamped by reservation-scope cancels (MRB-13) + new-path N=1. Same shape as the booking-doc field — `{ policyResult: { refundPct, policyRefund, netCollected, retainedAmount, cutoffHours, source, snapshottedAt }, approvedAmount, exception: { approvedAmount, reason, approvedBy, approvedAt } \| null }`. `policyResult` is the aggregate of the reservation-scope preview (MIN per-room `refundPct` + pro-rated `netCollected`); the per-room detail is recoverable from the cancelled children's own snapshots when N>1. Surviving children in a partial reservation-scope cancel carry NO liability field (their status is unchanged). The header is the source of truth for the aggregate — Reports (CRL-08) read this field for the pending liability queue. |
| `aggregateRevenueAllocation` | object \| null | **MRB-11 (2026-08-03, per decision #177):** aggregate of every child booking's `revenueAllocation` (sum of children), recomputed transactionally in the same `runTransaction` as the price write. The shape is `{ roomNet, breakfastNet, addOnNet, deductionNet, totalNet }` with the invariant `roomNet + breakfastNet + addOnNet - deductionNet === totalNet` (= `reservation.totalPrice` by construction). Reports reads this for fast reservation-level revenue stream totals — `getReservationRevenueStreams` returns the stored aggregate when present, sums children otherwise. Absence means "no stored children yet" (the brief window between header mint + first child commit); pre-MRB-11 reservations have no field at all. |
| `actualDateRange` | object \| null | **MRB-14 (2026-08-03, per decision #180):** denormalised actual range across the reservation's children, `{ earliestCheckIn: timestamp, latestCheckOut: timestamp, isDivergent: boolean }` — derived from MIN(children.checkIn) / MAX(children.checkOut) and stamped transactionally by every add-room + every reschedule (the `actualCheckIn` divergence on check-in is a future follow-up). The contract: `isDivergent === true` ⇔ ∃ a child whose `checkIn` or `checkOut` differs from the header's. Pre-MRB-14 reservations have no field at all (`undefined`); the admin + email + receipt surfaces fall through to the legacy per-child read, byte-equivalent to pre-MRB-14. The header's own `checkIn` / `checkOut` / `numNights` are **immutable shared-dates snapshots from create time** (the only previous mutator, `handleRescheduleBooking`, was refactored to query children + recompute `actualDateRange` only — the per-MRB-14-03 spec). The legacy `checkIn` / `checkOut` remain the public-facing "shared dates" the email subject + receipt PDF + checkin reminder cron use when every child agrees; the actual range is shown when they don't. |
| `createdAt` / `updatedAt` / `createdBy` | timestamp / string | Audit |

**Subcollections:**
- `reservations/{id}/payments/{paymentId}` — Server-only create, staff read, no client edit/delete.
- `reservations/{id}/refunds/{refundId}` — Server-only create, staff read, no client edit/delete.
- `reservations/{id}/charges/{chargeId}` — Staff create with void semantics.

**Client-side read pattern (MRB-12, per decision #179):** the `AdminContext` (in `admin-app/src/context/AdminContext.tsx`) hydrates two read paths from this collection so the Bookings table reservation row + the drawer's reservation strip can render the group-level state without summing the filtered in-memory children. **(1) `subscribeToReservations`** — a full-collection `onSnapshot(collection(db, "reservations"))` listener (no `orderBy`; the row builder is a hash lookup keyed by `reservationId`) that hydrates `Reservation[]` into the context. The listener is small at this scale (~14 active reservations; the cap is bounded by room inventory, not bookings volume). **(2) `collectionGroup("payments")` aggregate** — a single `onSnapshot(collectionGroup(db, "payments"))` listener filters in JS to `reservations/{id}/payments/{paymentId}` paths (the regex `^reservations\/([^/]+)\/payments\/` is anchored to the reservation subcollection; legacy `bookings/{id}/payments/{paymentId}` entries are excluded by the anchor) and sums positive-amount entries + negative refund entries into a `Record<reservationId, paidAmount>` aggregate. The sign-aware sum matches the `paymentsTotal` semantics `getReservationFolioSummary` exposes. **The header-as-source-of-truth invariant:** the Bookings table reservation row's Total reads `reservation.totalPrice`; the Balance reads `Math.max(0, reservation.totalPrice − paidAmount)`. The row never sums N filtered children to render a summary — a desk officer filtering by `brt=` or `bs=` or `bq=` on a multi-room reservation sees the GROUP-level total + balance + status, not a filtered partial. N=1 + legacy null-`reservationId` paths stay byte-equivalent to pre-MRB-12 (the row never synthesises a reservation row for those, so the legacy code paths render). The cold-start race is preserved: when the listener hasn't fired yet, the row falls back to the child sum so the first paint never reads zero.

*Detailed MRB implementation narratives archived in [`plan/project/archive/BACKEND-ARCHIVE-2026-08-02.md`](plan/project/archive/BACKEND-ARCHIVE-2026-08-02.md).*

MRB-06 public creates may contain an explicit room selection for each requested stay. The create transaction resolves and locks one distinct physical room per selection, validates occupancy against that selection's room type, computes each room's nightly and add-on pricing, applies reservation-level deductions once to the aggregate, then allocates exact rounded totals back to the child bookings. One reservation header continues to own the lead guest, consent, payment proof/state, and group totals.

---

### `bookings/{bookingId}`

| Field | Type | Notes |
|---|---|---|
| `bookingRef` | string | e.g. "SI-20260601-001" |
| `reservationId` / `reservationRef` / `reservationPosition` / `reservationRoomCount` | string / number \| null | Linkage to reservation header |
| `roomId` / `roomNumber` / `roomType` | string | Room details |
| `guestName` / `guestEmail` / `guestPhone` | string | Lead guest info |
| `numGuests` / `numAdults` / `numChildren` | number | Occupancy breakdown |
| `extraBedCount` / `extraBedRate` / `extraBedTotal` | number | Extra bed charges |
| `checkIn` / `checkOut` / `numNights` | timestamp / number | Dates & duration |
| `ratePerNight` / `rateBreakdown` / `totalPrice` / `originalTotalPrice` | number / object | Financial breakdown & locked pricing |
| `discountType` / `discountPct` / `discountVerified` / `discountRejected` | string / number / bool | Senior/PWD discount status & verification |
| `voucherCode` / `voucherDiscount` | string / number | Applied promo voucher details |
| `isCorporate` / `corporateCode` / `companyName` / `corporate` | bool / string / object | Corporate booking context |
| `status` | string | `"pending"` \| `"payment-uploaded"` \| `"payment-confirmed"` \| `"confirmed"` \| `"checked-in"` \| `"checked-out"` \| `"cancelled"` |
| `paymentMethod` / `paymentProofUrl` / `paymentProofPath` | string \| null | Payment proof & method |
| `paymentRejectedAt` / `paymentRejectedBy` / `paymentRejectionReason` | timestamp / string \| null | Payment rejection log |
| `holdExpiresAt` | timestamp \| null | Payment hold deadline (PEX-01) |
| `source` / `notes` / `handledBy` | string | Booking source & staff notes |
| `memberId` / `memberDiscountPct` / `pointsRedeemed` / `pointsAwarded` | string / number | Spark Rewards loyalty fields |
| `checkedOutAt` / `checkedOutBy` / `checkedOutWithBalance` | timestamp / string / number | Checkout audit & balance snapshot |
| `confirmedWithBalance` / `confirmedWithBalanceReason` | number / string \| null | Partial payment confirmation audit (CWB) |
| `guestRegistration` / `guestIdPhotoUrl` | object / string \| null | Physical check-in registration data & ID photo |
| `breakfastSelections` | map | `bookings/{bookingId}.breakfastSelections` map: `yyyy-mm-dd-guest-n` → selected silog item name |
| `breakfastServed` / `hasBreakfast` / `breakfastRate` | map / bool / number | Breakfast add-on & daily silog selection maps |
| `earlyCheckIn` | object \| null | Optional early-arrival workflow record. `source` is `guest-request` or `staff-granted` (absent legacy value means guest request); includes status, requested/confirmed time, guest/staff notes, and created/resolved audit fields. Admin grant writes are server-authorized and transactional. |
| `cancellationReason` / `cancelledAt` / `cancelledBy` / `cancellationSource` | string / timestamp \| null | Permanent cancellation record |
| `cancellationLiability` | object \| null | **CRL-07 (2026-08-03, per decision #173):** durable refund-liability snapshot stamped by per-child + legacy null-`reservationId` cancels. `{ policyResult: { refundPct, policyRefund, netCollected, retainedAmount, cutoffHours, source, snapshottedAt }, approvedAmount, exception: { approvedAmount, reason, approvedBy, approvedAt } \| null }`. `policyResult` is immutable post-cancel. `approvedAmount` defaults to `policyResult.policyRefund` and is reduced only via `POST /api/bookings/cancellation-exception`. Absent on no-refund cancels (the absence is the "no liability work to do" signal) and on bookings cancelled before CRL-07 shipped. See the `computeCancellationLiabilityState` helper for the derived state. |
| `revenueAllocation` | object \| null | **MRB-11 (2026-08-03, per decision #177):** the per-stream revenue allocation snapshotted at create time (and recomputed on reschedule). `{ roomNet, breakfastNet, addOnNet, deductionNet, totalNet }` with the invariant `roomNet + breakfastNet + addOnNet - deductionNet === totalNet` (= `booking.totalPrice` by construction, asserted at the write boundary via `assertBookingRevenueAllocationInvariant`). Per-stream values are GROSS (pre-deduction); `deductionNet` is the total deductions as a single line. Reports reads this via `getBookingRevenueStreams` — the per-stream values are exact, not the historical proportional split. Absence means "pre-MRB-11 booking"; the helper falls back to the legacy `splitBookingRevenue` math (tagged `"allocation: legacy-heuristic"` so the export row can surface the heuristic to the accountant). |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps |

---

### `bookings/{bookingId}/payments/{paymentId}` (Legacy Subcollection)

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"payment"` \| `"refund"` |
| `amount` | number | Positive for payment, negative for refund |
| `method` | string | Payment method key from `hotelConfig.paymentMethods` |
| `transactionReference` | string \| null | Tender-specific reference (GCash ref / bank trace) |
| `note` / `reason` | string \| null | Optional internal note or refund reason |
| `approvedBy` / `recordedBy` / `recordedAt` | string / timestamp | Staff audit trail |

---

### `bookings/{bookingId}/charges/{chargeId}` (Legacy Subcollection)

| Field | Type | Notes |
|---|---|---|
| `amount` | number | Positive charge amount; negative for void reversal |
| `title` / `notes` | string | Charge description |
| `voidOf` | string \| null | Points to original charge ID if voiding |
| `createdBy` / `createdAt` | string / timestamp | Audit |

---

### `intercoms/{roomNumber}/messages/{messageId}` *(Per `feat/call-history-messages`, 2026-08-19)*

Every chat-thread message is stored here, including the system's own audit trail for WebRTC call lifecycle events. Both guests and staff write here; the only special case is `sender: "system"` for the three call-history outcomes (see below). The subcollection is the source of truth for the chat panel render in `IntercomChatPanel.tsx`.

| Field | Type | Notes |
|---|---|---|
| `text` | string | The message body. For `sender: "system"` + a `messageType`, this is the pre-formatted line e.g. `"Call answered at 2:14 PM · 3m 22s"`. For ordinary chat messages it's the raw text typed by sender. |
| `sender` | string | `"guest"` \| `"front-desk"` \| `"system"`. Required. The enum allows the render layer to bucket messages by alignment (left/right/centered). |
| `guestName` | string | Display name. For guests, the room's current chat name; for staff, literal `"Front Desk"`; for system, literal `"Front Desk"` (system messages render with no name in the chrome). |
| `timestamp` | timestamp | `serverTimestamp()` at write time. The Firestore rule `timestamp == request.time` enforces this — clients can't backdate. |
| `isRead` | boolean | `false` for incoming guest messages until the staff opens the thread. `true` for outgoing staff replies and for all system messages (no unread bubble for call history). |
| `isQuickRequest` | boolean | Drives the blue "Quick request" pill in the chat panel. |
| `isStoreOrder` | boolean | Routes the message into the `StoreOrderMessageCard` render path. |
| `orderRef` | string \| null | `storeOrders` doc id when `isStoreOrder` is true. |
| `isEarlyCheckInRequest` | boolean | Drives the early-check-in staff action surface. |
| `currentStayId` | string \| null | Echo of the room's `currentStayId` at write time. Lets staff filter the thread by stay on the back end if they want. |
| `messageType` | string \| null | The audit-type discriminator. Undefined for normal chat messages. Set to one of three values when `sender === "system"`: `"call-answered"` \| `"call-missed"` \| `"call-declined"`. Drives the centred footer row render with Phone / PhoneMissed / PhoneOff icons. The Firestore rule rejects any system doc that doesn't carry a recognised `messageType`. |
| `callStartedAt` | timestamp \| null | For `messageType === "call-answered"`, the server-side start of the audio stream. Combined with `callDuration` gives the full call telemetry. Null for missed/declined. |
| `callDuration` | number \| null | Seconds. For `"call-answered"`: how long the staff was connected. For `"call-missed"`: how long the call rang before disconnect. Null for `"call-declined"` (decline is instantaneous by design). |

> **Lifecycle:** The collection is append-only from the staff side; rows are never edited. Guests can only insert (via the rate-limited `/api/intercom/send` route). Per Firestore rules (`firestore.rules §intercoms.messages`), staff may create with `sender ∈ {guest, front-desk, system}`, but `sender === "system"` REQUIRES `messageType ∈ {call-answered, call-missed, call-declined}` — so ad-hoc system docs without an audit type are denied at the rule layer.

> **Why this lives here, not in `calls/{roomNumber}`:** the call lifecycle state lives in `calls/{roomNumber}` (transient, gets cleaned up after hangup), but the chat thread is the user-facing surface and the natural place to review a guest's call history alongside their messages. The split keeps transient state from bloating the chat thread count and lets `calls` be GC'd by future retention rules without losing the message-level audit.

---

### `calls/{roomNumber}` *(Per decision #214, 2026-08-19)*

Transient per-room WebRTC signaling state for the intercom voice call feature (`plan/features/INTERCOM-GUEST.md §Voice Call` + `INTERCOM-INBOX.md`). The doc is the single source of truth for the call lifecycle (status flip + SDP offer/answer + the staff claim audit). Doc ID is the room number (same as `intercoms/{roomNumber}`), so a 1:1 lookup by room number is implicit.

| Field | Type | Notes |
|---|---|---|
| `offer` | `RTCSessionDescriptionInit \| null` | The guest's SDP offer. Written when the guest taps "Call Front Desk" and creates the `RTCPeerConnection`. Null until the guest calls. |
| `answer` | `RTCSessionDescriptionInit \| null` | The staff's SDP answer. Written by `acceptCall` AFTER the claim transaction (the claim is the gate; the answer is the post-claim second write). Null until a staff member accepts. |
| `status` | enum | `"ringing"` \| `"active"` \| `"ended"`. The lifecycle: `ringing` is set by `triggerIncomingCall` (the guest's first write) and stays until either a staff claim commits (atomically flips to `active`) or the call times out / guest hangs up (flips to `ended`). `active` is set inside the claim `runTransaction`; `ended` is set by `declineCall`, the call timeout, the post-claim accept-failed catch, or the second-call-wins supersede (decision #94). |
| `guestName` | string | Display name for the admin inbox banner. |
| `startedAt` | timestamp | `serverTimestamp()` at the moment the guest initiated the call (when the doc is first written). |
| `endedAt` | timestamp \| null | `serverTimestamp()` when status transitions to `ended`. Null while `ringing` or `active`. |
| `endedReason` | string \| null | Audit stamp: `"superseded-by-other-call"` (decision #94 — a new call displaced this one), `"accept-failed"` (decision #214 — claim committed but `getUserMedia` / `createAnswer` / answer write failed), `"cancelled"` (guest hung up before staff accepted), or null while the call is alive. |
| `acceptedBy` | object \| null | **Decision #214 (2026-08-19).** The staff attribution written by the `runTransaction` claim in `acceptCall`. `{ uid: string, name: string, claimedAt: Timestamp }` — `uid` is the staff Firebase Auth UID, `name` is `displayName || email || "Front Desk"`, `claimedAt` is `serverTimestamp()` at the claim commit. The snapshot listener hydrates the field for every admin tab so the loser's inbox banner can render "Already answered by {Name}" instead of a Connect/Mute surface. Null on pre-#214 docs (legacy calls) and on the brief sub-second window between `triggerIncomingCall` and the first claim. |

**Subcollections:**
- `calls/{roomId}/iceCandidates/{id}` — each side's `RTCIceCandidate` plus `from: "guest" | "staff"` + `createdAt`. The admin `acceptCall` subscribes to this subcollection to add the guest's ICE candidates to its local `RTCPeerConnection` (and vice versa on the guest side).

> **Lifecycle:** The collection is fully open (`firebase/firestore.rules:406-408` — `allow read, write: if true;`), the same trust model as `intercoms` per the guest no-login + per-room scan shape. The `acceptedBy` field is staff-writeable by any caller; future hardening (after the consent + per-room occupancy gate lands) could narrow writes to `isStaff()` while keeping reads public for the guest-side SDP handshake.

> **Retention:** Transient — the doc is GC'd by future retention rules after `endedAt + 7 days`. The chat-thread audit trail (the `intercoms/{roomNumber}/messages` `call-answered` / `call-missed` / `call-declined` system messages, see `intercoms` schema above) is the durable record; `calls` is the live signaling state.

> **Why the claim is a `runTransaction` and not a plain `updateDoc`:** the pre-#214 surface was a best-effort last-write-wins race that let two front-desk staff both build a peer connection to the same guest. The `runTransaction` is the only primitive that gives "first commit wins" atomically — the body reads `tx.get(callRef)`, checks `data.status === "ringing"`, and writes `status: "active" + endedAt: null + acceptedBy: { … }` in one commit. Every subsequent staff that tries the same room hits `data.status !== "ringing"` and the transaction aborts. See decision #214 for the full implementation record + the reads-before-writes contract (FOL-03 pattern).

---

### `settings/{settingId}`

Single-document collections holding dynamic configuration:
- `settings/hotelConfig`: `brandName`, `colors`, `logos`, `roomTypes[]` (Maximum 10 photos per type), `paymentMethods[]`, `bookingSources[]`, `discountScope`, `paymentHoldWindowHours`, `unpaidCheckoutApprovalThreshold`, `frontDeskPhone`, `supportEmail`, `dpoEmail`, `facebookUrl`, `instagramUrl`.
- `settings/websiteContent`: Editable homepage, about, corporate, and legal page copy.
- `settings/breakfastConfig`: Silog menu items & daily prep settings.
- `settings/rewardsConfig`: Earning rate, redemption rate, member discount percentage.

---

### `corporateInquiries/{inquiryId}`

| Field | Type | Notes |
|---|---|---|
| `companyName` | string | Inquiring company |
| `contactPerson` | string | Lead contact full name |
| `email` / `phone` | string | Contact details (PII — staff/admin only) |
| `numRooms` | number | Requested block size |
| `preferredDates` | object \| string | `{ from, to }` struct (current) or legacy string; see `plan/features/CORPORATE-INQUIRIES.md` |
| `specialRequirements` | string | Free-text purpose of stay |
| `status` | enum | `"new"` \| `"contacted"` \| `"negotiating"` \| `"converted"` \| `"declined"` |
| `handler` / `notes[]` | string / array | Staff handling + per-touch notes |
| `accessCodeId` | string | Doc ID of the `corporateCodes/{code}` generated for this inquiry |
| `convertedBookingId` / `convertedBookingRef` | string | Back-link to the resulting booking once the inquiry is converted |
| `createdAt` / `updatedAt` | timestamp | Audit |

Public submissions land here via `POST /api/corporate/inquiry` (rate-limited + Turnstile-gated + honeypot). The conversion path (`POST /api/corporate/convert-inquiry`, staff-only) creates a `bookings/{id}` doc and links the two in a single transaction — see `plan/features/CORPORATE-BOOKING.md §Multi-Room Block` and `plan/features/CORPORATE-INQUIRIES.md`.

---

### `corporateCodes/{code}`

| Field | Type | Notes |
|---|---|---|
| `code` | string | Public code string (also the Firestore doc ID in most cases) |
| `companyName` | string | Returned to the public via `/api/validate/corporate-code` |
| `ratePerRoomType` | object | `Record<roomTypeValue, number>` — negotiated nightly rate per room type. Empty object = no negotiated rate; falls back to the type's flat `corporateRate`, then the standard `pricePerNight` |
| `isActive` | boolean | Default `true`; staff flips to `false` to deactivate |
| `expiresAt` | timestamp \| null | Optional expiry; the validator rejects past-dated codes |
| `usageCap` | number \| null | Max uses (sum across all bookings against the code) |
| `usageCount` | number | Server-maintained counter, incremented in-transaction on create + add-room, decremented on cancel. See `plan/features/CORPORATE-BOOKING.md §Corporate Code usageCount Counter Ownership` |
| `createdAt` / `updatedAt` | timestamp | Audit |

The doc ID is the code string by convention. The validate + create handlers both honour a `code`-field fallback for codes whose Firestore doc ID differs from the public `code` field (defense in depth). Public reads go through `POST /api/validate/corporate-code` (rate-limited 10/IP/min + Turnstile-gated) which returns only `{ code, companyName, ratePerRoomType }` — never `usageCount`, `usageCap`, or `expiresAt`. Firestore rules: read/write staff-only (BI-08) — see `plan/docs/SECURITY.md §corporateCodes`.

---

### `vouchers/{code}` *(Per VOU-01, 2026-08-14)*

| Field | Type | Notes |
|---|---|---|
| `code` | string | Public code string (also the Firestore doc ID in most cases). Uppercased on lookup (BI-10) |
| `discountType` | `"percent"` \| `"flat"` | `"percent"` → `% off subtotal`; `"flat"` → fixed ₱ off |
| `discountValue` | number | Percent value (0–100) or flat ₱ value, depending on `discountType` |
| `usageCap` | number \| null | Max uses; null = uncapped. **Per-child semantics (VOU-01)**: each child of a multi-room reservation consumes one use |
| `usageCount` | number | Server-maintained counter. Incremented per-child on create / add-room (`handleCreateBooking` / `handleCreateWalkin` / `handleAddRoomToReservation`); decremented per-cancelled-child on cancel (`handleCancelBooking` reservation-scope uses `Map<code, count>` deduplication per MRB-13; room-scope uses `- 1`). See `plan/features/VOUCHERS.md §Voucher usageCount Counter Ownership` |
| `expiresAt` | timestamp \| null | Optional expiry; the validator rejects past-dated codes. May be stored as ISO string or `{_seconds}` (legacy) — `toDateOrNull` normalizes both shapes (BF-500) |
| `applicableRoomTypes` | string[] | Empty array = applies to all room types. The create handler rejects the booking if any selected room type is not in this list |
| `isActive` | boolean | Default `true`; staff flips to `false` to deactivate. Validator rejects inactive codes |
| `isEnabled` | boolean \| undefined | Legacy alias for `isActive`. New reads should prefer `isActive` |
| `guestEmail` | string \| null | Optional "single-guest" voucher — the validator rejects if the booking email doesn't match. **Per MED-3 / LOW-3**: deferred (see `plan/project/AUDIT-SPARK-REWARDS-REPORT.md §MED-3`) |
| `createdBy` | string | Audit — staff UID |
| `createdAt` / `updatedAt` | timestamp | Audit |

The doc ID is the code string by convention. The validate + create handlers both honour a `code`-field fallback for codes whose Firestore doc ID differs from the public `code` field (BI-10). Public reads go through `POST /api/validate/voucher` (rate-limited 10/IP/min + Turnstile-gated) which returns only `{ code, discountType, discountValue }` — never `usageCount`, `usageCap`, `expiresAt`, or `applicableRoomTypes`. The validator at `shared/utils/vouchers.ts:11` enforces the `isActive` / `expiresAt` / `usageCap` / `applicableRoomTypes` checks. Firestore rules: read/write staff-only — see `plan/docs/SECURITY.md §vouchers`.

**Counter ownership — per VOU-01 (canonical contract, never violate without spec update):**
- `handleCreateBooking` increments by `resolvedRoomSelections.length` (the single top-level `voucherCode` field applies to ALL rooms in the body; the increment is `childrenWithVoucherCount`).
- `handleCreateWalkin` increments by `walkinRoomCount` (the single top-level `voucherCode` field applies to ALL walked-in rooms).
- `handleAddRoomToReservation` increments by `1` (one new child added, regardless of reservation size).
- `handleApplyBookingDiscount` increments by `1` (single-booking discount application).
- `handleCancelBooking` reservation-scope decrements by `Map<code, count>` (a code shared across N cancelled children decrements by N; deduplicated per MRB-13).
- `handleCancelBooking` room-scope decrements by `1` (one cancelled child).

---

### `guests/{userId}`

> This collection holds the staff profile mirror (Firestore doc ID = Firebase Auth UID). Spark Rewards members also write into this collection but the staff-relevant fields below are what admin tooling reads. Per `features/AUTH-ROLES.md` + `features/INTERCOM-AUDIO-ROUTING.md`.

| Field | Type | Notes |
|---|---|---|
| `fullName` / `displayName` | string | Profile name (staff + members) |
| `email` / `phone` | string | Contact (PII — staff/admin only) |
| `photoUrl` | string \| null | Optional avatar |
| `address` / `dateOfBirth` / `emergencyContact` | object / string | Member-only profile fields |
| `preferences` | object | Member preferences (notifications, etc.) |
| `role` | string | `"front-desk"` \| `"admin"` \| absent for non-staff members |
| `isActive` | boolean | Staff-account enable flag (admin-only) |
| `createdBy` / `disabledBy` | string | Staff-audit fields (admin-only) |
| `audioRouting` | object \| null | **Per-staff intercom audio routing** (see `features/INTERCOM-AUDIO-ROUTING.md`). Shape: `{ enabled: boolean, callOutputDeviceId: string \| null, ringtoneOutputDeviceId: string \| null, updatedAt: timestamp }`. Absent (or `null`) = system-default output for both surfaces. Owner-writable per the security rules allowlist; absent is the "no preference" sentinel — the UI treats it as default. |
| `audioRoutingUpdatedAt` | timestamp | Audit timestamp for the last `audioRouting` write |
| `createdAt` / `updatedAt` | timestamp | Audit |

> Lifecycle: `create` / `delete` are admin-only; `update` is admin OR the owner writing only to the self-write allowlist (`fullName` / `displayName` / `phone` / `photoUrl` / `address` / `dateOfBirth` / `emergencyContact` / `preferences` / `audioRouting` / `audioRoutingUpdatedAt` / `updatedAt`). See `firebase/firestore.rules §guests` and `plan/docs/SECURITY.md §guests`.

---

### `members/{memberId}`

| Field | Type | Notes |
|---|---|---|
| `memberNumber` | string | e.g. "SR-10023" |
| `email` / `firstName` / `lastName` / `phone` | string | Member profile data |
| `rewardsPoints` | number | Current points balance |
| `status` | string | `"active"` \| `"suspended"` |
| `createdAt` / `updatedAt` | timestamp | Audit |

Subcollection: `members/{memberId}/pointsHistory/{historyId}` — Append-only ledger of earned, redeemed, adjusted, and clawed-back points.

---

### `storeOrders/{orderId}`

| Field | Type | Notes |
|---|---|---|
| `orderRef` | string | e.g. "SO-20260601-001" |
| `roomId` / `roomNumber` / `bookingId` | string | Room & active booking linkage |
| `items` | array | Ordered store items, quantities, unit prices |
| `totalPrice` | number | Order total |
| `paymentMethod` | string | `"cod"` \| `"add-to-bill"` \| `"gcash"` \| etc. |
| `status` | string | `"placed"` \| `"confirmed"` \| `"out-for-delivery"` \| `"delivered"` \| `"cancelled"` |
| `createdAt` / `updatedAt` | timestamp | Audit |

---

### `notifications/{notificationId}` *(NC-01)*

| Field | Type | Notes |
|---|---|---|
| `type` | string | `"booking_created"` \| `"payment_uploaded"` \| `"booking_confirmed"` \| `"check_in"` \| `"check_out"` \| `"store_order"` |
| `title` / `body` / `link` | string | Notification content & admin drawer deep-link |
| `readBy` | map | Map of `staffUid` → `timestamp` for per-staff read tracking |
| `createdAt` | timestamp | Server timestamp; pruned after 30 days by cron |

---

## Reservation Aggregate Counter Ownership (MRB-15)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-03 sub-item, **REAL BUG FIX** shipped v0.250.0). Pre-MRB-15-03, `handleCheckinBooking` + `handleCheckoutBooking` updated the booking's own `status` but NEVER recomputed the header's `checkedInRoomCount` / `checkedOutRoomCount` in the same `runTransaction` — the counters were silently stuck at `0` forever for N>1. The aggregate `paymentStatus` was a hardcoded `["checked-in"]` / `["checked-out"]` array literal that was only correct for N=1.

### Counter ownership contract (which handler may write which counter)

| Counter | Owners (writes) | Notes |
|---|---|---|
| `roomCount` | `handleCreateBooking`, `handleCreateWalkin`, `handleAddRoomToReservation` | `+= 1` on each new child. Never decremented. |
| `activeRoomCount` | `handleCreateBooking`, `handleCreateWalkin`, `handleAddRoomToReservation`, `handleCancelBooking` | `+= 1` on each new child; `-= cancelledCount` (floored at 0) on cancel. |
| `cancelledRoomCount` | `handleCancelBooking` | `+= cancelledCount`. Never decremented. |
| `checkedInRoomCount` | `handleCheckinBooking`, `handleCheckoutBooking` | Recomputed in the same `runTransaction` by reading the children via `where("reservationId", "==", id)`. Pre-MRB-15-03 was never written. |
| `checkedOutRoomCount` | `handleCheckoutBooking` | Recomputed in the same `runTransaction` by reading the children. Pre-MRB-15-03 was never written. |

### Aggregate `paymentStatus` derivation

The `paymentStatus` field on `reservations/{id}` is now `computeReservationAggregatePaymentStatus(postStatuses)` where `postStatuses` is the array of child statuses read in the same `runTransaction`. Pre-MRB-15-03 it was a hardcoded `["checked-in"]` / `["checked-out"]` array literal — only correct for N=1. The aggregate now correctly reflects N>1 mixed states (a partially-checked-in 3-room reservation shows the aggregate of the three, not a single status).

### Dual-source read pattern (legacy vs new reservations)

The payment + refund subcollection reads use a dual-source pattern based on `bookingReservationId.length > 0`:

- **New reservations** (post-MRB-01, `reservationId` present): reads `reservations/{id}/payments` + `reservations/{id}/refunds`.
- **Legacy** (pre-MRB-01, no `reservationId`): reads `bookings/{id}/payments` (the CRL-01 historical contract — refunds are negative-amount entries on the booking's payments subcollection).

The pattern applies to `handleAddPayment`, `handleAddRefund`, `readTransactionalFolioSnapshot`, `loadReservationEmailView`, `handleLookupBooking`, and the CRL-07 cancellation liability snapshot.

### Test coverage

`guest-app/tests/api/mrb-15-01-lifecycle-invariants.test.ts` (14 tests) + `mrb-15-03-transactional-counters.test.ts` (13 tests) + `mrb-15-08-legacy-fallback.test.ts` (19 tests) — 46 source-text tests pin the counter ownership + dual-source read contracts.
