# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: July 17, 2026 (Roadmap compacted: completed-phase diaries moved to `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md`; ETR spec moved to `plan/features/ENVIRONMENT-TEST-RESET.md`.)
> Status key: ✅ Done | 🔄 In Progress | ⬜ Not Started | ⏸ Deferred

---

## How to Use This File

- Check off items as they're completed (`⬜` → `✅`)
- Update "Last updated" date at the top on each edit
- Add notes under items if there are blockers or decisions made
- Commit with `docs: update ROADMAP.md` prefix (no version bump)
- **This file holds current status and open work only.** Completed-phase checklists, shipped audit-fix batches, and closed findings live in `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` (historical, do not load routinely) and in Git history. When a phase or fix batch fully ships, move its detail to the archive and keep a one-line ✅ status here.

---

## Phase Status Overview

| Phase | Status | Remaining |
|---|---|---|
| 0 — Foundation (41) · 0.5 — Wireframes (60) · 1 — Guest Shell (12) · 2 — Admin Shell & Auth (6) · 3 — Rooms (5) · 4 — Booking Flow (11) · 5 — Admin Bookings (8) · 6 — Email (10) · 7 — Corporate & Vouchers (12) · 9 — Remaining Features (6) | ✅ All shipped | 0 — details in archive |
| 8 — Intercom | ✅ Built (19/29) | 10 manual E2E QA items (§Phase 8 QA below) |
| 10 — Security & Polish | 🔄 7/12 | 5 operational/QA items (§Phase 10 below) |
| 10B — Spark Rewards | 🔄 13/14 | 1 operational item (§Phase 10B below) |
| 11 — Staging & Launch | 🔄 2/16 | 14 operational items (§Phase 11 below) |
| 11.5/11.6 — Audit Fixes & Launch-Readiness (50 items, 20 batches) | ✅ All 50 shipped 2026-06-16 | 0 — details in archive |
| 11.7 — Admin Mobile UX (30 items, v0.90.0) | ✅ Shipped 2026-06-18 | 1 P3 manual QA matrix (§Phase 11.7 below) |
| 11.8 — Public Content Editability | 🔄 PR 1 + PR 3 shipped | PR 2 deferred post-launch + Q1–Q4 (§Phase 11.8 below) |
| 11.9 — SEO & Open Graph | 🔄 8/10 | Q2 + verify + post-deploy (§Phase 11.9 below) |
| 12 — Post-Launch | 🔄 14/22 | See §Phase 12 below |
| Plan Audits (June 10: 21 · June 11: 16) · Finance & Reports FIN-01..14 · Reconciliation FR-01..05 · Finance Lifecycle FL-01..20 · Phase 12 Features PF-01..11 · Manual QA QA-01..08 · Live Bugs QA-09..26 · Notification Center NC-01..03 · Post-merge AUD-01..06 · Contract SA-01 | ✅ All closed | 0 — details in archive |
| Finance Lifecycle Recommendations (FLR, July 14) | 🔄 3/5 | FLR-03 deferred with trigger, FLR-05 open (§below) |
| Production Environment Split (PC, July 14) | 🔄 4/6 | PC-05, PC-06 (§below) |
| E2E User Journey Audit (July 17) | 🔄 Audit complete | 3 HIGH fixes open — **launch NO-GO until fixed** (§below) |

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
- [ ] QR regen in admin Settings → QR Management → old QR continues to work for in-flight session, new QR encodes the same `/intercom/{roomId}` URL (per `QR-MANAGEMENT.md`)

---

## Phase 10 — Security & Polish: remaining items

- ⬜ Firebase API key domain restriction — operational task, requires Firebase Console configuration (not a code change)
- ⬜ Performance audit — guest site < 3s on 4G mobile, dashboard < 2s (requires Lighthouse/WebPageTest; manual QA)
- ⬜ Cross-browser QA — Chrome, Safari, Firefox (manual QA)
- ⬜ Mobile QA — iOS Safari, Android Chrome (375px) (manual QA)
- ⬜ Accessibility QA — WCAG 2.1 AA checklist (`plan/docs/FRONTEND.md §Accessibility`) applied across guest-facing screens — per `LEGAL.md` commitment (tied directly to PWD discount guests who use assistive tech). Includes: keyboard navigation, screen reader labels (aria-* on all icon-only buttons, form fields, modal dialogs), color contrast 4.5:1 minimum, focus indicators, alt text on all images, form labels associated with inputs, error messages announced via aria-live. *(Per AUDIT-39)*

