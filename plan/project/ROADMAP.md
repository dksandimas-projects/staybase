# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: July 23, 2026 (added guest-store search and category browsing)
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
| 12 — Post-Launch | 🔄 15/23 | See §Phase 12 below |
| Plan Audits (June 10: 21 · June 11: 16) · Finance & Reports FIN-01..14 · Reconciliation FR-01..05 · Finance Lifecycle FL-01..20 · Phase 12 Features PF-01..11 · Manual QA QA-01..08 · Live Bugs QA-09..26 · Notification Center NC-01..03 · Post-merge AUD-01..06 · Contract SA-01 | ✅ All closed | 0 — details in archive |
| Finance Lifecycle Recommendations (FLR, July 14) | 🔄 3/5 | FLR-03 deferred with trigger, FLR-05 open (§below) |
| Production Environment Split (PC, July 14) | 🔄 4/6 | PC-05, PC-06 (§below) |
| E2E User Journey Audit (July 17) | ✅ All 17 fixes **in production** (PR #118) | X-02 re-verify before 2nd white-label client |
| INC-01 — Production rules/app skew (July 17) | ✅ Resolved same day (emergency `dev → main` deploy) | Live verification + stuck-bookings check (§below) |

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
> Spec: `plan/features/SEO-OPENGRAPH.md`. G1–G6 + config + admin noindex all shipped (archive). Q1/Q3/Q4 resolved 2026-07-09.

- 🔴 **Q2.** Approve the 1200×630 OG card design (logo + tagline on brand orange) — owner.
- ⬜ **Verify** — FB Sharing Debugger + WhatsApp + Viber for ≥3 URLs; X Card Validator; Google Rich Results Test.
- ⬜ **Post-deploy** — submit sitemap to Google Search Console + Bing Webmaster Tools.

---

## Phase 12 — Post-Launch (Phase 2, Deferred)
> Goal: Enhancements after stable v1.0.0. 15 features shipped (email preview, breakfast CRUD, dashboard intercom widget, early check-in, calendar, seasonal rates, Rate Calendar, discount/voucher repairs, check-in gate, PDF repair, price breakdown, Senior/PWD toggle, post-booking discounts, FIN-14, Notification Center, payment rejection) — full records in archive.

### Deferred features
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya)
- ⏸ Automated test suite
- ⏸ Additional hotel client deployments (white-label)

### Guest Check-in Registration (GCR)

- ⬜ **GCR-01 — Required purpose of stay** — Decision #121 across form, booking data, readiness gate, registration PDF, regression tests. Default `Leisure`.

### Confirm with Balance (CWB) — shipping 2026-07-23
> Decision #122. Spec: `plan/features/BOOKINGS-MANAGEMENT.md §Confirm with Balance (CWB)`. Branch: `feat/confirm-with-balance`. Reuses `hotelConfig.unpaidCheckoutApprovalThreshold` (default 5,000).

- ⬜ **CWB-01 — Server** — `POST /api/bookings/confirm-with-balance` (staff-auth, 30/min/IP). Atomic txn; validates `payment-uploaded`; reason ≤500 chars; gates `front-desk` vs threshold (above → 403 `admin`); stamps `confirmedWithBalance*` + flips `status: "confirmed"`; fires email + `booking` notification.
- ⬜ **CWB-02 — Email** — `bookingConfirmedWithBalanceEmail(booking, balance, reason)` with a **"Balance to settle at check-in"** callout. Room type only.
- ⬜ **CWB-03 — `ConfirmWithBalanceForm`** — Total/Paid/Balance preview, persistent **threshold info banner** at the top (always visible, not a tooltip — staff are guided/reminded by the limit), required reason (500-char counter), submit disabled when `front-desk` + balance > threshold, success toast.
- ⬜ **CWB-04 — Entry points + indicator** — `PaymentSuccessModal` partial variant shows **"Confirm with Balance"** CTA. Drawer More actions menu gets **"Confirm with Balance"** for `payment-uploaded` rows. Drawer renders a **Balance owed** panel above Folio when `confirmedWithBalance != null` AND current balance > 0; auto-hides at ₱0. Reuses the existing **Balance due** chip.
- ⬜ **CWB-05 — Tests + docs** — server tests (auth, threshold, role, status, reason, atomicity); typecheck + regression tests; `BACKEND.md`, `BOOKINGS-MANAGEMENT.md`, `DECISIONS-FEATURES.md` #122, this roadmap, `EMAIL-PDF-STORAGE.md` updated.

### Legal Content Enhancements (LCE)

- ⬜ **LCE-01 — Editable Terms & Conditions** — admin-only Legal Content editor; `/terms` uses saved content with deploy-time fallback. Version new booking consent + test save/render/fallback/sanitization/versioning.

### Email Content Enhancements (ECE)

- ⬜ **ECE-01 — House Rules in payment-confirmation email** — reuse the existing setting, omit when blank, include in preview.

### Guest Store Discovery (GSD)

