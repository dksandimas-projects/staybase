# Spark Rewards
> App: guest-app (member portal + auth) + admin-app (member management)
> Phase: Phase 10B — Spark Rewards
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Spark Rewards

## Overview

Spark Rewards is spark inn's guest loyalty program. Guests can register as members after booking or from the homepage. Members earn points per stay, receive discounted rates and perks (early check-in subject to availability), and can view their booking history and points balance via a member portal. Auth uses Firebase Authentication — Google Sign-In and email/password.

> **Phase 1 scope:** Authentication infrastructure, member registration, profile, booking history, points balance display, configurable points earning, configurable member discount, and admin member management. Tiers, points redemption, and tier-based perks are Phase 2.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

**Guest-facing screens:**
- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends

**Admin-facing screens:**
- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Destructive actions have a single confirmation step — not buried in menus

---

## Guest Authentication

### UI Checklist
- [x] Sign-in page (`/signin`) — Google Sign-In button + email/password form + "Create account" link
- [x] Sign-up page (`/signup`) — email, password, first name, last name, phone + Google Sign-In button
- [x] Forgot password — email input, sends reset link via Firebase Auth
- [x] Navbar — shows "Join Rewards" CTA when logged out; shows member avatar/name + dropdown when logged in
- [x] Member dropdown — links to My Profile, My Stays, My Rewards, Sign Out
- [x] Persistent auth state — user stays logged in across page refreshes

### Data & Logic Checklist
- [x] Firebase Auth: `signInWithGoogle()` (Google OAuth provider) + `signInWithEmailAndPassword()` + `createUserWithEmailAndPassword()`
- [x] Google Sign-In is authentication only. Enrollment requires an explicit join action with Privacy Policy / Terms consent: `/signup` checks the consent box before calling `registerCurrentMember()`, and signed-in non-members can join from Rewards/Profile surfaces.
- [x] On email/password signup: create Firebase Auth user, then POST `/api/members/register` with the guest Firebase ID token to create/enroll `members/{uid}`
- [x] `onAuthStateChanged` listener in guest auth context — unsubscribe on cleanup
- [x] Guest auth context separate from admin auth context — different Firebase Auth flows, same Firebase project
- [x] Password reset: `sendPasswordResetEmail()` via Firebase Auth

---

## Spark Rewards Registration

### UI Checklist
- [x] Post-booking prompt (Step 4 — Confirmation page) — "Join Spark Rewards and earn points on this stay!" CTA — shown only to non-members / logged-out guests
- [x] One-click join if already signed in — explicit action calls `registerCurrentMember()` / POST `/api/members/register` and surfaces failures inline
- [x] If not signed in — confirmation page shows "Sign up with email" → `/signup` and "Learn more" → `/rewards` (no inline Google button on the confirmation page itself; Google auth lives on `/signin`/`/signup`); Google auth does not auto-enroll until the guest chooses the join action
- [x] Standalone signup at `/rewards` — marketing page with program overview + sign-up form
- [x] Homepage CTA — "Join Spark Rewards" link in navbar and/or footer

### Data & Logic Checklist
- [x] On registration: POST `/api/members/register`; API creates or enrolls `members/{uid}` with `isMember: true`, `memberSince: now`, `rewardsPoints: 0`, `tier: "standard"` (placeholder), `memberNumber: "{config.memberNumberPrefix}-XXXXX"` (sequential, zero-padded 5 digits)
- [x] Link past bookings by email: on registration, query `bookings` where `guestEmail == member.email` — update those bookings with `memberId` field
- [x] If guest registered post-booking: link the just-completed booking to their new member account

---

## Spark Rewards Landing (`/rewards`)

Public marketing page for the loyalty program. Hero is admin-editable from Settings → Branding.

### UI Checklist
- [x] Dark hero section — eyebrow pill, background photo, Apollo heading, subtext, primary + secondary CTAs (all editable from Settings → Branding)
- [x] Eyebrow pill renders as `"{config.rewardsName} {rewards.heroEyebrow}"` — e.g. "Spark Rewards Loyalty Program"
- [x] Logged-out guests: "Join Spark Rewards" + "Sign In" CTAs
- [x] Logged-in non-members: one-click "Enroll in Spark Rewards (One-Click)" button
- [x] Logged-in members: "Go to My Rewards Dashboard" CTA
- [x] "How It Works" 3-step grid
- [x] Member privileges grid (4 cards)
- [x] Bottom orange CTA section
- [x] Footer

