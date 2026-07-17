# Spark Rewards — Feature Audit Report

> Living document. Updated after each audited section. Scope: Spark Rewards loyalty (auth, registration, points economy, Phase 12 early check-in, admin member management). A points balance behaves like money — balance/history mismatches are treated as CRITICAL.
> Started 2026-07-18. Auditor: Claude (staybase repo).

---

## Executive Summary & Verdict

| Section | Status | Highest severity |
|---|---|---|
| 1. Auth & registration | ✅ Audited | LOW |
| 2. Points economy | ✅ Audited | MEDIUM |
| 3. Early check-in (Phase 12) | ✅ Audited | HIGH (HIGH-1 also affects §1 surfaces) |
| 4. Admin member management | ⏳ Pending | — |
| 5. Edge cases & RA 10173 | ⏳ Pending | — |

**Feature go/no-go:** _Deferred until all 5 sections complete._

---

## Findings

Severity order within each section: CRITICAL → HIGH → MEDIUM → LOW. Each finding: section · `file:line` · issue · fix · effort · confidence.

### Section 1 — Auth & Registration

No CRITICAL or HIGH findings *within this section's original scope* — but see **HIGH-1** (reported under Section 3), which also affects this section's booking-linkage and stays-listing surfaces. Registration correctly generates `memberNumber` server-side inside a Firestore transaction, verifies the Firebase ID token, links past bookings by normalized email, and guards all `/account/*` routes. Guest client cannot create member docs directly (Firestore rule `allow create: if false`).

**LOW-1 · Enrollment consent disclosure inconsistent across join surfaces**
- `guest-app/src/pages/RewardsLandingPage.tsx:137-153` (one-click "Enroll") vs `guest-app/src/pages/SignUpPage.tsx:281-296` (consent checkbox) vs `guest-app/src/pages/ProfilePage.tsx:187-193` (linked Privacy Policy disclosure adjacent to Join button).
- Issue: `SPARK-REWARDS.md` line 43 states enrollment "requires an explicit join action with Privacy Policy / Terms consent." `/signup` enforces a consent checkbox and `ProfilePage` shows an adjacent Privacy Policy link, but the Rewards landing one-click "Enroll in {rewardsName} (One-Click)" button fires `registerCurrentMember()` with no adjacent consent/disclosure text. The click is an explicit action and the policy is reachable via footer, so this is a consistency/compliance-hardening gap, not a functional defect.
- Fix: add a Privacy Policy / Terms disclosure line beneath the Rewards landing enroll button (mirror ProfilePage), or a lightweight consent gate.
- Effort: <30 min · Confidence: HIGH (code verified); severity judgment MED→LOW.

**LOW-2 · Guest-app auth persistence relies on Firebase default, not set explicitly**
- `guest-app/src/firebase/config.ts:16` — `getAuth(firebaseApp)` with no `setPersistence` call. Admin app sets `browserSessionPersistence` explicitly (`admin-app/src/context/AdminContext.tsx:636,699`).
- Issue: `SECURITY.md §Session Management` specifies `browserLocalPersistence` for the guest app. Firebase Web SDK already defaults to local (IndexedDB) persistence, so behavior is currently correct — but it is implicit and undocumented in code, so a future refactor or SDK default change could silently regress "stay signed in."
- Fix: call `setPersistence(auth, browserLocalPersistence)` explicitly in guest-app config to match the documented intent.
- Effort: <30 min · Confidence: HIGH.

**LOW-3 · `linkBookingsByEmail` batch not chunked to Firestore's 500-write limit**
- `guest-app/server/handlers/members.ts:52-91` — a single `adminDb.batch()` accumulates one update per matching booking plus the explicit booking.
- Issue: a member whose email matches >500 bookings would exceed the Firestore batched-write limit and the commit would throw, failing registration. Not realistic for a single hotel guest; theoretical only.
- Fix: chunk into ≤500-write batches if this ever becomes plausible; low priority.
- Effort: <30 min · Confidence: HIGH (limit is documented Firestore behavior).

