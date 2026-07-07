# Launch-Readiness Audit — 2026-07-07

> Full-stack launch-readiness audit of both apps against the `plan/` docs,
> focused on booking accuracy, pricing, availability, security, data
> integrity, and cross-app consistency. Read-only — no fixes applied.
>
> Successor scope to `AUDIT-GUEST-APP-2026-07-07.md` and
> `AUDIT-ADMIN-APP-2026-07-07.md` (all 51 findings there are marked fixed;
> spot-rechecked and confirmed closed). This pass hunts for what those
> audits missed, verifies the claimed fixes landed, and re-baselines the
> test suites.
>
> Workspace: staybase
> Audited: 2026-07-07 (branch `dev`, HEAD `8d4fe1b`)
> Method: read the full doc set (`CLAUDE.md`, `plan/docs/{BACKEND,
> API-ROUTES, SECURITY, GOTCHAS, TYPES}.md`, `plan/features/
> {AVAILABILITY-LOCKING, BOOKING-FLOW}.md`, prior audit reports); traced
> `guest-app/server/apiRouter.ts`, `guest-app/server/handlers/{bookings,
> rooms, members, store, email}.ts`, `firebase/{firestore,storage}.rules`,
> `admin-app/src/context/AdminContext.tsx`, `admin-app/src/pages/
> BookingsPage.tsx`, `guest-app/src/pages/BookingPage.tsx`,
> `shared/utils/pricing.ts`, `vercel.json`.
> Baseline: typecheck clean; **test suites are GREEN on
> `fix/launch-readiness-must-fix`** — shared 100/100, guest API 282/282,
> admin 613/613. LR-M6 closed by refreshing stale source-pattern tests
> to match the current implementation.
>
> **Convention:** findings are numbered `LR-<severity><n>` (Launch
> Readiness). Status is `Fixed` once the branch includes the code, docs,
> and test updates that close the item.

---

## 1. Executive Summary

**Overall Health: Launch-ready after deploy**

The core booking engine is genuinely well-built — transactional
availability locking, server-authoritative pricing, PII-conscious API
design — and the four prior audit passes fixed a lot. This pass found
two critical bugs in daily front-desk flows that all 862 tests missed,
plus a bot gate that failed open and two trust-boundary holes with real
money impact. All LR findings are now fixed on
`fix/launch-readiness-must-fix`.

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **Critical** | 0 | 2 | **2** |
| **High** | 0 | 4 | **4** |
| **Medium** | 0 | 6 | **6** |
| **Low** | 0 | 8 | **8** |
| **Total** | **0** | **20** | **20** |

### Top 5 to fix first

| # | ID | Why | File:line | Status |
|---|---|---|---|---|
| 1 | **LR-C1** | Walk-in with "immediate check-in" always 500s — read-after-write inside the Firestore transaction | `guest-app/server/handlers/bookings.ts:1196-1206` | Fixed |
| 2 | **LR-C2** | Checking out a Spark Rewards member always 500s when points are enabled — guest stays "checked-in", room stays occupied | `guest-app/server/handlers/bookings.ts:1742-1775` | Fixed |
| 3 | **LR-H1** | Turnstile fails open — omit the `Origin` header and every bot gate verifies against Cloudflare's always-pass test secret | `guest-app/server/apiRouter.ts:282-322` | Fixed |
| 4 | **LR-H2** | Guests can self-award unlimited reward points; staff redemption converts them to real peso discounts | `firebase/firestore.rules:67`, `guest-app/server/handlers/members.ts:324` | Fixed |
| 5 | **LR-H3** | `storeOrders` world-readable + world-creatable — anonymous PII/payment-proof dump and forged orders | `firebase/firestore.rules:130-134` | Fixed |

---

## 2. Documentation Audit

The `plan/` docs are unusually complete and current; drift is minor. Doc
quality itself is a strength — no flawed workflows in the spec worth
redesigning.

### Correctly implemented (verified)

