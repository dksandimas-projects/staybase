# Spark Inn — Build Roadmap & Checklist
> Living document — **must be updated on every merge** (see `How to Use This File` + `plan/docs/CONTRIBUTING.md §When to Update Which MD`)
> Last updated: August 3, 2026 (MRB-12 completed on `feature/phase-12-mrb-12-admin-reservation-affordance`; running order — MRB-14).
> Status key: ✅ Done | 🔄 In Progress | ⬜ Not Started | ⏸ Deferred

---

## How to Use This File

- **New feature request or bug report? Follow `plan/docs/CONTRIBUTING.md §Feature Intake & Spec Workflow`** — investigate the code first, verify every claim against source rather than an MD, then spec it here as a coded block. Do not start coding from a chat message.
- **Must be updated on every merge to `dev`** (per `plan/docs/CONTRIBUTING.md §When to Update Which MD`).
- Check off items as they're completed (`⬜` → `✅`); for `XX-01..05` style items, mark each sub-item or convert to one `✅ **XX**` line with the shipped commit(s).
- **This file holds current status and open work only.** Completed-phase checklists and shipped feature details live in `plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md` and `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` (historical, do not load routinely). When a phase or feature fully ships, move its detail to the archive and keep a one-line ✅ status here.

---

## Phase Status Overview

| Phase | Status | Remaining / Notes |
|---|---|---|
| 0 — Foundation · 0.5 — Wireframes · 1 — Guest Shell · 2 — Admin Shell & Auth · 3 — Rooms · 4 — Guest Booking · 5 — Admin Bookings · 6 — Email · 7 — Corporate & Vouchers · 9 — Remaining Features | ✅ All shipped | 0 — details in [`plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md`](plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md) |
| 8 — Intercom | ✅ Built (19/29) | 10 manual E2E QA items (§Phase 8 QA below) |
| 10 — Security & Polish | 🔄 7/12 | 5 operational/QA items (§Phase 10 below) |
| 10B — Spark Rewards | 🔄 13/14 | 1 operational item (§Phase 10B below) |
| 11 — Staging & Launch | 🔄 2/16 | 14 operational items + production cutover (§Phase 11 below) |
| 11.5/11.6 — Audit Fixes & Launch-Readiness (50 items) | ✅ All 50 shipped 2026-06-16 | 0 — details in archive |
| 11.7 — Admin Mobile UX (30 items, v0.90.0) | ✅ Shipped 2026-06-18 | 1 P3 manual QA matrix (§Phase 11.7 below) |
| 11.8 — Public Content Editability | 🔄 PR 1 + PR 3 shipped | PR 2 deferred post-launch + Q1–Q4 (§Phase 11.8 below) |
| 11.9 — SEO & Open Graph | 🔄 8/10 | Q2 + verify + post-deploy (§Phase 11.9 below) |
| 12 — Enhancements, Multi-Room & CRL | 🔄 Active (MRB-01..13, MRB-12, CRL-01..09 shipped) | Open MRB-14/15 items (§Phase 12 below) |
| Plan Audits (FIN, FR, FL, PF, QA, NC, AUD, SA, FLR, PC, INC) | ✅ Closed / In Prod | 0 — details in archive |

---

## Phase 8 — Intercom: remaining manual QA
> Run on staging before launch — sign off in client training session. Everything else in Phase 8 is shipped (see archive).

- [ ] Desktop Chrome — scan QR from `/intercom/{roomId}` → enter guest name → quick request lands in admin Inbox → admin reply reaches guest within 2s
- [ ] Desktop Chrome — guest voice call → admin ringing banner + ring sound → accept → bidirectional audio → hang up from both sides
- [ ] Desktop Chrome — guest places store order (COD/Add-to-bill/GCash with screenshot) → order card appears in admin Inbox → status update reflects in guest shop panel
- [ ] Desktop Chrome — store order cancellation from guest side restores stock (verify `storeItems.stock` increments and `stockRestoredAt` is set)
- [ ] iOS Safari (375px) — full chat → reply → voice call → store order loop
- [ ] Android Chrome (375px) — same loop
- [ ] Mark resolved / reopen from admin Inbox updates the room-level flag and hides thread from Active tab
- [ ] Notification sound fires only when tab is not focused; tab title unread count updates correctly
- [ ] WebRTC active-call banner shows live duration timer; "Disconnect" button properly tears down the peer connection and media stream on both sides
- [ ] QR regen in admin Settings → QR Management → old QR continues to work for in-flight session, new QR encodes the same `/intercom/{roomId}` URL

