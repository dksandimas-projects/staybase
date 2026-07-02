# File Structure
> Requires: CLAUDE.md

---

## Repo Root

```
spark-inn/
├── package.json                 ← npm workspaces root — defines workspace members
├── vercel.json                  ← Vercel headers + scheduled cron config
├── CLAUDE.md                    ← Master agent context (read first)
├── GEMINI.md                    ← One-liner redirect to CLAUDE.md
├── AGENTS.md                    ← One-liner redirect to CLAUDE.md
├── hotel.config.ts              ← Brand identity config (colors, fonts, logos, name) — swap per client
├── .gitignore
│
├── api/                          ← Repo-root Vercel function shim (see "Vercel Project Setup" below)
│   └── [...route].ts            ← Thin re-export: `export { default } from "../guest-app/api/[...route]"`
├── guest-app/                   ← Public booking website + API routes (deployed together on Vercel)
│   ├── package.json             ← depends on @spark-inn/shared
│   └── api/                     ← only `[...route].js` lives here — a committed, build-generated bundle, not source
├── admin-app/                   ← Front desk dashboard (second deployment, same Vercel project)
│   └── package.json             ← depends on @spark-inn/shared
├── shared/                      ← Shared package — types, utils, constants, VERSION
│   └── package.json             ← name: "@spark-inn/shared"
├── firebase/                    ← Firestore + Storage rules
├── docs/                        ← Agent reference MDs
├── features/                    ← Feature spec MDs
└── project/                     ← Project assets
```

---

## `guest-app/`

```
guest-app/
├── src/
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── RoomsPage.tsx
│   │   ├── AboutPage.tsx
│   │   ├── CorporatePage.tsx           ← Marketing page
│   │   ├── CorporateBookingPage.tsx    ← /corporate/book
│   │   ├── ContactPage.tsx
│   │   ├── BookingPage.tsx             ← 4-step booking flow
│   │   ├── BookingConfirmPage.tsx
│   │   ├── BookingLookupPage.tsx       ← /my-booking
│   │   ├── IntercomPage.tsx
│   │   └── NotFoundPage.tsx
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── Footer.tsx                  ← Displays VERSION
│   │   ├── RoomCard.tsx
│   │   ├── DateRangePicker.tsx
│   │   └── BookingSummary.tsx
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── rooms.ts
│   │   └── bookings.ts
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useRooms.ts
│   │   └── useBookings.ts
│   └── App.tsx
├── api/                                ← Vercel serverless API routes (co-located with guest-app) — ONLY the catch-all lives here
│   └── [...route].js                   ← Committed, build-generated bundle of server/apiRouter.ts (single Vercel function — see plan/docs/VERCEL-FUNCTION-LIMIT.md)
├── server/                             ← Server-side modules — NOT scanned by Vercel
│   ├── apiRouter.ts                    ← Real catch-all source, bundled into api/[...route].js by `npm run build:api`
│   ├── handlers/
│   │   ├── email.ts
│   │   ├── bookings.ts
│   │   ├── validate.ts
│   │   └── reference.ts
│   └── lib/
│       ├── firebase-admin.ts
│       └── resend.ts
├── public/
│   └── brand/                          ← Client brand assets (logos, fonts, favicon, OG image)
├── .env                                ← Gitignored
├── .env.example
└── vite.config.ts                      ← Includes @shared/* and @config aliases
```

---

## `admin-app/`

```
admin-app/
├── src/
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── BookingsPage.tsx
│   │   ├── RoomsPage.tsx
│   │   ├── RatesPage.tsx
│   │   ├── ReportsPage.tsx
│   │   ├── CorporateInquiriesPage.tsx
│   │   ├── IntercomInboxPage.tsx
│   │   ├── QRManagementPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── Sidebar.tsx                 ← Displays VERSION in footer
│   │   ├── BookingTable.tsx
│   │   ├── RoomForm.tsx
│   │   ├── StatsCard.tsx
│   │   └── OccupancyChart.tsx
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── rooms.ts
│   │   ├── bookings.ts
│   │   └── guests.ts
│   └── App.tsx
├── .env                                ← Gitignored
├── .env.example
└── vite.config.ts                      ← Includes @shared/* alias
```

