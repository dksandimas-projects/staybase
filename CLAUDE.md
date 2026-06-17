# Spark Inn — Master Agent Context

> **Start here.** Read this file before any task. Load the read bundle for your task type, then the relevant feature MD.

---

## Project Overview

Spark Inn is the reference deployment of a white-label hotel booking and management system. Built for a boutique hotel in Bohol, Philippines. Two separate React + Vite apps share one Firebase project. See `plan/docs/WHITE-LABEL.md` for deploying to other hotel clients.

| App | URL | Audience |
|---|---|---|
| `guest-app/` | `www.sparkinnbohol.com` | Public guests, corporate clients |
| `guest-app/api/` | Same Vercel deployment as guest-app | Server-side logic, email, validation |
| `admin-app/` | `admin.sparkinnbohol.com` | Hotel staff (front desk + admin) |
| `shared/` | Internal | Shared types, utils, VERSION constant |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind CSS |
| Animations | Framer Motion 12 |
| Auth | Firebase Authentication (Email/Password) |
| Database | Firebase Firestore |
| File Storage | Firebase Storage |
| Hosting | Vercel (guest-app + admin-app + api/) |
| Email | Resend via Vercel API routes |
| Data fetching (API) | TanStack Query |
| Data fetching (Firestore) | Custom hooks with onSnapshot |
| Validation | Zod |
| PDF / screen capture | jsPDF + html2canvas |
| QR Codes | qrcode.react |
| Charts | Recharts |
| Git hooks | Husky + Conventional Commits |
| Bot prevention | Cloudflare Turnstile (free) + honeypot fields + rate limiting |
| White-label config | `hotel.config.ts` — colors, fonts, logos, brand name per client |

**Firebase usage: Auth + Firestore + Storage ONLY. No Firebase Hosting. No Cloud Functions.**

---

## Read Bundles

Load only the bundle for your task type — do not read all MDs.

| Task type | Read these MDs |
|---|---|
| Guest UI task | `plan/docs/FRONTEND.md` + `plan/guest-app/CLAUDE.md` + relevant feature MD |
| Admin UI task | `plan/docs/FRONTEND.md` + `plan/admin-app/CLAUDE.md` + `plan/features/ADMIN-MOBILE.md` + relevant feature MD |
| Data / API task | `plan/docs/BACKEND.md` + `plan/docs/TYPES.md` + `plan/docs/API-ROUTES.md` |
| Full feature build | All of the above + `plan/docs/DECISIONS-FEATURES.md` |
| Auth / roles | `plan/features/AUTH-ROLES.md` + `plan/docs/BACKEND.md` |
| Availability / booking | `plan/features/AVAILABILITY-LOCKING.md` + `plan/features/BOOKING-FLOW.md` + `plan/docs/BACKEND.md` |
| Corporate booking | `plan/features/CORPORATE-BOOKING.md` + `plan/features/BOOKING-FLOW.md` + `plan/docs/BACKEND.md` |
| Vouchers | `plan/features/VOUCHERS.md` + `plan/features/BOOKING-FLOW.md` + `plan/docs/BACKEND.md` |
| Email / PDF | `plan/features/EMAIL-PDF-STORAGE.md` + `plan/docs/API-ROUTES.md` |
| Security / PII / compliance | `plan/docs/SECURITY.md` + `plan/docs/GOTCHAS.md` + `plan/docs/DECISIONS-FEATURES.md` |
| New feature / architecture | `plan/docs/DECISIONS-ARCH.md` + `plan/docs/GOTCHAS.md` |
| Vercel deployment / function count | `plan/docs/VERCEL-FUNCTION-LIMIT.md` + `plan/docs/FILE-STRUCTURE.md` |
| White-label deployment | `plan/docs/WHITE-LABEL.md` + `plan/docs/DECISIONS-ARCH.md` |
| Spark Essentials store | `plan/features/STORE-GUEST.md` + `plan/features/STORE-MANAGEMENT.md` + `plan/docs/BACKEND.md` |
| Spark Rewards / member auth | `plan/features/SPARK-REWARDS.md` + `plan/docs/BACKEND.md` |
| Wireframe task (any screen) | `plan/docs/WIREFRAME-WORKFLOW.md` + `plan/docs/FRONTEND.md` + relevant feature MD |

