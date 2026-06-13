# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: June 13, 2026 (closed AUDIT-35 booking transaction documentation alignment; added Phase 8 follow-up gaps)
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
- ⬜ Email: payment confirmed
- ⬜ Email: booking confirmed
- ⬜ Email: check-in reminder (scheduled — cron or trigger)
- ✅ Email: booking cancelled
- ⬜ Email: new corporate inquiry (to staff)
- ⬜ Email branding — logo, primary color, hotel name from config

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

- 🔄 Guest Intercom page (`/intercom/:roomId`) — chat UI, quick requests, name prompt, Shop tab
- 🔄 Intercom Inbox (admin) — chat list, thread view, reply, mark resolved, store order cards
- ✅ Intercom resolved flow — Active/Resolved tabs, room-level resolved flag, reopen action
- 🔄 WebRTC voice signaling — Firestore `calls` offer/answer status, ICE exchange, accept/decline/hang up flow
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

- ⬜ Spark Essentials — live catalog CRUD in Admin Settings → Store tab; guest store already reads live `storeItems`, but admin catalog editing must persist to Firestore before launch
- ⬜ Spark Essentials — store GCash QR/account info management in Admin Settings; guest checkout already consumes `settings/storeConfig.paymentMethods[].qrUrl/accountInfo`
- ⬜ Intercom Inbox — render guest store order messages as rich order cards with item/total/payment summary and a link to Store Management
- ⬜ Intercom Inbox — verify incoming call notification sound and active-call banner behavior in real browsers
- ⬜ Guest Intercom — decide whether unread pulse and long-thread pagination are launch requirements or Phase 10 polish
- ⬜ Phase 8 manual QA — end-to-end QR scan → guest chat → admin reply → voice call → store order → status update → cancellation/billing across desktop and mobile browsers

---

## Phase 9 — Remaining Features (P1)
> Goal: All P1 features complete before launch prep.

- ⬜ Booking Lookup page (`/my-booking`) — ref + email lookup, cancel, resend email
- ⬜ Reports page — occupancy, revenue, bookings by source, PDF/CSV export
- ⬜ Settings page — all 9 tabs (Hotel Info, Payment Methods, Email, Staff Accounts, Discounts, Vouchers, Intercom, Website Content, Legal Content)
- ✅ Guest registration data capture wireframe — booking drawer at check-in
- ⬜ Guest Registration PDF (jsPDF) — pre-filled from booking, printable at check-in

---

## Phase 10 — Security & Polish
> Goal: Security rules finalized, performance verified, ready for staging.

- ⬜ Firestore security rules — final version, tested in emulator
- ⬜ Firebase Storage rules — final version, payment proof restricted to staff
- ⬜ API rate limiting — all public endpoints
- ⬜ Cloudflare Turnstile — wired into booking creation + corporate inquiry form
- ⬜ Honeypot fields — booking form + corporate inquiry form
- ⬜ `FIREBASE_PRIVATE_KEY` newline handling verified in Admin SDK init
- ⬜ Firebase API key domain restriction set in Firebase Console
- ⬜ Performance audit — guest site < 3s on 4G mobile, dashboard < 2s
- ⬜ Cross-browser QA — Chrome, Safari, Firefox
- ⬜ Mobile QA — iOS Safari, Android Chrome (375px)

---

## Phase 10B — Spark Rewards (P1)
> Goal: Guest auth + member portal working. Loyalty rules deferred to Phase 2.

- ⬜ Firebase Auth — Google Sign-In provider enabled in Firebase Console
- ⬜ Guest auth context — `onAuthStateChanged`, separate from admin auth
- ⬜ Sign-in page (`/signin`) — Google + email/password
- ⬜ Sign-up page (`/signup`) — Google + email/password + profile fields
- ⬜ Forgot password flow
- ⬜ Navbar — member state (logged in/out), dropdown menu
- ⬜ Spark Rewards landing page (`/rewards`) — program overview + enroll CTA
- ⬜ Member registration — post-booking Step 4 prompt + standalone
- ⬜ Past booking linkage by email on registration
- ⬜ Member portal — My Profile (`/account/profile`)
- ⬜ Member portal — My Stays (`/account/stays`)
- ⬜ Member portal — My Rewards (`/account/rewards`) — points balance + history + early check-in request
- ⬜ Admin — Members management page (list, detail drawer, manual points adjustment)
- ⬜ Firestore rules for `members/` collection

---

## Phase 11 — Staging & Launch
> Goal: Client review on staging, then production launch.

### Staging (25% payment milestone)
- ⬜ `dev` branch merged to `main` at `v0.9.0`
- ⬜ Staging URLs live and shared with client
- ⬜ Client review session — bookings, dashboard, intercom
- ⬜ Feedback collected and addressed
- ⬜ Firestore rules tested with real client data

