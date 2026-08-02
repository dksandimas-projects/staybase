# API Routes — Vercel
> Requires: CLAUDE.md, docs/BACKEND.md

---

## Overview

All server-side logic is authored behind the catch-all router at `guest-app/server/apiRouter.ts` and bundled into the single committed Vercel function `guest-app/api/[...route].js`. The `api/` folder is co-located inside `guest-app/` — Vercel picks it up automatically when the root directory is set to `guest-app/`.

Any staged change under `guest-app/server/` or `shared/` must include a rebuilt `guest-app/api/[...route].js`. The pre-commit bundle-freshness check independently rebuilds to a temporary file and rejects stale or unstaged output.

No Firebase Cloud Functions. No separate Vercel project for the API. No separate backend service.

---

## Pattern

All routes follow the path: `/api/[domain]/[action]`

The catch-all handler reads the path segments and dispatches to the appropriate handler function.

---

## Authentication

All admin/staff routes require a valid Firebase ID token in the request header:

```
Authorization: Bearer <firebaseIdToken>
```

The API route verifies the token server-side using the Firebase Admin SDK before processing any request. Never trust role claims from the client.

Public routes (voucher validation, corporate code validation, booking creation, corporate inquiry submission) do not require auth but may perform rate limiting.

Guest member routes require a valid Firebase ID token for the signed-in guest. They are authenticated but not staff-only.

---

## Route Surface

### Email Routes (`/api/email/*`)