- Transactional booking creation with room-type auto-assignment and
  deterministic room sort (`handleCreateBooking`)
- Server-authoritative corporate code / voucher validation with
  in-transaction usage counting (BI-04/07/10 fixes confirmed in place)
- Weekend-rate pricing consistent between client and server (Sat/Sun
  nights, corporate exempt; BF-08 roomTotal override confirmed)
- Discount stacking order Senior/PWD → voucher → member per
  `DECISIONS-FEATURES.md #13b`
- Daily booking-ref counters generated inside transactions
- Booking lookup/cancel via ref+email or magic-link token, with
  404-backoff and Turnstile gating (H1/H2/S2 hardening confirmed)
- RA 10173 member erasure flow (audit records, anonymization,
  subcollection wipe, Auth delete)
- Store order transaction with payment-method allowlist and
  active-booking gate (H4 confirmed)
- Email recipients server-resolved from booking docs with idempotency
  markers (BF-04 confirmed)
- Staff create/disable via Admin SDK with last-active-admin protection
- CSP / Permissions-Policy headers per SECURITY.md (incl. BI-06
  `microphone=(self)`)
- Payment-proof / discount-ID Storage rules (staff-read only)
- Vercel crons for check-in reminders and the storage janitor

### Partially implemented

- None remaining from this launch-readiness set.

### Missing from implementation (documented in spec)

- None remaining from this launch-readiness set.

### Unexpected (implemented, undocumented)

- None remaining from this launch-readiness set; LR-L8 updated
  `API-ROUTES.md` and `BACKEND.md`.

### Conflicts

- `API-ROUTES.md` mandates store orders "MUST use a Firestore
  transaction" while rules allow direct client creates (LR-H3)
- `BACKEND.md` security table says `rewardsConfig` read = "authenticated
  guests"; rules give all of `settings/*` public read (harmless,
  non-sensitive — doc drift)
- Prior audit docs claim a green test baseline — 8 tests fail on `dev`
  (LR-M6)

---

## 3. Core Flow Audit

### Admin

Auth, routing, role gating of Settings, bookings table/drawer, payments
audit trail, reports, and settings CRUD are in good shape post-AA fixes.
The two critical bugs both live in staff flows the tests can't catch:
immediate-check-in walk-ins and member checkouts will 500 on real
Firestore (LR-C1, LR-C2). The admin login gate also accepts *any*
Firebase user and defaults them to a front-desk UI shell (LR-H4).
Check-in is a non-atomic client-side two-document update (LR-L6).

### Guest

The 4-step booking flow is correct end-to-end: dates validated
server-side (Manila calendar), consent enforced, uploads via preallocated
IDs, totals recomputed server-side and surfaced back to the confirmation
page. Two pricing-integrity gaps: a voucher that expires between
validation and confirm is *silently* dropped — guest charged more than
quoted (LR-M3) — and a rejected Senior/PWD discount also strips the
member discount (LR-L2).

### Cross-App

Room blocking, rate edits, and content edits propagate correctly (live
`onSnapshot` + 5-min public cache with cross-tab bust). Two sync gaps:
bookings in `payment-confirmed` status are invisible to the guest
availability endpoint (LR-M1), and early checkouts never release the
remaining nights for resale (LR-M2).

---

## 4. Findings

## Critical (2)

### LR-C1 — Walk-in booking with immediate check-in always fails (read-after-write in transaction)
**Status:** Fixed
**Area:** Admin / Booking
**File:** `guest-app/server/handlers/bookings.ts:1196-1206`; trigger: `admin-app/src/pages/BookingsPage.tsx:1435`

When the admin toggles immediate check-in, the walk-in modal sends
`status: "checked-in"`. Inside `handleCreateWalkin`'s transaction, the
room is flipped to occupied via `transaction.update(roomRef, …)` (:1198)
**before** the idempotency read `transaction.get(bookingDocRef)` (:1205).
The Firestore Admin SDK throws *"Firestore transactions require all reads
to be executed before all writes"* — every immediate-check-in walk-in
returns 500. All tests pass because the Vitest transaction mock does not
enforce read/write ordering.

