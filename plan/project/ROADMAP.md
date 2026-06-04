# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: June 4, 2026
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

### Brand Config
- ✅ `hotel.config.ts` created with full Spark Inn config
- ✅ `public/brand/` folders created in both apps with Spark Inn assets
- ✅ Tailwind config reads colors + fonts from `hotel.config.ts`
- ✅ Apollo font loading via `@font-face` in both `index.html` files
- ✅ Inter loaded via Google Fonts in both `index.html` files

### Firebase
- ⬜ Firebase project created (Auth + Firestore + Storage enabled)
- ⬜ Initial `firestore.rules` written + deployed
- ⬜ Initial `storage.rules` written + deployed
- ⬜ Firebase Storage CORS configured (`cors.json` deployed)
- ⬜ Firestore collections seeded: `settings/hotelConfig`, `settings/websiteContent`
- ⬜ All 14 rooms seeded in `rooms` collection

### Vercel & Environment
- ⬜ Single Vercel project created for the monorepo
- ⬜ Guest-app deployment configured (root directory: `guest-app/`)
- ⬜ Admin-app deployment configured (root directory: `admin-app/`)
- ⬜ All `.env` files created locally (guest-app, admin-app, api)
- ⬜ All env vars set in Vercel dashboard
- ⬜ Cloudflare Turnstile site + secret keys obtained and added to env
- ⬜ Resend account set up + API key obtained
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
- ⬜ `Navbar` — transparent over hero, solid on scroll, sticky
- ⬜ `Footer` — dark bg, white logo, nav links, version
- ⬜ `PrimaryButton` — orange `primary`, `8px` radius, `44px` min-height
- ⬜ `GhostButton` — transparent, orange border + text
- ⬜ `StatusBadge` — pill, all status variants
- ⬜ `RoomCard` — photo, name, amenities, price (never price first)
- ⬜ `BookingSummaryCard` — read-only recap panel
- ⬜ `StepIndicator` — 4-step, orange active + completed
- ⬜ `DateRangePicker` — blocks past dates, min 1-night
- ⬜ `PaymentMethodCard` — radio card, orange border when selected
- ⬜ `Modal` — centered overlay, `16px` radius, backdrop blur
- ⬜ `Drawer` (guest) — right-side, full height, ~480px wide

**Admin App**
- ⬜ `Sidebar` — `#111827`, 240px, white logo, orange active, version bottom
- ⬜ `StatsCard` — white card, `12px` radius, label + value + optional trend
- ⬜ `DataTable` — sortable, filterable, skeleton rows, row click
- ⬜ `Drawer` (admin) — right-side, full height, ~480px wide
- ⬜ `ChatBubble` — guest: right orange; staff: left white with border
- ⬜ `QuickRequestChip` — pill button in quick-select row

### Guest App Screens
- ⬜ G-01 Homepage `/`
- ⬜ G-02 Rooms Page `/rooms`
- ⬜ G-03 Booking Step 1 — Select Room `/book`
- ⬜ G-04 Booking Step 2 — Guest Details `/book`
- ⬜ G-05 Booking Step 3 — Review & Pay `/book`
- ⬜ G-06 Booking Step 4 — Confirmation `/book/confirm`
- ⬜ G-07 My Booking Lookup `/my-booking`
- ⬜ G-08 Corporate Stays Marketing `/corporate`
- ⬜ G-09 Corporate Booking Gate + Flow `/corporate/book`
- ⬜ G-10 Spark Rewards Landing `/rewards`
- ⬜ G-11 Sign In `/signin`
- ⬜ G-12 Sign Up `/signup`
- ⬜ G-13 Member Profile `/account/profile`
- ⬜ G-14 My Stays `/account/stays`
- ⬜ G-15 My Rewards Portal `/account/rewards`
- ⬜ G-16 Intercom Guest Chat `/intercom/:roomId`
- ⬜ G-17 About Us `/about`
- ⬜ G-18 Contact Us `/contact`
- ⬜ G-19 404 Not Found `*`
- ⬜ M-01 Room Detail Modal
- ⬜ M-02 Availability Filter Drawer (mobile)
- ⬜ M-03 Corporate Access Code Gate
- ⬜ M-04 Voucher Input (inline)