### Data & Logic Checklist
- [x] Fetch `settings/websiteContent.rewards` for `heroEyebrow`, `heroHeading`, `heroSubtext`, `heroPhotoUrl` — all editable from Settings → Branding
- [x] Hero photo falls back to `data/homepage.ts → rewardsHeroImage` (Google CDN) when `rewards.heroPhotoUrl` is empty
- [x] Hero heading falls back to `data/homepage.ts → rewardsHeroHeading` ("Earn Every Stay") when `rewards.heroHeading` is empty
- [x] Hero subtext falls back to `data/homepage.ts → rewardsHeroSubtext` when empty
- [x] Eyebrow falls back to `data/homepage.ts → rewardsHeroEyebrowSuffix` ("Loyalty Program") when empty

---

## Member Portal

### My Profile (`/account/profile`)
- [x] Display name, email, phone — editable
- [x] Profile photo (from Google or uploaded)
- [x] Member since date
- [x] **Spark Rewards Card** — card-style display showing:
  - [x] Hotel logo
  - [x] Member full name
  - [x] Rewards number: `{config.memberNumberPrefix}-XXXXX` (zero-padded 5 digits, e.g. `SR-00042` for Spark Inn)
  - [x] Member since date
  - [x] Current points balance + tier label (Phase 1: "Standard Member")
  - [x] Card design uses `config.colors.primary` as accent — branded per hotel
- [x] Change password (email/password accounts only)
- [x] Delete account option (with confirmation — triggers data erasure per RA 10173)

### My Stays (`/account/stays`)
- [x] List of all bookings linked to member account (by `memberId` or `guestEmail`)
- [x] Each booking: room, dates, nights, total, status badge
- [x] Upcoming stays (confirmed/checked-in) shown first
- [x] Past stays (checked-out) shown below
- [x] Link to booking lookup for each stay

### My Rewards (`/account/rewards`)
- [x] Current points balance (prominently displayed)
- [x] Rewards tier badge (Phase 1: "Standard Member" placeholder)
- [x] Points history — list of earn/redeem transactions with date, description, points change
- [x] **Points balance** — pulled from `members/{uid}.rewardsPoints`; shows "0 pts" for new members
- [x] **Points earning info** — if `settings/rewardsConfig.pointsEnabled` is true, show how points are earned (e.g. "Earn {X} points per booking" or "Earn {X} points per ₱100 spent") — pulled from `settings/rewardsConfig`; if disabled, hide points balance section entirely
- [x] **Member discount badge** — if `settings/rewardsConfig.memberDiscountEnabled` is true, show "You get {X}% off every booking as a member" — if disabled, hide
- [x] **Early check-in perk** — always shown (not configurable off); "Request Early Check-In" button opens a modal that loads the member's upcoming stays (auto-picks a single booking, picker for multiple) and submits the request; subject to availability. **Delivery is email-only** — staff receive an email with booking details and a "Review booking" link into the admin app. The originally planned tagged-`intercoms`-message path was not built: the `isEarlyCheckInRequest` message flag exists in shared types and is preserved by the guest intercom, but nothing sets it and the admin inbox does not render it — deferred alongside `plan/features/INTERCOM-INBOX.md §Preserve early check-in request metadata`
- [x] Points redemption — staff-only from booking detail drawer via `/api/members/redeem-points`; My Rewards page shows current balance only — no guest-facing redeem button in Phase 1

### Data & Logic Checklist
- [x] Profile: `getDoc` / `updateDoc` on `members/{uid}`
- [x] Stays: call `GET /api/members/stays` with the guest Firebase ID token; the API matches `memberId == uid` OR `guestEmail == token.email`, dedupes, and returns a guest-safe booking subset only
- [x] Points history: `onSnapshot` on `members/{uid}/pointsHistory` subcollection
- [x] Points balance + rewards config: fetch `members/{uid}.rewardsPoints` + `settings/rewardsConfig` on load
- [x] Early check-in request: POST to `/api/email/early-checkin-request` with the guest Firebase ID token and selected `bookingId`; when an `Authorization` header is present the API verifies `booking.memberId == uid` OR `booking.guestEmail == token.email` before emailing staff — always shown to members regardless of rewards config. Note: the route sits in the public email actions set, so a tokenless request falls back to the public booking-lookup pattern (`bookingId` + matching `guestEmail` in the body) — the token is verified when supplied, not strictly required; same auth level as the other public booking emails
- [x] Member discount: if `settings/rewardsConfig.memberDiscountEnabled`, show discount badge in booking Step 1 for logged-in members (auto-applied) — if disabled, no discount shown
- [x] Points settlement policy: if enabled, compute checkout earnings from net booking `totalPrice` only (room/breakfast; excludes incidentals/store). Credit immediately only when the charge-inclusive folio is settled; otherwise lock the pending amount on the booking and let the final payment transaction award it exactly once. Checkout stamps the unpaid balance and remains operationally allowed.
- [x] Points redemption: POST `/api/members/redeem-points`; API transaction validates member balance and redemption rate, updates booking total and locked rate breakdown together, deducts points, and writes points history
- [x] Undo points redemption: POST `/api/members/undo-redemption`; admin-only and only while booking status is `confirmed`; restores booking total and removes the points deduction from the locked breakdown in the same transaction
- [x] Auth guard: all `/account/*` routes redirect to `/signin` if not authenticated