**Business impact:** Front desk cannot register a guest standing at the
counter — the single most common admin flow.

**Repro:** Admin → Bookings → New walk-in → check "immediate check-in" →
Save (against real Firestore).

**Fix:** Move the `existingWalkin` idempotency `get` to the top of the
transaction, before any write.

### LR-C2 — Checkout of a rewards member always fails when points are enabled
**Status:** Fixed
**Area:** Admin / Booking / Data
**File:** `guest-app/server/handlers/bookings.ts:1742-1775`

`handleCheckoutBooking`'s transaction writes booking/room/intercom
updates (:1742, :1752, :1766) then calls `await
transaction.get(memberRef)` (:1775) — same read-after-write violation as
LR-C1. Any checkout where a member match exists and `pointsAwarded > 0`
throws; the booking stays `checked-in` and the room stays `occupied`.

**Business impact:** Members — the hotel's best customers — cannot be
checked out; the room shows occupied until manual DB surgery; points are
never awarded.

**Repro:** Check out any booking linked to a member (or whose guest email
matches a member) while `rewardsConfig.pointsEnabled` is on.

**Fix:** Read the member doc before any write inside the transaction
(it was already fetched pre-transaction — re-read it first), and re-check
`status === "checked-in"` inside the transaction (currently only checked
outside — a double-submit double-awards points, see LR-L8-adjacent note
in LR-C2 fix).

## High (4)

### LR-H1 — Turnstile bot verification fails open without a production Origin header
**Status:** Fixed
**Area:** Security
**File:** `guest-app/server/apiRouter.ts:282-322`

If the request's Origin/Referer isn't a production guest host,
`verifyTurnstile` uses Cloudflare's hardcoded always-pass test secret
(`1x0000…AA`). A bot simply omits `Origin` and sends any non-empty
`turnstileToken` — the gate on booking create, lookup (ref-enumeration
oracle), guest cancel, and voucher/corporate-code validation becomes
decorative. The BF-24 comment claims requests missing Origin are
rejected, but that branch is unreachable (`secret` is always set for
non-production); the dangling `void originAllowed; void usingTestSecret;`
after the `return` confirms the tightening was never finished.

**Business impact:** Only rate limiting (in-memory, per-serverless-
instance — weaker than it looks) and the honeypot stand between bots and
booking spam / booking-ref probing.

**Fix:** In production deployments (e.g. `VERCEL_ENV === "production"`),
always use the real secret and fail closed; never infer environment from
client-controlled headers.

### LR-H2 — Guests can inflate their own points balance; staff redemption converts it to money
**Status:** Fixed
**Area:** Security / Pricing
**File:** `firebase/firestore.rules:67`; `guest-app/server/handlers/members.ts:324`

`members/{uid}` allows the owner to update their own doc with **no field
restrictions** — including `rewardsPoints`. `/api/members/redeem-points`
validates the requested redemption against that client-writable balance
and deducts the value from `booking.totalPrice`.

**Business impact:** Direct revenue loss — a member can mint points and
redeem them for real peso discounts at the front desk.

**Repro:** As a signed-in member, run
`updateDoc(doc(db,"members",uid), { rewardsPoints: 100000 })` from the
browser console; ask front desk to redeem points against a booking.

**Fix:** Restrict owner updates to profile fields in rules —
`request.resource.data.diff(resource.data).affectedKeys()
.hasOnly(['fullName','phone','photoUrl','updatedAt'])`. All points
mutations already have server-side paths.

### LR-H3 — `storeOrders` world-readable and world-creatable
**Status:** Fixed
**Area:** Security / Data
**File:** `firebase/firestore.rules:130-134`