### Admin App Screens
- ⬜ A-01 Admin Login `/login`
- ⬜ A-02 Dashboard Overview `/`
- ⬜ A-03 Bookings Management `/bookings`
- ⬜ A-04 Room Management `/rooms`
- ⬜ A-05 Rate Management `/rates`
- ⬜ A-06 Reports `/reports`
- ⬜ A-07 Corporate Inquiries `/corporate`
- ⬜ A-08 Intercom Inbox `/intercom`
- ⬜ A-09 QR Management `/qr`
- ⬜ A-10 Members `/members`
- ⬜ A-11 Settings `/settings`
- ⬜ D-01 Booking Detail Drawer
- ⬜ D-02 Room Edit Drawer
- ⬜ D-03 Corporate Inquiry Detail Drawer
- ⬜ D-04 Member Detail Drawer
- ⬜ D-05 Store Order Detail Drawer
- ⬜ M-05 Walk-in Booking Modal
- ⬜ M-06 Add/Edit Voucher Modal

---

## Phase 1 — Guest App Shell & Static Pages
> Goal: Public website loads with correct branding, navigation works, static pages done.

### App Shell
- ⬜ `App.tsx` + React Router setup (all routes from `plan/guest-app/CLAUDE.md`)
- ⬜ `Navbar.tsx` — horizontal logo, transparent/solid on scroll, mobile menu
- ⬜ `Footer.tsx` — dark bg, white logo, address, social links, version display
- ⬜ Page `<title>` tags: `{config.pageTitle} | {Page Name}`
- ⬜ Open Graph meta tags on all public pages
- ⬜ Google Analytics 4 injection (conditional on `config.analyticsId`)
- ⬜ 404 page (`NotFoundPage.tsx`)

### Static Pages
- ⬜ Homepage — hero, availability checker, featured rooms, amenities grid, map
- ⬜ About Us — mission, vision, hotel story (from Firestore)
- ⬜ Corporate Stays — dark hero, perks, rooms overview, inquiry form + Turnstile
- ⬜ Contact Us — address, phone, email, map embed, social links
- ⬜ Privacy Policy — body from Firestore `settings/websiteContent.privacyPolicyBody`

---

## Phase 2 — Admin App Shell & Auth
> Goal: Admin app loads, login works, sidebar navigation renders correctly per role.

- ⬜ `App.tsx` + React Router + protected route wrapper
- ⬜ `LoginPage.tsx` — email/password, Firebase Auth
- ⬜ Auth context — `onAuthStateChanged`, role from custom claims
- ⬜ `Sidebar.tsx` — role-aware nav, orange active state, version in footer
- ⬜ Role-based access (Front Desk vs Admin) — redirect on unauthorized access
- ⬜ Dashboard shell — layout with sidebar + main content area

---

## Phase 3 — Room System
> Goal: Rooms visible on guest site, manageable from admin.

- ⬜ `useRooms` hook — `onSnapshot` on `rooms` collection
- ⬜ `RoomCard.tsx` — image, name, type badge, amenities, price, availability badge
- ⬜ Rooms page (`/rooms`) — grid, filters by room type (from `config.roomTypes`), availability badges, detail modal
- ⬜ Room Management page (`/rooms` admin) — list, edit form, photo upload, status, block reason
- ⬜ Rate Management page (`/rates`) — dynamic rows from `config.roomTypes`, weekend rates, corporate rates, payment methods

---

## Phase 4 — Booking Flow (P0)
> Goal: Guest can complete a booking end-to-end. Most critical feature.

- ⬜ `DateRangePicker.tsx` — blocks past dates, min 1 night
- ⬜ `BookingSummary.tsx` — read-only recap component
- ⬜ Booking context/state — persists across 4 steps
- ⬜ Step 1 — Select Room: date pickers, guest count, availability query, rate display
- ⬜ Step 2 — Guest Details: form + Zod validation + privacy consent checkbox
- ⬜ Step 3 — Review & Pay: summary, discount selector, voucher input, payment method, screenshot upload, cancellation policy, Turnstile, honeypot
- ⬜ Step 4 — Confirmation: booking ref, summary, Add to Calendar, payment instructions
- ⬜ `/api/bookings/create` — Firestore transaction, availability lock, booking ref generation
- ⬜ Voucher validation API route (`/api/validate/voucher`)
- ⬜ Rate limiting on booking creation + voucher validation
- ⬜ Booking confirmation receipt PDF (jsPDF) — fonts embedded

---

## Phase 5 — Admin Bookings Management (P0)
> Goal: Front desk can view, manage, and create bookings from the dashboard.