- ⬜ **GSD-01 — Search and category browsing** — combined catalog search + category filters per `plan/features/STORE-GUEST.md §Catalog Discovery`.

### Multi-Booking Picker (MBP) — proposed 2026-07-24
> Decision #123. Spec: `plan/features/BOOKING-LOOKUP.md §Multi-Booking Picker`. Privacy-preserving list when email-alone path matches >1 booking.

- ⬜ **MBP-01..04** — Server `kind` discriminator + 2 privacy modes (single-name / multi-name) + cap-10 + picker UI + deep link. See `plan/features/BOOKING-LOOKUP.md §Multi-Booking Picker`.

### Booking Drawer UX Refactor (BDUX) — remaining verification
> BDUX-01..08 + BDUX-05a..05n shipped 2026-07-16 (contract in archive).

- ⬜ Verify representative bookings across every status + conditional combination.
- ⬜ At 1440px, staff can understand guest/stay/payment/balance/next action without scrolling the default Overview.
- ⬜ At 375px, no horizontal scroll; primary action above safe area; modal/sheet focus + close behavior accessible.
- ⬜ Default Folio has no expanded entry form; each reachable through one labeled action.
- ⬜ Completing any Folio action leaves the user on Folio with updated Total/Paid/Balance/ledger visible.
- ⬜ Pending payment proof reachable from sticky header in one action; verified proof accessible without dominating default Folio.
- ⬜ Next valid status action reachable in one tap from any section.
- ⬜ Run admin typecheck, booking/admin regression tests, and manual visual QA across mobile/tablet/desktop before marking complete.

*(UCO-01..14 and PRC-01..19 shipped 2026-07-16 — contracts in archive.)*

### Bookings & Store Orders Filtering UX (FSO) — remaining verification
> FSO-01..18 shipped 2026-07-16 (contract in archive). Advanced filter Phase 2 pending.

- ⬜ At 375px: no horizontal scroll, quick chips operable, advanced sheet one-handed above safe area.

### Environment Test Runs & Controlled Data Reset (ETR)
> Phase 1 core shipped (ETR-01..14, ETR-S01..S15). **Open spec: ETR-R01..R10, ETR-D01..D10, ETR-15..20, ETR-21.** Full spec: `plan/features/ENVIRONMENT-TEST-RESET.md`.

### Finance scope boundaries (recorded decisions — do not re-open without owner request)
- ⏸ Expenses & P&L tracking — out of scope; system is a PMS, not accounting software; exports feed external bookkeeping/BIR
- ⏸ Day-locking / night-audit snapshots — deferred at 14-room scale; payments are already append-only at the rules level, which covers the cash side; revisit if historical figures drift or staff grows

---

## Finance Lifecycle Recommendations — open items (2026-07-14)
> Source: `plan/project/AUDIT-FINANCE-LIFECYCLE-2026-07-12.md §Post-remediation recommendations`. FLR-01/02/04 fixed 2026-07-14 (detail in archive).

- ⏸ **FLR-03 — Bound Reports ledger listeners** *(deferred with trigger)* — `collectionGroup("payments"/"charges")` loads full ledger history live on every Reports visit; fine at 14 rooms, linear forever on Blaze. **Trigger: revisit at ~1 year of operation** — switch to `recordedAt`-bounded queries; all-time Receivables fall back to one-shot `getDocs`.
- 🔄 **FLR-05 — Operational handover** *(owner-facing)* — handover in `FINANCE-LIFECYCLE-HANDOVER-2026-07-14.md`. Daily Close convention + accountant VAT review + staging money-path walkthrough have explicit checklists/evidence. **Remaining:** accountant confirmation + owner sign-off before next `dev → main` milestone.

---

## Production Environment Split — cutover queue (added 2026-07-14)
> Source: `plan/project/PROD-CUTOVER-RUNBOOK.md` — demote `spark-inn-stg-7a7ad` to staging, stand up Vercel staging on `dev` at `stg.sparkinnbohol.com` / `stg-admin.sparkinnbohol.com`, cut production over to clean-slate `spark-inn-prod`. Runbook holds checklists, prod client config, secret-handling rules. PC-05 carry-over resolved: clean slate only, staff pre-provisioned — Decision #119. PC-01..PC-04 done 2026-07-14 (archive).

- ⬜ **PC-05 — Archive + data carry-over** — Full Backup XLSX + `gcloud firestore export` archive, then recreate active staff accounts in production Auth/Firestore.
- ⬜ **PC-06 — Cutover + smoke test** — freeze window, Production redeploy, preflight, end-to-end smoke booking on prod (then cancel/refund), email triggers, integrity scan, rules verification, QR spot-check, local key file deleted, first real Daily Close.

---

## INC-01 — Production Incident: rules/app version skew *(opened 2026-07-17 · resolved 2026-07-17)*

