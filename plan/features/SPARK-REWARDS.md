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
- [x] Filter by tier (Deferred to Phase 2 when tiers are defined)
- [x] Export members list via the full data backup (XLSX) on the Reports page (admin-only — the "Members" worksheet inside the full-backup `.xlsx` carries member number, full name, email, phone, auth provider, rewards points, tier, active, member since; per `audit-admin-sev4-2026-07-07.test.ts` §AA-32, no standalone CSV button is shipped — the XLSX Members worksheet is the canonical export)

### Data & Logic Checklist
- [x] `onSnapshot` on `members` collection — real-time
- [x] Manual points adjustment: `updateDoc` on `members/{uid}.rewardsPoints` + `addDoc` to `members/{uid}/pointsHistory` with `{type: "manual", points, reason, by: staffUID, at: timestamp}`
- [x] Disable account: `updateDoc` on `members/{uid}.isActive: false` + Firebase Admin SDK `disableUser(uid)` via API route
- [x] Points adjustment requires reason — never adjust without audit trail

---

## Phase 2 — Loyalty Rules (TBD — not building yet)

These are documented here for awareness. Define before starting Phase 2:

- [x] Points expiry policy (Deferred to Phase 2)
- [x] Points redemption flow + conversion rate (e.g. 100 pts = ₱100 off) (Deferred to Phase 2)
- [x] Tier system (names, thresholds, tier-based perks) (Deferred to Phase 2)
- [x] Additional perks (free breakfast, room upgrades, etc.) (Deferred to Phase 2)

> Points earning and member discount are already configurable from Settings in Phase 1 — Phase 2 extends with tiers and redemption only.

---

## Phase 12 — Early Check-In Approval Workflow

> Closes the loop on the Phase 1 early check-in perk. The request ends at a staff notification email and persists onto the booking document, and staff can approve/decline the request in the booking drawer.
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
- [x] Absent map = no request ever made. One request per booking: re-submission while `requested` overwrites time/notes and re-notifies staff; re-submission after `declined` is allowed (resets to `requested`); blocked after `approved` (guest sees the approved state instead)

### Request submission (changes to existing flow)

- [x] `/api/email/early-checkin-request` additionally persists the `earlyCheckIn` map onto the booking via Admin SDK in the same handler — guest client still never writes `bookings/` directly (per `plan/docs/GOTCHAS.md`)
- [x] **Tighten auth**: once the request writes to the booking doc, require a verified Firebase ID token (drop the tokenless `bookingId` + `guestEmail` fallback for this action) — the perk is member-only anyway, and a write should not be reachable via the public lookup pattern
- [x] Reject the request if booking status is not `confirmed` (e.g. `cancelled`, `checked-in`, `checked-out`) or if check-in date has passed
- [x] Staff notification email unchanged (existing `earlyCheckinRequestEmail` template)

### Admin — booking drawer

- [x] "Early check-in" panel in the booking detail drawer, shown only when `booking.earlyCheckIn` exists — requested time, guest notes, requested-at, current status badge
- [x] Approve / Decline actions (front desk + admin roles) — Approve captures optional confirmed time + staff note; Decline captures optional reason (stored in `staffNote`)
- [x] Resolution goes through an authenticated staff action in the existing API catch-all (no new Vercel function — see `plan/docs/VERCEL-FUNCTION-LIMIT.md`), which updates the booking and fires the guest email server-side with a server-controlled recipient (`booking.guestEmail`)
- [x] Early check-in badge on the booking row / arrivals list for `approved` bookings so front desk sees it on the check-in day

### Guest visibility

- [x] Guest confirmation email on resolve — approved (with confirmed time + staff note) or declined (with reason if given); new template in the email handler, staff-triggered only
- [x] My Stays + My Rewards show the request status on the relevant booking — "Early check-in requested" / "Early check-in approved — from {time}" / "Early check-in unavailable"; `GET /api/members/stays` includes the `earlyCheckIn` map in its guest-safe booking subset
- [x] Rewards portal "Request Early Check-In" modal reflects an existing request instead of allowing a duplicate submission (per the one-request-per-booking rule above)

### Edge cases

- [x] Booking cancelled after request — no special handling; the drawer panel disappears with the cancelled booking flow, no email fired
- [x] Check-in day arrives with status still `requested` — no auto-resolution; guest UI shows "Not yet confirmed — please ask the front desk on arrival"
- [x] Never log PII in the request/resolve handlers (per Hard Rules)
- [x] Existing rate limit on the email endpoint continues to cover request submission

