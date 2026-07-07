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
- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends

**Admin-facing screens:**
- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Destructive actions have a single confirmation step — not buried in menus

---

## Guest Authentication

### UI Checklist
- [ ] Sign-in page (`/signin`) — Google Sign-In button + email/password form + "Create account" link
- [ ] Sign-up page (`/signup`) — email, password, first name, last name, phone + Google Sign-In button
- [ ] Forgot password — email input, sends reset link via Firebase Auth
- [ ] Navbar — shows "Join Rewards" CTA when logged out; shows member avatar/name + dropdown when logged in
- [ ] Member dropdown — links to My Profile, My Stays, My Rewards, Sign Out
- [ ] Persistent auth state — user stays logged in across page refreshes

### Data & Logic Checklist
- [ ] Firebase Auth: `signInWithGoogle()` (Google OAuth provider) + `signInWithEmailAndPassword()` + `createUserWithEmailAndPassword()`
- [ ] Google Sign-In is authentication only. Enrollment requires an explicit join action with Privacy Policy / Terms consent: `/signup` checks the consent box before calling `registerCurrentMember()`, and signed-in non-members can join from Rewards/Profile surfaces.
- [ ] On email/password signup: create Firebase Auth user, then POST `/api/members/register` with the guest Firebase ID token to create/enroll `members/{uid}`
- [ ] `onAuthStateChanged` listener in guest auth context — unsubscribe on cleanup
- [ ] Guest auth context separate from admin auth context — different Firebase Auth flows, same Firebase project
- [ ] Password reset: `sendPasswordResetEmail()` via Firebase Auth

---

## Spark Rewards Registration

### UI Checklist
- [ ] Post-booking prompt (Step 4 — Confirmation page) — "Join Spark Rewards and earn points on this stay!" CTA — shown only to non-members / logged-out guests
- [ ] One-click join if already signed in — explicit action calls `registerCurrentMember()` / POST `/api/members/register` and surfaces failures inline
- [ ] If not signed in — show Google Sign-In + quick email signup inline on confirmation page; Google auth must not auto-enroll until the guest chooses the join action
- [ ] Standalone signup at `/rewards` — marketing page with program overview + sign-up form
- [ ] Homepage CTA — "Join Spark Rewards" link in navbar and/or footer

### Data & Logic Checklist
- [ ] On registration: POST `/api/members/register`; API creates or enrolls `members/{uid}` with `isMember: true`, `memberSince: now`, `rewardsPoints: 0`, `tier: "standard"` (placeholder), `memberNumber: "{config.memberNumberPrefix}-XXXXX"` (sequential, zero-padded 5 digits)
- [ ] Link past bookings by email: on registration, query `bookings` where `guestEmail == member.email` — update those bookings with `memberId` field
- [ ] If guest registered post-booking: link the just-completed booking to their new member account

---

## Spark Rewards Landing (`/rewards`)

Public marketing page for the loyalty program. Hero is admin-editable from Settings → Branding.

### UI Checklist
- [ ] Dark hero section — eyebrow pill, background photo, Apollo heading, subtext, primary + secondary CTAs (all editable from Settings → Branding)
- [ ] Eyebrow pill renders as `"{config.rewardsName} {rewards.heroEyebrow}"` — e.g. "Spark Rewards Loyalty Program"
- [ ] Logged-out guests: "Join Spark Rewards" + "Sign In" CTAs
- [ ] Logged-in non-members: one-click "Enroll in Spark Rewards (One-Click)" button
- [ ] Logged-in members: "Go to My Rewards Dashboard" CTA
- [ ] "How It Works" 3-step grid
- [ ] Member privileges grid (4 cards)
- [ ] Bottom orange CTA section
- [ ] Footer

