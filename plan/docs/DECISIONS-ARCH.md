# Architecture & Stack Decisions
> Requires: CLAUDE.md

Resolved architecture, infrastructure, tooling, code conventions, security model, and white-label decisions. Load this when building anything — these apply globally.

For feature/product decisions see `plan/docs/DECISIONS-FEATURES.md`.

---

| # | Decision |
|---|---|
| 1 | Hosting: single Vercel project (monorepo) — guest-app + api/ deployed together, admin-app as a second deployment from the same project |
| 2 | Firebase usage: Auth + Firestore + Storage ONLY — no Firebase Hosting, no Cloud Functions |
| 3 | API: Single Vercel catch-all `/api/[...route].ts` living inside `guest-app/` — deployed as part of the guest app Vercel deployment |
| 4 | Email: Resend via Vercel API routes (not Firebase Cloud Functions) |
| 5 | Shared code: `shared/` is an npm workspace package (`@spark-inn/shared`) — imported by both apps and api/ without path alias hacks |
| 6 | Two separate React + Vite apps — `guest-app/` and `admin-app/` — sharing one Firebase project |
| 7 | Targeted tests only — manual QA for everything except 10 critical logic areas (see below); no full test suite |
| 8 | Data fetching: TanStack Query for API routes; custom Firebase hooks for Firestore real-time |
| 9 | Validation: Zod for all form and data validation |
| 10 | State management: React state + Context only — no Zustand or Jotai |
| 11 | Exports: named exports for components/hooks, default exports for pages |
| 12 | Naming: PascalCase components, camelCase hooks/utils, kebab-case files/folders |
| 13 | Branching: `main` (prod only) → `dev` (working) → `feature/*` and `fix/*` off dev |
| 14 | Never commit directly to `main` — merge only at milestones |
| 15 | Versioning: semantic `v[MAJOR].[MINOR].[PATCH]` starting at `v0.1.0` |
| 16 | VERSION constant in `shared/VERSION.ts` — displayed in footer of all pages |
| 17 | Auto version bump: Husky + Conventional Commits — `fix:` PATCH, `feat:` MINOR, `release:` MAJOR |
| 18 | Availability locking: Firestore transactions required for booking creation — never read-then-write |
| 19 | Payment proof screenshots: Storage rules restrict read to authenticated staff only — never public |
| 20 | Rate limiting required on public API endpoints: booking creation, voucher/code validation, email resend |
| 21 | Firebase API keys restricted to `sparkinnbohol.com` and `admin.sparkinnbohol.com` domains in Firebase Console |
| 22 | Bot prevention: Cloudflare Turnstile (free, invisible) + honeypot fields + rate limiting — no paid services |
| 23 | Turnstile applies to: booking creation, voucher validation, corporate code validation, corporate inquiry form |
| 24 | Honeypot field name: `_hp` — hidden via CSS, silently rejected server-side if filled |
| 25 | White-label architecture: one codebase, separate deployment per hotel client (not multi-tenant) |
| 26 | All brand values (colors, fonts, logos, name) in `hotel.config.ts` at repo root — never hardcoded |
| 27 | Tailwind tokens use config-mapped names (`primary`, `primary-dark`, etc.) — never raw hex in components |
| 28 | Hotel-specific brand assets in `public/brand/` per app — swap folder contents per client deployment |
| 29 | Room count is dynamic — read from Firestore, never hardcoded in any feature |
| 30 | `hotel.config.ts` imported via `@config` alias in both apps |
| 31 | Room types fully flexible — defined dynamically in Settings UI (prefilled from `hotel.config.ts`), not a fixed enum |
| 32 | Currency, locale, timezone, date format all config-driven — never hardcoded |
| 33 | Booking reference prefix configurable per hotel in `hotel.config.ts → bookingRefPrefix` |
| 34 | Deploy-time legal fields (legal name, DPO email, applicable law) in `hotel.config.ts` — require redeploy to change |
| 35 | Page titles: `{config.pageTitle} | {Page Name}` on all pages |
| 36 | Open Graph meta on all public pages — populated from `hotel.config.ts` |
| 37 | Google Analytics 4 injected only when `config.analyticsId` is non-empty |
| 38 | WhatsApp contact link shown only when `config.whatsappNumber` is non-empty |
| 39 | Guest auth (Spark Rewards) uses same Firebase project as admin auth — different Auth flows, different Firestore collections |
| 40 | Google Sign-In uses Firebase Auth Google OAuth provider — no separate OAuth implementation needed |
| 41 | SEO: shared `<SEO>` component injects per-page title, meta description, canonical URL, full Open Graph tags, and Twitter card on all public pages — noindex on confirmation, my-booking, account, and 404 pages |
| 42 | SEO: `LodgingBusiness` JSON-LD structured data on homepage; `HotelRoom` JSON-LD on rooms page — all values sourced from config + Firestore, never hardcoded |
| 43 | SEO: static `sitemap.xml` and `robots.txt` generated at build time in `guest-app/public/` — sitemap covers 7 public routes only, no dynamic booking or user paths |
| 44 | guest-app is built as a PWA (Progressive Web App) from day one — `manifest.json` + service worker via `vite-plugin-pwa` — enables home screen install and offline shell; no extra runtime cost |
| 45 | PWA service worker caches app shell + static assets only (Workbox `NetworkFirst` for dynamic data) — Firestore real-time stays live; cache is for load speed and offline fallback only |
| 46 | PWA is Capacitor-ready by design — if a native iOS/Android app is ever needed, `npx cap init` + `npx cap add ios` wraps the existing web app without a rewrite; no native APIs are used that would break this path |
| 47 | admin-app is NOT a PWA — it is staff-only, always on a reliable connection, no install or offline use case |
| 48 | Intercom voice call: WebRTC peer-to-peer audio via browser — signaling over Firestore (`calls/{roomId}` document for SDP offer/answer exchange) — zero third-party cost; fallback is a `tel:` link if WebRTC is unavailable |

