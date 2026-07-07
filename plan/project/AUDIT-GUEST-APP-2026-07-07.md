# Guest App Features & Functionality Audit — 2026-07-07

> Full wiring audit of the guest-app surfaces NOT covered in depth by prior
> audits: homepage, rooms catalog, static pages (About / Contact / Corporate
> marketing / Privacy / Terms / 404), Spark Rewards guest auth + member
> portal (`/signin`, `/signup`, `/account/*`, `/rewards`), shared
> components/hooks, and the guest-facing server handlers that had no prior
> audit pass (`members`, `contact`, `email` guest actions, router-level
> bot/rate-limit middleware). Read-only at audit time — no fixes applied.
>
> Successor scope to `plan/project/AUDIT-BOOKING-INTERCOM-2026-07-06.md`
> (booking flow, corporate booking, intercom + store panel — spot-rechecked
> here and still healthy: Turnstile via `useTurnstileToken` on `/book` and
> `/my-booking`, lookup/cancel via API only, store `isEnabled` gating
> present) and `plan/project/AUDIT-PUBLIC-CONTENT-2026-07-01.md` (string
> editability — its Section 5 "keep hardcoded" decisions are respected here;
> only *hard-rule* white-label violations are re-raised).
>
> Workspace: staybase
> Audited: 2026-07-07 (branch `dev`, HEAD `535c176`)
> Method: read-only — read the guest read bundle
> (`plan/guest-app/CLAUDE.md`, `plan/features/{HOMEPAGE, ROOMS-PAGE,
> BOOKING-LOOKUP, STATIC-PAGES, SPARK-REWARDS, STORE-GUEST}.md`,
> `plan/docs/{FRONTEND, BACKEND, GOTCHAS}.md`); traced every code path in
> `guest-app/src/pages/{HomePage, RoomsPage, AboutPage, ContactPage,
> CorporateStaysPage, PrivacyPage, TermsPage, NotFoundPage, SignInPage,
> SignUpPage, ProfilePage, StaysPage, RewardsPage, RewardsLandingPage,
> BookingConfirmPage}.tsx`, `guest-app/src/context/GuestAuthContext.tsx`,
> `guest-app/src/components/*`, `guest-app/src/hooks/*`,
> `guest-app/src/App.tsx`; cross-checked `guest-app/server/apiRouter.ts`,
> `guest-app/server/handlers/{members, contact, email}.ts`,
> `firebase/{firestore,storage}.rules`, `firestore.indexes.json`,
> `hotel.config.ts`.
> Baseline: typecheck clean; 99 shared + 262 guest-api tests green on `dev`
> @ `535c176` — none of the findings below are covered by existing tests.
>
> **Convention:** findings are numbered `GA-<n>` (Guest App). Severity
> matches prior audits (`SEV-1` critical → `SEV-4` nit / doc drift).
> Status is `Open` until a commit references the fix in this doc.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 3 | **3** |
| **SEV-2 (major)** | 0 | 4 | **4** |
| **SEV-3 (minor)** | 6 | 1 | **7** |
| **SEV-4 (nit / doc drift)** | 4 | 1 | **5** |
| **Total** | **10** | **9** | **19** |

The public marketing shell (heroes, content fallback chain, branding
overrides, SEO meta, PWA), the rooms catalog, the corporate inquiry form,
the booking-lookup and cancel flows (post-BI fixes), and the member
registration + RA 10173 erasure server endpoints are all in good shape.
At audit time, the critical problems clustered in three places:

1. **The member portal reads `bookings` straight from the guest client**
   — which Firestore rules (correctly, per GOTCHAS) deny. My Stays is
   permanently empty for every member and the early check-in picker
   always errors (GA-01). Even if the reads worked, the early check-in
   submit fails server-side because the client sends neither a guest
   email nor an ID token the endpoint could verify (GA-03).
2. **The contact form can never submit.** The API router requires a
   Turnstile token for `/api/contact/inquiry`, but `ContactPage` renders
   no widget, sends no token, and has no honeypot — every submission in
   every environment returns "Bot verification token is missing" (GA-02).
3. **Silent enrollment failures and quiet data leaks.** A failed
   `/api/members/register` call is console-only, leaving signed-in users
   with no member record and a profile page whose Save silently fails
   (GA-05); internal staff `remarks` ride along on the world-readable
   `rooms` docs (GA-06); and Google sign-in auto-enrolls guests into the
   rewards program without the privacy consent the email flow requires
   (GA-07).

