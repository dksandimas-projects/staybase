# Spark Inn — Master Agent Context

> **Start here.** Read this file before any task. Load the read bundle for your task type, then the relevant feature MD.

---

## Project Overview

Spark Inn is the reference deployment of a white-label hotel booking and management system. Built for a boutique hotel in Bohol, Philippines. Two separate React + Vite apps share one Firebase project. See `docs/WHITE-LABEL.md` for deploying to other hotel clients.

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
| PDF | jsPDF |
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
| Guest UI task | `docs/FRONTEND.md` + `guest-app/CLAUDE.md` + relevant feature MD |
| Admin UI task | `docs/FRONTEND.md` + `admin-app/CLAUDE.md` + relevant feature MD |
| Data / API task | `docs/BACKEND.md` + `docs/TYPES.md` + `docs/API-ROUTES.md` |
| Full feature build | All of the above + `docs/DECISIONS-FEATURES.md` |
| Auth / roles | `features/AUTH-ROLES.md` + `docs/BACKEND.md` |
| Availability / booking | `features/AVAILABILITY-LOCKING.md` + `features/BOOKING-FLOW.md` + `docs/BACKEND.md` |
| Corporate booking | `features/CORPORATE-BOOKING.md` + `features/BOOKING-FLOW.md` + `docs/BACKEND.md` |
| Vouchers | `features/VOUCHERS.md` + `features/BOOKING-FLOW.md` + `docs/BACKEND.md` |
| Email / PDF | `features/EMAIL-PDF-STORAGE.md` + `docs/API-ROUTES.md` |
| Security / PII / compliance | `docs/SECURITY.md` + `docs/GOTCHAS.md` + `docs/DECISIONS-FEATURES.md` |
| New feature / architecture | `docs/DECISIONS-ARCH.md` + `docs/GOTCHAS.md` |
| White-label deployment | `docs/WHITE-LABEL.md` + `docs/DECISIONS-ARCH.md` |
| Spark Essentials store | `features/STORE-GUEST.md` + `features/STORE-MANAGEMENT.md` + `docs/BACKEND.md` |
| Spark Rewards / member auth | `features/SPARK-REWARDS.md` + `docs/BACKEND.md` |

---

## Table of Contents

### docs/
- `FRONTEND.md` — Brand tokens, Tailwind config, component conventions, breakpoints
- `BACKEND.md` — Firestore schema (all 8 collections), security rules
- `API-ROUTES.md` — Vercel API surface, catch-all pattern, auth headers
- `TYPES.md` — Canonical TypeScript types for all shared models
- `ENV-SETUP.md` — All environment variables
- `FILE-STRUCTURE.md` — Full folder tree, naming conventions
- `DECISIONS-ARCH.md` — Architecture, stack, tooling, security, white-label decisions
- `DECISIONS-FEATURES.md` — Feature scope, product, business rules, compliance decisions
- `GOTCHAS.md` — What agents must never do
- `CONTRIBUTING.md` — How to update MDs, sync protocol, deploy checklist
- `SECURITY.md` — Firestore/Storage rules, PII handling, RA 10173 compliance, intercom security model
- `WHITE-LABEL.md` — Hotel config schema, per-client deployment guide, asset checklist

### App CLAUDEs
- `guest-app/CLAUDE.md` — Pages, routing, booking flow summary
- `admin-app/CLAUDE.md` — Pages, auth guards, role-based access

### features/ — Guest App
- `HOMEPAGE.md` — Hero, availability checker, featured rooms, amenities, map
- `ROOMS-PAGE.md` — Room grid, filters, availability badges, detail modal
- `BOOKING-FLOW.md` — 4-step booking flow including voucher input
- `CORPORATE-BOOKING.md` — `/corporate/book`, flat rate + access code flow
- `BOOKING-LOOKUP.md` — `/my-booking`, ref + email lookup
- `INTERCOM-GUEST.md` — QR chat, quick request panel
- `STATIC-PAGES.md` — About Us, Corporate Stays (marketing), Contact Us, 404

### features/ — Admin App
- `AUTH-ROLES.md` — Login, protected routes, role-based access
- `DASHBOARD-OVERVIEW.md` — Stat cards, room grid, housekeeping toggle
- `BOOKINGS-MANAGEMENT.md` — Booking table, drawer, walk-in creation, receipt
- `ROOM-MANAGEMENT.md` — Edit rooms, photos, status, block reason
- `RATE-MANAGEMENT.md` — Rates, weekend rates, corporate rate, discounts
- `CORPORATE-INQUIRIES.md` — Pipeline, notes log, access code generation
- `VOUCHERS.md` — Promo voucher management
- `REPORTS.md` — Occupancy, revenue, bookings by source, export
- `INTERCOM-INBOX.md` — Chat list, notification sound, quick request badges
- `QR-MANAGEMENT.md` — QR per room, regenerate, print
- `SETTINGS.md` — Hotel info, payment methods, staff accounts, website content

### features/ — Spark Rewards
- `SPARK-REWARDS.md` — guest auth, member registration, profile portal, points, admin member management

### features/ — Spark Essentials Store
- `STORE-GUEST.md` — guest store panel in intercom, cart, order placement, payment
- `STORE-MANAGEMENT.md` — catalog management, order processing, store reports

### features/ — Cross-cutting
- `AVAILABILITY-LOCKING.md` — Double-booking prevention, Firestore transactions
- `EMAIL-PDF-STORAGE.md` — Resend email flows, jsPDF receipts, Storage uploads

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
- **Conventional Commits required** — `fix:` / `feat:` / `release:` prefixes
- **Bump `VERSION` in `shared/` before every merge to `main`** (Husky handles automatically)
- **Never commit `.env` files**
- **Never log PII** — no console.log of guest names, emails, or payment data
- **Never expose payment proof URLs in guest-app** — admin-only
- **Consent checkbox required at booking Step 2** — links to `/privacy`, blocks submission if unchecked
- **Comply with RA 10173** — see `docs/SECURITY.md` for full requirements
- **Rate limit all public API endpoints** — booking creation, voucher/code validation, email resend

---

## Branching Strategy

```
main        ← production only — never commit directly
dev         ← daily working branch
feature/*   ← branch off dev, merge back to dev
fix/*       ← bug fixes off dev, merge back to dev
```

Merge `dev → main` only at milestones: staging demo, production launch.

---

## Versioning

- Format: `v[MAJOR].[MINOR].[PATCH]`
- Starts at `v0.1.0`, reaches `v1.0.0` at production launch
- `VERSION` constant lives in `shared/` — imported by both apps
- Displayed in footer of **all pages** (guest + dashboard)
- Auto-bumped by Husky `commit-msg` hook via Conventional Commits:
  - `fix:` → PATCH | `feat:` → MINOR | `release:` → MAJOR

---

## Roles

| Role | Access |
|---|---|
| Guest (anonymous) | Public website, booking flow, intercom |
| Front Desk | Dashboard — all except Settings admin functions |
| Admin | Full dashboard including Settings, staff accounts, rate management |

See `features/AUTH-ROLES.md` for full implementation details.