---

## Vercel Project Setup

One Vercel project for the entire monorepo. Two deployments configured:

| Deployment | Root Directory | Domain |
|---|---|---|
| Guest + API | repo root (confirmed via runtime paths like `/var/task/guest-app/server/lib/...` and build logs cloning to `/vercel/path0/guest-app/...`) — **not** `guest-app/` | `www.sparkinnbohol.com` |
| Admin | `admin-app/` | `admin.sparkinnbohol.com` |

The Guest + API deployment's Root Directory is the **repo root**, with a custom Build Command that runs `guest-app`'s own `npm run build`. Vercel's zero-config function detection scans `api/` at the repo root, which is why a thin shim exists there (`api/[...route].ts` → `export { default } from "../guest-app/api/[...route]"`) — it's what Vercel actually treats as the deployed function, and it resolves to the committed `guest-app/api/[...route].js` bundle. Both deployments share the same env vars set in the single Vercel project dashboard.

> **Hobby plan = 12 serverless functions max.** The repo-root `api/` and `guest-app/api/` together resolve to exactly **1 function**. All handler and lib modules live under `guest-app/server/` (not scanned by Vercel). See `plan/docs/VERCEL-FUNCTION-LIMIT.md` for the full rules, the reasons behind this exact layout (learned from a production outage), and verification steps.

Root `vercel.json` owns deployment-wide security headers, the build command (`npm run build:guest`), the output directory (`guest-app/dist`), and the scheduled check-in reminder cron entry. Headers include CSP, clickjacking protection, MIME sniffing protection, referrer policy, and permissions policy. The cron entry calls `/api/email/checkin-reminder` daily using the `CRON_SECRET` bearer-token flow documented in `plan/features/EMAIL-PDF-STORAGE.md`.

---

## `shared/`

```
shared/
├── package.json                        ← name: "@spark-inn/shared", exports all public modules
├── types/
│   └── index.ts                        ← All canonical TypeScript types (see plan/docs/TYPES.md)
├── schemas/
│   └── booking.ts                      ← Zod schemas for booking form
├── utils/
│   ├── pricing.ts                      ← Full price calculation (rate, breakfast, discount, voucher, points)
│   ├── dates.ts                        ← numNights, weekend detection, date overlap check
│   ├── points.ts                       ← Points earning + redemption calculations
│   ├── references.ts                   ← Booking ref, member number, store order ref generation
│   ├── vouchers.ts                     ← Voucher validation logic (expiry, cap, room type, discount calc)
│   ├── corporate-codes.ts              ← Corporate access code validation logic (expiry, cap, active status)
│   └── images.ts                       ← Client-side image compression before Firebase Storage upload
├── constants/
│   └── index.ts                        ← Booking statuses, sources, etc.
├── animations.ts                       ← Shared Framer Motion variants (fadeUp, staggerContainer, slideInRight, etc.) — see plan/docs/FRONTEND.md §Animations
├── __tests__/                          ← Unit tests (Vitest) — pure function tests only, no Firebase
│   ├── pricing.test.ts                 ← U-1: full price calculation combinations
│   ├── dates.test.ts                   ← U-2: numNights, weekend nights, date overlap
│   ├── points.test.ts                  ← U-3: earning modes, redemption value, insufficient balance
│   ├── references.test.ts              ← U-4: ref formats, zero-padding, sequential counter
│   ├── vouchers.test.ts                ← U-5: all validation edge cases, discount calculations
│   └── corporate-codes.test.ts         ← U-6: access code expiry, cap, active status, corporate rate
└── VERSION.ts                          ← Single source of version string e.g. "0.1.0"
```

