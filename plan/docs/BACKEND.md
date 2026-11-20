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
| `updatedBy` / `updatedByName` | string \| null | **ATR-03:** the staff uid + display name (at write time) of the last staff member to touch this room's config. The rules pin `updatedBy` to the caller's own uid. |
| `statusChangedAt` / `statusChangedBy` / `statusChangedByName` | timestamp / string \| null | **ATR-03:** who last changed `status`, and when. |
| `housekeepingUpdatedAt` / `housekeepingUpdatedBy` / `housekeepingUpdatedByName` | timestamp / string \| null | **ATR-03:** who last set `housekeepingStatus`. Separate from `updatedBy` because housekeeping is the highest-frequency room write and would bury every other change. |
| `createdBy` / `createdByName` | string \| null | **ATR-03:** who created the room. |

> **Photos, pricing, capacity, bed description, and amenities are NOT stored on individual rooms.** They all live on the **room type** — see `settings/hotelConfig.roomTypes[]` below. Upload path for type photos: Firebase Storage `room-types/{typeValue}/{filename}`.

> **Lifecycle:** Create/Update = Staff; Delete = Admin. Deletion is blocked client-side when any active booking references the room. On delete, the cascade cleans up Storage photos under `rooms/{roomId}/*`, `intercoms/{roomNumber}`, and `calls/{roomNumber}`.

> **Public read:** `rooms` is readable by ANYONE (`allow read: if true` — the guest site subscribes to the collection). It carries no guest PII, but the ATR-03 attribution fields (staff display names) ARE visible to guests. `roomPrivate` stays staff-only.

*Note: Staff-only room notes live in `roomPrivate/{roomId}`.*

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
| `batchId` | string \| null | Shared id for blocks created by one bulk Calendar confirmation; absent on legacy/single blocks |
| `startDate` / `endDate` | timestamp | Inclusive start / exclusive end date |
| `reason` / `notes` | string | Reason and optional staff note |
| `status` | string | `"active"` \| `"cancelled"` |
| `createdBy` / `createdAt` / `updatedAt` | string / timestamp | Audit |

---

### `bookingHolds/{holdId}` *(in-flow hold)*

Ephemeral hold stamp that powers the public booking flow's Steps 2 + 3 countdown banner. The client preallocates `holdId` (UUIDv4) on Step 1 mount and threads it through the URL (`?hold=<id>`); the `useInFlowHold` hook stamps the server-side doc on first read. The booking transaction's post-commit `handleConsumeInFlowHold` marks it `"consumed"`. **The hold is a soft UX signal, not a hard inventory lock** — nothing consults this collection for conflict checks. See `plan/features/BOOKING-FLOW.md §In-flow Hold`.

| Field | Type | Notes |
|---|---|---|
| `reservationId` | string | Mirrors the preallocated reservation id. The consume path uses it as a sanity check — a hold with a stale `reservationId` (the guest restarted the flow) is rejected as `stale-reservation`. |
| `roomType` | string | Room type picked on Step 1. Informational; the authoritative room assignment is still the transaction's type→physical-room pick. Re-stamped per OCT-M7 (decision #296). |
| `checkIn` / `checkOut` | string | YYYY-MM-DD, Step 1 shape. Re-stamped with the booking's check-in per OCT-M7 — the hold's stay IS the booking's stay. |
| `numNights` | number | Snapshotted from the Step 1 picker; re-stamped per OCT-M7. |
| `expiresAt` | timestamp | The hold deadline. Server-stamped from `IN_FLOW_HOLD_MINUTES` (15 default; range 5–30) at start time; **never refreshed** — not by an extension, and not by the OCT-M7 re-stamp. A date change must not reset the window the extension cap exists to bound. |
| `status` | string | `"active"` (banner ticks), `"consumed"` (booking succeeded), `"expired"` (past `expiresAt`). Set by the consume path on Confirm; the Janitor sweep marks stale `"active"` holds `"expired"`. |
| `holdMinutes` | number | Snapshot of `settings/hotelConfig.inFlowHoldMinutes` (per IFH-01.2) at start time. Falls back to `IN_FLOW_HOLD_MINUTES = 15` for legacy settings + hand-edited docs outside the 5..30 range. Lets future reports attribute an expired hold to a specific window even after the per-hotel setting changes. |
| `extensionCount` | number | Per IMT-02 (2026-10-14): how many times `/api/holds/extend` has fired. Absent on pre-IMT docs, which read as `0`. Gates `MAX_IN_FLOW_HOLD_EXTENSIONS = 3`. **Functionally required, not analytics** — the server enforces the cap from it and the guest banner reads it to hide the CTA, so the guest never clicks a button the server would reject. Per CVQ-04 (staff do not see extensions) there is deliberately **no** staff-facing surface and no dedicated extension timestamp; `updatedAt` records the last change. |
| `createdAt` / `updatedAt` | timestamp | Audit. `createdAt` is the ORIGINAL stamp — an extension extends the window, it does not restart the attempt's history. |