### Production Launch
- ⬜ Domain `sparkinnbohol.com` purchased and configured
- ⬜ Vercel custom domains set (`www.sparkinnbohol.com`, `admin.sparkinnbohol.com`)
- ⬜ VERSION bumped to `v1.0.0` via `release:` commit
- ⬜ Final `dev` → `main` merge
- ⬜ All 14 rooms seeded with real data + photos
- ⬜ Hotel config + website content finalized by client
- ⬜ First admin account created for hotel owner
- ⬜ Client training session (booking management, settings, intercom)
- ⬜ Deployment confirmed live on both domains

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

- ⬜ **[AUDIT-6]** Add `api/handlers/members.ts` and define `/api/members/register`, `/api/members/redeem-points`, `/api/members/undo-redemption` in API-ROUTES.md
- ⬜ **[AUDIT-6b]** Add `api/handlers/store.ts` and define `/api/store/create-order` in API-ROUTES.md
- ⬜ **[AUDIT-6c]** Add `api/handlers/admin.ts` and define `/api/admin/create-staff`, `/api/admin/disable-staff` in API-ROUTES.md
- ✅ **[AUDIT-7]** Add `isEarlyCheckInRequest?: boolean` to `IntercomMessage` type in `TYPES.md` and `BACKEND.md §intercoms`
- ⬜ **[AUDIT-8]** Decide on `SparkRewardsPromo.perks` field — add to type in `TYPES.md` and schema in `BACKEND.md §settings/websiteContent`

### 🟡 Fix before Phase 10 — Security & Polish

- ⬜ **[AUDIT-9]** Add `VITE_SENTRY_DSN=` to both app sections in `ENV-SETUP.md`
- ⬜ **[AUDIT-10]** Add `html2canvas` to the stack table in `CLAUDE.md` and `DECISIONS-ARCH.md`
- ⬜ **[AUDIT-11]** Decide and document check-in reminder mechanism in `EMAIL-PDF-STORAGE.md` (recommend Vercel cron); add `vercel.json` cron entry spec
- ⬜ **[AUDIT-12]** Create `vercel.json` at repo root with CSP headers, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; document in `FILE-STRUCTURE.md`

### 🟢 Anytime — Doc polish

- ⬜ **[AUDIT-13]** Add `corporate-codes.ts` to `FILE-STRUCTURE.md §shared/utils/`; add as U-6 test in `DECISIONS-ARCH.md §Testing Strategy`
- ⬜ **[AUDIT-14]** Add `images.ts` to `FILE-STRUCTURE.md §shared/utils/`
- ⬜ **[AUDIT-16]** Add PWA icons (192×192 + 512×512 PNG) to `FILE-STRUCTURE.md §public/brand/` and `WHITE-LABEL.md §Asset Checklist`
- ⬜ **[AUDIT-17]** Fix duplicate tab numbering in `SETTINGS.md` — Tab 10 = Store, Tab 11 = Spark Rewards, Tab 12 = Legal Content
- ⬜ **[AUDIT-18]** Fix broken reference in `REPORTS.md` — change `plan/docs/DECISIONS.md` to `plan/docs/DECISIONS-ARCH.md`
- ⬜ **[AUDIT-19]** Update ROADMAP.md Phase 10B progress — auth routes + page shells are already wired from wireframe pass; credit ~4–5 items as done

---

## Plan Audit Fixes — June 11, 2026
> Source: cross-feature flow audit of ROADMAP.md against all feature MDs — focused on connections between phases and end-to-end user flows (guest, corporate, Spark Rewards member, front desk/admin), not new features.
> Fix these before or during the phase they block. Grouped by priority.

### 🔴 Fix immediately — correctness gaps in completed phases