---

## Phase 10 — Security & Polish: remaining items

- ⬜ Firebase API key domain restriction — operational task in Firebase Console
- ⬜ Performance audit — guest site < 3s on 4G mobile, dashboard < 2s (Lighthouse/WebPageTest)
- ⬜ Cross-browser QA — Chrome, Safari, Firefox
- ⬜ Mobile QA — iOS Safari, Android Chrome (375px)
- ⬜ Accessibility QA — WCAG 2.1 AA checklist (`plan/docs/FRONTEND.md §Accessibility`) across guest-facing screens

---

## Phase 10B — Spark Rewards: remaining item

- ⬜ Firebase Auth — Google Sign-In provider enabled in Firebase Console (operational task)

---

## Phase 11 — Staging & Launch

### Staging (25% payment milestone)
- ⬜ `dev` branch merged to `main` at `v0.9.0` — operational step after client approval
- ⬜ Staging URLs live and shared with client — operational
- ⬜ Client review session — bookings, dashboard, intercom — operational
- ⬜ Feedback collected and addressed — operational
- ⬜ Firestore rules tested with real client data — operational
- ✅ Production launch procedure documented — `plan/project/DEPLOY.md`
- ✅ Pre-launch verification script — `npm run preflight`

### Production Launch & Cutover (PC-05..06)
- ⬜ Domain `sparkinnbohol.com` purchased and configured — operational
- ⬜ Vercel custom domains set (`www.sparkinnbohol.com`, `admin.sparkinnbohol.com`) — operational
- ⬜ VERSION bumped to `v1.0.0` via `release:` commit — operational
- ⬜ Final `dev` → `main` merge — operational
- ⬜ All 14 rooms seeded with real data + photos — operational
- ⬜ Hotel config + website content finalized by client — operational
- ⬜ First admin account created for hotel owner — operational
- ⬜ Client training session (booking management, settings, intercom) — operational
- ⬜ Deployment confirmed live on both domains — operational
- ⬜ **PC-05 — Archive + data carry-over** — Full Backup XLSX + `gcloud firestore export` archive, then recreate active staff accounts in production Auth/Firestore.
- ⬜ **PC-06 — Cutover + smoke test** — freeze window, Production redeploy, preflight, end-to-end smoke booking on prod (then cancel/refund), email triggers, integrity scan, rules verification, QR spot-check, local key file deleted, first real Daily Close.
- ⬜ Verify live: a GCash test booking passes Step 3 with proof upload; a guest intercom message + quick request deliver to the admin inbox
- ⬜ Confirm no stuck bookings/guests during the breakage window (check Resend logs / booking creation rate between the 2026-07-17 rules deploy and PR #118)

---

## Phase 11.7 — Admin Mobile UX: remaining item
> Shipped 2026-06-18 at v0.90.0 (spec: `plan/features/ADMIN-MOBILE.md`).

- [ ] **Deferred to P3** — Manual QA matrix (18 screens × 6 breakpoints) + real device testing (iPhone SE, iPhone 14, Pixel 7, iPad)

---

## Phase 11.8 — Public Content Editability

- 🔴 **Q1–Q4.** Owner decisions on custom tagline, booking flow copy, email templates, and member privileges.
- [ ] **PR 2 (`feat/content-tier-a-website`)** — Deferred to post-launch (~35 fields across corporate, rewards, bookingConfirm).

---

## Phase 11.9 — SEO & Open Graph

- 🔴 **Q2.** Approve 1200×630 OG card design — owner.
- ⬜ **Verify** — FB Sharing Debugger + WhatsApp + Viber + X Card Validator + Google Rich Results Test.
- ⬜ **Post-deploy** — submit sitemap to Google Search Console + Bing Webmaster Tools.

---

## Phase 12 — Enhancements, Multi-Room Bookings (MRB) & Cancellation Lifecycle (CRL)

### Shipped in Phase 12 (Summary)
> Full implementation detail archived in [`plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md`](plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md) and `ROADMAP-ARCHIVE-2026-07-17.md`.

- ✅ **GCR / CWB / LCE / ECE / GSD / BSP / MBP / WSN / HSD / MBZ / WRV / WPM / NBS / PEX / DSC** (Shipped 2026-06 to 2026-08)
- ✅ **CRL (Phase 1)** — Cancellation & Refund Lifecycle foundation: refund idempotency (CRL-01), immutable cancellation audit stamps (`cancelledAt`/`cancelledBy`/`cancellationSource`, CRL-02), server status matrix dual gate (CRL-03), truthful copy + staff paid-store cancel alert (CRL-04), and structured snapshotted policy (CRL-05, v0.230.0, merge `babf238`, 2026-08-02)
- ✅ **MRB (Phase 1)** — Multi-Room Bookings foundation: `reservations/{id}` header, reservationRef (`R-YYYYMMDD-NNNNN`), transactional create/idempotency, walk-in, reschedule, corporate, N-booking assignment, reservation-owned operational/admin folio, reservation-aware confirmation receipt, and the guest multi-room cart with per-room occupancy/pricing (MRB-01..08, 2026-08-02; v0.232.0 added corporate multi-room per decision #167)

### Open Cancellation & Refund Lifecycle (CRL) Tasks (CRL-06..09)
- ✅ **CRL-05 — Structured, snapshotted cancellation policy** — shipped (v0.230.0, merge `babf238`, 2026-08-02); full spec in [`plan/project/archive/ROADMAP-SHIPPED-2026-08-02.md`](archive/ROADMAP-SHIPPED-2026-08-02.md).
- ✅ **CRL-06 — Secure cancellation preview + guest workflow (WITH MRB-10/13)** — shipped 2026-08-02 on `feature/phase-12-crl-06-cancel-preview`. Rate-limited preview uses the same strict owner credential as destructive cancel; renders target scope, policy cutoff, net collected, policy refund, retained amount, and `staffProcessingRequired`. Guest self-service expanded to every pre-arrival state after the preview. Room-scope previews allocate the reservation folio across eligible siblings. Post-confirmation lookup card shows preview-derived refund-processing result; persisted liability + admin workflow + state email + Reports queue follow in CRL-07/08/09.
- ✅ **CRL-07 — Reservation refund liability + admin workflow (WITH MRB-04/13)** — shipped 2026-08-03 on `feature/phase-12-crl-07-refund-liability` (decision #173). Destructive cancel materialises a `cancellationLiability` snapshot (reservation header for reservation-scope + N=1; booking doc for per-child + legacy). `policyResult` is read-only; `approvedAmount` defaults to `policyResult.policyRefund` and is reduced only via a new admin-only `POST /api/bookings/cancellation-exception` (reason ≤500 chars, amount bounded by `policyRefund`, idempotent). The existing `POST /api/bookings/add-refund` continues to record processed refunds; a new read-only `POST /api/bookings/cancellation-liability` projection returns one of five states via `computeCancellationLiabilityState`. Front-desk can cancel + see the panel; only admins can record a refund or apply an exception. Admin UI: `CancellationLiabilityPanel` + `CancellationExceptionModal`. Full spec in `plan/project/archive/ROADMAP-SHIPPED-2026-08-03.md` + `plan/docs/DECISIONS-FEATURES.md #173`. CRL-09 closes the loop.
- ✅ **CRL-08 — Refund-state emails, notification queue, and reports (WITH MRB-09/11)** — shipped 2026-08-03 on `feature/phase-12-crl-08-refund-state-emails-and-reports` (decision #174). **(1) Cancellation email** renders the CRL-07 `liabilityProjection` breakdown. **(2) New `booking-refund-processed` email** fires from `handleAddRefund` on state change (gate inside the same `runTransaction`; idempotent replay does NOT re-send). **(3) New `cancellation-refund` `NotificationType`** — `handleCancelBooking` writes on non-null liability; `handleAddRefund` writes on state change. **(4) New Reports "Liability" tab** shows pending + amount, partials, age buckets, processed total (in range), retained revenue (in range). Dual-source read (reservation header + booking doc) is the same shape CRL-07 uses. Exports + Daily Close continue to derive from the payment ledger, never from `approvedAmount`. Full spec in `plan/project/archive/ROADMAP-SHIPPED-2026-08-03.md` + `plan/docs/DECISIONS-FEATURES.md #174`. CRL-09 closes the loop.
- ✅ **CRL-09 — Behavioral tests, staging rehearsal, and MD sync (WITH CRL-07/08)** — shipped 2026-08-03 on `feature/phase-12-crl-09-behavioral-tests-and-md-sync` (decision #175 + #176 implementation records, v0.239.0 → v0.240.0). `firebase/tests/crl-09-lifecycle-state-machine.emulator.test.ts` (584 lines) pins the round-trip: snapshot shape on reservation header (new path) + booking doc (legacy null-`reservationId`); refund lifecycle `pending-processing` → `partially-processed` → `processed`; exception mutation; refund-id idempotency; legacy `bookings/{id}/payments/` negative-amount filter. Implementation record decisions land at `DECISIONS-FEATURES.md #175` (CRL-07) + `#176` (CRL-08). MDs synced: `BOOKING-LOOKUP.md` (post-cancel refund summary), `STORE-MANAGEMENT.md` (store-order refunds do NOT touch `cancellationLiability`). Full spec in `plan/project/archive/ROADMAP-SHIPPED-2026-08-03.md`; manual TEST DATA walkthrough in [`plan/project/CRL-09-STAGING-REHEARSAL-2026-08-03.md`](CRL-09-STAGING-REHEARSAL-2026-08-03.md).

### Open Multi-Room Booking (MRB) Tasks (MRB-09..15)
- ✅ **MRB-06 + MRB-07 + MRB-08 — multi-room reservations across all three create surfaces** — all shipped 2026-08-02: a guest can cart several rooms into one reservation on `/book`, the desk can build a mixed-type multi-room reservation from the admin New Booking modal (with the Bookings list rendering reservation rows over nested room stays), and `/corporate/book` books blocks at per-stay negotiated rates with `usageCount` counting N rooms as N uses. Full specs in [`plan/project/archive/ROADMAP-SHIPPED-2026-08-02.md`](archive/ROADMAP-SHIPPED-2026-08-02.md).
- ✅ **MRB-09 — Emails fire from the reservation, not N rooms** — Shipped 2026-08-02 (decision #168, commits TBD). `booking-submitted` + `payment-confirmed` + `booking-confirmed` + `checkin-reminder` + `booking-confirmed-with-balance` + `booking-rescheduled` + the receipt PDF all use `buildReservationEmailView` to render a single block listing every room in the reservation; the checkin reminder cron groups by `reservationId` and sends one email per reservation. New `booking-cancelled-reservation` action + template fires from MRB-13's reservation-scope cancel path. `loadReservationEmailView(bookingId)` helper reads a booking + its reservation + siblings for the confirm / cancel / reschedule handlers. N=1 byte-equivalent. `guest-app/tests/api/mrb-09-reservation-scope-emails.test.ts` (20 source-text tests).
- ✅ **MRB-10 — Guest lookup resolves a reservation with nested rooms** — Shipped 2026-08-02 at v0.235.0 (commits TBD, decision #169). `handleLookupBooking` returns a `kind: "reservation"` response with a `rooms[]` array of per-stay projections when the looked-up booking has a `reservationId` and the reservation has N>1 children. The `lookupSchema` accepts an optional `reservationRef` (`R-YYYYMMDD-NNNNN`) for direct reservation-scope lookups; the credential is required. The page renders a single card with the reservation header + a per-room list; cancel routes through `scope: "reservation"` (per MRB-13). Privacy posture unchanged from #126/#128/#131 (no `guestName`, `maskedEmail` only). N=1 byte-equivalent; legacy pre-MRB-01 bookings retain today's single-booking path. `guest-app/tests/api/mrb-10-reservation-lookup.test.ts` (20 source-text tests).
- ✅ **MRB-13 — Cancellation: reservation vs room** — Shipped 2026-08-02 at v0.236.0 (commits TBD, decisions #166 spec + #170 implementation record). `POST /api/bookings/cancel` accepts an optional `scope: "room" | "reservation"` (default `"room"`, byte-compatible with pre-MRB-13). The reservation-scope branch fires when `scope === "reservation"` AND the looked-up booking has a `reservationId`; it runs ONE transaction that reads the `reservations/{id}` header + every child, splits the children into a cancellable set (skipping `checked-in`/`cancelled` + source-mismatched statuses), writes CRL-02 audit stamps + MRB-05 per-child loyalty clawback for every cancelled child, **deduplicates** voucher + corporate code `usageCount` decrements by `Map<code, count>` (a code shared by N children decrements by N — matches the MRB-08 create-time `+= assignedRooms.length` increment), and updates the reservation header (`cancelledRoomCount += cancelledCount`, `activeRoomCount -= cancelledCount` floored at 0, `paymentStatus` from the post-cancellation state via `computeReservationAggregatePaymentStatus`). One `sendBookingTrigger("booking-cancelled-reservation", view)` fires after the commit (the MRB-09 multi-room template); the per-child path keeps the legacy `sendBookingTrigger("booking-cancelled", view)` (which MRB-09 already taught to render the reservation view when `reservationId` is present). The admin `BookingsPage` cancel modal surfaces a `This room` / `All N rooms` segmented control when `selectedReservationContext` is set (N>1) and forwards the scope via a new 4th `options?: { scope?: "room" | "reservation" }` parameter on `updateBookingStatus`. The guest `/my-booking` page (per MRB-10) already routes the cancel submit through `scope: "reservation"` when `activeReservation` is set; MRB-13 makes the server honour the flag. `guest-app/tests/api/mrb-13-cancel-scope.test.ts` (29 source-text tests).
- ✅ **MRB-11 — Reports use the correct owner for each metric** — shipped 2026-08-03 on `feature/phase-12-mrb-11-reports-owner` (decisions #177 + #178; v0.240.0 → v0.243.0). `BookingRevenueAllocation` + `Booking.revenueAllocation` + `Reservation.aggregateRevenueAllocation` (server-computed, asserted at the write boundary). `getBookingRevenueStreams` / `getReservationRevenueStreams` read the stored field; pre-MRB-11 docs fall back to `splitBookingRevenue` byte-for-byte (`"allocation: legacy-heuristic"`). `ReportsPage.tsx`'s 6 call sites switched off the heuristic. Per-stream values are GROSS; `deductionNet` is a single line. Tests: 24 + 9 + 7 = 40 new. Follow-ups: emulator round-trip test (Java not local) + the `"legacy-heuristic"` disclaimer banner. Full spec in `plan/project/archive/ROADMAP-SHIPPED-2026-08-03.md` + `plan/docs/DECISIONS-FEATURES.md #178`.
- ✅ **MRB-12 — Admin reservation + room affordance** — shipped 2026-08-03 on `feature/phase-12-mrb-12-admin-reservation-affordance` (decision #179; v0.244.0 → v0.245.0). `AdminContext` gains a `subscribeToReservations` listener (reservations headers) + a `collectionGroup("payments")` aggregate that filters to `reservations/{id}/payments/{paymentId}` for the reservation-scope `paidAmount`. The Bookings table reservation row's Total + Balance now read the `Reservation` header + paid-amount aggregate instead of summing the filtered in-memory children — **fixes the silent filter-hides-room bug** at `admin-app/src/pages/BookingsPage.tsx:1701-1705` by construction (the header doesn't filter). The row's Status column renders the aggregate `paymentStatus` (`Awaiting` / `Verified` / `Confirmed` / `In-house` / `Completed` / `Cancelled`) + a `X cancelled` chip when `Reservation.cancelledRoomCount > 0`. The drawer's reservation strip gains three pills (Total / Paid / Balance) reading the header + paid-amount aggregate. The discount form gains a `This room` / `All N rooms` segmented control mirroring MRB-13's cancel-modal control — `scope=reservation` loops over `selectedReservationContext.rooms` and calls the existing `apply-discount` endpoint for each (no API change; a transactional `applyReservationDiscount` is the MRB-14+ follow-up). Tests: 14 new source-text tests in `mrb-12-admin-reservation-affordance.test.ts` (listener wiring, path regex, sign-aware sum, `reservationsMap` lookup, header-sourced total + balance, useMemo deps, row builder attaches the header, Status column renders the pill + cancellation chip, drawer strip shows three money pills, `Apply discount` carries the scope chip, discount form has the segmented control + the loop, scope resets on close). BDUX verification rows #144-152 close automatically (the row's group-level read, the strip's money pills, and the action-scope chip on every multi-room action together satisfy the no-scroll, all-status, no-hidden-rooms criteria). Full spec + implementation record in `plan/project/archive/ROADMAP-SHIPPED-2026-08-03.md` + `plan/docs/DECISIONS-FEATURES.md #179`.

- ⬜ **MRB-14 — Post-create room changes** — staff may add a room to an existing pre-arrival reservation using its current dates; guest self-service cannot add rooms in MRB v1. Availability, bed inventory, rate/line allocation, corporate usage, summary, and folio update atomically; the public ref stays unchanged and one update email fires. In-stay extension/early departure changes only the child's actual dates and line adjustment; the header preserves original shared dates plus projected earliest/latest bounds. Once dates diverge, UI/email show dates per room rather than one misleading range.
### MRB-14 (Post-Create Room Changes) — proposed 2026-08-03
> Decision #180 reserved. Builds on MRB-04 (the reservation header + aggregate counters), MRB-07 (the multi-room `WalkinRoomStay` pattern + per-action scope labels), MRB-08 (corporate + voucher `usageCount` increment-by-N), MRB-09 (the reservation-scope email view), MRB-10 (the reservation-scope guest lookup), MRB-11 (the stored `revenueAllocation` + the `aggregateRevenueAllocation`), MRB-12 (the AdminContext reservations listener + the drawer reservation strip), and `handleRescheduleBooking` at `guest-app/server/handlers/bookings.ts:9175` (the existing per-child reschedule that already updates the header).

> **Driving bug — the header's `checkIn` / `checkOut` are mutated by every reschedule.** Today `handleRescheduleBooking` does `transaction.update(reservationHeaderRef, { checkIn, checkOut, numNights: ... })` to the new child's dates (line ~9700+). When the desk extends one room by 2 nights, the header's "Jan 1 → Jan 5" becomes the new child's "Jan 1 → Jan 7" — and every other room in the reservation, the email subject, the receipt PDF, the dashboard's date filter, and the checkin reminder cron all suddenly show "Jan 1 → Jan 7" even though the other 2 rooms are still "Jan 1 → Jan 5." The fix is to **freeze the header's `checkIn` / `checkOut` at create time** (they become the original shared dates) and add a new `actualDateRange` field for the children's spread. Once children diverge, every UI surface + email renders per-child dates.

> **Gates:** MRB-15 (the report-reconstruction property tests pin the date-divergence accounting), BDUX (the row's per-child date column + the strip's actual-range pill close the last BDUX-04 verification row), MRB-13 (the cancel-scope picker routes through the same per-child iteration; the add-room handler shares the corporate `usageCount += 1` pattern). **Rejected:** allowing staff to add a room at NEW dates (the spec says "using its current dates" — a different-dates add would silently re-anchor the header's "shared" semantics); letting the header's `checkIn` / `checkOut` mutate on reschedule (the bug); a separate "header dates updated" email (the existing `booking-rescheduled` action with the reservation-scope view already covers it); per-child `voucher` / `corporate` re-application on add-room (the spec keeps voucher per-child + corporate per-reservation; re-applying would be a silent usage-cap violation); guest self-service add-room (out of scope for MRB v1 — the existing guest flow ends at create, and the desk is the only entity that can guarantee availability + bed-inventory + corporate-cap arithmetic on the fly).

- ⬜ **MRB-14-01 — `Reservation.actualDateRange` field + header dates become immutable** — the `Reservation` type gains `actualDateRange: { earliestCheckIn: Date, latestCheckOut: Date, isDivergent: boolean } | null` (`null` when every child has the same dates as the header). The existing `Reservation.checkIn` / `checkOut` / `numNights` become immutable shared-dates snapshots (server enforces; a CI test fails if any non-create path mutates them). The aggregate is recomputed transactionally by every add-room + every reschedule + every check-in (when `actualCheckIn` diverges from the reservation's earliest). The contract: `isDivergent === true` ⇔ ∃ a child whose `checkIn` or `checkOut` differs from the header's. The MRB-12 drawer reservation strip gains an "Actual range" pill when `isDivergent` — "Jan 1 → Jan 8" with a per-child tooltip — alongside the existing Total / Paid / Balance pills. The legacy `Reservation.checkIn` / `checkOut` are still the public-facing "shared dates" the email subject + receipt PDF + checkin reminder cron use when every child agrees; the actual range is shown when they don't.
- ⬜ **MRB-14-02 — `POST /api/bookings/add-room` endpoint** — staff adds a room to an existing pre-arrival reservation using the header's current dates. New schema `AddRoomBookingSchema` in `shared/schemas/booking.ts` mirrors the existing `RescheduleBookingSchema` + `WalkinRoomLineSchema`: `{ reservationId: RESERVATION_ID_REGEX, roomId, numAdults, numChildren, extraBedCount?, discountType?, voucherCode? }`. The dates are NEVER in the body — the server reads them from the header. Validates (inside the transaction): the reservation exists + is pre-arrival (no `checked-in` or `cancelled` children) + the target room is `available` + the room is not blocked for the header's dates + the room is not already claimed by another stay in the same reservation + the room type's `maxCapacity` + `maxChildren` + `maxExtraBeds` are respected (the same `requiredExtraBedsFor` math the walkin handler uses). The new child is created via the existing `walkinRoomStayFinancials` chain — same per-line pricing, same per-stream `revenueAllocation` snapshot (MRB-11), same `getLockedManualNightlyRate` for manual-rate reservations. The reservation header is updated in the same transaction: `roomCount += 1`, `activeRoomCount += 1`, `subtotal += newChild.subtotal`, `totalPrice += newChild.totalPrice`, `aggregateRevenueAllocation = sum(children.allocation)` (server-computed via the existing `computeBookingRevenueAllocation`), `actualDateRange` is recomputed from every child's new `checkIn` / `checkOut` (always the same as the header on add-room — `isDivergent` stays `false`). `corporateCodes.usageCount` increments by 1 if the reservation is corporate (per MRB-08's "N rooms = N uses" rule); `vouchers.usageCount` increments by 1 if a `voucherCode` is applied to the new child. The new child's `holdExpiresAt` inherits the header's (a pre-arrival reservation has a unified hold per PEX-01). One `booking-rescheduled` email fires after the commit (the existing reservation-scope view carries the new room; the subject reads `Reservation updated: R-… (N rooms)`). The `requestFingerprint` is a fresh `add-room-${reservationId}-${roomId}-${now}` (the idempotency key — a retry after an uncertain response replays the original commit, never appends a duplicate room).
- ⬜ **MRB-14-03 — `handleRescheduleBooking` preserves the header's `checkIn` / `checkOut`** — the per-child reschedule handler (line `9175`) currently does `transaction.update(reservationHeaderRef, { checkIn, checkOut, numNights: ... })`; that line is removed. The header's `checkIn` / `checkOut` / `numNights` are immutable shared-dates snapshots from create time. The handler still recomputes the header's `aggregateRevenueAllocation` (per the MRB-11 invariant — the per-child `revenueAllocation` snapshot is re-stamped because the dates / nights changed) + updates the header's `actualDateRange` by re-scanning every child's `checkIn` / `checkOut`. When all children still match the header's dates after the reschedule, `isDivergent` is set to `false`; when one child now extends past the header, `isDivergent` flips to `true` and the header tracks the new earliest / latest. The rescheduled child keeps the same `bookingRef` (per the existing reschedule contract — the ref is the public anchor, dates change in place). The same `booking-rescheduled` email fires; the reservation-scope view now renders the per-child dates row when `isDivergent`.
- ⬜ **MRB-14-04 — Per-child dates render in UI + email when divergent** — the table row's "Dates" column reads the children's per-child dates when the row is a `roomStay` (already does); for a `reservation` row it reads the header's `actualDateRange` and shows "Jan 1 → Jan 8" (or "Jan 1 → Jan 5" when not divergent — same as today). The drawer's reservation strip gains a third "Actual range" pill row when `isDivergent` — "Jan 1 → Jan 8 (varies by room)" with a per-room tooltip listing each room's dates. The `booking-rescheduled` email template's "Stay dates" line reads the children's per-child dates when `isDivergent`; otherwise the header's shared range. The receipt PDF's dates row reads the same shape. N=1 + legacy null-`reservationId` paths stay byte-equivalent (no children to diverge, no header to read).
- ⬜ **MRB-14-05 — Tests + MD sync** — `guest-app/tests/api/mrb-14-add-room.test.ts` (source-text + behavioural coverage of the new endpoint: schema, handler, transaction, email, idempotency); `guest-app/tests/api/mrb-14-reschedule-preserves-header.test.ts` (the per-child reschedule handler no longer mutates the header's `checkIn` / `checkOut`, only the `actualDateRange`); `admin-app/src/__tests__/mrb-14-divergent-dates.test.ts` (the row + strip + email render per-child dates when `isDivergent`); the `firebase/tests/mrb-14-add-room.emulator.test.ts` round-trip (the Java-gated follow-up, like the MRB-11 report-reconstruction emulator). MDs: `plan/features/BOOKINGS-MANAGEMENT.md` (new "Post-create room changes" subsection + the "header dates are immutable" contract + the actual-range UI); `plan/docs/BACKEND.md` (the new `actualDateRange` field on `reservations/{id}` + the new `POST /api/bookings/add-room` route); `plan/docs/API-ROUTES.md` (the new endpoint signature + the request/response shape); `plan/project/ROADMAP.md` (flip MRB-14 to ✅ shipped); `plan/docs/DECISIONS-FEATURES.md #180` (implementation record on merge — reserve now, write at land).
- ⬜ **MRB-15 — Remaining tests + MD sync** — **revised 2026-08-01:** idempotency/concurrency tests (MRB-02), rules-boundary test (MRB-01), and folio balance/rounding property tests (MRB-04) shipped with their respective items. What remains for MRB-15: no-duplicate-counters/email/loyalty across full create→cancel lifecycle, single-room header path, canonical/copy consistency, transactional summary counters, payment-vs-room state, PEX fan-out, add-room adjustments (MRB-14), checkout, legacy fallback, report reconstruction (MRB-11), and data lifecycle/reset/erasure. MDs: `plan/features/BOOKING-FLOW.md`, `plan/features/AVAILABILITY-LOCKING.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/CORPORATE-BOOKING.md`, `plan/features/REPORTS.md`, `plan/features/EMAIL-PDF-STORAGE.md`, `plan/features/VOUCHERS.md`, `plan/features/SPARK-REWARDS.md`, `plan/features/ENVIRONMENT-TEST-RESET.md`, `plan/docs/TYPES.md`, `plan/docs/BACKEND.md`, `plan/docs/API-ROUTES.md`, `plan/docs/SECURITY.md`, and `plan/docs/DECISIONS-FEATURES.md #159`.

### Booking Drawer UX Refactor (BDUX) — remaining verification
- ⬜ Verify representative bookings across every status + conditional combination.
- ⬜ At 1440px, staff can understand guest/stay/payment/balance/next action without scrolling the default Overview.
- ⬜ At 375px, no horizontal scroll; primary action above safe area; modal/sheet focus + close behavior accessible.
- ⬜ Default Folio has no expanded entry form; each reachable through one labeled action.
- ⬜ Completing any Folio action leaves the user on Folio with updated Total/Paid/Balance/ledger visible.
- ⬜ Pending payment proof reachable from sticky header in one action; verified proof accessible without dominating default Folio.
- ⬜ Next valid status action reachable in one tap from any section.
- ⬜ Run admin typecheck, booking/admin regression tests, and manual visual QA across mobile/tablet/desktop before marking complete.

### Bookings & Store Orders Filtering UX (FSO) — remaining verification
- ⬜ At 375px: no horizontal scroll, quick chips operable, advanced sheet one-handed above safe area.

### Environment Test Runs & Controlled Data Reset (ETR)
> Phase 1 core shipped (ETR-01..14, ETR-S01..S15). **In progress: ETR-R (production-to-staging refresh) — foundation landed 2026-07-29 (R01 + R04 + R10 partial — server-side authorization, identity-replacement sanitization engine, audit row). Open: R02 (multiple modes — sanitized-snapshot is the only one in the foundation), R03 (reviewable preservation), R05 (file sanitization), R06 (full relational integrity), R07 (side-effect disable), R08 (post-import scan), R09 (controlled replacement with staging-reset integration — the manual import is the MVP step today).** Also open: ETR-D01..D10, ETR-15..20, ETR-21. Full spec: `plan/features/ENVIRONMENT-TEST-RESET.md`.

### Finance scope boundaries & recommendations
- ⏸ Expenses & P&L tracking — out of scope; system is a PMS, not accounting software; exports feed external bookkeeping/BIR
- ⏸ Day-locking / night-audit snapshots — deferred at 14-room scale; payments are already append-only at the rules level, which covers the cash side; revisit if historical figures drift or staff grows
- ⏸ **FLR-03 — Bound Reports ledger listeners** *(deferred with trigger)* — `collectionGroup("payments"/"charges")` loads full ledger history live on every Reports visit; fine at 14 rooms, linear forever on Blaze. **Trigger: revisit at ~1 year of operation** — switch to `recordedAt`-bounded queries; all-time Receivables fall back to one-shot `getDocs`.
- 🔄 **FLR-05 — Operational handover** *(owner-facing)* — handover in `FINANCE-LIFECYCLE-HANDOVER-2026-07-14.md`. Daily Close convention + accountant VAT review + staging money-path walkthrough have explicit checklists/evidence. **Remaining:** accountant confirmation + owner sign-off before next `dev → main` milestone.

### Deferred Loyalty & Audit Tasks
- ⏸ **MED-3 — "Different email" reconciliation (guest self-service half) — Still Deferred.** The guest self-service prompt ("We found bookings under a different email. Would you like to link them?") on the `/rewards` join surface / post-sign-in / post-booking confirmation is the larger of the two MED-3 paths. **Workaround** — guest can still find the booking at `/my-booking` (ref + email); staff can now also link it from the member detail drawer (the front-desk manual link above covers the common case without the guest needing to involve the front desk). `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md §MED-3` and decision #135 + #140.
- ⏸ **LOW-3 — `linkBookingsByEmail` batch not chunked to Firestore's 500-write limit** — **Deferred (theoretical only)**. A single-hotel guest with >500 same-email matches is not realistic at 14-room scale. Revisit if `linkBookingsByEmail` is ever re-pointed at a multi-property or federation-level surface. No code change.