| Route | Trigger | Recipient |
|---|---|---|
| `/api/email/booking-submitted` | Guest submits booking | Guest |
| `/api/email/payment-confirmed` | Staff payment brings running total to ≥ `totalPrice` (covers `pending` and `payment-uploaded`; idempotent if already `confirmed`) | Guest |
| `/api/email/booking-confirmed` | Staff confirms via `/api/bookings/confirm`, or walk-in creation resolves to `confirmed` (suppressed for `checked-in`) | Guest |
| `/api/email/checkin-reminder` | 1 day before check-in | Guest |
| `/api/email/booking-cancelled` | Booking cancelled | Guest |
| `/api/email/discount-rejected` | Staff rejects Senior/PWD discount ID | Guest |
| `/api/email/corporate-inquiry` | Staff-only manual resend path for a corporate inquiry notification. Normal public submissions use `/api/corporate/inquiry`, which sends the staff email server-side after Turnstile + honeypot validation. | Staff (admin email) |
| `/api/email/early-checkin-request` | Spark Rewards member requests early check-in for an upcoming booking (from My Rewards page or Intercom) | Staff (admin email) |
| `/api/email/voucher-issued` | Staff re-send path for the voucher-issued template. The normal addVoucher flow fires the email inline from the AdminContext; this endpoint exists for the "Email to guest" action on an existing voucher. Body: `{ voucher: { code, discountType, discountValue, expiresAt, applicableRoomTypes, guestEmail } }`. Recipient (`voucher.guestEmail`) is server-controlled. | Staff |
| `/api/email/store-order-placed` | Triggered by `handleCreateStoreOrder` after the transaction commits; not exposed as a public endpoint. Recipient is looked up server-side from `bookings/{bookingId}.guestEmail`. | Guest (server-resolved) |
| `/api/email/store-order-confirmed` | Triggered by `handleConfirmStoreOrder` when stock is decremented (DECISIONS-FEATURES.md #80). | Guest (server-resolved) |
| `/api/email/store-order-out-for-delivery` | Triggered by `updateStoreOrderStatus` when status flips to `out-for-delivery`. | Guest (server-resolved) |
| `/api/email/store-order-delivered` | Triggered by `updateStoreOrderStatus` when status flips to `delivered`. | Guest (server-resolved) |
| `/api/email/store-order-cancelled` | Triggered by `handleCancelStoreOrder` (guest-initiated) OR `updateStoreOrderStatus` when admin cancels. | Guest (server-resolved) |
| `/api/email/staff-new-booking` | Triggered by `handleCreateBooking` (not walk-in) after the transaction commits. Recipient is `ADMIN_EMAIL` (env `RESEND_ADMIN_EMAIL`, default `config.supportEmail`). | Staff (server-resolved) |
| `/api/email/staff-new-payment` | Triggered by `handleAddPayment` only when `paymentProofUrl` is set on the booking. Idempotent via `emailNotificationsSent.staffNewPayment` timestamp. | Staff (server-resolved) |

All email routes use Resend. Templates are defined server-side. See `plan/features/EMAIL-PDF-STORAGE.md` for full email flow details.

`/api/email/checkin-reminder` accepts staff-authenticated `POST` requests for manual sends and Vercel Cron `GET` requests for daily scheduled sends. Cron requests must use `Authorization: Bearer {CRON_SECRET}` and an empty body so the route sends reminders for all confirmed bookings checking in tomorrow.

---

### Booking Routes (`/api/bookings/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bookings/create` | POST | None | Strict-Zod validates the complete body, including optional `numAdults` + `numChildren`, then creates the booking with a Firestore transaction (availability lock). The transaction requires their sum to match `guests`, normalizes the room type, and evaluates the adult and child caps independently. Body sends `roomType` (not `roomId`); the transaction auto-assigns a physical room of that type. Private uploads send randomized `paymentProofPath` / `discountIdPhotoPath` object paths, never permanent download URLs. Response includes the assigned `roomId` + `roomNumber` and persisted guest-safe `rateBreakdown` for the confirmation page. The corporate "Continue without code" path sends `corporateFlatRate: true` — an intent flag only; the server resolves the flat rate from `roomTypes[].corporateRate` (never a client-supplied number) and a validated `corporateCode` always wins. Per MRB-02 (2026-08-02, per decision #164): the body may also include an optional `reservationId` (UUIDv4, validated against `RESERVATION_ID_REGEX`). When present, the server's transaction reads the `reservations/{id}` header first as the idempotency anchor: same id + same `requestFingerprint` → idempotent replay (returns the existing booking's response with `idempotentReplay: true`); same id + different `requestFingerprint` → 409 `RESERVATION_ID_FINGERPRINT_CONFLICT`; header exists but child missing → 500 `RESERVATION_HEADER_WITHOUT_CHILD`. The single-room public flow (`/book`) preallocates the id via `generateReservationId()` so a retry-after-uncertain-response reuses the same id. Per MRB-02.x corporate (2026-08-02, per decision #164): the corporate `/corporate/book` flow also preallocates the id (same pattern as `/book`). The fingerprint's `isCorporate` + `source` + `companyName` are derived from a new `isCorporateIntent = Boolean(corporateCode) || corporateFlatRate === true` flag so the fingerprint matches the server-validated `corporateDetails` for BOTH the "with code" path AND the "Continue without code" path (pre-fix the "Continue without code" path's fingerprint was `isCorporate: false` + `source: "online"` — a mismatch with the stamped `true` / `"corporate"`). Response always echoes `reservationId` + `reservationRef` + `idempotentReplay` (false on fresh create, true on replay) for symmetry across the three paths. Per MRB-06 Phase 1 (2026-08-02, per decision #159): the body may also include an optional `roomCount` (default 1, max 50). The server's auto-assignment picks N distinct rooms of the requested `roomType` in one transaction (same-room-twice guard — each assigned room is unique within the reservation). For N=1 (the default) the behavior is byte-equivalent to pre-MRB-06. The reservation header's `reservationRoomCount` reflects the N assignments. Per MRB-06 Phase 2 (2026-08-02, per decision #159): the transaction's write phase iterates over the N assigned rooms and writes a `bookings/{id}` doc for each (the first room uses the client's preallocated `bookingId`; the other N-1 rooms auto-mint fresh ids). The header's group totals (`totalPrice` + `originalSubtotal` + `subtotal`) are the N-aggregate (`per-room value * roomCount`). The EXB-10 inventory check counts `totalExtraBeds = extraBedCount * roomCount` (not the per-room count) so N>1 reservations don't silently under-count the hotel's rollaway footprint. The success response echoes the first room's id + number in the legacy `roomId` / `roomNumber` fields (backward compat) plus a `rooms` array carrying ALL N assignments (`bookingId` + `roomId` + `roomNumber` + `reservationPosition` per room) for the N>1 confirmation view. Per MRB-06 Phase 3, an explicit `roomSelections[]` array may instead describe every requested room's type, adult/child occupancy, extra-bed count, breakfast choice, and optional preallocated child ID. The server requires the selection totals to match the top-level guest total, assigns one distinct physical room per selection across mixed room types, prices each stay independently, applies reservation deductions once to the aggregate, and allocates exact rounded totals to the children. The fingerprint includes those per-room choices. The `rooms` response adds type, occupancy, breakfast, extra-bed, and allocated-total projections for confirmation. Omitting `roomSelections` preserves the legacy same-type `roomCount` contract; N=1 remains compatible with the historical single fields. |
| `/api/bookings/create-walkin` | POST | Staff | Strict-Zod validates the full walk-in body, including the derived adult/child total, nested guest details, and an optional finite manual override capped at 1,000,000, before creating the booking with staff auth and transactional conflict checks. Adult and child caps are evaluated independently; total guests are never compared directly with the adult cap. Per MRB-02.x (2026-08-02, per decision #164): the body may also include an optional `reservationId` (UUIDv4, validated against `RESERVATION_ID_REGEX`). When present, the server's transaction reads the `reservations/{id}` header first as the idempotency anchor: same id + same `requestFingerprint` → idempotent replay (returns the existing booking's response with `idempotentReplay: true`); same id + different `requestFingerprint` → 409 `RESERVATION_ID_FINGERPRINT_CONFLICT`; header exists but child missing → 500 `RESERVATION_HEADER_WITHOUT_CHILD`. The walk-in modal doesn't currently preallocate, so the server auto-mints via `generateReservationId()` — a future walk-in client that does preallocate rides the same idempotency contract as the public path. Response always echoes `reservationId` + `reservationRef` + `idempotentReplay` for symmetry across the two surfaces. |
| `/api/bookings/cancel` | POST | None (owner by ref+email) or Staff | Per CRL-03 (2026-08-02): the server-side status matrix is a dual gate — the universal terminal-status reject (`checked-in` / `checked-out` / `cancelled`) plus a source-specific extension. The guest self-service path is restricted to `GUEST_CANCELLABLE_STATUSES = ["pending", "payment-uploaded"]` (no money may have been collected); the staff path covers every pre-arrival status. A guest attempting to cancel a paid booking is funnelled to the front desk with a 400. The same boolean (derived from `req.staff`) gates both the pre-transaction check and the in-transaction re-read, so a concurrent status flip between the two reads is caught. CRL-06 will deliberately expand the guest set after the guest sees a policy-derived financial preview first. Per CRL-02, every cancellation writes `cancelledAt` + `cancelledBy` + `cancellationSource` (`"guest" \| "staff" \| "system"`) in the same `transaction.update` block as the status flip. The post-cancel email uses `cancellationSource` to switch the actor in the intro line and adds an explicit "no refund is automatic" callout (CRL-04). **MRB-13 (decision #166):** the body accepts an optional `scope` field — `"room"` (default, byte-compatible with the current single-child behavior) or `"reservation"`. When `scope === "reservation"` and the booking's `reservationId` is non-null, the server runs a single transaction that cancels every cancellable child, decrements voucher / corporate code `usageCount` exactly once per shared code, and updates the reservation header (`cancelledRoomCount` + `activeRoomCount` + `paymentStatus: "cancelled"` when `activeRoomCount === 0`). The first-created child has no special financial consequence. The guest path always sends `scope: "reservation"` when the looked-up booking has a `reservationId`; the staff path sends whatever the modal selector returns. The existing `ref + (email \| token)` credential is unchanged. See `plan/features/BOOKINGS-MANAGEMENT.md §Reservation-Scope Cancellation (MRB-13)` for the full spec. |
| `/api/bookings/lookup` | POST | None (any one of ref / email / token) | Look up a single booking for the `/my-booking` page. Accepts any one of `bookingRef`, `guestEmail`, or per-booking `lookupToken` (ref+email and ref+token also work; the email+token combination is rejected). Email lookup is case-insensitive and returns the most recent booking for the email. Refs alone are gated by Turnstile + 10/min rate limit + 3-failure 1-hour backoff — see `plan/docs/SECURITY.md §Booking Lookup Security`. Enriches the response with the room name from `rooms/{roomId}`. The response payload intentionally includes `guestName`, `guestEmail`, `guestPhone`, `roomType`/`roomNumber`, and guest-safe `rateBreakdown` so the self-service page can display the booking back to the guest. These fields are the data-subject's own PII or non-sensitive pricing details (per RA 10173 right to be informed + the right to access), and the endpoint enforces Turnstile + rate limit + backoff before returning them. |
| `/api/bookings/add-payment` | POST | Staff | Atomically append an onsite payment using the required client-preallocated `paymentId`; exact retries replay without a duplicate, while reuse with different details is rejected. Moves `pending`/`payment-uploaded` to `payment-confirmed` when the running total reaches `totalPrice`; the committed status transition gates the one-time payment-confirmed email. For a checked-out member folio with a locked pending loyalty award, the final payment also awards those points exactly once. Per MRB-04 Phase 2 (2026-08-02, per decision #159): the payment record writes to `reservations/{reservationId}/payments/{paymentId}` when the booking's `reservationId` is non-null (new reservations post-MRB-01), with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{paymentId}` — byte-equivalent to pre-MRB-04. The booking doc's `payment-confirmed` + loyalty award status transitions are unchanged for both paths. The reservation header's `paymentStatus` mirror update lands with MRB-04 Phase 3. |
| `/api/bookings/verify-and-record-payment` | POST | Staff | Verify an uploaded payment proof and atomically append its payment ledger entry using a required client-preallocated `paymentId`. Exact retries with the same ID replay safely; reusing an ID for different details is rejected, while legitimate equal-amount reference-free installments remain distinct when they use different IDs. Per MRB-04 Phase 2.x (2026-08-02, per decision #159): the verified payment record writes to `reservations/{reservationId}/payments/{paymentId}` when the booking's `reservationId` is non-null (new reservations post-MRB-01), with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{paymentId}` — byte-equivalent to pre-MRB-04. The booking doc's `payment-confirmed` + the `staffNewPayment` notification are unchanged for both paths. |
| `/api/bookings/add-refund` | POST | Admin | Append an immutable negative refund entry after transactionally verifying it does not exceed net collected funds; requires a client-preallocated `refundId`, method, reason, and approver UID. Exact retries with the same ID replay the original commit; reusing an ID with different amount/method/reason/transactionReference is rejected as a 409 conflict. Append-only ledger preserved (CRL-01). Per MRB-04 Phase 2.x (2026-08-02, per decision #159, the "Both, as separate paths" design): the refund record writes to `reservations/{reservationId}/refunds/{refundId}` (the canonical refund source for new reservations post-MRB-01) when the booking's `reservationId` is non-null, with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{refundId}` as a negative-amount entry — byte-equivalent to pre-MRB-04. **Net collected (the dual-read pattern):** for new reservations, the handler reads BOTH `reservations/{id}/payments` (positive) AND `reservations/{id}/refunds` (negative) to compute the sign-aware net. The writer only writes to `refunds/`, so the two arrays are disjoint in normal operation; the helper `getReservationFolioSummary` reads both as belt-and-suspenders. The 409 + 400 ("refund exceeds net collected") + 404 + 500 catch-block mappings are unchanged for both paths. |
| `/api/bookings/mark-payment-confirmed` | POST | Staff | Transactionally flip `payment-uploaded` → `payment-confirmed`, stamp the handling staff member, and send the payment-confirmed email only for the committed transition. Exact retries are idempotent. |
| `/api/bookings/confirm` | POST | Staff | Flip `pending`/`payment-uploaded`/`payment-confirmed` → `confirmed`; fires the booking-confirmed email once |
| `/api/bookings/confirm-with-balance` | POST | Staff | Confirm a `payment-uploaded` booking with an explicitly accepted outstanding balance and required reason. Per MRB-04 Phase 4, reservation-linked bookings compute the threshold against the reservation total, reservation payments/refunds/charges, transitional child ledgers, and delivered Add-to-Bill orders across every child room inside the same transaction as the status/audit write. Legacy null-`reservationId` bookings retain the historical single-booking calculation. |
| `/api/bookings/checkin` | POST | Staff | Flip `confirmed`/`payment-confirmed` → `checked-in` inside a transaction; validates the assigned room is not blocked or occupied by another checked-in booking, then atomically marks the room `occupied` |
| `/api/bookings/checkout` | POST | Staff | Flip `checked-in` → `checked-out`; atomically frees the room and snapshots the charge-inclusive folio. Per MRB-04 Phase 4, a reservation-linked room is gated against the whole reservation balance, including reservation payments/refunds/charges, transitional child ledgers, and delivered Add-to-Bill orders across every room; legacy null-`reservationId` bookings retain the historical single-room calculation. Points still use net `booking.totalPrice` until the separate per-reservation loyalty follow-up. An early departure retains the contracted total while rebuilding the receipt breakdown with an explicit retained-total adjustment. |
| `/api/bookings/reject-discount` | POST | Staff | Reject Senior/PWD discount ID — restores `totalPrice`, sets rejection fields, triggers discount-rejected email |
| `/api/bookings/apply-discount` | POST | Staff | Apply a verified Senior/PWD grant and/or validated voucher to an existing active booking; transactionally re-prices in canonical stacking order and increments voucher usage |
| `/api/bookings/reschedule` | POST | Staff | Move a booking to a new room/date range inside a transaction. Preserves and rescales a locked manual walk-in nightly rate; otherwise recalculates from the target room/date basis. Rejects terminal statuses, overlaps, and active room blocks, and appends `rescheduleHistory[]`. Per MRB-02.x (2026-08-02, per decision #164): when the existing booking has a `reservationId`, the server's transaction reads the `reservations/{id}` header early (before pricing math) so the half-stamped guard fires on inconsistent state — booking has a `reservationId` but the header is missing → 500 `RESERVATION_HEADER_WITHOUT_CHILD`. The header is updated in the same transaction as the booking (new dates + new `numNights` + new `totalPrice` + new `requestFingerprint`; the source / corporate / member context is preserved because the reschedule doesn't change the lead booker). The fingerprint is INTENTIONALLY allowed to change on reschedule — the reschedule IS the legitimate change to the fingerprint. Legacy null-`reservationId` bookings (pre-MRB-02) keep today's self-contained behavior: the reschedule updates the booking but does NOT touch a reservation header. |

Booking creation MUST use a Firestore transaction to prevent double-booking. Public online and corporate bookings use `/api/bookings/create`; staff walk-in/manual bookings use `/api/bookings/create-walkin`. Both routes must perform room active/blocked checks, overlapping booking checks, rate breakdown generation, and booking reference generation inside the transaction. Public online and corporate clients preallocate the Firestore booking document ID before Storage uploads and pass that ID to `/api/bookings/create`; the API creates the document at that exact ID while generating only the guest-facing booking reference inside the transaction. See `plan/features/AVAILABILITY-LOCKING.md`.

Existing booking documents may still receive authenticated staff/admin operational updates directly from the admin app only for the explicit Firestore field allowlist (registration/ID, breakfast, payment reference, discount-verification flags, notes/special requests, handler, and timestamp). Status, pricing, rewards, and other finance-sensitive mutations must use booking API routes.

Walk-in validation completes before the Firestore transaction starts. The strict request schema rejects unknown fields, malformed guest contact data, non-finite/negative manual overrides, and overrides above the per-transaction cap.

---

### Room Block Routes (`/api/room-blocks/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/room-blocks/create` | POST | Staff | Create an active calendar block for a room/date range; rejects overlap with active bookings or active room blocks |
| `/api/room-blocks/update` | POST | Staff | Update an active room block's room/date/reason/notes with the same conflict checks |
| `/api/room-blocks/cancel` | POST | Staff | Mark a room block cancelled so the dates become bookable again |

Room block routes are the sanctioned path for calendar blocking. Do not create `roomBlocks` directly from the client.

---

### Room Routes (`/api/rooms/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/rooms/availability` | GET | None (public, rate-limited) | Return PII-stripped booked date ranges (`{ roomId, checkIn, checkOut, status }`) for active bookings (`pending`, `payment-uploaded`, `confirmed`, `checked-in`) that overlap the requested `checkIn` / `checkOut` window. The guest booking page uses this to hide already-booked rooms in Step 1. Rate-limited to 30/IP/min. The actual double-booking prevention is the Firestore transaction in `/api/bookings/create` — this endpoint is a UX optimization only. See `plan/features/AVAILABILITY-LOCKING.md §Guest-side availability UX query`. |

Never expose full `bookings` documents or any PII (guest name, email, phone, payment fields) in this response — the contract is a PII-stripped date range only.

---

### Corporate Routes (`/api/corporate/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/corporate/inquiry` | POST | None | Submit the public corporate inquiry form; API verifies Turnstile, checks honeypot, creates `corporateInquiries/{id}` with `status: "new"`, and sends the staff notification email |
| `/api/corporate/convert-inquiry` | POST | Staff | Convert a `new` / `contacted` / `negotiating` corporate inquiry into a real `bookings` document. Pre-fills guest details from the inquiry and resolves capacity plus fallback pricing from `settings/hotelConfig.roomTypes[]` inside the transaction. Rate order is explicit override, attached-code `ratePerRoomType[roomType]`, RoomType corporate rate, then RoomType base rate; a zero fallback rate is rejected. Creates the booking with `linkedInquiryId`, server-derived corporate fields, and status `confirmed`, then links the inquiry in the same transaction. |

Guest-facing code must not create `corporateInquiries` directly with the Firestore client SDK. This route is the only public write path so bot checks and validation stay server-side.
`/api/corporate/convert-inquiry` is staff-only because it mutates bookings + corporateInquiries together with a derived negotiated rate. It is the audit-mandated closure of SEV-1 #2 in `§1.4` (S4.2 — "Convert to booking" missing from Corporate Inquiries).

---

### Private Storage Routes (`/api/storage/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/storage/signed-url` | POST | Staff | Validate an allowlisted private payment-proof or discount-ID object path and return a one-hour Admin-SDK-signed read URL. Responses are `private, no-store`; anonymous callers and unrelated Storage paths are rejected. |

---

### Contact Routes (`/api/contact/*`) *(Phase 1 — see `plan/features/CONTACT-INQUIRIES.md`)*

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/contact` | POST | None | Submit the public contact form (Name, Email, Subject, Message); API verifies Turnstile, checks honeypot, rate-limits (5/min/IP), creates `contactInquiries/{id}` with `status: "new"`, and sends the staff notification email to `settings/hotelConfig.supportEmail` |

---

### Validation Routes (`/api/validate/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/validate/voucher` | POST | None | Check voucher code: valid, expired, usage cap, room type |
| `/api/validate/corporate-code` | POST | None | Check corporate access code: valid, expired, usage cap, active |

Both routes return the discount/rate details on success. Never expose full voucher or code documents to the client.

---

### Store Routes (`/api/store/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/store/create-order` | POST | None | Create store order with server-side stock check, active booking lookup, and order ref generation; stock decrements on staff confirmation |
| `/api/store/cancel-order` | POST | None (room + order ref match) | Cancel a placed store order from the guest intercom and restore reserved stock once |
| `/api/store/order-status` | POST | None (room + order ref match) | Return the latest guest-safe order status for the intercom tracker |
| `/api/store/deliver-order` | POST | Staff | Atomically mark an out-for-delivery order delivered and append one deterministic direct-payment tender; Add to Bill creates no tender |

Store order creation MUST use a Firestore transaction to prevent overselling.
Store order cancellation MUST only allow `placed` orders and MUST use a transaction so stock restore is idempotent.
Store order status MUST return only guest-safe metadata (`status`, `updatedAt`) and never expose `paymentProofUrl`, internal notes, or full order records.
Store order delivery MUST use the authenticated server route. Direct-paid tenders are written under the store order so collection-group reports and Daily Close include them without settling the linked booking folio.

---

### Reference Routes (`/api/reference/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/reference/generate` | POST | Staff | Generate next booking reference number (SI-YYYYMMDD-NNN) |

---

### Admin Routes (`/api/admin/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/create-staff` | POST | Admin | Create a staff Firebase Auth user, set the `role` custom claim, and mirror the profile in `guests/{uid}` |
| `/api/admin/disable-staff` | POST | Admin | Disable a staff Firebase Auth user and mark `guests/{uid}.isActive` false; self-disable and last-active-admin disable are rejected |
| `/api/admin/update-staff` | POST | Admin | Update staff user details (displayName, email, phone, role claims, and optional direct password update). Rolls back Auth details on Firestore write failures. |
| `/api/admin/publish-seo` | POST | Admin | Validate and persist `settings/seo.published`, then invoke the server-only Vercel deploy hook so the guest build regenerates static metadata and Hotel JSON-LD. Limited to 5 requests per IP per minute. |

Staff accounts must be created and disabled through these Admin SDK routes. Never expose staff registration in client code, and never let client-side writes set Firebase Auth custom claims.

---

### Janitor Routes (`/api/janitor/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/janitor/storage-sweep` | GET/POST | Cron secret | Delete orphaned Storage upload folders for preallocated booking IDs whose booking document was never created |
| `/api/janitor/stats` | GET | Cron secret | Return recent storage-sweep run history for operator inspection |
| `/api/janitor/h2-backfill` | GET/POST | Cron secret | Backfill lookup tokens onto legacy booking documents in resumable batches |
| `/api/janitor/h2-status` | GET | Cron secret | Report lookup-token backfill progress |

Janitor routes are operational endpoints. They must not be called from guest-facing UI and must be protected with `CRON_SECRET`.

---

### Notification Routes (`/api/notifications/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/notifications/prune` | GET/POST | Cron secret | Hard-delete `notifications` docs older than 30 days (the FLR-03 retention trap). Optional body: `{ maxAgeMs?, batchSize? }` for manual testing. Daily Vercel Cron entry at `0 3 * * *` calls this endpoint. See `plan/features/NOTIFICATION-CENTER.md` and decision #120. |

The bell + panel in the admin app read `notifications` via a **client-side `onSnapshot`** (bounded `limit(50)`, `orderBy("createdAt", "desc")`). No dedicated read endpoint exists — the Firestore rules cover it directly. Persisted notification writes are **not** exposed as a public API; they happen server-side from the existing booking / payment / check-in / check-out / store-order handlers via the `writeNotification` helper in `guest-app/server/lib/notifications.ts`.

---

### Member Routes (`/api/members/*`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/members/register` | POST | Signed-in guest | Enroll the authenticated guest in Spark Rewards, generate the sequential `memberNumber`, create or update `members/{uid}`, and link past bookings by email |
| `/api/members/stays` | GET | Signed-in guest | Return the calling member's guest-safe booking history by `memberId == uid` or `guestEmail == token.email`. Response includes display fields only (`bookingRef`, `lookupToken`, room, dates, nights, total, status, breakfast flag) and never returns staff-only fields such as `paymentProofUrl`, `notes`, or `remarks`. |
| `/api/members/redeem-points` | POST | Staff | Redeem member points against a booking; transactionally deducts member balance, lowers `booking.totalPrice`, rebuilds the locked rate breakdown, stores redemption fields, and appends a `pointsHistory` entry |
| `/api/members/undo-redemption` | POST | Admin | Undo a points redemption while the booking is still `confirmed`; transactionally restores booking total and its locked breakdown, returns member points, clears redemption fields, and logs the reversal |
| `/api/members/set-active` | POST | Admin | Suspend or reactivate a Spark Rewards member account; updates the member document and Firebase Auth disabled state together |
| `/api/members/delete-account` | POST | Signed-in guest | Erase the calling member's account per RA 10173 right to erasure: anonymize every linked booking (write a no-PII audit record to `bookings/audit/records/{id}` first, then scrub `guestName` / `guestEmail` / `guestPhone` / `memberId`), recursively delete the `pointsHistory` subcollection, delete `members/{uid}`, and delete the Firebase Auth user. Body must include `{ confirmation: "erase-my-account" }`. |

Member registration must be server-side because `memberNumber` is sequential and cannot be trusted to client code. Guest apps may update editable profile fields after enrollment where Firestore rules allow it, but they must not create member documents or assign `memberNumber` directly. Member booking history must go through `/api/members/stays`; guest clients must not read the staff-only `bookings` collection directly.
Points redemption routes are server-side because they change booking money fields and member balances together. Never update those documents independently from client code.
Account erasure is server-side because the call must transactionally audit + anonymize linked bookings, recursively wipe subcollections, and remove the Auth user. The client must never delete the member document or `pointsHistory` entries directly — the handler is the only safe path.
The audit collection `bookings/audit/records/{id}` is staff-read-only via Firestore rules (`allow read: if isStaff(); allow write: if false;`); only Admin SDK writes from the API route are permitted.

---

## Bot Prevention

All public-facing routes (booking creation, voucher/code validation) apply a two-layer bot check before any business logic runs. See `plan/docs/SECURITY.md §Bot & Spam Prevention` for full rationale.

### Cloudflare Turnstile Verification

1. Client submits a Turnstile token alongside the request body (`turnstileToken` field)
2. API route POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` + `response` (the token)
3. Cloudflare returns `{ success: true/false }`
4. If `success: false` → return `400 { success: false, error: "Bot verification failed" }` immediately
5. Never proceed to business logic without a valid Turnstile response

**Applies to:** `/api/bookings/create`, `/api/corporate/inquiry`, `/api/validate/voucher`, `/api/validate/corporate-code`

**Bypass policy (per BI-02, booking-intercom audit 2026-07-06):** the only
verification bypass is `NODE_ENV === "test"` (unit tests). Never accept
sentinel tokens (`mock_token`, Cloudflare dummy tokens) outside tests, and
never ship client-side `|| "mock_token"` fallbacks — either one turns every
Turnstile gate into decoration. Local dev works without a bypass: requests
from non-production origins are verified against Cloudflare's always-pass
test secret. Turnstile tokens are single-use — clients must reset the widget
after each token-consuming request.

### Honeypot Check

API route checks for a `_hp` field in the request body (the honeypot field name).
- If `_hp` has any value → silently return `200 { success: true }` (do not create booking, do not tip off bot)
- If `_hp` is empty or absent → proceed normally

**Applies to:** `/api/bookings/create`, `/api/corporate/inquiry`

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `/api/bookings/create` | 5 requests / IP / minute |
| `/api/corporate/inquiry` | 5 requests / IP / minute |
| `/api/validate/voucher` | 20 requests / IP / minute |
| `/api/validate/corporate-code` | 10 requests / IP / minute |
| `/api/bookings/lookup` | 10 requests / IP / minute |
| `/api/rooms/availability` | 30 requests / IP / minute |
| `/api/email/*` | 3 requests / booking ref / hour |

Use Vercel Edge middleware for IP-based rate limiting. Simple in-memory map is sufficient for Phase 1 at this traffic scale.

---

## Request / Response Shape

**Standard success response:**
```
{ success: true, data: { ... } }
```

**Standard error response:**
```
{ success: false, error: "Human-readable message" }
```

Always return appropriate HTTP status codes: `200`, `400`, `401`, `403`, `404`, `500`.

---

## Environment Variables

See `plan/docs/ENV-SETUP.md` for all required API environment variables including `RESEND_API_KEY` and Firebase Admin SDK credentials.