- ✅ **[AUDIT-35]** Resolve contradiction with `AVAILABILITY-LOCKING.md` — verified admin walk-ins already post to authenticated `/api/bookings/create-walkin`, which uses a Firestore transaction; corporate guest bookings use `/api/bookings/create`. Aligned `AVAILABILITY-LOCKING.md`, `BOOKINGS-MANAGEMENT.md`, `CORPORATE-INQUIRIES.md`, `API-ROUTES.md`, and `GOTCHAS.md` so no flow documents direct `addDoc` booking creation.
- ⬜ **[AUDIT-36]** Add a `/terms` (Terms of Service) page — required by `LEGAL.md` (booking agreement, cancellation, discount eligibility/RA 9994/RA 10754, liability, governing law clauses), linked from the footer and the Step 2 consent checkbox alongside `/privacy`. Phase 1 Static Pages only lists Privacy Policy, and the `CLAUDE.md` hard rule for the consent checkbox only references `/privacy` — both need updating
- ⬜ **[AUDIT-41]** Resolve Storage path sequencing gap — `BOOKING-FLOW.md` has the payment-proof and discount-ID photos uploaded to `bookings/{bookingId}/payment-proof/{filename}` and `bookings/{bookingId}/discount-id/{filename}` *before* booking creation, but `AVAILABILITY-LOCKING.md` generates `bookingId` only inside the `/api/bookings/create` transaction. Define how the client obtains a `bookingId` (or staging path) for these uploads ahead of booking creation
- ⬜ **[AUDIT-42]** Resolve self-contradiction in `SECURITY.md §bookings` Firestore rules — "Update: staff/admin only" implies staff can `updateDoc` directly for status transitions (Confirm Payment, check-in/out, discount verify/reject, etc., as used throughout `BOOKINGS-MANAGEMENT.md`/`DASHBOARD-OVERVIEW.md`), but the line below it states "Direct client writes to `bookings` are NOT allowed — all writes go through the API route transaction" with no carve-out for staff status updates. Clarify which operations require an API route vs. direct `updateDoc`
- ⬜ **[AUDIT-43]** Resolve corporate inquiry form architecture gap — `STATIC-PAGES.md` and `CORPORATE-INQUIRIES.md` spec a direct client `addDoc` to `corporateInquiries`, but `SECURITY.md`'s Bot & Spam Prevention section requires server-side Turnstile verification for this exact form. A direct Firestore write cannot have server-side token verification — add an `/api/corporate/inquiry` route (or equivalent) to `API-ROUTES.md` and update both feature MDs

### 🔴 Fix before Phase 9 — Remaining Features

- ⬜ **[AUDIT-20]** Add `/api/bookings/cancel` to `API-ROUTES.md` and as a Phase 9 checklist item — required by `BOOKING-LOOKUP.md` (`/my-booking` cancel action); currently undocumented anywhere
- ⬜ **[AUDIT-21]** Add `/api/bookings/reject-discount` to `API-ROUTES.md` — required by `BOOKINGS-MANAGEMENT.md` discount rejection flow (Phase 5 marked done, but route was never added to the API surface)
- ⬜ **[AUDIT-22]** Add "Email: discount rejected" as its own checklist item under Phase 6 — `api/handlers/email.ts` already implements this trigger per AUDIT-1 (done), but Phase 6's progress count doesn't track it, so it reads as untested/unwired
- ⬜ **[AUDIT-23]** Add `discount-rejected` and `early-checkin-request` rows to the email routes table in `API-ROUTES.md` — table currently lists only 6 of the 7+ triggers defined in `EMAIL-PDF-STORAGE.md`
- ⬜ **[AUDIT-24]** Define `storeCharges[]` on `bookings/{bookingId}` in `BACKEND.md §bookings` — `STORE-MANAGEMENT.md` references "Add to Booking Bill" writing to this field, but it doesn't exist in the schema; blocks the Phase 8 store billing → Phase 5 checkout folio link
- ⬜ **[AUDIT-25]** Flag dependency in Phase 4 (closed) — Step 3 cancellation policy display and `/privacy` page should source from `settings/websiteContent.cancellationPolicy` / `.privacyPolicyBody`, both edited via Settings → Legal Content (Phase 9, not started). Until Phase 9 ships, these are either hardcoded (violates white-label rule) or only editable via Firebase console

### 🔴 Fix before Phase 10B — Spark Rewards

- ⬜ **[AUDIT-26]** Add `/api/email/early-checkin-request` route + handler to `API-ROUTES.md` and Phase 10B checklist — fallback staff notification for early check-in requests; `INTERCOM-INBOX.md` only "preserves metadata" with no concrete staff-facing action tracked
- ⬜ **[AUDIT-27]** Add "Member discount auto-apply at booking Step 1" as an explicit Phase 10B checklist item, noting it requires reopening the Phase 4 (closed) Step 1 component
- ⬜ **[AUDIT-28]** Add "Award points on checkout (`status → checked-out` trigger)" as a Phase 10B checklist item — server-side logic not covered by AUDIT-6's register/redeem/undo routes
- ⬜ **[AUDIT-29]** Add `/members` to the Admin role's accessible pages in `AUTH-ROLES.md §Roles` table — admin-app route table includes `/members` (admin-only) but the roles table omits it
- ⬜ **[AUDIT-37]** Define stacking/precedence order for the Phase 10B member discount relative to senior/PWD discount and vouchers — `DECISIONS-FEATURES.md` #55 only covers "senior/PWD first, then voucher"; member discount isn't factored in, so a booking could have all three with no defined order
- ⬜ **[AUDIT-38]** Add "Account deletion / data erasure request" to the Phase 10B My Profile checklist — `DECISIONS-FEATURES.md` #49 mandates that member account deletion triggers RA 10173 erasure, but no Phase 10B item covers building this flow
- ⬜ **[AUDIT-44]** Resolve `/rewards` enrollment mechanism contradiction — `STATIC-PAGES.md` has the "Join Spark Rewards" button do a client-side `updateDoc` on `members/{uid}` setting `isMember: true`, but `BACKEND.md` states `memberNumber` ("SR-XXXXX") is generated server-side via `/api/members/register`. Define whether enrollment goes through the API route (consistent with member number generation) or a direct `updateDoc`, and align both docs