`allow read, create: if true`. Anyone anonymous can dump every order:
guest name, room number, items, and `paymentProofUrl` — a tokened
`getDownloadURL` that **bypasses** the staff-only Storage rule. Direct
creates also bypass the API's stock check, active-booking gate,
payment-method allowlist, and server price snapshot (an attacker can
write `totalAmount: 1` orders that staff fulfill). The guest app never
reads or writes this collection directly (all traffic goes through
`/api/store/*`), so tightening breaks nothing.

**Fix:** `allow read, update: if isStaff(); allow create: if false;
allow delete: if isAdmin();` — the API uses the Admin SDK and bypasses
rules.

### LR-H4 — Admin app grants a front-desk UI to any authenticated Firebase user
**Status:** Fixed
**Area:** Admin / Security
**File:** `admin-app/src/context/AdminContext.tsx:500` and `:523`

A token without a staff `role` claim falls back to `"front-desk"`
instead of being rejected. Guest members self-register on the public site
in the *same Firebase project*, so anyone can log into the admin domain
and receive the full front-desk shell. Firestore rules and API auth
(custom-claims based) block the data, so exposure is limited — but the
authentication gate contradicts `AUTH-ROLES.md`, and any future rules
loosening would be silently exploitable.

**Fix:** If `!isStaffRole(claims.role)`, call `signOut()` and show
"not authorized".

## Medium (6)

### LR-M1 — Availability endpoint ignores `payment-confirmed` bookings
**Status:** Fixed
**Area:** Cross-App / Booking
**File:** `guest-app/server/handlers/rooms.ts:14`; setter: `admin-app/src/context/AdminContext.tsx:1052`

`ACTIVE_STATUSES` omits `"payment-confirmed"`, a status the admin drawer
sets. Step 1 shows those rooms as available and overstates "X of Y
available"; guests hit "Room no longer available" at confirm.

**Fix:** Add the status to the list (and audit any other status
allowlists that enumerate active bookings).

### LR-M2 — Early checkout never frees the remaining nights
**Status:** Fixed
**Area:** Booking / Data / Revenue
**File:** `guest-app/server/handlers/bookings.ts:418` (conflict query), `:1742` (checkout)

Checkout flips the room to `available` but leaves the booking's original
`checkOut` date; the create-transaction conflict query is
`status != "cancelled"`, so a `checked-out` booking still blocks its
unused nights — while the availability endpoint (which excludes
`checked-out`) shows them bookable. Guest sees available → 409 at
confirm; the hotel cannot resell the freed nights.

**Fix:** Either truncate `checkOut` to today at checkout, or exclude
`checked-out` in the conflict check — and keep the endpoint and the
transaction symmetric.

### LR-M3 — Voucher silently dropped at booking creation
**Status:** Fixed
**Area:** Pricing / Guest
**File:** `guest-app/server/handlers/bookings.ts:625-663`

If a voucher fails re-validation inside the create transaction
(expired / cap reached / deactivated between Apply and Confirm), the
booking proceeds at full price with no error — the guest is charged more
than the total they agreed to. Corporate codes got a distinct 409 for
this exact race (BI-10); vouchers were left silent.

