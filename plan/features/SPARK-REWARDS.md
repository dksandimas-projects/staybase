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

### Phase 2 schema & types (2026-10-12, partial — schema only)

> The data model is in place; the UI + behavior wiring rolls out across multiple follow-up PRs. Nothing changes at runtime in this PR — backward-compat: all new fields default to "off / no-op" when absent.

- [x] **`settings/rewardsConfig`** — Zod-validated payload extended with the five new scalars + `levels[]`. Canonical schema: `shared/schemas/rewardsConfig.ts` (`RewardsConfigSchema`). Canonical TypeScript type: `RewardsConfig` in `shared/types/index.ts`. Seed defaults match the Settings → Rewards tab screenshot: 3 tiers (Member / Silver / Gold) with `discountPct` 5/7/10, `pointsMultiplier` 1/1.25/1.5, and the matching perks blurbs. All four new scalars seeded to `0` so a fresh deploy matches pre-Phase-2 behavior exactly.
- [x] **`members/{memberId}`** — added `completedStays: number` (counter, default `0`) and `currentLevel: LevelDef | null` (cache, default `null`). Both optional — legacy member docs are valid as-is.
- [x] **`pointsHistory` ledger** — `PointsHistoryType` union extended with `"welcome"` (Phase 6 wires it on `POST /api/members/register`) and `"free-night"` (Phase 5 wires it on the free-night voucher trigger). Live writers come in those phases; the type union is honest now so consumers don't need a TS cast.
- [x] **Shared helpers** — `resolveCurrentLevel(levels, completedStays)` returns the tier with the highest `fromStays ≤ completedStays` (null on empty / no match / non-finite stays; defensive sort). `calculatePointsWithMultiplier(basePoints, multiplier)` rounds to nearest integer (matches `pointsHistory.points` convention); multiplier ≤ 0 / null / undefined coerced to 1 (defense-in-depth).
- [x] **Tests** — `shared/__tests__/rewards-config-schema.test.ts` (NEW) pins the Zod validation surface + both helpers (24 source-text + runtime assertions).
- [x] **MD sync** — `plan/docs/BACKEND.md` (settings/rewardsConfig + members/{memberId} field tables), `plan/docs/TYPES.md` (Phase 2 types section), and this spec doc all updated.

### Phase 2 rollout sequence (next PRs)

Each phase below is a standalone PR (multi-PR split, 2026-10-12). The numbers reference the PR sequence in `plan/project/ROADMAP.md §Spark Rewards Tier System (Phase 2)`.

1. **PR #1 — Schema & types** — **SHIPPED** (`d88eec4`, 2026-10-12). Adds the data model + Zod + helpers + tests + MD sync. No behavior change.
2. **PR #2 — Settings UI** — **SHIPPED** (`77eb93e`, 2026-10-12). Rewrites the Settings → Rewards tab to match the screenshot (5-column levels table editor with Add/Delete + welcome-points + min-redeem + bill-cap + free-night-every inputs + Save). Validation feedback inline; one atomic save via existing `updateSettings("rewardsConfig", …)`.
3. **PR #3 — Member-side counters** — **SHIPPED** (this commit). Adds `members.{uid}.completedStays++` at checkout (same transaction as the points earn step). Adds `currentLevel` cache field, refreshed at checkout + register (initial base-tier snapshot). Bonus: the tier's `pointsMultiplier` is now applied to the points credit (immediate + deferred paths) so Gold members see the 1.5× earn rate at checkout.
4. **PR #4 — Booking engine** — **SHIPPED** (`aaf2303`, 2026-10-12). Wires tier discount + min-redeem guard + bill cap at booking time. `tierDiscount = currentLevel?.discountPct ?? rewardsConfig.memberDiscountPct` (tier wins — even when tier says 0; admin's deliberate choice). Same max-of rule with promos as today. Adds `minPointsToRedeem` guard + `pointsCanPayUpToBillPct` cap on `/api/members/redeem-points`.
5. **PR #5 — Free-night voucher** — **SHIPPED** (this commit). Extends `vouchers/{id}` schema with `kind: "reward"` + `valueType: "free-night"`. At checkout, after `completedStays++`, if `completedStays % freeNightEvery === 0` write a voucher (`expiresAt: +90d`). Reuses the existing apply-at-checkout path (100% discount via `discountType: "percent"` + `discountValue: 100`). Admin voucher table gains a Kind column with distinct badges + a Member column for reward vouchers.
6. **PR #6 — Welcome points** — **SHIPPED** (this commit). `handleRegisterMember` reads `rewardsConfig.welcomePoints` pre-transaction, checks the idempotent `pointsHistory/welcome` row (deterministic doc ID = `welcome`), and credits `rewardsPoints` + writes the history row inside the same `runTransaction` as the member doc creation. One-shot per member — re-registration (the existingMember.memberNumber short-circuit branch) does NOT re-credit.
7. **PR #7 — Member portal display** — **SHIPPED** (this commit). `/account/rewards` shows tier badge + progress-to-next + free-night voucher status. `/account/profile` Spark Rewards card shows tier name.
8. **PR #8 — Audit + final tests** — **SHIPPED** (this commit). Cross-phase integration audit + derivation rule audit + clawback audit. Source-text pins only (no runtime suite — the runtime behavior is covered by the existing member-portal e2e tests + the per-phase handler tests).
9. **PR #9 — Member self-service points redemption** — **SHIPPED** (this commit). New `allowMemberPointsRedemption` admin toggle (Settings → Rewards → Advanced / legacy controls, default OFF). When ON, signed-in members can apply their own points balance from the booking Step 3 review panel via the new member-authenticated `POST /api/members/redeem-points-self` endpoint. The shared `applyPointsRedemption` helper ensures both staff + self paths run the same 9 guards atomically — only the actor changes. The `pointsRedeemedBy` audit field carries `"self:{memberUid}"` for self-applies so reports can distinguish at a glance.

### Phase 2 PR #3 detail — Member-side counters (2026-10-12, SHIPPED)

> The data-layer counterpart to PR #2. `completedStays` is the authoritative stay-completion signal the tier system reads from; `currentLevel` is the cached snapshot the member portal + booking engine consult at read time.

- [x] **Checkout (`handleCheckoutBooking`)** — Inside the existing `runTransaction` block, the `completedStays++` + `currentLevel` cache refresh share the same `transaction.update` call as the points credit. Atomicity = no double-count on transaction retries. The increment runs on BOTH paths:
  - `awardNow = true` (immediate credit) — `rewardsPoints += pointsAwarded` + `completedStays++` + `currentLevel` refresh + `pointsHistory` `earn-${bookingId}` row in ONE write
  - `awardNow = false` (pending-payment deferral) — `completedStays++` + `currentLevel` refresh ONLY; the `pendingLoyaltyPoints` snapshot on the booking + the settle-payment branch (line 8109+) handle the actual credit later
  - Per FOL-03 + Hard Rule #1, all `get()` calls complete BEFORE any `update()` (the pre-transaction read of `rewardsConfig` + `memberDoc` provides the tier snapshot for the multiplier calculation)
