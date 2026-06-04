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
| 7 | No automated tests — manual QA only |
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
| 31 | Room types fully flexible — defined as array in `hotel.config.ts → roomTypes[]`, not a fixed enum |
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
