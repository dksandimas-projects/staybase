# guest-app — Agent Context
> Requires: CLAUDE.md, docs/FRONTEND.md

---

## Overview

The public-facing booking website at `www.sparkinnbohol.com`. Built with React 19 + TypeScript + Vite 6 + Tailwind CSS. Public booking, lookup, corporate inquiry, and intercom flows work without auth; Spark Rewards account pages use Firebase Auth for member profile, stays, rewards, and erasure flows.

The `api/` folder lives inside `guest-app/` and is deployed as Vercel serverless functions in the same deployment. It is not a separate project.

Shared types and utils are imported from `@spark-inn/shared` (npm workspace package) in both the frontend and `api/` handlers. The `api/` handlers import `hotel.config.ts` via relative path (`../../hotel.config.ts`) since they run in Node.js, not Vite.

---

## Pages & Routes

| Route | Page | Feature MD |
|---|---|---|
| `/` | `HomePage.tsx` | `plan/features/HOMEPAGE.md` |
| `/rooms` | `RoomsPage.tsx` | `plan/features/ROOMS-PAGE.md` |
| `/about` | `AboutPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/corporate` | `CorporateStaysPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/corporate/book` | `CorporateBookingPage.tsx` | `plan/features/CORPORATE-BOOKING.md` |
| `/contact` | `ContactPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/book` | `BookingPage.tsx` | `plan/features/BOOKING-FLOW.md` |
| `/book/confirm` | `BookingConfirmPage.tsx` | `plan/features/BOOKING-FLOW.md` |
| `/my-booking` | `BookingLookupPage.tsx` | `plan/features/BOOKING-LOOKUP.md` |
| `/intercom/:roomId` | `IntercomPage.tsx` | `plan/features/INTERCOM-GUEST.md` |
| `/privacy` | `PrivacyPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/terms` | `TermsPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/rewards` | `RewardsLandingPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/signin` | `SignInPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/signup` | `SignUpPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/profile` | `ProfilePage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/stays` | `StaysPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/rewards` | `RewardsPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `*` | `NotFoundPage.tsx` | `plan/features/STATIC-PAGES.md` |

---

## Firebase Usage (guest-app)

| Collection | Operation | Notes |
|---|---|---|
| `rooms` | `onSnapshot` (real-time) | Public room/type surfaces; guest client never receives staff-only `remarks` |
| `bookings` | none from guest client | Guest lookup, member stays, booking create/cancel all go through `/api/*` |
| `intercoms` | `onSnapshot` + `addDoc` | Real-time chat |
| `settings/hotelConfig` | `getDoc` | Payment methods, quick request items |
| `settings/websiteContent` | `getDoc` | Homepage/about/corporate content |
| `settings/rewardsConfig` | `getDoc` | Authenticated rewards display + booking discount mirror |
| `members/{uid}` | `onSnapshot` | Authenticated member profile |
| `members/{uid}/pointsHistory` | `onSnapshot` | Authenticated member rewards history |

No direct guest-client writes to `bookings`, `guests`, `corporateInquiries`, or admin collections. Public submissions use Vercel API routes with validation, Turnstile where required, rate limits, and Admin SDK writes.

---

## Booking Flow Summary

4-step flow in `BookingPage.tsx`. State persists across steps via React Context or URL params.

1. **Select Room** — date pickers, filters, availability results
2. **Guest Details** — personal info form (+ company fields if corporate)
3. **Review & Pay** — summary, discount selector, voucher input, payment method, screenshot upload
4. **Confirmation** — booking ref, summary, Add to Calendar, payment instructions

Booking creation calls `/api/bookings/create` — never writes directly to Firestore from the client.

See `plan/features/BOOKING-FLOW.md` for full checklist.

---

## Corporate Booking (`/corporate/book`)

Reuses the same 4-step booking flow components with:
- Access code validation on landing before entering flow
- Corporate skin (dark header, persistent rate badge)
- Company name field added in Step 2
- Flat corporate rate or custom negotiated rate from access code

See `plan/features/CORPORATE-BOOKING.md`.

---

## PWA Setup

guest-app is a Progressive Web App. This must be wired up during Phase 0 scaffolding — not retrofitted later.

### Required files & config
- [ ] `guest-app/public/manifest.json` — `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `background_color`, `theme_color` (from `config.colors.primary`), `icons` array (192×192 + 512×512 PNG in `public/brand/`)
- [ ] `vite-plugin-pwa` installed + configured in `guest-app/vite.config.ts` — generates service worker via Workbox
- [ ] Workbox strategy: `NetworkFirst` for all Firestore/API calls; `CacheFirst` for static assets (fonts, images, JS/CSS bundles)
- [ ] Service worker registered automatically by `vite-plugin-pwa` — no manual `navigator.serviceWorker.register()` needed
- [ ] `<meta name="theme-color">` in `index.html` — matches `config.colors.primary`
- [ ] `<meta name="apple-mobile-web-app-capable" content="yes">` in `index.html`
- [ ] `<meta name="apple-mobile-web-app-status-bar-style" content="default">` in `index.html`
- [ ] Apple touch icon: `<link rel="apple-touch-icon" href="/brand/icon-192.png">` in `index.html`

### Capacitor readiness (future native app)
- Never use browser APIs that Capacitor can't bridge (no `window.location` hacks, no non-standard Web APIs)
- All navigation via React Router — no raw `history.pushState`
- Camera/file input via standard `<input type="file">` — Capacitor can override this with native pickers later
- No usage of `localStorage` for anything security-sensitive — Capacitor's `SecureStorage` plugin can swap in later

### Offline behavior
- App shell (navbar, footer, page skeletons) loads from cache if offline
- Firestore `onSnapshot` handles its own reconnection — no extra handling needed
- Booking flow: if guest goes offline mid-flow, show "You're offline" banner — do not lose form state (React state survives)
- Intercom: show offline banner; messages queue and send on reconnect (Firestore handles this natively)

---

## Key Conventions

- Guest auth is limited to Spark Rewards/member account pages; public booking and intercom flows remain anonymous-capable
- Never display prices before room photos/name on room cards
- All CTAs use `config.colors.primary` (Tailwind token: `primary`) — no exceptions
- Navbar always uses `config.logos.navbar`
- Footer always uses `config.logos.white` and displays `{config.brandName} v{VERSION}`
- Mobile-first — design for 375px, scale up
- Apollo font for all headings (H1, H2, display)
- Inter for all body copy, labels, form fields

---

## Component Notes

- `Navbar.tsx` — sticky on scroll, transparent on hero sections, solid on interior pages
- `Footer.tsx` — dark background (`#111827`), white logo, version display
- `RoomCard.tsx` — image first, name, amenities, then price — never price first
- `DateRangePicker.tsx` — blocks past dates, enforces min 1 night stay
- `BookingSummary.tsx` — readonly recap used in Steps 3 and 4

---

## Local Development

The booking page (`BookingPage.tsx`) calls `GET /api/rooms/availability` to filter out rooms that overlap existing active bookings. That endpoint is a Vercel serverless function (the catch-all in `guest-app/api/[...route].ts`) — it is **not** reachable from a plain `vite` dev server, which falls back to serving `index.html` for any unknown route and produces the cryptic `Unexpected token '<', "<!doctype "… is not valid JSON` console error.

Use the workspace dev script, which runs `vercel dev` so the API is reachable:

- `npm run dev:guest` (or `npm run dev -w guest-app`) — boots `vercel dev --listen 3000` and serves both the Vite SPA and the `/api/*` functions. This is the script every contributor should use.
- `npm run dev:vite -w guest-app` — bare `vite` only. Use this only when you intentionally don't need the API (e.g. UI work on a page that doesn't fetch `/api/*`).
- `npm run preview:guest` (or `npm run preview -w guest-app`) — `vercel preview` for production-build smoke tests.

First-time setup: `cd guest-app && vercel link` to bind the local dev environment to a Vercel project, then `vercel env pull .env.local` if you want Vercel-managed env vars to take precedence over the committed `guest-app/.env`.

If the dev console still shows a JSON parse error against `/api/rooms/availability` after starting `npm run dev:guest`, check that:
1. `vercel dev` is actually serving on `:3000` (not Vite).
2. The env file has `FIREBASE_PRIVATE_KEY` (required by the handler).
3. The Vercel project is linked (`vercel link`) and pointing at the same Firebase project as the client.

See `plan/docs/ENV-SETUP.md §Local Development` for the canonical list.
