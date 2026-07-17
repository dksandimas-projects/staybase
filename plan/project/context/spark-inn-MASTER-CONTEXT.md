# SPARK INN — MASTER CONTEXT FILE
### Business context + documentation index for continuing work in a new session
> **How to use:** This file holds the business context that no other MD owns (client, personas, goals, positioning, contract terms) plus pointers to every canonical technical document. It is an **index and summary, not a copy** — technical facts live in the canonical docs listed in §Documentation Map.
> Load this only for planning, cross-feature work, or when bootstrapping a session without repo context. For implementation tasks, follow the read bundles in `CLAUDE.md` instead.
> The original pre-build v2.2 snapshot (June 7, 2026 — includes the since-superseded data model and folder structure) is archived at `plan/project/archive/MASTER-CONTEXT-ARCHIVE-2026-06-07.md`.

---

## 1. ABOUT THIS PROJECT

**Project:** Spark Inn Hotel Booking & Management System — reference deployment of a white-label hotel booking/management system
**Client:** Spark Inn Hotel Corp
**Developer:** DK (solo freelance developer)
**Status as of July 17, 2026:** All build phases through Phase 12 substantially shipped on `dev`; staging review, production cutover (PC-05/06), and the E2E-audit HIGH fixes are the open work — see `plan/project/ROADMAP.md`
**Budget:** ₱100,000 · **Payment Terms:** 50% upfront → 25% on staging → 25% on launch
**Contract:** Software Development Agreement + Schedule A signed June 23, 2026 — Parts 1–3 coverage 100%; ~40 goodwill extras tracked in `plan/project/GOODWILL-SCOPE-LOG.md`

---

## 2. CLIENT DETAILS

| Field | Value |
|---|---|
| Legal Name | Spark Inn Hotel Corp |
| Address | J. Borja St, Tagbilaran City, Bohol, Philippines 6300 |
| Email | sparkinn.dev@gmail.com |
| Facebook / Instagram | Spark Inn / @sparkinn_official |
| Domain | sparkinnbohol.com (DK purchases as part of project) |

---

## 3. DEVELOPER PROFILE (DK)

- **Role:** Solo freelance developer — all technical decisions and code are DK's
- **Stack comfort:** React 19 + TypeScript + Firebase (strong JS/TS background)
- **Email:** dksandimas@gmail.com · **Project folder:** `/Spark Inn/` (Branding/, Documents/, Stitch/)

**How to collaborate with DK:** He is the sole developer — all explanations and code should be developer-facing, not simplified. Never re-ask questions that have already been decided (`plan/docs/DECISIONS-ARCH.md` + `plan/docs/DECISIONS-FEATURES.md`). Check context files before asking anything.

---

## 4. SYSTEM OVERVIEW

Two React + Vite apps sharing one Firebase project, hosted on Vercel:

| App | Target URL | Audience |
|---|---|---|
| `guest-app/` — public website + `/api` routes | `www.sparkinnbohol.com` | Tourists, corporate guests |
| `admin-app/` — front desk dashboard | `admin.sparkinnbohol.com` | Hotel staff (admin-created accounts only) |

Stack, architecture, and hard rules: **`CLAUDE.md`** (canonical). Folder layout: `plan/docs/FILE-STRUCTURE.md`. Staging/production project split: `plan/project/PROD-CUTOVER-RUNBOOK.md`.

---

## 5. ROOM INVENTORY (14 rooms)

| Room # | Type |
|---|---|
| Room 201 | Single |
| Rooms 101, 103, 207 | Standard Double |
| Rooms 102, 104, 105, 206, 208, 209 | Standard Twin |
| Room 202 | Executive / Deluxe |
| Rooms 203, 204, 205 | Family |

Room types are runtime-dynamic (`settings/hotelConfig.roomTypes[]`) — never hardcode counts or type strings (see `plan/docs/GOTCHAS.md §White-Label`).

---

## 6. PROBLEM STATEMENT

**What's broken today:** The hotel runs all operations through two Excel files — a booking monitor and a guest registration form. Bookings arrive via Facebook message, phone call, and walk-ins. Staff manually copy entries into the spreadsheet, cross-check availability by eye, and confirm with guests over chat. This causes:
- Overbooking risk — no real-time lock, two staff can accept the same room simultaneously (the Excel data includes an "OVERBOOKED" flag — real incidents happened; availability locking with Firestore transactions is non-negotiable)
- Zero automated communication — every email or message is typed manually per booking
- No payment tracking — staff note GCash or PayPal receipts in free-text cells, no audit trail
- No guest data structure — repeat guests have no history, loyalty is unrecognized
- High admin overhead — front desk spends significant hours per week on tasks the system automates

**What success looks like:** Guests can find, check availability, and book a room on their phone in under 3 minutes, receive automated confirmations, and check in without paperwork. Front desk sees today's arrivals, housekeeping status, and pending payments on one screen. The owner has a live report of occupancy and revenue without opening Excel.

