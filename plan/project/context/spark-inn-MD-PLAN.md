# Spark Inn — MD System Reference
> **📁 HISTORICAL REFERENCE (v3.0, June 4, 2026) — non-canonical, do not load during normal implementation tasks.** Describes the MD system as originally designed; file counts and structure have drifted since. Canonical index: `CLAUDE.md` §Table of Contents · ownership + budgets: `plan/docs/CONTRIBUTING.md`.
> v3.0 — June 4, 2026
> Reference `spark-inn-MASTER-CONTEXT.md` for all project details.
> All decisions finalized — no open questions.

---

## What This File Is

A reference document describing the MD documentation system built for Spark Inn. Records what files exist, what decisions were made, and what changed from earlier versions. Used to orient new sessions and audit completeness.

---

## Architecture Decisions (all finalized)

| Decision | Ruling |
|---|---|
| Firebase usage | Auth + Firestore + Storage ONLY — no Firebase Hosting, no Cloud Functions |
| Hosting | Vercel — hosts guest-app, admin-app, and API routes |
| API strategy | Single Vercel catch-all `/api/[...route].ts` inside `guest-app/` |
| Shared code | `shared/` npm workspace package (`@spark-inn/shared`) — types, utils, constants, animations, VERSION |
| Repo path | `/Users/danielkennethsandimas/GitHub/spark-inn` |
| Testing | Targeted tests only — Vitest unit tests for 5 pure function areas + 4 integration tests via Firebase emulator; manual QA for everything else. See `plan/docs/DECISIONS-ARCH.md §Testing Strategy` |
| MD format | High-level spec only — no code snippets in feature MDs. Exceptions: `FRONTEND.md §Animations` includes Framer Motion variant definitions; `DECISIONS-ARCH.md §Testing Strategy` includes test coverage tables |
| MD depth | Four sections per feature MD: UI Checklist + Data & Logic Checklist + Edge Cases + Manual QA |
| White-label | One codebase, separate deployment per hotel client — all brand values in `hotel.config.ts`, runtime content in Firestore Settings |
| PWA | guest-app built as PWA from day one (`vite-plugin-pwa`) — Capacitor-ready for future native app |
| Animations | Framer Motion — shared variants in `shared/animations.ts`, premium/calm aesthetic, reduced motion respected |
| SEO | Shared `<SEO>` component, JSON-LD structured data (LodgingBusiness + HotelRoom), static sitemap + robots.txt |

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
```

---

## Token Efficiency Rules (apply to ALL MDs)

- Each piece of information lives in exactly ONE MD — feature MDs reference, never repeat
- `BACKEND.md` owns Firestore schema — feature MDs say "see BACKEND.md §rooms", never re-document schema
- `TYPES.md` owns all TypeScript types — never redefine types elsewhere
- `DECISIONS-ARCH.md` owns architecture/stack/security decisions — one line each
- `DECISIONS-FEATURES.md` owns product/feature/compliance decisions — one line each
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
| Full feature build | All of the above + `DECISIONS-FEATURES.md` |
| Auth / roles | `AUTH-ROLES.md` + `BACKEND.md` |
| Availability / booking | `AVAILABILITY-LOCKING.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Corporate booking | `CORPORATE-BOOKING.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Vouchers | `VOUCHERS.md` + `BOOKING-FLOW.md` + `BACKEND.md` |
| Email / PDF | `EMAIL-PDF-STORAGE.md` + `API-ROUTES.md` |
| Security / PII | `SECURITY.md` + `GOTCHAS.md` + `DECISIONS-FEATURES.md` |
| White-label deployment | `WHITE-LABEL.md` + `DECISIONS-ARCH.md` |
| Spark Rewards / member auth | `SPARK-REWARDS.md` + `BACKEND.md` |
| Spark Essentials store | `STORE-GUEST.md` + `STORE-MANAGEMENT.md` + `BACKEND.md` |
| Wireframe task | `WIREFRAME-WORKFLOW.md` + `FRONTEND.md` + relevant feature MD |

---

## Complete File List — 42 Files

### Root (4 files)
```
spark-inn/
├── CLAUDE.md        ← Master TOC + stack overview + read bundles + hard rules
├── GEMINI.md        ← One line: "See CLAUDE.md for full project context."
├── AGENTS.md        ← One line: "See CLAUDE.md for full project context."
└── README.md        ← Setup instructions + emulator docs for tests
```

### plan/docs/ (13 files)
```
plan/docs/
├── FRONTEND.md           ← Brand tokens, Tailwind config, component conventions,
│                            animations (Framer Motion full spec), breakpoints, SEO
├── BACKEND.md            ← Firestore schema (all collections + subcollections), security rules
├── API-ROUTES.md         ← Vercel API surface, auth headers, bot prevention, rate limiting
├── TYPES.md              ← All canonical TypeScript types — Room, Booking, Member, Store,
│                            WebRTC, RewardsConfig, OnsitePayment, etc.
├── ENV-SETUP.md          ← All environment variables across guest-app, admin-app, api/
├── FILE-STRUCTURE.md     ← Full folder tree, naming conventions, shared/utils/ (5 files),
│                            shared/__tests__/ (5 files), guest-app/api/__tests__/ (4 files)
├── DECISIONS-ARCH.md     ← Architecture, stack, tooling, security, white-label, PWA, SEO,
│                            animation, and testing decisions (48 entries + Testing Strategy section)
├── DECISIONS-FEATURES.md ← Feature scope, product rules, compliance, business logic (73 entries)
├── GOTCHAS.md            ← What agents must never do
├── CONTRIBUTING.md       ← MD ownership, update triggers, branching, commit conventions,
│                            deploy checklist (incl. SEO checklist)
├── SECURITY.md           ← RA 10173 compliance, PII table, Firestore/Storage rules,
│                            data retention, breach protocol
├── WHITE-LABEL.md        ← hotel.config.ts full schema (incl. address, frontDeskPhone,
│                            memberNumberPrefix, storeName), Spark Inn reference config,
│                            deploy guide, asset checklist
└── WIREFRAME-WORKFLOW.md ← Stitch → React wireframe process, component library (18 components),
                             screen checklist (38 screens), agent rules, definition of done