**2026-07-07 update:** SEV-1 findings GA-01, GA-02, and GA-03 were fixed
in `2b5b187` (`fix: repair guest app sev1 audit issues`). The same fix
also closed GA-14 because `/api/members/stays` now returns pending /
payment-uploaded stays, matches by `memberId` OR guest email, and drives
the member portal without client-side `bookings` reads.

**2026-07-07 SEV-2 update:** GA-04, GA-05, GA-06, and GA-07 were fixed
in `cb13846` (`fix: repair guest app sev2 audit issues`). The same batch
also closed GA-16 by adding a shared `config.timezone`-aware date-key
helper and replacing the UTC "today" call sites in guest date logic.

### Top 5 to fix first

| # | ID | Why | File:line | Status |
|---|---|---|---|---|
| 1 | **GA-02** | Contact form is 100% dead — every submit 400s on the missing Turnstile token | `guest-app/src/pages/ContactPage.tsx:43-52`, `guest-app/server/apiRouter.ts:626-645` | Fixed in `2b5b187` |
| 2 | **GA-01** | My Stays always "No stays yet"; early check-in can't load bookings — guest client queries a staff-only collection | `guest-app/src/pages/StaysPage.tsx:49-55`, `guest-app/src/pages/RewardsPage.tsx:95-101`, `firebase/firestore.rules:27` | Fixed in `2b5b187` |
| 3 | **GA-03** | Early check-in submit fails even with GA-01 fixed — endpoint demands a guest email the member client never sends | `guest-app/src/pages/RewardsPage.tsx:132-136`, `guest-app/server/handlers/email.ts:277-285` | Fixed in `2b5b187` |
| 4 | **GA-06** | Internal staff `remarks` publicly readable on every room doc — GOTCHAS-forbidden data exposure | `firebase/firestore.rules:17-24`, `guest-app/src/hooks/useRooms.ts:29` | Fixed in `cb13846` |
| 5 | **GA-04** | Homepage availability checker ships hardcoded June 2026 dates — now in the past, forwarded straight into `/book` | `guest-app/src/pages/HomePage.tsx:58-59` | Fixed in `cb13846` |

---

## SEV-1 — Critical (3)

### GA-01 — My Stays and the early check-in picker query `bookings` from the guest client — Firestore rules deny every read
**Status:** Fixed in `2b5b187`
**File:** `guest-app/src/pages/StaysPage.tsx:49-55` (email query), `guest-app/src/pages/RewardsPage.tsx:95-101` (memberId query); rules: `firebase/firestore.rules:26-30`

