# Spark Inn — Build Roadmap & Checklist
> Living document — **must be updated on every merge** (see `How to Use This File` + `plan/docs/CONTRIBUTING.md §When to Update Which MD`)
> Last updated: August 2, 2026 (Documentation compaction & audit compliance pass; commit on `docs/compact-exceeding-mds`).
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
| 12 — Enhancements, Multi-Room & CRL | 🔄 Active (MRB-01..05 & CRL-01..04 shipped) | Open MRB-06..15 & CRL-05..09 items (§Phase 12 below) |
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
- ✅ **CRL (Phase 1)** — Cancellation & Refund Lifecycle foundation: refund idempotency (CRL-01), immutable cancellation audit stamps (`cancelledAt`/`cancelledBy`/`cancellationSource`, CRL-02), server status matrix dual gate (CRL-03), and truthful copy + staff paid-store cancel alert (CRL-04) (2026-08-01/02)
- ✅ **MRB (Phase 1)** — Multi-Room Bookings foundation: `reservations/{id}` header, reservationRef (`R-YYYYMMDD-NNNNN`), transactional create & idempotency for single-room, walk-in, reschedule, corporate, N-booking assignment (MRB-01..05, 2026-08-02)

### Open Cancellation & Refund Lifecycle (CRL) Tasks
- ⬜ **CRL-05 / CRL-06 — Policy-Derived Financial Preview & Expanded Guest Window** — Renders an interactive financial preview modal on `/my-booking` calculating statutory and hotel policy refund eligibility (e.g. 100% refund >72h prior to check-in, 50% <48h, non-refundable deposit) before a guest submits a cancellation request, then allows expanding self-service cancellations to paid bookings safely.
- ⬜ **CRL-07 — Refund Liability Ledger & Target Account Collection** — Prompts guests during cancellation for refund target details (GCash mobile number / bank account name + number) and records unhandled refund liabilities in a dedicated admin ledger view.
- ⬜ **CRL-08 — Notification Center Queue Integration** — Connects staff refund review triggers (`sendStaffRefundReviewTrigger`) to the Admin Notification Center (`notifications` collection), placing refund tasks into an actionable staff inbox queue.
- ⬜ **CRL-09 — Admin Cancellation Audit UI Pass** — Displays `cancelledAt` timestamp, `cancelledBy` UID, and `cancellationSource` (`"guest"` | `"staff"` | `"system"`) in the Admin Booking Drawer header for full auditability.

### Open Multi-Room Booking (MRB) Tasks (MRB-06..15)
- ⬜ **MRB-06 — Guest `/book` flow: quantity per room type** — Step 1 becomes a small cart: a quantity selector per available room type, a running total, and guest distribution across rooms. **Occupancy: resolved by CHD** — the adults/children split, its storage, and the per-room-type caps are specified in §Children in Booking above; land CHD first and MRB-06 inherits it. What remains MRB-specific is distributing guests across the reservation's room stays. Steps 2–4 collect one lead guest and one payment for the whole reservation.
- ⬜ **MRB-07 — Admin New Booking modal: multi-room** — **depends on NBS.** Build the selector once on the reworked modal for walk-in groups, phone bookings, and OTA entry. The main Bookings list renders one reservation row with nested room stays; operational quick views remain room rows. Every action labels its scope (`This room` / `All rooms`), and deep links support both reservation and child booking IDs.
- ⬜ **MRB-08 — Corporate `/corporate/book`: multi-room** — **arguably the strongest use case** (companies book blocks). The negotiated/flat corporate rate applies per room; the corporate code's `usageCap` counts N rooms as N uses.
- ⬜ **MRB-09 — Emails fire from the reservation, not N rooms** — `booking-submitted`, `confirmed`, `payment-confirmed`, and `check-in-reminder` send **one** email listing every room. Whole-reservation cancellation sends one `booking-cancelled` email; a room-only cancellation or other partial action sends one reservation-updated email with the changed room, remaining rooms, revised total/balance, and refund/payment state. The receipt PDF itemises rooms and totals once. **Full template inventory (revised 2026-08-01)** — `booking-cancelled` is explicitly moved to reservation-scope.
- ⬜ **MRB-10 — Guest lookup resolves a reservation with nested rooms** — `/my-booking` first finds `reservations.reservationRef` (or verified email/token), then returns its guest-safe child room projections as one card. Reuse the MBP wire shape and privacy posture (`maskedEmail`, no guest name reflected — decisions #126/#128/#131 apply unchanged). Cancel/resend act on the reservation. Legacy bookings without `reservationId` retain today's lookup path.
- ⬜ **MRB-11 — Reports use the correct owner for each metric** — reservation, acquisition, payment, and reservation-cancellation counts come from headers; occupancy, rooms sold, room-nights, room cancellations, allocated room revenue, and ADR come from child lines. Legacy self-contained bookings count as one reservation + one room stay. Charts, Daily Close, CSV, XLSX, and backup/export must reconstruct exactly from stored allocations, never divide a reservation total heuristically.
- ⬜ **MRB-12 — Admin reservation + room affordance** — show room count, transactional aggregate status/balance, room-stay navigator, cancellation count, and explicit action scope. Keep per-room workspaces for check-in, room moves, registration, housekeeping, and intercom. Reservation summaries never require the table to fetch N children merely to show status or balance.
- ⬜ **MRB-13 — Cancellation: reservation vs room** — staff chooses one room or the whole reservation with targets and financial effect shown before confirmation. Cancelling one room releases only that room and routes its itemized adjustment/refund state through the reservation folio; cancelling the first-created room has no special financial consequence because no room owns the folio. Guest-facing cancellation defaults to the whole reservation and must state the room count; cancel/resend remain server-authenticated reservation actions.
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