### 🟡 Fix before Phase 10 — Security & Polish

- ⬜ **[AUDIT-30]** Clarify scope split between Phase 4 (done) and Phase 10 Turnstile/honeypot items — Phase 4 covers the regular booking form only; reword Phase 10's "booking creation + corporate inquiry form" items to "corporate inquiry form" only, so it's clear the corporate form still needs both protections
- ⬜ **[AUDIT-39]** Add "Accessibility QA — WCAG 2.1 AA checklist (`FRONTEND.md §Accessibility`) applied across guest-facing screens" to Phase 10 — `LEGAL.md` commits to this (tied directly to PWD discount guests), but Phase 10's QA section only covers cross-browser and mobile QA
- ⬜ **[AUDIT-40]** Expand Phase 10's "Firebase Storage rules — final version" item to explicitly cover `bookings/{id}/guest-id/{filename}` (staff-only read, per `BOOKINGS-MANAGEMENT.md`) alongside payment proof — currently only payment proof is named
- ⬜ **[AUDIT-45]** Also expand Phase 10's "Firebase Storage rules — final version" item to cover `bookings/{id}/discount-id/{filename}` (staff-only read, per `BOOKING-FLOW.md` Step 3 / `DECISIONS-FEATURES.md` #12) — same gap as AUDIT-40, separate path

### 🟢 Fix retroactively — Phase 0 / cross-cutting

- ⬜ **[AUDIT-31]** Add PWA setup checklist items to Phase 0 (manifest.json, `vite-plugin-pwa`, Workbox NetworkFirst/CacheFirst strategies, theme-color meta, apple-touch-icon) — `guest-app/CLAUDE.md` states this "must be wired up during Phase 0 scaffolding — not retrofitted later," but Phase 0 (41/41 done) has zero PWA items and AUDIT-16 only covers the icon assets

### 🟢 Anytime — Doc polish

- ⬜ **[AUDIT-32]** Split the Phase 8 "QR Management page" line item into sub-items reflecting work already done (QR rendering via `qrcode.react`, URL format, route correctness — all ✅ in `QR-MANAGEMENT.md`) vs. remaining (grid view, regenerate, print single/all, download as PNG)
- ⬜ **[AUDIT-33]** Add a note/checklist item in `CORPORATE-INQUIRIES.md` confirming "Convert to booking" goes through the same availability-locking transaction as `/api/bookings/create` (see `AVAILABILITY-LOCKING.md`) rather than a plain `addDoc`
- ⬜ **[AUDIT-34]** Document in `QR-MANAGEMENT.md` what happens to an active intercom session on the old `roomId` when a QR code is regenerated mid-stay
- ⬜ **[AUDIT-46]** Expand `RATE-MANAGEMENT.md`'s "Discount rules section" (currently Senior/PWD only) to cross-reference where the Phase 10B member discount (`memberDiscountPct`) is configured, so admins have one place that surfaces all stacking discount sources (relates to AUDIT-37)

---

## Phase 12 — Post-Launch (Phase 2, Deferred)
> Goal: Enhancements after stable v1.0.0.

- ⏸ Calendar view for bookings (visual room × date grid)
- ⏸ Online payment gateway (PayMongo — GCash/PayMaya)
- ⏸ Seasonal rate overrides
- ⏸ Automated test suite
- ⏸ Additional hotel client deployments (white-label)

---

## Progress Summary

| Phase | Items | Done | Remaining |
|---|---|---|---|
| 0 — Foundation | 41 | 41 | 0 |
| 1 — Guest Shell & Static | 12 | 6 | 6 |
| 2 — Admin Shell & Auth | 6 | 6 | 0 |
| 3 — Room System | 5 | 5 | 0 |
| 4 — Booking Flow | 11 | 11 | 0 |
| 5 — Admin Bookings | 8 | 8 | 0 |
| 6 — Email System | 9 | 4 | 5 |
| 7 — Corporate & Vouchers | 12 | 12 | 0 |
| 8 — Intercom | 10 | 2 | 8 |
| 9 — Remaining Features | 5 | 1 | 4 |
| 10 — Security & Polish | 10 | 0 | 10 |
| 10B — Spark Rewards | 14 | 0 | 14 |
| 11 — Staging & Launch | 14 | 0 | 14 |
| Audit Fixes | 46 | 7 | 39 |
| **Total** | **203** | **103** | **100** |

---

*Update the progress table when completing a phase.*
*Commit message: `docs: update ROADMAP.md`*