### Data & Logic Checklist
- [ ] Fetch `settings/websiteContent.rewards` for `heroEyebrow`, `heroHeading`, `heroSubtext`, `heroPhotoUrl` — all editable from Settings → Branding
- [ ] Hero photo falls back to `data/homepage.ts → rewardsHeroImage` (Google CDN) when `rewards.heroPhotoUrl` is empty
- [ ] Hero heading falls back to `data/homepage.ts → rewardsHeroHeading` ("Earn Every Stay") when `rewards.heroHeading` is empty
- [ ] Hero subtext falls back to `data/homepage.ts → rewardsHeroSubtext` when empty
- [ ] Eyebrow falls back to `data/homepage.ts → rewardsHeroEyebrowSuffix` ("Loyalty Program") when empty

---

## Member Portal

### My Profile (`/account/profile`)
- [ ] Display name, email, phone — editable
- [ ] Profile photo (from Google or uploaded)
- [ ] Member since date
- [ ] **Spark Rewards Card** — card-style display showing:
  - [ ] Hotel logo
  - [ ] Member full name
  - [ ] Rewards number: `{config.memberNumberPrefix}-XXXXX` (zero-padded 5 digits, e.g. `SR-00042` for Spark Inn)
  - [ ] Member since date
  - [ ] Current points balance + tier label (Phase 1: "Standard Member")
  - [ ] Card design uses `config.colors.primary` as accent — branded per hotel
- [ ] Change password (email/password accounts only)
- [ ] Delete account option (with confirmation — triggers data erasure per RA 10173)

### My Stays (`/account/stays`)
- [ ] List of all bookings linked to member account (by `memberId` or `guestEmail`)
- [ ] Each booking: room, dates, nights, total, status badge
- [ ] Upcoming stays (confirmed/checked-in) shown first
- [ ] Past stays (checked-out) shown below
- [ ] Link to booking lookup for each stay

### My Rewards (`/account/rewards`)
- [ ] Current points balance (prominently displayed)
- [ ] Rewards tier badge (Phase 1: "Standard Member" placeholder)
- [ ] Points history — list of earn/redeem transactions with date, description, points change
- [ ] **Points balance** — pulled from `members/{uid}.rewardsPoints`; shows "0 pts" for new members
- [ ] **Points earning info** — if `settings/rewardsConfig.pointsEnabled` is true, show how points are earned (e.g. "Earn {X} points per booking" or "Earn {X} points per ₱100 spent") — pulled from `settings/rewardsConfig`; if disabled, hide points balance section entirely
- [ ] **Member discount badge** — if `settings/rewardsConfig.memberDiscountEnabled` is true, show "You get {X}% off every booking as a member" — if disabled, hide
- [ ] **Early check-in perk** — always shown (not configurable off); "Request Early Check-In" button → sends a tagged message to front desk via `intercoms` (or email if no active room intercom); subject to availability
- [ ] Points redemption — staff-only from booking detail drawer via `/api/members/redeem-points`; My Rewards page shows current balance only — no guest-facing redeem button in Phase 1

### Data & Logic Checklist
- [ ] Profile: `getDoc` / `updateDoc` on `members/{uid}`
- [ ] Stays: call `GET /api/members/stays` with the guest Firebase ID token; the API matches `memberId == uid` OR `guestEmail == token.email`, dedupes, and returns a guest-safe booking subset only
- [ ] Points history: `onSnapshot` on `members/{uid}/pointsHistory` subcollection
- [ ] Points balance + rewards config: fetch `members/{uid}.rewardsPoints` + `settings/rewardsConfig` on load
- [ ] Early check-in request: POST to `/api/email/early-checkin-request` with the guest Firebase ID token and selected `bookingId`; the API verifies `booking.memberId == uid` OR `booking.guestEmail == token.email` before emailing staff — always shown to members regardless of rewards config
- [ ] Member discount: if `settings/rewardsConfig.memberDiscountEnabled`, show discount badge in booking Step 1 for logged-in members (auto-applied) — if disabled, no discount shown
- [ ] Points awarded on booking checkout: if `settings/rewardsConfig.pointsEnabled`, compute points earned from booking `totalPrice` or flat per-booking value per `rewardsConfig` — `updateDoc` on `members/{uid}.rewardsPoints` + `addDoc` to pointsHistory when booking status changes to `checked-out`; triggered server-side via API route
- [ ] Points redemption: POST `/api/members/redeem-points`; API transaction validates member balance and redemption rate, updates booking totals, deducts points, and writes points history
- [ ] Undo points redemption: POST `/api/members/undo-redemption`; admin-only and only while booking status is `confirmed`
- [ ] Auth guard: all `/account/*` routes redirect to `/signin` if not authenticated