`bookings` reads are `allow read: if isStaff()` — correct per GOTCHAS
("Never subscribe to or query the `bookings` collection from the guest
client"). But `StaysPage` runs `getDocs(query(collection(db, "bookings"),
where("guestEmail", "==", …), orderBy("createdAt", "desc")))` and the
`RewardsPage` early check-in modal runs a `memberId ==` + `status in`
query on the same collection. Both are rejected with permission-denied
for every member, the errors are swallowed into `console.error`, and:

- **My Stays renders the "No stays yet." empty state for every member**,
  including members with linked bookings — a misleading empty state, not
  an error. The Contact page even directs members to this broken panel
  ("Booking modifications? … Visit the My Stays panel").
- **Early check-in always shows "Unable to load your bookings."** — the
  spec's flagship member perk (`SPARK-REWARDS.md §My Rewards`, "always
  shown") has never worked.

There is no guest-facing endpoint to list a member's own bookings —
`apiRouter.ts` exposes `members/register|redeem-points|undo-redemption|
delete-account` only. The client-side queries also would have needed a
missing composite index (`guestEmail ==` + `orderBy createdAt`) and
would have exposed staff-only fields (`paymentProofUrl` is on the
booking doc and must never reach the guest app per GOTCHAS) — so the
fix is an API route, not a rules relaxation.

**Fix:** add an authenticated member endpoint (e.g. `GET
/api/members/stays`, `authenticateUser` + match on `memberId == uid` OR
`guestEmail == token.email`) that returns the PII-safe display subset
(ref, lookupToken, room, dates, nights, total, status, hasBreakfast —
never `paymentProofUrl`/`remarks`); consume it from both `StaysPage`
and the early check-in picker. Land together with GA-03 and GA-14.

**Fixed in `2b5b187`:** added authenticated `GET /api/members/stays`,
deduped memberId/email matches, returned only guest-safe display fields,
and moved both `StaysPage` and the Rewards early check-in picker off
direct Firestore `bookings` reads. Added regression coverage in
`members-register.test.ts` and `early-checkin.test.ts`.

### GA-02 — Contact form can never submit: no Turnstile widget, no honeypot, router demands both
**Status:** Fixed in `2b5b187`
**File:** `guest-app/src/pages/ContactPage.tsx:36-68, 220-280` (form), `guest-app/server/apiRouter.ts:626-645` (gate), `:265-267` (`verifyTurnstile` missing-token rejection)

`POST /api/contact/inquiry` is honeypot-checked and Turnstile-gated in
the router, and `verifyTurnstile` rejects a missing token in **every**
environment except `NODE_ENV === "test"`. `ContactPage` never renders a
Turnstile widget (no `useTurnstileToken`, no explicit render like
`CorporateStaysPage`), never sends `turnstileToken`, and has no honeypot
field. Every guest submission — production, preview, and local dev —
fails with "Bot verification token is missing." The success banner,
spam filter, `contactInquiries` write, and staff notification email
behind it (`handlers/contact.ts`, all correctly implemented) are
unreachable. This is the BI-01/BI-03 class ("never render a form whose
endpoint is Turnstile-gated without a live widget behind it") on the
one public form the booking-intercom audit didn't cover.

**Fix:** mirror `CorporateStaysPage.tsx:78-215` — explicit
`turnstile.render()` (or the shared `useTurnstileToken` hook) with
disabled-submit until token, reset after each submit per GOTCHAS
(single-use tokens), plus a CSS-hidden honeypot field submitted as
`_hp` (hidden via opacity/position, not `display:none`).

**Fixed in `2b5b187`:** wired `ContactPage` to `useTurnstileToken`,
submitted `turnstileToken` plus a CSS-hidden `_hp` honeypot, disabled
submit until a token exists, and reset the widget after each token use.

### GA-03 — Early check-in request fails server-side: client sends neither guest email nor a verifiable member token
**Status:** Fixed in `2b5b187`
**File:** `guest-app/src/pages/RewardsPage.tsx:128-148` (client POST), `guest-app/server/apiRouter.ts:790-824` (email dispatch — staff-or-nothing auth), `guest-app/server/handlers/email.ts:250-288` (`findBooking`), `:882-894` (early-checkin action)

Independent of GA-01: the rewards page POSTs `/api/email/
early-checkin-request` with only `{ bookingId }` and **no Authorization
header**. The router only attaches `req.staff` (staff tokens); guest
callers reach `findBooking(req, { requireGuestMatch: true })`, which for
a `bookingId` lookup throws "Guest email is required." — so even with
the booking picker fixed, every member request 400s. Structurally the
endpoint has no way to authenticate a *member*: it accepts staff tokens
or anonymous ref+email pairs, but the member flow has neither in hand.
(The anonymous path also means anyone who learns a booking doc ID plus
the guest email can fire early check-in emails — acceptable for the
threat model, but the member path should be first-class.)

**Fix:** in the email dispatch branch, attempt `authenticateUser` when a
non-staff Authorization header is present, and let `findBooking` accept
a verified member match (`booking.memberId == uid` or
`booking.guestEmail == token.email`) as the guest-match proof; send the
member ID token from `RewardsPage`. Land with GA-01.

**Fixed in `2b5b187`:** `RewardsPage` now sends the guest Firebase ID
token with early check-in requests, and the email route accepts member
tokens for `early-checkin-request` while preserving staff auth and the
anonymous ref/email ownership path. Added
`early-checkin-member-auth.test.ts`.

---

## SEV-2 — Major (4)

### GA-04 — Homepage availability checker seeded with hardcoded past dates
**Status:** Fixed in `cb13846`
**File:** `guest-app/src/pages/HomePage.tsx:58-59`, `guest-app/src/components/DateRangePicker.tsx:14-16, 44`

`checkIn`/`checkOut` are initialized to the literals `"2026-06-12"` /
`"2026-06-14"` — dates that are already in the past (today is
2026-07-07) and drift further every day. The `DateRangePicker`'s `min`
attribute only constrains *picker interaction*; the pre-filled past
values render as-is and the Search button forwards them to
`/book?checkIn=2026-06-12&…`, where `BookingPage` adopts URL params
verbatim (`BookingPage.tsx:158-159`). A guest who taps Search without
touching the fields lands in Step 1 with a stale range and gets
availability noise / server-side validation errors at submit. Violates
`HOMEPAGE.md` edge cases ("past dates disabled").

**Fix:** initialize from today/tomorrow the way `BookingPage.tsx:103-118`
already does (and per GA-16, host the helpers in `shared/utils/dates.ts`
computed in `config.timezone`, then reuse in both places).

**Fixed in `cb13846`:** added `getDateKeyInTimezone` in
`shared/utils/bookingDates.ts` and reused it for the homepage,
booking/corporate booking defaults, date picker minimums, and early
check-in date filtering. Added shared helper coverage plus
`audit-guest-sev2-2026-07-07.test.ts`.

### GA-05 — Member enrollment failure is silent: signed-in users with no member doc, profile Save fails with no feedback
**Status:** Fixed in `cb13846`
**File:** `guest-app/src/context/GuestAuthContext.tsx:50-62` (`registerMember` swallows), `:140-173` (signup + Google flows), `guest-app/src/pages/ProfilePage.tsx:45-72` (`handleSaveChanges` catch is console-only)

`registerMember` logs `console.error` and returns on any failure —
rate-limit 429, network error, 500 — while `signUpWithEmail` /
`signInWithGoogle` proceed to navigate the user to `/account/profile`
as if enrollment succeeded. The result is an authenticated Firebase
user with no `members/{uid}` doc: no rewards card, no member number,
and `ProfilePage`'s Save does `updateDoc` on the missing doc, which
throws — also caught with a console-only log, so the button just stops
spinning with no message (violates the UX checklist "every error state
has a plain-language message"). Nothing ever retries registration, so
the account stays half-created until the user happens to press the
`/rewards` enroll button (the one surface that does show the error).

**Fix:** propagate `registerMember` failures to the auth pages (show
error + retry), give `handleSaveChanges` a visible error state, and
self-heal on portal mount (if `user && !memberProfile`, offer/trigger
re-registration).

**Fixed in `cb13846`:** `registerMember` now throws API failures, email
signup surfaces those errors, Profile save has a visible error state,
and signed-in non-members get an explicit "Join Rewards" recovery panel
driven by `registerCurrentMember()`.

### GA-06 — Internal staff `remarks` are world-readable on every room document
**Status:** Fixed in `cb13846`
**File:** `firebase/firestore.rules:17-24` (`rooms` read: `if true`), `guest-app/src/hooks/useRooms.ts:29` (client hydrates `remarks`)

GOTCHAS: "Never expose `remarks` field to guest-app — room remarks are
internal staff notes only. Filter before returning room data to
guests." With client-side Firestore reads there is no place to filter:
`rooms` docs are publicly readable in full, so any anonymous visitor
can dump every room's staff notes (and `blockReason`) with a single
collection query — no guest-app code needed. The guest `useRooms` hook
even hydrates `remarks` into page state. Staff notes routinely contain
operationally sensitive content ("guest complaint", "pest control",
maintenance details) that must not be public.

**Fix:** move staff-only fields off the public doc (e.g.
`rooms/{id}/private/notes` subcollection or a parallel staff-only doc,
staff-read rules), migrate existing values, and drop `remarks` from the
guest `Room` mapping. Same pattern the vouchers/corporate-codes
tightening followed in BI-08.

**Fixed in `cb13846`:** introduced staff-only `roomPrivate/{roomId}`
rules, moved admin `remarks` / `blockReason` reads and writes there,
added lazy migration/deletion for legacy public fields, and stopped the
guest room hook from hydrating public `remarks` or `blockReason`.

### GA-07 — Google sign-in silently enrolls guests into Spark Rewards without privacy consent
**Status:** Fixed in `cb13846`
**File:** `guest-app/src/context/GuestAuthContext.tsx:161-173` (`signInWithGoogle` auto-registers), `guest-app/src/pages/SignUpPage.tsx:52-55, 264-284` (consent enforced on the email path only), `guest-app/src/pages/SignInPage.tsx:60-74`

The email signup blocks account creation until the Privacy Policy /
Terms checkbox is ticked. The Google path — offered on both `/signin`
and `/signup` — calls `signInWithGoogle`, which unconditionally POSTs
`/api/members/register` after the popup: a person who clicks "Continue
with Google" on the **sign-in** page purely to check whether they have
an account is enrolled as a member (member doc, `memberNumber`,
retroactive linking of their past bookings by email) with no consent
captured of any kind. RA 10173 requires consent for this processing
(`SECURITY.md`), and the sign-up consent asymmetry means the stricter
path is the one users can trivially bypass.

**Fix:** either (a) show the consent line under the Google button and
record acceptance alongside registration, or (b) split sign-in from
enrollment — after first Google sign-in, land non-members on the
`/rewards` one-click enroll (which is an explicit act) instead of
auto-registering. Record the choice in `DECISIONS-FEATURES.md`.

**Fixed in `cb13846`:** chose option (b) for sign-in and explicit
enrollment, with `/signup` enforcing consent before Google enrollment
and `DECISIONS-FEATURES.md #112` recording the product decision.