### Out of scope

- The dormant `isEarlyCheckInRequest` intercom-message flag stays dormant — intercom delivery remains deferred per `plan/features/INTERCOM-INBOX.md §Preserve early check-in request metadata`. This workflow is email + booking-document only.

### Manual QA (when built)

- [x] Member requests early check-in → `earlyCheckIn` map appears on the booking, staff email received
- [x] Approve from drawer → guest email received, My Stays shows approved state with time
- [x] Decline from drawer → guest email received, portal allows re-request
- [x] Non-member token / tokenless request → rejected
- [x] Request against a cancelled or past booking → rejected

---

## Edge Cases & States

- [x] **Guest books anonymously then registers with same email** — on registration, query `bookings` where `guestEmail == member.email`, update all matching bookings with `memberId`; all previous stays immediately appear in My Stays
- [ ] **Deferred (Spark Rewards audit 2026-07-18 MED-3)** — Member books while logged in but uses different email. The "no auto-link" half is correct (`linkBookingsByEmail` only matches on the token email, so a different-email booking will not be linked). The "manual link by front desk from Member detail drawer" half is **unbuilt** — there is no booking→member link action in the admin member drawer (`admin-app/src/pages/MembersPage.tsx` exposes only points adjustment + suspend/activate). A guest whose account email differs from an earlier anonymous booking's email must use the booking-lookup workaround below; the front-desk manual-link path is deferred until the second white-label client or until a hotel explicitly asks for it. **Workaround** — the guest can still find the booking at `/my-booking` (ref + email), and admin can update the booking's `memberId` via the booking drawer manually (existing staff tool, not part of the member surface). See `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md §MED-3` and decision #135.
- [ ] **Deferred (Spark Rewards audit 2026-07-18 MED-3)** — Google account email differs from booking email; post-sign-in prompt: "We found bookings under a different email. Would you like to link them?" with the booking email pre-filled. No such prompt exists in `guest-app/src` (the `RewardsLandingPage`, `ProfilePage`, and post-booking confirmation page are the only Spark Rewards join surfaces, and none of them offer a different-email reconciliation flow). Build it (guest self-service) or build the front-desk manual-link surface from the previous entry — both deferred per the audit. **Workaround** — same as the previous entry: `/my-booking` (ref + email) for the guest, booking drawer `memberId` edit for staff. See decision #135.
- [x] Member account disabled — redirect to `/contact` with message: "Your account has been disabled. Please contact us."
- [x] Delete account request — delete `members/{uid}`, anonymize linked bookings (remove personal data), revoke Firebase Auth — per RA 10173 right to erasure

**Account linking — email conflict between Google and email/password:**
- [x] Guest signs up with email/password first, then later tries Google Sign-In with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [x] Phase 1 behavior: show a provider-conflict message that tells the guest to use the existing sign-in method first; full self-service `linkWithPopup(googleProvider)` is deferred.
- [x] Phase 2 behavior: after successful email/password sign-in, show "Link your Google account?" prompt — call `linkWithPopup(googleProvider)` to attach Google as a second provider (Deferred to Phase 2)
- [x] Once linked in Phase 2: guest can sign in with either Google or email/password going forward (Deferred to Phase 2)
- [x] Guest signs up with Google first, then tries email/password sign-in with the same email → Firebase throws `auth/account-exists-with-different-credential`
- [x] Phase 1 behavior: show a provider-conflict message that tells the guest to sign in with the existing method first
- [x] All booking linkage by email applies regardless of auth provider — the email is the identity anchor, not the provider

## Manual QA

- [x] Google Sign-In creates member account and profile
- [x] Email/password signup creates member account
- [x] Post-booking registration prompt appears on Step 4 for non-members
- [x] Past bookings linked to member account on registration (by email) — My Stays shows previous anonymous bookings immediately after sign-up
- [x] My Stays shows correct booking history
- [x] Email/password account + Google Sign-In same email → provider-conflict message shown; self-service linking is deferred to Phase 2
- [x] Google account + email/password same email → provider-conflict message shown; self-service linking is deferred to Phase 2
- [x] My Rewards shows points balance (0 for new members)
- [x] Early check-in request reaches front desk — via staff email (email-only delivery; submission flow covered by automated tests in `guest-app/tests/api/early-checkin.test.ts` and `early-checkin-member-auth.test.ts`)
- [x] Admin member list shows all members with correct data
- [x] Manual points adjustment updates balance and logs to history
- [x] Disable member — member cannot sign in
- [x] `/account/*` routes redirect to `/signin` when not authenticated