---

## Admin — Member Management

### UI Checklist
- [x] Members list page (within admin-app) — columns: Member ID, Full Name, Email, Spark Points, Tier, Status, Details action (join date / total stays / last stay columns were not built — member since shows in the drawer)
- [x] Member detail drawer — profile, points history, manual points adjustment, suspend/activate (booking history is NOT shown in the drawer — staff look up stays via the Bookings page)
- [x] Manual points adjustment — add or deduct points with required reason note
- [x] Disable/enable member account (without deleting)
- [x] Search by name or email
- [ ] Filter by tier (Phase 2 when tiers are defined)
- [ ] Export members list as CSV

### Data & Logic Checklist
- [x] `onSnapshot` on `members` collection — real-time
- [x] Manual points adjustment: `updateDoc` on `members/{uid}.rewardsPoints` + `addDoc` to `members/{uid}/pointsHistory` with `{type: "manual", points, reason, by: staffUID, at: timestamp}`
- [x] Disable account: `updateDoc` on `members/{uid}.isActive: false` + Firebase Admin SDK `disableUser(uid)` via API route
- [x] Points adjustment requires reason — never adjust without audit trail

---

## Phase 2 — Loyalty Rules (TBD — not building yet)

These are documented here for awareness. Define before starting Phase 2:

- [ ] Points expiry policy
- [ ] Points redemption flow + conversion rate (e.g. 100 pts = ₱100 off)
- [ ] Tier system (names, thresholds, tier-based perks)
- [ ] Additional perks (free breakfast, room upgrades, etc.)

> Points earning and member discount are already configurable from Settings in Phase 1 — Phase 2 extends with tiers and redemption only.

---

## Phase 2 — Early Check-In Approval Workflow (specced 2026-07-08 — not building yet)

> Closes the loop on the Phase 1 early check-in perk. Today the request ends at a staff notification email: nothing is persisted, there is no approve/decline action, nothing reflects on the booking, and the guest never gets an in-system answer. This spec makes the request a first-class booking attribute with a staff decision and a guest-visible outcome.
> Roadmap entry: `plan/project/ROADMAP.md §Phase 12`.

### Data model

- [x] New optional `earlyCheckIn` map on the `Booking` document (add to `plan/docs/TYPES.md` and `shared/types/index.ts` when building):
  - `status` — `"requested" | "approved" | "declined"`
  - `requestedTime` — guest's requested arrival time (string, e.g. "11:00 AM")
  - `notes` — guest note from the request form
  - `requestedAt` — timestamp
  - `resolvedAt` — timestamp, null while `requested`
  - `resolvedBy` — staff display name (never log or expose staff UID to guests)
  - `staffNote` — optional note shown to the guest (e.g. "Room ready from 12:00")
  - `confirmedTime` — confirmed arrival time (string, e.g. "12:00 PM", optional)
- [ ] Absent map = no request ever made. One request per booking: re-submission while `requested` overwrites time/notes and re-notifies staff; re-submission after `declined` is allowed (resets to `requested`); blocked after `approved` (guest sees the approved state instead)

### Request submission (changes to existing flow)

- [ ] `/api/email/early-checkin-request` additionally persists the `earlyCheckIn` map onto the booking via Admin SDK in the same handler — guest client still never writes `bookings/` directly (per `plan/docs/GOTCHAS.md`)
- [ ] **Tighten auth**: once the request writes to the booking doc, require a verified Firebase ID token (drop the tokenless `bookingId` + `guestEmail` fallback for this action) — the perk is member-only anyway, and a write should not be reachable via the public lookup pattern
- [ ] Reject the request if booking status is not `confirmed` (e.g. `cancelled`, `checked-in`, `checked-out`) or if check-in date has passed
- [ ] Staff notification email unchanged (existing `earlyCheckinRequestEmail` template)

### Admin — booking drawer

- [ ] "Early check-in" panel in the booking detail drawer, shown only when `booking.earlyCheckIn` exists — requested time, guest notes, requested-at, current status badge
- [ ] Approve / Decline actions (front desk + admin roles) — Approve captures optional confirmed time + staff note; Decline captures optional reason (stored in `staffNote`)
- [ ] Resolution goes through an authenticated staff action in the existing API catch-all (no new Vercel function — see `plan/docs/VERCEL-FUNCTION-LIMIT.md`), which updates the booking and fires the guest email server-side with a server-controlled recipient (`booking.guestEmail`)
- [ ] Early check-in badge on the booking row / arrivals list for `approved` bookings so front desk sees it on the check-in day