> **Lifecycle:** Append-only from the start endpoint. The consume endpoint transitions `"active" → "consumed"`. **Per IMT-02, the extend endpoint (`/api/holds/extend`) may push `"expired" → "active"`** — revival is the literal "I need more time" moment, and it is safe precisely because the hold is soft. `"consumed"` is **never** extendable, and a status outside `"active" | "expired"` is refused fail-closed. The daily Janitor sweep (`/api/holds/sweep`, `guest-app/vercel.json §crons` → `0 2 * * *`) tombstones stale holds `"active" → "expired"` idempotently, so `extensionCount` stays queryable.
> **Firestore rules:** `bookingHolds/{id}` has **no `match` block at all** — default-deny for every client, staff and admins included. Every write goes through the Admin SDK (which bypasses rules); the guest client uses the `/api/holds/*` Vercel routes. A source-text pin in `guest-app/tests/api/in-flow-hold.test.ts` asserts `match /bookingHolds` is absent, so adding a rules block forces a re-review of the client trust model.

---

### `staffInventoryHolds/{holdId}` *(front-desk hard inventory hold)*

Short-lived, staff-created lock used by Calendar **Hold & book**. Authoritative for inventory until consumed, released, or expired; separate from the public soft `bookingHolds` lifecycle.

| Field | Type | Notes |
|---|---|---|
| `roomIds` / `roomNumbers` | string[] | Exact physical room set protected by the hold |
| `startDate` / `endDate` | timestamp | Inclusive start / exclusive end |
| `status` | string | `"active"` \| `"consumed"` \| `"released"` \| `"expired"` |
| `createdBy` | string | Firebase Auth UID; only this staff member may extend, release, or consume it |
| `expiresAt` | timestamp | 15-minute deadline; read-time checks ignore the hold after this instant |
| `reservationId` | string \| null | Added when the walk-in transaction consumes the hold |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps |
| `consumedAt` / `releasedAt` | timestamp \| null | Terminal lifecycle timestamps |

Clients may read this collection only when authenticated as staff; all writes go through staff-authenticated API routes. Composite indexes cover active range reads, room membership conflict checks, and expiry cleanup.

---

### `addOns/{addOnId}` *(BR-12 other add-on catalog)*