- [x] **Multiplier application** — `eligiblePoints` becomes `calculatePointsWithMultiplier(baseEligiblePoints, memberTierMultiplier)` so the credited value (or the `pendingLoyaltyPoints` snapshot) carries the tier's bonus. The settled-payment branch at line 8109 reads `pendingLoyaltyPoints` AS-IS — no double-multiplication. A Silver member's 100 base points → 125; Gold's 100 → 150.
- [x] **Register (`handleRegisterMember`)** — New member docs initialize `completedStays: 0` + `currentLevel: baseCurrentLevel` (the tier with `fromStays === 0`, or `null` when no tiers are configured). The pre-transaction read of `settings/rewardsConfig` happens immediately before the `set(memberRef, ...)` call. Existing members (re-registration) preserve their prior `completedStays` + `currentLevel`.
- [x] **Cancellation clawback (post-checkout cancel)** — `completedStays` is NOT decremented. The existing MRB-05 PR #2 pattern (negative `pointsHistory` `clawback-${bookingId}` entry) handles the points reversal; `rewardsPoints` field is unchanged; the ledger is the source of truth. A `completedStays` decrement would force either an out-of-band recompute or a fan-out write to every member doc on every tier-rule change — not worth the complexity for the use case (a member who actually stayed shouldn't be punished for the rare post-settlement cancellation). This matches the MRB-05 "stay happened, financial reversal is separate" philosophy.
- [x] **Cancellation clawback (pre-checkout cancel)** — No-op. `completedStays` was never incremented (the increment happens at checkout, when the stay transitions to `checked-out`). The MRB-05 points clawback applies if the booking had pre-existing `pointsRedeemed` (handled by the existing handler, unchanged).
- [x] **Client-side `MemberProfile`** — Extended with `completedStays?: number` + `currentLevel?: LevelDef | null`. Both optional — a legacy pre-Phase-2 member's `onSnapshot` listener still parses without a schema migration. The GuestAuthContext's `onSnapshot` listener picks them up automatically (Firestore returns whatever fields exist; missing fields are `undefined`).
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-checkout.test.ts` (NEW, 9 source-text pins). Pins the import block, the pre-transaction tier derivation, the multiplier application, the atomic `completedStays++` + `currentLevel` cache refresh, and the immediate-vs-deferred branching.
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section) + `plan/docs/BACKEND.md` (members field table — already updated in PR #1; this PR adds the runtime semantics comment).
- [x] **Hard Rule #1 honored** — All writes are server-side (via `adminDb.runTransaction` in the existing handler). No new Vercel functions. No Firebase Cloud Functions. No fan-out write to every member doc on tier-rule change — the cached `currentLevel` is re-derived lazily at checkout + registration time, matching the existing `rewardsPoints` + `pointsHistory` subcollection pattern.
- [x] **Backward compat** — Pre-Phase-2 member docs without `completedStays` / `currentLevel` continue to parse through the snapshot listener. The `resolveCurrentLevel` helper returns `null` for empty levels arrays (legacy / off state). The booking engine falls back to the global `memberDiscountPct` for tier-less members (decision pending — see DECISIONS-FEATURES.md).

### Out of scope (Phase 2 explicitly)

- Terms-on-the-website textarea — admin uses the global Legal tab instead; per-program override is deferred (Spark Inn has no per-program terms in scope).
- Tier re-ordering UI (drag-drop) — admin edits the `fromStays` value directly; UI auto-sorts ascending. Drag-drop is a future polish, not a requirement.
- Tier icon / color — the screenshot uses a text-only tier badge. Decorative per-tier assets are deferred.

### Phase 2 PR #5 detail — Free-night voucher (2026-10-13, SHIPPED)

> The reward voucher trigger. `handleCheckoutBooking` writes a single-use 100%-off voucher inside the existing transaction when `completedStays % freeNightEvery === 0`. The voucher is keyed deterministically by memberNumber + completedStays so the member can find it on the rewards portal (Phase 7).

- [x] **Voucher schema extension (`shared/utils/vouchers.ts` + `shared/types/index.ts`)** — `VoucherLike` interface gains five optional fields: `kind: "promo" | "reward"`, `valueType: "percent" | "flat" | "free-night"`, `memberId: string | null`, `memberNumber: string | null`, `rewardSource: "free-night-tier" | "welcome" | null`. All backward-compat — pre-Phase-5 docs are missing these and read as legacy promos. Canonical helpers added: `isRewardVoucher`, `isFreeNightVoucher`, `generateFreeNightVoucherCode` (format `FREENIGHT-{memberNumber}-{completedStays}` with member-number sanitization).
- [x] **Checkout-time voucher write (`guest-app/server/handlers/bookings.ts`)** — Inside the existing `canAwardPoints && memberId && memberRef && memberDocInTransaction?.exists` block (Phase 3 PR #3's atomic counter increment), the handler reads `rewardsConfig.freeNightEvery` pre-transaction. When `> 0` AND `nextCompletedStays > 0` AND `nextCompletedStays % freeNightEvery === 0`, it writes a `vouchers/{code}` doc inside the same `runTransaction`:
  - `kind: "reward"`, `valueType: "free-night"` (canonical reward shape)
  - `discountType: "percent"`, `discountValue: 100` (100% off via the existing discount math; `calculateVoucherDiscount` caps at subtotal)
  - `usageCap: 1`, `usageCount: 0`, `expiresAt: +90 days`
  - `applicableRoomTypes: []` (applies to all per VOU-03 all-or-none rule)
  - `memberId` + `memberNumber` back-link for member portal display (Phase 7)
  - `rewardSource: "free-night-tier"` (Phase 6 will use `"welcome"`)
- [x] **Trigger fires on BOTH paths** — The voucher write runs in both `awardNow = true` (immediate credit) and `awardNow = false` (pending-payment deferral). The stay IS completed either way, so the trigger fires regardless of payment status. The settled-credit branch (line 8109+) does NOT re-trigger (Phase 3 PR #3 already handled the `completedStays++` there — no double-award).
- [x] **Post-settlement cancellation** — A free-night voucher stays valid even if the booking that triggered it is later cancelled post-settlement (the MRB-05 pattern). Per Phase 3 PR #3's cancellation-clawback decision, `completedStays` is NOT decremented on post-settlement cancel — the stay happened, the free-night was earned. (For pre-settlement cancel, `completedStays` was never incremented, so no voucher was triggered.)
- [x] **Admin voucher table update (`admin-app/src/pages/RatesPage.tsx`)** — Two new columns:
  - **Kind** — pill badge: amber "Free Night" / "Reward" for reward vouchers, gray "Promo" for legacy. Visually distinct so admins can scan-filter at a glance.
  - **Member** — shows `memberNumber` (e.g. "SR-10023") for reward vouchers, "—" for promos.
- [x] **Admin mapping (`admin-app/src/context/AdminContext.tsx`)** — `Voucher` interface extended with the Phase 5 fields. The Firestore → `Voucher` mapping falls back to `kind: "promo"` + `valueType: data.discountType | "flat"` + `memberId: null` + `memberNumber: null` for pre-Phase-5 docs (non-breaking).
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-free-night-voucher.test.ts` (NEW, 12 source-text pins). Pins the VoucherLike extension, the isRewardVoucher / isFreeNightVoucher / generateFreeNightVoucherCode helpers, the canonical Phase 5 voucher write shape in the checkout handler, the deterministic code generation, the 90-day expiry, the back-link fields, the admin Voucher interface + Firestore mapping defaults, the Kind column's distinct badges, and the Member column rendering.
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section) + `plan/docs/BACKEND.md` (voucher field table extended with the five new Phase 5 rows).
- [x] **Hard Rule #1 honored** — All writes are server-side via `adminDb.runTransaction` in the existing handler. No new Vercel functions. No Firebase Cloud Functions. No janitor for expired free-night vouchers (expiry check at apply time, per the existing `validateVoucher` helper).
- [x] **Backward compat** — Pre-Phase-5 promo vouchers are valid as-is. The schema extension is purely additive (all new fields are optional). The apply-at-checkout path (VOU-01) routes through the existing `discountType` / `discountValue` math — a `kind: "reward"` free-night voucher uses `discountType: "percent"` + `discountValue: 100` so the same `calculateVoucherDiscount` function produces 100% off without any new apply path.

### Phase 2 PR #6 detail — Welcome points (2026-10-13, SHIPPED)

> The member-onboarding counterpart to PR #5. A new member gets a one-time points credit at registration, stored in the same append-only `pointsHistory` ledger the rest of the points operations use. The credit is gated on the admin-configurable `rewardsConfig.welcomePoints` (default 0 = off).