## Known Issues (Audit 2026-07-18)

Findings from the Spark Rewards feature audit — full report in `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md`.

- ✅ **HIGH — Email-based booking match trusts unverified email claims** — **Closed 2026-07-25** (decision #133, branch `fix/spark-rewards-email-verified-gate`). `authenticateUser` now surfaces `decodedToken.email_verified` on its return shape. `handleListMemberStays` returns `403 { code: "EMAIL_NOT_VERIFIED" }` when the email isn't verified (Google sign-in tokens are always verified — this is effectively a gate on the email/password path). `handleRegisterMember` still creates the `members/{uid}` doc but **skips `linkBookingsByEmail`** when the email isn't verified; the response carries `{ data: { emailVerified: false, linkedBookings: 0 }, warning: "Verify your email to link your past bookings." }` so the client can render a "verify your email" prompt. The router-level check in the `early-checkin-request` branch returns the same 403 before `findBooking` runs; `findBooking`'s `emailMatches` predicate is also hardened to require `user.email_verified === true` as a defensive second line (the `memberId` match is always safe). The client's `signUpWithEmail` now `void`-calls `sendEmailVerification(credential.user)` (non-blocking) immediately after `createUserWithEmailAndPassword`, and a new reusable `<EmailVerifyBanner />` component surfaces the unverified state on `My Stays` + `My Rewards` (replaces the early check-in button while unverified) + `My Profile`, with "Resend verification email" + "I already verified" actions. The auth context gains `resendVerification()` and `refreshAuthUser()`. Idempotency: a user who verifies after signup can re-call `/api/members/register` to trigger the `linkBookingsByEmail` pass — registration is idempotent (`memberNumber` is preserved). No schema change, no rules change, no migration. **Manual QA follow-up** — verify on a real test booking: (a) email/password signup sends a verification email, (b) the banner appears on `/account/profile` immediately, (c) `/account/stays` returns 403 with the "verify your email" error, (d) clicking the verification link in another tab + pressing "I already verified" promotes `user.emailVerified` to `true` and surfaces the linked stays on the next render.
- ✅ **MED — "Different email" booking reconciliation is unbuilt despite the checklist marking it done** — **Closed 2026-07-25 (spec-correction variant, decision #135)**. The build variant is still deferred; this closure is the doc-accuracy fix only. The two §Edge Cases entries that previously read `[x]` ("manual link by front desk from Member detail drawer" and "Google account email differs from booking email — after sign-in, prompt…") are now `[ ]` with explicit "Deferred (Spark Rewards audit 2026-07-18 MED-3)" prefixes and the `/my-booking` (ref + email) + booking-drawer `memberId`-edit workarounds are documented inline. No code change; no spec drift for the build variant — re-mark as "Build when the second white-label client or a hotel explicitly asks" in a future phase, or build the front-desk manual-link surface from the MembersPage detail drawer (smaller surface than the guest self-service prompt). The doc-accuracy concern from the audit is fully resolved; the functional gap remains and is intentionally carried as deferred.
- ✅ **MED — Manual points adjustment is a client-side write, forcing permissive `members` update rules** — **Closed 2026-07-25** (decision #134, branch `fix/spark-rewards-manual-points-server-side`). `POST /api/members/manual-adjust` (admin-only, Zod-validated body `{ memberId, amount, reason }`, 10/min/IP, server `runTransaction` couples `rewardsPoints` + `pointsHistory` in one commit, hardcoded `type: "manual"` on the history row so callers cannot inject "earn" / "redeem" rows). `AdminContext.updateMemberPoints` now calls the endpoint via `fetch`. The Firestore `members/{uid}` staff update allowlist is tightened to `["isActive", "isMember", "tier", "memberSince", "memberNumber", "notes", "handledBy", "updatedAt"]` — **`rewardsPoints` is no longer writable from any client**. The "balance always equals sum(history)" invariant is now enforced at the rules boundary, not only in app code. 10 new server tests pin the contract (`guest-app/tests/api/members-manual-adjust.test.ts`): admin-only, debit + credit, below-zero guard, missing member, zero-amount, empty-reason, tokenless, method, hardcoded `type:"manual"`, transaction atomicity. All four balance-mutation paths (earn, redeem, undo, manual-adjust) are server-side. No client surface change. **Manual QA follow-up** — verify on a real test member: (a) admin can credit + debit with a reason and the history row appears, (b) front-desk gets 403, (c) trying to drive the balance below zero returns 400, (d) a client call that tries to inject `type: "earn"` in the body still writes `type: "manual"` server-side.
- ✅ **LOW-1 — Enrollment consent disclosure inconsistent across join surfaces** — **Closed 2026-07-25** (decision #136, branch `fix/spark-rewards-lows-batch`). The Rewards landing one-click enroll button on `/rewards` now mirrors `ProfilePage` with a Privacy Policy + Terms of Service disclosure line below the button. The `/signup` checkbox + the `ProfilePage` disclosure + the new landing disclosure all use the same `/privacy` + `/terms` link copy. `shared/__tests__/spark-rewards-lows-batch.test.ts §LOW-1` pins the contract.
- ✅ **LOW-2 — Guest-app auth persistence relies on Firebase default, not set explicitly** — **Closed 2026-07-25** (decision #136). `guest-app/src/firebase/config.ts` now pins `setPersistence(auth, browserLocalPersistence)` at module-load. The contract is now explicit; an SDK default change can no longer silently regress "stay signed in." The admin app keeps its asymmetric `browserSessionPersistence` posture (different surface, different requirement). Test pins both apps' persistence calls.
- ⏸ **LOW-3 — `linkBookingsByEmail` batch not chunked to Firestore's 500-write limit** — **Deferred 2026-07-25** (decision #136). Theoretical only — a member whose email matches >500 bookings is the only failure mode and is not realistic for a single-hotel guest. Re-mark as `Deferred` rather than building the chunking logic; revisit if a future client scales beyond 500 same-email bookings. No code change.
- ✅ **LOW-4 — Divergent, dead earning formula in `shared/utils/points.ts`** — **Closed 2026-07-25** (decision #136). `calculateEarnedPoints` deleted (it had a per-₱100-block formula that diverged from the live `calculateCheckoutPoints` proportional formula; no production call site). The two tests that exercised the divergent helper are removed. The `My Rewards` "Earn N points per ₱100 spent" copy now notes "proportional — partial ₱100 still earn fractional points" so the user-facing estimate matches the actual crediting.
- ✅ **LOW-5 — My Stays page omits early check-in status** — **Closed 2026-07-25** (decision #136). `StaysPage` now renders an `<EarlyCheckInStatusLine>` per booking (green/approved with confirmed time + staff note, red/declined with staff note, blue/requested awaiting front desk). The `StayRecord` interface gains the optional `earlyCheckIn` field (already returned by `/api/members/stays`). The spec's "My Stays + My Rewards show the request status on the relevant booking" rule is now satisfied.
- ✅ **LOW-6 — Spec calls the member export "CSV"; the shipped export is an XLSX sheet** — **Closed 2026-07-25** (decision #136). The §Spark Rewards — Admin Member Management checklist is rewritten to read "Export members list via the full data backup (XLSX) on the Reports page (admin-only — the 'Members' worksheet inside the full-backup `.xlsx` carries …)". No code change (the export was always XLSX; only the spec wording was wrong).
- ✅ **LOW-7 — Erasure placeholder email `erased@invalid` bypasses the send-skip guard** — **Closed 2026-07-25** (decision #136). `sendEmail`'s skip guard in `guest-app/server/handlers/email.ts` now matches BOTH `@example.invalid` (unverified-email test path) and `@invalid` (RA 10173 erasure path). A stray email trigger against an erased booking now skips cleanly instead of bouncing at Resend.

## References

- Guest auth vs admin auth: `plan/features/AUTH-ROLES.md`
- Booking linkage: `plan/docs/BACKEND.md §members`
- Post-booking prompt: `plan/features/BOOKING-FLOW.md §Step 4`
- Rewards signup page: `plan/features/STATIC-PAGES.md §Spark Rewards`
- RA 10173 erasure rights: `plan/docs/SECURITY.md §Data Subject Rights`
- Member types: `plan/docs/TYPES.md §Member`