Unit tests run with `vitest` from `shared/`. No Firebase emulator needed — all pure functions.

---

## `guest-app/tests/api/` — Integration Tests

```
guest-app/tests/api/                          ← Integration tests (Vitest + Firebase emulator)
    ├── bookings-create.test.ts         ← I-1: availability locking, concurrent requests, idempotency
    ├── store-confirm-order.test.ts     ← I-2: stock decrement/restore, concurrent last-item orders
    ├── members-redeem-points.test.ts   ← I-3: redemption, balance update, history log, undo
    └── corporate-code.test.ts         ← I-4: usage count, cap, expiry, isActive checks
```

Tests live in `tests/api/` (NOT `api/__tests__/`) — any `.ts` file inside `api/` counts as a Vercel function on Hobby plan. See `plan/docs/VERCEL-FUNCTION-LIMIT.md` for why. Run with `npm run test:guest:api` from `guest-app/`. See `plan/docs/DECISIONS-ARCH.md §Testing Strategy` for full test coverage spec.

Imported as `@spark-inn/shared` in both apps and in `api/` handlers — works in Vite (frontend) and Node.js (serverless) without any path alias hacks.

`hotel.config.ts` lives at repo root and is imported via a `@config` path alias in both Vite apps. The `api/` handlers import it via relative path (`../../hotel.config.ts`) since they run in Node.js, not Vite.

---

## `public/brand/` (both apps)

Each app has a `public/brand/` folder for client brand assets:

```
guest-app/public/brand/
├── fonts/
│   ├── APOLLO.otf                      ← Heading font (Spark Inn)
│   └── APOLLOItalic.otf
├── FINAL LOGO.png
├── FINAL LOGO-white.png
├── nav-bar-logo.png
├── ICON LOGO.png
├── TEXT LOGO.png
└── favicon.ico

admin-app/public/brand/
└── (same structure)
```

For a new client deployment, replace the contents of `public/brand/` with the client's assets. Filenames must match the paths defined in `hotel.config.ts → logos`.

---

## `firebase/`

```
firebase/
├── firestore.rules
└── storage.rules
```

No `firebase.json` — hosting is Vercel, not Firebase Hosting.

---

## `plan/docs/`

Agent reference MDs. See `CLAUDE.md` Table of Contents for full list.

---

## `plan/features/`

Feature spec MDs. See `CLAUDE.md` Table of Contents for full list.

---

## `project/`

Project management assets. Partially gitignored.

```
project/
├── ROADMAP.md                          ← Prioritized build checklist, phase by phase, with AI starter prompts
├── SETUP-GUIDE.md                      ← Step-by-step local + production setup, emulator instructions
├── AI-MD-SYSTEM-PROMPT.md              ← Reusable prompt template for bootstrapping MD systems on new projects
├── branding/                           ← Logos, fonts (.otf, .ai, .eps, .png) — tracked
├── design/                             ← spark-inn-design-spec.md, DESIGN.md, Stitch mockups — tracked
├── documents/                          ← Proposals, PRD, Excel files (.docx, .xlsx) — tracked
└── context/                            ← spark-inn-MASTER-CONTEXT.md, spark-inn-MD-PLAN.md — tracked
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| React components | PascalCase | `RoomCard.tsx` |
| Pages | PascalCase + "Page" suffix | `BookingPage.tsx` |
| Hooks | camelCase + "use" prefix | `useRooms.ts` |
| Utility files | camelCase | `pricing.ts` |
| Folders | kebab-case | `guest-app/` |
| Feature MDs | SCREAMING-KEBAB-CASE | `BOOKING-FLOW.md` |
| Constants | SCREAMING_SNAKE_CASE | `BOOKING_STATUSES` |

---

## Version Constant

`shared/VERSION.ts` exports a single string: `export const VERSION = "0.1.0"`

Both apps import and display it in their footer. Bumped automatically by Husky on commit via Conventional Commits. See `plan/docs/CONTRIBUTING.md` for bump rules.
