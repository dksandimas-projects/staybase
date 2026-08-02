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
| 11 — Staging & Launch | 🔄 2/16 | 14 operational items (§Phase 11 below) |
| 11.5/11.6 — Audit Fixes & Launch-Readiness (50 items) | ✅ All 50 shipped 2026-06-16 | 0 — details in archive |
| 11.7 — Admin Mobile UX (30 items, v0.90.0) | ✅ Shipped 2026-06-18 | 1 P3 manual QA matrix (§Phase 11.7 below) |
| 11.8 — Public Content Editability | 🔄 PR 1 + PR 3 shipped | PR 2 deferred post-launch + Q1–Q4 (§Phase 11.8 below) |
| 11.9 — SEO & Open Graph | 🔄 8/10 | Q2 + verify + post-deploy (§Phase 11.9 below) |
| 12 — Enhancements & Multi-Room | 🔄 Active (MRB-01..05 shipped) | Open MRB-06..15 items + Phase 12 follow-ups (§Phase 12 below) |
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

### Production Launch
- ⬜ Domain `sparkinnbohol.com` purchased and configured — operational
- ⬜ Vercel custom domains set (`www.sparkinnbohol.com`, `admin.sparkinnbohol.com`) — operational
- ⬜ VERSION bumped to `v1.0.0` via `release:` commit — operational
- ⬜ Final `dev` → `main` merge — operational
- ⬜ All 14 rooms seeded with real data + photos — operational
- ⬜ Hotel config + website content finalized by client — operational
- ⬜ First admin account created for hotel owner — operational
- ⬜ Client training session (booking management, settings, intercom) — operational
- ⬜ Deployment confirmed live on both domains — operational

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

## Phase 12 — Enhancements & Multi-Room Bookings (MRB)

### Deferred features
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya)
- ⏸ Automated test suite
- ⏸ Additional hotel client deployments (white-label)

### Shipped in Phase 12 (Summary)
> Full implementation detail archived in [`plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md`](plan/project/archive/ROADMAP-ARCHIVE-2026-08-02.md) and `ROADMAP-ARCHIVE-2026-07-17.md`.

- ✅ **GCR** — Guest check-in registration purpose of stay (#121)
- ✅ **CWB** — Confirm with balance for partial-payment bookings (#122)
- ✅ **LCE** — Editable Terms & Conditions & consent versioning (#137)
- ✅ **ECE** — House Rules in confirmation emails (#139)
- ✅ **GSD** — Guest store search & category browsing (#138)
- ✅ **BSP** — Breakfast served persistence (#132)
- ✅ **MBP** — Multi-booking picker & privacy protection (#126/#128/#131)
- ✅ **WSN** — Walk-in first/last name split (#127)
- ✅ **HSD** — HEIC support via `heic-to` (#125)
- ✅ **MBZ** — Modal/drawer backdrop z-index two-tier model
- ✅ **WRV** — Weekend Rate Visibility (#151, 2026-08-01)
- ✅ **WPM** — Walk-in Payment Method from Settings (#141, 2026-07-31)
- ✅ **NBS** — New Booking & Customizable Booking Sources (#142, 2026-07-31/08-01)
- ✅ **PEX** — Pending Booking Expiry & Hold Window (#147, 2026-08-01)
- ✅ **DSC** — Discount Scope Configuration & VAT Breakdown (#146/#148/#149/#150, 2026-07-31/08-01)
- ✅ **MRB (Phase 1)** — Multi-Room Bookings foundation: `reservations/{id}` header, reservationRef (`R-YYYYMMDD-NNNNN`), transactional create & idempotency for single-room, walk-in, reschedule, corporate, N-booking assignment (MRB-01..05, 2026-08-02)

### Open Multi-Room Booking (MRB) Tasks
- ⬜ **MRB-06 Phase 3 / MRB-07** — Group folio & per-room charge attribution on multi-room reservations.
- ⬜ **MRB-08** — Multi-room booking flow UI on `/book` (room-count selector, multi-room date picker, multi-room occupancy allocation).
- ⬜ **MRB-09** — Multi-room confirmation page & multi-room booking confirmation email template.
- ⬜ **MRB-10** — Guest lookup resolves a reservation with nested rooms on `/my-booking` (returning nested room card projections with privacy masking).
- ⬜ **MRB-11** — Reports use correct owner for each metric (reservation-level vs room-stay level: reservation count vs room nights & ADR).
- ⬜ **MRB-12** — Admin reservation + room affordance in drawer & table (reservation summary headers & room-stay navigators).
- ⬜ **MRB-13** — Cancellation options: cancel single room vs cancel full reservation with pre-confirmation financial breakdown.
- ⬜ **MRB-14** — Post-create room changes (add room to pre-arrival reservation, modify stay dates per child room).
- ⬜ **MRB-15** — Integration & end-to-end lifecycle test coverage across multi-room create → cancel → checkout flow.

### Other Open Follow-ups from Phase 12 Blocks
- ⬜ **BSP-03 — Manual QA** — multi-guest breakfast served toggle persistence check across multi-session admin view.
- ⬜ **HSD-05 — Manual QA on real devices** — iPhone HEIC upload verification across Chrome, Firefox, and Safari.
- ⬜ **PEX-07 — Java Emulator Behavioral Tests** — real-device / emulator write-path testing for auto-expiry transaction.
- 🔄 **ETR-R — Production-to-Staging Refresh** — Open tasks: R02 (multiple modes), R03 (reviewable preservation), R05 (file sanitization), R06 (full relational integrity), R07 (side-effect disable), R08 (post-import scan), R09 (controlled replacement).