---

## Testing Strategy

Manual QA for all UI, flows, and integration scenarios. Automated tests for the 10 logic areas where silent failures would cause financial errors or data corruption.

**Test runner:** Vitest (already compatible with Vite — no extra config)
**Integration tests:** Firebase Local Emulator Suite (`firebase emulators:start`) — no live project needed

---

### Unit Tests — `shared/utils/` (pure functions, no Firebase)

| # | File | What to cover |
|---|---|---|
| U-1 | `shared/utils/pricing.ts` | Base rate × nights; breakfast rate × guests × nights; member discount %; Senior/PWD 20%; voucher percent (applied after discount); voucher flat (never below ₱0); points redemption value; corporate rate override; correct order of operations across all combinations |
| U-2 | `shared/utils/dates.ts` | `numNights` (checkOut − checkIn, never negative); weekend night detection (which specific nights fall Sat/Sun, timezone-aware using `config.timezone`); date overlap check (`checkIn < b.checkOut && checkOut > b.checkIn`) |
| U-3 | `shared/utils/points.ts` | Per-booking earning (flat `pointsPerBooking`); per-spend earning (`floor(totalPrice / 100) × pointsPerHundred`); redemption value (`points × rate / 100`); insufficient balance returns error |
| U-4 | `shared/utils/references.ts` | Booking ref format (`{prefix}-YYYYMMDD-NNN`); zero-padding to 3 digits; member number format (`{prefix}-NNNNN`, 5 digits); store order ref (`SO-YYYYMMDD-NNN`); same-day counter increments correctly |
| U-5 | `shared/utils/vouchers.ts` | `isActive: false` → rejected; expired (`expiresAt < now`) → rejected; usage cap at exact limit → rejected; `usageCap: null` (unlimited) → accepted; room type mismatch → rejected; empty `applicableRoomTypes` → accepted for all types; flat discount > total → ₱0 floor; percent calculation correct |

---

### Integration Tests — API routes (Firebase emulator required)

| # | Route | What to cover |
|---|---|---|
| I-1 | `/api/bookings/create` | Two simultaneous requests same room + dates → only one succeeds, other returns conflict error; room blocked mid-flow (between Step 1 and submission) → transaction rejects; timeout/abort → no booking created (idempotent, no partial writes) |
| I-2 | `/api/store/confirm-order` | Stock decrements on status → `confirmed`; stock restored on cancel before `confirmed`; two concurrent orders for last item in stock → one succeeds, one returns out-of-stock error; `stock: null` (unlimited) → no decrement ever |
| I-3 | `/api/members/redeem-points` | Insufficient balance → rejected with error; `totalPrice` updated correctly after redemption; member `rewardsPoints` deducted; `pointsHistory` entry created with correct type + bookingId; undo restores both `totalPrice` and member balance; undo after check-in → rejected |
| I-4 | `/api/validate/corporate-code` + `/api/bookings/create` | `usageCount` increments on successful booking; usage cap hit → subsequent validation rejected; expired code (`expiresAt < now`) → rejected; `isActive: false` → rejected |

---

### What is NOT tested (manual QA only)

UI components, page layouts, navigation, drawers, modals, static pages, email templates, PDF generation, chart rendering, Firestore `onSnapshot` wiring, Storage upload flows, admin status transitions, and all Spark Rewards portal screens. These are all well-covered by the Manual QA checklists in each feature MD.