### Guest visibility

- [ ] Guest confirmation email on resolve — approved (with confirmed time + staff note) or declined (with reason if given); new template in the email handler, staff-triggered only
- [ ] My Stays + My Rewards show the request status on the relevant booking — "Early check-in requested" / "Early check-in approved — from {time}" / "Early check-in unavailable"; `GET /api/members/stays` includes the `earlyCheckIn` map in its guest-safe booking subset
- [ ] Rewards portal "Request Early Check-In" modal reflects an existing request instead of allowing a duplicate submission (per the one-request-per-booking rule above)

### Edge cases

- [ ] Booking cancelled after request — no special handling; the drawer panel disappears with the cancelled booking flow, no email fired
- [ ] Check-in day arrives with status still `requested` — no auto-resolution; guest UI shows "Not yet confirmed — please ask the front desk on arrival"
- [ ] Never log PII in the request/resolve handlers (per Hard Rules)
- [ ] Existing rate limit on the email endpoint continues to cover request submission

### Out of scope

- The dormant `isEarlyCheckInRequest` intercom-message flag stays dormant — intercom delivery remains deferred per `plan/features/INTERCOM-INBOX.md §Preserve early check-in request metadata`. This workflow is email + booking-document only.

### Manual QA (when built)

- [ ] Member requests early check-in → `earlyCheckIn` map appears on the booking, staff email received
- [ ] Approve from drawer → guest email received, My Stays shows approved state with time
- [ ] Decline from drawer → guest email received, portal allows re-request
- [ ] Non-member token / tokenless request → rejected
- [ ] Request against a cancelled or past booking → rejected

---

## Edge Cases & States

- [x] **Guest books anonymously then registers with same email** — on registration, query `bookings` where `guestEmail == member.email`, update all matching bookings with `memberId`; all previous stays immediately appear in My Stays
- [ ] Member books while logged in but uses different email — no auto-link; manual link by front desk from Member detail drawer
- [ ] Google account email differs from booking email — after sign-in, prompt: "We found bookings under a different email. Would you like to link them?" with the booking email pre-filled — guest confirms to trigger the email-match link
- [ ] Member account disabled — redirect to `/contact` with message: "Your account has been disabled. Please contact us."
- [x] Delete account request — delete `members/{uid}`, anonymize linked bookings (remove personal data), revoke Firebase Auth — per RA 10173 right to erasure

**Account linking — email conflict between Google and email/password:**
- [x] Guest signs up with email/password first, then later tries Google Sign-In with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [x] Phase 1 behavior: show a provider-conflict message that tells the guest to use the existing sign-in method first; full self-service `linkWithPopup(googleProvider)` is deferred.
- [ ] Phase 2 behavior: after successful email/password sign-in, show "Link your Google account?" prompt — call `linkWithPopup(googleProvider)` to attach Google as a second provider
- [ ] Once linked in Phase 2: guest can sign in with either Google or email/password going forward
- [x] Guest signs up with Google first, then tries email/password sign-in with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [x] Phase 1 behavior: show a provider-conflict message that tells the guest to sign in with the existing method first
- [x] All booking linkage by email applies regardless of auth provider — the email is the identity anchor, not the provider

## Manual QA

- [ ] Google Sign-In creates member account and profile
- [ ] Email/password signup creates member account
- [ ] Post-booking registration prompt appears on Step 4 for non-members
- [ ] Past bookings linked to member account on registration (by email) — My Stays shows previous anonymous bookings immediately after sign-up
- [ ] My Stays shows correct booking history
- [ ] Email/password account + Google Sign-In same email → provider-conflict message shown; self-service linking is deferred to Phase 2
- [ ] Google account + email/password same email → provider-conflict message shown; self-service linking is deferred to Phase 2
- [ ] My Rewards shows points balance (0 for new members)
- [x] Early check-in request reaches front desk — via staff email (email-only delivery; submission flow covered by automated tests in `guest-app/tests/api/early-checkin.test.ts` and `early-checkin-member-auth.test.ts`)
- [ ] Admin member list shows all members with correct data
- [ ] Manual points adjustment updates balance and logs to history
- [ ] Disable member — member cannot sign in
- [ ] `/account/*` routes redirect to `/signin` when not authenticated

## References

- Guest auth vs admin auth: `plan/features/AUTH-ROLES.md`
- Booking linkage: `plan/docs/BACKEND.md §members`
- Post-booking prompt: `plan/features/BOOKING-FLOW.md §Step 4`
- Rewards signup page: `plan/features/STATIC-PAGES.md §Spark Rewards`
- RA 10173 erasure rights: `plan/docs/SECURITY.md §Data Subject Rights`
- Member types: `plan/docs/TYPES.md §Member`