---

## Table of Contents

### plan/docs/
- `plan/docs/WIREFRAME-WORKFLOW.md` — Stitch → React wireframe process, agent rules, full screen checklist
- `plan/docs/FRONTEND.md` — Brand tokens, Tailwind config, component conventions, breakpoints
- `plan/docs/BACKEND.md` — Firestore schema (all 8 collections), security rules
- `plan/docs/API-ROUTES.md` — Vercel API surface, catch-all pattern, auth headers
- `plan/docs/TYPES.md` — Canonical TypeScript types for all shared models
- `plan/docs/ENV-SETUP.md` — All environment variables
- `plan/docs/FILE-STRUCTURE.md` — Full folder tree, naming conventions
- `plan/docs/VERCEL-FUNCTION-LIMIT.md` — Hobby plan 12-function cap: layout rules, what counts, how to verify, what NOT to do
- `plan/docs/DECISIONS-ARCH.md` — Architecture, stack, tooling, security, white-label decisions
- `plan/docs/DECISIONS-FEATURES.md` — Feature scope, product, business rules, compliance decisions
- `plan/docs/GOTCHAS.md` — What agents must never do
- `plan/docs/CONTRIBUTING.md` — How to update MDs, sync protocol, deploy checklist
- `plan/docs/SECURITY.md` — Firestore/Storage rules, PII handling, RA 10173 compliance, session management, CSP headers
- `plan/docs/LEGAL.md` — IP ownership, guest ToS, GDPR awareness, accessibility commitment, white-label licensing, post-launch support
- `plan/docs/WHITE-LABEL.md` — Hotel config schema, per-client deployment guide, asset checklist

### App CLAUDEs
- `plan/guest-app/CLAUDE.md` — Pages, routing, booking flow summary
- `plan/admin-app/CLAUDE.md` — Pages, auth guards, role-based access

### plan/features/ — Guest App
- `plan/features/HOMEPAGE.md` — Hero, availability checker, featured rooms, amenities, map
- `plan/features/ROOMS-PAGE.md` — Room grid, filters, availability badges, detail modal
- `plan/features/BOOKING-FLOW.md` — 4-step booking flow including voucher input
- `plan/features/CORPORATE-BOOKING.md` — `/corporate/book`, flat rate + access code flow
- `plan/features/BOOKING-LOOKUP.md` — `/my-booking`, ref + email lookup
- `plan/features/INTERCOM-GUEST.md` — QR chat, quick request panel
- `plan/features/STATIC-PAGES.md` — About Us, Corporate Stays (marketing), Contact Us, 404

### plan/features/ — Admin App
- `plan/features/AUTH-ROLES.md` — Login, protected routes, role-based access
- `plan/features/DASHBOARD-OVERVIEW.md` — Stat cards, room grid, housekeeping toggle
- `plan/features/BOOKINGS-MANAGEMENT.md` — Booking table, drawer, walk-in creation, receipt
- `plan/features/ROOM-MANAGEMENT.md` — Edit rooms, photos, status, block reason
- `plan/features/RATE-MANAGEMENT.md` — Rates, weekend rates, corporate rate, discounts
- `plan/features/CORPORATE-INQUIRIES.md` — Pipeline, notes log, access code generation
- `plan/features/VOUCHERS.md` — Promo voucher management
- `plan/features/REPORTS.md` — Occupancy, revenue, bookings by source, export
- `plan/features/INTERCOM-INBOX.md` — Chat list, notification sound, quick request badges
- `plan/features/QR-MANAGEMENT.md` — QR per room, regenerate, print
- `plan/features/SETTINGS.md` — Hotel info, payment methods, staff accounts, website content
- `plan/features/ADMIN-MOBILE.md` — Admin app responsive layout — sidebar / header / drawer / data table for < 768px

### plan/features/ — Spark Rewards
- `plan/features/SPARK-REWARDS.md` — guest auth, member registration, profile portal, points, admin member management

### plan/features/ — Spark Essentials Store
- `plan/features/STORE-GUEST.md` — guest store panel in intercom, cart, order placement, payment
- `plan/features/STORE-MANAGEMENT.md` — catalog management, order processing, store reports

