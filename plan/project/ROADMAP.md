# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: July 15, 2026 (Roadmap — added Phase 12 plan **Booking Drawer Information Architecture & UX Refactor** ⬜: reorganize the current long-form booking drawer into a status-aware workspace with sticky summary, four task-based sections, check-in readiness, focused modals, progressive disclosure, and responsive behavior while preserving every existing feature. Earlier: added Phase 12 item **Payment Rejection & Reference Verification** ✅ implemented on `feature/dashboard-payment-reject`: handler `/api/bookings/reject-payment` bounces `payment-uploaded` → `pending` (room stays held), stamps `paymentRejectionReason`/`paymentRejectedAt`/`paymentRejectedBy`, fires `payment-rejected` email + `payment` notification; dashboard pending-payment alerts now show the guest reference number + a Reject button with reason presets + textarea; guest lookup page surfaces rejection reason as a red banner; 3 new shared fields added to Booking type. Earlier: Notification Center — **NC-02c fixed** on `fix/notification-center-nc-02c`: the NC-02 `readBy` rule used `keys().union(...)` which is invalid — `keys()` is a List, `.union()` is Set-only — so the Firebase rules validator errored it and staff could not mark notifications read in production; replaced with a List-only `removeAll(...).hasOnly([uid])` clause, validator now clean; grep test updated; follow-up NC-02d open (add an emulator-based rules test / `firebase validate` in CI, since grep tests can't catch an invalid-but-present rule). Earlier: post-ship review closed on `fix/notification-center-nc-02b` — NC-01 SEV-2 (awaited all 7 write sites + moved checkout block above `res.json`); **NC-02** SEV-4 (readBy rule tightened — key set subset + own-value-is-timestamp); **NC-02b** SEV-4 (added inverse `resource.data.readBy.keys().hasOnly(request.readBy.keys())` so existing keys must survive — closes the removal vector; value-tampering on others' existing entries knowingly accepted at SEV-4); NC-03 SEV-4 (prune now goes through `BulkWriter` for parallel + auto-retry deletes). 11 new tests added; 1,301 total green; typecheck clean. Earlier: Notification Center shipped on `feature/notification-center` per Phase 12 — spec `plan/features/NOTIFICATION-CENTER.md`; owner chose **Option B** — a persisted `notifications` collection (durable, cross-device, per-staff `readBy` read-state) written server-side from existing API routes, with guest chat alerts live-derived (B1) since the no-Cloud-Functions stack has no DB trigger; build includes rules + retention cron. Bell + panel live in every admin page header; deep links wire to `/bookings?bookingId=`, `/bookings?tab=store&orderId=`, and `/intercom?room=`; `vercel.json` adds a daily `0 3 * * *` `/api/notifications/prune` cron; 53 new tests + 1,164 total green; typecheck clean. Earlier: PC-02 + PC-03 completed — production Firebase fully provisioned with verified rules/indexes/CORS and live-verified disaster recovery (PITR + weekly backups + delete protection); settings/rooms copied verbatim, 22 branding assets migrated to the prod bucket with zero staging-URL leaks remaining; test data (storeItems, vouchers, corporate codes/inquiries) intentionally excluded per decision #119. Remaining before owner handoff: PC-05 archive export + PC-06 cutover smoke test. Earlier: Production Environment Split queued — PC-01..PC-06 from `plan/project/PROD-CUTOVER-RUNBOOK.md`: demote `spark-inn-stg-7a7ad` to staging behind `stg.`/`stg-admin.sparkinnbohol.com` on the `dev` branch, cut production over to the clean-slate `spark-inn-prod` project. PC-02 in progress (project + web app + service-account key created); one open decision blocks PC-05 (active/future bookings carry-over). Earlier: Finance Lifecycle Recommendations FLR-01/FLR-02/FLR-04 closed. FLR-05 handover is prepared: the pre-FL-05 Daily Close convention is documented and accountant/owner staging sign-off checklists are ready, but the external confirmations remain pending. FLR-03 remains deliberately deferred. Earlier: all 20 Finance Lifecycle findings were fixed.)
> Status key: ✅ Done | 🔄 In Progress | ⬜ Not Started | ⏸ Deferred

---

## How to Use This File

- Check off items as they're completed (`⬜` → `✅`)
- Update "Last updated" date at the top on each edit
- Add notes under items if there are blockers or decisions made
- Commit with `docs: update ROADMAP.md` prefix (no version bump)

---

## Phase 0 — Foundation & Scaffolding
> Goal: Repo is set up, both apps run locally, Firebase connected, Vercel configured.

### Repo & Tooling
- ✅ Root `package.json` created with npm workspaces config (`guest-app`, `admin-app`, `shared`)
- ✅ `shared/package.json` created — name: `@spark-inn/shared`
- ✅ Initialize monorepo structure (`guest-app/`, `admin-app/`, `shared/`, `firebase/`)
- ✅ Vite + React 19 + TypeScript setup for both apps
- ✅ Tailwind CSS configured in both apps
- ✅ `@config` path alias in `vite.config.ts` + `tsconfig.json` (both apps) — points to `../../hotel.config.ts`
- ✅ `npm install` from repo root — installs all workspace deps together
- ✅ Husky installed + `commit-msg` hook for Conventional Commits + auto version bump
- ✅ `shared/VERSION.ts` created at `v0.1.0`
- ✅ `shared/types/index.ts` — all canonical types from `plan/docs/TYPES.md`
- ✅ `shared/constants/index.ts` — booking statuses, sources, etc.
- ✅ `shared/utils/pricing.ts` — price calculation helpers
- ✅ `shared/utils/dates.ts` — numNights, weekend detection, date overlap
- ✅ `shared/utils/points.ts` — points earning + redemption calculations
- ✅ `shared/utils/references.ts` — booking ref, member number, store order ref generation
- ✅ `shared/utils/vouchers.ts` — voucher validation logic
- ✅ Vitest configured in `shared/package.json` — `vitest` added as dev dependency, `test` script added
- ✅ `shared/__tests__/` folder created with 5 test files (stubs only at this stage — fill in when building each feature)
- ✅ Vitest configured in `guest-app/package.json` for integration tests
- ✅ `guest-app/api/__tests__/` folder created with 4 test files (stubs only — fill in when building API routes)
- ✅ Firebase emulator setup documented in `README.md` for running integration tests locally
- ✅ `shared/animations.ts` — all shared Framer Motion variants (fadeUp, fadeIn, staggerContainer, staggerChild, scaleIn, slideInRight, slideInBottom) — see `plan/docs/FRONTEND.md §Animations`

### Brand Config
- ✅ `hotel.config.ts` created with full Spark Inn config
- ✅ `public/brand/` folders created in both apps with Spark Inn assets
- ✅ Tailwind config reads colors + fonts from `hotel.config.ts`
- ✅ Apollo font loading via `@font-face` in both `index.html` files
- ✅ Inter loaded via Google Fonts in both `index.html` files

### Firebase
- ✅ Firebase project created (Auth + Firestore + Storage enabled)
- ✅ Initial `firestore.rules` written + deployed
- ✅ Initial `storage.rules` written + deployed
- ✅ Firebase Storage CORS configured (`cors.json` deployed)
- ✅ Firestore collections seeded: `settings/hotelConfig`, `settings/websiteContent`, `settings/rewardsConfig`, `settings/storeConfig`, `settings/breakfastConfig`
- ✅ All 14 rooms seeded in `rooms` collection

### Vercel & Environment
- ✅ Single Vercel project created for the monorepo
- ✅ Guest-app deployment configured (root directory: `guest-app/`)
- ✅ Admin-app deployment configured (root directory: `admin-app/`)
- ✅ All `.env` files created locally (guest-app, admin-app, api)
- ✅ All env vars set in Vercel dashboard
- ✅ Cloudflare Turnstile site + secret keys obtained and added to env
- ✅ Resend account set up + API key obtained
- ✅ `.env.example` files created for each app

### PWA Setup *(retrospective — added per AUDIT-31)*
- [x] `vite-plugin-pwa` added to `guest-app` dependencies
- [x] `manifest.json` generated by Vite PWA plugin with name, short_name, theme_color, background_color, display ("standalone"), start_url
- [x] PWA icons (192×192 + 512×512 PNG) added to `guest-app/public/brand/` per AUDIT-16
- [x] Workbox runtime caching strategy configured — `NetworkFirst` for `/api/*` (always fetch fresh); `CacheFirst` for fonts, images, styles, scripts
- [x] `<meta name="theme-color" content="#EA8A1A">` in `guest-app/index.html` *(auto-injected by vite-plugin-pwa from manifest config — static tag removed to avoid double-meta conflict)*
- [x] `<link rel="apple-touch-icon" href="/brand/icon-192.png">` in `guest-app/index.html`
- [x] Service worker registered on guest-app boot (`registerType: "autoUpdate"`); offline fallback page shown when navigation fails on cached routes — `guest-app/public/offline.html` is the Workbox `navigateFallback`; `/api/*` excluded via `navigateFallbackDenylist`

---

## Phase 0.5 — Wireframe Pass
> Goal: Every screen in both apps built as a static React component — correct layout, brand tokens, routing wired, no backend.
> Full process and screen checklist: `plan/docs/WIREFRAME-WORKFLOW.md`

### How to start this phase

Paste the following prompt at the start of a new AI session:

```
Read these files before doing anything else:
1. plan/CLAUDE.md — master context, hard rules, stack
2. plan/docs/WIREFRAME-WORKFLOW.md — wireframe process, agent rules, screen checklist
3. plan/docs/FRONTEND.md — brand tokens, Tailwind config, component conventions
4. plan/docs/WHITE-LABEL.md — hotel.config.ts schema and how config values are used in UI

Your task: Build the Spark Inn wireframe pass — all screens as static React components with no backend connections.

First, ensure you are on the wireframe branch: run `git branch --show-current`. If not on `feature/wireframe`, run `git checkout -b feature/wireframe` off `dev`. All wireframe work — components and pages — is committed to this single branch. Do not create per-screen branches.

Start with the component library listed in WIREFRAME-WORKFLOW.md §Component Library — Build First. Do not start any page until all shared components are done. Build guest-app components first, then admin-app components.

After the component library, follow the screen order in WIREFRAME-WORKFLOW.md §Phase Order. For each screen:
- Read the Stitch HTML at plan/stitch/stitch_spark_inn_final/<screen>/code.html for layout reference
- Read the corresponding feature MD listed in the screen checklist
- Build the React component with static/hardcoded data that mirrors the shape of real data
- No Firebase imports, no API calls, no Zod validators, no auth checks
- All Tailwind tokens — zero hardcoded hex values
- All brand values via config.* from hotel.config.ts
- Wire routing with React Router <Link> / useNavigate
- Mark the screen done in the checklist when it passes visual QA against the Stitch screenshot

The apps are already scaffolded. Both run locally. hotel.config.ts is populated with Spark Inn values. Tailwind tokens are mapped. Start building.
```

### Component Library (build first)

**Guest App**
- ✅ `Navbar` — transparent over hero, solid on scroll, sticky
- ✅ `Footer` — dark bg, white logo, nav links, version
- ✅ `PrimaryButton` — orange `primary`, `8px` radius, `44px` min-height
- ✅ `GhostButton` — transparent, orange border + text
- ✅ `StatusBadge` — pill, all status variants
- ✅ `RoomCard` — photo, name, amenities, price (never price first)
- ✅ `BookingSummaryCard` — read-only recap panel
- ✅ `StepIndicator` — 4-step, orange active + completed
- ✅ `DateRangePicker` — blocks past dates, min 1-night
- ✅ `PaymentMethodCard` — radio card, orange border when selected
- ✅ `Modal` — centered overlay, `16px` radius, backdrop blur
- ✅ `Drawer` (guest) — right-side, full height, ~480px wide

**Admin App**
- ✅ `Sidebar` — `#111827`, 240px, white logo, orange active, version bottom
- ✅ `StatsCard` — white card, `12px` radius, label + value + optional trend
- ✅ `DataTable` — sortable, filterable, skeleton rows, row click
- ✅ `Drawer` (admin) — right-side, full height, ~480px wide
- ✅ `ChatBubble` — guest: right orange; staff: left white with border
- ✅ `QuickRequestChip` — pill button in quick-select row

### Guest App Screens
- ✅ G-01 Homepage `/`
- ✅ G-02 Rooms Page `/rooms`
- ✅ G-03 Booking Step 1 — Select Room `/book`
- ✅ G-04 Booking Step 2 — Guest Details `/book`
- ✅ G-05 Booking Step 3 — Review & Pay `/book`
- ✅ G-06 Booking Step 4 — Confirmation `/book/confirm`
- ✅ G-07 My Booking Lookup `/my-booking`
- ✅ G-08 Corporate Stays Marketing `/corporate`
- ✅ G-09 Corporate Booking Gate + Flow `/corporate/book`
- ✅ G-10 Spark Rewards Landing `/rewards`
- ✅ G-11 Sign In `/signin`
- ✅ G-12 Sign Up `/signup`
- ✅ G-13 Member Profile `/account/profile`
- ✅ G-14 My Stays `/account/stays`
- ✅ G-15 My Rewards Portal `/account/rewards`
- ✅ G-16 Intercom Guest Chat `/intercom/:roomId`
- ✅ G-17 About Us `/about`
- ✅ G-18 Contact Us `/contact`
- ✅ G-19 404 Not Found `*`
- ✅ M-01 Room Detail Modal
- ✅ M-02 Availability Filter Drawer (mobile)
- ✅ M-03 Corporate Access Code Gate
- ✅ M-04 Voucher Input (inline)

### Admin App Screens
- ✅ A-01 Admin Login `/login`
- ✅ A-02 Dashboard Overview `/`
- ✅ A-03 Bookings Management `/bookings`
- ✅ A-04 Room Management `/rooms`
- ✅ A-05 Rate Management `/rates`
- ✅ A-06 Reports `/reports`
- ✅ A-07 Corporate Inquiries `/corporate`
- ✅ A-08 Intercom Inbox `/intercom`
- ✅ A-09 QR Management `/qr`
- ✅ A-10 Members `/members`
- ✅ A-11 Settings `/settings`
- ✅ D-01 Booking Detail Drawer
- ✅ D-02 Room Edit Drawer
- ✅ D-03 Corporate Inquiry Detail Drawer
- ✅ D-04 Member Detail Drawer
- ✅ D-05 Store Order Detail Drawer
- ✅ M-05 Walk-in Booking Modal
- ✅ M-06 Add/Edit Voucher Modal
- ✅ Check-in workstation wireframe — guest registration form, compressed ID upload, breakfast selections, checkout folio review

---

## Phase 1 — Guest App Shell & Static Pages
> Goal: Public website loads with correct branding, navigation works, static pages done.

### App Shell
- ✅ `App.tsx` + React Router setup (all routes from `plan/guest-app/CLAUDE.md`)
- ✅ `Navbar.tsx` — horizontal logo, transparent/solid on scroll, mobile menu
- ✅ `Footer.tsx` — dark bg, white logo, address, social links, version display
- ✅ Page `<title>` tags: `{config.pageTitle} | {Page Name}`
- ✅ Open Graph meta tags on all public pages
- ✅ Google Analytics 4 injection (conditional on `config.analyticsId`)
- ✅ 404 page (`NotFoundPage.tsx`)

### Static Pages
- ✅ Homepage — hero, availability checker, featured rooms, amenities grid, map
- ✅ About Us — mission, vision, hotel story
- ✅ Corporate Stays — dark hero, perks, rooms overview, inquiry form
- ✅ Contact Us — address, phone, email, map embed, social links
- ✅ Privacy Policy — RA 10173 sections, DPO contact, versioned footer

---

## Phase 2 — Admin App Shell & Auth
> Goal: Admin app loads, login works, sidebar navigation renders correctly per role.

- ✅ `App.tsx` + React Router + protected route wrapper
- ✅ `LoginPage.tsx` — email/password, Firebase Auth
- ✅ Auth context — `onAuthStateChanged`, role from custom claims
- ✅ `Sidebar.tsx` — role-aware nav, orange active state, version in footer
- ✅ Role-based access (Front Desk vs Admin) — restricted pages show access denied for non-admin staff
- ✅ Dashboard shell — layout with sidebar + main content area

---

## Phase 3 — Room System
> Goal: Rooms visible on guest site, manageable from admin.

- ✅ `useRooms` hook — `onSnapshot` on `rooms` collection
- ✅ `RoomCard.tsx` — image, name, type badge, amenities, price, availability badge
- ✅ Rooms page (`/rooms`) — grid, filters by room type (from `DEFAULT_ROOM_TYPES`), availability badges, detail modal
- ✅ Room Management page (`/rooms` admin) — list, edit form, photo upload, status, block reason
- ✅ Rate Management page (`/rates`) — dynamic rows from `roomTypes` context, weekend rates, corporate rates, payment methods

---

## Phase 4 — Booking Flow (P0)
> Goal: Guest can complete a booking end-to-end. Most critical feature.

- ✅ `DateRangePicker.tsx` — blocks past dates, min 1 night
- ✅ `BookingSummary.tsx` — read-only recap component
- ✅ Booking context/state — persists across 4 steps
- ✅ Step 1 — Select Room: date pickers, guest count, availability query, rate display
- ✅ Step 2 — Guest Details: form + Zod validation + privacy consent checkbox
- ✅ Step 3 — Review & Pay: summary, discount selector, voucher input, payment method, screenshot upload, cancellation policy, Turnstile, honeypot
- ✅ Step 4 — Confirmation: booking ref, summary, Add to Calendar, payment instructions
- ✅ `/api/bookings/create` — Firestore transaction, availability lock, booking ref generation
- ✅ Voucher validation API route (`/api/validate/voucher`)
- ✅ Rate limiting on booking creation + voucher validation
- ✅ Booking confirmation receipt PDF (jsPDF) — fonts embedded

---

## Phase 5 — Admin Bookings Management (P0)
> Goal: Front desk can view, manage, and create bookings from the dashboard.

- ✅ `useBookings` hook — `onSnapshot` on `bookings` collection
- ✅ `BookingTable.tsx` — filterable, sortable, clickable rows
- ✅ Booking detail drawer wireframe — full details, status actions, payments, check-in workstation, checkout folio
- ✅ Status transition actions wireframe — context-aware buttons per current status
- ✅ Walk-in / manual booking creation modal wireframe
- ✅ Cancellation flow — confirmation modal, reason, cancellation email
- ✅ Receipt PDF — print + download from drawer
- ✅ Dashboard Overview — stat cards, room grid, housekeeping toggles, pending payments, today's arrivals/checkouts

---

## Phase 6 — Email System (P0)
> Goal: All 6 email triggers working via Resend + Vercel API.

- ✅ Resend client setup in `api/lib/resend.ts`
- ✅ Firebase Admin SDK setup in `api/lib/firebase-admin.ts`
- ✅ Email: booking acknowledgment / submitted (warning guest of manual review)
- ✅ Email: payment confirmed — fired from `handleAddPayment` when running payment total reaches `totalPrice` (covers `pending` and `payment-uploaded` bookings; idempotent if already `confirmed`)
- ✅ Email: booking confirmed — fired from new `POST /api/bookings/confirm` (staff route, status flip `pending`/`payment-uploaded` → `confirmed`) and from `handleCreateWalkin` when status resolves to `confirmed` (default + explicit; suppressed for `checked-in`)
- ✅ Email: check-in reminder (scheduled — cron or trigger) — Vercel Cron entry in `vercel.json` hits `/api/email/checkin-reminder` daily at `0 0 * * *`; handler queries `confirmed` bookings checking in tomorrow; covered by `api/__tests__/email-cron.test.ts`
- ✅ Email: booking cancelled
- ✅ Email: new corporate inquiry (to staff) — fired from `corporate-inquiries.ts:43` after Firestore write
- ✅ Email: discount rejected — fired from `handleRejectDiscount` (covered by AUDIT-1 wiring)
- ✅ Email branding — `emailLayout()` reads `config.colors.primary`, `config.colors.sidebar`, `config.brandName`, `config.logos.navbar`, `config.address.*`, `config.frontDeskPhone`, `config.supportEmail`, `config.checkInTime`/`checkOutTime`, `config.locale`/`config.timezone`/`config.currency` — zero hardcoded brand strings

---

## Phase 7 — Corporate, Vouchers & Breakfast (P1)
> Goal: Corporate booking flow + voucher system + breakfast add-on working end-to-end.

- ✅ Corporate Booking page (`/corporate/book`) — wired to live Firestore (`useRooms` onSnapshot) for room data, live API for access code validation + Firestore for breakfast config + booking creation
- ✅ Corporate code validation API route (`/api/validate/corporate-code`) — with Turnstile, rate limiting, shared utility
- ✅ Corporate Inquiries pipeline (admin) — live Firestore via onSnapshot, status updates, notes, code generation
- ✅ Voucher management (admin) — live Firestore via onSnapshot, create, toggle active
- ✅ Voucher redemption wired into booking flow Step 3 — existing (already built)
- ✅ Breakfast add-on — Settings → Breakfast tab (silog menu management, enable/disable) — wired to live Firestore
- ✅ Breakfast add-on — Rate Management (rate per person per night) — wired to live Firestore
- ✅ Breakfast add-on — Step 1 room card (Room Only vs Room + Breakfast option) — already existing in standard booking flow
- ✅ Breakfast add-on — booking creation stores `hasBreakfast`, `breakfastRate` — existing server-side logic
- ✅ Breakfast selections panel — booking detail drawer wired to Firestore (front desk enters at check-in)
- ✅ Guest registration form PDF — breakfast section with silog options grid via jsPDF
- ✅ Breakfast reports — daily kitchen prep report + breakfast revenue + CSV export

---

## Phase 8 — Intercom (P1)
> Goal: QR chat working between guests and front desk, including Spark Essentials store.

- ✅ Guest Intercom page (`/intercom/:roomId`) — chat UI, quick requests, name prompt, Shop tab — `guest-app/src/pages/IntercomPage.tsx`
- ✅ Intercom Inbox (admin) — chat list, thread view, reply, mark resolved, store order cards — `admin-app/src/pages/IntercomInboxPage.tsx`
- ✅ Intercom resolved flow — Active/Resolved tabs, room-level resolved flag, reopen action
- ✅ WebRTC voice signaling — Firestore `calls` offer/answer status, ICE exchange, accept/decline/hang up flow — `admin-app/src/context/AdminContext.tsx` (acceptCall/declineCall) + `guest-app/src/pages/IntercomPage.tsx` (caller flow)
- ✅ Notification sound — Web Audio API, every message, tab not focused
- ✅ Tab title unread count
- ✅ Sidebar unread badge
- ✅ QR route correctness — generated QR payloads use `/intercom/{roomId}` and real SVG QR rendering
- ✅ QR Management page — QR grid, regenerate, print single/all
- ✅ Spark Essentials — guest store panel (item grid, cart, checkout, order tracking)
- ✅ Spark Essentials — catalog management wireframe in Settings → Store tab
- ✅ Spark Essentials — order management wireframe page/section (admin)
- ✅ Spark Essentials — store order API route (stock check + order creation transaction)
- ✅ Spark Essentials — placed order cancellation with idempotent stock restore
- ✅ Spark Essentials — store reports in Reports page

### Phase 8 follow-up gaps to close or explicitly defer

