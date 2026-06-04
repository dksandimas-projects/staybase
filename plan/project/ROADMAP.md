# Spark Inn — Build Roadmap & Checklist
> Living document — update as work progresses
> Last updated: June 2, 2026
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
- ⬜ Root `package.json` created with npm workspaces config (`guest-app`, `admin-app`, `shared`)
- ⬜ `shared/package.json` created — name: `@spark-inn/shared`
- ⬜ Initialize monorepo structure (`guest-app/`, `admin-app/`, `shared/`, `firebase/`)
- ⬜ Vite + React 19 + TypeScript setup for both apps
- ⬜ Tailwind CSS configured in both apps
- ⬜ `@config` path alias in `vite.config.ts` + `tsconfig.json` (both apps) — points to `../../hotel.config.ts`
- ⬜ `npm install` from repo root — installs all workspace deps together
- ⬜ Husky installed + `commit-msg` hook for Conventional Commits + auto version bump
- ⬜ `shared/VERSION.ts` created at `v0.1.0`
- ⬜ `shared/types/index.ts` — all canonical types from `plan/docs/TYPES.md`
- ⬜ `shared/constants/index.ts` — booking statuses, sources, etc.
- ⬜ `shared/utils/pricing.ts` — price calculation helpers

### Brand Config
- ⬜ `hotel.config.ts` created with full Spark Inn config
- ⬜ `public/brand/` folders created in both apps with Spark Inn assets
- ⬜ Tailwind config reads colors + fonts from `hotel.config.ts`
- ⬜ Apollo font loading via `@font-face` in both `index.html` files
- ⬜ Inter loaded via Google Fonts in both `index.html` files

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
- ⬜ `.env.example` files created for each app

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