**Unverifiable statically (noted, not a finding):**
- Phase-1 provider-conflict behavior (`auth/account-exists-with-different-credential` on both Google-first→email and email-first→Google) depends on the Firebase Console "one account per email address" setting (account-linking disabled). The client code handles both error codes correctly (`SignInPage.tsx:13-16`, `SignUpPage.tsx:14-22` handling both `account-exists-with-different-credential` and `email-already-in-use`), but the console setting cannot be confirmed from the repo.

---

### Section 2 — Points Economy

No CRITICAL or HIGH findings. All five points-mutation paths were traced end-to-end (component → API/context → Firestore transaction). Every path that changes `rewardsPoints` in the shipped code writes a matching `pointsHistory` entry inside the same transaction, so balance and history stay reconciled. Earning is correctly computed from net `totalPrice` (room/breakfast) and excludes incidentals + store, credits only on folio settlement, and awards exactly once via deterministic history IDs.

**MED-1 · Manual points adjustment is a client-side write, forcing rules to permit out-of-band `rewardsPoints` changes**
- `admin-app/src/context/AdminContext.tsx:2113-2142` (client `runTransaction`) + `firebase/firestore.rules:141-147` (`members` update `allow ... if isStaff()`, no field restriction).
- Issue: manual adjustment is the *only* points mutation still performed with the client Firestore SDK (earn/redeem/undo/set-active all run server-side via API routes). Because a client transaction must be allowed by rules, the `members` update rule grants any `isStaff()` caller (front-desk **or** admin) the ability to write `rewardsPoints` directly. Firestore rules cannot require that a `rewardsPoints` write be coupled with a `pointsHistory` subcollection write, so the "balance always equals sum(history)" invariant is enforced **only in app code**, not at the security-rule boundary. A direct client write (browser console, a future/buggy code path, or a rogue staff credential) could set `rewardsPoints` with no history entry → balance diverges from history. Mitigating factors: it requires an authenticated staff credential, and because `pointsHistory` is append-only (`allow update, delete: if false`), any such divergence is *detectable* by a reconciliation check (balance > sum(history)). Severity MED (insider / defense-in-depth integrity gap, not an active app-path divergence).
- Fix: move manual adjustment to a server API route (mirror `redeem-points` / `undo-redemption` / `set-active`), then tighten the `members` update rule so staff clients cannot write `rewardsPoints` (and other financial fields) directly — server/Admin SDK only. Then all balance mutations are provably history-coupled.
- Effort: 1–2 h · Confidence: HIGH.

**LOW-4 · Divergent, dead earning formula in `shared/utils/points.ts`**
- `shared/utils/points.ts:8-14` (`calculateEarnedPoints`) vs `guest-app/server/handlers/bookings.ts:57-64` (`calculateCheckoutPoints`, the authoritative live path).
- Issue: the shared `calculateEarnedPoints` per-spend formula `Math.floor(totalPrice/100) * pointsPerHundred` differs from the live checkout formula `Math.floor((totalPrice/100) * pointsPerHundred)`. Example: ₱150 at 10 pts/₱100 → shared helper yields 10, live path yields 15. The shared helper is currently unused at runtime (referenced only by `shared/__tests__/points.test.ts`), so there is no active mismatch — but it is a trap: wiring it into a guest-facing "you'll earn X" estimate would under-report vs actual credit. Separately, the My Rewards copy "Earn N points per ₱100 spent" (`guest-app/src/pages/RewardsPage.tsx:250`) understates the actual proportional (fractional-₱100) crediting.
- Fix: delete `calculateEarnedPoints` or make it delegate to a single shared formula that `calculateCheckoutPoints` also uses; align the earning copy with proportional crediting.
- Effort: <30 min · Confidence: HIGH.

**Reconciliation spot-checks (all balance = sum(history)):**
- earn(+N) → redeem(−R) → manual(+M) → undo(+R): balance `N−R+M+R = N+M`; history sum `N−R+M+R = N+M`. ✓
- checkout with unpaid balance → `pendingLoyaltyPoints=N`, no credit, no history → later payment settles folio → earn(+N) via deterministic `earn-{bookingId}`. ✓ (no double-credit: checkout `awardNow` and settlement are mutually exclusive on `loyaltyAwardStatus`, and share the same deterministic history ID)
- double-redeem attempt: second call blocked by `pointsRedeemed > 0` guard re-read inside the transaction. ✓