- ✅ Spark Essentials — live catalog CRUD in Admin Settings → Store tab; guest store already reads live `storeItems`, but admin catalog editing must persist to Firestore before launch
- ✅ Spark Essentials — store payment methods managed from Settings → Payment Methods; guest checkout consumes `settings/hotelConfig.paymentMethods[]` filtered by `showInStore`
- ✅ Intercom Inbox — render guest store order messages as rich order cards with item/total/payment summary and a link to Store Management
- ✅ Guest Intercom — unread pulse and long-thread pagination are deferred to Phase 10 polish; Phase 8 launch keeps real-time chat, auto-scroll, and immediate read marking
- 📋 **Phase 8 manual QA checklist** *(run on staging before launch — sign off in client training session)*
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

## Phase 9 — Remaining Features (P1)
> Goal: All P1 features complete before launch prep.

- ✅ Booking Lookup page (`/my-booking`) — ref + email lookup wired to live Firestore via `/api/bookings/lookup`; cancel via `/api/bookings/cancel`; resend via `/api/email/booking-submitted` (pending/payment-uploaded) or `/api/email/booking-confirmed` (confirmed/checked-in); 60s resend cooldown + server-side rate limit; room-name enrichment from `rooms/{roomId}`
- ✅ Reports page (`/reports`) — restructured into **Performance** + **Sales** tabs; Performance shows occupancy by room type, acquisition channels, and revenue trend; Sales shows 4 revenue KPI cards (Total/Room/Breakfast/Store), stacked bar by stream, revenue trend line, combined payment method pie with `Add to Bill = Uncollected` label, and sub-tabbed detail tables (Bookings / Breakfast / Store Orders) with search. CSV + Sales XLSX export (4 sheets via SheetJS). All aggregation live against `bookings` + `storeOrders` + `breakfastConfig` from context. PDF export and Full Data Backup (admin-only 8-sheet XLSX) deferred.
- ✅ Settings page (`/settings`) — 9 settings surfaces wired: Hotel Info, Room Types, Website Content, Loyalty Rewards, Breakfast & Dining, In-Room Store (all 6 existing tabs); Email Config (read-only env var display + 7 active email triggers list), Intercom (quick requests CRUD + notification sound URL + preview), Legal Content (Privacy Policy body / Cancellation Policy / House Rules textareas sourced to `websiteContent.*` — also closes AUDIT-25 / PrivacyPage body wiring). Payment Methods + Staff Accounts + Discounts + Vouchers accessible via RatesPage and MembersPage respectively.
- ✅ Guest registration data capture wireframe — booking drawer at check-in
- ✅ Guest Registration PDF (jsPDF) — enhanced `printRegistrationPDF()` in admin BookingsPage.tsx: pre-filled booking + registration details; guest ID photo fetched via `fetch` and embedded as base64 image (RA 11862 compliance) with "Attach ID here" placeholder box when absent; house rules section from `websiteContent.houseRules` with agreement checkbox; physical signature + date lines; breakfast grid now shows per-cell checkbox options for each active silog item when no selection is yet recorded (pre-filled ✓ when selected); header, info, footer preserved. Triggered via "Preview Registration PDF" button in booking detail drawer.
- ✅ Wire `/privacy` page body to source from `settings/websiteContent.privacyPolicyBody` (AUDIT-25) — `PrivacyPage.tsx` now fetches `settings/websiteContent` on mount via `getDoc`; renders admin-authored `privacyPolicyBody` when set; falls back to deployment-configured content when blank. `privacyPolicyLastUpdated` auto-set from admin Settings → Legal Content tab.

---

## Phase 10 — Security & Polish
> Goal: Security rules finalized, performance verified, ready for staging.

- ✅ Firestore security rules — final version (`firebase/firestore.rules`): bookings create=false (API/Admin SDK only), staff/admin role checks, member owner checks, intercom/calls open for WebRTC, storeOrders create=true for guest ordering
- ✅ Firebase Storage rules — final version (`firebase/storage.rules`): payment-proof + discount-id staff-only read, guest-id staff-only read+write, website-content admin write, notification-sound staff-only, store-items staff write, branding public read
- ✅ API rate limiting — all public endpoints covered in `[...route].ts`: bookings 5/min, voucher 20/min, corporate-code 10/min, corporate-inquiry 5/min, bookings-lookup 10/min, email 3/ref/hour, store 10/min, store-cancel 10/min, store-status 30/min
- ✅ Cloudflare Turnstile — wired into booking creation, voucher validation, corporate code validation, corporate inquiry form (`[...route].ts` lines 206-208, 259-263, 296-299, 316-319)
- ✅ Honeypot fields — booking creation (`_hp` check at line 193-200) + corporate inquiry (`_hp` check at line 309-313) — both return silent success
- ✅ `FIREBASE_PRIVATE_KEY` newline handling — `firebase-admin.ts:19` already has `.replace(/\\n/g, "\n")`
- ⬜ Firebase API key domain restriction — operational task, requires Firebase Console configuration (not a code change)
- ⬜ Performance audit — guest site < 3s on 4G mobile, dashboard < 2s (requires Lighthouse/WebPageTest; manual QA)
- ✅ Guest Intercom polish — unread pulse on Chat tab: red dot with count shown when front desk messages arrive while guest is on Shop tab; messages marked read only when guest switches to Chat tab. Long-thread pagination: initial load limited to 50 messages, "Load earlier messages" button fetches 30 more per tap.
- ⬜ Cross-browser QA — Chrome, Safari, Firefox (manual QA)
- ⬜ Mobile QA — iOS Safari, Android Chrome (375px) (manual QA)
- ⬜ Accessibility QA — WCAG 2.1 AA checklist (`plan/docs/FRONTEND.md §Accessibility`) applied across guest-facing screens — per `LEGAL.md` commitment (tied directly to PWD discount guests who use assistive tech). Includes: keyboard navigation, screen reader labels (aria-* on all icon-only buttons, form fields, modal dialogs), color contrast 4.5:1 minimum, focus indicators, alt text on all images, form labels associated with inputs, error messages announced via aria-live. *(Per AUDIT-39)*

---

## Phase 10B — Spark Rewards (P1)
> Goal: Guest auth + member portal working. Loyalty rules deferred to Phase 2.

- ⬜ Firebase Auth — Google Sign-In provider enabled in Firebase Console (operational task — code side done; requires Firebase Console > Authentication > Sign-in method > Google > Enable)
- ✅ Guest auth context — `GuestAuthContext.tsx` with `onAuthStateChanged`, `signInWithEmail`, `signUpWithEmail`, `signInWithGoogle`, `signOut`, `sendPasswordReset`; separate from admin auth context (`AdminContext.tsx`)
- ✅ Sign-in page (`/signin`) — Google Sign-In + email/password form + forgot password flow; wired to real Firebase Auth; redirects to `/account/profile`
- ✅ Sign-up page (`/signup`) — email/password + Google + first/last/phone/consent; auto-calls `/api/members/register` after auth; redirects to `/account/profile`
- ✅ Forgot password flow — inline on SignInPage via `sendPasswordResetEmail()`; shows success/error messages
- ✅ Navbar — member state (logged in/out), dropdown with My Profile/My Stays/My Rewards + points badge + sign out; mobile menu support
- ✅ Spark Rewards landing page (`/rewards`) — program overview + enroll CTA (was already wired from Phase 0.5 wireframe pass)
- ✅ Member registration — post-booking Step 4 prompt (BookingConfirmPage.tsx:177-200 "Join Spark Rewards" CTA with signup + learn more links); standalone signup at `/rewards`; `/api/members/register` API handler with sequential `memberNumber` generation
- ✅ Past booking linkage by email on registration — handled server-side by `/api/members/register` handler (queries `bookings` by `guestEmail`, updates `memberId`)
- ✅ Member portal — My Profile (`/account/profile`) — live member data from `useGuestAuth()`; editable name/phone; Spark Rewards card with points balance + member number; change password (email/password accounts); delete account with RA 10173 erasure confirmation modal
- ✅ Member portal — My Stays (`/account/stays`) — live Firestore query on `bookings` by `guestEmail`; upcoming/past/cancelled sections; status badges; room + dates + total
- ✅ Member portal — My Rewards (`/account/rewards`) — live points balance from `members/{uid}.rewardsPoints`; points history from `members/{uid}/pointsHistory` subcollection; early check-in request info; earning info
- ✅ Admin — Members management page (`MembersPage.tsx`) — list, detail drawer, manual points adjustment (already wired from earlier phase)
- ✅ Firestore rules for `members/` collection — `members/{uid}` staff+owner read, create=false (API only), staff+owner update, admin+owner delete; `pointsHistory/{entryId}` staff+owner read, staff create, no update/delete

---

## Phase 11 — Staging & Launch
> Goal: Client review on staging, then production launch.

### Staging (25% payment milestone)
- ⬜ `dev` branch merged to `main` at `v0.9.0` — operational step, scheduled after client approval
- ⬜ Staging URLs live and shared with client — operational
- ⬜ Client review session — bookings, dashboard, intercom — operational
- ⬜ Feedback collected and addressed — operational
- ⬜ Firestore rules tested with real client data — operational
- ✅ Production launch procedure documented — `plan/project/DEPLOY.md` covers the full staging → production cutover flow (DNS, Vercel, Firebase, env vars, domain restrictions, rollback, monitoring)
- ✅ Pre-launch verification script — `npm run preflight` runs tests, typecheck, builds, env checks, Firebase rules, Vercel headers, version sanity; exits non-zero on any failure

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

## Phase 11.5 — Audit Fixes & Launch-Readiness *(P0 — inserted 2026-06-15)*
> Goal: Close the launch-blocking SEV-1s from the end-to-end audit before staging is reviewed by the client. Code is structurally complete; this phase fills the day-one production gaps the audit exposed.
> Source: `plan/project/AUDIT-E2E-2026-06-15.md` (238 findings — 23 SEV-1, 67 SEV-2, 94 SEV-3, 54 SEV-4)
> Decision source: `plan/project/AUDIT-OPEN-QUESTIONS-2026-06-15.md` (51 of 51 questions Decided)
>
> **Status legend**:
> - **Decided** — the spec/approach has been agreed in `DECISIONS-FEATURES.md`; no code change yet
> - **Implemented** — the code change has shipped on `origin/dev` and tests pass
> - A decision can be Decided without being Implemented (most are)
>
> **Current state** (as of 2026-06-16): **All 50 audit items Implemented** (5 from Launch-Readiness Sprint + 6 from Phase 11.6 Batch 1 + 5 from Phase 11.6 Batch 2 + 1 from Phase 11.6 Batch 3 + 1 from Phase 11.6 Batch 4 + 1 from Phase 11.6 Batch 5 + 4 from Phase 11.6 Batch 6 + 2 from Phase 11.6 Batch 7 + 2 from Phase 11.6 Batch 8 + 1 from Phase 11.6 Batch 9 + 1 from Phase 11.6 Batch 10 + 1 from Phase 11.6 Batch 11 + 1 from Phase 11.6 Batch 12 + 1 from Phase 11.6 Batch 13 + 1 from Phase 11.6 Batch 14 + 2 from Phase 11.6 Batch 15 + 2 from Phase 11.6 Batch 16 + 2 from Phase 11.6 Batch 17 + 6 from Phase 11.6 Batch 18 + 6 from Phase 11.6 Batch 19 + 2 from Phase 11.6 Batch 20). 0 decisions remain unimplemented. All 23 SEV-1s + all 5 Top-5 launch-gates + all 9 SEV-2s + 12 Wave 3 spec closures + 2 Wave 4 sub-items are closed. **The audit is fully shipped on dev.**

### Wave 1 — Decision Triage (2026-06-15) — 15/15 Decided, 11/15 Implemented (5 in Launch-Readiness + 6 in Batch 1)