**Excel workflow being replaced:** `INQUIRIES & BOOKING MONITOR.xlsx` (TODAY VIEW → Dashboard Overview; BOOKINGS → Bookings Management; CALENDAR SHEET → Calendar view; SUMMARY → Reports; ROOM LIST → Room Management; MASTER LOG → Corporate Inquiries) and `GUEST REGISTRATION FORM & HOUSE RULES AGREEMENT.xlsx` (→ jsPDF registration form at check-in). Booking sources tracked in Excel — Facebook, Walk-in, Phone Call — are replicated as the booking `source` field.

---

## 7. TARGET AUDIENCE & USER PERSONAS

- **Primary — Domestic Tourist** (22–45, mobile-first 80%+, high tech comfort): wants to book a clean, affordable, reliable room quickly without calling anyone. Cares about clear photos, honest pricing, GCash payment, fast confirmation. Pain: can't see availability without messaging on Facebook and waiting.
- **Secondary — Corporate / Business Traveler** (28–55, government/NGO/business visiting Tagbilaran): books multiple rooms, needs a formal booking reference and consistent pricing for reimbursement/billing. Cares about corporate rates and proximity to city center.
- **Tertiary — International Tourist** (25–60, primarily Korean, Chinese, Australian): wants a boutique hotel that feels local; needs an English-language site with online booking, no phone calls.
- **Admin — Front Desk Staff** (2–3 staff on rotation, desktop/tablet, moderate tech comfort — Excel users): needs today's arrivals, payment confirmation, and walk-in handling without errors. Cares about speed, clarity, no double-booking, easy receipt printing.

---

## 8. BUSINESS GOALS & SUCCESS METRICS

| Goal | Metric | Target |
|---|---|---|
| Eliminate overbooking | Overbooking incidents per month | 0 from launch day |
| Increase direct bookings | % of bookings via website vs phone/Facebook | 50% within 3 months of launch |
| Reduce admin overhead | Hours/week on manual booking admin | −60% |
| Guest communication | % of confirmation emails sent automatically | 100% — zero manual emails |
| Payment tracking | Outstanding payment visibility | Real-time — zero missed payments |
| Guest loyalty | Spark Rewards signups in first 6 months | 50+ members |
| Corporate pipeline | Inquiries converted to bookings | Track conversion from month 1 |

---

## 9. COMPETITIVE POSITIONING

**Competitors in Bohol:** large chains (Bohol Beach Club, Henann, Amorita — higher price, OTA-listed), budget guesthouses/hostels (inconsistent quality), Airbnb/Agoda apartments (no front desk).

**Spark Inn's position:** Boutique mid-range hotel for travelers who want a clean, consistent, genuinely hospitable stay without chain prices. Not the cheapest, not the flashiest — the most *reliable*.

**Differentiators:** Tagbilaran City center location · warm intentional service · direct booking with no OTA markup · corporate-ready rates and pipeline · QR-based in-room communication.

**Positioning statement:** *"A peaceful, consistent stay where comfort is felt and care is intentional — Bohol's boutique hotel for travelers who value reliability over spectacle."*

---

## 10. MARKETING & GROWTH PLAN

- **Phase 1 — Launch (Month 1–2):** Facebook Page (primary discovery), Google Business Profile (local SEO), on-site SEO (JSON-LD, per-page meta, sitemap — shipped in Phase 11.9), announce to repeat guests.
- **Phase 2 — Growth (Month 3–6):** OTA listings (Booking.com, Agoda) as secondary channel with "book direct for best price" note; corporate outreach to local government/NGOs/businesses; Spark Rewards promotion; Instagram.
- **Phase 3 — Scale:** PayMongo integration; WhatsApp business integration; white-label expansion to other boutique hotels in Visayas/Mindanao.

**Who manages marketing:** Hotel owner/admin — DK provides the website, SEO foundation, and social link structure; content creation and posting is the client's responsibility.

---

## 11. POST-LAUNCH SUPPORT & IP OWNERSHIP

| Type | Response time | Scope |
|---|---|---|
| Critical bugs (broken flows, data loss) | Within 24 hours | Included for 30 days post-launch |
| Minor bugs (UI glitches, non-blocking) | Within 5 business days | Included for 30 days post-launch |
| New features / scope changes | Quoted separately | Not included in base project |

After the 30-day warranty, continued support requires a monthly maintenance retainer (minor fixes, `npm audit` dependency updates, one minor change request per month).

**IP:** DK retains full IP over the codebase and white-label system; Spark Inn Hotel Corp receives a perpetual, non-transferable license to the deployed instance; client assets (logos, photos, brand) remain the client's; DK may white-label the codebase for other hotels. Full terms: `plan/docs/LEGAL.md`.