```

### App CLAUDEs (2 files)
```
plan/guest-app/CLAUDE.md  ← Pages, routing, Firebase reads, booking flow summary,
                             PWA setup checklist, Capacitor readiness rules, offline behavior
plan/admin-app/CLAUDE.md  ← Pages, auth guards, role-based access,
                             Firebase collections table (19 collections), component notes
```

### plan/features/ — Guest App (8 files)
```
HOMEPAGE.md          ← Hero, availability checker, featured rooms, amenities, services
                        (Tour Packages / Car Rentals), Spark Rewards promo section, map
ROOMS-PAGE.md        ← Room grid, filters, availability badges, room detail modal
BOOKING-FLOW.md      ← 4 steps: Select Room (breakfast option) → Guest Details
                        (discount ID upload) → Review & Pay (voucher, Turnstile,
                        honeypot) → Confirmation (Spark Rewards prompt)
CORPORATE-BOOKING.md ← /corporate/book: flat rate + access code, corporate skin, company fields
BOOKING-LOOKUP.md    ← /my-booking: ref + email lookup, view status, cancel, resend email
INTERCOM-GUEST.md    ← QR chat, quick requests, WebRTC voice call (full signaling spec),
                        config.storeName store tab
SPARK-REWARDS.md     ← Guest auth (Google + email/password + account linking conflict handling),
                        member portal (My Profile with SR-XXXXX card, My Stays, My Rewards),
                        points earning display, early check-in perk, admin member management
STATIC-PAGES.md      ← About Us, Corporate Stays marketing, Contact Us, Privacy Policy, 404
```

### plan/features/ — Admin App (12 files)
```
AUTH-ROLES.md            ← Email/password login, forgot password flow, protected routes,
                            Front Desk vs Admin roles, Firebase custom claims