> **Root cause:** E2E-audit security rules (fixed 2026-07-17) were deployed to live `spark-inn-stg-7a7ad` (serving `sparkinnbohol.com`), but the live app is still the 2026-07-14 build — `main` is ~133 commits behind `dev` and lacks the matching client changes. New rules assume the new app.
> **Evidence (verified 2026-07-17):** deployed rules via Firebase MCP match the fixed repo versions; `git show main:...IntercomPage.tsx` still sends guest messages via client `addDoc`; `git show main:...BookingPage.tsx:716,746` still calls `getDownloadURL()` after proof/ID upload.

**Broken guest-facing flows during the incident window:**

- ✅ **INC-01a — Online-payment bookings blocked.** X-01's rules removed public read from `bookings/{id}/payment-proof/` and `discount-id/`, but the deployed app calls `getDownloadURL()` right after `uploadBytes()` → permission-denied → guest sees a permanent "Receipt upload failed. Please check your connection and try again." and cannot pass Step 3. Affects every GCash/bank booking and every Senior/PWD ID upload. Only Pay-at-Hotel bookings without a discount ID still complete.
- ✅ **INC-01b — Guest intercom dead.** G-04's rule restricts `intercoms/{room}/messages` creation to staff (guests are meant to use the new rate-limited `POST /api/intercom/send-message`), but the deployed app still writes messages client-side via `addDoc` → every guest chat message and quick request fails with permission-denied.

**Not affected / silver lining:** X-01 itself (publicly fetchable OSCA/PWD government-ID photos and payment screenshots) is **closed in production** — the deployed rules are correct; it's the app that's behind. Staff-side admin flows and Pay-at-Hotel bookings still work.

**Resolution (executed 2026-07-17):** emergency `dev → main` merge (PR #118, `2e6ca4e`) deployed to production by DK — the app now matches the deployed rules, and all 17 E2E audit fixes are live. The partial-rules-rollback and cherry-pick alternatives were rejected (would re-open X-01 / untested as a unit). Note: this merge was the incident fix, not the Phase 11 staging-milestone sign-off — the FLR-05 and client-review gates in §Phase 11 remain open.

**Close-out checklist:**
- ✅ Decide the resolution path — option 1, emergency deploy (DK, 2026-07-17)
- ✅ Deploy the fix — PR #118 merged and deployed to production
- ⬜ Verify live: a GCash test booking passes Step 3 with proof upload; a guest intercom message + quick request deliver to the admin inbox
- ⬜ Confirm no stuck bookings/guests during the breakage window (check Resend logs / booking creation rate between the 2026-07-17 rules deploy and PR #118)
- ✅ Prevention rule recorded in `plan/docs/GOTCHAS.md §Firebase` — never deploy `firebase/*.rules` ahead of the app build that matches them

---

## E2E User Journey Audit (2026-07-17) — all findings remediated

✅ All 17 findings are fixed **and merged to `dev`**: 3 HIGHs (`aae6808` — G-01 full-body Zod, C-01 RoomType-sourced conversion pricing, X-01 Storage-rule public-read removal), 8 MEDs (`cfe6581`), 6 LOWs (`9b9c85e`). All 847 tests, typecheck, builds, preflight pass. Report: `plan/docs/AUDIT-E2E-REPORT.md`.

✅ **Gate cleared 2026-07-17:** app + rules in production (PR #118 + the earlier rules deploy) — audit's NO-GO lifted. Only follow-up: re-verify X-02's white-label sweep before a second white-label client.

---

## Spark Rewards Feature Audit (2026-07-18) — open findings

Report: `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md`. Sections 1–3 audited; 4–5 pending. CRITICAL/HIGH only.

**Section 3 — Early Check-In / cross-cutting (§1 registration + stays):**
- ⬜ **HIGH-1 — Email-based booking match trusts unverified `email` token claims.** `authenticateUser` never surfaces `email_verified`; `linkBookingsByEmail`, `handleListMemberStays`, and `findBooking` all grant access on `guestEmail == token.email`. Attacker can link, read (stays projection leaks `bookingRef` + `lookupToken` → public cancel), and act on stranger bookings. Fix: require `email_verified === true` before any email-based booking match; verify email on email/password signup. See `plan/docs/GOTCHAS.md §Auth & Security` + `plan/features/SPARK-REWARDS.md §Known Issues`.

_No CRITICAL/HIGH from Sections 1–2 (highest was MED-1: manual points adjustment is a client-side write; see report + `GOTCHAS.md §Security & PII`)._

---

## References

- **Archive (historical, non-canonical):** `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` — pre-compaction roadmap: Phases 0–9, 11.5/11.6 batches 1–20, Wave 1–4 decision triage, 11.7 record, PR 1/3 detail, closed audit-fix lists (FIN, FR, FL, PF, QA, NC, AUD, SA, live bugs).
- Audit reports: `plan/project/AUDIT-*.md` (historical) · `plan/docs/AUDIT-E2E-REPORT.md` (current, open MED/LOW).
- Decisions: `plan/docs/DECISIONS-ARCH.md` + `plan/docs/DECISIONS-FEATURES.md`.
- Cutover: `plan/project/PROD-CUTOVER-RUNBOOK.md` · Deploy: `plan/project/DEPLOY.md`.
