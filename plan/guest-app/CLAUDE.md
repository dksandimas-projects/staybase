# guest-app — Agent Context
> Requires: CLAUDE.md, docs/FRONTEND.md

---

## Overview

The public-facing booking website at `www.sparkinnbohol.com`. Built with React 19 + TypeScript + Vite 6 + Tailwind CSS. No authentication required for guests — all booking and intercom features are anonymous.

The `api/` folder lives inside `guest-app/` and is deployed as Vercel serverless functions in the same deployment. It is not a separate project.

Shared types and utils are imported from `@spark-inn/shared` (npm workspace package) in both the frontend and `api/` handlers. The `api/` handlers import `hotel.config.ts` via relative path (`../../hotel.config.ts`) since they run in Node.js, not Vite.

---

## Pages & Routes

| Route | Page | Feature MD |
|---|---|---|
| `/` | `HomePage.tsx` | `plan/features/HOMEPAGE.md` |
| `/rooms` | `RoomsPage.tsx` | `plan/features/ROOMS-PAGE.md` |
| `/about` | `AboutPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/corporate` | `CorporatePage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/corporate/book` | `CorporateBookingPage.tsx` | `plan/features/CORPORATE-BOOKING.md` |
| `/contact` | `ContactPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/book` | `BookingPage.tsx` | `plan/features/BOOKING-FLOW.md` |
| `/book/confirm` | `BookingConfirmPage.tsx` | `plan/features/BOOKING-FLOW.md` |
| `/my-booking` | `BookingLookupPage.tsx` | `plan/features/BOOKING-LOOKUP.md` |
| `/intercom/:roomId` | `IntercomPage.tsx` | `plan/features/INTERCOM-GUEST.md` |
| `/privacy` | `PrivacyPage.tsx` | `plan/features/STATIC-PAGES.md` |
| `/rewards` | `RewardsPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/signin` | `SignInPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/signup` | `SignUpPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/profile` | `ProfilePage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/stays` | `StaysPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `/account/rewards` | `RewardsPortalPage.tsx` | `plan/features/SPARK-REWARDS.md` |
| `*` | `NotFoundPage.tsx` | `plan/features/STATIC-PAGES.md` |

---

## Firebase Usage (guest-app)

| Collection | Operation | Notes |
|---|---|---|
| `rooms` | `onSnapshot` (real-time) | Room grid, availability badges |
| `bookings` | `getDoc` (one-time) | Booking lookup by ref + email |
| `intercoms` | `onSnapshot` + `addDoc` | Real-time chat |
| `settings/hotelConfig` | `getDoc` | Payment methods, quick request items |
| `settings/websiteContent` | `getDoc` | Homepage/about/corporate content |

No writes to `guests`, `corporateInquiries`, or admin collections from guest-app.

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

- No auth in guest-app — all pages are public
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