### Section 3 — Early Check-In Workflow (Phase 12)

The Phase 12 mechanics are correctly built to spec. Auth **was** tightened as documented: `/api/email/early-checkin-request` rejects a tokenless request with 401 and requires a verified Firebase ID token (staff **or** member) before the booking write (`apiRouter.ts:1107-1117`), so `findBooking`'s legacy tokenless `bookingId`+`guestEmail` branch is unreachable for this action. Status/date guards, the one-request-per-booking state machine, the staff-only transactional resolve through the existing catch-all (no new Vercel function), and the server-controlled email recipients are all present and correct. One HIGH cross-cutting identity-match issue surfaced while tracing the request path, plus one LOW spec gap.

**HIGH-1 · Booking identity match trusts an unverified `email` token claim (cross-cutting: §1 registration + stays, §3 early check-in)**
- `guest-app/server/apiRouter.ts:184-213` (`authenticateUser` returns `email` but never `email_verified`); consumers: `guest-app/server/handlers/members.ts:52-91` (`linkBookingsByEmail`), `members.ts:143-183` (`handleListMemberStays`, email match at :157), `guest-app/server/handlers/email.ts:434-438` (`findBooking` member email match).
- Issue: every member-scoped booking match keys off the token's `email` claim with no `email_verified` check. Firebase email/password signup (`createUserWithEmailAndPassword`) lets a user register an **arbitrary, unverified** email they do not control — the resulting ID token still carries that `email`. An attacker who registers with a victim's email (any victim who booked **anonymously** and never created a Firebase account — the common hotel case) can then:
  1. **Link the victim's past bookings** to their own member account on registration (`linkBookingsByEmail`), and
  2. **Read those bookings via `GET /api/members/stays`** — the "guest-safe" projection (`members.ts:112-129`) includes `bookingRef` **and `lookupToken`**, and `{bookingRef, token}` is exactly the credential the public lookup/cancel endpoints accept (`bookings.ts:2022-2027`) → attacker can **cancel a stranger's booking**, and
  3. **Fire early check-in writes/emails** against the victim's booking (`findBooking` email branch).
  The `memberId`-based match is safe; only the email-based match is exploitable. Payment-proof / ID URLs are not exposed, so this is PII + booking-control disclosure, not card data or full account takeover.
- Fix: thread `email_verified` out of the decoded token in `authenticateUser`, and require `email_verified === true` before using the `email` claim for any booking link/match (registration linkage, `handleListMemberStays`, `findBooking`). Google sign-in tokens are always verified; email/password should send a verification email at signup and gate email-based linkage on it. Minimum viable fix: gate all three email-match sites on `token.email_verified`.
- Effort: 2–4 h · Confidence: HIGH (Firebase unverified-email behavior + all three match sites confirmed in code).

**LOW-5 · My Stays page does not surface early check-in status**
- `guest-app/src/pages/StaysPage.tsx` (no `earlyCheckIn` rendering) vs `SPARK-REWARDS.md:205` ("My Stays + My Rewards show the request status on the relevant booking").
- Issue: `GET /api/members/stays` returns the `earlyCheckIn` map (`members.ts:127`) and My Rewards renders full request state (`RewardsPage.tsx:351-388`), but the My Stays page renders none of it. Spec lists both surfaces; only My Rewards is implemented. Informational only — the guest still sees status on My Rewards and in the resolve email.
- Fix: render an early check-in status line per booking on StaysPage mirroring RewardsPage, or amend the spec to name My Rewards as the sole surface.
- Effort: <30 min · Confidence: HIGH.

