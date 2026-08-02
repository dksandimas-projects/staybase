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
- ⬜ **PC-05 — Archive + Data Carry-Over** — Full Backup XLSX + `gcloud firestore export` archive, then recreate active staff accounts in production Auth/Firestore.
- ⬜ **PC-06 — Cutover + Smoke Test** — Freeze window, Production redeploy, preflight, end-to-end smoke booking on prod (then cancel/refund), email triggers, integrity scan, rules verification, QR spot-check, local key file deleted, first real Daily Close.
- ⬜ **Live Verification** — GCash test booking passes Step 3 with proof upload; guest intercom message + quick request deliver to admin inbox.
- ⬜ **Breakage Window Audit** — Confirm no stuck bookings/guests during the breakage window.

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

### Open Multi-Room Booking (MRB) Tasks
- ⬜ **MRB-06 Phase 3 / MRB-07 — Group Folio & Charge Attribution** — Adds an optional `bookingId` field to payment and charge line items so staff can attribute charges to specific child room stays (e.g. Room 201 vs Room 202) while calculating both per-room sub-folios and the parent reservation total.
- ⬜ **MRB-08 — Multi-Room Booking Flow UI (`/book`)** — Adds a room count selector (1..5 rooms), multi-room occupancy allocation (adults/children per room), multi-room availability checking (ensuring N rooms are available), and a multi-room type selection interface.
- ⬜ **MRB-09 — Multi-Room Confirmation Page & Email** — Updates `/booking-confirmation` and email templates (`booking-confirmation`, `payment-received`, `check-in-reminder`) to render multi-room summary cards listing each allocated room number/type, per-room lead guests, and unified payment hold deadlines.
- ⬜ **MRB-10 — Multi-Room Guest Lookup (`/my-booking`)** — Resolves parent reservation references (`R-YYYYMMDD-NNNNN`) and returns all nested child room cards in a single guest view with privacy masking preserved (`maskedEmail`). Actions like cancellation or resend act on the parent reservation.
- ⬜ **MRB-11 — Reports Metric Owner Attribution** — Ensures analytics metrics attribute correctly: Reservation count, total payments, acquisition sources, and reservation cancellations come from `reservations` headers. Occupancy, room-nights sold, room cancellations, allocated room revenue, and ADR come from `bookings` child lines.
- ⬜ **MRB-12 — Admin Reservation & Room Affordances in Drawer & Table** — Displays reservation header summaries (room count badge, aggregate reservation balance, lead guest name) alongside child room-stay navigators, allowing staff to jump between child room stays while keeping parent reservation financial totals pinned.
- ⬜ **MRB-13 — Flexible Cancellation (Single Room vs Full Reservation)** — Staff can choose to cancel a single child room (releasing only that room's inventory and crediting its line cost to the reservation folio) or cancel the full multi-room reservation.
- ⬜ **MRB-14 — Post-Create Room Modifications** — Allows staff to add a room to an existing pre-arrival reservation or adjust stay dates for individual child rooms. The public `reservationRef` stays unchanged, and an updated confirmation email fires.
- ⬜ **MRB-15 — Full Lifecycle Integration Test Suite** — End-to-end integration test suite verifying no duplicate counters, correct loyalty points, payment status transitions, and report calculations across multi-room create → modify → cancel → checkout flows.

### Verification Checklists (BDUX, FSO, BSP, HSD, PEX, ETR)
- ⬜ **BDUX Verification — Booking Drawer UX** — Verify Drawer across 1440px desktop & 375px mobile viewports: Overview layout readability without scrolling, Folio action entry forms, Total/Paid/Balance updates, sticky payment proof header, 1-tap status actions.
- ⬜ **FSO Verification — Filtering UX** — Verify 375px mobile table filtering: filter chips, quick search, and one-handed advanced filter sheet.
- ⬜ **BSP-03 — Breakfast Served Persistence Manual QA** — Verify multi-guest silog selection and daily breakfast-served toggle persistence across multi-session admin views.
- ⬜ **HSD-05 — HEIC Photo Upload Manual QA** — Verify iPhone camera HEIC photo conversion via `heic-to` on physical iOS devices across Safari, Chrome, and Firefox.
- ⬜ **PEX-07 — Java Emulator Tests** — Verify Firebase Emulator write-path behavior for auto-expiry hold drops (`/api/holds/expire` cron).
- 🔄 **ETR-R — Production-to-Staging Refresh Engine (R02..R09)** — Implements remaining staging refresh modules: R02 mode toggles, R03 reviewable preservation, R05 asset sanitization, R06 relational integrity, R07 staging isolation, R08 pre-import scan, R09 controlled replacement.

### Deferred Architecture, Finance & Audit Tasks
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya) — deferred.
- ⏸ Expenses & P&L tracking — out of PMS scope (feed external bookkeeping).
- ⏸ Day-locking / night-audit snapshots — deferred at 14-room scale.
- ⏸ **FLR-03 — Bound Reports ledger listeners** — deferred with trigger (~1 year of operation).
- 🔄 **FLR-05 — Operational handover** — accountant VAT review + owner sign-off before next `dev → main` milestone.
- ⏸ **MED-3 — "Different email" reconciliation (guest self-service half)** — deferred per decision #135/#140 (front-desk manual link available).
- ⏸ **LOW-3 — `linkBookingsByEmail` batch not chunked to 500 limit** — deferred theoretical.