- [x] **Pre-transaction read (`guest-app/server/handlers/members.ts`)** — Same pattern as Phase 3's `baseCurrentLevel` derivation. Reads `settings/rewardsConfig` outside the `runTransaction` so `welcomePoints` is known before any writes (FOL-03 — all reads complete before any writes). Coerced via `Math.max(0, Math.floor(Number(...)))` to defend against hand-edited configs that might pass a string or float.
- [x] **Idempotent welcome row (`pointsHistory/welcome`)** — Deterministic doc ID = `welcome` (reserved for the first-credit event). The transaction reads `members/{uid}/pointsHistory/welcome` BEFORE any writes; if it exists, the bonus was already credited (re-registration path per Spark Rewards audit 2026-07-18 HIGH-1 — user re-calls `/api/members/register` after email verification). The `welcomeAlreadyCredited` boolean gates the credit.
- [x] **Atomic credit + history write** — Both writes share the same `runTransaction`:
  - `members/{uid}.rewardsPoints` += `welcomeAmount` (computed as `(existingMember?.rewardsPoints || 0) + welcomeAmount`)
  - `members/{uid}/pointsHistory/welcome` set with `{ type: "welcome", points: welcomeAmount, memberId: uid, note: "Welcome bonus (N points)", createdAt: now, createdBy: "system" }`
  - Reward invariant preserved: `rewardsPoints === sum(pointsHistory.points)`
