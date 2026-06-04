# Spark Inn — MD System Build Plan
> v2.0 — June 2, 2026
> Reference `spark-inn-MASTER-CONTEXT.md` for all project details.
> All decisions finalized — no open questions.

---

## Context

We are building a structured MD documentation system for the Spark Inn hotel booking system. These MDs are the context files that AI coding agents (Claude Code, Gemini CLI, OpenAI Codex) will read when building the actual codebase. They are not the codebase itself.

---

## Architecture Decisions (all finalized)

| Decision | Ruling |
|---|---|
| Firebase usage | Auth + Firestore + Storage ONLY — no Firebase Hosting, no Cloud Functions |
| Hosting | Vercel — hosts guest-app, admin-app, and API routes |
| API strategy | Single Vercel catch-all `/api/[...route].ts` — consolidates all server-side logic (including email via Resend) |
| Shared code | `shared/` folder at repo root — imported via `@shared/*` Vite path alias in both apps |
| Repo path | `/Users/danielkennethsandimas/GitHub/spark-inn` |
| Testing | No test files or TESTING.md — manual QA only |
| MD format | High-level spec only — no code snippets. Rules, structure, constraints, and checklists |
| MD depth | Four sections per feature MD: UI Checklist + Data & Logic Checklist + Edge Cases + Manual QA |

---

## MD Format — Every Feature MD Uses This Template

```
# Feature Name
> App: guest-app | admin-app | both
> Requires: CLAUDE.md, [other MDs to read first]
> Design ref: spark-inn-design-spec.md §[section]

## Overview
One paragraph — what this feature does and why it matters.

## UI Checklist
- [ ] Component / layout item
- [ ] Interaction / state / variant

## Data & Logic Checklist
- [ ] Firestore query / mutation
- [ ] API call / business rule / validation

## Edge Cases & States
- [ ] Loading state
- [ ] Empty state
- [ ] Error handling
- [ ] Validation rules

## Manual QA
- [ ] Thing to verify manually before marking feature done

## References
- Related MDs (link, don't repeat content)
- Design spec section
```

---

## Token Efficiency Rules (apply to ALL MDs)

- Each piece of information lives in exactly ONE MD — feature MDs reference, never repeat
- `BACKEND.md` owns Firestore schema — feature MDs say "see BACKEND.md §rooms", never re-document schema
- `TYPES.md` owns all TypeScript types — never redefine types elsewhere
- `DECISIONS.md` owns all resolved decisions — one line each, no explanation
- `GOTCHAS.md` owns all "never do this" rules — agents check this first
- Every MD starts with `> Requires:` so agents load only what they need
- `CLAUDE.md` defines read bundles — agents load the bundle for their task type, not all MDs

---

## Read Bundles (defined in CLAUDE.md)

| Task type | Read these MDs |
|---|---|
| Guest UI task | `FRONTEND.md` + `guest-app/CLAUDE.md` + relevant feature MD |
| Admin UI task | `FRONTEND.md` + `admin-app/CLAUDE.md` + relevant feature MD |
| Data / API task | `BACKEND.md` + `TYPES.md` + `API-ROUTES.md` |
| Full feature build | All of the above |
| Auth / roles | `AUTH-ROLES.md` + `BACKEND.md` |
| Availability / booking | `AVAILABILITY-LOCKING.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Corporate booking | `CORPORATE-BOOKING.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Vouchers | `VOUCHERS.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Email / PDF | `EMAIL-PDF-STORAGE.md` + `API-ROUTES.md` |

---

## Complete File List — 34 Files

### Root (3 files)
```
spark-inn/
├── CLAUDE.md          ← Master TOC + stack overview + read bundles + hard rules
├── GEMINI.md          ← One line: "See CLAUDE.md for full project context."
└── AGENTS.md          ← One line: "See CLAUDE.md for full project context."
```

### docs/ (9 files)
```
docs/
├── FRONTEND.md        ← Brand tokens, Tailwind config, component conventions, Framer Motion, breakpoints
├── BACKEND.md         ← Firestore schema (all 8 collections), security rules, Firebase SDK usage
├── API-ROUTES.md      ← Vercel API surface, catch-all pattern, auth headers, Resend email routes, request/response shapes
├── TYPES.md           ← Canonical TypeScript types for all shared models (Room, Booking, Guest, Voucher, CorporateCode, etc.)
├── ENV-SETUP.md       ← All environment variables across guest-app, admin-app, api/
├── FILE-STRUCTURE.md  ← Full folder tree, naming conventions, what goes where
├── DECISIONS.md       ← All resolved decisions, one line each
├── GOTCHAS.md         ← What agents must never do
└── CONTRIBUTING.md    ← How to update MDs: ownership rules, update triggers, process, no-repetition enforcement
```

### App CLAUDEs (2 files)
```
guest-app/
└── CLAUDE.md          ← Guest app: pages, routing, Firebase reads, booking flow summary, conventions