---

## SEV-3 — Minor (7)

### GA-08 — Booking create, voucher validate, and corporate-code validate share one bare-IP rate-limit bucket
**Status:** Open
**File:** `guest-app/server/apiRouter.ts:399` (`isRateLimited(ip, 5, …)` create), `:575` (voucher, same `ip` key), `:591` (corporate-code, same `ip` key)

Every other endpoint namespaces its cache key
(`bookings-lookup:${ip}`, `store:${ip}`, …) but these three all use the
bare `ip` string, so they share one counter with three different limits.
A guest who tries a handful of voucher codes at Step 3 (allowed 20/min
in isolation) burns through the booking-create allowance (5/min) and
gets a spurious 429 "Too many booking requests" when they finally press
Book — with a fresh Turnstile token wasted per retry. **Fix:** namespace
the three keys like every other route.

### GA-09 — My Rewards page ignores `settings/rewardsConfig` entirely
**Status:** Open
**File:** `guest-app/src/pages/RewardsPage.tsx:150-190, 324-334`

Per `SPARK-REWARDS.md §My Rewards`: hide the points section when
`pointsEnabled` is false, show the configured earn rate ("Earn X points
per …"), and show "You get X% off every booking" only when
`memberDiscountEnabled`. The page reads none of it — the points balance
and history always render, the "How Points Work" copy is a hardcoded
generic paragraph, and the "Member Rate" card is gated on
`memberProfile.memberNumber` rather than the config flag and never
shows the percentage. `BookingPage.tsx:421` already fetches
`settings/rewardsConfig` for the live discount — reuse that read here.

### GA-10 — Member-state gating missing on marketing surfaces: members are told to "Join Spark Rewards" everywhere
**Status:** Open
**File:** `guest-app/src/pages/HomePage.tsx:343-381` (promo section), `guest-app/src/pages/BookingConfirmPage.tsx:310-342` (post-booking block), `guest-app/src/pages/RewardsLandingPage.tsx:96-97`

`HOMEPAGE.md` specs the rewards promo to flip to "Welcome back,
[name]" + a `/account/rewards` link for logged-in members (perks list
hidden); `SPARK-REWARDS.md §Registration` specs the Step-4 block as
non-members-only with a one-click join for signed-in guests.
`HomePage` never consults `useGuestAuth`, and `BookingConfirmPage`
renders the "Join Spark Rewards" block unconditionally with static
`/signup` + `/rewards` links — a signed-in member who just booked is
prompted to join the program they're in. (`RewardsLandingPage` handles
the three auth states in its CTAs but shows a CTA instead of the
specced redirect for members — fold the doc decision into the fix.)