---

## Phase 10B — Spark Rewards: remaining item

- ⬜ Firebase Auth — Google Sign-In provider enabled in Firebase Console (operational task — code side done; requires Firebase Console > Authentication > Sign-in method > Google > Enable)

---

## Phase 11 — Staging & Launch

### Staging (25% payment milestone)
- ⬜ `dev` branch merged to `main` at `v0.9.0` — operational step, scheduled after client approval
- ⬜ Staging URLs live and shared with client — operational
- ⬜ Client review session — bookings, dashboard, intercom — operational
- ⬜ Feedback collected and addressed — operational
- ⬜ Firestore rules tested with real client data — operational
- ✅ Production launch procedure documented — `plan/project/DEPLOY.md`
- ✅ Pre-launch verification script — `npm run preflight`

### Production Launch
- ⬜ Domain `sparkinnbohol.com` purchased and configured — operational
- ⬜ Vercel custom domains set (`www.sparkinnbohol.com`, `admin.sparkinnbohol.com`) — operational
- ⬜ VERSION bumped to `v1.0.0` via `release:` commit — operational (Husky auto-bumps)
- ⬜ Final `dev` → `main` merge — operational
- ⬜ All 14 rooms seeded with real data + photos — operational (skeleton data exists; client to upload real photos via admin UI)
- ⬜ Hotel config + website content finalized by client — operational (via admin Settings)
- ⬜ First admin account created for hotel owner — operational (via `/api/admin/create-staff`)
- ⬜ Client training session (booking management, settings, intercom) — operational
- ⬜ Deployment confirmed live on both domains — operational

---