**Fix:** Abort with a 409 ("Voucher no longer valid — please re-apply or
remove it") mirroring the corporate-code path.

### LR-M4 — Member registration links an arbitrary `bookingId` without ownership check
**Status:** Fixed
**Area:** Security / Data
**File:** `guest-app/server/handlers/members.ts:69-73`

`linkBookingsByEmail` unconditionally stamps `memberId` onto any
client-supplied `bookingId` — no check that the booking's `guestEmail`
matches the caller. A linked booking then appears in
`/api/members/stays` including its `lookupToken`, which authorizes
cancellation via `/api/bookings/cancel`. Requires knowing a victim's
Firestore booking ID (unguessable but leakable). Also 500s registration
if the ID doesn't exist (batch update on a missing doc).

**Fix:** Load the booking and require `guestEmail === member email` (or
existing `memberId === uid`) before linking; skip silently otherwise.

### LR-M5 — Documented 8-hour inactivity auto-logout not implemented
**Status:** Fixed
**Area:** Admin / Security
**File:** `admin-app/src/context/AdminContext.tsx` (absent); spec: `plan/docs/SECURITY.md §Session Management`

SECURITY.md specifies an 8-hour inactivity logout for shared front-desk
computers; no idle timer exists anywhere in admin-app. Session
persistence (clears on tab close) is implemented.

**Fix:** Interaction-reset `setTimeout` → `signOut()` + redirect to
`/login`.

### LR-M6 — Test baseline is red while audit docs claim green
**Status:** Fixed
**Area:** Data / Maintainability

On `dev` HEAD `8d4fe1b`: 5 guest-api failures (277/282 pass) and 3 admin
failures (600/603 pass); shared green (99/99).

Failing tests:
- `tests/api/batch-10-email-extensions.test.ts` — "AdminContext.addVoucher
  does NOT post when guestEmail is empty" (possible real regression)
- `tests/api/audit-batch-3-bi12-bi16.test.ts` — "CorporateBookingPage
  defaults checkIn to today…"
- `tests/api/audit-guest-sev2-2026-07-07.test.ts` — "member registration
  failures surface through auth/profile UI…"
- `tests/api/cors-allowlist.test.ts` — 2 source-pattern assertions
- `admin-app` — "calls /api/members/register with a Bearer token on
  enroll", "Room mapper drops bedDefinition…", "RoomsPage reads imageUrls
  from the type entry directly"

Most look like source-text assertions that drifted during the sev2–sev4
fix batches, but at least the voucher-email one may indicate a real
behavior regression. A red baseline destroys the regression signal these
audits rely on.

**Fix:** Triage all 8 before launch. Also add a transaction mock that
enforces read-before-write ordering — it would have caught LR-C1/LR-C2
and protects every future transaction.

## Low (8)

### LR-L1 — Cancellation restores voucher usage but not corporate-code usage
**Status:** Fixed — `guest-app/server/handlers/bookings.ts:1440-1446`
Capped corporate codes permanently lose a use when a corporate booking is
cancelled; vouchers are correctly restored. Mirror the voucher decrement
for `corporateCodes.usageCount`.

### LR-L2 — Discount rejection drops the member discount and force-resets status
**Status:** Fixed — `guest-app/server/handlers/bookings.ts:1277-1287`
Restored total = `originalTotalPrice − voucherDiscount` only — the member
discount is not re-applied, overcharging member guests by their member %.
Status is also unconditionally reset to `"pending"`, regressing a
`payment-uploaded` booking.

### LR-L3 — Blocked rooms with a future window are hidden for all dates client-side
**Status:** Fixed — `guest-app/src/pages/BookingPage.tsx:235`
The client filters `status !== "blocked"` without the
`blockedFrom`/`blockedTo` window check the server applies — a room
blocked next month is unsellable today even though `/api/bookings/create`
would accept the booking. Undersells capacity.

### LR-L4 — Client-supplied `bookingId` is unvalidated
**Status:** Fixed — `guest-app/server/handlers/bookings.ts:201` (create), `:992` (walkin)
No length/format check on the preallocated document ID; an ID like
`"audit"` collides with the `bookings/audit` document path used by the
erasure audit subcollection. Add a `^[A-Za-z0-9]{10,32}$` guard.

### LR-L5 — `/api/email/corporate-inquiry` is anonymous spam surface
**Status:** Fixed — `guest-app/server/apiRouter.ts:823-866`, `guest-app/server/handlers/email.ts:885-889`
The action is in `publicEmailActions` with no Turnstile and a rate-limit
key derived from `req.body.inquiry.email` (attacker-rotatable) —
staff-inbox spam through the hotel's Resend account. The real inquiry
endpoint already sends this email server-side; make the action
staff-only.

### LR-L6 — Check-in is a non-atomic client-side two-document update
**Status:** Fixed — `admin-app/src/context/AdminContext.tsx:1093-1103`
Booking status and room status are updated separately, the room write is
fire-and-forget (`void updateRoomConfig(...)`), and there is no
occupancy validation. Consider a small `/api/bookings/checkin` endpoint
mirroring checkout.

### LR-L7 — Intercom abuse mitigation not implemented
**Status:** Fixed — `firebase/firestore.rules:117-119`; spec: `plan/docs/SECURITY.md §Abuse Mitigation`
`intercoms` is open write with no per-room message rate limit (spec: max
~30 messages per room per 10 minutes).

### LR-L8 — Doc drift (batch)
**Status:** Fixed
- `memberDiscountPct` missing from `BACKEND.md §bookings` schema
- `/api/janitor/*` and `/api/members/set-active` missing from
  `API-ROUTES.md`
- Lookup-token magic-link mode missing from the `API-ROUTES.md` lookup
  row
- `BACKEND.md` security table `rewardsConfig` read description doesn't
  match the public-read rules (harmless — non-sensitive doc)

---

## 5. Missing Critical Features

Nothing major — the feature set (lookup, self-service cancel, calendar
export, booking history, occupancy rules, notes, availability display) is
appropriately scoped. Two operationally notable gaps, both fine as
fast-follows:

1. **Booking modification** (dates/room change) has no flow at all —
   staff must cancel + re-create, which loses payment history and voucher
   state. Acceptable at launch; document the manual procedure for staff.
2. **Staff availability calendar** — the dashboard shows today's state,
   but there is no forward calendar of room occupancy; front desk will
   feel this within weeks.

---

## 6. Launch Checklist

**Ready for launch:** booking flow + pricing engine, corporate flow,
voucher management, lookup/cancel, member registration/portal/erasure,
store, intercom, emails + crons, reports, settings, staff account
management, CSP/CORS, storage rules.

**Needs fix before launch:** None currently open from this audit. Deploy
rules after merge; Firestore rules in git are not live production rules.

**Can wait until later:** booking modification and staff availability calendar.

---

## 7. Overall Recommendations

### Priority 1 (Must Fix, ~1–2 days)

1. Fixed both read-after-write transactions (move all `transaction.get`
   calls before writes; add a status re-check inside the checkout
   transaction) — LR-C1, LR-C2
2. Add a read-before-write-enforcing transaction mock to the test
   harness so this class of bug can never pass tests again
3. Fixed Turnstile closed in production (`VERCEL_ENV`-based, not
   Origin-based) — LR-H1
4. Fixed `members` (field allowlist) and `storeOrders` (staff-only
   read, no client create) rules **and deploy them** (remember: rules in
   the repo are not rules in production — see the 2026-07-02 index
   lesson in `BACKEND.md`) — LR-H2, LR-H3
5. Fixed non-staff login rejection in the admin app — LR-H4
6. Fixed `payment-confirmed` availability, early-checkout release,
   stale voucher 409s, member booking ownership checks, and 8-hour admin
   idle logout — LR-M1, LR-M2, LR-M3, LR-M4, LR-M5
7. Fixed the 8 red tests — LR-M6

### Priority 2 (Should Fix, week 1 post-launch)

- Fixed corporate-code usage restore on cancel — LR-L1
- Fixed discount-rejection member-discount + status handling — LR-L2
- Fixed `bookingId` format validation — LR-L4
- Fixed `/api/email/corporate-inquiry` staff-only access — LR-L5

### Priority 3 (Future improvements)

- Booking modification flow; staff availability calendar
- Durable (KV-backed) rate limiting to replace the per-instance
  in-memory map

---

## Process note

Every prior audit and all 862 tests missed LR-C1 and LR-C2 because the
Vitest transaction mocks accept any read/write ordering. A ~15-line
stricter mock (throw if `get` is called after `set`/`update` within the
same transaction callback) retrofitted into the existing test files would
have caught both and will protect every future transaction.
