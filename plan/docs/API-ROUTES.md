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
| `/api/bookings/create` | POST | None | Strict-Zod validates the complete body, then creates the reservation in one Firestore transaction (availability lock). Rooms are requested by TYPE, never by id — the transaction auto-assigns N distinct physical rooms (same-room-twice guard). Occupancy: `numAdults` + `numChildren` must sum to `guests`; adult and child caps are evaluated independently against the normalized room type. **Multi-room:** `roomSelections[]` describes each requested room's type, occupancy, extra beds, breakfast, and optional preallocated child id; selection totals must match the top-level guest total. Mixed types are allowed — each stay is priced independently, reservation-level deductions apply once to the aggregate, and exact rounded totals are allocated back to the children. Omitting it falls back to the same-type `roomCount` (default 1, max 50); N=1 keeps the historical single-room shape. Each child booking gets its OWN `bookingRef` and `lookupToken`, so the reservation consumes N consecutive daily sequence numbers and the counter advances by N; the reservation ref takes the first. The EXB-10 inventory check counts the reservation's total extra beds. **Idempotency:** an optional client-preallocated `reservationId` (UUIDv4) anchors the transaction — same id + same `requestFingerprint` → replay with `idempotentReplay: true`; same id + different fingerprint → 409 `RESERVATION_ID_FINGERPRINT_CONFLICT`; header without child → 500 `RESERVATION_HEADER_WITHOUT_CHILD`. `/book` and `/corporate/book` both preallocate so a retry after an uncertain response reuses the id. **Corporate:** `corporateFlatRate: true` is an intent flag only — the server resolves the rate, never the client, and a validated `corporateCode` always wins. The negotiated rate is resolved per stay type from `corporateCodes/{code}.ratePerRoomType`, then the stay type's flat `corporateRate`, then the standard `pricePerNight`. The code's `usageCount` increments by the number of assigned rooms (N rooms = N uses), and the cap check accepts an optional `requestedUses` so an over-cap block is rejected before any write (`usageCount + requestedUses > usageCap`). Private uploads send randomized `paymentProofPath` / `discountIdPhotoPath` object paths, never permanent download URLs. Response echoes `reservationId` + `reservationRef` + `idempotentReplay`, the first room in the legacy `roomId` / `roomNumber` fields, a `rooms[]` array of all assignments with their allocated totals, and a guest-safe `rateBreakdown`. Change-by-change history in [`plan/project/archive/API-ROUTES-ARCHIVE-2026-08-02.md`](../project/archive/API-ROUTES-ARCHIVE-2026-08-02.md). |
| `/api/bookings/create-walkin` | POST | Staff | Strict-Zod validates the full walk-in body before creating the reservation with staff auth and transactional conflict checks. Unlike the public route the desk picks each PHYSICAL room, and the rooms may be of different types. **Multi-room:** an optional `rooms[]` list (1–50 entries of `roomId` + `numAdults` + `numChildren` + optional `extraBedCount`) is canonical when present; the server 400s unless `roomId === rooms[0].roomId`, `guests` equals the summed occupancy, no room repeats, and every stay has a guest. Omitting it derives a single line from the top-level fields. Each stay is validated and priced against its OWN type entry (capacity/child caps, EXB-03 overflow, `maxExtraBeds`, seasonal-aware rate). Breakfast bills from each stay's own occupancy — once per guest per reservation, never per guest per room. Every room runs the usual availability gates and any failure aborts the transaction: all-or-nothing. **Money:** a manual `totalPriceOverride` prices the whole reservation and a voucher applies once per reservation (MRB-09); both are allocated across stays in proportion to each stay's subtotal (remainder on room 1), and the reservation `totalPrice` IS the sum of the stored allocations so reports reconstruct exactly (MRB-11). A room-type-restricted voucher must cover every type in the reservation. The optional manual override is finite and capped at 1,000,000. Writes one `bookings/{id}` per stay (first uses the preallocated `bookingId`, rooms 2..N auto-mint) with its own room, occupancy, extra-bed snapshot, rate breakdown, allocation, `reservationPosition`, lookup token, and its own `bookingRef` — the daily counter advances by N, since "ref + email" lookup assumes a ref identifies one room stay. Header `roomCount` / `activeRoomCount` / `checkedInRoomCount` reflect N; an immediate check-in occupies every room. **Idempotency:** same optional `reservationId` matrix as the public route (replay / 409 / 500); the modal does not preallocate today, so the server auto-mints. Response echoes `reservationId` + `reservationRef` + `idempotentReplay`. Change-by-change history in [`plan/project/archive/API-ROUTES-ARCHIVE-2026-08-02.md`](../project/archive/API-ROUTES-ARCHIVE-2026-08-02.md). |
| `/api/bookings/cancel` | POST | None (owner by ref+email) or Staff | Per CRL-03/06 (2026-08-02): the universal terminal-status reject is `checked-in` / `cancelled`; guest and staff self-service both cover the four pre-arrival statuses. The guest UI loads the authenticated financial preview before confirmation. Paid cancellation never moves money automatically; any policy refund remains a staff action. The same source boolean gates the pre-transaction check and in-transaction re-read. Per CRL-02, every cancellation writes `cancelledAt` + `cancelledBy` + `cancellationSource` in the same status transaction. **MRB-13:** optional scope is `"room"` (default) or `"reservation"`; reservation scope cancels every eligible child in one transaction and updates the reservation header. The guest path uses reservation scope for a reservation view; staff chooses the scope. **CRL-07 (2026-08-03, per decision #173):** the destructive cancel now materialises a durable `cancellationLiability` snapshot onto the cancelled entity in the SAME `runTransaction` as the status flip — `reservations/{id}.cancellationLiability` for reservation-scope cancels + new-path N=1, `bookings/{id}.cancellationLiability` for per-child cancels + legacy null-`reservationId` bookings. The helper `computeCancellationLiabilityInTransaction` reads the reservation folio (dual-read pattern: `payments/` + `refunds/`) or the legacy booking's `payments/`, calls `evaluateCancelPreview` with the cancellable-children set, and produces a `buildCancellationLiabilitySnapshot` shape with the immutable `policyResult` + a default `approvedAmount === policyResult.policyRefund`. The handler skips the field when `policyRefund === 0` (the absence means "no liability work to do" — a no-refund cancel doesn't need a snapshot). The snapshot + the status flip + the audit stamps share a single `transaction.update` so a partial failure cannot leave a half-stamped cancellation. |
| `/api/bookings/cancel-preview` | POST | None (owner by ref+email/token) or Staff | CRL-06 read-only, rate-limited cancellation projection. Returns target rooms, cutoff, net collected, policy refund, collected amount retained, and whether staff processing remains required. A reservation folio is allocated across eligible rooms; a room-scope preview never inherits the entire reservation balance. |
| `/api/bookings/cancellation-exception` | POST | Admin | **CRL-07 (2026-08-03, per decision #173):** admin-only endpoint to apply a discretionary exception to a cancelled booking's or reservation's refund liability. Body: `{ reservationId } \| { bookingId, approvedAmount: 0..policyRefund, reason: required, ≤500 chars }`. The handler re-checks the admin role (403 for any other role). The mutation reduces `approvedAmount` below `policyResult.policyRefund`; it NEVER increases it. The `policyResult` is read-only — the endpoint mutates `approvedAmount` + the `exception` audit object only. Idempotency: same `(approvedAmount, reason)` from a retry-after-uncertain-response replays the original commit (returns 200 with `idempotentReplay: true`); a different value overwrites the `exception` field (the historical trail lives in the admin notifications collection CRL-08 adds). Lives at the cancelled entity's `cancellationLiability` field — reservation header or booking doc, depending on the cancel scope. Rate-limited at 30/min (a deliberate admin mutation, not a tap-and-confirm action). |
| `/api/bookings/cancellation-liability` | POST | Staff | **CRL-07 (2026-08-03, per decision #173):** read-only projection of the live liability state. Body: `{ reservationId } \| { bookingId }`. Reads the stored `cancellationLiability` field + the cumulative `processedAmount` (sum of the refunds subcollection — `reservations/{id}/refunds/` for new reservations, `bookings/{id}/payments/` filtered for negative entries for legacy) and returns one of five states (`not-required` / `retained` / `pending-processing` / `partially-processed` / `processed`) via the pure `computeCancellationLiabilityState` helper. Response: `{ success, data: { state, liability, processedAmount, outstandingAmount, retentionAmount, stateLabel } }`. Authenticated-staff (any role) — the data is non-sensitive (no PII, just money-state numbers) and the admin UI uses it for the drawer's `CancellationLiabilityPanel`. |
| `/api/bookings/lookup` | POST | None (any one of ref / email / token) | Look up a single booking for the `/my-booking` page. Accepts any one of `bookingRef`, `guestEmail`, or per-booking `lookupToken` (ref+email and ref+token also work; the email+token combination is rejected). Email lookup is case-insensitive and returns the most recent booking for the email. Refs alone are gated by Turnstile + 10/min rate limit + 3-failure 1-hour backoff — see `plan/docs/SECURITY.md §Booking Lookup Security`. Enriches the response with the room name from `rooms/{roomId}`. The response payload intentionally includes `guestName`, `guestEmail`, `guestPhone`, `roomType`/`roomNumber`, and guest-safe `rateBreakdown` so the self-service page can display the booking back to the guest. These fields are the data-subject's own PII or non-sensitive pricing details (per RA 10173 right to be informed + the right to access), and the endpoint enforces Turnstile + rate limit + backoff before returning them. |
| `/api/bookings/add-payment` | POST | Staff | Atomically append an onsite payment using the required client-preallocated `paymentId`; exact retries replay without a duplicate, while reuse with different details is rejected. Moves `pending`/`payment-uploaded` to `payment-confirmed` when the running total reaches `totalPrice`; the committed status transition gates the one-time payment-confirmed email. For a checked-out member folio with a locked pending loyalty award, the final payment also awards those points exactly once. Per MRB-04 Phase 2 (2026-08-02, per decision #159): the payment record writes to `reservations/{reservationId}/payments/{paymentId}` when the booking's `reservationId` is non-null (new reservations post-MRB-01), with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{paymentId}` — byte-equivalent to pre-MRB-04. The booking doc's `payment-confirmed` + loyalty award status transitions are unchanged for both paths. The reservation header's `paymentStatus` mirror update lands with MRB-04 Phase 3. |
| `/api/bookings/verify-and-record-payment` | POST | Staff | Verify an uploaded payment proof and atomically append its payment ledger entry using a required client-preallocated `paymentId`. Exact retries with the same ID replay safely; reusing an ID for different details is rejected, while legitimate equal-amount reference-free installments remain distinct when they use different IDs. Per MRB-04 Phase 2.x (2026-08-02, per decision #159): the verified payment record writes to `reservations/{reservationId}/payments/{paymentId}` when the booking's `reservationId` is non-null (new reservations post-MRB-01), with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{paymentId}` — byte-equivalent to pre-MRB-04. The booking doc's `payment-confirmed` + the `staffNewPayment` notification are unchanged for both paths. |
| `/api/bookings/add-refund` | POST | Admin | Append an immutable negative refund entry after transactionally verifying it does not exceed net collected funds; requires a client-preallocated `refundId`, method, reason, and approver UID. Exact retries with the same ID replay the original commit; reusing an ID with different amount/method/reason/transactionReference is rejected as a 409 conflict. Append-only ledger preserved (CRL-01). Per MRB-04 Phase 2.x (2026-08-02, per decision #159, the "Both, as separate paths" design): the refund record writes to `reservations/{reservationId}/refunds/{refundId}` (the canonical refund source for new reservations post-MRB-01) when the booking's `reservationId` is non-null, with the record carrying `reservationId` + `bookingId` for per-room attribution; for legacy null-`reservationId` bookings the record stays at `bookings/{bookingId}/payments/{refundId}` as a negative-amount entry — byte-equivalent to pre-MRB-04. **Net collected (the dual-read pattern):** for new reservations, the handler reads BOTH `reservations/{id}/payments` (positive) AND `reservations/{id}/refunds` (negative) to compute the sign-aware net. The writer only writes to `refunds/`, so the two arrays are disjoint in normal operation; the helper `getReservationFolioSummary` reads both as belt-and-suspenders. The 409 + 400 ("refund exceeds net collected") + 404 + 500 catch-block mappings are unchanged for both paths. |
| `/api/bookings/mark-payment-confirmed` | POST | Staff | Transactionally flip `payment-uploaded` → `payment-confirmed`, stamp the handling staff member, and send the payment-confirmed email only for the committed transition. Exact retries are idempotent. |
| `/api/bookings/confirm` | POST | Staff | Flip `pending`/`payment-uploaded`/`payment-confirmed` → `confirmed`; fires the booking-confirmed email once |
| `/api/bookings/confirm-with-balance` | POST | Staff | Confirm a `payment-uploaded` booking with an explicitly accepted outstanding balance and required reason. Per MRB-04 Phase 4, reservation-linked bookings compute the threshold against the reservation total, reservation payments/refunds/charges, transitional child ledgers, and delivered Add-to-Bill orders across every child room inside the same transaction as the status/audit write. Legacy null-`reservationId` bookings retain the historical single-booking calculation. |
| `/api/bookings/checkin` | POST | Staff | Flip `confirmed`/`payment-confirmed` → `checked-in` inside a transaction; validates the assigned room is not blocked or occupied by another checked-in booking, then atomically marks the room `occupied` |
| `/api/bookings/early-checkin-resolve` | POST | Staff; grant mode Admin only | Resolve an existing guest early check-in request with `approved` or `declined`. Admins may also send `grantIfMissing: true` with an approved status and confirmed time to add early check-in directly to an upcoming `payment-confirmed` or `confirmed` booking. Grant mode is transactionally protected from overwriting an existing request, records `source: staff-granted` plus resolver audit fields, is idempotent for an exact retry, and sends source-aware guest email copy. Front Desk may resolve guest requests but cannot create or change an admin-granted record. |
| `/api/bookings/checkout` | POST | Staff | Flip `checked-in` → `checked-out`; atomically frees the room and snapshots the charge-inclusive folio. Per MRB-04 Phase 4, a reservation-linked room is gated against the whole reservation balance, including reservation payments/refunds/charges, transitional child ledgers, and delivered Add-to-Bill orders across every room; legacy null-`reservationId` bookings retain the historical single-room calculation. Points still use net `booking.totalPrice` until the separate per-reservation loyalty follow-up. An early departure retains the contracted total while rebuilding the receipt breakdown with an explicit retained-total adjustment. |
| `/api/bookings/reject-discount` | POST | Staff | Reject Senior/PWD discount ID — restores `totalPrice`, sets rejection fields, triggers discount-rejected email |
| `/api/bookings/set-lou-received` | POST | Staff | **LOW-1 (reports audit 2026-08-10) + `DECISIONS-FEATURES.md #99` (LOU workflow):** staff-toggled LOU (Letter of Undertaking) flag for corporate chargeback bookings. Body: `{ bookingId, louReceived: boolean }` validated by the shared `SetLouReceivedSchema` (strict Zod). The handler re-checks the booking exists + is a corporate chargeback shape (`isCorporate === true` AND `paymentMethod === "pay-at-hotel"`) and 400s otherwise. Stamps `louReceived` + `louReceivedAt` + `louReceivedBy` (staff UID) on the booking doc in one Firestore transaction; the un-mark branch (`louReceived: false`) clears the audit fields (`louReceivedAt` + `louReceivedBy` set to `null`). The booking's `status` is NOT changed by this endpoint — the LOU flag is a parallel signal; a future iteration can auto-flip `status: pending` → `confirmed` when the LOU arrives. Rate-limited at 30/min/IP (same bucket as the other staff tap-and-confirm booking mutations). |
| `/api/bookings/apply-discount` | POST | Staff | Apply a verified Senior/PWD grant and/or validated voucher to an existing active booking; transactionally re-prices in canonical stacking order and increments voucher usage |
| `/api/bookings/reschedule` | POST | Staff | Move a booking to a new room/date range inside a transaction. Preserves and rescales a locked manual walk-in nightly rate; otherwise recalculates from the target room/date basis. Rejects terminal statuses, overlaps, and active room blocks, and appends `rescheduleHistory[]`. Per MRB-02.x (2026-08-02, per decision #164): when the existing booking has a `reservationId`, the server's transaction reads the `reservations/{id}` header early (before pricing math) so the half-stamped guard fires on inconsistent state — booking has a `reservationId` but the header is missing → 500 `RESERVATION_HEADER_WITHOUT_CHILD`. **Per MRB-14-03 (2026-08-03, per decision #180):** the handler no longer mutates the header's `checkIn` / `checkOut` / `numNights` — those fields are immutable shared-dates snapshots from create time. The handler queries every child via `where("reservationId", "==", id)` in the same transaction + recomputes the header's `actualDateRange` (and re-stamps each child's `revenueAllocation` per the MRB-11 invariant). The fingerprint is INTENTIONALLY allowed to change on reschedule — the reschedule IS the legitimate change to the fingerprint. Legacy null-`reservationId` bookings (pre-MRB-02) keep today's self-contained behavior: the reschedule updates the booking but does NOT touch a reservation header. |
| `/api/bookings/add-room` | POST | Staff | **MRB-14-02 (2026-08-03, per decision #180):** add a room to an existing pre-arrival reservation using the header's current dates (dates are NEVER in the body). Body: `{ reservationId, roomId, numAdults, numChildren, extraBedCount?, discountType?, voucherCode? }` validated by `AddRoomBookingSchema` (zod, mirrors `RescheduleBookingSchema` + `WalkinRoomLineSchema`). Validates inside the transaction: reservation exists + is pre-arrival (no `checked-in` or `cancelled` children) + target room is `available` + room is not blocked for the header's dates + room is not already claimed by another stay in the same reservation + room type's `maxCapacity` + `maxChildren` + `maxExtraBeds` are respected (the same `requiredExtraBedsFor` math the walkin handler uses). The new child is created via the existing `walkinRoomStayFinancials` chain — same per-line pricing, same per-stream `revenueAllocation` snapshot, same `getLockedManualNightlyRate` for manual-rate reservations. The reservation header is updated in the same transaction: `roomCount += 1`, `activeRoomCount += 1`, `subtotal += newChild.subtotal`, `totalPrice += newChild.totalPrice`, `aggregateRevenueAllocation = sum(children.allocation)` (server-computed via the existing `computeBookingRevenueAllocation`), `actualDateRange` is recomputed (always the same as the header on add-room — `isDivergent` stays `false`). `corporateCodes.usageCount` increments by 1 if the reservation is corporate (per MRB-08's "N rooms = N uses" rule); `vouchers.usageCount` increments by 1 if a `voucherCode` is applied. The new child's `holdExpiresAt` inherits the header's. One `booking-rescheduled` email fires after the commit. The `requestFingerprint` is a fresh `add-room-${reservationId}-${roomId}-${now}` (idempotency — a retry after an uncertain response replays the original commit, never appends a duplicate room). Shares the `bookings-reschedule:30/min/IP` rate-limit bucket. |

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

---

## MRB-15 Source-Text Audits (no new routes)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15 umbrella, shipped v0.249.0 → v0.255.0). The MRB-15 audits did not add any new API routes — they pin the cross-cutting invariants of the existing routes via source-text guards. The 8 audit sub-items cover:

- **MRB-15-01**: lifecycle invariants (no-duplicate-counters/email/loyalty across the full create → cancel lifecycle).
- **MRB-15-02**: payment-vs-room state (embedded in MRB-15-01).
- **MRB-15-03**: transactional summary counters (the `checkedInRoomCount` / `checkedOutRoomCount` fix + the aggregate `paymentStatus` derivation).
- **MRB-15-04**: N=1 + legacy null-`reservationId` byte-equivalence.
- **MRB-15-05**: canonical copy (subject pattern + preheader period + British "Cancelled" + title-case badges).
- **MRB-15-06**: PEX (`holdExpiresAt`) fan-out contract.
- **MRB-15-07**: checkout + loyalty earn path audit.
- **MRB-15-08**: legacy null-`reservationId` fallback audit.

See `plan/docs/BACKEND.md §Reservation Aggregate Counter Ownership (MRB-15)` for the counter ownership table; `plan/docs/TYPES.md §Loyalty Earn + Clawback Pairing (MRB-15-07)` for the earn/clawback pairing; `plan/docs/SECURITY.md §Legacy kind: "single" Lookup Branch (MRB-15-04, MRB-15-08)` for the lookup privacy posture. 106 new source-text tests across 7 new test files + 4 updated MRB-05 tests + 1 MRB-12 rewrite = 111 net new tests in the MRB-15 umbrella.