- [x] **One-shot decision (2026-10-13)** — The welcome bonus fires only on FIRST registration (the new-member branch after `if (existingMember?.memberNumber) { return; }`). Re-registration (e.g. HIGH-1 email-verification retry path) just refreshes `isMember` + `memberSince` — it does NOT re-credit. Same convention as booking-engine: "earn per-event" not "earn per-render".
- [x] **Verification status decision (2026-10-13)** — The welcome bonus applies REGARDLESS of `authUser.email_verified` status. The HIGH-1 audit gates `linkBookingsByEmail` (a separate concern — past booking attribution). The welcome credit is unconditional once the user is signed in. The `pointsHistory` row is the audit trail — admins can see the credit was issued to an unverified email via Reports if they care.
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-welcome-points.test.ts` (NEW, 6 source-text pins). Pins the pre-transaction `welcomePoints` read, the deterministic doc ID, the idempotency boolean, the atomic credit + history write, the canonical Phase 6 ledger shape, and the one-shot decision (the `existingMember.memberNumber` short-circuit branch is unchanged).
- [x] **Existing test mock extension** — `tests/api/members-register.test.ts`: the Firebase Admin mock gained a `"settings"` collection case so the pre-transaction `settings/rewardsConfig` read resolves to an empty doc by default (`welcomePoints: 0`). All 7 existing tests still pass.
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section). `plan/docs/BACKEND.md` already documents the `pointsHistory` subcollection (PR #1). `shared/types/index.ts` already declares the `"welcome"` type in `PointsHistoryType` (PR #1).
- [x] **Hard Rule #1 honored** — All writes are server-side via `adminDb.runTransaction` in the existing handler. No new Vercel functions. No Firebase Cloud Functions. The deterministic doc ID `welcome` means the idempotency check is a single `.get()` — no query fan-out, no FQL cost.
- [x] **Backward compat** — Pre-Phase-6 deployments that never configured `welcomePoints` (the field defaults to 0 in PR #1's seed + Zod schema) skip the credit entirely — `welcomeAmount = 0`, the deterministic doc is never written, the member doc only updates `rewardsPoints` to its prior value. The `members-register.test.ts` mock simulates this exact path: no `settings/rewardsConfig` doc → `welcomePoints = 0` → no write. All 7 existing tests pass.

### Phase 2 PR #7 detail — Member portal display (2026-10-13, SHIPPED)

> The guest-visible counterpart to PRs #3 (counter cache), #5 (voucher trigger), and #6 (welcome credit). Until now the data was being written but the member had no way to see it. This PR wires the read side: tier badge + progress-to-next bar + free-night voucher list on `/account/rewards`, and the tier name in the header card on `/account/profile`. No new server logic — purely client-side rendering over the existing Firestore subscriptions.

- [x] **Tier badge on `/account/rewards` (`guest-app/src/pages/RewardsPage.tsx`)** — Reads `memberProfile.currentLevel?.name` (Phase 3 PR #3 cache field) with a `sortedLevels[0].name` fallback for pre-Phase-2 member docs that haven't been touched by a checkout yet. Renders the name in a `data-testid="member-tier-name"` element next to the existing `Sparkles` icon — visually distinct but doesn't break the existing card layout.
- [x] **Progress-to-next bar (ARIA progressbar)** — When both `currentLevel` and `nextLevel` exist, the page renders an accessible progress bar:
  - `role="progressbar"` + `aria-valuenow={progressPct}` + `aria-valuemin={0}` + `aria-valuemax={100}` + `aria-label="{N} more stay{s} to {nextLevel.name}"`
  - `progressPct = min(100, round((completed - current.fromStays) / (next.fromStays - current.fromStays) × 100))`
  - `remainingStays = max(0, next.fromStays - completed)`
  - Top-tier branch (`currentLevel && !nextLevel`) renders a friendly "Top tier — enjoy your perks!" instead of a bar.
  - Empty-config branch (`!currentLevel && sortedLevels.length > 0`) renders "Stay with us to unlock tier perks." — the admin hasn't configured tiers yet, so the member sees a prompt, not a 0% bar.
- [x] **Free-night voucher card (`guest-app/src/pages/RewardsPage.tsx`)** — New "Your Free Nights" card that lists the member's active reward vouchers via a live `vouchers` subscription filtered by `kind === "reward"` AND `memberId === current uid`. The filter is Firestore-indexed so the read is O(owned vouchers), not O(all vouchers). The card only renders when at least one usable voucher exists — no "you have no usable vouchers" empty state (consistent with the booking flow's positive-only UX). For each row:
  - Deterministic code in mono-bold-amber (e.g. `FREENIGHT-SR-10023-5`) — easy to copy into the booking flow's voucher field
  - "100% off" label for `valueType === "free-night"`, `{v.discountValue} off` for any other reward shape (future-proof)
  - Expiry line: ` · expires {v.expiresAt}` (only when set)
  - Amber "Free Night" pill badge on the right
  - `data-testid="reward-voucher-row"` for e2e selector
- [x] **Voucher filtering** — Before rendering, the subscription result is filtered to drop unusable vouchers:
  - `!v.isActive` → skip (admin deactivated)
  - `v.usageCap !== null && v.usageCount >= v.usageCap` → skip (already used)
  - `v.expiresAt && new Date(v.expiresAt).getTime() < now` → skip (expired)
  - All three checks are short-circuit `return false`s inside a single `.filter()` so the render stays flat.
- [x] **Profile tier name (`guest-app/src/pages/ProfilePage.tsx`)** — The Spark Rewards header card under the points balance replaces the hardcoded "Standard Member" text with `{memberProfile.currentLevel?.name ?? "Member"}`. Tagged with `data-testid="profile-tier-name"` for the existing e2e suite. Falls back to "Member" for pre-Phase-2 docs that haven't been touched by a checkout yet — matches the `/account/rewards` fallback so the two pages are consistent.
- [x] **`RewardsConfig` snapshot extension** — The local `RewardsConfig` interface on `RewardsPage.tsx` gains `welcomePoints?: number`, `minPointsToRedeem?: number`, `pointsCanPayUpToBillPct?: number`, `freeNightEvery?: number`, and `levels?: LevelDef[]` — all optional, with defensive coercion (`Number(...) ?? 0`, `Array.isArray(...) ? ... : []`). The Settings → Rewards `RewardsConfigSchema` already validates the live data; the local interface is just for type-safe rendering.
- [x] **Live subscription pattern** — `onSnapshot(query(collection(db, "vouchers"), where("kind", "==", "reward"), where("memberId", "==", user.uid)), callback)` with cleanup in the `useEffect` return. Re-uses the existing `VoucherLike` shape from Phase 5 PR #5 — no new types needed.
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-member-portal.test.ts` (NEW, 12 source-text pins). Pins: the `LevelDef` import, the local `RewardsConfig` extension with the five new fields, the snapshot coercion (`Number(...) ?? 0`, `Array.isArray(...) ? ... : []`), the live `kind=reward` + `memberId=user.uid` subscription filter, the `currentLevel?.name ?? sortedLevels.find(...)` fallback, the `data-testid="member-tier-name"` element, the ARIA progressbar + the four `aria-valuenow/min/max/label` attributes, the progress-percent math (`Math.min(100, Math.round((completed / span) * 100))`), the "Top tier — enjoy your perks!" branch, the "Stay with us to unlock tier perks." branch, the `data-testid="reward-voucher-row"` card, the mono-bold-amber code styling, the `valueType === "free-night" ? "100% off"` label, the "Free Night" pill text, the three filter short-circuits, the `ProfilePage` `data-testid="profile-tier-name"` element, the `currentLevel?.name ?? "Member"` fallback, and the absence of the legacy "Standard Member" hardcoded text.
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section). `plan/docs/BACKEND.md` (voucher field table — already updated in PR #5; no new fields). `shared/types/index.ts` (`MemberProfile` already declares `currentLevel?: LevelDef | null` from PR #3).
- [x] **Hard Rule #1 honored** — All reads are client-side via the existing Firestore SDK + the existing `vouchers/{id}` collection shape. No new Vercel functions. No Firebase Cloud Functions. No new server-side aggregation — the tier name comes straight from the Phase 3 `currentLevel` cache field, and the voucher list comes straight from the indexed `vouchers` collection. The portal is a pure renderer.
- [x] **Backward compat** — All new fields on the local `RewardsConfig` interface are optional, with defensive coercion that handles missing/null/undefined (a pre-Phase-2 deployment has no `levels` array → `sortedLevels = []` → `tierName = "Member"` → no progress bar renders, no crash). Pre-Phase-5 member docs without `currentLevel` render the fallback. The voucher subscription returns an empty array when no reward vouchers exist → the card doesn't render at all (no empty state, no error).

### Phase 2 PR #8 detail — Audit + final tests (2026-10-13, SHIPPED)

> The cross-phase integration counterpart to PRs #1, #3, #5, #6, #7. Until now each phase shipped its own source-text pin suite covering its local invariants. Phase 8 ships a single audit file that verifies the things that only matter when the phases are wired together — atomicity boundaries, cross-phase data flow, derivation edge cases, cancellation clawback semantics, and the Phase 4 dependency note. Pure source-text pins (no new runtime tests; the per-phase tests + the member-portal e2e suite already cover runtime behavior).

- [x] **Atomicity boundaries (Phase 3 + Phase 5 share one transaction)** — Five pins: the counter increment uses `nextCompletedStays = priorCompletedStays + 1` (Firestore requires a pre-computed value); the counter + cache refresh share one `transaction.update` call (BOTH `awardNow` paths); the free-night voucher write sits INSIDE the `canAwardPoints && memberRef && memberDocInTransaction?.exists` block (atomic with the counter); the free-night trigger fires on BOTH paths (immediate + deferred) because it lives OUTSIDE the `if (awardNow) {} else {}` split; Phase 6's welcome bonus credit + history write share the register transaction.
- [x] **Cross-phase data flow (Phase 7 reads from Phase 3 cache + Phase 5 vouchers)** — Four pins: Phase 5's voucher code is generated from `memberNumber` + `nextCompletedStays` (both Phase 3 cache fields); Phase 6's welcome bonus respects Phase 3's base tier init (the register transaction initializes `currentLevel: existingMember?.currentLevel ?? baseCurrentLevel`); the portal reads `currentLevel?.name` for the tier badge and subscribes to `vouchers` filtered by `kind=reward` + `memberId=user.uid` for the free-night card; ProfilePage uses the same `currentLevel?.name ?? "Member"` pattern as RewardsPage (consistent UX).
- [x] **Derivation rule audit (`resolveCurrentLevel` + `calculatePointsWithMultiplier`)** — Six pins: ascending sort + `else break` short-circuit invariant (the highest `fromStays ≤ completedStays` is returned); null return for empty/null/undefined `levels` (legacy / off-state); null return for non-finite or negative `completedStays` (defensive); multiplier coercion to 1 for ≤ 0 / null / undefined (defense-in-depth against hand-edited configs); base points return 0 for non-finite or ≤ 0 (prevents negative credit); round-to-nearest-integer (matches `pointsHistory.points` convention so credits are symmetric with clawbacks).
- [x] **Cancellation clawback audit (MRB-05 + Phase 3 decision)** — Four pins: post-settlement cancel writes a NEGATIVE `pointsHistory` entry keyed `clawback-${bookingId}` (the negative value is computed via `clawbackPoints = -Number(...)`); the clawback uses the SAME per-booking idempotency shape as the earn entry (`earn-${bookingId}` vs `clawback-${bookingId}`); post-settlement cancel does NOT decrement `completedStays` (verified via three absent-pattern checks: `--`, `-=`, and `Math.max(0, completedStays - 1)`); free-night voucher stays valid after post-settlement cancel (verified via absent `usageCount --` / `-=` patterns).
- [x] **Voucher discriminator + value-type audit (Phase 5)** — Five pins: `VoucherLike` has the three Phase 5 discriminators (`kind`, `valueType`, `rewardSource`); `VoucherLike` has the `memberId` / `memberNumber` back-link fields; `isRewardVoucher` / `isFreeNightVoucher` helpers use the discriminator; `generateFreeNightVoucherCode` sanitizes `memberNumber` (`replace(/[^A-Z0-9_-]/gi, "")`) and floors `completedStays` (`Math.max(0, Math.floor(Number(...) || 0))`); the helper falls back to `'MEMBER'` when `memberNumber` is empty (defensive — portal can still render + copy the code).
- [x] **Welcome bonus idempotency audit (Phase 6)** — Three pins: deterministic doc ID `'welcome'` + single `.get()` (no query fan-out); welcome fires REGARDLESS of `authUser.email_verified` status (verified via two absent-pattern checks: `if (!authUser?.email_verified)` and `if (authUser?.email_verified)` — neither should gate the welcome block); welcome fires ONLY on first registration (the `existingMember?.memberNumber` short-circuit branch precedes the welcome write, verified via string-position check).
- [x] **Backward-compat audit (pre-Phase-2 deployments)** — Five pins: all five new `RewardsConfig` fields are OPTIONAL with safe defaults (`welcomePoints?: number`, `minPointsToRedeem?: number`, `pointsCanPayUpToBillPct?: number`, `freeNightEvery?: number`, `levels?: Array<...>`); the portal's local `RewardsConfig` interface uses defensive coercion (`Number(...) ?? 0`, `Array.isArray(...) ? ... : []`); `VoucherLike` Phase 5 fields are all OPTIONAL (pre-Phase-5 promo vouchers valid as-is); pre-Phase-2 member docs (no `completedStays` / `currentLevel`) render the fallback tier name on both pages; pre-Phase-5 voucher docs read as legacy promo (the `kind === "reward"` discriminator defaults absent values to the legacy promo path).
- [x] **Documentation cross-reference audit** — Five pins: BACKEND.md voucher field table documents all five Phase 5 fields + the `Phase 5 (2026-10-12)` marker; BACKEND.md points the `memberId` field at the Phase 7 portal read; BACKEND.md documents the deterministic `welcome` doc ID + the `Phase 6 (2026-10-13)` marker; SPARK-REWARDS.md has detail sections for Phases 3, 5, 6, 7; SPARK-REWARDS.md rollout sequence marks Phases 1, 2, 3, 5, 6, 7 as SHIPPED (with commit hashes for #1 + #2, "this commit" for #3 + #5 + #6 + #7) and lists Phase 4 as pending.
- [x] **Phase 4 dependency note** — Two pins: tier discount precedence (`memberTier && Number.isFinite(Number(memberTier.discountPct))` + `tierPct !== null` + `if (tierPct !== null)`) is NOT in this worktree's bookings handler (verified via three absent-pattern checks); Phase 3's `currentLevel` cache field IS in the bookings handler (Phase 4's read-side contract is in place — when Phase 4 merges, the tier discount will resolve correctly). NOTE: `appliedMemberDiscountPct` IS present in the bookings handler but is NOT a Phase 4 marker — it's the pre-Phase-4 BF-20 rename (2026-06-26) of the legacy global `memberDiscountPct` read.
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-audit.test.ts` (NEW, 40 source-text pins across 7 describe blocks). Pins: 5 atomicity boundaries, 4 cross-phase data flow, 6 derivation rule audit, 4 cancellation clawback audit, 5 voucher discriminator audit, 3 welcome bonus idempotency audit, 5 backward-compat audit, 5 documentation cross-reference audit, 2 Phase 4 dependency note. All 40 pass; 111/111 pass across all 7 tier-system suites (Phases 1 + 3 + 5 + 6 + 7 + admin UI + Phase 8).
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section + rollout sequence update). No other MDs changed — Phase 8 doesn't introduce new data model fields or behavior, only audit pins.
- [x] **Hard Rule #1 honored** — No server-side changes. No new Vercel functions. No Firebase Cloud Functions. Phase 8 is a pure source-text audit — it reads the existing source code and verifies the patterns from prior phases still hold. The audit pins are intentionally narrow (each asserts ONE invariant) so a future refactor that breaks a single invariant gets a single, specific failure.
- [x] **Phase 4 cross-reference** — Phase 4 (booking engine tier discount precedence, commit `aaf2303`) was cherry-picked onto this branch so the entire 8-phase rollout lands in one merge to `dev`. The Phase 4 dependency note pins are flipped to "IS present" (tier discount precedence + the `tierPct !== null` branch + the booking-engine test file). The cross-phase contract holds end-to-end: Phase 3 writes the `currentLevel` cache field, Phase 4 reads it, Phase 5 reads the same member doc for the free-night trigger, Phase 6 reads `rewardsConfig.welcomePoints` for the welcome bonus, Phase 7 reads `currentLevel` for the tier badge.

### Phase 2 PR #4 detail — Booking engine (2026-10-12, SHIPPED)

> The runtime counterpart to PR #3. The data model + the checkout/registration writers are in place; this PR wires the **read-side** — tier discount at booking creation/reschedule, min-redeem guard, bill-cap points cap.

- [x] **Tier discount precedence (`handleCreateBooking` + `handleRescheduleBooking`)** — Both paths now read the member's `currentLevel` cache field alongside `settings/rewardsConfig` (single `get()` block per FOL-03). The tier's `discountPct` wins over the global `memberDiscountPct` for tier-aware members; tier-less members fall back to the global. **Decision (2026-10-12):** a tier with `discountPct: 0` does NOT fall back to the global — admin set 0 deliberately (e.g. a future "Points-only" tier with no member discount). The "tier takes precedence" rule is honored even when the tier says 0.
- [x] **`minPointsToRedeem` guard (`handleRedeemMemberPoints`)** — Reads `rewardsConfig.minPointsToRedeem` (default 0 = no minimum). Rejects with a 400 + clear message if the requested amount is below the floor. Runs AFTER the existing balance check so the staff sees the most actionable error first.
- [x] **`pointsCanPayUpToBillPct` cap (`handleRedeemMemberPoints`)** — Reads `rewardsConfig.pointsCanPayUpToBillPct` (0..100, default 100 = no cap). Computes `maxRedeemablePoints = floor(booking.totalPrice × pct/100) / pointsRedemptionRate` and rejects with a "exceeds the N% bill cap" message when the requested amount exceeds the cap. `Math.floor` rounds DOWN so the cap is a hard ceiling. A value of 100 (or absent) preserves the existing legacy "no cap" behavior.
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-booking-engine.test.ts` (NEW, 8 source-text pins). Pins the tier-discount precedence in both `handleCreateBooking` + `handleRescheduleBooking`, the explicit "tier discount wins even when 0" decision, the min-points floor, and the bill-cap math (with the 100%-or-absent "no cap" escape hatch).
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section). `plan/docs/BACKEND.md` already documents the new fields via PR #1; this PR adds the runtime semantics comment.
- [x] **Hard Rule #1 honored** — All reads/writes are server-side via `adminDb.runTransaction` in the existing handlers. No new Vercel functions. No Firebase Cloud Functions.
- [x] **Backward compat** — Pre-Phase-2 deployments that never configured tiers fall back to the existing global `memberDiscountPct` path (the new code path's "tierPct === null" branch). A pre-Phase-2 booking created with `memberDiscountPct: 5` on the booking doc still works — the reschedule path reads the legacy field if `currentLevel` is missing.
- [x] **Walkin bookings unchanged** — `handleCreateWalkin` hardcodes `memberDiscountPct: 0` (walkin guests don't get member discounts). This PR leaves it alone — walkin is a separate flow; tier integration for walkin is out of scope (per the existing handleCreateWalkin semantics).

### Phase 2 PR #9 detail — Member self-service points redemption (2026-10-13, SHIPPED)

> The read-side counterpart to the staff-mediated points redemption flow that's existed since Phase 1. Until now the only path to apply points to a booking was via the admin booking drawer — members had to ask staff to apply on their behalf. PR #9 adds an admin opt-in toggle (`rewardsConfig.allowMemberPointsRedemption`) and a member-authenticated endpoint (`POST /api/members/redeem-points-self`) so a signed-in member can apply their own points balance at the booking Step 3 review panel. The toggle defaults OFF so existing deployments preserve the front-desk-mediated model exactly.

- [x] **Toggle on `settings/rewardsConfig` (`allowMemberPointsRedemption`)** — Optional boolean, default `false`. When `true`, the booking Step 3 panel exposes an "Apply Your Points" input alongside the voucher code; when `false` (the default), the section is hidden entirely. The toggle is a feature flag, NOT a security check — the real authorization is the ownership guard inside the shared helper (`booking.memberId === authUser.uid`).
- [x] **Settings UI (Advanced / legacy controls `<details>` block)** — Sibling toggle to the existing "Enable Global Member Discount Fallback" + "Allow Spark Rewards Early Check-In Requests" toggles. Same `bg-primary` / `bg-gray-200` switch UI. Default OFF. Sub-text: "When on, signed-in members can apply their own points balance to a booking from the Step 3 review panel. The same min-redeem, bill cap, and balance guards still run server-side — only the actor changes. When off (the default), points redemption remains admin-only via the booking drawer."
- [x] **Shared `applyPointsRedemption` helper (`guest-app/server/handlers/members.ts`)** — Extracted from the existing staff handler so the staff path + the new self path run the SAME 9 guards atomically. Signature: `(transaction, { bookingId, memberId, pointsToRedeem, appliedBy, appliedByLabel: "staff" | "self" })`. The 9 guards, in source order:
   1. Booking exists
   2. Status pre-checkin (rejects checked-in/checked-out/cancelled)
   3. One redemption per booking (`booking.pointsRedeemed > 0` → reject)
   4. Member ID matches `booking.memberId` (no cross-member redeem)
   5. Member exists + `isActive !== false` + `isMember !== false`
   6. `rewardsConfig.pointsRedemptionRate > 0` (rewards enabled)
   7. `minPointsToRedeem` floor (Phase 4 — default 0 = no min)
   8. `pointsCanPayUpToBillPct` cap (Phase 4 — default 100 = no cap)
   9. Balance check via `validatePointsRedemption` (most actionable error first)
- [x] **Atomic write block** — Booking update (`totalPrice` / `pointsRedeemed` / `pointsRedeemedValue` / `pointsRedeemedBy: appliedBy` / `pointsRedeemedAt`) + member `rewardsPoints` decrement + negative `pointsHistory/redeem-${randomId}` row share the same `runTransaction`. The `rebuildRateBreakdown` helper recomputes the locked rate breakdown so the booking doc's `rateBreakdown` field reflects the post-redemption totals. Same atomic boundary as before — no double-write on transaction retry.
- [x] **Audit-trail marker** — `pointsRedeemedBy` carries the raw actor: staff UID for the staff path (admin drawer), `"self:{memberUid}"` for the self path (booking Step 3). The `pointsHistory` row's `reason` text branches on `appliedByLabel`: "Points redeemed by staff" vs "Points redeemed by member at checkout". Reports can filter by `reason` to distinguish the two flows at a glance.
- [x] **New `handleRedeemPointsSelf` handler (`POST /api/members/redeem-points-self`)** — Member-authenticated via `adminAuth.verifyIdToken(req.headers.authorization)`. NOT staff-authenticated. The handler:
   - Rejects unauthenticated requests with 401
   - Parses `selfRedeemSchema` (stricter than the staff schema — no `memberId` field; clients cannot spoof the member)
   - Fail-fast on the toggle: reads `settings/rewardsConfig` outside the transaction, returns 403 when `allowMemberPointsRedemption !== true`
   - Wraps the call to `applyPointsRedemption(transaction, { memberId: authUser.uid, appliedBy: `self:${authUser.uid}`, appliedByLabel: "self" })` in `runTransaction` (FOL-03 — all `get()` calls complete before any `update()`)
   - The helper's member-match guard rejects when `booking.memberId !== authUser.uid` (the real authorization)
- [x] **Router wiring (`guest-app/server/apiRouter.ts`)** — New route case: `if (domain === "members" && action === "redeem-points-self" && req.method === "POST") return await handleRedeemPointsSelf(req, res);` sits AFTER the existing `redeem-points` route. The existing `redeem-points` route still requires staff auth (`authenticateStaff`) and still calls `handleRedeemMemberPoints` — unchanged behavior.
- [x] **BookingPage Step 3 control (`guest-app/src/pages/BookingPage.tsx`)** — New "Apply Your Points" section, sibling to the existing "Voucher or Promo Code" section. Only renders when: `rewardsConfig?.allowMemberPointsRedemption === true` AND `memberAvailablePoints > 0`. UI:
   - Section header + balance line ("You have N points available. Each 100 points = ₱X off your booking total.")
   - Number input (min 1, max balance)
   - Inline preview: "₱X off · new total ₱Y" (or "below the N-point minimum" when below the configured floor)
   - "Apply Points" button → `POST /api/members/redeem-points-self` with `Authorization: Bearer {idToken}` from `auth.currentUser.getIdToken(true)` (force-refresh so a freshly-revoked session can't accidentally succeed)
   - On success: locks the section to a green "Points applied to this booking" success card with a disabled "Applied" button (one-per-booking enforcement at the UI level — the server's guard is authoritative)
   - On error: red error pill with the server's message (e.g. "below the N-point minimum", "exceeds the N% bill cap", "Booking is not linked to this member")
- [x] **Auth model** — `getAuth()` from `firebase/auth` is the source of the ID token (NOT `memberProfile`, which is the data shape — no `getIdToken` method). The booking flow client already imports `firebase/auth` types elsewhere, so the import is consistent. The token is force-refreshed (`getIdToken(true)`) to invalidate any cached session that may have been revoked server-side.
- [x] **Tests** — `guest-app/tests/api/spark-rewards-tier-system-self-redeem.test.ts` (NEW, 34 source-text pins across 6 describe blocks). Pins: 4 schema/type/seed pins (Zod optional boolean + shared types + utils interface + seed default OFF), 5 helper extraction pins (function signature + audit-trail fields + 9-guard source order + audit marker + staff handler delegation), 7 self-handler pins (export + method gate + adminAuth verification + self schema + toggle fail-fast + self-appliedBy marker + router wiring), 9 BookingPage UI pins (getAuth import + state shape + toggle gating + section render + POST endpoint + Bearer token + body shape + button disable + preview + min-redeem warning + locked-after-apply), 4 Settings UI pins (state + hydration + save payload + operator copy), 3 backward-compat pins (seed default + unchanged staff route + preserved `memberId` field on staff schema + absent `memberId` field on self schema). All 34 pass; 155/155 pass across all 9 tier-system suites (Phases 1 + 3 + 4 + 5 + 6 + 7 + 8 + admin UI + PR #9).
- [x] **MD sync** — `plan/features/SPARK-REWARDS.md` (this section + rollout sequence update). `plan/docs/BACKEND.md` (rewardsConfig field table extended with the `allowMemberPointsRedemption` row). `plan/docs/API-ROUTES.md` (new endpoint row for `/api/members/redeem-points-self`).
- [x] **Hard Rule #1 honored** — All writes are server-side via `adminDb.runTransaction` in the existing handler (no new Vercel functions). The new endpoint goes through the existing Vercel catch-all router at `guest-app/api/[...route].js` (rebuilt via `esbuild` as part of this PR). No Firebase Cloud Functions. The member-self path uses Firebase ID token verification (`adminAuth.verifyIdToken`) — same auth primitive the rest of the system uses for guest-side writes.
- [x] **Backward compat** — The toggle defaults OFF (`false`), so existing deployments that never set the field continue to behave exactly as before — no `rewardsConfig.allowMemberPointsRedemption` field on the doc, the BookingPage doesn't show the section, the new endpoint returns 403. The pre-PR-9 staff path (`POST /api/members/redeem-points` with `authenticateStaff` + `handleRedeemMemberPoints`) is preserved unchanged: same route, same auth gate, same schema, same response shape. The helper extraction is internal — the staff handler's signature + the `redeemPointsSchema` are byte-equivalent to before. Pre-PR-9 `members/{uid}` docs continue to parse through the snapshot listener (the new toggle field is on `settings/rewardsConfig`, not on the member doc).
- [x] **Race-condition note** — The server's `booking.pointsRedeemed > 0` check inside the helper is the authoritative one-per-booking enforcement. If a member + an admin try to apply simultaneously, Firestore's transaction retry resolves it cleanly (one wins, the other gets "This booking already has a points redemption."). The UI's `selfPointsApplied` lock is a UX nicety, not a security boundary.

---

## Phase 12 — Early Check-In Approval Workflow

> Closes the loop on the Phase 1 early check-in perk. The request ends at a staff notification email and persists onto the booking document, and staff can approve/decline the request in the booking drawer.
> Roadmap entry: `plan/project/ROADMAP.md §Phase 12`.

### Data model

- [x] New optional `earlyCheckIn` map on the `Booking` document (add to `plan/docs/TYPES.md` and `shared/types/index.ts` when building):
  - `source` — optional `guest-request` or `staff-granted` discriminator; absent legacy values are treated as guest requests
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
- [x] Reject the request if booking status is not in the **3-status allowlist** `[payment-uploaded, payment-confirmed, confirmed]` (e.g. `pending`, `cancelled`, `checked-in`, `checked-out`) or if check-in date has passed
  - Per `fix/early-checkin-payment-uploaded-allowlist` (2026-08-21): the original gate was `status === "confirmed"` only, which rejected every `payment-uploaded` booking with a 400 even though the guest had paid and was definitely coming. The expanded allowlist covers the three states where the booking is real and upcoming: `payment-uploaded` (the common case for online payments — guest paid, awaiting staff verification), `payment-confirmed` (staff verified, not yet transitioned), `confirmed` (the existing case). All other statuses still reject with a clear 400.
  - The matching **client gate** in `BookingConfirmPage.tsx` (`showEarlyCheckInButton`) hides the button when the booking isn't in the allowlist, so a guest never sees a button that secretly 400s. The two sides are kept in sync via the shared array constant shape.
- [x] Staff notification email unchanged (existing `earlyCheckinRequestEmail` template)

### Admin — booking drawer

- [x] "Early check-in" panel in the booking detail drawer, shown only when `booking.earlyCheckIn` exists — requested time, guest notes, requested-at, current status badge
- [x] Approve / Decline actions (front desk + admin roles) — Approve captures optional confirmed time + staff note; Decline captures optional reason (stored in `staffNote`)
- [x] Resolution goes through an authenticated staff action in the existing API catch-all (no new Vercel function — see `plan/docs/VERCEL-FUNCTION-LIMIT.md`), which updates the booking and fires the guest email server-side with a server-controlled recipient (`booking.guestEmail`)
- [x] Early check-in badge on the booking row / arrivals list for `approved` bookings so front desk sees it on the check-in day
- [x] Admins can grant early check-in directly when no request exists on an upcoming `payment-confirmed` or `confirmed` booking. The drawer captures the confirmed time and optional guest-facing staff note, calls the existing resolve route in grant mode, updates the drawer optimistically, and emails the guest. The server re-checks the admin role, booking status/date, and absence of an existing request inside the transaction. Front Desk sees an admin grant read-only; admins can later change its time or remove it through the existing resolution controls.

### Guest visibility

- [x] Guest confirmation email on resolve — approved (with confirmed time + staff note) or declined (with reason if given); new template in the email handler, staff-triggered only
- [x] My Stays + My Rewards show the request status on the relevant booking — "Early check-in requested" / "Early check-in approved — from {time}" / "Early check-in unavailable"; `GET /api/members/stays` includes the `earlyCheckIn` map in its guest-safe booking subset
- [x] Rewards portal "Request Early Check-In" modal reflects an existing request instead of allowing a duplicate submission (per the one-request-per-booking rule above)

### Edge cases

- [x] Booking cancelled after request — no special handling; the drawer panel disappears with the cancelled booking flow, no email fired
- [x] Check-in day arrives with status still `requested` — no auto-resolution; guest UI shows "Not yet confirmed — please ask the front desk on arrival"
- [x] Never log PII in the request/resolve handlers (per Hard Rules)
- [x] Existing rate limit on the email endpoint continues to cover request submission

### Phase 12 addendum — persistent admin alerts + dashboard widget (decision EC-01, 2026-08-21, `feature/early-checkin-admin-alerts`)

> Closes the operator-reported gap: the email-only delivery meant the request was easy to miss when the desk was busy or the tab was backgrounded. Now staff see the request as soon as it lands — in the bell badge on every page + a dedicated dashboard widget with one-click Approve / Decline.

- [x] Server: `/api/email?action=early-checkin-request` additionally writes a `notifications` doc (`type: "early-checkin-request"`, `entityType: "booking"`, `entityId: booking.id`) **awaited** in-line (per NC-01 post-ship review — not `void`-ed). Title is PII-safe: `Early check-in requested — ${bookingRef}` only. Existing `sendEarlyCheckinRequestTrigger` email is unchanged and remains the primary delivery channel.
- [x] Shared: `NotificationType` union extended with `"early-checkin-request"`. `NotificationBell` `NOTIFICATION_TYPE_META` gains the entry — `CalendarClock` icon, `bg-amber-50` palette. Bell deep-link routes to `/dashboard?focus=early-checkin&bookingId=…` (consumed once + stripped from URL bar so reload doesn't re-trigger).
- [x] Admin: new "Early check-in requests" card on `DashboardPage.tsx`, sibling to the pending-payments card. One row per `earlyCheckIn.status === "requested"` booking; hidden when no requests are pending. **Approve** + **Decline** per row; Decline uses shared `ConfirmForm` with required reason. Reuses existing `/api/bookings/early-checkin-resolve` — **no new Vercel function**.
- [x] Sound: distinct synthesized waveform in `AdminContext.playSynthNotification` — two short ascending triangle tones (523.25 / 698.46 Hz, 180 ms apart). Respects existing mute (`soundsEnabled` / per-staff `localStorage`, Decision #97).
- [x] Tests: `admin-app/src/__tests__/dashboard-early-checkin.test.ts` adds 10 source-text pins (shared type extension, awaited server write, bell entry + deep-link routing, dashboard derivation + `resolveEarlyCheckin` wiring + Approve/Decline buttons + `ConfirmForm` usage, regression sanity). `tsc -p admin-app` + `tsc -p api` both clean. `admin-app` 1581/1581 + `shared` 569/569 green; pre-existing `test-runs-staging-refresh` + `audit-guest-sev2-2026-07-07` failures present on `dev` HEAD before this PR.
- [x] MD sync: `plan/docs/DECISIONS-FEATURES.md` entry `EC-01`.

### Phase 12 addendum §2 — booking-flow entry point + admin disable toggle (decision EC-02, 2026-08-21, `feature/early-checkin-booking-flow-toggle`)

> Operator-requested 2026-08-21: the perk is now exposed on Step 4 of the booking flow with a strong disclaimer, AND globally togglable from the admin Settings → Rewards tab.

- [x] Server (defense-in-depth, Hard Rule #1): `/api/email?action=early-checkin-request` reads `settings/rewardsConfig.earlyCheckInEnabled` on every request and returns 403 if false. Gate runs BEFORE the booking write so a disabled toggle never lands a doc. Failure to read the config defaults to true (logged + perk proceeds) — same pattern as `bookings.ts:2582-2586`.
- [x] Staff email copy: `earlyCheckinRequestEmail` intro names the approval loop — "requires your approval. The guest will receive an email once you approve or decline." Same recipient, same template shape.
- [x] Guest booking confirmation (Step 4): new "Request early check-in" section on `BookingConfirmPage.tsx`, rendered only when `isRewardsMember && earlyCheckInEnabled && bookingStatusAllowsEarlyCheckIn` (the status allowlist `[payment-uploaded, payment-confirmed, confirmed]` mirrors the server gate in `guest-app/server/handlers/email.ts` so the button only appears when the click would succeed — see `fix/early-checkin-payment-uploaded-allowlist` 2026-08-21). The section sits immediately below the reservation reference and above Reservation Details so eligible members see the time-sensitive perk without scrolling past the full stay summary. Disclaimer copy next to the button ("**not guaranteed** — subject to approval by our team, and you'll receive an email once we approve or decline") + repeats inside the modal. Single-booking flow (URL params carry the bookingRef) — submission uses the existing `/api/email` path, no new server route.
- [x] Modal close on success (per `fix/early-checkin-modal-success-state` 2026-08-21, persistence correction 2026-08-22): after a successful submit the modal swaps the form for an inline success panel — a `CheckCircle2` glyph, "Request sent" copy, and a single Done button that closes the modal. The X close button at the top of the modal header continues to work in both states. Closing clears transient notes and errors but preserves `earlyCheckInSent` for the lifetime of the confirmation page, so the elevated section continues to show “Request sent” and cannot offer an accidental duplicate submission.
- [x] RewardsPage: existing button (line 306) gated on `rewardsConfig.earlyCheckInEnabled !== false` so the disable is consistent across both surfaces.
- [x] Admin Settings → Rewards tab: new "Allow Spark Rewards Early Check-In Requests" toggle alongside the existing points + member-discount toggles. Same 6×11 round switch UI, sub-text explains the side-effect ("When off, the button disappears from the booking confirmation page and the server rejects new requests with 403. Pending + historical requests on existing bookings stay visible until resolved."). Flag rides on the same `updateSettings("rewardsConfig", {...})` save — one save persists the whole tab.
- [x] Shared: `RewardsConfigLike` extended with `earlyCheckInEnabled?: boolean` (defaults to true when absent — non-breaking for pre-EC-02 deployments).
- [x] Tests: `admin-app/src/__tests__/early-checkin-booking-flow-toggle.test.ts` (NEW, 11 source-text pins). Existing `dashboard-early-checkin.test.ts` (EC-01) extended its slice anchor to cover the new gate block.
- [x] `tsc -p admin-app` + `tsc -p api` + `guest-app` typecheck all clean. admin-app 1598/1598 + shared 569/569. No new Vercel function (reuses `/api/bookings/early-checkin-resolve`). Husky `check:api-bundle` verified + version bump to 0.288.0.
- [x] MD sync: `plan/docs/DECISIONS-FEATURES.md` entry `EC-02`.

### Out of scope

- The dormant `isEarlyCheckInRequest` intercom-message flag stays dormant — intercom delivery remains deferred per `plan/features/INTERCOM-INBOX.md §Preserve early check-in request metadata`. This workflow is email + booking-document only.
- Browser push / Web Notifications API (system-level toasts when the tab is closed) — needs Firebase Cloud Messaging, out of stack per `NOTIFICATION-CENTER.md §Out of scope`.

### Manual QA (when built)

- [x] Member requests early check-in → `earlyCheckIn` map appears on the booking, staff email received
- [x] Approve from drawer → guest email received, My Stays shows approved state with time
- [x] Decline from drawer → guest email received, portal allows re-request
- [x] Non-member token / tokenless request → rejected
- [x] Request against a cancelled or past booking → rejected

---

## Edge Cases & States

- [x] **Guest books anonymously then registers with same email** — on registration, query `bookings` where `guestEmail == member.email`, update all matching bookings with `memberId`; all previous stays immediately appear in My Stays
- [x] **Front-desk manual link (Spark Rewards audit 2026-07-18 MED-3, build variant)** — **Shipped 2026-07-29** (decision #135 build variant, branch `fix/spark-rewards-med-3-link-booking`). New server endpoint `POST /api/members/link-booking` (`handleLinkBookingToMember` in `guest-app/server/handlers/members.ts`) — admin-only (front-desk 403), Zod-validated `{ memberUid, bookingId, reason (1..500) }`, 10/min/IP rate limit (mirrors `manual-adjust` + `set-active`). Server transaction re-reads the member + the booking, refuses cancelled bookings (400), test-run bookings (400), and bookings already linked to a different member (409 — no silent overwrite, no unlink from this surface), then sets `memberId` + `linkedByStaff` + `linkedAt` + `linkedReason` on the booking and writes an audit row under `bookings/audit/records/{bookingId}-link-{timestamp}` (mirrors the erasure audit shape from decision #49). Re-linking a booking to the same member is idempotent (no booking update, audit row still written — `alreadyLinked: true` in the response). The admin member drawer (`admin-app/src/pages/MembersPage.tsx`) gains a **Link Existing Booking** form below the points adjustment form, with the member's email surfaced in the helper copy so the staff can confirm the different-email context before linking. Toasts: success on a fresh link, info on a re-link (alreadyLinked). **Tests** — 14 server tests in `guest-app/tests/api/members-link-booking.test.ts` (auth + method + schema + lookup + booking-state + idempotency + audit row + Admin SDK posture) + 18 source-text tests in `admin-app/src/__tests__/med-3-link-booking.test.ts` pinning the route wiring, the handler contract, the AdminContext function, and the drawer form. 930/930 admin + 544/544 guest tests green, typecheck clean. The guest self-service prompt in the next entry remains the unbuilt half of MED-3.

  > **MED-3 build-variant G1 (lookup-by-ref) shipped 2026-08-20 on `fix/med-3-lookup-by-ref`.** G2 (MRB-aware sibling write) also shipped 2026-08-20 on `fix/med-3-sibling-fanout-and-backfill`. The MED-3 ship predates MRB-01 (decision #159, 2026-08-02), so it did not anticipate the reservation-scope booking model or the staff typing patterns that surface in production. The G1 follow-up extended the handler's resolver at `guest-app/server/handlers/members.ts` to accept all three input shapes the staff actually paste — `SPK-YYYYMMDD-NNNNN` (the human `bookingRef`), `R-YYYYMMDD-NNNNN` (the human `reservationRef`, post-MRB-01), and the raw Firestore doc id (legacy pre-MRB-01 + post-MRB-01 child doc ids). New `resolveBookingForLink(input)` helper (async, non-transactional single-shot `get()` / `where().limit(1)`) routes by `RESERVATION_REF_REGEX` / `BOOKING_REF_REGEX` (both from `@spark-inn/shared/references`). The not-found catch was tightened to 404 with structured `code: "BOOKING_NOT_FOUND"` / `code: "RESERVATION_NOT_FOUND"` on the JSON response so the toast can branch on code, not prose (per the `silent-rate-limit-fallback` skill's AFTER pattern). G1 also includes the `reservationId` / `reservationRef` cluster on the audit row + the response payload. The form placeholder at `admin-app/src/pages/MembersPage.tsx:442` was updated to surface all three input shapes. **The G2 follow-up** (sibling fan-out) made the `handleLinkBookingToMember` transaction query `bookings.where("reservationId", "==", X)` and stamp `memberId` on every sibling of an N>1 reservation — not just the resolved booking. Pre-G2, the member's My Stays list only showed the lead child of N>1 reservations (the read-side counterpart at `handleListMemberStays` `members.ts:192` queries `bookings.where("memberId", "==", uid)` on the flat `bookings` collection with no reservation expansion). The conflict guard was extended to every sibling (any sibling linked to a different member → 409). The audit row + the response payload now carry `linkedBookingIds` (the fan-out set) so a future auditor can disambiguate "linked the lead" from "linked the whole reservation". A new `scripts/backfill-link-siblings.ts` (one-shot, `--output=` for report + `--apply= --confirm=APPLY_APPROVED_MED3_BACKFILLS` for apply, gated on `NODE_ENV !== "production"` first-pass review) cleans up the pre-existing orphans. **MED-3 build-variant follow-ups — both G1 + G2 shipped 2026-08-20.**
- [ ] **Deferred (Spark Rewards audit 2026-07-18 MED-3, guest self-service half)** — Google account email differs from booking email; post-sign-in prompt: "We found bookings under a different email. Would you like to link them?" with the booking email pre-filled. No such prompt exists in `guest-app/src` (the `RewardsLandingPage`, `ProfilePage`, and post-booking confirmation page are the only Spark Rewards join surfaces, and none of them offer a different-email reconciliation flow). The build variant above (front-desk manual link) closes the half the audit kept as the smaller build path; the guest self-service prompt is the larger surface and is still deferred. **Workaround** — guest can still find the booking at `/my-booking` (ref + email); staff can now also link it from the member detail drawer (no more booking-drawer `memberId`-edit dance for the common case). See decision #135.
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

- ✅ **9 of 10 findings closed 2026-07-25 → 2026-07-29** (HIGH email-verified gate; MED different-email reconciliation build variant; MED server-side manual points adjustment; LOW-1/2/4/5/6/7) — verbatim closure narratives in [`plan/project/archive/SPARK-REWARDS-ARCHIVE-2026-08-02.md`](../project/archive/SPARK-REWARDS-ARCHIVE-2026-08-02.md). The guest self-service "link bookings under a different email" prompt remains the unbuilt half of MED-3 and is tracked in `plan/project/ROADMAP.md`.
- ⏸ **LOW-3 — `linkBookingsByEmail` batch not chunked to Firestore's 500-write limit** — **Deferred 2026-07-25** (decision #136). Theoretical only — a member whose email matches >500 bookings is the only failure mode and is not realistic for a single-hotel guest. Re-mark as `Deferred` rather than building the chunking logic; revisit if a future client scales beyond 500 same-email bookings. No code change.

## References

- Guest auth vs admin auth: `plan/features/AUTH-ROLES.md`
- Booking linkage: `plan/docs/BACKEND.md §members`
- Post-booking prompt: `plan/features/BOOKING-FLOW.md §Step 4`
- Rewards signup page: `plan/features/STATIC-PAGES.md §Spark Rewards`
- RA 10173 erasure rights: `plan/docs/SECURITY.md §Data Subject Rights`
- Member types: `plan/docs/TYPES.md §Member`

---

## Earn + Clawback Pairing (MRB-15-07)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-07 sub-item, shipped v0.254.0). The `pointsHistory` ledger uses paired doc ids: `earn-${bookingId}` for the positive earn entry (written on check-out) and `clawback-${bookingId}` for the negative clawback entry (written on cancel). The pairing is the deterministic link between an earn and its subsequent clawback.

### Pairing contract (the "exactly-once" guarantees)

- `earn-${bookingId}` is written **exactly once** per booking on a successful check-out. There are **2 constructions** of this id in the codebase: the check-out's `awardNow` flag (the standard path) and the post-settlement path (the deferred award, used when the check-out runs without a confirmed payment). A re-check-out of the same booking is forbidden by the status matrix (`status === "checked-out"` is terminal), so a second `earn-${bookingId}` write is impossible.
- `clawback-${bookingId}` is written **exactly once** per cancelled booking. There is **1 construction** of this id in the codebase: `handleCancelBooking`'s per-child CRL-02 + MRB-05 audit stamp block. A re-cancel of the same booking is forbidden by the status matrix (`status === "cancelled"` is terminal).
- The `pointsHistory.points` map-based invariant `rewardsPoints == sum(pointsHistory.points)` is preserved end-to-end: an `earn-${bookingId}` entry of `+100` is balanced by a `clawback-${bookingId}` entry of `-100` if a check-out is followed by a cancel.

### Why the pairing matters

The pairing is the source-text guard for the cross-cutting "no duplicate earn" + "no duplicate clawback" + "balanced ledger" invariants MRB-15-01 pins. A future refactor that adds a second `earn-${bookingId}` write (e.g. on a "reissue loyalty points" feature) would silently break the invariant and double-credit the member. The MRB-15-07 audit pins the exact count of constructions so the test fails on a new construction.

### Test coverage

`guest-app/tests/api/mrb-15-07-checkout-loyalty-earn.test.ts` (13 tests) — pins the earn/clawback pairing + the construction count. `mrb-15-01-lifecycle-invariants.test.ts` (14 tests) — pins the no-duplicate-earn + no-duplicate-clawback invariants across the full lifecycle.
