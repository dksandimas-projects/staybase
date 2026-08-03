# Spark Inn — Build Roadmap & Checklist
> Living document — **must be updated on every merge** (see `How to Use This File` + `plan/docs/CONTRIBUTING.md §When to Update Which MD`)
> Last updated: August 3, 2026 (CRL-08 completed on `feature/phase-12-crl-08-refund-state-emails-and-reports`; running order — CRL-09).
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
| 12 — Enhancements, Multi-Room & CRL | 🔄 Active (MRB-01..13 & CRL-01..08 shipped) | Open MRB-11/12/14/15 & CRL-09 items (§Phase 12 below) |
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
- ⬜ **CRL-09 — Behavioral tests, staging rehearsal, and MD sync (WITH CRL-07/08)** — emulator-test refund-id replay/conflict, cancellation metadata atomicity, exact-cutoff assessment, partial/complete processing, admin override audit, guest/staff authorization matrix, whole-vs-room MRB cancellation, and "cancelled but not refunded" communication. Rehearse book → collect → cancel outside/inside cutoff → partial refund → complete refund as TEST DATA before launch.
- ⬜ **CRL-09 — Behavioral tests, staging rehearsal, and MD sync** — emulator-test refund-id replay/conflict, cancellation metadata atomicity, exact-cutoff assessment, partial/complete processing, admin override audit, guest/staff authorization matrix, whole-vs-room MRB cancellation, and “cancelled but not refunded” communication. Rehearse book → collect → cancel outside/inside cutoff → partial refund → complete refund as TEST DATA before launch. Sync `BOOKING-LOOKUP.md`, `BOOKINGS-MANAGEMENT.md`, `BOOKING-FLOW.md`, `EMAIL-PDF-STORAGE.md`, `REPORTS.md`, `STORE-MANAGEMENT.md`, `BACKEND.md`, `TYPES.md`, `API-ROUTES.md`, `SECURITY.md`, and implementation-time `DECISIONS-FEATURES.md #160`.

### Open Multi-Room Booking (MRB) Tasks (MRB-09..15)
- ✅ **MRB-06 + MRB-07 + MRB-08 — multi-room reservations across all three create surfaces** — all shipped 2026-08-02: a guest can cart several rooms into one reservation on `/book`, the desk can build a mixed-type multi-room reservation from the admin New Booking modal (with the Bookings list rendering reservation rows over nested room stays), and `/corporate/book` books blocks at per-stay negotiated rates with `usageCount` counting N rooms as N uses. Full specs in [`plan/project/archive/ROADMAP-SHIPPED-2026-08-02.md`](archive/ROADMAP-SHIPPED-2026-08-02.md).
- ✅ **MRB-09 — Emails fire from the reservation, not N rooms** — Shipped 2026-08-02 (decision #168, commits TBD). `booking-submitted` + `payment-confirmed` + `booking-confirmed` + `checkin-reminder` + `booking-confirmed-with-balance` + `booking-rescheduled` + the receipt PDF all use `buildReservationEmailView` to render a single block listing every room in the reservation; the checkin reminder cron groups by `reservationId` and sends one email per reservation. New `booking-cancelled-reservation` action + template fires from MRB-13's reservation-scope cancel path. `loadReservationEmailView(bookingId)` helper reads a booking + its reservation + siblings for the confirm / cancel / reschedule handlers. N=1 byte-equivalent. `guest-app/tests/api/mrb-09-reservation-scope-emails.test.ts` (20 source-text tests).
- ✅ **MRB-10 — Guest lookup resolves a reservation with nested rooms** — Shipped 2026-08-02 at v0.235.0 (commits TBD, decision #169). `handleLookupBooking` returns a `kind: "reservation"` response with a `rooms[]` array of per-stay projections when the looked-up booking has a `reservationId` and the reservation has N>1 children. The `lookupSchema` accepts an optional `reservationRef` (`R-YYYYMMDD-NNNNN`) for direct reservation-scope lookups; the credential is required. The page renders a single card with the reservation header + a per-room list; cancel routes through `scope: "reservation"` (per MRB-13). Privacy posture unchanged from #126/#128/#131 (no `guestName`, `maskedEmail` only). N=1 byte-equivalent; legacy pre-MRB-01 bookings retain today's single-booking path. `guest-app/tests/api/mrb-10-reservation-lookup.test.ts` (20 source-text tests).
- ✅ **MRB-13 — Cancellation: reservation vs room** — Shipped 2026-08-02 at v0.236.0 (commits TBD, decisions #166 spec + #170 implementation record). `POST /api/bookings/cancel` accepts an optional `scope: "room" | "reservation"` (default `"room"`, byte-compatible with pre-MRB-13). The reservation-scope branch fires when `scope === "reservation"` AND the looked-up booking has a `reservationId`; it runs ONE transaction that reads the `reservations/{id}` header + every child, splits the children into a cancellable set (skipping `checked-in`/`cancelled` + source-mismatched statuses), writes CRL-02 audit stamps + MRB-05 per-child loyalty clawback for every cancelled child, **deduplicates** voucher + corporate code `usageCount` decrements by `Map<code, count>` (a code shared by N children decrements by N — matches the MRB-08 create-time `+= assignedRooms.length` increment), and updates the reservation header (`cancelledRoomCount += cancelledCount`, `activeRoomCount -= cancelledCount` floored at 0, `paymentStatus` from the post-cancellation state via `computeReservationAggregatePaymentStatus`). One `sendBookingTrigger("booking-cancelled-reservation", view)` fires after the commit (the MRB-09 multi-room template); the per-child path keeps the legacy `sendBookingTrigger("booking-cancelled", view)` (which MRB-09 already taught to render the reservation view when `reservationId` is present). The admin `BookingsPage` cancel modal surfaces a `This room` / `All N rooms` segmented control when `selectedReservationContext` is set (N>1) and forwards the scope via a new 4th `options?: { scope?: "room" | "reservation" }` parameter on `updateBookingStatus`. The guest `/my-booking` page (per MRB-10) already routes the cancel submit through `scope: "reservation"` when `activeReservation` is set; MRB-13 makes the server honour the flag. `guest-app/tests/api/mrb-13-cancel-scope.test.ts` (29 source-text tests).
- ⬜ **MRB-11 — Reports use the correct owner for each metric** — reservation, acquisition, payment, and reservation-cancellation counts come from headers; occupancy, rooms sold, room-nights, room cancellations, allocated room revenue, and ADR come from child lines. Legacy self-contained bookings count as one reservation + one room stay. Charts, Daily Close, CSV, XLSX, and backup/export must reconstruct exactly from stored allocations, never divide a reservation total heuristically.
- ⬜ **MRB-12 — Admin reservation + room affordance** — show room count, transactional aggregate status/balance, room-stay navigator, cancellation count, and explicit action scope. Keep per-room workspaces for check-in, room moves, registration, housekeeping, and intercom. Reservation summaries never require the table to fetch N children merely to show status or balance.
- ⬜ **MRB-14 — Post-create room changes** — staff may add a room to an existing pre-arrival reservation using its current dates; guest self-service cannot add rooms in MRB v1. Availability, bed inventory, rate/line allocation, corporate usage, summary, and folio update atomically; the public ref stays unchanged and one update email fires. In-stay extension/early departure changes only the child’s actual dates and line adjustment; the header preserves original shared dates plus projected earliest/latest bounds. Once dates diverge, UI/email show dates per room rather than one misleading range.
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