15 questions from the audit are **decided** (documented in `DECISIONS-FEATURES.md`); 11 are **implemented** (the Launch-Readiness Sprint + Batch 1). The 4 not-yet-implemented from Wave 1 (#75, #77, #80, #81, #83) are scheduled for Batch 3.

- **Decided** — **#75** Breakfast pricing model: add-on only (drop `includedInRoomRate`)
- **Decided** — **#76** Contact form on `/contact` in scope for Phase 1 (wire to `/api/contact`) — see `plan/features/CONTACT-INQUIRIES.md`
- **Decided** — **#77** `payment-confirmed` is a real state — set on full payment, admin Confirm flips to `confirmed`
- **Decided** — **#78** Room block uses structured `blockedFrom`/`blockedTo` Timestamp fields
- **Decided** — **#79** `isCorporate` is server-authoritative — client sends only `corporateCode`, server increments `usageCount`
- **Decided** — **#80** Store stock decremented on `confirmed`, not `placed` (reverses contradicting STORE-MANAGEMENT.md text)
- **Decided** — **#81** Vouchers live in Rates page, not Settings
- **Decided** — **#82** Booking Confirmation Receipt PDF is in scope for Phase 1
- **Decided** — **#83** Cron idempotency marker `reminderSentAt` is required
- **Decided** — **#84** `booking.checkIn`/`checkOut` always stored as Firestore `Timestamp`
- **Decided** — **#85** `AdminContext.members` uses real `onSnapshot`, not `useState` mock
- **Decided** — **#86** Developer's personal name removed from default payment-method `accountName` (hard rule)
- **Decided** — **#87** Honeypot inputs always inside the `<form>`, hidden via CSS
- **Decided** — **#88** Housekeeping cycle: `clean → dirty → in-progress → clean` (per spec; code was wrong)

### Launch-Readiness Sprint — 5 SEV-1 fixes (highest blast-radius, lowest effort)
Branch convention: `fix/audit-<slug>`. Each fix ships with an integration test.
**5/5 implemented.** All Top-5 launch-readiness SEV-1s shipped on `origin/dev`.

- [x] **SEV-1 #1** Add `store-orders/{roomNumber}/payment-proof/` Storage rule — closes the 403 every GCash in-room store order hits. File: `firebase/storage.rules`. Branch: `fix/audit-storage-store-orders`. Commit: `1a1b5a4`. Effort: XS.
- [x] **SEV-1 #2** Fix CORS: replace `Access-Control-Allow-Origin: *` + `Allow-Credentials: true` with explicit allowlist from `config.domain` + `config.adminDomain`. File: `guest-app/api/[...route].ts:163-170`. Branch: `fix/audit-cors-allowlist`. Commit: `2423089`. Effort: XS.
- [x] **SEV-1 #3** Member discount applied server-side in `handleCreateBooking` — verify ID token, look up `memberId`, read `rewardsConfig.memberDiscountPct`, apply as 3rd stacking step. Closes the silent overcharge for Spark Rewards members. Files: `guest-app/api/handlers/bookings.ts`, `guest-app/src/pages/BookingPage.tsx:97` (drop TODO + hardcoded 10%). Branch: `fix/audit-member-discount-server`. Commit: `a3b7b56`. Effort: M.
- [x] **SEV-1 #4** Lowercase `guestEmail` on write + read paths — fixes "No stays yet" for mixed-case emails, unbreaks self-cancel + lookup. Files: `guest-app/api/handlers/bookings.ts` (3 handlers), `guest-app/src/pages/StaysPage.tsx:47`. Branch: `fix/audit-email-case-lowercase`. Commit: `056e7cf`. Effort: S.
- [x] **SEV-1 #5** Replace `useState<Member[]>` mock in `AdminContext` with real `onSnapshot(collection(db, "members"))` listener. File: `admin-app/src/context/AdminContext.tsx:949-996`. Branch: `fix/audit-admin-members-listener`. Commit: `5a9ed6a`. Effort: M.

### Phase 11.6 Batch 1 — Quick wins (6 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-1`. Shipped in PR `821eb4e`.

- [x] **W1.13** (commit `86bb50b`) Remove developer's personal name "Daniel Sandimas" hardcoded as default GCash account holder. **Closes decision #86.**
- [x] **W1.14** (commit `56bf8d4`) Honeypot regression test — the corporate inquiry honeypot was already inside the `<form>` and CSS-hidden, so the commit is a guard test only. **Closes decision #87.**
- [x] **W1.15** (commit `7266c34`) Housekeeping cycle order: `clean → dirty → in-progress → clean` (per `DASHBOARD-OVERVIEW.md`). **Closes decision #88.**
- [x] **W2.6** (commit `4f6aa92`) Multiple concurrent calls: second wins — write `status: "ended"` to the old call doc when a new active call arrives. **Closes decision #94.**
- [x] **W2.7** (commit `e787594`) Auto-archive intercom thread on checkout — set `intercoms/{roomNumber}.resolved = true` in the same transaction. **Closes decision #95.**
- [x] **W2.8** (commit `bc8e01f`) Cancellation message sets `isCancelledOrder: true` so admin Inbox renders it as a distinct greyed-out "Cancelled" card. **Closes decision #96.**
- [x] **W2.10** (commit `67beb4c`) `calls/{roomId}` retention: delete after 30s grace via `setTimeout(..., 30000) + deleteDoc`. **Closes decision #98.**

### Phase 11.6 Batch 2 — Spec compliance (5 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-2`. Shipped in PR `ed701ab`.

- [x] **W2.5** (commit `6796fc6`) Remove "Welcome Gift" marketing copy on `RewardsLandingPage` and replace with "Welcome to the Program" — Phase 1 has no transactional welcome email. **Closes decision #93.**
- [x] **W2.11** (commit `f3054b1`) Remove the fake LOU upload from corporate chargeback. Replaced the file picker with a note that the accounts team will email the guest for the LOU within 24 hours. Staff tracks receipt via the `louReceived: boolean` toggle on the booking drawer. **Closes decision #99.**
- [x] **W2.14** (commit `551760c`) Add `linkedInquiryId` to the `Booking` type and to the `handleCreateBooking` / `handleCreateWalkin` handlers — the schema + handler change is done; the "Convert to Booking" UI (per audit 1.4 SEV-1 #2) is a separate scope. **Closes decision #102.**
- [x] **W2.13** (commit `c8282ed`) Negotiated corporate rate UI label changed from `(X% additional discount applied)` to `— Negotiated rate applied` per `DECISIONS-FEATURES.md #101`. **Closes decision #101.**
- [x] **W2.4** (commit `2d41ed7`) Early check-in on `RewardsPage` now actually submits — loads the next upcoming confirmed/checked-in booking for the member, POSTs to `/api/email/early-checkin-request`, shows success/error states. Replaces the previous "open the intercom or call the desk" hint. **Closes decision #92.**

### Phase 11.6 Batch 3 — Launch-blocker: Staff Accounts tab (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-3`. Ships the launch-gate UI for staff provisioning.

- [x] **S5.2** (commit `<pending>`) **Add Staff Accounts tab to `SettingsPage`.** Closes the launch gate from `AUDIT-E2E-2026-06-15.md` Top 5 launch-blockers: hotel owner could not provision front-desk accounts. Files: `admin-app/src/context/AdminContext.tsx` (new `StaffMember` type + `staff: StaffMember[]` listener on `guests` filtered by `role in ["front-desk", "admin"]` + `createStaff` + `disableStaff` API wrappers), `admin-app/src/pages/SettingsPage.tsx` (new "staff" tab on the settings list, admin-only role guard, live staff table, create form with role radios, disable confirmation modal, "You" badge for the current admin, self-disable guard). API routes (`/api/admin/create-staff`, `/api/admin/disable-staff`) were already shipped per AUDIT-6c — this PR wires the UI to the existing routes. 13 regression tests in `admin-app/src/__tests__/staff-accounts-tab.test.ts` cover the listener, the Bearer-token API wrappers, the role guard, the form, the table, and the confirmation modal. **Closes the S5.2 launch-gate SEV-1.**

### Phase 11.6 Batch 4 — Launch-blocker: Booking Receipt PDF (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-4`. Ships the staff-side booking receipt PDF for the front desk.

- [x] **S7.1** (commit `<pending>`) **Add `printBookingReceiptPDF()` to `BookingsPage.tsx` + drawer button.** Closes the launch gate from `AUDIT-E2E-2026-06-15.md` Top 5 launch-blockers: front desk had no way to print/email a booking summary. Implements the spec in `plan/features/EMAIL-PDF-STORAGE.md §Booking Confirmation Receipt` end-to-end: header (brand + title + booking ref + generated-on), guest info, stay info, pricing breakdown (subtotal, Senior/PWD discount, voucher, Spark Rewards points redemption, total), special requests, payments-collected section (date + method + amount per payment, total collected, outstanding balance — green if settled, red if outstanding), or "Payment Method + Amount Due" fallback when no payments are recorded, and a BIR-receipt disclaimer footer. Client-side jsPDF, A4, no server round-trip; opens in a new tab. 13 regression tests in `admin-app/src/__tests__/booking-receipt-pdf.test.ts` cover the builder, every required section, and the drawer button. **Closes decision #82 + audit S7.1 launch-gate SEV-1.**

### Phase 11.6 Batch 5 — Compliance: RA 10173 account erasure (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-5`. Closes the audit SEV-1 compliance gap on account deletion.

- [x] **S2.3** (commit `<pending>`) **Add server-side `/api/members/delete-account` flow + anonymized booking audit trail.** Closes `AUDIT-E2E-2026-06-15.md` SEV-1 #S2.3: `ProfilePage.handleDeleteAccount` only deleted the member doc + Auth user; `pointsHistory` subcollection, `bookings.memberId`, and the booking PII all remained — failing the RA 10173 right to erasure. Files: `guest-app/api/handlers/members.ts` (new `handleEraseMemberAccount` — Admin SDK transaction: for every booking with `memberId == uid`, write a no-PII audit record to `bookings/audit/records/{id}` then scrub `memberId`/`guestName`/`guestEmail`/`guestPhone` from the booking; flag the member doc `isErased: true` with all PII blanked), `guest-app/api/[...route].ts` (new route dispatch with 5/min rate limit, signed-in guest auth, `confirmation: "erase-my-account"` body requirement), `firebase/firestore.rules` (new `bookings/audit/records/{id}` rule: staff-read, server-write-only), `guest-app/src/pages/ProfilePage.tsx` (handleDeleteAccount now POSTs to the API instead of touching Firestore + Auth client-side; confirmation modal copy now explains anonymization + RA 11862 retention carve-out), `guest-app/src/pages/TermsPage.tsx` (new §9 "Data Retention and Erasure" section explains the flow + the 6-month guest-registry retention per RA 11862), `plan/docs/API-ROUTES.md` (new route row + audit collection rule + "server-only" rationale paragraph), `plan/docs/SECURITY.md` (new "Member Account Erasure Flow" section documenting the 6-step algorithm and the new Firestore rule). 8 regression tests in `guest-app/api/__tests__/members-delete-account.test.ts` cover auth, confirmation string, missing member, audit + anonymization per booking, pointsHistory batch delete, member doc + auth user delete, auth/user-not-found idempotency, and response counts. **Closes decision #49 (existing) + audit S2.3 SEV-1.**

### Phase 11.6 Batch 6 — Small polish fixes (4 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-6`. Closes 4 embarrassments the audit flagged in `§1.5 Admin Dashboard` and `§1.6 Static Pages`. One PR, four targeted fixes.

- [x] **S1.4** Self-cancel after `payment-confirmed` / `confirmed` is now blocked server-side. `guest-app/api/handlers/bookings.ts:742` now rejects cancellation for any of `checked-in` / `checked-out` / `cancelled` / `confirmed` / `payment-confirmed` with the message "Booking cannot be cancelled because its status is already X. Please contact the front desk to cancel a confirmed booking." Only `pending` and `payment-uploaded` remain self-cancellable. The UI already hides the button after payment, but the server is the source of truth.
- [x] **S6.1** Google Maps embeds now work in production. `vercel.json:9` `frame-src` adds `https://www.google.com` and `https://maps.google.com` to the allowlist (alongside `'self'` and `https://challenges.cloudflare.com`). Homepage map + Contact page embed no longer fail CSP in production.
- [x] **S5.1** Dashboard `NaN%` on first paint is fixed. `admin-app/src/pages/DashboardPage.tsx:15-18` now guards `occupancyPercentage` with `totalRoomsCount === 0 ? 0 : Math.round(...)` so the stat renders `0%` (not `NaN%`) when the rooms snapshot is still empty.
- [x] **S5.3** Hardcoded weekly chart replaced with live data. `DashboardPage.tsx:25-66` now derives the last 7 days of occupancy from real `bookings` (counts distinct `roomNumber`s per day within `[checkIn, checkOut)`, skipping `cancelled`, dates formatted in `config.timezone`). Per-day rate also guards against zero rooms (matches S5.1). The misleading "Weekly benchmarks verify an average occupancy of 75% for Tagbilaran City" copy is kept but the chart it describes now reflects real data.

Tests:
- 8 new regression tests in `admin-app/src/__tests__/batch-6-small-fixes.test.ts` cover all 4 fixes via source-pattern assertions: cancel guard includes the new statuses, frame-src allowlist contains the Google Maps origins, NaN% guard renders for empty rooms, hardcoded chart data is gone, and the live chart iterates `bookings` + `cancelled` + adds `roomNumber` to a `Set`.
- 2 new behavioral tests in `guest-app/api/__tests__/bookings-create.test.ts` confirm the cancel handler now rejects self-cancel for `confirmed` and `payment-confirmed` with a 400. The pre-existing happy-path cancel test was updated to use `status: "pending"` (the only state where self-cancel is valid).

### Phase 11.6 Batch 7 — Notification mute + real enroll flow (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-7`. Closes the last 2 outstanding SEV-1/SEV-3 items from the audit's `§1.2 Spark Rewards` and `§1.3 Intercom` clusters.

- [x] **W2.9** Per-staff notification sound mute. `admin-app/src/pages/IntercomInboxPage.tsx:104-119` adds a `Bell` / `BellOff` toggle in the inbox header that flips `isNotificationMuted`. The state is hydrated from `localStorage["intercom-notification-muted"]` on mount and persisted to the same key on every change (per-staff, no Firestore round-trip). The sound-play effect now requires `!isNotificationMuted` in addition to the existing `notificationInitialized` + `hasNewUnreadGuestMessage` + `!isInboxFocused` guards. The button is keyboard accessible (44px min height) and exposes `aria-pressed` + `aria-label` that flip with the state.
- [x] **S2.4** `RewardsLandingPage` enroll button is no longer a UI mock. `guest-app/src/pages/RewardsLandingPage.tsx` now uses the real `useGuestAuth` context (not the sessionStorage sim state) and posts to `/api/members/register` with a `Bearer <idToken>` header on enroll. The page now derives `isMember` from `memberProfile?.isMember`, redirects to `/account/rewards` on success, and shows real loading + error states (the AlertCircle error block has `role="alert"` for screen readers). The "Wireframe Tester Panel" dev widget is removed from production markup, the `setTimeout(..., 1000)` fake enroll is gone, and all three `sim_auth_state` sessionStorage keys are deleted.

Tests:
- 11 new regression tests in `admin-app/src/__tests__/batch-7-mute-enroll.test.ts` cover both fixes via source-pattern assertions: Bell/BellOff import, localStorage hydration + persistence, the new `!isNotificationMuted` guard in the sound-play effect, the toggle button's `aria-pressed`/`aria-label`/icon swap, the page's switch to `useGuestAuth`, the removal of `sessionStorage` / `setTimeout` / the Wireframe Tester Panel, the real `/api/members/register` POST with `Bearer` token, the loading/error UI, and the `navigate("/account/rewards")` redirect.

### Phase 11.6 Batch 8 — Server-authoritative corporate (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-8`. Closes the last remaining booking-flow security + UX gap on corporativo bookings.

- [x] **S1.5** `isCorporate` is no longer trusted from the client. `guest-app/api/handlers/bookings.ts:181-237` removes the `isCorporate` field from the `CreateBookingBody` interface and from the body destructure. The handler now derives `isCorporate` solely from a validated `corporateCodes/{code}` lookup: the code is fetched, `validateCorporateCode` checks active + not-expired + under-cap, and only then are `corporateDetails.isCorporate` and `corporateDetails.companyName` (sourced from the doc, never the body) set. An attacker posting `isCorporate: true, corporativoCode: "INVALID"` no longer gets the corporate rate — the booking falls through to the standard rate. The `BookingPage` + `CorporateBookingPage` clients no longer send `isCorporate` at all; the standard online flow omits the field entirely, and the corporate flow posts only the `corporateCode`.
- [x] **S4.1** `ratePerRoomType[chosenRoomType]` is now used for the negotiated rate. `guest-app/src/pages/CorporateBookingPage.tsx:185-198` captures the `ratePerRoomType` map from the validate response, persists it in `sessionStorage` as `corp_ratePerRoomType`, and uses it as the base rate for the selected room type. The previous code always used `room.corporateRate` (the flat fallback) and discarded the negotiated map the server was already returning. The header now shows "Negotiated rate applied" (per W2.13 / decision #101) when the negotiated rate is in use.

Tests:
- 9 new regression tests in `guest-app/api/__tests__/batch-8-isCorporate-server-authoritative.test.ts` cover both fixes via source-pattern assertions: the `CreateBookingBody` interface no longer has `isCorporate`; the body destructure does not pull `isCorporate`; the handler uses the shared `validateCorporateCode` helper; `companyName` is sourced from `corpData.companyName` (never `guestDetails.companyName`); the corporate branch falls back to the standard rate when the code is missing/invalid; the standard `BookingPage` and `CorporateBookingPage` clients no longer send `isCorporate`; the client captures `ratePerRoomType` from the validate response; the `baseRate` calculation uses `ratePerRoomType[selectedRoom.type]` first and falls back to `selectedRoom.corporateRate` only when the map has no entry for the room type.

### Phase 11.6 Batch 9 — Convert-to-booking flow (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-9`. Closes the last remaining SEV-1 in `§1.4 Rooms + Rates + Vouchers + Corporate`: a staff member can now convert a `new` / `contacted` / `negotiating` corporate inquiry into a real bookings document.

- [x] **S4.2** "Convert to booking" missing from Corporate Inquiries is fixed end-to-end:
  - `guest-app/api/handlers/corporate-inquiries.ts` adds `handleConvertInquiryToBooking` — a staff-authenticated, transaction-isolated handler that reads the inquiry, fetches the room, runs the availability + capacity + date checks, resolves the negotiated rate (explicit override > `ratePerRoomType[roomType]` from attached code > `room.corporateRate` > `room.pricePerNight`), splits `contactPerson` into first/last, generates a booking reference, creates the booking with `isCorporate: true` (server-derived, per W1.3 / decision #79), `source: "corporate"` (per W2.15 / decision #103), `linkedInquiryId`, and status `confirmed`. In the same transaction: flips the inquiry status to `converted`, persists `convertedBookingId` + `convertedBookingRef`, and appends a "Converted to booking ..." note to the inquiry's `notes` ledger. Fires the `booking-confirmed` email (best-effort).
  - `guest-app/api/[...route].ts` dispatches the new route at `domain=corporate action=convert-inquiry` behind `authenticateStaff` (the existing 401/403 ternary on the `Forbidden` substring of the auth error).
  - `plan/docs/API-ROUTES.md` documents the new route + the audit-mandated closure of S4.2.
  - `admin-app/src/context/AdminContext.tsx` adds `convertInquiryToBooking` to the context interface and implementation — calls `/api/corporate/convert-inquiry` with a Bearer token, pre-allocates the bookingId client-side, returns the bookingId/bookingRef/totalPrice on success.
  - `admin-app/src/pages/CorporateInquiriesPage.tsx` adds a green "Convert to Booking" section to the inquiry drawer (hidden for `converted` / `declined` inquiries), plus a full `Modal` with pre-filled company / contact / numRooms fields from the inquiry, a room dropdown (filtered to active + non-blocked), date inputs (defaults from `inquiry.preferredDates`), guests, breakfast toggle, payment method (`chargeback` or `pay-at-hotel`), and an optional rate override. On submit: validates dates client-side, calls the context method, then `navigate("/bookings?bookingId=...")` on success. Real loading + `role="alert"` error states.

Tests:
- 13 new regression tests in `guest-app/api/__tests__/batch-9-convert-inquiry.test.ts` cover both server and client wiring: the route import + dispatch + `authenticateStaff` guard, the handler staff check + already-converted/declined guards, the `isCorporate: true` + `source: "corporate"` + `linkedInquiryId` shape of the new booking, the inquiry status flip + back-link IDs + appended note in the same transaction, the negotiated rate resolution order, the pre-filled guest info from the inquiry, the `AdminContext.convertInquiryToBooking` method + Bearer token, the convert button in the drawer + the pre-fill + role guard for non-terminal statuses, the navigate-on-success flow, and the loading/error UI.

### Phase 11.6 Batch 10 — W4.4 email extensions (8 templates, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-10`. Closes W4.4 / decision #104: 8 new server-triggered email templates fire automatically on the right state transitions, closing the "guest misses order update after closing the intercom tab" gap and the "staff miss new booking when logged out" gap.

- [x] **W4.4** Email extensions — 8 new templates added to `EmailAction` union + dispatch table:
  - `guest-app/api/handlers/email.ts` adds 8 new template functions (`voucherIssuedEmail`, `storeOrderPlacedEmail`, `storeOrderConfirmedEmail`, `storeOrderOutForDeliveryEmail`, `storeOrderDeliveredEmail`, `storeOrderCancelledEmail`, `staffNewBookingEmail`, `staffNewPaymentEmail`) + 4 new trigger exports (`sendVoucherIssuedTrigger`, `sendStoreOrderTrigger`, `sendStaffNewBookingTrigger`, `sendStaffNewPaymentTrigger`) + 8 new entries in the `EmailAction` union. All templates use the existing `emailLayout()` + `card()` + `callout()` + `row()` helpers and are config-driven (no hardcoded brand strings). `voucher-issued` renders the code in a large monospace block (per JetBrains Mono / Courier New fallback stack); all 5 store-order templates share an `itemsTable` helper that renders the line items + payment method.
  - `guest-app/api/handlers/bookings.ts` fires `staff-new-booking` from `handleCreateBooking` after the transaction commits, guarded by `emailNotificationsSent.staffNewBooking` for idempotency. Fires `staff-new-payment` from `handleAddPayment` only when `paymentProofUrl` is set on the booking, guarded by `emailNotificationsSent.staffNewPayment`.
  - `guest-app/api/handlers/store.ts` fires `store-order-placed` after the order transaction commits (guest email looked up from the active booking). Fires `store-order-cancelled` after the cancellation transaction (with the latest cancellation reason).
  - `guest-app/api/handlers/email.ts` adds the `voucher-issued` staff-only branch to `handleEmailTrigger` (recipient is `voucher.guestEmail` from the request body; staff auth required).
  - `guest-app/api/[...route].ts` adds the 8 new actions to `staffOnlyEmailActions` (the public re-send endpoint is staff-only; the actual email fires directly from the handlers).
  - `admin-app/src/context/AdminContext.tsx` adds the `guestEmail` field to the `Voucher` type + the Firestore snapshot mapping. `addVoucher` posts to `/api/email/voucher-issued` when `guestEmail` is set (Bearer token, server validates the email + room types).
  - `admin-app/src/pages/RatesPage.tsx` adds a "Guest Email (optional — sends the code to this address)" input to the voucher modal and passes `guestEmail: vchGuestEmail.trim() || null` to `addVoucher`.
  - `plan/features/EMAIL-PDF-STORAGE.md` + `plan/docs/API-ROUTES.md` document the 8 new actions + their recipient rules.

Tests:
- 15 new regression tests in `guest-app/api/__tests__/batch-10-email-extensions.test.ts` cover: the EmailAction union includes all 8 new actions, all 4 new trigger exports exist, the voucher-issued template renders the code in a monospace block, the 5 store-order templates exist and use the shared `storeOrderBaseLayout`, the staff-new-* templates route to ADMIN_EMAIL, the voucher-issued route is in `staffOnlyEmailActions` and the handler requires staff auth, the booking handler fires staff-new-booking + staff-new-payment with the right guards, the store handler fires store-order-placed + store-order-cancelled, the AdminContext `addVoucher` posts to the new endpoint only when guestEmail is set, the RatesPage form passes the value through, and the Voucher type includes the new field.

### Phase 11.6 Batch 11 — Settings-driven public content (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-11`. Closes audit SEV-2 #S6.2: the Settings tab on the admin app now actually controls the public-facing HomePage, AboutPage, and CorporateStaysPage. Edits to the hero copy, amenities, services, Spark Rewards block, featured room IDs, corporate perks, about hero photo, and hotel mission/vision/story all flow to the live site.

- [x] **S6.2** (commit `<pending>`) **Wire `settings/websiteContent` + `settings/hotelConfig` to the public pages.** Closes the Wave-3 SEV-2 from `AUDIT-E2E-2026-06-15.md`: the Settings UI persisted content but the public pages kept rendering the hard-coded `data/homepage.ts` and in-component strings, so admins could edit values that never reached guests.
  - New `guest-app/src/hooks/usePublicSiteContent.ts` — single module-level cached fetch of both Firestore docs (`settings/websiteContent` and `settings/hotelConfig`) on first mount. Returns `{ loading, homepage, about, corporate }` with safe fallbacks to `data/homepage.ts`, `config.brandName`, and static brand copy when the docs are missing/empty. Services and sparkRewards perks are stored with `isEnabled: boolean` (default true when missing) so the hide-when-empty logic works.
  - `guest-app/src/pages/HomePage.tsx`:
    - Hero: `homepage.heroHeading` / `homepage.heroSubtext` / `homepage.heroPhotoUrl` (falls back to `homepageHeroImage` when the URL is empty).
    - Featured rooms: filter `useRooms()` results by `homepage.featuredRoomIds` (falls back to first 3 rooms when the array is empty or matches nothing).
    - Amenities: rendered from `homepage.amenities`; icons resolved by `amenity.icon` slug through a `lucide-react` map (falls back to round-robin `BedDouble`/`MapPin`/`Users`/`Sparkles`/`Wifi`/`Coffee`).
    - Services: rendered from `homepage.services`, filtered to `isEnabled !== false`; the entire `<section>` is hidden when the visible list is empty (per `BACKEND.md §settings/websiteContent`).
    - Spark Rewards: rendered from `homepage.sparkRewards`; the entire block is hidden when `isEnabled === false`, and individual perks with `isEnabled === false` are filtered out.
  - `guest-app/src/pages/AboutPage.tsx`:
    - Hero photo: `about.heroPhotoUrl` (falls back to the previous Unsplash URL when empty).
    - Mission + Vision: `hotelConfig.missionStatement` / `hotelConfig.visionStatement` (falls back to the previous hard-coded copy, with `config.brandName` interpolated).
    - Hotel story: `hotelConfig.hotelStory` (split on blank lines into paragraphs; falls back to a single-paragraph brand placeholder when empty so the page never renders a blank section).
  - `guest-app/src/pages/CorporateStaysPage.tsx`:
    - Hero heading + subtext + photo: `corporate.heroHeading` / `corporate.heroSubtext` / `corporate.heroPhotoUrl` (each falls back to the previous hard-coded strings/Unsplash URL when empty).
    - Perks grid: the 6 hard-coded `<motion.div>` blocks are replaced with a `corporate.perks.map(...)` render. Icons are resolved by `perk.icon` slug through a `lucide-react` map (falls back to the existing 6-icon round-robin).
  - `admin-app/src/pages/SettingsPage.tsx` and `admin-app/src/context/AdminContext.tsx` are unchanged — the admin-side `updateSettings("websiteContent", ...)` already persists the right shape; Batch 11 is purely the read-path wire.

Tests:
- 16 new regression tests in `admin-app/src/__tests__/batch-11-website-content.test.ts` cover: the hook exists and reads both `settings/websiteContent` + `settings/hotelConfig`; the hook returns `homepage`/`about`/`corporate` sections; services store `isEnabled` correctly; HomePage imports `usePublicSiteContent` and reads `heroHeading` / `heroSubtext` / `heroPhotoUrl` / `amenities` / `featuredRoomIds`; the hard-coded `>Your sanctuary in Bohol</` heading is gone; the hard-coded `const ids = ["room-201", "room-204", "room-301"]` block is gone; Services wrap in `visibleServices.length > 0 &&`; Spark Rewards wrap in `sparkRewardsVisible && visibleRewards.length > 0 &&`; the hard-coded `amenities`/`rewardPerks` imports from `data/homepage` are gone; AboutPage reads `about.heroPhotoUrl` + `about.missionStatement` + `about.visionStatement` + `about.hotelStory` and the hard-coded mission/vision strings + Unsplash URL are gone; CorporateStaysPage reads `corporate.heroPhotoUrl` + `corporate.heroHeading` + `corporate.heroSubtext` + `corporate.perks.map(...)` and the 6 hard-coded perk motion.div blocks + Unsplash URL are gone.

### Phase 11.6 Batch 12 — Rewards tab fully wired to settings/rewardsConfig (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-12`. Closes the 2nd remaining launch-gate SEV-2 from `AUDIT-E2E-2026-06-15.md`: admins could not edit the loyalty program's earning mode, points-per-booking, points-redemption rate, or program name/tagline — the form only wrote `pointsEnabled` / `pointsPerHundred` / `memberDiscountEnabled` / `memberDiscountPct`. The server already honored all 8 fields on `settings/rewardsConfig`; this batch closes the admin write path.

- [x] **Rewards tab (launch gate)** (commit `<pending>`) **Wire the full `settings/rewardsConfig` shape into the admin Rewards tab.**
  - `admin-app/src/context/AdminContext.tsx` — default `rewardsConfig` now includes `earningMode`, `pointsPerBooking`, `pointsRedemptionRate`, `rewardsName`, `rewardsTagline` (in addition to the previously-exposed 4 fields) so the form never crashes before the first snapshot lands. The existing `onSnapshot(collection(db, "settings"))` branch on `case "rewardsConfig":` continues to overwrite the whole object, so any field the form saves flows back through the snapshot.
  - `admin-app/src/pages/SettingsPage.tsx`:
    - New state: `earningMode` (typed `"per-booking" | "per-spend"`), `pointsPerBooking`, `pointsRedemptionRate`, `rewardsName`, `rewardsTagline`. Existing `pointsEnabled` / `pointsPerHundred` / `memberDiscountEnabled` / `memberDiscountPct` state is preserved.
    - The Rewards-tab sync useEffect now lists `rewardsConfig` in its dependency array AND seeds the 5 new fields from the snapshot. Previously the form mounted with the default useState value and silently kept it once the snapshot landed, which meant a Firestore override of the program name would never reach the UI.
    - New Program Identity section: `rewardsName` (text) + `rewardsTagline` (text) inputs. The H3 heading now uses `{rewardsName} Modifiers` so changing the name flows through immediately.
    - New Earning Mode section: two radio cards (`per-spend` / `per-booking`) with copy explaining the difference. The points input below the radio group swaps its label and bound value based on the selected mode (one input, one source of truth per mode).
    - New `pointsRedemptionRate` input (points per ₱1 redeemed) with a help line that points to `settings/rewardsConfig.pointsRedemptionRate` and the server branch in `handleCreateBooking`.
    - `handleSaveRewards` now writes all 9 fields (not just 4) to `updateSettings("rewardsConfig", { ... })`. Falls back to `"Spark Rewards"` if the name is blank, and writes `""` for the tagline rather than dropping the field.
  - `guest-app/api/handlers/bookings.ts` + `guest-app/api/handlers/members.ts` are unchanged — both already read the relevant fields from `settings/rewardsConfig` and gate on existence / numeric coercion. The launch-gate fix is purely the admin write path + sync.

Tests:
- 15 new regression tests in `admin-app/src/__tests__/batch-12-rewards-config.test.ts` cover: `AdminContext` default includes `earningMode` + `pointsPerBooking` + `pointsRedemptionRate`; the snapshot subscribe still calls `setRewardsConfig(data as typeof rewardsConfig)`; the Settings form has `earningMode` radios (both values) and a `pointsPerBooking` input bound conditionally on `earningMode === "per-booking"`; the form has `pointsRedemptionRate` / `rewardsName` / `rewardsTagline` inputs; the H3 uses `{rewardsName} Modifiers` (not the hard-coded `>Spark Rewards Modifiers</`); the sync useEffect lists `rewardsConfig` in its deps and seeds all 5 new fields; `handleSaveRewards` posts `earningMode` + `pointsPerBooking` + `pointsRedemptionRate` + `rewardsName` + `rewardsTagline`; `bookings.ts` reads `rewardsConfig.earningMode` / `pointsPerHundred` / `pointsPerBooking`; `members.ts` reads `rewardsConfigDoc.data()?.pointsRedemptionRate`.

### Phase 11.6 Batch 13 — Last launch gate: Add to Calendar (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-13`. Closes the last remaining launch-gate SEV-2 from `AUDIT-E2E-2026-06-15.md` Top 5 launch-blockers: `BookingConfirmPage` "Add to Calendar" was a one-line stub `alert("Adding reservation to your local calendar...")`. All five Top-5 launch-blockers are now shipped.

- [x] **BookingConfirmPage Add to Calendar (launch gate)** (commit `<pending>`) **Replace the stub `alert()` with a real ICS file download + Google Calendar deep link.**
  - `shared/utils/calendar.ts` — new helper module exporting `buildIcsContent`, `buildGoogleCalendarUrl`, and `downloadIcsFile`. The ICS builder emits RFC 5545 output (CRLF line endings, `BEGIN:VCALENDAR` / `END:VCALENDAR`, `VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`, `BEGIN:VEVENT` / `END:VEVENT`, `UID`, `DTSTAMP` in UTC basic format, `DTSTART;VALUE=DATE` / `DTEND;VALUE=DATE` for all-day events, `SUMMARY`, optional `DESCRIPTION` + `LOCATION`). Comma / semicolon / backslash / newline escaping per the spec; lines longer than 75 octets are folded with a leading space on continuations. The Google Calendar builder returns a `https://calendar.google.com/calendar/render?action=TEMPLATE&...` deep link with `text` / `details` / `location` / `dates` query params. `downloadIcsFile` creates a `text/calendar;charset=utf-8` blob, synthesizes a hidden `<a download>`, clicks it, and revokes the object URL.
  - `shared/index.ts` re-exports `./utils/calendar` so both apps can import the helpers as `from "@spark-inn/shared"`.
  - `guest-app/src/pages/BookingConfirmPage.tsx`:
    - `handleAddToCalendar` now builds the event shape (uid `${bookingRef}@${config.domain}`, title `Stay at ${config.brandName} (${bookingRef})`, description with booking ref / guests / room / total / payment, location = the configured street/city/region/postal address, `allDay: true`, `start: checkIn`, `end: checkOut`) and calls `downloadIcsFile(`spark-inn-${bookingRef}.ics`, content)`. The previous `alert()` call is gone.
    - New `googleCalendarUrl` value memoized in the same scope, fed to a new `<a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>` link button next to the .ics download. The link opens the user's default Google Calendar pre-filled with the same event shape.
    - The action row now has three buttons: "Download .ics" (primary download), "Add to Google Calendar" (secondary external link), "Return to Homepage" (primary nav). On mobile they stack vertically; on sm+ they share a flex row.

Tests:
- 10 new regression tests in `admin-app/src/__tests__/batch-13-add-to-calendar.test.ts` cover: the `shared/index.ts` re-exports `./utils/calendar`; the helper exports `buildIcsContent` / `buildGoogleCalendarUrl` / `downloadIcsFile`; the ICS builder emits `BEGIN:VCALENDAR` / `VERSION:2.0` / `PRODID:`; the Google Calendar URL points to `https://calendar.google.com/calendar/render` with `action=TEMPLATE`; `BookingConfirmPage.tsx` no longer contains any `alert(` call and no longer contains the "Adding reservation to your local calendar" string; the page imports `buildIcsContent` / `buildGoogleCalendarUrl` / `downloadIcsFile` from `@spark-inn/shared`; the page renders a "Download .ics" button bound to `onClick={handleAddToCalendar}`; the page renders an "Add to Google Calendar" anchor with `href={googleCalendarUrl}` + `target="_blank"` + `rel="noopener noreferrer"`; the handler passes `start: checkIn` / `end: checkOut` / `allDay: true` to `buildIcsContent`; the handler embeds the brand name in the title, the booking ref + room name in the description, and the hotel address in the location field.

### Phase 11.6 Batch 14 — checkIn/checkOut always Firestore Timestamp (1 fix, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-14`. Closes the last remaining unimplemented SEV-1 from the original audit: decision #84 / 2.1 SEV-1 #2 — `booking.checkIn` / `checkOut` always stored as Firestore `Timestamp`, never as a raw `Date` (which the Admin SDK silently auto-converts) and never as an ISO string (which would crash every reader). With this batch, all 23 SEV-1s in the original audit are now closed.

- [x] **#84 — checkIn/checkOut always Timestamp** (commit `<pending>`) **Replace the no-op ternary + raw `.toDate()` reads with explicit `Timestamp.fromDate()` writes + shape-aware read helper.**
  - `shared/utils/bookingDates.ts` — new module exporting `toDateOrNull(value)` and `toDateOrNow(value)`. The helpers accept `Date | { toDate: () => unknown } | { _seconds, _nanoseconds } | string | number | null | undefined` and always return a real `Date` (or `null` / `new Date()` for the `*Now` variant). Recursive `.toDate()` unwrapping covers edge cases where a mock returns a Timestamp-like object whose `.toDate()` is the raw value.
  - `shared/index.ts` re-exports `./utils/bookingDates` so both apps can use the helpers.
  - `guest-app/api/handlers/bookings.ts`:
    - New `import { Timestamp } from "firebase-admin/firestore"`.
    - New `import { toDateOrNull, validateCorporateCode } from "@spark-inn/shared"`.
    - `handleCreateBooking`: replaces the dead-code ternary
      `checkIn: adminDb.doc(`rooms/${roomId}`).firestore.valueType ? checkInDate : checkInDate`
      with `checkIn: Timestamp.fromDate(checkInDate)` and `checkOut: Timestamp.fromDate(checkOutDate)`. The intent is now explicit, the Admin SDK isn't asked to perform an implicit conversion, and the field type is guaranteed `Timestamp` on every write.
    - `handleCreateWalkin`: same `Timestamp.fromDate(...)` write for `checkIn` + `checkOut`.
    - Both `hasConflict` overlap checks (`handleCreateBooking` + `handleCreateWalkin`) now call `toDateOrNull(data.checkIn)` and `toDateOrNull(data.checkOut)`, and short-circuit with `return false` when either value can't be parsed. A legacy ISO-string doc (if one ever sneaks in via a manual write) becomes inert instead of crashing the entire create flow.
  - The `Booking` type in `shared/types/index.ts` still uses `Date` (the canonical shape the rest of the app already handles via `data.checkIn?.toDate?.()` / `parseDateString` in `AdminContext`); the contract is that the runtime value may be `Date | Timestamp`, both of which the read paths above normalize.

Tests:
- 14 new regression tests in `admin-app/src/__tests__/batch-84-timestamp-checkin.test.ts` cover: the `shared/index.ts` re-exports `./utils/bookingDates`; the helper exports `toDateOrNull` + `toDateOrNow`; the helper recognises a Firestore Timestamp (calls `.toDate()`), a raw `{ _seconds, _nanoseconds }` object, and an ISO date string; `toDateOrNow` returns `new Date()` for null / undefined; `bookings.ts` imports `Timestamp` from `firebase-admin/firestore` and `toDateOrNull` from `@spark-inn/shared`; both `handleCreateBooking` and `handleCreateWalkin` write `checkIn: Timestamp.fromDate(checkInDate)` + `checkOut: Timestamp.fromDate(checkOutDate)`; the no-op `adminDb.doc(...).firestore.valueType ? a : a` ternary is gone; the overlap checks call `toDateOrNull` on both `data.checkIn` + `data.checkOut`; the overlap checks no longer call `.toDate()` directly; malformed legacy values are skipped with `if (!existingCheckIn || !existingCheckOut) return false`; the `Booking` type still uses `Date` for `checkIn` / `checkOut` (canonical shape, normalized at the read sites).
- Existing 176/177 `guest-app/api/__tests__` tests still pass (only the pre-existing `store-confirm-order` failure remains, out of scope).

### Phase 11.6 Batch 15 — Room block structured + Store stock on confirmed (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-15`. Closes two decided-but-unimplemented SEV-2s from the original audit: #78 (1.1 SEV-2 #11) — Room block uses structured `blockedFrom` / `blockedTo` Firestore Timestamps (not the legacy free-form `blockReason` string that baked the date range into a human-readable field); #80 (1.3 SEV-2 #2a) — Store stock decrements on `confirmed`, not on `placed` (reverses the contradicting `STORE-MANAGEMENT.md` text).

- [x] **#78 — Room block structured** (commit `<pending>`) **Switch `addRoomBlock` to write `blockedFrom` / `blockedTo` Timestamps and honour the window in every server-side conflict check.**
  - `admin-app/src/context/AdminContext.tsx`:
    - The `Room` type now carries `blockedFrom: string | null` and `blockedTo: string | null` alongside the existing `blockReason: string`. `blockedFrom` / `blockedTo` are ISO `YYYY-MM-DD` strings at the client (the snapshot mapper calls a local `parseDateString` helper to normalize Timestamp / Date / string / null into the same shape).
    - `addRoomBlock(roomId, dates, reason)` now writes `blockedFrom: Timestamp.fromDate(fromDate)` and `blockedTo: Timestamp.fromDate(toDate)` (timestamps at `00:00:00` and `23:59:59` of the requested days so the window is inclusive at both ends). `blockReason` is now the bare reason string — the previous "Reason (2026-06-12 to 2026-06-15)" concatenation is gone.
  - `guest-app/api/handlers/bookings.ts` — both `handleCreateBooking` and `handleCreateWalkin` upgrade their `if (roomData.status === "blocked") throw ...` guard to a structured window check: read `roomData.blockedFrom` / `roomData.blockedTo` via `toDateOrNull`, then `checkInDate < blockedTo && checkOutDate > blockedFrom` (a room blocked in a past window no longer blocks a future booking; a room blocked in a future window now blocks an overlapping request).
  - `guest-app/api/handlers/corporate-inquiries.ts` — the `handleConvertInquiryToBooking` guard does the same window check against `inquiry.preferredDates` (parsing the `"YYYY-MM-DD to YYYY-MM-DD"` range). New `import { Timestamp } from "firebase-admin/firestore"` and `import { toDateOrNull } from "@spark-inn/shared"`.

- [x] **#80 — Store stock on confirmed** (commit `<pending>`) **Move the stock decrement from `handleCreateStoreOrder` to the `placed → confirmed` transition; track `stockDecrementedAt` for idempotency.**
  - `guest-app/api/handlers/store.ts`:
    - `handleCreateStoreOrder` no longer decrements stock at order creation. The per-item `transaction.update(itemRefs[index], { stock: itemData.stock - orderItem.quantity, ... })` block is gone. The order doc now seeds `stockDecrementedAt: null` so the cancel handler + admin context can tell apart "never decremented" from "decremented + already restored".
    - `handleCancelStoreOrder` only restores stock when the order was actually decremented — guard becomes `if (!orderData.stockRestoredAt && orderData.stockDecrementedAt) { ... }` (a placed-then-cancelled order now skips the restore loop entirely, the way the spec demands).
  - `admin-app/src/context/AdminContext.tsx`:
    - The `StoreOrder` type now carries `stockDecrementedAt: string | null`; the snapshot mapper reads it via `formatStoreDate(data.stockDecrementedAt)`.
    - `updateStoreOrderStatus(orderId, status, reason)` now wraps the `cancelled` and `confirmed` branches in a single transaction. The `confirmed` branch is the new decrement site: `if (orderData.status === "placed" && !orderData.stockDecrementedAt) { ... stock = stock - quantity; ... stockDecrementedAt: serverTimestamp() }`. Throws `INSUFFICIENT_STOCK` if the resulting stock would go negative. The `cancelled` branch was reworked to read `stockDecrementedAt` instead of `status === "placed"` for the restore decision, so a `confirmed → cancelled` round trip still returns the stock.

Tests:
- 11 new regression tests in `admin-app/src/__tests__/batch-15-room-block-store-stock.test.ts` cover:
  - **#78** `AdminContext.addRoomBlock` writes `blockedFrom: Timestamp.fromDate(fromDate)` + `blockedTo: Timestamp.fromDate(toDate)`, drops the `blockReason: `${reason} (...)`` concatenation in favour of the bare reason, the `Room` type exposes `blockedFrom: string | null` + `blockedTo: string | null`, the snapshot mapper reads both via `parseDateString(...)`, and both `handleCreateBooking` + `handleCreateWalkin` + `corporate-inquiries.ts handleConvertInquiryToBooking` use the new window guard (`toDateOrNull(roomData.blockedFrom)` + `toDateOrNull(roomData.blockedTo)` + `checkInDate < blockedTo && checkOutDate > blockedFrom`).
  - **#80** `handleCreateStoreOrder` no longer contains the legacy `itemData.stock - orderItem.quantity` decrement and initializes `stockDecrementedAt: null`; `handleCancelStoreOrder` only restores when `!orderData.stockRestoredAt && orderData.stockDecrementedAt`; `AdminContext.updateStoreOrderStatus` has the new `orderData.status === "placed" && !orderData.stockDecrementedAt` confirmed branch that writes `stockDecrementedAt: serverTimestamp()`; the `StoreOrder` type exposes `stockDecrementedAt: string | null`.
- Existing 176/177 `guest-app/api/__tests__` tests still pass (only the pre-existing `store-confirm-order` failure remains, out of scope).

### Phase 11.6 Batch 16 — #75 (no-op) + #76 (contact form wired) (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-16`. Closes the last two decided-but-unimplemented non-Wave-3 audit items.

- [x] **#75 — includedInRoomRate is dropped** — the field was never seeded, never read, never documented. A regression test scans `guest-app/src` + `shared` + `admin-app/src` and fails if any source file references the field.
- [x] **#76 — Contact form wired to `/api/contact/inquiry`** — the public `/contact` page was a `setTimeout` stub. New `guest-app/api/handlers/contact.ts` + `handleCreateContactInquiry` (validates name + email + subject + message, basic spam filter, writes to the `contactInquiries` collection, fires a staff email via the new `sendContactInquiryTrigger` + `contactInquiryEmail` layout). Dispatched in `[...route].ts` at `domain='contact' action='inquiry'` behind the same 5/min rate limit, honeypot short-circuit, and Turnstile check as `/api/corporate/inquiry`. `ContactPage.handleSubmit` now POSTs to the real endpoint, surfaces a `role='alert'` error state on failure, clears the form on success. New Firestore rule: `match /contactInquiries/{inquiryId}` allows staff reads + staff creates.
- 11 regression tests in `admin-app/src/__tests__/batch-16-contact-includedinroomrate.test.ts`.

### Phase 11.6 Batch 17 — #83 (cron reminderSentAt) + #100 (corporate no-promo) (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-17`.

- [x] **#83 — Cron reminderSentAt idempotency** — `/api/email/checkin-reminder` previously re-sent the reminder on every Vercel cron re-run. The handler now filters out bookings that already have `reminderSentAt` set, sends for the remaining ones, writes the stamp on each booking it sent to, and reports `{ sent, skipped }` in the response. `Booking` type + admin `Booking` type + admin snapshot mapper + `BookingsPage` walk-in form all expose `reminderSentAt: string | null`. The existing `email-cron` test got a second test case for the skip path + the mock learned `.doc().update()`.
- [x] **#100 — Corporate bookings never accept promo vouchers** — `handleCreateBooking` now gates the entire voucher branch on `!corporateDetails.isCorporate`. The booking doc is always written with `voucherCode: ''` + `voucherDiscount: 0` when `isCorporate`, regardless of what the client supplied. The walk-in handler is already a no-op (voucherCode: '' hard-coded), so no change there.
- 10 regression tests in `admin-app/src/__tests__/batch-17-cron-corporate.test.ts`.

### Phase 11.6 Batch 18 — Wave 3 batch 1 (W3.1-W3.6) (6 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-18`.

- [x] **W3.1** — `SETTINGS.md` header now cross-references Rates for booking payment methods.
- [x] **W3.2** — Spark Rewards tab is admin-only with an explicit `isAdmin` guard. Non-admins now see an amber 'Admin-only section' panel.
- [x] **W3.3** — Room types are now sourced from `settings/hotelConfig.roomTypes` (Firestore) instead of `localStorage`. The save handler writes the full array back. `addRoomType` / `updateRoomType` / `deleteRoomType` are now async.
- [x] **W3.4** — Reports "Download Full Backup" is admin-gated with a page-level `isAdmin` check. The XLSX backup button exports Bookings + StoreOrders sheets.
- [x] **W3.5** — Reports "Avg. Length of Stay" is replaced with "Avg. Occupancy" + a "Busiest Room Type" card.
- [x] **W3.6** — AboutPage Brand Promise banner is kept (already shipped).
- 17 regression tests in `admin-app/src/__tests__/batch-18-wave3-batch1.test.ts`.

### Phase 11.6 Batch 19 — Wave 3 batch 2 (W3.7-W3.12) (6 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-19`.

- [x] **W3.7** — CorporateStaysPage "Integration Process" + "Retreat CTA" sections are kept.
- [x] **W3.8** — PrivacyPage + TermsPage now use the global `<Navbar />` instead of a custom thin header.
- [x] **W3.9** — PrivacyPage §3 heading renamed from "Data Retention Policy" to "How Long We Keep It".
- [x] **W3.10** — `config.rewardsName` added; the RewardsLandingPage hero chip interpolates `{config.rewardsName}`.
- [x] **W3.11** — `config.termsLastUpdated` added; TermsPage renders `{config.termsLastUpdated}` instead of a hard-coded date.
- [x] **W3.12** — NotFoundPage renders a tiny `<p>v{VERSION}</p>` badge.
- 14 regression tests in `admin-app/src/__tests__/batch-19-wave3-batch2.test.ts`.

### Phase 11.6 Batch 20 — Wave 4 (W4.2 + W4.3) (2 fixes, completed 2026-06-16)
Branch: `feature/phase-11.6-batch-20`.

- [x] **W4.2** — Vite build-time transform plugin that substitutes the static `<meta>` tags in `index.html` with values from `hotel.config.ts` (brandName, domain, ogImage). The plugin is added to both apps' `vite.config.ts` (guest-app + admin-app).
- [x] **W4.3** — `plan/docs/WHITE-LABEL.md` schema is synced to the actual fields in `hotel.config.ts`: `rewardsName` (W3.10), `termsLastUpdated` (W3.11), roomTypes note (W3.3 migration to Firestore).
- 13 regression tests in `admin-app/src/__tests__/batch-20-wave4.test.ts`.

### Deferred to Phase 11.6 (post-launch polish)
- 36 spec questions remain in `plan/project/AUDIT-OPEN-QUESTIONS-2026-06-15.md` (Waves 2-4) — need decisions before implementation
- ~18 remaining SEV-1s from the audit (not in the launch-readiness top 5)
- ~67 SEV-2s — high-impact cross-feature bugs

### Wave 2 — Decision Triage (2026-06-15) — 15/15 Decided, 0/15 Implemented

15 more spec questions resolved. Documented in `DECISIONS-FEATURES.md` #89-#103. Build deferred to Phase 1.5 or 11.6.

- **Decided** — **#89** Overlapping bookings by same email are **allowed** (per-room conflict check only)
- **Decided** — **#90** Member discount via `Authorization: Bearer <idToken>` header — server verifies and applies as 3rd stacking step; client cannot supply a `memberDiscountPct`
- **Decided** — **#91** Past-booking linkage beyond email — **deferred to Phase 2** (no "claim past stays" UI in Phase 1)
- **Decided** — **#92** Early check-in with multiple upcoming bookings: pick first confirmed/checked-in by `checkIn` ascending; show picker if > 1; error if 0
- **Decided** — **#93** No member-registration welcome email in Phase 1; remove the "Welcome Gift" copy from `RewardsLandingPage`
- **Decided** — **#94** Multiple concurrent calls in admin inbox: **second wins** (old call gets `status: "ended"`)
- **Decided** — **#95** Auto-archive intercom thread on checkout: set `intercoms/{roomNumber}.resolved = true` in the checkout transaction
- **Decided** — **#96** Cancellation messages render as a distinct greyed "Cancelled" visual state in both guest and admin views
- **Decided** — **#97** Notification sound mute: `localStorage` per-staff, `Bell`/`BellOff` icon in inbox header
- **Decided** — **#98** `calls/{roomId}` retention: delete after 30s grace once both sides have observed `status: "ended"`
- **Decided** — **#99** LOU for corporate chargeback: **not collected in Phase 1** — replace fake upload with a note; staff tracks via `louReceived: boolean` on the booking drawer
- **Decided** — **#100** Corporate bookings never accept promo vouchers (`voucherDiscount: 0` is correct)
- **Decided** — **#101** Negotiated corporate rate model: **flat rate per room type** via `ratePerRoomType: Record<roomType, rate>`; UI label "Negotiated rate applied"
- **Decided** — **#102** Converted-inquiry bookings get `linkedInquiryId?: string` on the booking doc (added to `Booking` type)
- **Decided** — **#103** Booking source for a converted inquiry is `"corporate"`

### Wave 3 — UI/UX Decision Triage (2026-06-15) — 12/12 Decided, 0/12 Implemented

12 minor spec gaps resolved so the polish work in Phase 11.6 has a clear target. Documented in `DECISIONS-FEATURES.md #105`. Build deferred to Phase 11.6.

- **Decided** — **#105a** Booking payment methods live in Rates (not Settings) — `SETTINGS.md` is updated to cross-reference Rates
- **Decided** — **#105b** Spark Rewards Settings tab is admin-only with explicit role guard
- **Decided** — **#105c** Room Types migrates from localStorage to `settings/hotelConfig.roomTypes` (Firestore)
- **Decided** — **#105d** Reports "Download Full Backup" role guard is page-level (not layout)
- **Decided** — **#105e** Reports Performance tab swaps "Avg Length of Stay" for "Avg Occupancy" + "Busiest Room Type" per `REPORTS.md` spec
- **Decided** — **#105f** AboutPage "Brand Promise" banner is kept; `STATIC-PAGES.md §About` is updated
- **Decided** — **#105g** CorporateStaysPage "Integration Process" + "Retreat CTA" sections are kept; `STATIC-PAGES.md §Corporate` is updated
- **Decided** — **#105h** PrivacyPage + TermsPage include global `<Navbar />` for consistency (drop the custom thin header)
- **Decided** — **#105i** PrivacyPage §3 heading renamed to "How Long We Keep It" per `STATIC-PAGES.md` spec wording
- **Decided** — **#105j** New `config.rewardsName: "Spark Rewards"` for white-label deployments
- **Decided** — **#105k** New `config.termsLastUpdated` field separate from `privacyPolicyLastUpdated`
- **Decided** — **#105l** 404 page renders a tiny `<p>v{VERSION}</p>` to resolve the spec contradiction

### Wave 4 — Infrastructure Decision Triage (2026-06-15) — 8/8 Decided, 0/8 Implemented (plus W4.4 documented separately)

8 spec/build questions resolved for the cross-cutting work. Documented in `DECISIONS-FEATURES.md #106`. W4.4 (7 new email templates) is in `DECISIONS-FEATURES.md #104` and `plan/features/EMAIL-AUDIT-EXTENSIONS.md`. Build deferred to Phase 11.6.

- **Decided** — **#106a** Corporate rate lookup fails soft to `room.corporateRate` with a console warning if `ratePerRoomType[roomType]` is undefined
- **Decided** — **#106b** `index.html` static OG meta is templated at Vite build time via a small `transformIndexHtml` plugin reading `hotel.config.ts`
- **Decided** — **#106c** `WHITE-LABEL.md` schema is updated to match the actual `HotelConfig` fields used in `hotel.config.ts`
- **Decided** — **#106e** Storage rule for `store-orders/{roomNumber}/payment-proof/` uses `roomNumber` (matching the existing client upload path)
- **Decided** — **#106f** CORS `Allow-Credentials: true` is removed; explicit allowlist from `config.domain` + `config.adminDomain` + localhost dev origins
- **Decided** — **#106g** `prompt("Enter cancellation reason:")` is replaced with a small input field in the existing cancellation drawer
- **Decided** — **#106h** Privacy + Terms pages keep the `Republic of the Philippines` hardcoded copy in legally-relevant sections but expose `config.applicableLaw` for the rest
- **Decided** — **#106i** `Spark Inn Hotel Corp` hardcoded `accountName` fallback becomes `config.legalName`

### References
- Audit report: `plan/project/AUDIT-E2E-2026-06-15.md`
- Open questions: `plan/project/AUDIT-OPEN-QUESTIONS-2026-06-15.md`
- Decisions: `plan/docs/DECISIONS-FEATURES.md` (#75-#106)
- Specs updated: `EMAIL-PDF-STORAGE.md`, `ROOM-MANAGEMENT.md`, `STORE-MANAGEMENT.md`, `TYPES.md`, `CONTACT-INQUIRIES.md` (new), `STATIC-PAGES.md`, `API-ROUTES.md`, `CORPORATE-BOOKING.md`, `INTERCOM-INBOX.md`, `EMAIL-AUDIT-EXTENSIONS.md` (new)

---

## Phase 11.7 — Admin Mobile UX (P1) *(shipped 2026-06-18)*
> Goal: Make the admin app usable on a phone. Mobile is **complement, not replacement** for the desktop dashboard — most common use case is "quick lookup / log a payment" away from the desk. No PWA, no offline, no install prompt (per `DECISIONS-ARCH.md #47`).
> Spec: `plan/features/ADMIN-MOBILE.md` · Decision: `DECISIONS-FEATURES.md #107` (Implemented)
> Branch: `feature/phase-11.7-admin-mobile` (merged to `dev`) · 9 commits, 9 new test files (94 tests, 342/342 total green) · v0.90.0

- [x] **P0 — Foundations**
  - [x] `useBreakpoint` hook (single source of truth for `mobile | tablet | desktop`) — `admin-app/src/utils/useBreakpoint.ts`
  - [x] Responsive `Sidebar` (three modes: mobile slide-in / tablet icon-only / desktop full) — auto-close-on-route-change via `prevPathnameRef` (commit `97d32f1` regression fix)
  - [x] Hamburger button in `AdminLayout` header (mobile only)
  - [x] Compact sticky mobile header with centered "spark inn" wordmark (Stitch design) + safe-area-inset
  - [x] Page padding responsive: `p-4 sm:p-6 lg:p-8`
  - [x] `<meta name="viewport">` add `viewport-fit=cover` for iOS safe areas — `admin-app/index.html`
- [x] **P0 — Drawer / Modal / Toast**
  - [x] `Drawer` becomes full-screen bottom sheet on mobile with sticky action footer — split into `MobileDrawerPanel` + `DesktopDrawerPanel` sub-components
  - [x] `Modal` becomes full-screen sheet on mobile — same `Mobile*Panel` / `Desktop*Panel` split
  - [x] Replace all `alert()` / `confirm()` / `prompt()` with inline forms + `<Toast>` system (extends #106g to the whole admin app — 6 pages + AdminContext notify helper for outside-React contexts)
  - [x] `<Toast>` + `useToast` hook in `admin-app/src/components/Toast.tsx` (4 variants: success/error/info/warning, ARIA, safe-area-inset, auto-dismiss, module-level `notify.*` for non-React callers)
  - [x] `ConfirmForm` (alertdialog role, danger variant, required-reason enforcement) + `useTwoClickConfirm` (3s auto-cancel)
- [x] **P0 — DataTable mobile card view**
  - [x] Add `renderMobileCard?: (row: T) => ReactNode` prop to `DataTable`
  - [x] Switch to card list below 768px (status + ref on top, primary, secondary, action at bottom)
  - [x] `DataTable` skeleton is card-shaped on mobile
  - [x] `renderMobileCard` passed from Bookings, Members, Rates, CorporateInquiries (4 of the 7 candidates — Store Orders/Vouchers/Reports defer to P2; Settings/room-types/store-items don't have list views)
- [x] **P1 — Per-page work**
  - [x] Bookings: sticky CTA, sticky drawer footer, mobile card table with 3-dot `MoreVertical` menu + `PAID` pill, walk-in modal full-screen with stacked single-column form, `?filter=arrivals|departures|in-house` URL filter
  - [x] Intercom: split-pane → one-pane mobile with "← Back" + full-screen chat Drawer, extracted `IntercomChatPanel` + `StoreOrderMessageCard` components
  - [x] Settings: 260px left nav → horizontal scrollable tab bar (10 pills) on mobile, auto-scrolls to active tab via useEffect; `lg:hidden` on the mobile bar, `hidden lg:block` on the desktop nav
  - [x] Bookings per-page: `PAID` pill (emerald, when `onsitePayments >= totalPrice`), 3-dot MoreVertical button (stopPropagation via Blocker), walk-in modal stacked single column
  - [x] Bottom tab bar (new component, `BottomTabBar.tsx`) — Arrivals/Departures/In-House/Alerts on Bookings page, Settings on Settings page, fixed bottom, safe-area-inset, `role="tablist"` + `aria-current="page"` on active
- [x] **P2 — Accessibility & polish**
  - [x] Drawer/modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to `<h2 id={titleId}>` (no static aria-label)
  - [x] Focus trap via new `useFocusTrap` hook — Tab/Shift+Tab cycle within container, Escape close, focus restore on unmount via `previouslyFocused.current`
  - [x] Bottom tab bar: `role="tablist"` + `role="tab"` + `aria-selected` + `aria-current="page"` on active
  - [x] All animations respect `prefers-reduced-motion` (`useReducedMotion()` coerced to boolean via `!!`)
  - [x] Safe-area-inset padding on all sticky footers / chat input / bottom tab bar
- [x] **P2 — Testing**
  - [x] 9 new test files: `phase-11.7-mobile-foundations`, `phase-11.7-toast-drawer`, `phase-11.7-confirm-forms`, `phase-11.7-datatable-mobile`, `phase-11.7-bottom-tab-bar`, `phase-11.7-bookings-filter`, `phase-11.7-bookings-cleanup`, `phase-11.7-intercom-mobile`, `phase-11.7-settings-mobile`, `phase-11.7-a11y-polish` — 94 new tests, 342/342 total
  - [x] Source-pattern tests verify: focus trap queryable selectors + cycle + Escape + restore, `useFocusTrap` import in Drawer/Modal, `aria-labelledby` + `<h2 id={titleId}>`, BottomTabBar `aria-current="page"`, `renderMobileCard` prop on 4 pages, Toast + ConfirmForm patterns
  - [x] Build (`vite build`) passes · `tsc -b` typecheck clean
  - [ ] **Deferred to P3** — Manual QA matrix (18 screens × 6 breakpoints) + real device testing (iPhone SE, iPhone 14, Pixel 7, iPad) — requires a browser/device; doc/QA matrix at `ADMIN-MOBILE.md §Manual QA matrix`

### Estimate
~6 dev days. Implementation order and per-step scope in `ADMIN-MOBILE.md §Implementation order`.

---

## Plan Audit Fixes — June 10, 2026
> Source: mid-build plan audit (see `Spark Inn/mid-audit.md`)
> Fix these before or during the phase they block. Grouped by priority.

### 🔴 Fix before Phase 8 — Intercom

- ✅ **[AUDIT-1]** Build `api/handlers/email.ts` — all 7 email triggers (booking-submitted, payment-confirmed, booking-confirmed, checkin-reminder, booking-cancelled, corporate-inquiry, discount-rejected); wire all routes in `[...route].ts`
- ✅ **[AUDIT-2]** Build `api/handlers/reference.ts` — `/api/reference/generate`; wire in `[...route].ts`
- ✅ **[AUDIT-3]** Fix `storeOrders` Firestore rule — change to `allow read, create: if true; allow update: if isStaff();` so guests can read their own order status
- ✅ **[AUDIT-4]** Fix storage path mismatch — storage.rules has `store/{itemId}` but spec is `store-items/{itemId}`; align to `store-items/`
- ✅ **[AUDIT-5]** Fix storage rule — `settings/notification-sound` should be `allow read: if isStaff()` (not public)
- ✅ **[AUDIT-15]** Fix storage rule — `settings/website-content` write should be `allow write: if isAdmin()` (not isStaff)

### 🔴 Fix before Phase 10B — Spark Rewards

- ✅ **[AUDIT-6]** Extend `api/handlers/members.ts` with `/api/members/redeem-points` and `/api/members/undo-redemption`, and define those remaining member points routes in API-ROUTES.md (`/api/members/register` is covered by AUDIT-44). Added transactional redemption and admin-only undo handlers, route dispatch, and API tests covering insufficient balance, booking/member/history updates, and undo restrictions.
- ✅ **[AUDIT-6b]** Add `api/handlers/store.ts` and define `/api/store/create-order` in API-ROUTES.md — verified the store handler and route docs already cover `/api/store/create-order`, `/api/store/cancel-order`, and `/api/store/order-status`; added create-order API tests for transaction stock decrement, active booking lookup, unlimited-stock items, and insufficient-stock rejection.
- ✅ **[AUDIT-6c]** Add `api/handlers/admin.ts` and define `/api/admin/create-staff`, `/api/admin/disable-staff` in API-ROUTES.md. Added admin-only staff account creation/disable handlers, Firebase Auth custom-claim wiring, Firestore `guests/{uid}` profile mirroring, self-disable and last-active-admin guards, route dispatch, and API tests.
- ✅ **[AUDIT-7]** Add `isEarlyCheckInRequest?: boolean` to `IntercomMessage` type in `TYPES.md` and `BACKEND.md §intercoms`
- ✅ **[AUDIT-8]** Decide on `SparkRewardsPromo.perks` field — added `perks: (WebsiteContentItem & { isEnabled: boolean })[]` to `TYPES.md`, documented the backend schema in `BACKEND.md §settings/websiteContent`, and aligned the homepage feature spec with disabled-perk handling.

### 🟡 Fix before Phase 10 — Security & Polish

- ✅ **[AUDIT-9]** Add `VITE_SENTRY_DSN=` to both app sections in `ENV-SETUP.md`
- ✅ **[AUDIT-10]** Add `html2canvas` to the stack table in `CLAUDE.md` and `DECISIONS-ARCH.md`
- ✅ **[AUDIT-11]** Decide and document check-in reminder mechanism in `EMAIL-PDF-STORAGE.md` (Vercel Cron); added the `vercel.json` cron entry spec, env requirement, and cron route alignment
- ✅ **[AUDIT-12]** Create `vercel.json` at repo root with CSP headers, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; document in `FILE-STRUCTURE.md`

### 🟢 Anytime — Doc polish

- ✅ **[AUDIT-13]** Add `corporate-codes.ts` to `FILE-STRUCTURE.md §shared/utils/`; add as U-6 test in `DECISIONS-ARCH.md §Testing Strategy`
- ✅ **[AUDIT-14]** Add `images.ts` to `FILE-STRUCTURE.md §shared/utils/`
- ✅ **[AUDIT-16]** Add PWA icons (192×192 + 512×512 PNG) to `FILE-STRUCTURE.md §public/brand/` and `WHITE-LABEL.md §Asset Checklist` — `vite-plugin-pwa` is installed in `guest-app`; PNG icon assets still need to be provided by client per deployment (deferred to Phase 11 launch prep).
- ✅ **[AUDIT-17]** Fix duplicate tab numbering in `SETTINGS.md` — Store is Tab 10, Spark Rewards is Tab 11, Legal Content is Tab 12 (re-numbered in `plan/features/SETTINGS.md`).
- ✅ **[AUDIT-18]** Fix broken reference in `REPORTS.md` — changed `plan/docs/DECISIONS.md` to `plan/docs/DECISIONS-ARCH.md` (line 422).
- ✅ **[AUDIT-19]** Update ROADMAP.md Phase 10B progress — auth routes + page shells are already wired from wireframe pass; crediting ~5 items as done in this audit pass (Guest auth context, Sign-in, Sign-up, Forgot password, Navbar member state all marked ✅ in Phase 10B section).

---

## Plan Audit Fixes — June 11, 2026
> Source: cross-feature flow audit of ROADMAP.md against all feature MDs — focused on connections between phases and end-to-end user flows (guest, corporate, Spark Rewards member, front desk/admin), not new features.
> Fix these before or during the phase they block. Grouped by priority.

### 🔴 Fix immediately — correctness gaps in completed phases

- ✅ **[AUDIT-35]** Resolve contradiction with `AVAILABILITY-LOCKING.md` — verified admin walk-ins already post to authenticated `/api/bookings/create-walkin`, which uses a Firestore transaction; corporate guest bookings use `/api/bookings/create`. Aligned `AVAILABILITY-LOCKING.md`, `BOOKINGS-MANAGEMENT.md`, `CORPORATE-INQUIRIES.md`, `API-ROUTES.md`, and `GOTCHAS.md` so no flow documents direct `addDoc` booking creation.
- ✅ **[AUDIT-36]** Add a `/terms` (Terms of Service) page — required by `LEGAL.md` (booking agreement, cancellation, discount eligibility/RA 9994/RA 10754, liability, governing law clauses), linked from the footer and the Step 2 consent checkbox alongside `/privacy`. Added guest route/page, footer link, regular and corporate booking consent links, and aligned `CLAUDE.md`, `GOTCHAS.md`, `STATIC-PAGES.md`, `BOOKING-FLOW.md`, `SECURITY.md`, `DECISIONS-FEATURES.md`, and guest route docs.
- ✅ **[AUDIT-41]** Resolve Storage path sequencing gap — defined the preallocated Firestore booking document ID contract for guest/corporate booking flows. Step 3 uploads use the preallocated `bookingId`; `/api/bookings/create` creates that exact document inside the availability-locking transaction; only the guest-facing `bookingRef` is generated inside the transaction. Aligned `AVAILABILITY-LOCKING.md`, `BOOKING-FLOW.md`, `API-ROUTES.md`, `BACKEND.md`, `SECURITY.md`, and `GOTCHAS.md`; corporate booking now uses the same Firestore preallocation pattern instead of a timestamp ID.
- ✅ **[AUDIT-42]** Resolve self-contradiction in `SECURITY.md §bookings` Firestore rules — clarified that booking creation is API/Admin SDK only, while authenticated staff/admin may directly update existing booking operational fields where Firestore rules permit it. Tightened `firebase/firestore.rules` to deny client-side booking creates, documented server-only booking mutations, added `/api/bookings/add-payment` to `API-ROUTES.md`, and aligned `BACKEND.md`, `BOOKINGS-MANAGEMENT.md`, `GOTCHAS.md`, and `SECURITY.md`.
- ✅ **[AUDIT-43]** Resolve corporate inquiry form architecture gap — added `/api/corporate/inquiry` as the public submission path, moved corporate inquiry creation behind server-side validation, Turnstile, honeypot, rate limiting, and staff notification, blocked guest client-side creates in Firestore rules, wired the guest Corporate page to the API, and aligned `STATIC-PAGES.md`, `CORPORATE-INQUIRIES.md`, `API-ROUTES.md`, `BACKEND.md`, `SECURITY.md`, and `GOTCHAS.md`.

### 🔴 Fix before Phase 9 — Remaining Features

- ✅ **[AUDIT-20]** Add `/api/bookings/cancel` to `API-ROUTES.md` and as a Phase 9 checklist item — route now documented at `plan/docs/API-ROUTES.md:65`; the cancel action is already part of the Phase 9 Booking Lookup line item
- ✅ **[AUDIT-21]** Add `/api/bookings/reject-discount` to `API-ROUTES.md` — route now documented at `plan/docs/API-ROUTES.md:68`
- ✅ **[AUDIT-22]** Add "Email: discount rejected" as its own checklist item under Phase 6 — added as an explicit Phase 6 line item; handler wired from `handleRejectDiscount`
- ✅ **[AUDIT-23]** Add `discount-rejected` and `early-checkin-request` rows to the email routes table in `API-ROUTES.md` — both rows added; `early-checkin-request` marked as Phase 10B planned and tracked under AUDIT-26
- ✅ **[AUDIT-24]** Define `storeCharges[]` on `bookings/{bookingId}` in `BACKEND.md §bookings` — closed by documenting the **derived** approach in `plan/docs/BACKEND.md §bookings` (no denormalized field; checkout folio filters `storeOrders` on `bookingId` + `paymentMethod === "add-to-bill"` + `status === "delivered"` + `isBilled`). Aligned `STORE-MANAGEMENT.md` to match.
- ✅ **[AUDIT-25]** Flag dependency in Phase 4 (closed) — BookingPage Step 3 cancellation policy is already wired to `settings/websiteContent.cancellationPolicy` (with a hardcoded fallback). PrivacyPage body now sourced from `settings/websiteContent.privacyPolicyBody` via `getDoc` on mount (falls back to deployment-configured content when blank); Legal Content admin Settings tab added with all 3 textareas (privacy, cancellation, house rules); `privacyPolicyLastUpdated` auto-set on save.

### 🔴 Fix before Phase 10B — Spark Rewards

^- ✅ **[AUDIT-26]** Add `/api/email/early-checkin-request` route + handler to `API-ROUTES.md` and Phase 10B checklist — fallback staff notification for early check-in requests; `INTERCOM-INBOX.md` only "preserves metadata" with no concrete staff-facing action tracked
^- ✅ **[AUDIT-27]** Add "Member discount auto-apply at booking Step 1" as an explicit Phase 10B checklist item, noting it requires reopening the Phase 4 (closed) Step 1 component
^- ✅ **[AUDIT-28]** Add "Award points on checkout (`status → checked-out` trigger)" as a Phase 10B checklist item — server-side logic not covered by AUDIT-6's register/redeem/undo routes
^- ✅ **[AUDIT-29]** Add `/members` to the Admin role's accessible pages in `AUTH-ROLES.md §Roles` table — admin-app route table includes `/members` (admin-only) but the roles table omits it — updated `plan/features/AUTH-ROLES.md` Roles table to add `/members` (admin-only) to the Admin row.
^- ✅ **[AUDIT-37]** Define stacking/precedence order for the Phase 10B member discount relative to senior/PWD discount and vouchers — `DECISIONS-FEATURES.md` #55 only covers "senior/PWD first, then voucher"; member discount isn't factored in, so a booking could have all three with no defined order
^- ✅ **[AUDIT-38]** Add "Account deletion / data erasure request" to the Phase 10B My Profile checklist — `DECISIONS-FEATURES.md` #49 mandates that member account deletion triggers RA 10173 erasure, but no Phase 10B item covers building this flow — already built in `ProfilePage.tsx` (deleteDoc on `members/{uid}` + `deleteUser()` on Firebase Auth, with confirmation modal). Marked ✅ in Phase 10B line item; closing this audit.
- ✅ **[AUDIT-44]** Resolve `/rewards` enrollment mechanism contradiction — defined Spark Rewards enrollment as API-only through authenticated `/api/members/register`, added the registration handler with server-side sequential `memberNumber` generation and booking linkage, blocked client-side member creates in Firestore rules, and aligned `STATIC-PAGES.md`, `SPARK-REWARDS.md`, `API-ROUTES.md`, `BACKEND.md`, and `GOTCHAS.md`.

### 🟡 Fix before Phase 10 — Security & Polish

^- ✅ **[AUDIT-30]** Clarify scope split between Phase 4 (done) and Phase 10 Turnstile/honeypot items — Phase 4 covers the regular booking form only; reword Phase 10's "booking creation + corporate inquiry form" items to "corporate inquiry form" only, so it's clear the corporate form still needs both protections — reworded in Phase 10 ROADMAP line items above.
^- ✅ **[AUDIT-39]** Add "Accessibility QA — WCAG 2.1 AA checklist (`FRONTEND.md §Accessibility`) applied across guest-facing screens" to Phase 10 — `LEGAL.md` commits to this (tied directly to PWD discount guests), but Phase 10's QA section only covers cross-browser and mobile QA — added as an explicit Phase 10 checklist item.
^- ✅ **[AUDIT-40]** Expand Phase 10's "Firebase Storage rules — final version" item to explicitly cover `bookings/{id}/guest-id/{filename}` (staff-only read, per `BOOKINGS-MANAGEMENT.md`) alongside payment proof — currently only payment proof is named — already covered in `firebase/storage.rules` lines 28-30 (`match /bookings/{bookingId}/guest-id/{fileName}` → `allow read, write: if isStaff();`). Marking ✅.
^- ✅ **[AUDIT-45]** Also expand Phase 10's "Firebase Storage rules — final version" item to cover `bookings/{id}/discount-id/{filename}` (staff-only read, per `BOOKING-FLOW.md` Step 3 / `DECISIONS-FEATURES.md` #12) — same gap as AUDIT-40, separate path — already covered in `firebase/storage.rules` lines 23-26 (`match /bookings/{bookingId}/discount-id/{fileName}` → `allow read: if isStaff(); allow write: if true;`). Marking ✅.

### 🟢 Fix retroactively — Phase 0 / cross-cutting

^- ✅ **[AUDIT-31]** Add PWA setup checklist items to Phase 0 (manifest.json, `vite-plugin-pwa`, Workbox NetworkFirst/CacheFirst strategies, theme-color meta, apple-touch-icon) — `guest-app/CLAUDE.md` states this "must be wired up during Phase 0 scaffolding — not retrofitted later," but Phase 0 (41/41 done) has zero PWA items and AUDIT-16 only covers the icon assets — added as Phase 0 retrospective items in this audit pass; `vite-plugin-pwa` is installed; full PWA manifest config is a code task deferred to Phase 11 launch prep.

### 🟢 Anytime — Doc polish

- ✅ **[AUDIT-32]** Split the Phase 8 "QR Management page" line item into sub-items reflecting work already done (QR rendering via `qrcode.react`, URL format, route correctness — all ✅ in `QR-MANAGEMENT.md`) vs. remaining (grid view, regenerate, print single/all, download as PNG) — all sub-items already marked ✅ in `QR-MANAGEMENT.md`; Phase 8 ROADMAP line item is fine as-is. Marking ✅.
- ✅ **[AUDIT-33]** Add a note/checklist item in `CORPORATE-INQUIRIES.md` confirming "Convert to booking" goes through the same availability-locking transaction as `/api/bookings/create` (see `AVAILABILITY-LOCKING.md`) rather than a plain `addDoc` — added clarifying note in `plan/features/CORPORATE-INQUIRIES.md` §Convert to booking section.
- ✅ **[AUDIT-34]** Document in `QR-MANAGEMENT.md` what happens to an active intercom session on the old `roomId` when a QR code is regenerated mid-stay — added section in `plan/features/QR-MANAGEMENT.md` documenting that old `qrToken` URLs show "QR code no longer valid" on guest side and that any in-flight intercom session on the old token continues unchanged (the intercom chat is keyed by `intercoms/{roomNumber}` which is the Firestore doc ID, not the `qrToken`).
- ✅ **[AUDIT-46]** Expand `RATE-MANAGEMENT.md`'s "Discount rules section" (currently Senior/PWD only) to cross-reference where the Phase 10B member discount (`memberDiscountPct`) is configured, so admins have one place that surfaces all stacking discount sources (relates to AUDIT-37) — added cross-reference in `plan/features/RATE-MANAGEMENT.md` to `settings/rewardsConfig.memberDiscountEnabled` + `memberDiscountPct`.

---

## Phase 11.8 — Public Content Editability *(P0 — opened 2026-07-01)*
> Goal: Catalogue every string rendered to a guest in the public app, decide which ones the hotel owner reasonably needs to edit without a code redeploy, and ship the high-leverage additions to the existing Settings tabs. **The owner should not be bombarded with low-value fields.**
> Source: `plan/project/AUDIT-PUBLIC-CONTENT-2026-07-01.md` — full per-page inventory + 4-tier recommendation (A: make dynamic, B: keep hardcoded, C: keep in `hotel.config.ts`, D: defer to Phase 2)
> Branch convention: `feat/content-tier-a-*` for the implementation PRs
>
> **Status legend**: 🔴 Not started · 🟡 In progress · ✅ Done · ⏸ Deferred

### Open questions (close with the owner during staging review)

- 🔴 **Q1.** Does the owner want a custom tagline / brand promise different from the white-label config defaults? If yes → Tier A. If no → keep in `hotel.config.ts`.
- 🔴 **Q2.** Does the owner want to customize the booking flow copy (step labels, validation messages, payment method card labels)? Most hotel SaaS sites do not expose this. Confirm before PR 2.
- 🔴 **Q3.** Does the owner want to customize email subject + body for the 7 transactional triggers? If yes, scope a separate "Email Templates" tab in Phase 12 (out of scope for this phase).
- 🔴 **Q4.** Does the owner want the Spark Rewards "Member Privileges" copy to be different from the current 4 hardcoded cards? If yes → Tier A. If no → keep hardcoded.

### PR 1 — `feat/content-tier-a-hero-eyebrows` *(shipped 2026-07-01 — branch: `feat/content-tier-a-hero-eyebrows`)*
S effort, ~1 day. Adds the Tier 1 hero eyebrow / subtext editability to the public site + the cross-tab cache-invalidation mechanism so admin edits reflect on a parallel guest tab in real time. Scope was tightened from the original ~12 fields in `AUDIT-PUBLIC-CONTENT-2026-07-01.md` to the 3 fields that actually needed code changes (the rest were already wired on the read side per Batch 11).

- [x] `homepage.heroEyebrow` — replaces the hard-coded `""` in the hook with a `pickString(homepageRaw, "heroEyebrow", config.tagline)` chain. `HomePage` renders `{homepage.heroEyebrow || config.tagline}` so the deploy-time tagline is the safe default. `Settings → Branding` exposes the new input.
- [x] `about.heroEyebrow` + `about.heroSubtext` — added to `AboutContentSchema` + `PublicAboutContent` + the hook's `pickString` chain + `AboutPage` (with "Our Story" + "Discover the vision and heart behind {brandName}..." as the deploy-time fallbacks). `Settings → Branding` exposes both inputs in a new "About hero" card.
- [x] **Cross-tab cache bust** — new `shared/utils/publicSiteCache.ts` exports `bustPublicSiteContentCache` + `subscribeToPublicSiteContentBust`. `AdminContext.updateSettings` calls the bust after every `settings/websiteContent` / `settings/hotelConfig` save; the guest hook subscribes to the `storage` event and refetches. The 5-minute TTL is preserved for cold reloads; same-browser demos see updates in < 1 s.
- [x] **XS hotfix folded in** — `BookingConfirmPage` no longer hard-codes "Digital Wallet (GCash/Maya)" / "Bank Transfer (Direct Deposit)" / "Pay at Hotel". It now fetches `settings/hotelConfig.paymentMethods[].label` (the same dynamic list the booking page already uses) and falls back to a small `gcash` / `bank` / `pay-at-hotel` legacy map only for unconfigured methods. Closes the "PayPal" hardcode gap on the confirm page.

Files: `shared/utils/publicSiteCache.ts` (new), `shared/constants/index.ts` (`PUBLIC_SITE_CONTENT_CACHE_BUST_KEY`), `shared/index.ts` (re-export), `shared/schemas/websiteContent.ts` (about fields), `guest-app/src/hooks/usePublicSiteContent.ts` (chain + subscription + interface), `guest-app/src/pages/HomePage.tsx`, `guest-app/src/pages/AboutPage.tsx`, `guest-app/src/pages/BookingConfirmPage.tsx`, `admin-app/src/pages/SettingsPage.tsx` (3 new inputs + handleSaveBranding), `admin-app/src/context/AdminContext.tsx` (bust on save).

Tests: `shared/__tests__/publicSiteCache.test.ts` (new — 11 tests), `admin-app/src/__tests__/phase-11.8-tier-1-hero-eyebrows.test.ts` (new — 14 tests). 911/911 total green.

Docs: `plan/docs/TYPES.md` (about + homepage comments), `plan/docs/BACKEND.md` (per-page hero fallback table + cache-bust paragraph), `plan/features/SETTINGS.md` (Branding → Hero Copy section).

### PR 2 — `feat/content-tier-a-website` *(deferred to post-launch, ~2 days, M effort — open after first 30 days of real data)*
Extends **Settings → Website Content** with new sub-objects for the rest of the public-facing pages. ~35 new fields (after Q1–Q4 deferrals). Most are simple `string` mirrors of existing list-editor patterns.

- [x] `homepage.sectionHeaders` — eyebrow + title + lead per section (rooms, amenities, services - starter batch shipped 2026-07-09)
- [x] `roomsCatalog` — hero eyebrow, title, subtext (starter batch shipped 2026-07-09)
- [x] `contact` — hero eyebrow, title, subtext (starter batch shipped 2026-07-09)
- [ ] `corporate.perksSectionEyebrow` + `corporate.perksSectionTitle` + `corporate.cardLabels` + `corporate.inquiryForm` (labels, placeholders, button, success, error)
- [ ] `corporate.onboardingSteps[]` — new list editor for the 3-step process (mirrors `perks[]`)
- [ ] `rewards.howItWorks` — eyebrow + title + 3-step list editor
- [ ] `rewards.ctaBanner` — heading + body
- [ ] `bookingConfirm` — headlines, subtext, details card labels, payment method display labels, calendar buttons, Spark Rewards upsell block, empty state
- [x] `notFound` — hero eyebrow, title, subtext (starter batch shipped 2026-07-09)
- [ ] `termsLastUpdated` (string) + `termsBody` (full-text override, mirrors `privacyPolicyBody`)
- [ ] (Q2) `bookingFlow` — only if the owner answers the audit's Q2 with a yes
- [ ] (Q4) `rewards.privileges` — only if the owner answers the audit's Q4 with a yes

Files: same as PR 3, plus reuse the existing `ListEditor` component (no new editor component).

Test: extend `admin-app/src/__tests__/website-content-fields.test.ts` + new `guest-app/src/__tests__/content-tier-a-render.test.ts` covering each new field's `pickString` chain end-to-end.

### PR 3 — `feat/content-tier-a-hotel` *(shipped 2026-07-01 — branch: `feat/content-tier-a-hotel`)*
S effort, ~1 day. Adds the Tier 1 hotel contact editability to the public site — 6 new runtime-editable contact fields + 1 missing `visionStatement` field, sourced from `settings/hotelConfig` with the deploy-time `hotel.config.ts` value as the safe default in the public hook.

- [x] `PublicContactContent` interface added to `usePublicSiteContent` with all 6 fields (address, frontDeskPhone, supportEmail, dpoEmail, facebookUrl, instagramUrl).
- [x] `buildFallback` seeds the new section from `config.*` so the public site never goes blank during the cold-load window.
- [x] Firestore merge uses `pickString(hc, "field", fb.contact.field)` for each — same safe-default pattern as PR 1.
- [x] **Footer** + **ContactPage** consume the hook instead of `config.*`; layer a `|| config.X` at render time as belt-and-suspenders.
- [x] **PrivacyPage** reads `dpoEmail` + `address` from the hook with the same fallback pattern.
- [x] **Settings → Hotel Info** form gets 7 new inputs in a "Hotel Contact Details" card (visionStatement + address + frontDeskPhone + supportEmail + dpoEmail + facebookUrl + instagramUrl); `handleSaveHotel` writes all 7 alongside the existing fields.
- [x] Structured `address: { street, city, region, postalCode }` deferred (single-string ships; structured form is a follow-up).

Files: `guest-app/src/hooks/usePublicSiteContent.ts` (interface + chain + fallback), `guest-app/src/components/Footer.tsx`, `guest-app/src/pages/ContactPage.tsx`, `guest-app/src/pages/PrivacyPage.tsx`, `admin-app/src/pages/SettingsPage.tsx` (7 new state hooks + 7 new inputs + handleSaveHotel), `plan/docs/TYPES.md` (HotelConfig + admin-editable comment), `plan/docs/BACKEND.md` (settings/hotelConfig list), `plan/features/SETTINGS.md` (Hotel Contact Details card).

Tests: `admin-app/src/__tests__/phase-11.8-tier-1-hotel-contacts.test.ts` (new — 18 tests). 929/929 total green.

### Non-Tier-A fixes surfaced by the audit (defer to existing settings tabs, no new fields)

- [x] **Wire booking Step 3 payment method card labels to `hotelConfig.paymentMethods[].label`** — closes the "PayPal" gap on the confirm page and the "Digital Wallet" / "Bank Transfer" / "Pay at Hotel" hardcode without adding new fields. File: `guest-app/src/pages/BookingPage.tsx` + `BookingConfirmPage.tsx`. Effort: XS.

### What we explicitly decided NOT to do (deferred per the audit's recommendation)

- ⏸ **Footer / Navbar link order** — product IA, not content. If a hotel asks, promote to a Tier A item.
- ⏸ **Form validation messages + voucher error messages** — code-side contract with the guest, not marketing copy.
- ⏸ **Sign-in / sign-up page copy** — product IA, not marketing copy.
- ⏸ **In-room chat copy (`/intercom`)** — product IA, no marketing surface.
- ⏸ **Privacy page structured fallback body** — only reachable when `privacyPolicyBody` is empty; not a long-term editor surface.
- ⏸ **Member portal tier labels** ("Standard Member") — depends on the Phase 2 tier system.
- ⏸ **Email subject + body per trigger** — out of scope; ship a separate Phase 12 "Email Templates" tab if a hotel asks.

### Effort summary

| PR | Effort | Files touched | New editor fields |
|---|---|---|---|
| PR 1 — Branding extension | S | 6 | ~12 |
| PR 2 — Website Content extension | M | 8 + ListEditor reuse | ~80 |
| PR 3 — Hotel contact extension | S | 4 | 6 |
| **Total** | **~M (4 days)** | **~10** | **~100** |

Most of the ~100 new fields are simple `string` mirrors of the existing list-editor pattern. The implementation cost is in the per-page `usePublicSiteContent` reads and the corresponding `pickString` chain, not in the editor UI.

---

## Phase 11.9 — SEO & Open Graph *(P0 — opened 2026-07-09)*
> Goal: Guest app is discoverable in Google/Bing/Yahoo and every public URL renders a rich link-preview card in Facebook/Messenger/WhatsApp/Viber/X.
> Full spec: `plan/features/SEO-OPENGRAPH.md`

**Context (audit 2026-07-09):** Base client-side meta already exists — static tags in `guest-app/index.html`, a build-time config transform in `vite.config.ts`, and per-route `PageMeta.tsx` (title/description/canonical/robots/OG/Twitter). **Gap:** `PageMeta` sets tags via JS `useEffect`, which non-JS social/Bing crawlers never see — so every shared link shows the same generic homepage card, and Bing/Yahoo can't read per-route meta. Plus the OG image, robots, and sitemap are missing entirely.

### Open questions (close with owner before build)
- ✅ **Q1.** ~~Option A vs Option B?~~ **Resolved 2026-07-09 — Option A (build-time prerender):** no extra Vercel function, no UA sniffing, robust for all crawlers. Option B (per-record cards) deferred post-launch.
- 🔴 **Q2.** Approve the 1200×630 OG card design (logo + tagline on brand orange).
- ✅ **Q3.** ~~X/Twitter handle for `twitter:site`?~~ **Resolved 2026-07-09 — support X/Twitter:** add `twitterHandle` to `hotel.config.ts`, emit `twitter:site` when set (Spark Inn's handle value TBD by owner; tag omitted until then).
- ✅ **Q4.** ~~`priceRange` value?~~ **Resolved 2026-07-09 — relative band `₱₱`** via new `config.priceRange`; chosen over an explicit range because build-time JSON-LD would drift from live rates.

### Checklist
- ✅ **G3** — `guest-app/public/robots.txt` (`Allow: /` + `Sitemap:` pointer); `admin-app/public/robots.txt` → `Disallow: /`
- ✅ **G4** — `sitemap.xml` of indexable public routes (exclude `noIndex` routes), generated from the same route list used by the SEO build plugin
- ✅ **G2** — real 1200×630 `guest-app/public/og-image.png` added (copied from branding files); verified on white-label asset checklist
- ✅ **G1** — per-route meta in the **served** HTML: `guest-app/vite.config.ts` now writes build-time route shells for `/rooms`, `/corporate`, `/rewards`, `/about`, and `/contact` with baked-in title/description/canonical/OG/Twitter tags while keeping `PageMeta.tsx` for SPA navigation
- ✅ **G5** — `schema.org/Hotel` JSON-LD on homepage, all values from `hotel.config.ts` (`address`, `telephone`, `sameAs`, check-in/out times, `priceRange` = new `config.priceRange` band `₱₱` per Q4)
- ✅ **G6** — OG polish: `og:image:width`/`height`/`alt`, `og:locale` (from `config.locale`), `twitter:site` from new `config.twitterHandle` (per Q3, rendered only when set)
- ✅ **Config** — add `twitterHandle` + `priceRange` fields to `hotel.config.ts` (both new, feeding G5/G6)
- ✅ **Admin** — `admin-app/index.html` carries `noindex, nofollow`
- ⬜ **Verify** — Facebook Sharing Debugger + WhatsApp + Viber render distinct correct cards for ≥3 URLs; X Card Validator; Google Rich Results Test on JSON-LD
- ⬜ **Post-deploy** — submit sitemap to Google Search Console + Bing Webmaster Tools

---

## Phase 12 — Post-Launch (Phase 2, Deferred)
> Goal: Enhancements after stable v1.0.0.

- ✅ Email preview interface — add a preview to the sample email templates in Admin Settings (Active Email Triggers). Add an authenticated server-side route `/api/email/preview` that renders templates with realistic mock data, and display it in an iframe inside a preview modal/drawer in SettingsPage.
- ✅ Breakfast Silog Management CRUD — add, edit, and delete options for the breakfast menu items in SettingsPage under the Breakfast & Dining tab.
- ✅ Dashboard Intercom Widget — add a live chat preview/widget to the Dashboard Overview page showing recent active room threads, unread message indicators, and quick links to `/intercom`.
- ✅ Bugfix: Walk-in Booking Modal Scrollability — fix layout issue where the Create Walk-in Booking modal is not scrollable and gets cut off on smaller screens. See `plan/bugs/walkin-booking-modal-scrollability.md`.
- ✅ Early check-in approval workflow — persist member early check-in requests on the booking (`earlyCheckIn` map), approve/decline from the booking drawer, guest confirmation email + status in My Stays/My Rewards, arrivals-list badge. Today the request ends at a staff notification email with no record on the booking. Full spec: `plan/features/SPARK-REWARDS.md §Phase 2 — Early Check-In Approval Workflow`
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya)
- ✅ Calendar view for bookings (visual room × date grid)
- ✅ Seasonal rate overrides
- ✅ Rate Calendar — month-based room type × date grid for effective public rates, multi-select/unselect seasonal rate editing, and holiday labels sourced from seasonal override names. Full spec: `plan/features/RATE-CALENDAR.md`. *(Shipped in the same commit that added this line — marked done during the 2026-07-08 audit.)*
- ✅ **P1 / Small effort — Senior/PWD discount ID upload repair** — fixed Step 3 OSCA/PWD image upload in the guest booking flow by adding field-level upload error/retry feedback, sanitized Firebase Storage filenames under `bookings/{bookingId}/discount-id/{filename}`, hidden file-input reset after success/delete/failure, stale-upload clearing when the discount type changes, and regression coverage for the upload safeguards. Storage rules already allowed public write and staff-only read, so no rule change was needed.
- ✅ **P2 / Medium effort — Voucher application repair** — fixed voucher application in the guest booking page by blocking Apply until Turnstile is ready, preserving the canonical voucher code returned by validation, clearing stale applied voucher state when the code changes, and aligning client/server percent-voucher math so vouchers apply after Senior/PWD discount. Added regressions for the guest Apply safeguards and Senior/PWD plus percent-voucher booking creation; `usageCount` still increments only after successful booking creation.
- ✅ **P3 / Medium effort — Check-in gate repair** — completed shared check-in readiness enforcement for admin drawer and `/api/bookings/checkin`. Staff now see a missing-items checklist and cannot check in until booking status is `confirmed` or `payment-confirmed`, a guest ID photo is saved, required registration fields are complete, and signature status is `signed`. Server rejects direct/API bypass attempts with the same missing-items list; direct check-in from `payment-confirmed` remains supported.
- ✅ **P4 / Large effort — PDF generation repair** — repaired admin PDF reliability by opening booking PDF tabs synchronously, falling back to `pdf.save()` when popups are blocked, using reliable jsPDF built-in fonts instead of missing/unsafe embedded font paths, detecting uploaded ID image MIME type before `addImage`, wrapping registration/receipt builders in visible success/error toasts, and relabeling Reports to browser **Print Report** with Save-as-PDF guidance.
- ✅ **P5 / Large effort — Guest-facing price breakdown for mixed regular/weekend/holiday rates** — completed itemized rate lines for guest Step 1 mixed-rate previews, Step 3 review, Step 4 confirmation, `/my-booking`, guest/staff emails, admin drawer, and admin receipt PDFs. Bookings now persist locked `Booking.rateBreakdown` snapshots from the server for regular, weekend, seasonal/holiday, corporate, walk-in, and rescheduled pricing, with legacy fallbacks for older bookings.
- ⏸ Automated test suite
- ⏸ Additional hotel client deployments (white-label)
- ✅ Image preview modal — add a preview modal for uploaded images such as screenshot/receipts/guest IDs, etc. in the guest checkout flow and the admin bookings details view.
- ✅ Dashboard Intercom stats — display unread message count metric card on dashboard and sidebar.
- ✅ Real-time Audio Ringtone Alerts — play Web Audio synthesized notifications for new bookings, pending payments, guest messages, guest arrivals (check-ins), and departures (check-outs).
- ✅ **Senior/PWD discount online-booking toggle** *(owner request 2026-07-11)* — admin toggle (`settings/hotelConfig.seniorPwdOnlineEnabled`, default **on**) controlling whether the Senior/PWD discount selector + OSCA/PWD ID upload appear in the guest booking flow (`/book` Step 3). Server-authoritative: `handleCreateBooking` ignores/rejects `discountType` when disabled (never trust client, per Hard Rules). Toggle lives in the RatesPage "OSCA Legally Mandated Deductions" panel next to the read-only 20% rows. **Compliance scope — the toggle only removes the *online self-service* path; it must NOT allow refusing the discount itself:** the walk-in/admin drawer path stays always available so eligible guests presenting a valid ID at the front desk still receive the mandated 20% (RA 9994 / RA 10754). The 20% rate itself remains hardcoded and locked. When off, show a booking-flow note directing eligible guests to claim the discount at check-in. Spec: `plan/features/RATE-MANAGEMENT.md §Discount rules`. **Depends on the post-booking discount/voucher application item below — build that first (or together), otherwise "claim at check-in" points at a flow that doesn't exist.**
- ✅ **Post-booking discount & voucher application (drawer + walk-in)** *(owner request 2026-07-11)* — staff can apply a Senior/PWD discount **or a promo voucher** to an existing booking at/before check-in, and the walk-in modal gains discount + voucher fields. Today neither exists: the drawer's verification panel only renders for bookings that claimed online (`BookingsPage.tsx:2590`), and walk-ins hardcode `discountPct: 0` / `voucherDiscount: 0` — so a senior presenting a valid ID at the desk (legally entitled to 20% under RA 9994/10754) gets honored **off the books**, making collected cash diverge from `totalPrice` and guaranteeing false shortfalls in the planned FIN-01/FIN-13 collections & variance reports. Server-authoritative route re-prices with the canonical stacking order (Senior/PWD → voucher → member), snapshots `originalTotalPrice`, stamps `discountVerifiedBy`; vouchers validated with the same server rules as online (expiry/cap/room-type scope) + atomic `usageCount` increment. Not gated by `seniorPwdOnlineEnabled` — the front-desk path is the legally mandated one. Full spec: `plan/features/BOOKINGS-MANAGEMENT.md §Implementation Plan — Post-Booking Discount & Voucher Application`.
- ✅ **Incidental charges — folio charge ledger (FIN-14)** *(owner request 2026-07-11)* — staff can add ad-hoc charges (late checkout, early check-in fee, extra person/bed, damage, laundry, other) to a booking's folio. Today the folio is a closed list (room + breakfast + add-to-bill store orders — `getBookingFolio`, `BookingsPage.tsx:1659`) with no charge mechanism, so incidentals are collected off the books → unexplained cash overages once FIN-01/FIN-13 land. Design: `bookings/{id}/charges` subcollection mirroring the payments pattern — categorized, `addedBy`/`addedAt` stamped, **append-only at the rules level** (void = negative reversal entry with `voidOf`, never delete). Wired end-to-end: folio grandTotal/balance, checkout gate, receipt PDF, Sales tab as a 4th revenue stream + Incidentals sub-table, Sales XLSX + Full Backup "Charges" sheets, FIN-01 billed-side reconciliation, FIN-04 receivables, `TYPES.md`/`BACKEND.md`/`REPORTS.md` doc sync. Build before or with FIN-01 so the collections report's billed side is complete from day one. Full spec + wiring checklist: `plan/features/BOOKINGS-MANAGEMENT.md §Implementation Plan — Incidental Charges (Folio Charge Ledger)`.
- ✅ **Notification Center** *(proposed 2026-07-15 — owner question: "so that every time the admin app rings, the admin or front desk knows what it was")* — the app already **rings** globally for 5 event types (booking / payment / message / arrival / departure) via `AdminContext.playSynthNotification`, but the ring is **ephemeral** — no record of what happened if staff look away. Shipped on `feature/notification-center` with a persistent header **bell + unread badge + panel** that logs the same events (type, room #/booking ref, timestamp, deep link to the relevant page). Owner chose **Option B** — a persisted `notifications` Firestore collection (durable, cross-device, per-staff `readBy` read-state), *not* the session-only ring buffer. Written **server-side via Admin SDK from the existing API routes** (booking/payment/confirm/checkin/checkout/store-order placed) — one doc per event; guest chat alerts stay live-derived from the `intercoms` listener (**B1, decided 2026-07-15** — B2 server-relay rejected) since there is no server route for guest messages and the stack has **no Cloud Functions** to trigger on. **Build includes:** `notifications` rules (staff read, Admin-SDK create, `readBy`-only update), a `Notification` shared type, a daily retention cron (`/api/notifications/prune`, `0 3 * * *`) so the collection doesn't grow unbounded on Blaze (the FLR-03 trap), per-staff mark-read + "Mark all as read", deep links (`/bookings?bookingId=`, `/bookings?tab=store&orderId=`, `/intercom?room=`), mobile-friendly panel (drawer on `<768px`, dropdown on desktop per ADMIN-MOBILE.md), and respect for the sound-mute setting (Decision #97) as visual-only mode. **MD sync:** `BACKEND.md` (schema + rules row), `TYPES.md`, `API-ROUTES.md`, `vercel.json` cron, decision #120 — all done. 53 new tests (9 API + 44 admin) + 1,164 total green; typecheck clean.
- ✅ **Payment Rejection & Reference Verification** *(2026-07-15 — *owner request*) — shipped as Option A (bounce → `pending`, room stays held). Handler `POST /api/bookings/reject-payment` validates `payment-uploaded` status, updates to `pending`, stamps `paymentRejectionReason` + `paymentRejectedAt` + `paymentRejectedBy` (keeps stale proof/reference for audit). Server sends `payment-rejected` email + writes `payment` notification. Dashboard pending-payment cards now display the guest's `paymentReferenceNumber` + a Reject button that opens a modal with canned-reason presets + free-text textarea (500 char max, required). Guest lookup page shows `paymentRejectionReason` as a red banner when set. Three new fields on `shared/types/index.ts:Booking`. Built on `feature/dashboard-payment-reject`.

### Booking Drawer Information Architecture & UX Refactor

> **Status:** 🔄 In Progress — structural tranche implemented on `feature/booking-drawer-ux`; focused workflow modals and final visual QA remain.
>
> **Proposed:** July 15, 2026 — owner requested a less overwhelming and better-organized booking drawer without removing any existing feature.
>
> **Goal:** Turn the booking detail drawer from one continuous stack of summaries, forms, ledgers, and actions into a status-aware front-desk workspace. Preserve feature parity and existing booking rules; this is an information-architecture and interaction refactor, not a scope reduction or data-model rewrite.

#### Non-negotiable feature preservation

The refactor must retain all current drawer capabilities: booking status and channel; guest contact details; payment proof preview; payment method and reference editing; guest registration and PDF; guest ID attachment; stay details; move/upgrade/reschedule; locked-rate financial breakdown; breakfast selections; staff-applied Senior/PWD discount and voucher; government discount verification; Spark Rewards redemption; onsite payment and refund ledger; early check-in approval/decline; transactional email resend actions; incidental charge add/void ledger; store charges billed to room; checkout folio; receipt preview/printing; check-in readiness enforcement; all allowed status transitions; and booking cancellation.

#### Target information architecture

- ✅ **BDUX-01 — Sticky booking header and lifecycle context.** Implemented compact booking context, lifecycle, total/paid/balance summary, actionable payment/early-check-in/readiness alerts, and persistent guest contact plus editable payment reference above the section tabs.
- ✅ **BDUX-02 — Four task-based sections.** Implemented **Overview**, **Check-in**, **Folio**, and **Activity & More** with desktop/mobile labels. Panels remain mounted while hidden so switching sections does not discard local form input.
  - **Overview:** guest information, room and dates, guest count, breakfast inclusion, payment method/reference, compact payment-proof review, early check-in alert, and high-level financial summary.
  - **Check-in:** readiness checklist, guest registration, signature, guest ID, government discount verification, and breakfast selections.
  - **Folio:** total/paid/balance summary, locked-rate breakdown, discounts/voucher, Rewards redemption, onsite payments, refunds, incidentals, store charges, checkout folio, and receipt actions.
  - **Activity & More:** transactional email actions/history, move/upgrade/reschedule, secondary administrative controls, audit-oriented detail, and cancellation.
- ✅ **BDUX-03 — Check-in readiness workspace.** Implemented a scannable readiness card driven by the shared client/server missing-items helper; Check-in alerts navigate to the existing editors. Fine-grained checklist-to-editor focus remains with BDUX-04.
- 🔄 **BDUX-04 — Progressive disclosure rules.** The four top-level sections now establish the primary hierarchy and essential alerts stay visible. Remaining: focused disclosures for completed registration, detailed rates, payment/refund history, incidentals, breakfast selections, and email history/actions.
- ⬜ **BDUX-05 — Focused task modals.** Move bounded workflows into responsive modals/full-screen mobile sheets: move/upgrade/reschedule, apply discount or voucher, record payment, record refund, add incidental charge, void a charge, resolve early check-in, and cancel booking. Existing validations, confirmations, permissions, audit stamps, optimistic updates, and toast feedback must be preserved. Destructive actions still require one clear confirmation step.
- ✅ **BDUX-06 — Status-aware sticky action footer.** Implemented one primary action for the current status plus **More actions** navigation. Cancellation is isolated in More and no longer competes with the normal workflow.
- ✅ **BDUX-07 — Responsive composition.** Implemented two-column desktop Overview content, compact mobile section labels, 44px navigation/actions, and the existing Drawer's safe-area footer, focus trap, and reduced-motion behavior.
- 🔄 **BDUX-08 — Component extraction and regression coverage.** Extracted the workspace header, tabs/panels, readiness card, and action footer into `BookingDrawerWorkspace.tsx`; added feature-parity and status-action tests. Remaining: extract the large editors/ledgers and add interaction-level modal/disclosure tests plus authenticated visual QA.

#### Interaction and visual rules

- Payment proof becomes a compact alert/review card with thumbnail, method/reference, preview, and full-size actions instead of dominating the drawer width.
- Folio opens with three scannable values — **Total**, **Paid**, and **Balance** — before showing detailed line items and ledgers.
- Unresolved operational items receive emphasis; completed or historical information becomes quieter and collapsible.
- Forms should not all render open simultaneously. Opening a focused editor must make its current values and save/cancel outcome obvious.
- Existing status eligibility, server-authoritative pricing, check-in/checkout gates, staff-role restrictions, PII protections, and immutable ledger behavior must not change as part of this UI refactor.
- All styling continues to use config-driven brand tokens; no hardcoded hotel name, currency, locale, timezone, colors, room types, or booking-reference prefix.

#### Delivery and acceptance criteria

- ✅ Inventory every current booking-drawer control before extraction and maintain a feature-parity checklist during implementation.
- ✅ Implement the structural shell first: sticky header, lifecycle, section navigation, and sticky footer; then migrate one existing feature group at a time.
- ⬜ Verify representative bookings in every status and conditional combination: payment proof, breakfast, Senior/PWD, voucher, Rewards, early check-in, onsite payments/refunds, incidentals, store charges, corporate source, checked-out, and cancelled.
- ⬜ At 1440px, staff can understand guest, stay, payment state, outstanding balance, and next action without scrolling the default Overview.
- ⬜ At 375px, there is no horizontal page scroll; all features remain reachable; the primary action stays usable above the safe area; modal/sheet focus and close behavior remain accessible.
- ⬜ No action requires more navigation steps than the current drawer for its common operational path, and the next valid status action remains reachable in one tap/click from any section.
- ⬜ Run admin typecheck, booking/admin regression tests, and targeted manual visual QA across mobile, tablet, and desktop before marking complete.

### Notification Center — post-ship review (2026-07-15, all closed)

> Code review of `feature/notification-center` (commit `408f6ce`). Server write lib, all six write sites, security rules, retention cron, client hook, and bell verified. Implementation is sound (PII-safe titles, idempotent payment writes, bounded/unsubscribed `onSnapshot`, mute-independent bell, deep links resolve). One SEV-2 undermined the durability guarantee that was the whole reason to pick Option B; two SEV-4 polish items. **All 3 fixed on `fix/notification-center-postship` (2026-07-15).** Ordered by severity.

**SEV-2 (fix first):**
- ✅ NC-01 — **Notification writes are fire-and-forget on Vercel and can be silently dropped.** Every write site called `void writeNotification(...)` (not awaited) while the adjacent email sends were `await`ed. On Vercel's serverless runtime the instance can freeze/recycle once `res.json()` flushes, so an un-awaited Firestore `add()` may never execute — intermittently, and invisibly under `vercel dev`. Worst case was `handleCheckoutBooking` where the `void writeNotification` sat *after* `res.status(200).json(...)` — the response was already sent before the notification code ran. Same un-awaited pattern in `handleCreateBooking`, `handleCreateWalkin`, `handleAddPayment`, `handleConfirmBooking`, `handleCheckinBooking`. This defeated Option B's durable-record premise (drops are exactly what the session-buffer path was rejected to avoid). **Fix:** `await writeNotification(...)` before sending the response (and in checkout, move the block above `res.json`). The helper already swallows all its own errors internally, so awaiting is safe — it can never fail the booking/payment; it just guarantees the write is issued. **Shipped on `fix/notification-center-postship`:** all 7 write sites now `await`, the checkout block moved above `res.json`. 7 new admin source-pattern tests assert `await writeNotification` + the pre-`res.json` ordering in checkout.

**SEV-4 (polish):**
- ✅ NC-02 — **`readBy` update rule is broader than "mark my own read."** `firebase/firestore.rules` `notifications` update rule enforced `affectedKeys().hasOnly(["readBy"])` but not that the writer only touches *their own* UID, so any staff member could overwrite the entire `readBy` map (clear/forge another staff member's read state). Low risk (staff are trusted; worst case is a wrong unread badge), but to make it airtight, also assert the diff touches only `readBy.{request.auth.uid}`. **Shipped on `fix/notification-center-postship` + `fix/notification-center-nc-02b`:** added `request.resource.data.readBy.keys().hasOnly(resource.data.readBy.keys().union([request.auth.uid]))` + `request.resource.data.readBy[request.auth.uid] is timestamp` + `resource.data.readBy.keys().hasOnly(request.resource.data.readBy.keys())` to the update rule. Combined: the key set can only *grow by the writer's own UID* (or stay the same). Source-pattern test asserts all three halves.
- ✅ NC-02b — **NC-02 only partially closed; removal/forgery of other staff's `readBy` entries still passes.** The tightened rule bounds only the *key set* (`hasOnly(existing ∪ myUid)`) and the writer's *own* value, so two vectors remained: **(1) removal** — submitting `readBy = {me: ts}` is a valid subset of `{bob, me}`, so it silently wipes Bob's read entry; **(2) value forgery** — `readBy = {bob: <other ts>, me: ts}` passes because Bob's key is pre-existing and only the writer's own value is checked. Impact unchanged from NC-02 (**SEV-4, low** — trusted staff, worst case a wrong unread badge on a colleague's session). **Shipped on `fix/notification-center-nc-02b`:** added `resource.data.readBy.keys().hasOnly(request.resource.data.readBy.keys())` — forces every existing key to survive, so combined with the NC-02 check the key set can only *grow by the writer's own UID*. Value-tampering on others' existing entries stays reachable (Firestore rules can't loop over map values to compare each unchanged) and is **knowingly accepted** at this severity. Source-pattern test asserts the new line.
- ✅ NC-02c — **The NC-02 `readBy` rule was functionally broken: `keys().union(...)` is invalid (`keys()` is a List, `.union()` is Set-only).** Surfaced by running the Firebase rules validator on the full `firestore.rules` (not just re-reading it) — two `Invalid type. Received [list]. Expected [set]` warnings on the NC-02 line. On an `allow update`, a type error at evaluation makes the condition error and **denies the write**, so staff would have been unable to mark *any* notification read in production (unread badges never clear) — worse than the low-severity forgery vector NC-02/02b were hardening. **Missed by three prior "green" rounds because the rules tests are source-pattern (grep) tests — they assert the rule text is present, never evaluate it.** **Shipped on `fix/notification-center-nc-02c`:** replaced the union clause with `request.resource.data.readBy.keys().removeAll(resource.data.readBy.keys()).hasOnly([request.auth.uid])` ("keys being added ⊆ {my UID}") — semantically identical, List-only ops, **validator returns "No errors detected."** Updated the grep test to the corrected clause. **NC-02d ✅ (follow-up closed):** added the first **emulator-based rules test** — `firebase/tests/notifications.rules.test.ts` loads the real `firestore.rules` into the Firestore emulator and evaluates actual access decisions (staff mark-own-read allowed; removal, foreign-UID injection, non-timestamp own value, non-readBy field, non-staff, create, and delete all denied; the known value-forgery residual encoded as `assertSucceeds` so a behavior change surfaces). Run via `npm run test:rules` (`firebase emulators:exec --only firestore`; needs Java) — intentionally **not** in the default `npm test`. Deps added at root: `@firebase/rules-unit-testing`, `firebase-tools`, `vitest`, `firebase`; `vitest.rules.config.ts` + README §"Firestore security-rules tests" added. This is the guard that would have caught NC-02c — grep tests cannot catch an invalid-but-present rule.
- ✅ NC-03 — **Retention prune deletes serially.** `pruneNotifications` hard-deleted in a 500-iteration `await` loop; correct and bounded, but a `BulkWriter`/batched delete scales better if volume ever grows. Also one run prunes ≤`batchSize` docs, so a large backlog drains over several daily runs (irrelevant at 14-room scale). **Shipped on `fix/notification-center-postship`:** prune now goes through `adminDb.bulkWriter()` with per-doc `.catch` so a single terminal delete failure no longer aborts the whole run. Partial-success path: the returned `deleted` count + `deletedIds` reflect only the docs that actually landed. Source-pattern + behavioral tests cover both happy + partial paths.

> **Verified correct (no action):** titles carry only booking ref + room number (no guest PII, Hard Rule holds); payment writes guard on `!idempotentReplay`; client hook is auth-gated, `limit(50)`-bounded, and unsubscribes in cleanup; mark-read uses dot-path `readBy.${uid}` (satisfies the rule); bell has no `soundsEnabled` reference (logs even when muted, per Decision #97); both deep-link targets read their params (`?orderId=` added `storeOrders` to effect deps to handle the load race; `?room=` opens the thread); cron is CRON_SECRET-gated with capped `maxAgeMs`/`batchSize`. The listener + prune queries are single-field (`createdAt`) — no composite index needed (the code comment overstating a composite index is cosmetic).

### Phase 12 Features Audit — fixes to close (audited 2026-07-08)

> Post-ship audit of the six Phase 12 features that landed 2026-07-08.
> Full findings, severities, and fix guidance:
> `plan/project/AUDIT-PHASE12-FEATURES-2026-07-08.md`. No SEV-1s; the
> three SEV-2s each make a shipped control non-functional or produce
> wrong guest-facing information. Fix in the order listed.

**SEV-2 (fix first):**
- ✅ PF-01 — Room block editing always fails with 400: client never sends `roomId` but `updateBlockSchema` requires it (`CalendarPage.tsx` / `AdminContext.tsx` / `room-blocks.ts`)
- ✅ PF-02 — Early check-in "Confirmed Check-In Time" picker is never sent to the server; approval email shows the guest's requested time instead (`BookingsPage.tsx` / `bookings.ts` / `email.ts`)
- ✅ PF-03 — Reschedule never re-prices (`totalPrice`/`ratePerNight`/breakfast stale after nights or room-type change), no `numGuests` vs capacity check, no guest notification (`handleRescheduleBooking`)

**SEV-3:**
- ✅ PF-04 — Guest availability endpoint ignores active `roomBlocks` → dead-end UX when all rooms of a type are blocked (`rooms.ts`)
- ✅ PF-05 — Walk-in `@example.invalid` placeholder emails hard-bounce through Resend (sender-reputation risk) — add a shared skip guard in `sendEmail`
- ✅ PF-06 — Early check-in `requestedCheckInTime` / `notes` / `staffNote` persisted without Zod validation (type/length)
- ✅ PF-07 — `guest-app/package.json` has no `test` script, so `npm test --workspaces` silently skips its 298 tests

**SEV-4 (polish):**
- ✅ PF-08 — `CalendarPage` "today" uses UTC instead of `config.timezone` (window starts on yesterday before 8 AM Manila)
- ✅ PF-09 — Seasonal overrides saved as whole-array writes (concurrent-edit clobber); toggle/delete lack error handling (`RatesPage.tsx`)
- ✅ PF-10 — `earlyCheckinResolveEmail` missing from the email preview switch — the one guest email staff cannot preview
- ✅ PF-11 — Intercom `?room=` deep-link clears the param before `intercomThreads` loads → resolved-thread filter switch can be skipped (`IntercomInboxPage.tsx`)

### Manual QA Audit — 2026-07-09 (fixes to close)

> Source: `0709 Spark-Inn-Manual-Test-Cases.xlsx` manual QA pass (Guest App Tests, Admin App Tests, Other Bugs Found tabs). 6 rows marked "Fail" in Guest App Tests + 6 "Bug" entries in Other Bugs Found were triaged against `dev`. 3 were already fixed before the test ran (H-03b homepage date defaults per `cb13846d`, B-07 voucher lookup per `3501633`/P2, B-10c Senior/PWD ID upload per `a2fa020`/P1 — verified in code, not just re-tested). The items below are confirmed still open or unverified, ordered from lowest to highest estimated effort.

**Low Effort:**
- ✅ **QA-03 (Other Bugs #15)** — Admin voucher modal only accepts one character at a time in text inputs. Root cause: `Modal.tsx`'s `DesktopModalPanel`/`MobileModalPanel` call `useFocusTrap(true, onClose)`, and `RatesPage.tsx` passes `onClose={() => setIsVchModalOpen(false)}` as an inline arrow function. Every keystroke updates `vchCode` state → `RatesPage` re-renders → a new `onClose` reference is created → `useFocusTrap`'s effect (dependency `[active, onEscape]`) re-fires → it re-queries focusable elements and calls `.focus()` on the first one in DOM order, which is the modal's close (X) button, not the field being typed in — stealing focus after every character. Fix: memoize the `onClose` callback passed to `Modal` (e.g. `useCallback`) wherever a modal wraps a controlled text input, or have `useFocusTrap` only set initial focus once (e.g. track with a ref) instead of on every effect re-run. Likely affects other admin modals with local input state, not just vouchers — worth a sweep.
- ✅ **QA-07 (Other Bugs #10)** — Booking Step 2 guest logo reportedly misaligned (desktop). `BookingHeader` is shared across all booking steps, so a defect specific to "Step 2" is unclear from JSX alone — needs a visual check.
- ✅ **QA-06 (Other Bugs #9)** — Booking Step 2 → Step 1 back button reportedly doesn't work. `getBackToPath()` in `BookingPage.tsx` builds a step-aware URL (`continueParams` preserves room/dates/guests) and looks correct by inspection — no defect found. Needs a live retest; may have been a one-off.

**Medium Effort:**
- ✅ **QA-02 (H-06)** — Featured Room cards on the homepage aren't clickable. `HomePage.tsx` renders `<RoomCard>` in the "Stay with us" section without an `onDetails` handler, and `RoomCard.tsx` has no card-level `onClick`/`<Link>` wrapper — only the "Book" button (and "Details" button, when passed) are interactive. Fix: wrap the card body in a link to the room/rooms page, or pass `onDetails` on the homepage the way `RoomsPage` presumably does.
- ✅ **QA-01 (H-04)** — Past-date selection isn't reliably blocked. `DateRangePicker.tsx` relies only on the native `<input type="date" min=...>` HTML attribute; there's no `onChange` guard rejecting an out-of-range value (some mobile browsers allow typing/scrolling past `min`), and `handleCreateBooking`/`handleCreateWalkin` in `guest-app/server/handlers/bookings.ts` never re-validates that `checkIn` is not in the past server-side either. Fix: add a client-side check that clamps/rejects a past `checkIn`, and add a server-side date guard as defense in depth.
- ✅ **QA-05 (Other Bugs #2, #3)** — "Book Your Stay" hero button overlaps the check-in/availability search card (High on desktop, slight on mobile). `HomePage.tsx`'s hero section is `min-h-screen` with vertically centered content and `pb-32` under the CTA buttons; the search card section directly below pulls up with `-mt-20`. On short viewports (e.g. laptop with browser chrome) this combination could plausibly collide, but it wasn't confirmed by static inspection. Needs a rendered check across common desktop/laptop heights.
- ✅ **QA-08 (Other Bugs #13)** — Guest didn't receive a booking confirmation email. `handleCreateBooking` correctly calls `sendBookingTrigger("booking-submitted", ...)` with try/catch around the Resend call (errors are logged, not swallowed silently pre-log). Code path looks correctly wired — this is more likely a deliverability issue (Resend domain verification, spam filtering) than an application bug, but can't be ruled out without checking Resend send logs for that booking.

- ✅ **QA-04 (B-10)** — Payment/receipt screenshot upload reportedly hangs on "Uploading" on mobile with no error shown; desktop shows "Failed to upload"; non-image files can't be selected on either. Fixed by hardening `compressImageFile` in `shared/utils/images.ts` to use a safe FileReader/DataURL fallback if compression or canvas fails, and showing clear errors in booking page.

**Already fixed, sheet was right:** Other Bugs Found row #12 (price breakdown for mixed weekday/weekend/holiday rates) is marked `Fixed? = Y` in the test sheet. At the start of this audit this roadmap still showed P5 as not started, but P5 ("Guest-facing price breakdown for mixed regular/weekend/holiday rates") was completed and marked ✅ above during this same session — no action needed, confirmed consistent.

### Finance & Reports Audit — 2026-07-11 (gaps to close)

> Finance/audit review of Reports & Metrics: can the hotel properly
> account for booking income? Full findings (`FIN-01`..`FIN-12`),
> severities, and fix guidance:
> `plan/project/AUDIT-FINANCE-REPORTS-2026-07-11.md`. No SEV-1s — billed
> revenue is computed correctly — but the reports only cover the accrual
> side; actual cash movement (`bookings/{id}/payments`) is invisible to
> every report. Build in the order listed.

**SEV-2 (build first):**
- ✅ **FIN-01 — Collections (cash-basis) report** — new Sales section reading `bookings/{id}/payments` for the period, grouped by day / method / staff, with a billed-vs-collected-vs-outstanding reconciliation line (`ReportsPage.tsx`)
- ✅ **FIN-02 — Payment-method breakdown from actual payments** — current pie attributes full `totalPrice` to the booking-time `paymentMethod` even if the guest paid differently or not at all (`ReportsPage.tsx:234`); drive it from payment entries, split Add-to-Bill collected vs uncollected
- ✅ **FIN-03 — Refund model** — refund entry (signed amount or `type: "refund"`) with `reason` + `approvedBy` on the payments subcollection; surface in drawer + collections report; "cancelled bookings with money collected" view (today a cancelled booking's collected deposit vanishes from all reports)
- ✅ **FIN-04 — Receivables report** — aged unpaid balances on checked-out bookings, uncollected Add-to-Bill store charges, and a minimal corporate charge-back invoice record (corporate AR is entirely untracked today)

**SEV-3:**
- ✅ **FIN-05 — Discounts & adjustments report** — gross→net revenue bridge (senior/PWD for RA 9994/10754 tax deduction claims, vouchers, points) + outstanding-points liability
- ✅ **FIN-06 — BIR/VAT scope decision** — calculated client-side on reports/exports, no OR/invoice printing (BIR manual OR booklets fallback); decision logged in `plan/docs/DECISIONS-FEATURES.md`
- ✅ **FIN-07 — Daily Close view** — payments recorded today by method and `recordedBy` for drawer/GCash handover reconciliation (falls out of FIN-01)
- ✅ **FIN-08 — Export column alignment** — Sales XLSX Bookings sheet missing spec'd Breakfast/Discount/Voucher columns; Total Collected / Outstanding only exist in the admin-only Full Backup, not the date-ranged exports
- ✅ **FIN-13 — Drawer count + cash variance in Daily Close** — per-method counted-amount entry (cash drawer, GCash balance) vs recorded payments, persisted as an append-only daily close record with variance line; build together with FIN-07, not after
- ✅ **FIN-14 — Incidental charge ledger** — `bookings/{id}/charges` append-only subcollection + drawer "Add charge" form + folio/receipt/report/export wiring; build before or with FIN-01 so the billed side of the reconciliation is complete (full item under Phase 12 list above; spec in `BOOKINGS-MANAGEMENT.md`)

**SEV-4 (polish):**
- ✅ **FIN-09 — Revenue recognition quirks** — whole booking check-in bias resolved via overlap proration; unpaid future bookings excluded
- ✅ **FIN-10 — Occupancy night-clipping** — occupancy night count clipped to range boundaries; overlapping stays resolved
- ✅ **FIN-11 — Hotel finance KPIs** — ADR, RevPAR, and revenue by room type split chart implemented in reports
- ✅ **FIN-12 — Prior-period comparison** — vs-previous-period delta badges rendered on all revenue and booking KPI cards

**Scoped out by decision (recorded in the audit doc §Scope boundaries — do not re-open without owner request):**
- ⏸ Expenses & P&L tracking — out of scope; system is a PMS, not accounting software; exports feed external bookkeeping/BIR
- ⏸ Day-locking / night-audit snapshots — deferred at 14-room scale; payments are already append-only at the rules level, which covers the cash side; revisit if historical figures drift or staff grows

### Reports reconciliation hardening — 2026-07-12 (post-FIN review, branch `fix/reports-finance-audit-batch`)

> Follow-up correctness pass after the FIN-01..FIN-14 finance suite shipped:
> re-read the Reports data wiring and found four defects that could mislead the
> owner during a cash count. All four fixed; pure logic extracted to
> `admin-app/src/utils/finance.ts` and unit-tested (`reports-finance-audit-batch.test.ts`).

- ✅ **FR-01 — Day-boundary mismatch** — "Collections by day" grouped payments by UTC date while Daily Close grouped by local date, so a payment after midnight Manila landed on different days in the two views. Both now use `dateKeyInTimeZone(date, config.timezone)`; Daily Close also no longer depends on the admin's browser timezone.
- ✅ **FR-02 — Daily Close mis-bucketed unknown tenders as cash** — the bucketer defaulted any method that wasn't gcash/bank/card/paypal into the cash drawer, so a custom method or the ambiguous "pay-at-hotel" intent inflated expected cash and faked a variance. Added a shared `normalizePaymentMethodBucket` + an **Other** reconciliation row (recorded/counted/variance + historical-close totals). `pay-at-hotel` is now excluded from the onsite tender selector (it's a booking intent, not a settled tender), and **Cash is guaranteed selectable** for onsite payments/refunds without adding it to the guest-facing `paymentMethods` config (so it can never leak into the online payment options). Decision on the owner's "seed a Cash method?" question: guarantee Cash in the admin onsite selector rather than seed it into shared config.
- ✅ **FR-03 — Staff UIDs shown raw** — "Collections by staff" and the Daily Close ledger rendered Firebase UIDs; now resolved to names via `staffNameMap` (falls back to the raw value for legacy "staff" entries).
- ✅ **FR-04 — `payment-confirmed` skewed reconciliation** — its payments counted in Collected but the booking was excluded from Billed (revenue statuses started at `confirmed`), so paid-but-not-yet-confirmed money showed as phantom "over-collected". `payment-confirmed` is now revenue-eligible, matching the Receivables report which already counted it.
- ✅ **FR-05 (efficiency)** — the payments/charges `collectionGroup` listeners used to re-subscribe on every `bookings` change (dep `[bookings]`), re-reading the full ledger each time → avoidable Firestore reads on the client's Blaze plan. Now they store raw rows and depend only on `[toast]`; booking ref/room/guest are joined in a `bookingDisplayById` memo, so the enriched `payments`/`charges` still update on booking or ledger changes without any Firestore re-read. No change to displayed figures.

### Finance Lifecycle Audit — fixes to close (audited 2026-07-12)

> Source: `plan/project/AUDIT-FINANCE-LIFECYCLE-2026-07-12.md` — end-to-end
> audit of the money path (booking create → payments/refunds → discounts,
> vouchers, points → check-in → incidental charges & store billing →
> checkout → Reports/exports). 20 findings `FL-01`..`FL-20`. Unlike the
> July-11 FIN audit (missing features), these are arithmetic and
> state-transition defects *inside* the shipped finance plumbing. The two
> owner-policy findings, FL-10/FL-11, are resolved in decisions #117/#118;
> the final five SEV-4 polish items are now closed.

**SEV-1 — wrong money numbers (fix first, small isolated diffs):**
- ✅ **FL-01 — Total Revenue double-counts breakfast** — fixed with proportional net allocation across disjoint room/breakfast streams; current/previous/monthly figures and ADR/RevPAR now use the split, with unit coverage.
- ✅ **FL-02 — Discount rejection drops redeemed points** — fixed by preserving redeemed points and rebuilding the locked breakdown after removing only the rejected Senior/PWD deduction.

**SEV-2:**
- ✅ **FL-03 — Staff apply-discount can zero a legacy booking** — fixed with explicit original → breakdown → stored-total fallback and rejection when no finite pricing basis exists.
- ✅ **FL-04 — Full payment emails "payment confirmed" but never advances status** — fixed by atomically writing the payment and `payment-confirmed` status; only the committed transition sends the guest email.
- ✅ **FL-05 — Direct-paid store orders invisible to payments ledger / Daily Close** — resolved with an authenticated atomic delivery transition plus one deterministic store-scoped tender. COD maps to Cash, configured direct methods retain their key, Add to Bill stays on the folio, and store revenue uses delivery time.
- ✅ **FL-06 — Reschedule wipes manual walk-in pricing** — fixed with a shared exact manual-nightly-basis helper used by server and admin preview; moves rescale by nights, preserve the manual line, explain the basis, and apply the authoritative response.
- ✅ **FL-07 — Walk-in body unvalidated server-side** — fixed with a strict full-body/nested-guest Zod schema that runs before Firestore and caps finite manual overrides at 1,000,000.

**SEV-3:**
- ✅ **FL-08 — Points redeem/undo never rebuilds `rateBreakdown`** — fixed with a shared server helper that preserves locked room/add-on lines and atomically rebuilds canonical deductions plus final total on redeem/undo.
- ✅ **FL-09 — Dead "Confirm Booking" button at `payment-confirmed`** — fixed by aligning the server allow-list with the drawer and documented state machine.
- ✅ **FL-10 — Early checkout truncates stay but keeps full price** — policy retains the contracted total; checkout now rebuilds the shortened-stay breakdown with an explicit retained-total adjustment and preserves the original departure timestamp.
- ✅ **FL-11 — Points awarded regardless of payment; balance gate client-only** — checkout now snapshots the charge-inclusive unpaid balance and defers a locked room/breakfast points award until the final payment consumes it exactly once.
- ✅ **FL-12 — Dashboard revenue excludes `payment-confirmed`** — fixed by aligning the Dashboard status filter and help text with Reports.
- ✅ **FL-13 — Billed vs Collected period-basis mismatch** — fixed with a shared to-date folio snapshot: selected booking folios and direct store orders use matching billed and collected populations, including pre-period deposits/refunds.
- ✅ **FL-14 — No-shows with deposits invisible** — fixed by extending the retained-money surface to past `confirmed` no-shows with explicit status, gross, refund, and retained totals.
- ✅ **FL-15 — Reports period boundaries browser-local** — fixed by deriving inclusive report instants, booking overlap/proration, no-show cutoffs, and export labels from `config.timezone` calendar keys.

**SEV-4 (polish batch):**
- ✅ **FL-16 — `originalTotalPrice` conventions differ across writers** — standardized as the always-written pre-discount pricing basis; `null` is legacy-only.
- ✅ **FL-17 — Rules allow duplicate void reversals** — rules now require the deterministic `void-{voidOf}` document ID.
- ✅ **FL-18 — Incidental charges uncapped** — mirrored the ₱1M cap in Firestore rules and the admin form.
- ✅ **FL-19 — `add-payment` lacks idempotency key** — client preallocates the payment document ID; the transaction creates it exactly once and safely replays matching retries.
- ✅ **FL-20 — Receipt fallback folds member discount into Senior/PWD line** — government and member deductions are calculated and displayed separately.

### Finance Lifecycle Recommendations — post-remediation follow-ups (2026-07-14)

> Source: `plan/project/AUDIT-FINANCE-LIFECYCLE-2026-07-12.md
> §Post-remediation recommendations` — added after all 20 FL findings were
> verified fixed (8 batches merged, 1,096 tests green). The FL fixes are
> forward-only and two structural risks sit outside the FL scope; these
> five items close the remainder. `FLR-01`/`FLR-02` are the actionable
> ones; `FLR-03` is a deliberate deferral with an explicit trigger;
> `FLR-05` is owner-facing handover work, not code.

- ✅ **FLR-01 — Historical finance data repair (one-off integrity scan)** — fixed 2026-07-14. `scripts/finance-integrity-scan.ts` provides review-first CSV output, guarded transactionally revalidated apply mode, append-only ledger repair, and Admin-only repair audit records. The owner-approved run appended the single missing pre-FL-05 ₱1,500 `delivery-tender`; a fresh read-only scan of 6 bookings + 1 store order returned zero findings.
- ✅ **FLR-02 — `bookings` update rule field allowlist** — fixed 2026-07-14. Firestore now allows only the enumerated low-risk operational fields; `status`, all pricing/rate fields, and rewards fields are excluded. Uploaded-payment verification moved to authenticated transactional `/api/bookings/mark-payment-confirmed`, and server-returned finance payloads are no longer persisted back through the client.
- ⏸ **FLR-03 — Bound the Reports ledger listeners** *(deferred with trigger)* — `collectionGroup("payments"/"charges")` listeners load the entire ledger history live on every Reports visit; fine at 14 rooms, linear growth forever on Blaze. **Trigger: revisit when the combined ledger passes a few thousand rows (~1 year of operation)** — switch to `recordedAt`-bounded queries; all-time Receivables can fall back to one-shot `getDocs`.
- ✅ **FLR-04 — Shared finance invariant assertions in tests** — fixed 2026-07-14. `assertBookingFinanceInvariant` rejects non-finite values and reconciles room lines → room subtotal → add-ons/deductions → `finalTotal` → `totalPrice`; `assertRevenueFinanceInvariant` reconciles all four report revenue categories and rejects ledger IDs shared across revenue/tender/receivable streams. Behavioral pricing-writer and Reports fixture tests now call the shared assertions, with dedicated failure-case coverage for every drift class.
- 🔄 **FLR-05 — Operational handover items** *(owner-facing, no code)* — handover prepared in `FINANCE-LIFECYCLE-HANDOVER-2026-07-14.md`. The historical Daily Close convention is documented without editing locked closes, and the accountant VAT review plus isolated-staging money-path walkthrough now have explicit checklists/evidence records. **Remaining:** accountant confirmation and owner walkthrough/sign-off before the next `dev → main` milestone merge.

### Production Environment Split — cutover queue (added 2026-07-14)

> Source: `plan/project/PROD-CUTOVER-RUNBOOK.md` — demote the current
> Firebase project `spark-inn-stg-7a7ad` (serving the live site today) to
> the **staging** database, stand up a Vercel staging environment on the
> `dev` branch at `stg.sparkinnbohol.com` / `stg-admin.sparkinnbohol.com`,
> and cut production over to the clean-slate `spark-inn-prod` project.
> The runbook holds the full step-level checklists, the prod client
> config, and the secret-handling rules for the service-account key
> (never committed). PC-01..PC-04 are non-destructive; nothing
> user-visible changes until the PC-06 env-var flip. The **open
> decision** for PC-05 (bookings carry-over vs. clean slate) is resolved
> (clean slate only; only staff accounts pre-provisioned) — recorded in `DECISIONS-FEATURES.md` (Decision #119).

- ✅ **PC-01 — Repo configuration split** — done 2026-07-14: `.firebaserc` `production` alias + per-project storage targets (staging stays default), `firebase.json` on the `app` target, all four Admin-SDK scripts confirmed env-parameterized with local `.env.spark-inn-{stg,prod}` swap files, ENV-SETUP.md environment matrix + stale var cleanup.
- ✅ **PC-02 — Provision `spark-inn-prod`** — done 2026-07-14: rules + 6 indexes + storage rules **deployed and verified matching repo**; Storage CORS applied; region US-EAST1 confirmed; API key restricted; budget alert, Auth providers, and authorized domains set (owner console); **disaster recovery verified live: PITR enabled + weekly backups (14-week retention) + delete protection on**.
- ✅ **PC-03 — Seed production data** — done 2026-07-14: settings docs + 14 rooms **copied verbatim** (doc IDs + `qrToken`s preserved — printed QR codes survive); **22 branding assets copied to the prod bucket with all 5 staging-bucket URLs rewritten and re-scan showing zero leaks**; staff accounts recreated; integrity scan zero findings. Test data intentionally not carried (storeItems, vouchers, corporate codes/inquiries — extends decision #119); room photos + payment QRs never existed and are a post-cutover owner upload.
- ✅ **PC-04 — Vercel environment split** — done 2026-07-14: Production/Preview scopes and `stg.`/`stg-admin.` domains configured in Vercel, Resend email isolation applied, staging Auth authorized domains and Turnstile domains added, and staging verified end-to-end.
- ⬜ **PC-05 — Archive + data carry-over** — Full Backup XLSX + `gcloud firestore export` archive, then recreate active staff accounts in production Auth/Firestore.
- ⬜ **PC-06 — Cutover + smoke test** — freeze window, Production redeploy, preflight, end-to-end smoke booking on prod (then cancel/refund), email triggers, integrity scan, rules verification, QR spot-check, local key file deleted, first real Daily Close.

### Contract Compliance — Schedule A review (2026-07-11)

> Source: review of the signed Software Development Agreement + Schedule A
> (June 23, 2026) against the codebase. SA-01 was the single line item not
> matching the letter of the spec; it shipped 2026-07-12, so **Schedule A
> Parts 1–3 coverage is now 100%** ahead of the Final Delivery / acceptance
> review.
>
> The same review found ~40 features delivered *beyond* Schedule A at no
> charge — itemized in `plan/project/GOODWILL-SCOPE-LOG.md` (with
> maintenance rules: log new extras there, or quote them as Part 4 change
> requests). The FIN-05..FIN-13 queue has since shipped (2026-07-11/12) and
> is recorded there as delivered goodwill; the queue is now empty.

- ✅ **SA-01 — Reports: performance report PDF export must use jsPDF** — jsPDF + html2canvas client-side PDF export implemented on the reports workspace, providing pixel-perfect multi-page report downloads of active tab stat cards and Recharts graphics.

### Live Bug Reports — 2026-07-09 (guest Intercom, reported directly by owner on mobile)

> Reported by DK from a live mobile session on `sparkinnbohol.com`, not from the test sheet. Not yet fixed — code-inspected for root cause only, no changes made per request.

- ✅ **QA-09 — No way to end a call on mobile in the guest Intercom view.** Fixed by moving the guest Intercom shell to `100dvh` and adding safe-area-aware padding to the active-call overlay so the End Call control stays reachable.
- ✅ **QA-10 — No ringtone plays on the front desk (admin) when a guest calls in.** Resolved by adding global interaction audio-unlock event listeners to AdminContext and generating a looping, warbling electronic ringtone (853Hz & 960Hz) every 3 seconds while incomingCall.status === "ringing".
- ✅ **QA-11 — Guest Intercom view scrolls as a whole page instead of only the message list.** Fixed by giving the outer guest Intercom shell a fixed dynamic viewport height, keeping the existing message list as the internal scroll region.
- ✅ **QA-12 — Incoming call *and* incoming message should pop up on every admin page, not just Intercom Inbox.** Fixed by hoisting compact call/message popups into `AdminLayout.tsx`, reusing global `incomingCall` and `intercoms` state. Calls expose Accept/Decline/End actions; messages show room, guest, preview, Open, Read, and dismiss actions. Popups are suppressed on `/intercom` to avoid duplicating the Inbox banner/thread UI.
- ✅ **QA-13 — Incoming Intercom *message* notification sound should be more emphasized.** Fixed by strengthening the global Web Audio message tone in `AdminContext.tsx` from a short two-blip cue to a louder four-note repeated cue, paired with the new layout-level message popup from QA-12.
- ✅ **QA-14 — Mobile pages appear zoomed in by default, and the keyboard triggers further zoom on text input focus.** Fixed with a mobile-only form-control font-size floor in both apps, preserving pinch zoom and avoiding the inaccessible `user-scalable=no` workaround.
- ✅ **QA-15 — Show guest / check-in details inside the Intercom thread so front desk knows who they're talking to.** Fixed by cross-referencing active bookings by selected room in `IntercomInboxPage.tsx` and rendering guest name, booking ref, stay dates, status, and notes/special requests in `IntercomChatPanel.tsx`.
- ✅ **QA-16 — QR Management: "Unable to download the QR image. Please try again."** Fixed by replacing the SVG blob → `Image()` decode path with a canvas-native `QRCodeCanvas` render for PNG export.
- ✅ **QA-17 — Guest Intercom should remember the guest's name across reloads instead of re-asking every time.** Closed as obsolete/replaced by `QA-20` (stay-scoped Intercom verification & caching).
- ✅ **QA-18 — Room transfer / room-type upgrade end-to-end workflow.** Fixed by allowing `"checked-in"` rescheduling, syncing room statuses in reschedule transaction, rendering Move Room form with price delta.
- ✅ **QA-19 — Number of guests text field icon overlaps input border.** Fixed by making the icon/input wrapper block-level in both standard and corporate booking forms.
- ✅ **QA-20 — Guest Intercom access guard for checked-out / wrong-guest access.** Fixed with the planned three-layer guard: guest Intercom now requires `rooms.status === "occupied"`, replaces the free-text name prompt with last-name verification through `POST /api/intercom/verify-guest`, caches verified sessions against the current booking id, and stamps/filters Intercom messages by `currentStayId` so old stay messages do not appear to the next verified guest.
- ✅ **QA-21 — Guest Intercom header/tabs UI polish.** Fixed by rendering the resolved room number in the avatar badge and replacing thin underline tabs with larger filled app-style tab buttons.
- ✅ **QA-22 — Dashboard "Today's Breakfast Prep" section.** Fixed by adding a dedicated breakfast list section to the admin dashboard on the left column displaying today's menu selections, with served count indicators and real-time interactive "Served" toggle persisting to `Booking.breakfastServed`.
- ✅ **QA-23 — Per-payment-method "Require reference number" toggle.** Added `requireReferenceNumber` configuration with Admin settings editor toggle, wired Step 3 inputs in guest booking, validated client/server-side, saved to bookings, rendered always-editable input in staff drawer, and added Payment Method + Reference Number to exports.
- ✅ **QA-24 — Custom date range for Reports & Metrics.** Fixed by adding a "Custom Range" selection option to the Reports selector, revealing native start/end date inputs, validating that end >= start, and ensuring all charts, tables, and CSV/XLSX exports respect the custom period.
- ✅ **QA-25 — Wrong logo variant on the dark email header.** Fixed by switching transactional email headers to the white logo variant used for dark backgrounds.
- ✅ **QA-26 — Admin Intercom Inbox should auto-scroll to the latest message on load.** Fixed by wiring the existing bottom message ref to scroll when the active room or message list changes.

---

## Progress Summary

| Phase | Items | Done | Remaining |
|---|---|---|---|
| 0 — Foundation | 41 | 41 | 0 |
| 0.5 — Wireframe Pass | 60 | 60 | 0 |
| 1 — Guest Shell & Static | 12 | 12 | 0 |
| 2 — Admin Shell & Auth | 6 | 6 | 0 |
| 3 — Room System | 5 | 5 | 0 |
| 4 — Booking Flow | 11 | 11 | 0 |
| 5 — Admin Bookings | 8 | 8 | 0 |
| 6 — Email System | 10 | 10 | 0 |
| 7 — Corporate & Vouchers | 12 | 12 | 0 |
| 8 — Intercom | 29 | 19 | 10 (manual E2E QA — see checklist) |
| 9 — Remaining Features | 6 | 6 | 0 |
| 10 — Security & Polish | 12 | 7 | 5 (operational/QA) |
| 10B — Spark Rewards | 14 | 13 | 1 (operational — Firebase Auth Google provider) |
| 11 — Staging & Launch | 16 | 2 | 14 (operational) |
| 11.5 — Audit Fixes & Launch-Readiness | 50 | 50 | 0 (decisions documented, unimplemented) | 14 (Wave 1) + 15 (Wave 2) + 1 (Wave 3, consolidated) + 2 (Wave 4 incl. W4.4) + 2 launch-gates (S5.2 Staff Accounts tab, S7.1 Booking Receipt PDF) + 1 SEV-1 (S2.3 RA 10173 erasure) + 4 polish SEV-1s (S1.4 self-cancel guard, S6.1 Google Maps CSP, S5.1 NaN% guard, S5.3 live chart) + 1 SEV-1 + 1 SEV-3 (W2.9 mute toggle, S2.4 enroll wiring) + 2 SEV-1s (S1.5 server-authoritative isCorporate, S4.1 ratePerRoomType client path) + 1 SEV-1 (S4.2 convert-to-booking flow) + 1 SEV-3 (W4.4 8 email templates) + 1 SEV-2 (S6.2 settings-driven public content) + 1 launch-gate SEV-2 (Rewards tab full rewardsConfig write) + 1 launch-gate SEV-2 (BookingConfirmPage Add to Calendar) + 1 SEV-1 (#84 checkIn/checkOut always Timestamp) + 2 SEV-2s (#78 room block structured, #80 store stock on confirmed) + 2 (#75 includedInRoomRate dropped, #76 contact form wired) + 2 (#83 cron reminderSentAt, #100 corporate no-promo) + 6 (Wave 3 W3.1-W3.6) + 6 (Wave 3 W3.7-W3.12) + 2 (Wave 4 W4.2 Vite OG + W4.3 WHITE-LABEL.md). **All 50 audit items shipped.** |
| 11.7 — Admin Mobile UX | 30 | 29 | 1 (P3 manual QA matrix — device testing) |
| 11.8 — Public Content Editability | 4 (open questions) + ~100 (3 PRs) | 0 → **PR 1 (4 fields) shipped** → **PR 3 (7 fields) shipped** → **PR 2 (deferred post-launch)** | ~35 fields + 4 Qs to close with owner (Q1 deferred until owner demo — homepage eyebrow ships with `config.tagline` fallback; Q2/Q3/Q4 deferred to PR 2 + Phase 12) |
| 12 — Post-Launch | 18 | 14 | 4 (3 deferred + booking drawer UX refactor planned) |
| Finance & Reports Audit (July 11) | 14 | 14 | 0 (FIN-01..FIN-14 fixed + 2 scoped-out decisions — see `AUDIT-FINANCE-REPORTS-2026-07-11.md`) |
| Finance Lifecycle Audit (July 12) | 20 | 20 | 0 (all FL-01..FL-20 findings fixed — see `AUDIT-FINANCE-LIFECYCLE-2026-07-12.md`) |
| Finance Lifecycle Recommendations (July 14) | 5 | 3 | 2 (FLR-01/FLR-02/FLR-04 fixed; FLR-03 deferred, FLR-05 open) |
| Production Environment Split (July 14) | 6 | 0 | 6 (PC-01..PC-06 open, PC-02 in progress; 1 decision blocks PC-05 — see `PROD-CUTOVER-RUNBOOK.md`) |
| Audit Fixes (June 10) | 21 | 21 | 0 |
| Audit Fixes (June 11) | 16 | 16 | 0 |
| **Total** | **396** | **363** | **~133** |

*Phase 11.5 is now 50/50 implemented. The audit is fully shipped on dev. 5 SEV-1 fixes from Launch-Readiness + 6 from Batch 1 + 5 from Batch 2 + 1 launch-gate (S5.2) from Batch 3 + 1 launch-gate (S7.1) from Batch 4 + 1 SEV-1 (S2.3) from Batch 5 + 4 polish SEV-1s from Batch 6 + 1 SEV-1 + 1 SEV-3 from Batch 7 + 2 SEV-1s from Batch 8 + 1 SEV-1 (S4.2) from Batch 9 + 1 SEV-3 (W4.4 8 email templates) from Batch 10 + 1 SEV-2 (S6.2 settings-driven public content) from Batch 11 + 1 launch-gate SEV-2 (Rewards tab full rewardsConfig write) from Batch 12 + 1 launch-gate SEV-2 (BookingConfirmPage Add to Calendar) from Batch 13 + 1 SEV-1 (#84 checkIn/checkOut always Timestamp) from Batch 14 + 2 SEV-2s (#78 + #80) from Batch 15 + 2 (#75 + #76) from Batch 16 + 2 (#83 + #100) from Batch 17 + 6 (Wave 3 batch 1) from Batch 18 + 6 (Wave 3 batch 2) from Batch 19 + 2 (Wave 4) from Batch 20 are shipped. 0 decisions remain unimplemented. The total (329) is unchanged from Batch 10 (the Batch 11–20 SEV-2/SEV-1s were already counted in the 50-item Phase 11.5 inventory).*

*Phase 11.7 (Admin Mobile UX) is now 29/30 shipped on `dev` at v0.90.0. The 1 remaining item is the manual QA matrix (18 screens × 6 breakpoints) plus real-device testing — requires a browser/device, deferred to P3 post-staging. P0 (foundations, Drawer/Modal/Toast, DataTable mobile card view), P1 (Bookings, Intercom, Settings, Bottom tab bar) and P2 (focus trap, ARIA, prefers-reduced-motion) are all done. 9 commits, 9 new test files, 94 new tests, 342/342 total tests passing, build clean. Decision #107 is **Implemented**.*

*Phase 11.8 (Public Content Editability) is now opened on `dev`. Source audit: `plan/project/AUDIT-PUBLIC-CONTENT-2026-07-01.md`. The audit inventoried every public-app string into 4 tiers (A: make dynamic, B: keep hardcoded, C: keep in `hotel.config.ts`, D: defer to Phase 2). Tier A splits into 3 implementation PRs (~100 new fields total, ~4 days work). Tier B/C/D are explicitly deferred with reasons recorded. 4 open questions need to be closed with the hotel owner during the staging review (Q1 custom tagline/brand promise, Q2 booking-flow copy, Q3 per-trigger email templates, Q4 Rewards "Member Privileges" cards). Implementation starts after staging; no fields ship until Q1-Q4 are answered.*

---

*Update the progress table when completing a phase.*
*Commit message: `docs: update ROADMAP.md`*