### plan/features/ — Cross-cutting
- `plan/features/AVAILABILITY-LOCKING.md` — Double-booking prevention, Firestore transactions
- `plan/features/EMAIL-PDF-STORAGE.md` — Resend email flows, jsPDF receipts, Storage uploads

---

## Hard Rules

These apply to every file in every app. No exceptions.

- **No Firebase Hosting, no Firebase Cloud Functions** — Vercel only
- **No code in MD files** — high-level spec, rules, and checklists only
- **All primary CTAs = `config.colors.primary`** — use the `primary` Tailwind token, never hardcoded hex values
- **No sharp corners** — `8px` buttons/inputs, `12px` cards
- **All form fields minimum 44px touch height**
- **Dashboard sidebar always `config.colors.sidebar`** with `config.colors.primary` active state
- **Navbar always uses `config.logos.navbar`** — never hardcode logo filename
- **Footer and dark backgrounds always use `config.logos.white`**
- **Brand name always written as `config.brandName`** — never hardcoded strings in UI
- **Availability booking must use Firestore transactions** — never read-then-write
- **Validate corporate codes and vouchers server-side** — never trust client
- **Always unsubscribe Firestore `onSnapshot` listeners** in `useEffect` cleanup
- **Named exports for components/hooks** — default exports for pages only
- **Conventional Commits required** — `fix:` / `feat:` / `refactor:` / `release:` prefixes
- **Bump `VERSION` in `shared/` before every merge to `main`** (Husky handles automatically)
- **Never commit `.env` files**
- **Never log PII** — no console.log of guest names, emails, or payment data
- **Never expose payment proof URLs in guest-app** — admin-only
- **Consent checkbox required at booking Step 2** — links to `/privacy` and `/terms`, blocks submission if unchecked
- **Comply with RA 10173** — see `plan/docs/SECURITY.md` for full requirements
- **Rate limit all public API endpoints** — booking creation, voucher/code validation, email resend

---

## Branching Strategy

```
main              ← production only — never commit directly
dev               ← daily working branch
feature/wireframe ← single branch for the entire Phase 0.5 wireframe pass
feature/*         ← one branch per feature, off dev
fix/*             ← bug fixes off dev
docs/*            ← documentation-only changes off dev
```

Merge `dev → main` only at milestones: staging demo, production launch.

### Agent task-start order

**Every task — no exceptions — follows this exact sequence before writing a single line of code:**

1. **Check branch** — run `git branch --show-current`. If not on the right branch, create one off `dev`:
   - Wireframe pass (Phase 0.5) → `git checkout -b feature/wireframe` (one shared branch, no per-screen branches)
   - New feature → `git checkout -b feature/<task-name>`
   - Bug fix → `git checkout -b fix/<task-name>`
   - Docs-only → `git checkout -b docs/<task-name>`
   - Never work directly on `dev` or `main`
2. **Load read bundle** — identify your task type in the Read Bundles table above and load only those MDs. Do not load all MDs.
3. **Read GOTCHAS.md** — always, every task. Check for rules that apply to this specific feature area before writing any code.
4. **Build** — implement against the feature MD checklist. Apply `plan/docs/FRONTEND.md §UX Philosophy` to every UI screen.
5. **Update MDs** — if you made any decision that changes or extends an MD (schema field, new edge case, new rule), update the relevant MD before closing the task. Never drift from the docs.

Do not skip steps 2–3 even if the task seems simple — they exist to prevent the most common and most expensive agent mistakes.

---

## Versioning

- Format: `v[MAJOR].[MINOR].[PATCH]`
- Starts at `v0.1.0`, reaches `v1.0.0` at production launch
- `VERSION` constant lives in `shared/` — imported by both apps
- Displayed in footer of **all pages** (guest + dashboard)
- Auto-bumped by Husky `commit-msg` hook via Conventional Commits:
  - `fix:` → PATCH | `refactor:` → PATCH | `feat:` → MINOR | `release:` → MAJOR

---

## Roles

| Role | Access |
|---|---|
| Guest (anonymous) | Public website, booking flow, intercom |
| Front Desk | Dashboard — all except Settings admin functions |
| Admin | Full dashboard including Settings, staff accounts, rate management |

See `plan/features/AUTH-ROLES.md` for full implementation details.