admin-app/
└── CLAUDE.md          ← Admin app: pages, auth guards, role-based access, dashboard conventions
```

### features/ (20 files)

```
features/
│
│  ── Guest App (7) ──
├── HOMEPAGE.md              ← Hero, availability checker, featured rooms, amenities, map, footer
├── ROOMS-PAGE.md            ← Room grid, filters, availability badges, room detail modal
├── BOOKING-FLOW.md          ← 4 steps: Select Room → Guest Details → Review & Pay (incl. voucher) → Confirmation
├── CORPORATE-BOOKING.md     ← /corporate/book: flat rate + access code flow, corporate skin, company name field
├── BOOKING-LOOKUP.md        ← /my-booking: ref + email lookup, view status, cancel, resend email
├── INTERCOM-GUEST.md        ← QR scan → browser chat, quick request panel, no login, room # from URL param
├── STATIC-PAGES.md          ← About Us + Corporate Stays (marketing) + Contact Us + 404
│
│  ── Admin App (11) ──
├── AUTH-ROLES.md            ← Firebase Auth, Login page, protected routes, front-desk vs admin roles
├── DASHBOARD-OVERVIEW.md    ← Stat cards, 14-room status grid, housekeeping toggle, today's arrivals/checkouts, pending payments
├── BOOKINGS-MANAGEMENT.md   ← Full booking table, filters, drawer, status actions, receipt PDF, walk-in booking creation
├── ROOM-MANAGEMENT.md       ← Edit 14 rooms, photos upload, status, block reason, active toggle
├── RATE-MANAGEMENT.md       ← Room rates, weekend rates, flat corporate rate, discount rules, payment methods config
├── CORPORATE-INQUIRIES.md   ← Inquiry form → pipeline: New → Contacted → Negotiating → Converted → Declined; generate access code
├── VOUCHERS.md              ← Promo voucher management: create, set limits, view usage, enable/disable
├── REPORTS.md               ← Occupancy, revenue, bookings by source; Recharts; PDF/CSV export
├── INTERCOM-INBOX.md        ← Chat list + thread view, quick request badges, notification sound, tab unread count, mark resolved
├── QR-MANAGEMENT.md         ← QR per room, regenerate, print single/all (4-up A4 layout)
└── SETTINGS.md              ← Hotel info, payment methods, email config, staff accounts, discount rules, vouchers, quick requests, website content tab
│
│  ── Cross-cutting (2) ──
├── AVAILABILITY-LOCKING.md  ← Double-booking prevention, Firestore transactions, conflict detection (critical)
└── EMAIL-PDF-STORAGE.md     ← Resend email flows (6 triggers), jsPDF receipt + registration form, Firebase Storage upload
```

---

## .project/ Folder Structure
```
.project/
├── branding/          ← Logos, fonts (.otf, .ai, .eps, .png) — in .gitignore
├── design/            ← spark-inn-design-spec.md, DESIGN.md, Stitch mockups — tracked
└── documents/         ← Proposals, PRD, Excel files (.docx, .xlsx) — in .gitignore
```

---

## .gitignore Entries
```
# Project assets (large binaries — keep local only)
.project/branding/
.project/documents/

# Env files
.env
.env.local
guest-app/.env
admin-app/.env
api/.env

# Build outputs
dist/
node_modules/
.vercel/
```

---

## Build Order

1. Root files — `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`
2. `docs/` — FRONTEND, BACKEND, API-ROUTES, TYPES, ENV-SETUP, FILE-STRUCTURE, DECISIONS, GOTCHAS, CONTRIBUTING
3. App CLAUDEs — `guest-app/CLAUDE.md`, `admin-app/CLAUDE.md`
4. `features/` — guest first (7), then admin (11), then cross-cutting (2)
5. `.project/` folder structure + `.gitignore`

---

## Changes from v1.0 (30 files → 34 files)

| Change | Detail |
|---|---|
| +4 new feature MDs | `CORPORATE-BOOKING.md`, `BOOKING-LOOKUP.md`, `REPORTS.md`, `VOUCHERS.md` |
| Hosting updated | Firebase Hosting → Vercel |
| API updated | Firebase Cloud Functions → Vercel catch-all API route |
| Email updated | Cloud Functions + Resend → Vercel API route + Resend |
| BACKEND.md expanded | +2 new collections: `corporateCodes`, `vouchers` |
| TYPES.md expanded | +types for Voucher, CorporateCode |
| BOOKING-FLOW.md expanded | +voucher code input in Step 3 |
| DASHBOARD-OVERVIEW.md expanded | +housekeeping status toggle per room |
| BOOKINGS-MANAGEMENT.md expanded | +walk-in / manual booking creation |
| RATE-MANAGEMENT.md expanded | +flat corporate rate per room type |
| CORPORATE-INQUIRIES.md expanded | +generate access code action |
| INTERCOM-GUEST.md expanded | +quick request panel, configurable items |
| INTERCOM-INBOX.md expanded | +notification sound, quick request badge rendering, tab unread count |
| SETTINGS.md expanded | +website content tab, quick request items config, notification sound, voucher management |
| STATIC-PAGES.md expanded | Corporate marketing page now includes CTA to `/corporate/book` |

---

*MD Plan v2.0 — June 2, 2026*
*Total: 34 MD files — no code snippets, high-level spec + checklists only*
*`spark-inn-features.md` superseded by `spark-inn-MASTER-CONTEXT.md` v2.0*