The admin-managed catalog of other add-ons the guest can buy (v1 ships the airport transfer). See `plan/features/OTHER-ADD-ONS.md` for the full field table.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name; snapshotted onto the booking at order time |
| `description` | string | Marketing copy |
| `price` | number | PHP; `>= 0`. **Server-authoritative** — the price is never read from the request body (decision #278) |
| `unit` | string | `"per-person"` \| `"per-stay"` |
| `isEnabled` | boolean | Per-add-on master switch; the guest catalog filters on it |
| `cutoffHoursBeforeCheckIn` | number | `0..168`; the lock window, also server-authoritative |
| `displayOrder` | number | Ascending sort in the guest catalog |
| `updatedAt` / `updatedBy` | timestamp / string | Audit fields |

**The admin Settings tab reads and writes this collection DIRECTLY from the browser** through the Firestore client SDK, so it is subject to the security rules:

```
match /addOns/{addOnId} {
  allow read: if isStaff();
  allow create, update, delete: if isAdmin();
}
```

The guest app never reads it directly — the public catalog goes through `GET /api/bookings/addons/config` (Admin SDK, rules not applied) — so **no public read** is granted. The collection shipped in BR-12 (2026-10-15) **without** a rule block, so every admin read + write was `PERMISSION_DENIED` and the tab silently rendered its empty state (decision #279). **Any collection the admin app writes from the browser needs a rule block** — Firestore denies unmatched paths by default.

---

### `auditLogs/{auditId}` *(BR-12.1 settings audit trail → ATR-01 Staff Audit Trail)*

Append-only top-level trail of staff actions. Each row records one action from the CLOSED vocabulary (`addons.create` / `rooms.update` / `bookings.checkin` / …) with the changed fields, a redacted before/after snapshot, and the acting staff member.

| Field | Type | Notes |
|---|---|---|
| `action` | string | `"<domain>.<verb>"` from the closed vocabulary. Validated by the shared Zod schema (`shared/schemas/audit.ts`) AND by the rules. |
| `targetCollection` | string | `"bookings"` \| `"rooms"` \| `"roomPrivate"` \| `"addOns"` \| `"settings"` \| `"rates"` \| `"vouchers"` \| `"guests"` |
| `targetId` | string | Document id |
| `targetLabel` | string \| null | **ATR-01.** Human-readable ("Room 202 — Deluxe"). Never guest PII. |
| `changedFields` | string[] | **ATR-01.** The names of the fields that changed. The ONLY record of a redacted field's change. |
| `before` / `after` | map \| null | Non-redacted changed fields only. `null` for a create / a delete. |
| `actor` | string | Staff Firebase Auth UID. The rules pin a client row to `request.auth.uid`, so a row cannot name someone else. |
| `actorName` | string | Display name AT WRITE TIME (decision 5). |
| `actorRole` | string \| null | `"admin"` \| `"front-desk"` — the role as it was, since roles change. |
| `source` | string | `"server"` (Admin SDK, forensic) \| `"client"` (admin app, advisory). Required. |
| `reason` | string \| null | Optional operational free text the UI already collects (block reason). |
| `timestamp` | timestamp | `serverTimestamp()`. The rules pin it to `request.time`. |

```
match /auditLogs/{auditId} {
  allow read: if isAdmin();
  allow create: if isStaff() && <field validation — see below>;
  allow update, delete: if false;
}
```

The create rule validates: `action` is in the closed set, `targetCollection` is in the closed set, `actor == request.auth.uid`, `timestamp == request.time`, `source` is `"server"`/`"client"`, `changedFields` is a list, and no field outside the table above may be written. Like `addOns`, this collection shipped without a rule block (decision #279), so every audit row was rejected and the `addons.*` actions were permanently lost.

**PII redaction (ATR-01).** A field on the redaction list is recorded in `changedFields` BY NAME ONLY and is NEVER copied into `before` / `after` — a naive snapshot would copy guest personal data into a second collection with a different retention posture. The list lives in `shared/schemas/audit.ts` (`AUDIT_REDACTED_FIELDS`) and `buildAuditEntry()` is the only sanctioned way to build a row.

**Composite indexes** (ATR-07): `(actor, timestamp desc)`, `(targetCollection, targetId, timestamp desc)`, `(action, timestamp desc)` in `firebase/firestore.indexes.json`.

**Rules + indexes + writers ship in ONE commit.** A collection without its rules block loses every write silently — the writer swallows the failure by design, so there is no error anywhere.

---

### Audit subcollection groups: `breakfastAudit` + `otherAddOnAudit` *(BR-01 / BR-12)*

Per-booking audit trails for the breakfast and other-add-on selections, written by the server (Admin SDK) and read by the admin Reports "Late changes" metric via `collectionGroup(db, "breakfastAudit")` / `collectionGroup(db, "otherAddOnAudit")`.

The booking drawer's **History tab** (2026-11-21) ALSO reads them directly, per booking, at `bookings/{id}/breakfastAudit` and `bookings/{id}/otherAddOnAudit` — the `match /{path=**}/…` group rules below cover those paths too, so no new rule block was needed.

Firestore requires an **explicit collectionGroup rule** for a cross-document group query — the per-document rule under `bookings/{id}/…` only covers direct path reads. Without it the client listener fails with "Missing or insufficient permissions" the moment the Reports tab mounts:

```
match /{path=**}/breakfastAudit/{auditId} {
  allow read: if isStaff();
  allow update, delete: if false;
}

match /{path=**}/otherAddOnAudit/{auditId} {
  allow read: if isStaff();
  allow update, delete: if false;
}
```

The same trap already applies to `refunds` (see the `match /{path=**}/refunds/{refundId}` block in `firebase/firestore.rules`). Added by decision #279.
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
| `cancellationLiability` | object \| null | **CRL-07 (decision #173):** the reservation-scope refund-liability aggregate, stamped by reservation-scope cancels (MRB-13) + new-path N=1. **Same shape as the booking-doc field** (see `bookings/{bookingId}` below). The header is the source of truth for the aggregate — Reports (CRL-08) reads it for the pending liability queue. |
| `aggregateRevenueAllocation` | object \| null | **MRB-11 (decision #177):** the sum of every child booking's `revenueAllocation`, recomputed transactionally in the same `runTransaction` as the price write. Same shape + invariant as the booking-doc field (below), with `totalNet` = `reservation.totalPrice`. Absence means "no stored children yet"; pre-MRB-11 reservations have no field. |
| `actualDateRange` | object \| null | **MRB-14 (decision #180):** the denormalised actual range across the children, `{ earliestCheckIn, latestCheckOut, isDivergent }` — derived from MIN(children.checkIn) / MAX(children.checkOut) and stamped transactionally by every add-room + reschedule. `isDivergent === true` ⇔ ∃ a child whose dates differ from the header's. The header's own `checkIn` / `checkOut` / `numNights` are **immutable shared-dates snapshots from create time**; the actual range is shown when the children disagree. |
| `createdAt` / `updatedAt` / `createdBy` | timestamp / string | Audit |

**Subcollections:**
- `reservations/{id}/payments/{paymentId}` — Server-only create, staff read, no client edit/delete.
- `reservations/{id}/refunds/{refundId}` — Server-only create, staff read, no client edit/delete.
- `reservations/{id}/charges/{chargeId}` — Staff create with void semantics.

**Client-side read pattern (MRB-12, decision #179):** `AdminContext` hydrates two read paths so the Bookings table reservation row + the drawer reservation strip render group-level state without summing the filtered in-memory children. **(1) `subscribeToReservations`** — a full-collection `onSnapshot` on `reservations` hydrating `Reservation[]`. **(2) `collectionGroup("payments")` aggregate** — one listener filters in JS to `reservations/{id}/payments/{paymentId}` paths (legacy `bookings/{id}/payments/…` entries excluded) and sums positive + negative entries into a `Record<reservationId, paidAmount>`, matching `getReservationFolioSummary`'s sign-aware `paymentsTotal`. **Header-as-source-of-truth invariant:** Total reads `reservation.totalPrice`, Balance reads `Math.max(0, totalPrice − paidAmount)`.

*Detailed MRB implementation narratives archived in [`plan/project/archive/BACKEND-ARCHIVE-2026-08-02.md`](plan/project/archive/BACKEND-ARCHIVE-2026-08-02.md).*

MRB-06 public creates may contain an explicit room selection per requested stay. The create transaction locks one distinct physical room per selection, validates occupancy against that room type, prices each room, applies reservation-level deductions once to the aggregate, then allocates exact rounded totals back to the child bookings. One reservation header continues to own the lead guest, consent, payment proof/state, and group totals.

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
| `source` / `notes` / `handledBy` | string | Booking source & staff notes. **`handledBy` = the LAST staff member to touch this booking** (documented, not renamed). The rules pin it to the caller's own uid. |
| `createdBy` / `createdByName` | string \| null | **ATR-04.** Stamped ONCE at create and NEVER overwritten: `"guest"` (+ `"Guest"`) for a public online booking, the staff uid (+ display name) for a walk-in. Answers "kinsay nag walkin book?". |
| `checkedInAt` / `checkedInBy` / `checkedInByName` | timestamp / string \| null | **ATR-04.** `checkedInAt` + `checkedInBy` have been written by the server since the FOL-03 pass (they were in no type and no MD until ATR-04); `checkedInByName` is the display-name companion. |
| `checkedOutBy` / `checkedOutByName` | string \| null | **ATR-04.** `checkedOutBy` has been written by the server since the FOL-03 pass; `checkedOutByName` is the display-name companion. |
| `memberId` / `memberDiscountPct` / `pointsRedeemed` / `pointsAwarded` | string / number | Spark Rewards loyalty fields |
| `checkedOutAt` / `checkedOutBy` / `checkedOutWithBalance` | timestamp / string / number | Checkout audit & balance snapshot |
| `confirmedWithBalance` / `confirmedWithBalanceReason` | number / string \| null | Partial payment confirmation audit (CWB) |
| `guestRegistration` / `guestIdPhotoUrl` | object / string \| null | Physical check-in registration data & ID photo |
| `breakfastSelections` | map | `bookings/{bookingId}.breakfastSelections` map: `yyyy-mm-dd-guest-n` → selected silog item name |
| `breakfastServed` / `hasBreakfast` / `breakfastRate` | map / bool / number | Breakfast add-on & daily silog selection maps |
| `earlyCheckIn` | object \| null | Optional early-arrival workflow record. `source` is `guest-request` or `staff-granted` (absent legacy value means guest request); includes status, requested/confirmed time, guest/staff notes, and created/resolved audit fields. Admin grant writes are server-authorized and transactional. |
| `cancellationReason` / `cancelledAt` / `cancelledBy` / `cancellationSource` | string / timestamp \| null | Permanent cancellation record |
| `cancellationLiability` | object \| null | **CRL-07 (decision #173):** the durable refund-liability snapshot stamped by per-child + legacy null-`reservationId` cancels. `{ policyResult: { refundPct, policyRefund, netCollected, retainedAmount, cutoffHours, source, snapshottedAt }, approvedAmount, exception: { approvedAmount, reason, approvedBy, approvedAt } \| null }`. `policyResult` is immutable post-cancel; `approvedAmount` is reduced only via `POST /api/bookings/cancellation-exception`. Absent = "no liability work to do". See `computeCancellationLiabilityState`. |
| `revenueAllocation` | object \| null | **MRB-11 (decision #177):** the per-stream revenue allocation snapshotted at create time (recomputed on reschedule). `{ roomNet, breakfastNet, addOnNet, deductionNet, totalNet }` with `roomNet + breakfastNet + addOnNet − deductionNet === totalNet` (asserted at the write boundary). Absence = "pre-MRB-11 booking"; `getBookingRevenueStreams` falls back to the legacy heuristic. |
| `otherAddOnSelections` / `otherAddOnTotal` / `hasAnyOtherAddOns` | map / number / bool | **BR-12 (decision #247; OCT-M4 #297):** the per-date × per-add-on selection map, its denormalised total, and the O(1) "has any" flag. The total sits ON TOP of `booking.totalPrice` for the BALANCE (see §The folio balance model below). Stored at 2dp (OCT-L3 #301). |
| `createdAt` / `updatedAt` | timestamp | Audit timestamps |

#### The folio balance model (OCT-FOL-01, 2026-10-20, decision #298)

`booking.totalPrice` is the ROOM BILL (breakfast + extra beds included). It does **NOT** contain the BR-12 other add-ons — per `plan/features/OTHER-ADD-ONS.md` decision 2 they are "added on top of it for the balance":

```
folio grand total = booking.totalPrice + otherAddOnTotal + storeTotal + chargesTotal
folio balance     = grand total − paymentsTotal
```

`otherAddOnTotal` is optional (a pre-BR-12 booking contributes 0) and is the SUM of the children's for a multi-room reservation. The math lives in `computeBookingFolio` + `computeServerFolioTotals` (`shared/utils/bookingFolio.ts`). Full rule + the surfaces that still show the room bill: `plan/features/OTHER-ADD-ONS.md §The other add-ons are part of the BALANCE`.

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

> **Staff-only since 2026-10-20 (PR-AUDIT-B3/B5).** The guest's live thread moved to `intercomSessions/{sessionToken}/messages` (documented below) because the room-scoped path was world-readable. This path is now staff read/write only; it is retained for the desk's history and for the `sender: "system"` call-outcome rows.

Every chat-thread message is stored here, including the system's own audit trail for WebRTC call lifecycle events. The only special case is `sender: "system"` for the three call-history outcomes (see below). The subcollection is the source of truth for the chat panel render in `IntercomChatPanel.tsx`.

| Field | Type | Notes |
|---|---|---|
| `text` | string | The message body. For `sender: "system"` + a `messageType` this is the pre-formatted line (e.g. `"Call answered at 2:14 PM · 3m 22s"`); otherwise the raw typed text. |
| `sender` | string | `"guest"` \| `"front-desk"` \| `"system"`. Required — lets the render layer bucket by alignment. |
| `guestName` | string | Display name. Guests: the room's current chat name. Staff + system: literal `"Front Desk"`. |
| `timestamp` | timestamp | `serverTimestamp()` at write time. The rule `timestamp == request.time` enforces it — clients can't backdate. |
| `isRead` | boolean | `false` for incoming guest messages until staff opens the thread; `true` for staff replies and all system messages (no unread bubble for call history). |
| `isQuickRequest` | boolean | Drives the blue "Quick request" pill. |
| `isStoreOrder` | boolean | Routes the message into the `StoreOrderMessageCard` render path. |
| `orderRef` | string \| null | `storeOrders` doc id when `isStoreOrder` is true. |
| `isEarlyCheckInRequest` | boolean | Drives the early-check-in staff action surface. |
| `currentStayId` | string \| null | Echo of the room's `currentStayId` at write time — lets staff filter the thread by stay server-side. |
| `messageType` | string \| null | The audit-type discriminator. Undefined for normal chat. Set (and required by the rules) when `sender === "system"`: `"call-answered"` \| `"call-missed"` \| `"call-declined"`. Drives the centred footer row (Phone / PhoneMissed / PhoneOff icons). |
| `callStartedAt` | timestamp \| null | For `"call-answered"`, the server-side start of the audio stream; with `callDuration` it gives the full telemetry. Null for missed/declined. |
| `callDuration` | number \| null | Seconds. `"call-answered"`: how long staff stayed connected. `"call-missed"`: how long it rang. Null for `"call-declined"` (a decline is instantaneous by design). |

> **Lifecycle:** append-only from the staff side; rows are never edited. Guest messages are inserted by the server only (the rate-limited `/api/intercom/send-message` route) and land in the session-scoped path below — not here. Per `firestore.rules §intercoms.messages`, staff may create with `sender ∈ {guest, front-desk, system}`, but `sender === "system"` REQUIRES `messageType ∈ {call-answered, call-missed, call-declined}` — ad-hoc system docs without an audit type are denied at the rule layer.

> **Why the call lifecycle lives in `callSessions/{sessionToken}` instead:** that state is transient (GC'd after hangup), while the chat thread is the surface where a guest's call history is reviewed alongside their messages — so the message-level audit survives the GC.

---

### `calls/{roomNumber}` *(Per decision #214, 2026-08-19)*

> **Staff-only since 2026-10-20 (PR-AUDIT-B4).** Call signalling moved to `callSessions/{sessionToken}` (documented below) because this path was publicly readable *and* writable — an anonymous caller could read a call document or inject an SDP offer pointing the guest's peer connection at an attacker. This path is now staff read/write only and is retained for the desk's legacy call history.

Legacy room-scoped signalling record for the intercom voice call. The doc id IS the room number (same as `intercoms/{roomNumber}`), so a 1:1 room lookup is implicit. **Field shapes are identical to `callSessions/{sessionToken}`** except that the room is the doc id rather than a `roomNumber` field. Subcollection: `calls/{roomId}/iceCandidates/{id}` — each side's `RTCIceCandidate` plus `from: "guest" | "staff"` + `createdAt`; staff-only since 2026-10-20.

> **Lifecycle:** staff read/write (`match /calls/{roomId}/{document=**}`); live signalling now runs through `callSessions/{sessionToken}`, and this path is the legacy room-scoped record. **Retention:** transient — GC'd after `endedAt + 7 days`; the chat-thread system messages are the durable record. **Why the claim is a `runTransaction`:** the pre-#214 surface was a last-write-wins race that let two front-desk staff both build a peer connection to the same guest — the transaction makes "first commit wins" atomic (decision #214, FOL-03 pattern).

---

### `intercomSessions/{sessionToken}/messages/{messageId}` *(Per PR-AUDIT-B3, 2026-10-20)*

The guest's **live** intercom thread. The path carries the capability: a 32-hex-character token (128 bits, `crypto.randomBytes(16)`) that only the guest and the server know — the same "unguessable share link" model the booking-lookup token uses. Issued by `POST /api/intercom/verify-guest`, re-used for the stay, regenerated when the stay changes. The room → token mapping lives on `intercoms/{roomNumber}.currentStayToken`. Fields are the same as the legacy thread above, plus `roomNumber` (string) — the session path no longer encodes the room.

> **Lifecycle:** `allow read: if true` (capability — `firestore.rules §intercomSessions`). `allow create: if false` — **guest messages are written by the server only**, after it re-verifies the stay (room match + `checked-in` + token match) and derives `guestName` from the booking rather than the request body (PR-AUDIT-B6). The guest may only `update` the `isRead` flag on the desk's messages. Staff may write freely.
> **The capability model's honest limit:** *any* constructible path is readable — the price of guest realtime read without guest authentication. The per-stay binding is enforced by the **server**, which re-verifies the stay on every send.

---

### `callSessions/{sessionToken}` *(Per PR-AUDIT-B4, 2026-10-20)*

Live WebRTC signalling for the intercom voice call, addressed by the same per-stay capability token. The guest writes the offer + ICE candidates; the desk writes the answer. Neither side is authenticated as a guest — the token IS the credential. Fields: `offer` / `answer` (`RTCSessionDescriptionInit | null`), `status` (`"ringing"` | `"active"` | `"ended"`), `guestName`, `roomNumber`, `startedAt` / `endedAt`, `endedReason`, `acceptedBy` (shape `{ uid, name, claimedAt }` — `plan/features/INTERCOM-INBOX.md`, `plan/docs/TYPES.md`). Subcollection: `callSessions/{sessionToken}/iceCandidates/{candidateId}` — each side's `RTCIceCandidate` plus `from` + `createdAt`.

> **Lifecycle:** `allow read, write: if true` (capability). `allow delete: if isStaff()`. The desk's second-call-wins logic (decision #94) and the claim transaction are unchanged — only the path changed. `collectionGroup(db, "callSessions")` is how the admin inbox discovers live calls.

---

### `settings/{settingId}`

Single-document collections holding dynamic configuration:
- `settings/hotelConfig`: `brandName`, `colors`, `logos`, `roomTypes[]` (Maximum 10 photos per type), `paymentMethods[]`, `bookingSources[]`, `discountScope`, `paymentHoldWindowHours`, `inFlowHoldMinutes` (per IFH-01.2, 5..30 min default 15), `unpaidCheckoutApprovalThreshold`, `address`, `frontDeskPhone`, `supportEmail`, `dpoEmail`, `facebookUrl`, `instagramUrl`, `checkInTime`, `checkOutTime`, `otherAddOnsEnabled` (per OCT-M1 #295 — **only an explicit `false` disables it**), `intercomChatEnabled` + `intercomCallsEnabled` (per IFS-01 #318 — the hotel-wide in-room feature switches; **only an explicit `false` disables one**; read by the guest-app server gate, projected to the guest panel, and mirrored into the admin desk)
  - HC-01/HC-02 (#328/#329): the contact details AND the check-in/check-out times have ONE source of truth (this doc; `hotel.config.ts` = fallback); legacy `contactEmail`/`contactPhone` never read; the house rules may quote them via `{{checkInTime}}`/`{{checkOutTime}}`.
- `settings/websiteContent`: Editable homepage, about, corporate, and legal page copy.
- `settings/breakfastConfig`: Silog menu items & daily prep settings.
- `settings/rewardsConfig`: earning rate, redemption rate, member discount %, plus the Phase 2 fields (`welcomePoints`, `minPointsToRedeem`, `pointsCanPayUpToBillPct`, `freeNightEvery`, `levels[]`) and `allowMemberPointsRedemption` (admin opt-in for member self-service redemption; default `false` keeps the front-desk-mediated model). Validation contract: `shared/schemas/rewardsConfig.ts`; rollout: `plan/features/SPARK-REWARDS.md §Phase 2 PR #9`.

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

The doc ID is the code string by convention, and the validate + create handlers honour a `code`-field fallback when the doc ID differs from the public `code` field (BI-10). Public reads go through `POST /api/validate/corporate-code` (rate-limited + Turnstile-gated), which returns only the code + the negotiated rate map — never `usageCount`, `usageCap`, or `expiresAt`. **Firestore rules (since PR-AUDIT-B2, 2026-10-20):** staff read/write, PLUS a member may read their OWN voucher; promo codes stay staff-only. See `plan/docs/SECURITY.md §vouchers`.

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
| `guestEmail` | string \| null | Optional "single-guest" voucher — the validator rejects if the booking email doesn't match. **Per MED-3 / LOW-3**: deferred (see `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md §MED-3`) |
| `createdBy` | string | Audit — staff UID |
| `createdAt` / `updatedAt` | timestamp | Audit |
| `kind` | `"promo"` \| `"reward"` | **Phase 5 (2026-10-12)**: voucher discriminator. `"promo"` = the legacy default (admin-created discount); `"reward"` = system-issued from the tier program (`"free-night-tier"` today, `"welcome"` reserved for Phase 6). Absent = `"promo"`. |
| `valueType` | `"percent"` \| `"flat"` \| `"free-night"` | **Phase 5 (2026-10-12)**: canonical reward type. For `"reward"` vouchers this is `"free-night"` (uses `discountType: "percent"` + `discountValue: 100`). For pre-Phase-5 promo vouchers, absent = treated as `discountType`. |
| `memberId` | string \| null | **Phase 5 (2026-10-12)**: back-link to `members/{uid}` for reward vouchers (null for promo) — the member portal (Phase 7) surfaces these free-night vouchers. |
| `memberNumber` | string \| null | **Phase 5 (2026-10-12)**: denormalised `SR-XXXXX` for display. Null for promo vouchers. |
| `rewardSource` | `"free-night-tier"` \| `"welcome"` \| null | **Phase 5 (2026-10-12)**: which Phase 2 feature created the voucher. `"free-night-tier"` is wired by `handleCheckoutBooking` when `completedStays % freeNightEvery === 0`; `"welcome"` reserved for Phase 6 (not yet wired). |

The doc ID is the code string by convention, and the validate + create handlers honour a `code`-field fallback when the doc ID differs from the public `code` field (BI-10). Public reads go through `POST /api/validate/voucher` (rate-limited 10/IP/min + Turnstile-gated), which returns only `{ code, discountType, discountValue }` — never `usageCount`, `usageCap`, `expiresAt`, or `applicableRoomTypes`. The validator at `shared/utils/vouchers.ts:11` enforces the `isActive` / `expiresAt` / `usageCap` / `applicableRoomTypes` checks. Firestore rules: read/write staff-only — see `plan/docs/SECURITY.md §vouchers`.

**Counter ownership — per VOU-01 (canonical contract, never violate without spec update):**
- `handleCreateBooking` increments by `resolvedRoomSelections.length` (the single top-level `voucherCode` field applies to ALL rooms in the body; the increment is `childrenWithVoucherCount`).
- `handleCreateWalkin` increments by `walkinRoomCount` (the single top-level `voucherCode` field applies to ALL walked-in rooms).
- `handleAddRoomToReservation` increments by `1` (one new child added, regardless of reservation size).
- `handleApplyBookingDiscount` increments by `1` (single-booking discount application).
- `handleCancelBooking` reservation-scope decrements by `Map<code, count>` (a code shared across N cancelled children decrements by N; deduplicated per MRB-13).
- `handleCancelBooking` room-scope decrements by `1` (one cancelled child).

---

### `guests/{userId}`

> The staff profile mirror (Firestore doc ID = Firebase Auth UID). Spark Rewards members also write here, but the staff-relevant fields below are what admin tooling reads. Per `features/AUTH-ROLES.md` + `features/INTERCOM-AUDIO-ROUTING.md`.

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
| `audioRouting` | object \| null | **Per-staff intercom audio routing** (see `features/INTERCOM-AUDIO-ROUTING.md`). Shape: `{ enabled, callOutputDeviceId, ringtoneOutputDeviceId, updatedAt }` — absent or `null` means system-default output for both surfaces, and the UI treats absent as "no preference". |
| `audioRoutingUpdatedAt` | timestamp | Audit timestamp for the last `audioRouting` write |
| `createdAt` / `updatedAt` | timestamp | Audit |

> Lifecycle: `create` / `delete` are admin-only; `update` is admin OR the owner writing only to the self-write allowlist (`fullName` / `displayName` / `phone` / `photoUrl` / `address` / `dateOfBirth` / `emergencyContact` / `preferences` / `audioRouting` / `audioRoutingUpdatedAt` / `updatedAt`). **A write that changes `audioRouting` must also change `audioRoutingUpdatedAt`** — enforced by the `audioRoutingStamped()` rule function (`hasOnly()` is a subset check and cannot express the pairing; decision #307). See `firebase/firestore.rules §guests`.

---

### `members/{memberId}`

| Field | Type | Notes |
|---|---|---|
| `memberNumber` | string | e.g. "SR-10023" |
| `email` / `firstName` / `lastName` / `phone` | string | Member profile data |
| `rewardsPoints` | number | Current points balance |
| `status` | string | `"active"` \| `"suspended"` |
| `completedStays` | number | **Phase 2 (2026-10-12)**: counter incremented atomically at checkout (same `runTransaction` as the points credit, per FOL-03 read-before-write). Not decremented on post-settlement cancellation (MRB-05). Absent = 0. |
| `currentLevel` | object \| null | **Phase 2 (2026-10-12)**: cached `LevelDef` snapshot — refreshed at checkout and at member registration. Null below the lowest configured tier's threshold, or for deployments without tiers. The booking engine falls back to the legacy global `memberDiscountPct` for tier-less members. |
| `createdAt` / `updatedAt` | timestamp | Audit |

Subcollection: `members/{memberId}/pointsHistory/{historyId}` — append-only ledger of earned, redeemed, adjusted, and clawed-back points. **Phase 6 (2026-10-13)**: the deterministic doc ID `welcome` is reserved for the member-onboarding credit (one-shot, written by `handleRegisterMember` when `rewardsConfig.welcomePoints > 0`) — a single `.get()` idempotency check inside the transaction, no query fan-out.

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
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-03, **REAL BUG FIX**). Pre-MRB-15-03, check-in + checkout updated the booking's own `status` but NEVER recomputed the header's `checkedInRoomCount` / `checkedOutRoomCount` in the same `runTransaction` — the counters were silently stuck at `0` forever for N>1, and the aggregate `paymentStatus` was a hardcoded array literal correct only for N=1.

### Counter ownership contract (which handler may write which counter)

| Counter | Owners (writes) | Notes |
|---|---|---|
| `roomCount` | `handleCreateBooking`, `handleCreateWalkin`, `handleAddRoomToReservation` | `+= 1` on each new child. Never decremented. |
| `activeRoomCount` | `handleCreateBooking`, `handleCreateWalkin`, `handleAddRoomToReservation`, `handleCancelBooking` | `+= 1` on each new child; `-= cancelledCount` (floored at 0) on cancel. |
| `cancelledRoomCount` | `handleCancelBooking` | `+= cancelledCount`. Never decremented. |
| `checkedInRoomCount` | `handleCheckinBooking`, `handleCheckoutBooking` | Recomputed in the same `runTransaction` by reading the children via `where("reservationId", "==", id)`. Pre-MRB-15-03 was never written. |
| `checkedOutRoomCount` | `handleCheckoutBooking` | Recomputed in the same `runTransaction` by reading the children. Pre-MRB-15-03 was never written. |

### Aggregate `paymentStatus` derivation

The `paymentStatus` field on `reservations/{id}` is now `computeReservationAggregatePaymentStatus(postStatuses)`, where `postStatuses` is the array of child statuses read in the same `runTransaction` — so a partially-checked-in 3-room reservation shows the aggregate of the three, not a single status.

### Dual-source read pattern (legacy vs new reservations)

The payment + refund subcollection reads use a dual-source pattern based on `bookingReservationId.length > 0`:

- **New reservations** (post-MRB-01, `reservationId` present): reads `reservations/{id}/payments` + `reservations/{id}/refunds`.
- **Legacy** (pre-MRB-01, no `reservationId`): reads `bookings/{id}/payments` (the CRL-01 historical contract — refunds are negative-amount entries on the booking's payments subcollection).

The pattern applies to `handleAddPayment`, `handleAddRefund`, `readTransactionalFolioSnapshot`, `loadReservationEmailView`, `handleLookupBooking`, and the CRL-07 liability snapshot.

### Test coverage

46 source-text tests in `guest-app/tests/api/mrb-15-*.test.ts` pin the counter ownership + dual-source read contracts.