---

## 12. DECISIONS

All product, architecture, and compliance decisions are canonically logged in **`plan/docs/DECISIONS-ARCH.md`** and **`plan/docs/DECISIONS-FEATURES.md`** — check there before asking anything. Highlights that shape everything else: Firebase Auth + Firestore + Storage only (no Hosting, no Cloud Functions); Vercel hosting with a single catch-all API route; manual payment-proof flow in Phase 1 (PayMongo deferred); Senior/PWD 20% legally mandated discounts; RA 10173 compliance (consent gate, DPO, NPC 72-hour breach notification, erasure on request); white-label = one codebase, separate deployment per client, all brand values in `hotel.config.ts`. The pre-build decisions table (June 2026 snapshot) is preserved in the archived copy.

---

## 13. FEATURE SCOPE & STATUS

- **Public site:** homepage, rooms, about, corporate stays + `/corporate/book`, contact, 4-step booking flow, guest intercom (QR chat + Spark Essentials store), `/my-booking` lookup, sign-in/up + member portal (Spark Rewards), privacy/terms, 404.
- **Dashboard:** overview, bookings management (walk-ins, folio, receipts), room management, rates, corporate inquiries, intercom inbox, reports, QR management, store management, members, settings (10 tabs), notification center.
- Per-feature scope, edge cases, and QA checklists: the relevant `plan/features/*.md` (indexed in `CLAUDE.md §Table of Contents`).
- Current build status and open work: `plan/project/ROADMAP.md`. Email trigger list: `plan/features/EMAIL-PDF-STORAGE.md` + `plan/features/EMAIL-AUDIT-EXTENSIONS.md`.

---

## 14. BRAND IDENTITY (CORE)

| Field | Value |
|---|---|
| Brand name (always written) | `spark inn` — all lowercase. Never "Spark Inn" or "SPARK INN" in UI copy |
| Tagline | "Where comfort is felt, care is intentional, and every stay is consistent." |
| Pillars | Comfort is felt · Care is intentional · Every stay is consistent |
| Primary color | Spark Orange `#EA8A1A` (all CTAs) · Ember Black `#000000` |
| Typefaces | Apollo (display/headings, sole brand typeface) · Inter (all UI/body) |

**Voice:** warm, peaceful, intentional, consistent. Lead with how guests **feel**; simple direct sentences; contractions fine; never "best"/"luxury" without specifics; no urgency language ("Book NOW!", fake countdowns, "X people viewing").

Canonical design tokens, type scale, logo rules, status-badge colors, breakpoints, and component conventions: **`plan/docs/FRONTEND.md`**. Brand asset files: `/Spark Inn/Branding/` (see archived snapshot §23 for the full file listing).

---

## 15. NON-FUNCTIONAL REQUIREMENTS

| Requirement | Target |
|---|---|
| Public pages performance | < 3s on 4G mobile |
| Dashboard performance | < 2s |
| Receipt PDF generation | < 3s |
| Mobile-first breakpoint | 375px · Dashboard minimum 768px |
| Uptime target | 99.5% |
| Security | Auth-protected dashboard, no public PII exposure, session management (`plan/docs/SECURITY.md`) |
| QR chat | Any browser, no app, no login |

**BIR receipts:** NOT generated by the system — the receipt is a "Booking Confirmation Receipt" only; official BIR receipts are issued manually with physical booklets (footer text states this).

---

## 16. DOCUMENTATION MAP (CANONICAL SOURCES)

| Information | Canonical home |
|---|---|
| Agent instructions, read bundles, hard rules, MD index | `CLAUDE.md` |
| Current build order and open work | `plan/project/ROADMAP.md` |
| Firestore schema + security rules | `plan/docs/BACKEND.md` |
| TypeScript types | `plan/docs/TYPES.md` |
| API route surface | `plan/docs/API-ROUTES.md` |
| Design system, brand tokens, UX philosophy, accessibility | `plan/docs/FRONTEND.md` |
| Decisions (arch / product) | `plan/docs/DECISIONS-ARCH.md` / `plan/docs/DECISIONS-FEATURES.md` |
| Security, PII, RA 10173 | `plan/docs/SECURITY.md` |
| Never-do rules | `plan/docs/GOTCHAS.md` |
| Ownership table, budgets, sync protocol | `plan/docs/CONTRIBUTING.md` |
| Setup / deploy / cutover | `plan/project/SETUP-GUIDE.md` / `plan/project/DEPLOY.md` / `plan/project/PROD-CUTOVER-RUNBOOK.md` |
| QA scenarios | `plan/project/QA-SCENARIOS.md` |
| Contract goodwill tracking | `plan/project/GOODWILL-SCOPE-LOG.md` |

---

*Spark Inn Master Context File — v3.0 — July 17, 2026 — compacted to index + business context; v2.2 pre-build snapshot archived.*