- ⬜ `useBookings` hook — `onSnapshot` on `bookings` collection
- ⬜ `BookingTable.tsx` — filterable, sortable, clickable rows
- ⬜ Booking detail drawer — full details, payment proof, status actions, notes
- ⬜ Status transition actions — context-aware buttons per current status
- ⬜ Walk-in / manual booking creation modal
- ⬜ Cancellation flow — confirmation modal, reason, cancellation email
- ⬜ Receipt PDF — print + download from drawer
- ⬜ Dashboard Overview — stat cards, room grid, housekeeping toggles, pending payments, today's arrivals/checkouts

---

## Phase 6 — Email System (P0)
> Goal: All 6 email triggers working via Resend + Vercel API.

- ⬜ Resend client setup in `api/lib/resend.ts`
- ⬜ Firebase Admin SDK setup in `api/lib/firebase-admin.ts`
- ⬜ Email: booking submitted
- ⬜ Email: payment confirmed
- ⬜ Email: booking confirmed
- ⬜ Email: check-in reminder (scheduled — cron or trigger)
- ⬜ Email: booking cancelled
- ⬜ Email: new corporate inquiry (to staff)
- ⬜ Email branding — logo, primary color, hotel name from config

---

## Phase 7 — Corporate, Vouchers & Breakfast (P1)
> Goal: Corporate booking flow + voucher system + breakfast add-on working end-to-end.

- ⬜ Corporate Booking page (`/corporate/book`) — landing, access code input, corporate skin
- ⬜ Corporate code validation API route (`/api/validate/corporate-code`)
- ⬜ Corporate Inquiries pipeline (admin) — kanban, notes log, access code generation
- ⬜ Voucher management (admin, within Settings)
- ⬜ Voucher redemption wired into booking flow Step 3
- ⬜ Breakfast add-on — Settings → Breakfast tab (silog menu management, enable/disable)
- ⬜ Breakfast add-on — Rate Management (rate per person per night)
- ⬜ Breakfast add-on — Step 1 room card (Room Only vs Room + Breakfast option)
- ⬜ Breakfast add-on — booking creation stores `hasBreakfast`, `breakfastRate`
- ⬜ Breakfast selections panel — booking detail drawer (front desk enters at check-in)
- ⬜ Guest registration form PDF — breakfast section with silog options grid
- ⬜ Breakfast reports — daily kitchen prep report + breakfast revenue

---

## Phase 8 — Intercom (P1)
> Goal: QR chat working between guests and front desk, including Spark Essentials store.

- ⬜ Guest Intercom page (`/intercom/:roomId`) — chat UI, quick requests, name prompt, Shop tab
- ⬜ Intercom Inbox (admin) — chat list, thread view, reply, mark resolved, store order cards
- ⬜ Notification sound — Web Audio API, every message, tab not focused
- ⬜ Tab title unread count
- ⬜ QR Management page — QR grid, regenerate, print single/all
- ⬜ Spark Essentials — guest store panel (item grid, cart, checkout, order tracking)
- ⬜ Spark Essentials — catalog management in Settings → Store tab
- ⬜ Spark Essentials — order management page/section (admin)
- ⬜ Spark Essentials — store order API route (stock check + order creation transaction)
- ⬜ Spark Essentials — store reports in Reports page

---

## Phase 9 — Remaining Features (P1)
> Goal: All P1 features complete before launch prep.

- ⬜ Booking Lookup page (`/my-booking`) — ref + email lookup, cancel, resend email
- ⬜ Reports page — occupancy, revenue, bookings by source, PDF/CSV export
- ⬜ Settings page — all 9 tabs (Hotel Info, Payment Methods, Email, Staff Accounts, Discounts, Vouchers, Intercom, Website Content, Legal Content)
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
| 0 — Foundation | 22 | 0 | 22 |
| 1 — Guest Shell & Static | 13 | 0 | 13 |
| 2 — Admin Shell & Auth | 6 | 0 | 6 |
| 3 — Room System | 5 | 0 | 5 |
| 4 — Booking Flow | 12 | 0 | 12 |
| 5 — Admin Bookings | 9 | 0 | 9 |
| 6 — Email System | 8 | 0 | 8 |
| 7 — Corporate & Vouchers | 5 | 0 | 5 |
| 8 — Intercom | 5 | 0 | 5 |
| 9 — Remaining Features | 4 | 0 | 4 |
| 10 — Security & Polish | 11 | 0 | 11 |
| 11 — Staging & Launch | 15 | 0 | 15 |
| **Total** | **115** | **0** | **115** |

---

*Update the progress table when completing a phase.*
*Commit message: `docs: update ROADMAP.md`*