## Phase 11.7 — Admin Mobile UX: remaining item
> Shipped 2026-06-18 at v0.90.0 (spec: `plan/features/ADMIN-MOBILE.md`, Decision #107). Full implementation record in archive.

- [ ] **Deferred to P3** — Manual QA matrix (18 screens × 6 breakpoints) + real device testing (iPhone SE, iPhone 14, Pixel 7, iPad) — requires a browser/device; doc/QA matrix at `ADMIN-MOBILE.md §Manual QA matrix`

---

## Phase 11.8 — Public Content Editability *(P0 — opened 2026-07-01)*
> Source: `plan/project/AUDIT-PUBLIC-CONTENT-2026-07-01.md`. PR 1 (hero eyebrows + cache bust) and PR 3 (hotel contact fields) shipped 2026-07-01; implementation detail in archive. PR 2 deferred post-launch (~2 days, M effort — open after first 30 days of real data).

### Open questions (close with the owner during staging review)
- 🔴 **Q1.** Does the owner want a custom tagline / brand promise different from the white-label config defaults? If yes → Tier A. If no → keep in `hotel.config.ts`. *(Deferred until owner demo — homepage eyebrow ships with `config.tagline` fallback.)*
- 🔴 **Q2.** Does the owner want to customize the booking flow copy (step labels, validation messages, payment method card labels)? Most hotel SaaS sites do not expose this. Confirm before PR 2.
- 🔴 **Q3.** Does the owner want to customize email subject + body for the 7 transactional triggers? If yes, scope a separate "Email Templates" tab in Phase 12 (out of scope for this phase).
- 🔴 **Q4.** Does the owner want the Spark Rewards "Member Privileges" copy to be different from the current 4 hardcoded cards? If yes → Tier A. If no → keep hardcoded.

### PR 2 — `feat/content-tier-a-website` *(deferred to post-launch)*
Extends **Settings → Website Content** with new sub-objects for the rest of the public-facing pages (~35 new fields after Q1–Q4 deferrals). `homepage.sectionHeaders`, `roomsCatalog`, `contact`, and `notFound` starter batches shipped 2026-07-09. Remaining:

- [ ] `corporate.perksSectionEyebrow` + `corporate.perksSectionTitle` + `corporate.cardLabels` + `corporate.inquiryForm` (labels, placeholders, button, success, error)
- [ ] `corporate.onboardingSteps[]` — new list editor for the 3-step process (mirrors `perks[]`)
- [ ] `rewards.howItWorks` — eyebrow + title + 3-step list editor
- [ ] `rewards.ctaBanner` — heading + body
- [ ] `bookingConfirm` — headlines, subtext, details card labels, payment method display labels, calendar buttons, Spark Rewards upsell block, empty state
- [ ] `termsLastUpdated` (string) + `termsBody` (full-text override, mirrors `privacyPolicyBody`)
- [ ] (Q2) `bookingFlow` — only if the owner answers the audit's Q2 with a yes
- [ ] (Q4) `rewards.privileges` — only if the owner answers the audit's Q4 with a yes

Test: extend `admin-app/src/__tests__/website-content-fields.test.ts` + new `guest-app/src/__tests__/content-tier-a-render.test.ts` covering each new field's `pickString` chain end-to-end.

### Explicitly decided NOT to do (deferred per the audit's recommendation)
- ⏸ **Footer / Navbar link order** — product IA, not content. If a hotel asks, promote to a Tier A item.
- ⏸ **Form validation messages + voucher error messages** — code-side contract with the guest, not marketing copy.
- ⏸ **Sign-in / sign-up page copy** — product IA, not marketing copy.
- ⏸ **In-room chat copy (`/intercom`)** — product IA, no marketing surface.
- ⏸ **Privacy page structured fallback body** — only reachable when `privacyPolicyBody` is empty; not a long-term editor surface.
- ⏸ **Member portal tier labels** ("Standard Member") — depends on the Phase 2 tier system.
- ⏸ **Email subject + body per trigger** — out of scope; ship a separate Phase 12 "Email Templates" tab if a hotel asks.

---

## Phase 11.9 — SEO & Open Graph *(P0 — opened 2026-07-09)*
> Full spec: `plan/features/SEO-OPENGRAPH.md`. G1–G6 + config + admin noindex all shipped (detail in archive). Q1 (Option A build-time prerender), Q3 (`twitterHandle`), Q4 (`priceRange` = `₱₱`) resolved 2026-07-09.

- 🔴 **Q2.** Approve the 1200×630 OG card design (logo + tagline on brand orange) — owner.
- ⬜ **Verify** — Facebook Sharing Debugger + WhatsApp + Viber render distinct correct cards for ≥3 URLs; X Card Validator; Google Rich Results Test on JSON-LD
- ⬜ **Post-deploy** — submit sitemap to Google Search Console + Bing Webmaster Tools

---

## Phase 12 — Post-Launch (Phase 2, Deferred)
> Goal: Enhancements after stable v1.0.0. 14 features shipped (email preview, breakfast CRUD, dashboard intercom widget, early check-in workflow, calendar view, seasonal rates, Rate Calendar, discount/voucher repairs, check-in gate, PDF repair, price breakdown, Senior/PWD toggle, post-booking discounts, incidental charges FIN-14, Notification Center, payment rejection) — full records in archive.

### Deferred features
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya)
- ⏸ Automated test suite
- ⏸ Additional hotel client deployments (white-label)

### Booking Drawer UX Refactor (BDUX) — remaining verification
> Shipped 2026-07-16 (BDUX-01..08 + BDUX-05a..05n complete — full contract in archive). Remaining manual/visual QA:

- ⬜ Verify representative bookings in every status and conditional combination: payment proof, breakfast, Senior/PWD, voucher, Rewards, early check-in, onsite payments/refunds, incidentals, store charges, corporate source, checked-out, and cancelled.
- ⬜ At 1440px, staff can understand guest, stay, payment state, outstanding balance, and next action without scrolling the default Overview.
- ⬜ At 375px, there is no horizontal page scroll; all features remain reachable; the primary action stays usable above the safe area; modal/sheet focus and close behavior remain accessible.
- ⬜ The default Folio view contains no expanded voucher, payment, refund, or incidental entry form; each remains reachable through one clearly labeled action.
- ⬜ Opening and completing any Folio action leaves the user on the Folio tab with the updated Total, Paid, Balance, and ledger state visible.
- ⬜ Pending payment proof can be reached from the sticky header in one action, while verified proof remains accessible without dominating the default Folio layout.
- ⬜ No action requires more navigation steps than the current drawer for its common operational path, and the next valid status action remains reachable in one tap/click from any section.
- ⬜ Run admin typecheck, booking/admin regression tests, and targeted manual visual QA across mobile, tablet, and desktop before marking complete.

