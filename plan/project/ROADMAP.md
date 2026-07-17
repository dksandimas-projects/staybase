# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: July 17, 2026 (**INC-01 opened — active production incident**: July-17 security rules deployed against the July-14 app; online-payment bookings and guest intercom broken. See §Production Incident.)
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
| E2E User Journey Audit (July 17) | ✅ All 17 findings fixed + merged to `dev` | Reach production via INC-01 resolution / cutover deploy |
| **INC-01 — Production rules/app skew (July 17)** | 🔴 **ACTIVE INCIDENT** | Online-payment bookings + guest intercom broken on the live site (§Production Incident below) |

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

## 🔴 INC-01 — Production Incident: rules/app version skew *(opened 2026-07-17, ACTIVE)*

> **Root cause:** the E2E-audit security rules (repo `firebase/firestore.rules` + `firebase/storage.rules`, fixed 2026-07-17) were deployed to the live Firebase project `spark-inn-stg-7a7ad` (serving `sparkinnbohol.com`), but the live app is still the 2026-07-14 build — `main` is ~133 commits behind `dev` and does not contain the matching client changes. The new rules assume the new app.
> **Evidence (verified 2026-07-17):** deployed rules fetched via Firebase MCP match the fixed repo versions; `git show main:...IntercomPage.tsx` still sends guest messages via client `addDoc`; `git show main:...BookingPage.tsx:716,746` still calls `getDownloadURL()` after proof/ID upload.

**Broken guest-facing flows on the live site:**

- ⬜ **INC-01a — Online-payment bookings blocked.** X-01's rules removed public read from `bookings/{id}/payment-proof/` and `discount-id/`, but the deployed app calls `getDownloadURL()` right after `uploadBytes()` → permission-denied → guest sees a permanent "Receipt upload failed. Please check your connection and try again." and cannot pass Step 3. Affects every GCash/bank booking and every Senior/PWD ID upload. Only Pay-at-Hotel bookings without a discount ID still complete.
- ⬜ **INC-01b — Guest intercom dead.** G-04's rule restricts `intercoms/{room}/messages` creation to staff (guests are meant to use the new rate-limited `POST /api/intercom/send-message`), but the deployed app still writes messages client-side via `addDoc` → every guest chat message and quick request fails with permission-denied.

**Not affected / silver lining:** X-01 itself (publicly fetchable OSCA/PWD government-ID photos and payment screenshots) is **closed in production** — the deployed rules are correct; it's the app that's behind. Staff-side admin flows and Pay-at-Hotel bookings still work.

**Resolution options (decide + execute ASAP):**

1. **Recommended — emergency `dev → main` merge + production deploy.** `dev` contains the exact client changes the rules expect (path-based uploads without `getDownloadURL`, API-routed intercom sends) and is fully green (847 tests, typecheck, builds, preflight 35/35). Jumps the FLR-05 / client-approval milestone gate — an active outage justifies it, but the owner/DK must make that call explicitly.
2. **Not recommended — partial rules rollback** (restore public `get` on the two Storage paths + guest message create). Restores service in minutes but re-opens X-01: government-ID photos become publicly fetchable again.
3. **Fallback — cherry-pick hotfix** of the fix commits onto `main`. Smallest production delta, but drags the committed API bundle and wasn't tested as an isolated unit.

**Close-out checklist:**
- ⬜ Decide the resolution path (owner/DK)
- ⬜ Deploy the fix; verify a live GCash test booking passes Step 3 with proof upload, and a guest intercom message + quick request deliver to the admin inbox
- ⬜ Confirm no stuck bookings/guests during the breakage window (check Resend logs / booking creation rate since 2026-07-17 rules deploy)
- ⬜ Record the prevention rule: **never deploy `firebase/*.rules` to a live project ahead of the app build that matches them** — rules and client ship together, or rules ship second (add to `plan/docs/GOTCHAS.md §Firebase` at close-out)

---

## E2E User Journey Audit (2026-07-17) — all findings remediated

✅ All 17 findings are fixed **and merged to `dev`**: the 3 HIGHs (`aae6808` — G-01 full-body Zod validation, C-01 RoomType-sourced conversion pricing, X-01 Storage-rule public-read removal), the 8 MEDs (`cfe6581`), and the 6 LOWs (`9b9c85e`). All 847 tests, typecheck, builds, and preflight pass. Report: `plan/docs/AUDIT-E2E-REPORT.md`.

⬜ **Remaining gate:** the app-side fixes reach production via the INC-01 resolution (see above — the rules half already deployed, which is what opened the incident). X-02's white-label sweep landed for Spark Inn; re-verify it before onboarding a second white-label client.

---

## References

- **Archive (historical, non-canonical):** `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` — full pre-compaction roadmap: Phases 0–9 checklists, Phase 11.5/11.6 batches 1–20, Wave 1–4 decision triage, Phase 11.7 implementation record, PR 1/PR 3 implementation detail, all closed audit-fix lists (FIN, FR, FL, PF, QA, NC, AUD, SA, live bugs)
- Audit reports: `plan/project/AUDIT-*.md` (historical) · `plan/docs/AUDIT-E2E-REPORT.md` (current, holds open MED/LOW findings)
- Decisions: `plan/docs/DECISIONS-ARCH.md` + `plan/docs/DECISIONS-FEATURES.md`
- Goodwill scope tracking: `plan/project/GOODWILL-SCOPE-LOG.md`
- Cutover: `plan/project/PROD-CUTOVER-RUNBOOK.md` · Deploy: `plan/project/DEPLOY.md`