### GA-11 — Account-linking edge cases unhandled: cross-provider conflicts collapse into generic errors
**Status:** Open
**File:** `guest-app/src/pages/SignInPage.tsx:46-57, 67-73`, `guest-app/src/pages/SignUpPage.tsx:61-90`

`SPARK-REWARDS.md §Account linking` specs the full
`auth/account-exists-with-different-credential` dance: provider-specific
messages ("This email is linked to a Google account. Sign in with
Google instead."), and a post-sign-in `linkWithPopup(googleProvider)`
prompt so both providers work thereafter. Neither page special-cases
the error code — Google conflicts fall into "Google sign-in failed.
Please try again." (a retry that can never succeed), and no linking
flow exists anywhere. Also missing from the spec'd flow: the "We found
bookings under a different email. Would you like to link them?" prompt.

### GA-12 — Rooms detail modal: no photo carousel and a broken image when the type has no photos
**Status:** Open
**File:** `guest-app/src/pages/RoomsPage.tsx:108-156`

`ROOMS-PAGE.md` specs the modal with "all photos carousel … multiple
images, dots indicator, swipeable on mobile". The modal renders exactly
`imageUrls[0]` — additional admin-uploaded type photos are never
reachable by guests, which undercuts the Settings §Room Type Photos
management feature. And unlike the cards (which have the "Photo coming
soon" branch), the modal has no empty-URL fallback: a type with no
photos renders a broken `<img src={undefined}>` block.

### GA-13 — Homepage featured cards label occupied rooms "Blocked" and leak per-room operational status
**Status:** Open
**File:** `guest-app/src/components/RoomCard.tsx:82`, consumer `guest-app/src/pages/HomePage.tsx:260-271`

The featured card renders `StatusBadge` with
`room.status === "available" ? "Available" : "Blocked"` — a room whose
status is `occupied` (someone is checked in) shows a gray "Blocked"
badge on the public homepage. The label is wrong, and per-room
operational status on a *type-driven* marketing card is incoherent
anyway: the card's Book CTA goes through date selection where real
availability is computed. `HOMEPAGE.md`'s "real-time availability badge
based on current bookings" line predates the guest-side bookings-read
ban and can't be implemented as written. **Fix:** drop the badge from
the homepage cards (or drive it from `/api/rooms/availability` for a
default date range) and update `HOMEPAGE.md` to match the decision.

### GA-14 — My Stays hides pending bookings and deviates from the specced ordering/matching
**Status:** Fixed in `2b5b187`
**File:** `guest-app/src/pages/StaysPage.tsx:50-54, 85-87`

Behavior issues to fix inside the GA-01 endpoint work: (a) the section
filters only surface `confirmed`/`checked-in`/`checked-out`/`cancelled`
— a member's just-created `pending` or `payment-uploaded` booking is
invisible, exactly when they're most likely to check; (b) results are
ordered by `createdAt` while the spec says `checkIn` desc; (c) matching
is by `guestEmail` only — bookings linked via `memberId` but booked
under a different email (the spec's explicit manual-link case) never
appear. The spec'd model is `memberId == uid OR guestEmail == email`,
upcoming first.

**Fixed in `2b5b187`:** `/api/members/stays` includes pending /
payment-uploaded / payment-confirmed bookings, matches by `memberId` OR
token email, dedupes results, and returns upcoming stays before past and
cancelled stays for the portal.

---

## SEV-4 — Nits & doc drift (5)

### GA-15 — White-label hard-rule violations: unused `config.rewardsName`, hardcoded brand/city strings, hardcoded prod hostnames in the API router
**Status:** Open
**File:** `guest-app/src/pages/HomePage.tsx:351, 356`, `guest-app/src/pages/SignUpPage.tsx:108`, `guest-app/src/pages/BookingConfirmPage.tsx:319`, `guest-app/src/pages/ProfilePage.tsx:154, 337`, `guest-app/src/pages/StaysPage.tsx:90`, `guest-app/src/App.tsx:74, 90, 130, 154`, `guest-app/server/apiRouter.ts:46-57`, `guest-app/src/pages/ProfilePage.tsx:119-123`

`hotel.config.ts` defines `rewardsName` for exactly this, yet "Spark
Rewards" is a string literal in the homepage promo eyebrow + CTA, the
sign-up subheading, the confirm-page block, and the profile/rewards
subtitles; `StaysPage`'s subtitle hardcodes "at spark inn" (direct
violation of the brand-name hard rule); the `/corporate`, `/rewards`,
`/account/rewards`, and `/contact` route meta descriptions hardcode
"Tagbilaran City" / "spark inn" / "Spark Rewards". Server-side,
`PRODUCTION_GUEST_HOSTS` / `ALLOWED_ORIGINS` hardcode
`sparkinnbohol.com` variants instead of deriving from `config.domain`
(+ admin subdomain), so every white-label deployment ships CORS +
Turnstile production detection pointed at Spark Inn. `ProfilePage`'s
delete-account call also hardcodes `http://localhost:3000` as the dev
base URL. (Copy *editability* is out of scope here — see the
2026-07-01 content audit; these are the config-token violations.)

### GA-16 — "Today" computed in UTC across guest date logic
**Status:** Fixed in `cb13846`
**File:** `guest-app/src/components/DateRangePicker.tsx:14-16`, `guest-app/src/pages/BookingPage.tsx:103-118`, `guest-app/src/pages/RewardsPage.tsx:94-103`

Same class as AA-12 (admin audit): `new Date().toISOString()` is the
UTC date, and the hotel runs at UTC+8. Between midnight and 08:00 local
the date pickers' `min` (and `/book`'s default check-in) is *yesterday*,
and the early check-in "upcoming" filter (whose comment claims "in the
hotel timezone") misclassifies today's arrival. Fix once: hoist a
`config.timezone`-aware day-key helper into `shared/utils/dates.ts`
(AA-12 wants the same helper for the admin app) and use it in all three
places + GA-04's defaults.

**Fixed in `cb13846`:** `getDateKeyInTimezone(config.timezone, offset)`
now supplies day keys for homepage, booking, corporate booking, date
picker minimums, and early check-in filtering.

### GA-17 — Navbar drift: "Sign in" instead of the specced "Join Rewards" CTA; no member avatar photo
**Status:** Open
**File:** `guest-app/src/components/Navbar.tsx:180-190` (logged-out link), `:126-128` (initial-letter avatar), `guest-app/src/context/GuestAuthContext.tsx:16-28`

`SPARK-REWARDS.md §Guest Authentication` specs a logged-out "Join
Rewards" CTA and a member avatar in the dropdown. The navbar renders a
plain "Sign in" link, and the avatar is always the initial letter —
`photoUrl` is written to the member doc by the register endpoint but
`MemberProfile` never maps it, so Google profile photos are dropped
everywhere (Navbar, Profile page — where the spec also lists "Profile
photo (from Google or uploaded)" and nothing renders it). Either build
to spec or update the spec to the shipped design.

### GA-18 — Portal spec drift bundle: one-shot points history, unused `isActive`, no disabled-member handling
**Status:** Open
**File:** `guest-app/src/pages/RewardsPage.tsx:51-57` (getDocs), `guest-app/src/context/GuestAuthContext.tsx:96` (`isActive` mapped, never consumed)

(a) Points history is a one-time `getDocs`; the spec says `onSnapshot`
on `members/{uid}/pointsHistory` — a front-desk redemption during an
open session never appears. (b) `memberProfile.isActive` is tracked but
no surface implements the spec'd disabled-member behavior (redirect to
`/contact` with "Your account has been disabled…"); note the admin-side
suspend is itself a local-state mock (AA-01), so end-to-end suspension
currently does nothing at all — fix jointly with AA-01. (c) Sign-up
validation is submit-time only (spec: inline on blur) — lowest priority
of the three.

### GA-19 — `plan/guest-app/CLAUDE.md` drift: stale routes table, "no auth" claim, and Firebase-usage table
**Status:** Open
**File:** `plan/guest-app/CLAUDE.md`

One sync pass needed: the routes table names `CorporatePage.tsx` and
`RewardsPortalPage.tsx` (actual files: `CorporateStaysPage.tsx`,
`RewardsPage.tsx`, with `RewardsLandingPage.tsx` on `/rewards`); the
overview's "No authentication required for guests — all booking and
intercom features are anonymous" predates Spark Rewards (guest auth
context, `/account/*` guards); the Firebase-usage table says lookup is
a `bookings` `getDoc` (it's `POST /api/bookings/lookup` since the H2
hardening) and omits the `members` doc listener, `pointsHistory`,
`storeItems`/`storeOrders`, and the `settings/{storeConfig,
rewardsConfig, websiteContent}` reads; the component notes list
`BookingSummary.tsx` (actual: `BookingSummaryCard.tsx`). Also fold in
the GA-13 decision when updating `HOMEPAGE.md`.

---

## What was verified as correctly wired

- **Public shell & content pipeline:** `usePublicSiteContent`'s single
  fetch + localStorage TTL cache + cross-tab bust, per-field
  `pickString` fallback chain (admin override → static data → config),
  and the hero preload/LQIP pipeline (`HeroImage`, `heroPrefetch`,
  per-page preload swap) all match `HOMEPAGE.md §Hero Image Loading`.
  Branding overrides (navbar dark/light logo variants, footer logo)
  resolve per spec with deploy-time fallbacks.
- **Rooms catalog:** `/rooms` is correctly catalog-only per the
  refactor spec — no filters, no availability surface, type-driven
  cards from `useRoomTypes` (W3.6/W3.7 joins with legacy-entry
  fallbacks), skeletons, empty state, and none of the "removed
  behavior" reintroduced. Homepage featured-type resolution implements
  the type-values model including the distinct-types fallback.
- **Static pages:** About renders runtime mission/vision/story with
  correct fallbacks; Privacy/Terms render admin-editable bodies with
  config fallbacks, DPO email + last-updated wiring, and footer
  version; 404 is standalone with logo + home CTA; corporate marketing
  page has the full Turnstile explicit-render + honeypot + dynamic
  room-type overview and admin-editable copy chain.
- **Contact info chain:** Footer / Contact / Privacy all read the six
  runtime contact fields with `config` fallbacks (Phase 11.8 PR 3
  pattern) — nothing hardcoded on those surfaces.
- **Booking-flow spot recheck (BI follow-up):** `/book` and
  `/my-booking` use `useTurnstileToken` with proper gating; lookup and
  cancel go through the API (no client `bookings` reads); the lookup
  endpoint keeps its rate limit + 404 backoff + Turnstile stack;
  booking-create honeypot returns non-reflective fake success (BF-44).
- **Store guest panel spot recheck:** `storeConfig.isEnabled` gating,
  `storeItems` snapshot, order create/cancel/status via rate-limited
  API routes, payment-proof upload path matches the Storage rule.
- **Members server surface:** registration is transactional (member
  number counter, idempotent re-enroll), links past bookings by email;
  redemption/undo validate balance, rate, status, and write audit
  history; `delete-account` implements the full RA 10173 erasure
  (audit records → booking anonymization → history wipe → member doc →
  Auth user) with owner-only auth; all four routes rate-limited and
  token-verified in the router.
- **Security rules for guest surfaces:** `members` owner-read/write
  with staff override, `pointsHistory` owner/staff read + staff-only
  create, vouchers/corporateCodes staff-only (BI-08 intact), payment
  proof Storage paths staff-read-only, guest-id staff-only.
- **PWA + SEO:** `vite-plugin-pwa` configured with manifest + offline
  page; `PageMeta` sets title/canonical/OG/twitter/robots per route
  with noIndex on transactional pages; Analytics gated on
  `config.analyticsId`.
- **Auth guard:** all `/account/*` pages render through `AccountLayout`,
  which redirects unauthenticated users to `/signin` after the loading
  gate; sign-out available on desktop and mobile layouts.

---

## Suggested fix batches

| Batch | Findings | Theme | Status |
|---|---|---|---|
| 1 (`fix/audit-ga-sev1`) | GA-01, GA-02, GA-03 (+GA-14 rides along) | Member stays endpoint, contact-form Turnstile + honeypot, early check-in auth contract | Fixed in `2b5b187` |
| 2 (`fix/audit-ga-sev2`) | GA-04, GA-05, GA-06, GA-07 (+GA-16 rides along) | Date defaults, enrollment error surfacing, remarks migration, Google-consent decision | Fixed in `cb13846` |
| 3 (`fix/audit-ga-sev3`) | GA-08 … GA-13 | Rate-limit keys, rewardsConfig wiring, member-state gating, account linking, modal carousel, homepage badge | Open |
| 4 | GA-15, GA-17 … GA-19 | White-label tokens, navbar/portal drift, doc sync | Open |

**Fix-order notes:**
- GA-01, GA-03, and GA-14 landed together in `2b5b187` — the new
  `/api/members/stays` endpoint defines the data contract all three
  need. Rebuild + commit the API bundle (`npm run build:api -w
  guest-app`) per GOTCHAS after any `server/` change.
- GA-02 landed in `2b5b187` using the shared `useTurnstileToken` pattern
  (explicit render + expired/error callbacks + reset) — do not
  reintroduce the BI-02 sentinel-token fallback.
- GA-06 landed in `cb13846`: existing public `remarks` / `blockReason`
  are lazily migrated to `roomPrivate/{roomId}`, and admin room writes
  now keep those fields in the staff-only doc.
- GA-07's product decision landed in `DECISIONS-FEATURES.md #112`; GA-13
  still needs a product decision before coding.
- GA-16's shared timezone helper landed in `cb13846`; AA-12 can consume
  the same helper when the admin audit batch is addressed.

## Status legend
- **Open** — no fix landed; the finding is reproducible on `dev` @ `535c176`.
- **Fixed in `<hash>`** — a commit referencing this doc closes the finding.
- **Verified** — re-checked and found already correct (none yet).