DASHBOARD-OVERVIEW.md    ← Stat cards, room status grid, housekeeping toggle,
                            arrivals/checkouts, pending payments
BOOKINGS-MANAGEMENT.md   ← Booking table, detail drawer with:
                            - Discount ID verification / rejection (3-state control)
                            - Points redemption panel (admin only)
                            - Onsite additional payments log (append-only)
                            - Guest ID upload
                            - Breakfast selections panel
                            - Walk-in booking creation
ROOM-MANAGEMENT.md       ← Edit rooms, photos, status, block reason, active toggle
RATE-MANAGEMENT.md       ← Room rates, weekend rates, corporate rate, discounts, payment methods
CORPORATE-INQUIRIES.md   ← Inquiry pipeline, notes log, access code generation
VOUCHERS.md              ← Promo voucher management: create, limits, usage, enable/disable
REPORTS.md               ← Tab 1: Performance (occupancy, sources)
                            Tab 2: Sales (room + breakfast + store consolidated,
                                   charts, detail tables, Sales PDF, Sales XLSX 4-sheet)
                            Breakfast kitchen prep report
                            Store low-stock alerts
                            Full Data Backup XLSX (8-sheet, admin only)
                            Manual QA checklists for all sections
INTERCOM-INBOX.md        ← Chat list, thread, quick request badges,
                            WebRTC incoming call banner (Accept/Decline/Hang Up),
                            notification sound, tab unread count
QR-MANAGEMENT.md         ← QR per room, regenerate, print
SETTINGS.md              ← 11 tabs: Hotel Info · Payment Methods · Email · Staff Accounts
                            · Discount Rules · Vouchers · Intercom · Website Content
                            · Breakfast · Store (config.storeName) · Spark Rewards
                            (points earning toggle + mode + rate, member discount toggle + %,
                             redemption rate, program name)
SPARK-REWARDS.md         ← (also covers admin) Member management page, member detail drawer,
                            manual points adjustment with audit trail, disable/enable account
```

### plan/features/ — Cross-cutting (3 files)
```
AVAILABILITY-LOCKING.md ← Double-booking prevention, Firestore transactions, conflict detection
EMAIL-PDF-STORAGE.md    ← 7 email triggers (booking submitted, payment confirmed, booking confirmed,
                            check-in reminder, booking cancelled, corporate inquiry,
                            discount rejected — incl. full email copy spec)
                            jsPDF: booking receipt (incl. points redemption line item) +
                            guest registration PDF (guest ID embed + discount ID embed + breakfast)
                            Firebase Storage paths (14 paths)
STORE-GUEST.md          ← Guest store panel in intercom (config.storeName), item grid,
                            cart, checkout, order tracking, stock edge cases
STORE-MANAGEMENT.md     ← Catalog management, order processing,
                            stock transaction (decrement on confirm, restore on cancel),
                            store reports