---

## Admin — Member Management

### UI Checklist
- [ ] Members list page (within admin-app) — name, email, join date, points balance, tier, total stays, last stay
- [ ] Member detail drawer — full profile, booking history, points history, manual points adjustment
- [ ] Manual points adjustment — add or deduct points with required reason note
- [ ] Disable/enable member account (without deleting)
- [ ] Search by name or email
- [ ] Filter by tier (Phase 2 when tiers are defined)
- [ ] Export members list as CSV

### Data & Logic Checklist
- [ ] `onSnapshot` on `members` collection — real-time
- [ ] Manual points adjustment: `updateDoc` on `members/{uid}.rewardsPoints` + `addDoc` to `members/{uid}/pointsHistory` with `{type: "manual", points, reason, by: staffUID, at: timestamp}`
- [ ] Disable account: `updateDoc` on `members/{uid}.isActive: false` + Firebase Admin SDK `disableUser(uid)` via API route
- [ ] Points adjustment requires reason — never adjust without audit trail

---

## Phase 2 — Loyalty Rules (TBD — not building yet)

These are documented here for awareness. Define before starting Phase 2:

- [ ] Points expiry policy
- [ ] Points redemption flow + conversion rate (e.g. 100 pts = ₱100 off)
- [ ] Tier system (names, thresholds, tier-based perks)
- [ ] Additional perks (free breakfast, room upgrades, etc.)

> Points earning and member discount are already configurable from Settings in Phase 1 — Phase 2 extends with tiers and redemption only.

---

## Edge Cases & States

- [ ] **Guest books anonymously then registers with same email** — on registration, query `bookings` where `guestEmail == member.email`, update all matching bookings with `memberId`; all previous stays immediately appear in My Stays
- [ ] Member books while logged in but uses different email — no auto-link; manual link by front desk from Member detail drawer
- [ ] Google account email differs from booking email — after sign-in, prompt: "We found bookings under a different email. Would you like to link them?" with the booking email pre-filled — guest confirms to trigger the email-match link
- [ ] Member account disabled — redirect to `/contact` with message: "Your account has been disabled. Please contact us."
- [ ] Delete account request — delete `members/{uid}`, anonymize linked bookings (remove personal data), revoke Firebase Auth — per RA 10173 right to erasure

**Account linking — email conflict between Google and email/password:**
- [ ] Guest signs up with email/password first, then later tries Google Sign-In with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [ ] On this error: show message "An account with this email already exists. Sign in with your password first, then you can link Google to your account."
- [ ] After successful email/password sign-in: show "Link your Google account?" prompt — call `linkWithPopup(googleProvider)` to attach Google as a second provider
- [ ] Once linked: guest can sign in with either Google or email/password going forward
- [ ] Guest signs up with Google first, then tries email/password sign-in with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [ ] On this error: show message "This email is linked to a Google account. Sign in with Google instead." with a Google Sign-In button
- [ ] All booking linkage by email applies regardless of auth provider — the email is the identity anchor, not the provider

## Manual QA

- [ ] Google Sign-In creates member account and profile
- [ ] Email/password signup creates member account
- [ ] Post-booking registration prompt appears on Step 4 for non-members
- [ ] Past bookings linked to member account on registration (by email) — My Stays shows previous anonymous bookings immediately after sign-up
- [ ] My Stays shows correct booking history
- [ ] Email/password account + Google Sign-In same email → account linking prompt shown, both providers work after linking
- [ ] Google account + email/password same email → directed to Google Sign-In with friendly message
- [ ] My Rewards shows points balance (0 for new members)
- [ ] Early check-in request reaches front desk
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