*(Controlled Unpaid Checkout (UCO-01..14) and Payment Reference Semantics (PRC-01..19) shipped 2026-07-16 with all acceptance criteria met — contracts in archive.)*

### Bookings & Store Orders Filtering UX (FSO) — remaining verification
> Phase 1 shipped 2026-07-16 (FSO-01..18 — full contract in archive). Advanced filter panel Phase 2 pending. Remaining QA:

- ⬜ At 375px there is no horizontal page scroll, quick chips remain operable, and the advanced sheet can be completed one-handed above the safe area.

### Environment Test Runs & Controlled Data Reset (ETR)
> Phase 1 core shipped (ETR-01..14, ETR-S01..S15). **Open spec: production→staging refresh (ETR-R01..R10), Restricted Diagnostic Mode (ETR-D01..D10), one-time pre-live production reset (ETR-15..20), and verification (ETR-21 + acceptance criteria).** Full spec + shipped contract + staging-reset execution gate: `plan/features/ENVIRONMENT-TEST-RESET.md`.

### Finance scope boundaries (recorded decisions — do not re-open without owner request)
- ⏸ Expenses & P&L tracking — out of scope; system is a PMS, not accounting software; exports feed external bookkeeping/BIR
- ⏸ Day-locking / night-audit snapshots — deferred at 14-room scale; payments are already append-only at the rules level, which covers the cash side; revisit if historical figures drift or staff grows

---

## Finance Lifecycle Recommendations — open items (2026-07-14)
> Source: `plan/project/AUDIT-FINANCE-LIFECYCLE-2026-07-12.md §Post-remediation recommendations`. FLR-01/02/04 fixed 2026-07-14 (detail in archive).

- ⏸ **FLR-03 — Bound the Reports ledger listeners** *(deferred with trigger)* — `collectionGroup("payments"/"charges")` listeners load the entire ledger history live on every Reports visit; fine at 14 rooms, linear growth forever on Blaze. **Trigger: revisit when the combined ledger passes a few thousand rows (~1 year of operation)** — switch to `recordedAt`-bounded queries; all-time Receivables can fall back to one-shot `getDocs`.
- 🔄 **FLR-05 — Operational handover items** *(owner-facing, no code)* — handover prepared in `FINANCE-LIFECYCLE-HANDOVER-2026-07-14.md`. The historical Daily Close convention is documented without editing locked closes, and the accountant VAT review plus isolated-staging money-path walkthrough now have explicit checklists/evidence records. **Remaining:** accountant confirmation and owner walkthrough/sign-off before the next `dev → main` milestone merge.

---

## Production Environment Split — cutover queue (added 2026-07-14)
> Source: `plan/project/PROD-CUTOVER-RUNBOOK.md` — demote `spark-inn-stg-7a7ad` to staging, stand up Vercel staging on `dev` at `stg.sparkinnbohol.com` / `stg-admin.sparkinnbohol.com`, cut production over to the clean-slate `spark-inn-prod` project. The runbook holds the step-level checklists, prod client config, and secret-handling rules (service-account key never committed). PC-05's carry-over decision is resolved: clean slate only, staff accounts pre-provisioned — `DECISIONS-FEATURES.md` Decision #119. PC-01..PC-04 done 2026-07-14 (detail in archive).

- ⬜ **PC-05 — Archive + data carry-over** — Full Backup XLSX + `gcloud firestore export` archive, then recreate active staff accounts in production Auth/Firestore.
- ⬜ **PC-06 — Cutover + smoke test** — freeze window, Production redeploy, preflight, end-to-end smoke booking on prod (then cancel/refund), email triggers, integrity scan, rules verification, QR spot-check, local key file deleted, first real Daily Close.

---

## E2E User Journey Audit (2026-07-17)

Full-journey audit across all 5 roles (guest, corporate, front desk, admin, cross-cutting). Report: `plan/docs/AUDIT-E2E-REPORT.md`. CRITICAL/HIGH items tracked here as tasks; MED/LOW live in the report.