```

> STORE-GUEST.md and STORE-MANAGEMENT.md are listed under cross-cutting. Total plan/features/ = 23 files.

---

## New Features Added Since v2.0

| Feature | Key MDs |
|---|---|
| Spark Rewards loyalty (auth, portal, points, card) | `SPARK-REWARDS.md`, `SETTINGS.md`, `BACKEND.md`, `TYPES.md` |
| Spark Essentials in-room store | `STORE-GUEST.md`, `STORE-MANAGEMENT.md`, `INTERCOM-GUEST.md` |
| Breakfast add-on + silog selections | `BOOKING-FLOW.md`, `BOOKINGS-MANAGEMENT.md`, `SETTINGS.md`, `REPORTS.md` |
| White-label system (hotel.config.ts full schema) | `WHITE-LABEL.md`, `FRONTEND.md`, `DECISIONS-ARCH.md` |
| Security & PII compliance (RA 10173 + RA 11862) | `SECURITY.md`, `BOOKING-FLOW.md`, `BOOKINGS-MANAGEMENT.md` |
| Guest ID + discount ID capture | `BOOKINGS-MANAGEMENT.md`, `EMAIL-PDF-STORAGE.md`, `BACKEND.md` |
| Senior/PWD ID upload + 3-state verification + rejection email | `BOOKING-FLOW.md`, `BOOKINGS-MANAGEMENT.md`, `EMAIL-PDF-STORAGE.md` |
| Onsite additional payments log (append-only) | `BOOKINGS-MANAGEMENT.md`, `BACKEND.md`, `REPORTS.md` |
| Points redemption admin-side | `BOOKINGS-MANAGEMENT.md`, `SPARK-REWARDS.md`, `SETTINGS.md` |
| Full data backup XLSX (8 sheets) | `REPORTS.md` |
| Sales Report (all revenue consolidated, PDF + XLSX) | `REPORTS.md` |
| DOT compliance (guest registry, RA 11862 record retention) | `BOOKINGS-MANAGEMENT.md`, `SECURITY.md` |
| PWA + Capacitor-ready | `guest-app/CLAUDE.md`, `DECISIONS-ARCH.md` |
| WebRTC voice call (full signaling spec + Firestore schema) | `INTERCOM-GUEST.md`, `INTERCOM-INBOX.md`, `BACKEND.md` |
| SEO (JSON-LD, sitemap, robots.txt, per-page meta, Twitter card) | `FRONTEND.md`, `WHITE-LABEL.md`, `CONTRIBUTING.md` |
| Animations (Framer Motion full spec — 14 surfaces) | `FRONTEND.md`, `FILE-STRUCTURE.md` |
| Targeted testing (Vitest + Firebase emulator, 9 test files) | `DECISIONS-ARCH.md`, `FILE-STRUCTURE.md`, `ROADMAP.md` |
| Wireframe workflow (38 screens, component library) | `WIREFRAME-WORKFLOW.md`, `ROADMAP.md` Phase 0.5 |
| Account linking (Google ↔ email/password conflict handling) | `SPARK-REWARDS.md` |
| Admin forgot password | `AUTH-ROLES.md` |
| Rewards configurable from Settings (points + discount + redemption rate) | `SETTINGS.md`, `BACKEND.md` |
| Member card SR-XXXXX format + config.memberNumberPrefix | `SPARK-REWARDS.md`, `WHITE-LABEL.md`, `BACKEND.md` |
| config.storeName white-label for store | `WHITE-LABEL.md`, `STORE-GUEST.md`, `STORE-MANAGEMENT.md` |

---

## Decisions Changed Since v2.0

| Decision | v2.0 | v3.0 |
|---|---|---|
| Testing | No automated tests — manual QA only | 5 unit + 4 integration tests (Vitest + Firebase emulator); manual QA for everything else |
| DECISIONS.md | Single file | Split into `DECISIONS-ARCH.md` (48 entries) + `DECISIONS-FEATURES.md` (73 entries) |
| Spark Rewards Phase 1 | Auth + profile + points display only | + configurable earnings, configurable member discount, SR-XXXXX card, admin-side redemption |
| Spark Rewards Phase 2 | Tiers + redemption + perks | Tiers + perks only (redemption moved to Phase 1 admin-side) |
| hotel.config.ts fields | Colors, fonts, logos, name, room types, locale, legal, SEO | + `address{}`, `frontDeskPhone`, `memberNumberPrefix`, `storeName` |
| Reports page | Single view: occupancy + revenue + sources | Two tabs (Performance + Sales) + full data backup XLSX |
| Admin forgot password | No forgot password — admin resets manually | `sendPasswordResetEmail()` on login page — same flow as guest app |

---

## File Count Summary

| Location | v2.0 | v3.0 |
|---|---|---|
| Root | 3 | 4 |
| plan/docs/ | 9 | 13 |
| App CLAUDEs | 2 | 2 |
| plan/features/ | 20 | 23 |
| **Total** | **34** | **42** |

---

*MD Plan v3.0 — June 4, 2026*
*All decisions finalized. MD system complete. Ready to build — start with Phase 0 in ROADMAP.md.*