**Verified correct (Section 3):**
- Tokenless write path removed: router requires `authenticateStaff` or `authenticateUser` success for `early-checkin-request`; tokenless → 401 (`apiRouter.ts:1107-1117`).
- Status/date guards: rejects when `status !== "confirmed"`, when check-in date has passed (Manila tz), and when already `approved` (`email.ts:1212-1234`).
- State machine: absent map = no request; re-submit while `requested` or after `declined` overwrites and re-notifies; `approved` is terminal for the guest (modal hides the form, `RewardsPage.tsx:390`).
- Resolve is staff-only (`authenticateStaff`, front-desk + admin) through the existing catch-all `bookings/early-checkin-resolve` — no new function (`guest-app/api/` holds only `[...route].js` + `tsconfig.json`), consistent with `VERCEL-FUNCTION-LIMIT.md`. Resolve runs in a transaction and emails a **server-controlled** recipient (`booking.guestEmail` from the doc, `bookings.ts:3378` → `email.ts:791`).
- Admin badge on the booking row for `requested`/`approved` (`BookingsPage.tsx:838,850`); drawer panel gated to existing `earlyCheckIn` + confirmed/checked-in (`:3780`).
- No PII logged in the request/resolve handlers; `resolvedBy` stores staff name/email, never guest PII.

**Minor note (not a finding):** `handleResolveEarlyCheckin` only checks that an `earlyCheckIn` map exists, not that its status is still `requested`, and does not re-check booking status server-side (the drawer gates that). A staff caller could re-resolve or resolve on a since-cancelled booking via direct API, firing a guest email. Staff-only and low-impact; note for hardening.

## Quick Wins (<30 min)

- LOW-1: add Privacy/Terms disclosure under the Rewards landing one-click enroll button.
- LOW-2: set `browserLocalPersistence` explicitly in guest-app firebase config.
- LOW-4: delete/consolidate the divergent `calculateEarnedPoints` shared helper.
- LOW-5: render early check-in status on the My Stays page.

---

## Verified Correct (Section 1)

- `memberNumber` generation: server-side, sequential via `counters/memberNumbers`, zero-padded 5 digits (`shared/utils/references.ts:25-27` `generateMemberNumber`), all inside the registration transaction (`members.ts:211-253`). Re-registration is idempotent — an existing `memberNumber` is preserved, never re-minted (`members.ts:215-223`).
- Token verification: `/api/members/register` runs through `authenticateUser` → `adminAuth.verifyIdToken` (`apiRouter.ts:184-213, 854-863`); guest client cannot write `members/{uid}` directly (`firestore.rules:140` `allow create: if false`).
- Booking linkage by email: bookings persist `guestEmail` lowercased (`bookings.ts:1028,1565`), and registration lowercases the token email before querying (`members.ts:206,255`) — case-consistent match. Explicit just-completed `bookingId` is also linked with an email-or-already-linked guard (`members.ts:72-84`).
- `onAuthStateChanged` and the member-profile `onSnapshot` both return their unsubscribe from `useEffect` cleanup (`GuestAuthContext.tsx:77-83, 86-116`).
- Provider-conflict handling present on both sign-in and sign-up surfaces (`SignInPage.tsx:13-16,74`; `SignUpPage.tsx:14-22,72-73,89-99`).
- `/account/*` guard: `AccountLayout` shows a loading state, redirects to `/signin` when unauthenticated, and to `/contact?member=disabled` when `isActive === false`; all three account pages use it (`AccountLayout.tsx:20-37`; ProfilePage/StaysPage/RewardsPage).
- Guest auth context is isolated from admin auth (separate apps, separate `firebase/config.ts`, separate context providers).

---

## Docs Updated

- Section 1: `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md` (this file, created). No CRITICAL/HIGH findings → no `SPARK-REWARDS.md §Known Issues`, `GOTCHAS.md`, or `ROADMAP.md` additions required for this section.
- Section 2: `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md` (this file, updated). `plan/docs/GOTCHAS.md` — appended a "never do" rule under §Security & PII capturing the MED-1 balance-integrity boundary (client-side `rewardsPoints` writes). No CRITICAL/HIGH → no `SPARK-REWARDS.md §Known Issues` or `ROADMAP.md` additions required.
- Section 3: `plan/docs/AUDIT-SPARK-REWARDS-REPORT.md` (this file, updated). HIGH-1 → added `plan/features/SPARK-REWARDS.md §Known Issues (Audit 2026-07-18)`, a "never do" rule in `plan/docs/GOTCHAS.md §Auth & Security` (verify `email_verified` before email-based booking matches), and a HIGH item under a new dated section in `plan/project/ROADMAP.md`.