### Guest journey (role 1 of 5 — audited 2026-07-17)

- [ ] **G-01 (HIGH)** — Zod-validate the full `/api/bookings/create` (and `create-walkin`) body: `guests` must be a finite integer ≥ 1; add `Number.isFinite` backstop on computed `totalPrice`. Unvalidated `guests` currently allows unauthenticated price manipulation (negative breakfast line) and `NaN` totals that poison revenue reports. `guest-app/server/handlers/bookings.ts:345,562,807`

### Corporate journey (role 2 of 5 — audited 2026-07-17)

- [ ] **C-01 (HIGH)** — Fix `handleConvertInquiryToBooking` to resolve capacity + rates from the RoomType entry in `settings/hotelConfig.roomTypes[]` instead of dead room-document fields (`pricePerNight`/`corporateRate`/`maxCapacity` moved off room docs in W3.6/W3.7). Currently a conversion without a manual rate override or attached access-code rate creates a confirmed booking at ₱0/night and the capacity check never fires. Reject a resolved rate of 0 without explicit override. `guest-app/server/handlers/corporate-inquiries.ts:183,217,229,253-257`

### Front desk journey (role 3 of 5 — audited 2026-07-17)

- No CRITICAL/HIGH findings. Two MEDs (FD-01 missing 8h inactivity auto-logout per SECURITY.md; FD-02 `guests/{uid}` rule allows self-written `role` fields → phantom staff rows in Settings) and one LOW docs contradiction (FD-03, Decision #81 vs admin-only Rates page) are tracked in `plan/docs/AUDIT-E2E-REPORT.md`.

### Admin journey incl. reports accuracy (role 4 of 5 — audited 2026-07-17)

- No CRITICAL/HIGH findings. Reports data accuracy verified: occupancy, revenue, and bookings-by-source compute from the same live AdminContext bookings snapshot as Bookings Management; cancelled/pending excluded, no-shows excluded from revenue but shown as retained cash (FL-14), voucher/senior/member discounts reflected via net totalPrice, corporate flat-rate counted at contract rate, timezone-correct overlap proration (FL-15), dynamic room counts. Three LOW docs-drift items (A-01 stale REPORTS.md status list, A-02 SECURITY.md corporateCodes write claim, A-03 future-range occupancy nuance) tracked in `plan/docs/AUDIT-E2E-REPORT.md`.

### Cross-cutting (role 5 of 5 — audited 2026-07-17, audit complete)

- [ ] **X-01 (HIGH)** — Remove `allow get: if true` from `firebase/storage.rules` on `bookings/{id}/payment-proof/`, `bookings/{id}/discount-id/`, and `store-orders/{roomNumber}/payment-proof/` — payment screenshots and OSCA/PWD government-ID photos are currently fetchable without authentication by path (store-order path keyed by guessable room number). Use local blob previews client-side, randomized upload filenames, and Admin-SDK-minted download URLs. `firebase/storage.rules:27-37,98-102`

**Audit verdict:** NO-GO until G-01, C-01, X-01 land (~1 dev-day combined); GO afterward. MEDs (incl. X-02 white-label hardcoding sweep — mandatory before the second white-label client) tracked in `plan/docs/AUDIT-E2E-REPORT.md`.

---

## References

- **Archive (historical, non-canonical):** `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` — full pre-compaction roadmap: Phases 0–9 checklists, Phase 11.5/11.6 batches 1–20, Wave 1–4 decision triage, Phase 11.7 implementation record, PR 1/PR 3 implementation detail, all closed audit-fix lists (FIN, FR, FL, PF, QA, NC, AUD, SA, live bugs)
- Audit reports: `plan/project/AUDIT-*.md` (historical) · `plan/docs/AUDIT-E2E-REPORT.md` (current, holds open MED/LOW findings)
- Decisions: `plan/docs/DECISIONS-ARCH.md` + `plan/docs/DECISIONS-FEATURES.md`
- Goodwill scope tracking: `plan/project/GOODWILL-SCOPE-LOG.md`
- Cutover: `plan/project/PROD-CUTOVER-RUNBOOK.md` · Deploy: `plan/project/DEPLOY.md`
