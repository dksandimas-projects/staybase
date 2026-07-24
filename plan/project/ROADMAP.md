# Spark Inn — Build Roadmap & Checklist
> Living document — **must be updated on every merge** (see `How to Use This File` + `plan/docs/CONTRIBUTING.md §When to Update Which MD`)
> Last updated: July 24, 2026 (marked GCR-01 as shipped; GCR-01 ships in the same commit as this roadmap bump per the on-merge rule)
> Status key: ✅ Done | 🔄 In Progress | ⬜ Not Started | ⏸ Deferred

---

## How to Use This File

- **Must be updated on every merge to `dev`** (per `plan/docs/CONTRIBUTING.md §When to Update Which MD`). The closing the loop is: when a `feat:` / `fix:` / `refactor:` lands, this file gets a `docs:` PR in the same batch. The roadmap is the project's source of truth for "what's open" — drift between the code and the roadmap makes the next person pick wrong work.
- Check off items as they're completed (`⬜` → `✅`); for `XX-01..05` style items, mark each sub-item or convert to one `✅ **XX**` line with the shipped commit(s).
- Update "Last updated" date at the top on each edit.
- Add a one-line `Shipped YYYY-MM-DD — <commit hash>` note to the section header so future readers can find the implementation.
- **Off-roadmap fixes/featuers** (a `fix:` that wasn't on the roadmap before it shipped) — add a short note under a `### Recently shipped (off-roadmap)` section near the bottom of Phase 12, with the commit hash, so the roadmap still reflects what's actually in the code. Don't leave the implementation unrecorded.
- Add notes under items if there are blockers or decisions made.
- Commit with `docs: update ROADMAP.md` prefix (no version bump).
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
| 12 — Post-Launch | 🔄 18/26 | See §Phase 12 below |
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

- ✅ **GCR-01 — Required purpose of stay** — Shipped 2026-07-24 (this commit, `feat/purpose-of-stay` → `dev`). Decision #121 across form, booking data, readiness gate, registration PDF, regression tests. Default `Leisure`; "Other" requires a free-text `otherPurpose` reason (also enforced by the shared readiness gate). See `plan/features/BOOKINGS-MANAGEMENT.md` (Check-in section), `plan/docs/BACKEND.md §bookings` (guestRegistration row), `shared/utils/checkin.ts` (gate), `shared/__tests__/checkin.test.ts` (4 new tests), `admin-app/src/__tests__/purpose-of-stay-registration.test.ts` (6 new tests).

### Confirm with Balance (CWB) — shipped 2026-07-24
> Decision #122. Spec: `plan/features/BOOKINGS-MANAGEMENT.md §Confirm with Balance (CWB)`. Branch: `feat/confirm-with-balance`. Reuses `hotelConfig.unpaidCheckoutApprovalThreshold` (default 5,000). **Shipped 2026-07-24** via `4455f9d` → merged to `dev` in `f7c1d25` (this batch missed updating the roadmap at merge time; caught 2026-07-24 during a HSD-prereq audit and recorded here).

- ✅ **CWB-01 — Server** — `POST /api/bookings/confirm-with-balance` (staff-auth, 30/min/IP). Atomic txn re-reads booking + payments + charges + add-to-bill store orders + threshold; validates `status === "payment-uploaded"`; reason ≤500 chars; gates `front-desk` vs threshold (above → 403 `admin`); stamps `confirmedWithBalance*` + flips `status: "confirmed"` + writes standard `paymentConfirmedAt` / `handledBy` / `confirmedAt`; fires `booking-confirmed-with-balance` email + `booking` notification.
- ✅ **CWB-02 — Email** — `bookingConfirmedWithBalanceEmail(booking, balance, reason)` with a **"Balance to settle at check-in"** callout. Room type only (never room number — `confirmed` is not yet `checked-in` per the room-number-visibility rule).
- ✅ **CWB-03 — `ConfirmWithBalanceForm`** — Total/Paid/Balance preview, persistent **threshold info banner** at the top (always visible, not a tooltip — staff are guided/reminded by the limit), required reason (500-char counter), submit disabled when `front-desk` + balance > threshold, success toast. 277 lines.
- ✅ **CWB-04 — Entry points + indicator** — `PaymentSuccessModal` partial variant shows **"Confirm with Balance"** as the primary CTA (replaces the prior "Got it" dismiss). Drawer More actions menu gets **"Confirm with Balance"** for `payment-uploaded` rows. Drawer renders a **Balance owed** panel above Folio when `confirmedWithBalance != null && getBookingFolio(b).balance > 0`; auto-hides at ₱0. Reuses the existing **Balance due** chip.
- ✅ **CWB-05 — Tests + docs** — server tests (auth, threshold, role, status, reason, atomicity); typecheck + regression tests; `BACKEND.md`, `BOOKINGS-MANAGEMENT.md §Confirm with Balance (CWB)`, `DECISIONS-FEATURES.md #122`, this roadmap, `EMAIL-PDF-STORAGE.md` updated. *(Visual QA matrix across statuses/breakpoints still pending — see §Phase 12 →Booking Drawer UX Refactor.)*

### Legal Content Enhancements (LCE)

- ⬜ **LCE-01 — Editable Terms & Conditions** — admin-only Legal Content editor; `/terms` uses saved content with deploy-time fallback. Version new booking consent + test save/render/fallback/sanitization/versioning.

### Email Content Enhancements (ECE)

- ✅ **ECE-01 — House Rules in payment-confirmation email** — Shipped 2026-07-24 (`9751ca7`, `feat/email-house-rules` → `dev`). Reuses `settings.websiteContent.houseRules`; `sendBookingTrigger` loads the doc non-transactionally only for the `payment-confirmed` action (other triggers skip the round-trip). Card omitted entirely when blank or whitespace-only; rendered via the existing `escapeHtml` helper to prevent injection. Preview handler accepts `houseRules` in the request body so staff can sanity-check the card before saving. See `plan/features/EMAIL-PDF-STORAGE.md §Email Content Checklist` + `guest-app/tests/api/email-house-rules.test.ts` (10 tests).

### Guest Store Discovery (GSD)

- ⬜ **GSD-01 — Search and category browsing** — combined catalog search + category filters per `plan/features/STORE-GUEST.md §Catalog Discovery`.

### Breakfast Served Persistence (BSP) — confirmed defect 2026-07-24
> **Observed behavior:** Dashboard → Today's Breakfast → **Mark Served** does not remain served after the real-time booking snapshot refreshes. **Confirmed cause:** `toggleBreakfastServed` writes the `breakfastServed` map through `updateBookingStatus`, and Firestore rules permit the field, but the booking snapshot mapper in `AdminContext.tsx` hydrates `breakfastSelections` and omits `breakfastServed`. Dashboard state therefore receives the booking without the saved map and renders the row as unserved again. Do not treat the existing source-presence test as coverage of persistence; it only checks that the relevant names occur in `DashboardPage.tsx`.

- ⬜ **BSP-01 — Restore persisted served state** — hydrate `breakfastServed` from each booking snapshot so the dashboard reflects the saved per-date/per-guest values after refresh and across staff sessions.
- ⬜ **BSP-02 — Add behavioral regression coverage** — verify an initially unserved row becomes served, remains served after a simulated snapshot refresh, and can be toggled back; cover write failure feedback so staff are not left with a silent false state.
- ⬜ **BSP-03 — Manual QA** — with two breakfast guests on the same booking, mark only one served; reload the dashboard and verify the individual state plus remaining-count badge, then confirm a second signed-in staff session sees the same result.

### Multi-Booking Picker (MBP) — shipped 2026-07-24; **tightened 2026-07-25 (MBP-05, decision #126)**
> Decision #123 + #126. Spec: `plan/features/BOOKING-LOOKUP.md §Multi-Booking Picker`. Privacy-preserving list when email-alone path matches >1 booking. **Shipped 2026-07-24 on `feat/multi-booking-picker`; tightened the next day on `fix/mbp-no-name` after a follow-up RA 10173 review.**

- ✅ **MBP-01 — Server `kind` discriminator** — `POST /api/bookings/lookup` returns `{ kind: "list", bookings: [...], moreExist }` when email matches >1 booking, `{ kind: "single", ...enrichedBooking }` for 1 match + every other path (ref+token, ref+email, ref alone, token alone). `enrichAndRespond` now wraps the single-booking response with `kind: "single"`. Backward-compatible: clients that don't read `kind` still see the same fields they always did.
- ✅ **MBP-02 — Two privacy modes (auto-detect)** — `email-alone` branch sorts by `checkIn` desc with `createdAt` desc tiebreaker; if every match shares the same trimmed+lowercased `guestName`, every list entry includes `guestName`; otherwise every entry omits it. The picker never surfaces "which mode triggered" — the omission is the privacy signal. **[Superseded by MBP-05 below on 2026-07-25.]**
- ✅ **MBP-03 — Picker UI on `BookingLookupPage`** — new `pickerResults` state + `PickerEntry` type; result area cycles search form → picker (when `kind: "list"`) → single-booking card (after a row click). Each picker row is a button that triggers a `ref + email` lookup through the existing strict path. "10 most recent — contact the front desk for older stays" footer when `moreExist` is true.
- ✅ **MBP-04 — Tests + MD sync** — `guest-app/tests/api/bookings-lookup-list.test.ts` (8 new tests: 1-match → single, 2-match same name → single-name list, 2-match mixed names → multi-name list, mixed-case same name, 11+ matches → moreExist, checkIn/createdAt sort, ref+email → single, 0 matches → 404). Updated `bookings-lookup.test.ts` (the "email alone with several bookings" test was checking the old auto-pick behavior; now scoped to 1 match). MDs: `plan/features/BOOKING-LOOKUP.md` (this section), `plan/docs/DECISIONS-FEATURES.md #123` (expanded with implementation + cap reasoning), `plan/project/ROADMAP.md` (this entry).
- ✅ **MBP-05 — Drop `guestName` from the wire; add `maskedEmail` (decision #126, 2026-07-25)** — Follow-up RA 10173 review caught that "single-name mode" still leaked the full name to anyone with email access (a spouse, ex-partner, shared family inbox). The single-name vs multi-name mode distinction is retired; the row shape is now uniform regardless of who the bookings are for: `{ id, bookingRef, maskedEmail, checkIn, checkOut, numNights, roomType, status }`. `maskedEmail` is first char of local + `***` + full domain (e.g. `j***@gmail.com`); the attacker already typed the email so the leak surface is zero, the legit user gets a small UX confirmation. The full name is still revealed on the single-booking card after the user picks a row (existing `ref + email` second factor). **Implementation shipped on `fix/mbp-no-name`:** new module-level `maskEmail()` helper in `bookings.ts`; server entry-construction loop simplified (no more `allShareName` branch); client `PickerEntry` type + row UI updated; 4 tests rewritten + 1 new test pinning the exact `j***@gmail.com` format. `plan/features/BOOKING-LOOKUP.md` spec rewritten around the uniform payload; `plan/docs/DECISIONS-FEATURES.md #126` added.
- ✅ **MBP-06 — Drop `guestName` from the single-booking card on the email-alone 1-match path (decision #128, 2026-07-25)** — Same-day follow-up on MBP-05. The "second factor protects the single-booking card" claim in #126 was wrong for the 1-match case: the user only typed an email, no `ref` is in play, and the page went straight to the single-booking card with the full name revealed. The picker (2+ matches) was already fixed in MBP-05; the single-booking card reachable via email-alone was not. Decision: **the public `/my-booking` page never reflects a name back to anyone who arrived via email alone.** `enrichAndRespond` gained an `options: { omitGuestName?: boolean }` flag; the email-alone 1-match call site passes `{ omitGuestName: true }`. Strict paths (ref+email, ref+token, ref alone, token alone) still include the name. `BookingData` interface on the client makes `guestName` optional; the single-booking card's "Lead Guest" section is gated on `activeBooking.guestName &&`. **Implementation shipped on `fix/mbp-no-name-on-card`:** 1 server call site + 1 helper signature + 1 client interface field + 1 UI conditional. Tests: `bookings-lookup-list.test.ts` "1 match → single" test renamed to assert `guestName` is absent; "ref+email path returns kind: single" test renamed to assert `guestName` is present (pinning the second-factor distinction). `bookings-lookup.test.ts` "email alone returns the most recent booking when 1 match exists" gained the same absent-assertion. `plan/features/BOOKING-LOOKUP.md` privacy stance updated; `plan/docs/DECISIONS-FEATURES.md #128` added.
- ✅ **MBP-07 — Picker click no longer fails with "Bot verification token is missing" (2026-07-25)** — Live bug reported via screenshot from staging: user entered an email with multiple bookings, the picker rendered, click a row → page reverted to the "Find your booking" form with the ref + email pre-filled and the error "Bot verification token is missing." displayed. Root cause: `performLookup` unconditionally called `resetTurnstile()` in its `finally` block, which consumed the Turnstile token right after the email-alone lookup returned the list. The widget then needed 1-3 seconds to mint a new token, but the user clicked a row immediately. Fix: track `showedPicker` in `performLookup`; only `resetTurnstile()` when the picker was NOT shown. The picker click reuses the same token (Cloudflare's `siteverify` is idempotent within the 300s validity window, so the second verification succeeds; the existing 10/min rate limit + 3-failure 1-hour backoff still gate enumeration). **Plus: URL-driven picker navigation.** `handlePickerSelect` now calls `navigate(\`/my-booking?ref=…&email=…\`, { replace: true })` instead of `performLookup` directly — the existing `useEffect` on `searchParams` handles the auto-lookup. Bonus UX: the URL is bookmarkable, refreshable, shareable, and the Back button works. **Implementation shipped on `fix/mbp-picker-click-turnstile`:** 1 finally-block condition + 1 navigate call + `useNavigate` import. No server change. No new test (the fix is React state management; the wire shape is already covered by `bookings-lookup-list.test.ts` "email-alone with 2+ matches" + "ref+email path returns kind: single").

### Walk-in Name Split (WSN) — shipped 2026-07-25
> Decision #127. Spec: `plan/features/BOOKINGS-MANAGEMENT.md §Walk-in Name Split`. The walk-in modal (and the `/calendar` "Create Calendar Booking" modal) now mirror the guest `/book` page — first + last name are separate fields, sent over the wire as `{ firstName, lastName }` inside `guestDetails`. **Shipped 2026-07-25 on `fix/walkin-split-name`.**

- ✅ **WSN-01 — Modal form splits first + last name** — `BookingsPage.tsx` walk-in modal renders a two-input flex row (stacks on mobile per Phase 11.7 single-column-on-mobile; side-by-side on sm+). Both inputs are `required` with `autoComplete="given-name"`/`"family-name"`. The old single "Guest Full Name" input is gone. State is `[walkinFirstName, walkinLastName]`.
- ✅ **WSN-02 — Drop the `split(" ")` kludge; `addWalkinBooking` accepts firstName + lastName** — `AdminContext.tsx` parameter renamed `booking` → `input` and the type now reads `Omit<Booking, …, "guestName"> & { firstName: string; lastName: string }`. The wire payload's `guestDetails` reads `firstName: trimmedFirst, lastName: trimmedLast` directly — the `||` fallbacks ("Guest", "Walkin") and the on-the-wire name-split are gone. The context refuses empty inputs before the network with `{ success: false, error: "First name and last name are required." }`. The booking doc still stores `guestName = \`${firstName} ${lastName}\`` server-side (same logic the guest `/book` flow has always used). No migration. `CalendarPage.tsx` gets the same fix — it was the second caller of the same kludge.
- ✅ **WSN-03 — Tests + MD sync** — `admin-app/src/__tests__/walkin-split-name.test.ts` (12 new tests pinning the type contract, wire payload, removed kludge, and both modals' form state). `admin-app/src/__tests__/phase-12-discount-controls.test.ts` updated for the `input.*` parameter rename. MDs: `plan/features/BOOKINGS-MANAGEMENT.md` (new "Walk-in Name Split" section), `plan/docs/DECISIONS-FEATURES.md #127` (full implementation + no-migration note), `plan/project/ROADMAP.md` (this entry).

### HEIC Support (HSD) — proposed 2026-07-24; shipped 2026-07-24
> Rationale: the `fix/guest-id-pdf-stuck` ship (2026-07-24) made the registration PDF safe against undecodable formats (5s decode timeout + strict MIME-type guard) but still rejects HEIC outright. iPhone guests often hand the front desk HEIC photos from the camera roll because iOS defaults to HEIC (Settings → Camera → Formats → "High Efficiency"), so the reject path is a recurring front-desk friction point. Goal: accept HEIC in the guest ID upload and convert it client-side to JPEG before it ever reaches Storage, so the registration PDF path stays clean and the iPhone workflow just works.
>
> Approach: client-side WASM conversion via `heic-to@1.5.2` (LGPL-3.0, decision #125) lazy-loaded via dynamic `import()` only when `file.type === "image/heic" || file.type === "image/heif"`. Rejected: server-side conversion (Vercel Hobby 12-function cap already tight), Safari-only passthrough (half-supported formats are worse than full-reject), and `heic2any` itself (unmaintained per issue `alexcorvi/heic2any#63`).

- ✅ **HSD-01 — Library eval** — three candidates measured on `npm install --no-save` against the current Vite 6 + Node 20 + React 19 stack. Pick: `heic-to@1.5.2` (LGPL-3.0, actively maintained, tracks libheif 1.20.2). All three ship a ~500-720 KB gzipped libheif WASM blob — the original "<200 KB" spec target was wishful. **720 KB lazy-loaded is the floor.** Spec section: `plan/features/BOOKINGS-MANAGEMENT.md §Guest ID upload` (HEIC handling bullet).
- ✅ **HSD-02 — Lazy conversion in `handleGuestIdUpload`** — `HEIC_INPUT_MIME_TYPES = { image/heic, image/heif }` branch BEFORE the allowlist + compress path. `await import("heic-to")` → `heicTo({ blob: file, type: "image/jpeg", quality: 0.92 })` → wrap in `new File([converted], "id.jpg", { type: "image/jpeg" })` → existing `compressImageFile` path. Conversion uses Web Workers internally so the UI thread is not blocked. Conversion errors fall through to a user-facing toast + `return`; the upload step never runs with a bad blob.
- ✅ **HSD-03 — Drop HEIC from rejection list + update copy** — `ALLOWED_GUEST_ID_MIME_TYPES` still holds only `image/jpeg` / `image/png` / `image/webp` (the post-conversion stream). The file picker `accept` attribute is now `image/jpeg,image/png,image/webp,image/heic,image/heif` so iOS Safari surfaces HEIC photos in the "Recents" list. Upload card copy: `"JPG, PNG, or WebP. HEIC from iPhone cameras is auto-converted to JPEG before upload."`
- ✅ **HSD-04 — Tests + MD sync + bundle verification** — `admin-app/src/__tests__/heic-support.test.ts` (9 new tests: dynamic-import contract, HEIC-precedes-allowlist order, conversion payload, non-HEIC skip, error toast, allowlist shape, accept attribute, copy, package wiring). Updated `admin-app/src/__tests__/pdf-generation-repair.test.ts` for the new architecture. **`vite build` measured delta:** initial bundle +0.59 KB gzipped (just the import statement); lazy chunk 734.59 KB gzipped (`dist/assets/heic-to-*.js`), loaded only on HEIC detection. MDs updated: `plan/features/BOOKINGS-MANAGEMENT.md §Guest ID upload` (new HEIC bullet + updated format-guard copy), `plan/docs/DECISIONS-FEATURES.md #125` (expanded with implementation + measured deltas).
- ⬜ **HSD-05 — Manual QA on real devices** — `feat/heic-support` is code-complete; the next gate is real-device verification. (1) Real iPhone HEIC photo (Settings → Camera → High Efficiency, "Most Compatible" off) → upload → preview registration PDF in **Chrome** (highest priority — Chrome can't decode HEIC natively, so this is the real test that the convert path actually runs). (2) Same flow in Firefox + Safari. (3) Verify WASM init doesn't block the UI for >2s on a real device. (4) Conversion error path: corrupt HEIC (truncated file) → existing 5s decode-timeout toast in the PDF generator still catches the bad blob. (5) Verify the convert-payload bytes are reasonable (JPEG should be 200-500 KB after the quality 0.92 + 1400px max-dim compress step).

- ⬜ **HSD-01 — Library evaluation** — Pin `heic2any` (or a maintained fork if the upstream is stale) and verify it builds + decodes on Vite 6 + Node 20. Measure: WASM init cost, bundle delta (target < 200KB gzipped, paid only when HEIC is detected), Safari/Chrome/Firefox parity. Fallback plan if install breaks or bundle delta is unacceptable: keep the strict-reject behavior shipped in `fix/guest-id-pdf-stuck` (i.e. do not regress on the safety fix).
- ⬜ **HSD-02 — Lazy conversion in `handleGuestIdUpload`** — In `admin-app/src/pages/BookingsPage.tsx`, before the existing `ALLOWED_GUEST_ID_MIME_TYPES` guard, branch on `file.type === "image/heic" || file.type === "image/heif"`. Dynamic `import("heic2any")` → convert HEIC blob → wrap in a `new File([blob], "id.jpg", { type: "image/jpeg" })` → feed into the existing `compressImageFile` path. Conversion must not block the UI thread (offload via the library's worker mode if available).
- ⬜ **HSD-03 — Drop HEIC from the rejection list and update upload card copy** — Remove `"image/heic"` and `"image/heif"` from the `ALLOWED_GUEST_ID_MIME_TYPES` allowlist; replace the upload card helper text `"JPG, PNG, or WebP. Image is compressed before upload."` with `"JPG, PNG, WebP, or HEIC (auto-converted to JPEG before upload)."`. Keep the `accept` attribute set to all four types so the OS picker surfaces HEIC files.
- ⬜ **HSD-04 — Tests + MD sync** — Regression test that mocks the conversion library and asserts the conversion path runs for HEIC input but is skipped for JPEG/PNG/WebP. Verify the gzipped `admin-app` bundle delta in `vite build` output is < 200KB. Update `BOOKINGS-MANAGEMENT.md §Guest ID upload` (drop the format-guard bullet, add an HEIC-accepted bullet) and add a new entry to `DECISIONS-FEATURES.md` for the chosen library + dynamic-import strategy.
- ⬜ **HSD-05 — Manual QA on real devices** — Real iPhone HEIC photo (Settings → Camera → High Efficiency) → upload → preview registration PDF in **Chrome** (highest priority — Chrome can't decode HEIC natively, so this is the real test). Also verify Firefox + Safari. Confirm WASM init doesn't block the UI for >2s and that the conversion error path (corrupt HEIC, oversized HEIC) still falls through to the existing 5s decode-timeout toast in the PDF generator.

### Modal Backdrop Z-Index (MBZ) — proposed 2026-07-24 · ✅ shipped 2026-07-24 (`6731aea`, `fix/modal-backdrop-z-index` → `dev`)
> Discovered while checking the CWB (Confirm with Balance) and PaymentSuccessModal flows on the live dev branch: when a modal opens on top of the booking drawer, the right ~480px of the viewport (where the drawer panel sits) shows **no faded background**. The modal's own backdrop and the drawer's own backdrop were both `z-40`, while both panels were `z-50` — so a panel rendered later in the DOM correctly covered an earlier panel, but a modal backdrop could never cover a drawer panel (lower z-index). Affects the verify-payment, confirm-with-balance, record-payment, apply-discount, add-charge, refund, and unpaid-checkout modals, all of which can be opened from inside the booking drawer.
>
> Fix shipped: backdrop z-index bumped to `z-[60]` and fade to `bg-gray-950/60` in `Modal.tsx`, `Drawer.tsx`, and mobile `Sidebar.tsx`. Panels stay at `z-50`; toasts stay at `z-[100]`. New "Z-Index Scale" section in `plan/admin-app/CLAUDE.md` documents the agreed layer order so the next overlay lands at the right z-index on the first try. 7 regression tests in `admin-app/src/__tests__/modal-backdrop-z-index.test.ts`.

- ✅ **MBZ-01 — Bump modal + drawer backdrop z-index above the panel** — `z-40` → `z-[60]` in `Modal.tsx` + `Drawer.tsx`; code comments explain the stacking context.
  - **Re-fix 2026-07-24 (`1507a88`, `fix/mbz-z-index-regression`):** the original MBZ-01 set the backdrop above the panel of any nested overlay, but it also set it above its OWN panel — so within a single stacking context the backdrop covered the panel and the booking drawer disappeared behind the fade. The re-fix replaces the single-z-bump with a two-tier system: Drawer + mobile Sidebar backdrop and panel both at `z-50` (DOM order keeps panel on top of its own backdrop), Modal backdrop and panel both at `z-[60]` (same pattern at the next tier). See the off-roadmap log at the bottom of Phase 12 for the full entry.
- ✅ **MBZ-02 — Strengthen the fade to match the rest of the admin** — `bg-gray-950/50` → `bg-gray-950/60` in `Modal.tsx` + `Drawer.tsx` + mobile `Sidebar.tsx`; matches `QRManagementPage`'s pattern.
- ✅ **MBZ-03 — Regression test + manual QA matrix** — `admin-app/src/__tests__/modal-backdrop-z-index.test.ts` (7 tests): pins the new classes, guards against `z-40` / `/50` regression, asserts panel still `z-50` and toast still `z-[100]`.
  - **Re-fix 2026-07-24 (`1507a88`):** the original MBZ-03 tests pinned the broken z-50-on-panel + z-[60]-on-backdrop state. The re-fix rewrites the suite to pin the two-tier model: every overlay's backdrop + panel must share the SAME z-index (within its tier), with explicit guards against re-introducing the inversion.
- ✅ **MBZ-04 — Doc sync** — New "Z-Index Scale (overlays)" section in `plan/admin-app/CLAUDE.md` documents the agreed layer order + fade strength with a regression-test reference.
  - **Re-fix 2026-07-24 (`1507a88`):** the §Z-Index Scale is rewritten to document the two-tier model + the anti-pattern, with a rule-of-thumb for picking the right tier for any new overlay.

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

## Recently shipped (off-roadmap)

> Quick log of `feat:` / `fix:` commits that weren't on the roadmap when they shipped, so the file still reflects what's actually in the code. Format: `YYYY-MM-DD — short title — commit hash — branch.`

- **2026-07-24 — payment reference number unified onto the payment ledger** — `refactor/unify-payment-reference-fields` → `dev`. Dropped the guest-entered `Booking.paymentReferenceNumber` field from the booking model + the public `/book` and `/corporate/book` forms; the canonical reference is now exclusively the `OnsitePayment.transactionReference` on the relevant `bookings/{id}/payments/{paymentId}` entry, staff-populated at verify time via the existing Verify & Record Payment / Record Payment modals. The booking drawer's inline "Original booking payment reference" edit input was removed; the sticky header now shows a read-only "Reference" cell sourced from the latest ledger entry via a shared `getLatestPaymentReference(booking)` helper (in `BookingsPage.tsx` and `BookingDrawerWorkspace.tsx`). Reports exports, dashboard pending-payment badges, the `payment-rejected` email's "Reference on file" callout, and the bookings table search all read the same source. Firestore rules' staff update allowlist for `bookings/{id}` lost the `paymentReferenceNumber` entry (the canonical reference lives on the append-only payments subcollection). 872/872 tests + 6/6 infra tests green; typecheck clean. Docs: `plan/features/BOOKING-FLOW.md` (Step 3 bullets), `plan/features/BOOKINGS-MANAGEMENT.md` (full §Payment Reference Semantics rewrite), `plan/docs/BACKEND.md` (bookings + payments subcollection rows), `plan/docs/TYPES.md` (OnsitePayment gains `transactionReference`), `plan/docs/SECURITY.md` (staff allowlist), `plan/docs/DECISIONS-FEATURES.md #124` (new decision). Branch not yet merged; awaiting pre-launch sign-off.
- **2026-07-24 — every email + QR link respects the current environment** — `aef6b26`, `fix/env-aware-emails-and-qr` → `dev`. Before this fix, every link emitted by the server (`siteUrl()` / `adminUrl()` in `email.ts`) was hardcoded to `https://www.<config.domain>`, and the admin QR generator hardcoded `https://<config.domain>/intercom/...`. The fix adds `guest-app/server/lib/siteUrl.ts` with `getServerBaseUrl()` / `getServerAdminBaseUrl()` (VERCEL_ENV-based resolution + `SITE_URL` / `ADMIN_SITE_URL` env-var override for white-label) and routes the admin QR through the existing `getApiBaseUrl()` helper. SEO canonical + OG image URLs stay hardcoded to production by design. 19 new tests (`guest-app/tests/api/site-url.test.ts`, `admin-app/src/__tests__/env-aware-qr-intercom-url.test.ts`). Docs: `plan/docs/ENV-SETUP.md` (new `SITE_URL` / `ADMIN_SITE_URL` env vars), `plan/features/EMAIL-PDF-STORAGE.md` (env-aware email note), `plan/features/QR-MANAGEMENT.md` (new "QR URL env-awareness" section + operational rule that real printable QRs must be generated from the production admin).
- **2026-07-24 — modal/drawer/sidebar backdrop now sits above any nested panel (MBZ)** — `6731aea`, `fix/modal-backdrop-z-index` → `dev`. (Logged here for the off-roadmap fix pre-MBZ-proposal timeline; the structured MBZ-01..04 entries are now ✅ in §Phase 12.)
- **2026-07-24 — booking drawer hidden behind its own backdrop (MBZ-01..04 inversion regression)** — `1507a88`, `fix/mbz-z-index-regression` → `dev`. The first MBZ attempt set every backdrop to `z-[60]` while leaving every panel at `z-50`; in a single stacking context, higher z-index wins regardless of DOM order, so every overlay's own backdrop then covered its own panel and the booking drawer disappeared behind the fade. The fix replaces the single-z-bump with a **two-tier z-index system**: tier 1 (`z-50`) for Drawer + mobile Sidebar (backdrop + panel share `z-50`, DOM order keeps panel on top of its own backdrop), tier 2 (`z-[60]`) for Modal (same pattern at the higher tier). The modal tier sits one step above the drawer/sidebar tier, so a modal that opens on top of a drawer still fades the drawer panel across the full viewport. Regression test in `admin-app/src/__tests__/modal-backdrop-z-index.test.ts` rewritten (7 tests, with explicit guards against the `z-[60]`-backdrop + `z-50`-panel inversion). `plan/admin-app/CLAUDE.md §Z-Index Scale` rewritten to document the two-tier model + anti-pattern.
- **2026-07-24 — guest registration save threw `Unsupported field value: undefined` on every submit (GCR-01 follow-up)** — `30cf918`, `fix/gcr-undefined-other-purpose` → `dev`. GCR-01 (commit `6c2273b`) introduced the purpose-of-stay dropdown; the submit handler built the `guestRegistration` object with `otherPurpose: purposeOfStay === "other" ? otherPurpose : undefined`, and Firestore's `updateDoc` rejects `undefined` as a field value — so every Save Registration click threw a hard error. The form's `onSubmit` wrapper also flips the form to the read-only summary view, so the error got masked behind a UI flicker. Fix: spread the `otherPurpose` key in only when the staff picked "Other" AND entered a reason, so the key is OMITTED (not `undefined`) from the persisted object. Mirrors the conditional `corporate` block in the public bookings-create payload. Regression test in `admin-app/src/__tests__/purpose-of-stay-registration.test.ts` now actively forbids the `: undefined` shape and pins the `...(... ? { otherPurpose } : {})` pattern.
- **2026-07-24 — registration PDF generator hung on "Preparing registration PDF..." with no upper bound (HEIC fix follow-up)** — `96abf74`, `fix/registration-pdf-outer-timeout` → `dev`. The 2026-07-24 HEIC/format fix (commit `7faf705`) bounded the image-decode step with a 5s timeout, but `printRegistrationPDF` has four OTHER awaits that were not individually bounded: `getPdfBrandLogoDataUrl` (fetch + FileReader), `getBlob` from Firebase Storage, the pre-decode FileReader in `normalizePdfImageToJpeg`, and `canvas.toDataURL` (sync but can be slow on large images). If any of these hung (slow Storage network, slow Vercel edge for the brand asset, etc.), the outer `try/catch` never fired, the `toast.error(...)` never ran, and the placeholder tab stayed open forever — exactly the "stuck on Preparing registration PDF..." symptom. Fix: wrap the body in an IIFE (`buildAndOpen`) and race it against a 20s timeout; the `setTimeout` handle is cleared in a `finally` so a fast successful run doesn't leave a dangling timer. Regression test in `admin-app/src/__tests__/pdf-generation-repair.test.ts` pins the `buildAndOpen` IIFE shape, the `Promise.race` call, the timeout message, and the `clearTimeout`-in-finally pattern.
- **2026-07-24 — Firebase Storage CORS allowlist missing staging hosts — `getBlob` blocked on every staging read (PDF outer-timeout follow-up)** — `fb1c0a3`, `fix/storage-cors-staging-hosts` → `dev`. The 2026-07-24 PDF outer-timeout fix (commit `96abf74`) closed the user-visible hang (placeholder tab closes within 20s) but the underlying root cause is CORS: the `spark-inn-stg-7a7ad` Storage bucket only had production + localhost origins in its allowlist, so when the admin app running at `stg-admin.sparkinnbohol.com` called `getBlob()` on a guest-ID photo, the browser blocked the cross-origin XHR with `No 'Access-Control-Allow-Origin' header is present on the requested resource`. The Firebase SDK retries the read, which is why it took ~20s instead of failing fast. Fix: add `https://stg.sparkinnbohol.com`, `https://stg-admin.sparkinnbohol.com`, and the `https://*.vercel.app` preview wildcard to `firebase/cors.json`. New `firebase/tests/storage-cors.test.ts` (6 tests) pins the production/staging/preview/local origin allowlist + GET/PUT methods, wired into `npm test` via the new `test:infra` script. **Operational note:** the commit updates the source of truth only — the live bucket still has the old config. Deploy with `npx tsx scripts/set-storage-cors.ts` (reads service-account creds from `guest-app/.env`). Without that deploy, the new allowlist won't reach the bucket and the PDF will still hang on staging.

---

## References

- **Archive (historical, non-canonical):** `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` — pre-compaction roadmap: Phases 0–9, 11.5/11.6 batches 1–20, Wave 1–4 decision triage, 11.7 record, PR 1/3 detail, closed audit-fix lists (FIN, FR, FL, PF, QA, NC, AUD, SA, live bugs).
- Audit reports: `plan/project/AUDIT-*.md` (historical) · `plan/docs/AUDIT-E2E-REPORT.md` (current, open MED/LOW).
- Decisions: `plan/docs/DECISIONS-ARCH.md` + `plan/docs/DECISIONS-FEATURES.md`.
- Cutover: `plan/project/PROD-CUTOVER-RUNBOOK.md` · Deploy: `plan/project/DEPLOY.md`.
