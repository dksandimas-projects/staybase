# Booking Flow (Regular + Corporate) Readiness Audit — 2026-07-08
> Focused readiness audit of the public booking flow and the corporate booking
> flow, requested ahead of the next `dev → main` milestone. Read-only at audit
> time. Successor to `plan/project/AUDIT-BOOKING-INTERCOM-2026-07-06.md`
> (all 23 BI-* findings closed); this pass verifies the BI batches landed
> cleanly and re-checks the full spec checklists in
> `plan/features/{BOOKING-FLOW,CORPORATE-BOOKING,AVAILABILITY-LOCKING}.md`.
>
> Workspace: staybase
> Audited: 2026-07-08 (branch `dev`, HEAD `c4d2db1`)
> Method: read-only — read `plan/features/{BOOKING-FLOW,CORPORATE-BOOKING,
> AVAILABILITY-LOCKING}.md` + `plan/docs/GOTCHAS.md`; traced
> `guest-app/src/pages/{BookingPage,CorporateBookingPage,BookingConfirmPage}.tsx`,
> `guest-app/src/hooks/useTurnstileToken.ts`, `guest-app/server/apiRouter.ts`,
> `guest-app/server/handlers/{bookings,rooms}.ts`, `shared/utils/pricing.ts`;
> verified the installed Firestore Admin SDK's transaction semantics against
> `node_modules/@google-cloud/firestore` (v7.11.6, via `firebase-admin`
> 13.10.0); ran the booking-related API test suites (5 files, 50 tests, all
> green at audit time).
>
> **Convention:** findings are numbered `BR-<n>` (Booking Readiness). Severity
> matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until
> the remediation branch updates this doc with the fix and verification.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 1 | **1** |
| **SEV-2 (major)** | 0 | 1 | **1** |
| **SEV-3 (minor)** | 0 | 1 | **1** |
| **SEV-4 (nit / spec drift)** | 0 | 2 | **2** |
| **Total** | **0** | **5** | **5** |

**Remediation status: fixed on `codex/fix-booking-flow-readiness`.** The flows are in strong shape overall — the
BI-* fixes landed and the server is authoritative on every field the spec
requires — and the BR-* blockers from this audit have been addressed.

Verification after fixes:

- `npm run test:api -w guest-app` — 38 files, 284 tests passing
- `npm run build:api -w guest-app` — committed API bundle regenerated
- `npm run typecheck -w guest-app` — passing

Original blocker summary:

1. **Corporate-code and voucher bookings crash the create transaction**
   (BR-01). The `usageCount` increments queue transaction writes *before* the
   booking-ref counter read, and the Firestore Admin SDK rejects any read
   after a write inside a transaction. Every booking that uses a validated
   corporate access code, and every standard booking with an applied voucher,
   fails with a 500 — in every environment, not just production. The corporate
   half regressed yesterday in `bcb1b38` (the BI-07 fix); the voucher half
   carries the same ordering.
2. **The standard flow never resets its single-use Turnstile token** (BR-02).
   Applying a voucher consumes the review-step token, so the subsequent
   Confirm fails bot verification in production. Retries after any failed
   create hit the same wall. The corporate page handles this correctly; the
   standard page does not.

Both blockers are invisible to the current test suite (BR-03: the transaction
mock does not enforce read-before-write) and BR-02 is additionally masked in
local dev by Cloudflare's always-pass test secret. A single end-to-end manual
QA run of the "voucher code applies" and "valid access code" checklist items
already listed in the feature MDs would have caught both.

### Fix order

1. BR-01 — reorder the create transaction (all reads before all writes).
2. BR-03 — make the shared transaction mock throw on read-after-write so
   BR-01's class of regression is test-visible.
3. BR-02 — destructure and call `reset()` in `BookingPage` after every
   token-consuming request.
4. BR-04 / BR-05 — ride along in the same fix branch.

---

## SEV-1 — Critical (1)

### BR-01 — Read-after-write in the create transaction: corporate-code and voucher bookings always 500
**Status:** Fixed
**File:** `guest-app/server/handlers/bookings.ts:532-535` (corporate
`usageCount` write), `:663-666` (voucher `usageCount` write), `:694-704`
(`settings/rewardsConfig` read), `:729-738` (booking-ref counter read)

`handleCreateBooking` runs one Firestore transaction whose operations are
ordered: booking-doc read → hotelConfig read → candidate-room reads → overlap
reads → breakfastConfig read → corporate-code read **→ corporate-code
`usageCount` update (write)** → voucher reads **→ voucher `usageCount` update
(write)** → rewardsConfig read (members only) → **booking-ref counter read** →
counter write + booking write.

The Firestore Admin SDK enforces that all transaction reads happen before any
write: `Transaction.get()` throws
`"Firestore transactions require all reads to be executed before all writes."`
the moment the transaction's write batch is non-empty (verified in the
installed `@google-cloud/firestore` 7.11.6 — the guard is client-side in the
SDK, so it fires in **every** environment, local dev included). The counter
read always runs, so:

- **Every booking with a validated corporate code fails.** The write at `:532`
  precedes the counter read at `:731`. Introduced 2026-07-07 in `bcb1b38`
  (the BI-07 fix that added the increment).
- **Every standard booking with a valid voucher fails.** The write at `:663`
  precedes the same counter read. This ordering predates `bcb1b38`.
- Member bookings (rewardsConfig read at `:696`) fail only when combined with
  a voucher; otherwise the read happens before any write.
- Corporate flat-rate (no code) and plain standard bookings are unaffected —
  which is why the most-traveled paths still work.

The thrown message is not matched by the handler's 409 mapping
(`bookings.ts:943-981`), so the guest receives a 500 whose `error` field is
the raw SDK internals message — an error-copy leak on top of the failure.

The team already knows this constraint: the LR-C1 comment in
`handleCreateWalkin` (`bookings.ts:1030-1035`) restructured the walk-in
transaction for exactly this reason, and that handler is correctly ordered.

**Fix:** move the counter read and the rewardsConfig read into the read phase
(before the corporate-code and voucher writes), then perform all writes
(corporate-code update, voucher update, counter update, booking set) at the
end. Must land together with BR-03 so the ordering is enforced by tests.

---

## SEV-2 — Major (1)

### BR-02 — `BookingPage` never resets the single-use Turnstile token; voucher Apply consumes the Confirm token
**Status:** Fixed
**File:** `guest-app/src/pages/BookingPage.tsx:215-217` (hook destructure —
no `reset`), `:568-577` (voucher Apply sends the token), `:673-762`
(Confirm — no reset on any outcome)

`plan/docs/GOTCHAS.md §Security & PII` requires resetting the Turnstile widget
after **every** request that sends the token to siteverify (tokens are
single-use). `CorporateBookingPage` complies (resets at `:528` after gate
validation and at `:719`/`:724` after Confirm). `BookingPage` destructures
only `token` and `containerRef` from `useTurnstileToken` — `reset` is never
called anywhere on the page. Two production consequences:

1. **Voucher → Confirm dead end.** `handleApplyVoucher` posts the review-step
   token to `/api/validate/voucher`, which forwards it to Cloudflare
   siteverify and consumes it. The widget has no way to know; the client-side
   `token` state stays set and the Confirm button stays enabled
   (`BookingPage.tsx:977` gates on `Boolean(turnstileToken)`). Confirm then
   sends the consumed token to `/api/bookings/create` and gets
   `"Bot verification failed. Please try again."` — and every retry re-sends
   the same dead token. The guest is stuck until the widget's ~5-minute token
   expiry triggers an auto-refresh. Any guest who touches the voucher field
   (even with an invalid code — validation still consumes the token) hits
   this on the exact path a promo campaign drives.
2. **Failed-create retries fail bot verification.** Any non-conflict create
   failure (409 voucher, 5xx) leaves the consumed token in place, so the retry
   the error copy invites fails the bot check too.

Masked in dev/preview: non-production origins verify against Cloudflare's
always-pass test secret, which accepts duplicate tokens. Only production
(real secret) rejects reuse — the same dev/prod split documented in the
BI-02 postmortem.

**Fix:** destructure `reset` from `useTurnstileToken` in `BookingPage` and
call it (a) after every `/api/validate/voucher` response in
`handleApplyVoucher`, and (b) after every `/api/bookings/create` response in
`handleConfirmBooking` (success path navigates away; error paths must reset
before re-enabling Confirm).

---

## SEV-3 — Minor (1)

### BR-03 — Transaction test mocks don't enforce read-before-write, so BR-01's class ships green
**Status:** Fixed
**File:** `guest-app/tests/api/bookings-create.test.ts:228` (and the sibling
booking suites that stub `runTransaction` the same way)

The mocked `runTransaction` invokes the handler callback with a plain object
whose `get`/`update`/`set` record calls without any ordering rules. The real
SDK throws on any `get` after a queued write (see BR-01), so the exact code
path that fails in production — corporate-code booking with the BI-07
increment, voucher booking with its increment — passes 50/50 tests at audit
time. This is the second time the gap has bitten: the LR-C1 walk-in
read-after-write was also found by audit rather than by tests.

**Fix:** give the shared mock transaction a `hasWrites` flag; `update`/`set`/
`create`/`delete` set it, and `get`/`getAll` throw the SDK's exact
read-after-write message when it is set. Add regression tests: corporate-code
booking increments `usageCount` and succeeds; voucher booking increments
`usageCount` and succeeds.

---

## SEV-4 — Nits & spec drift (2)

### BR-04 — Staff new-booking email always reports source "online", including for corporate bookings
**Status:** Fixed
**File:** `guest-app/server/handlers/bookings.ts:910-916`

The staff notification passes `source: computedData.source || "online"`, but
`computedData` (assembled at `:854-863`) never includes a `source` field — the
fallback always wins. Corporate bookings (source `"corporate"` on the booking
doc per `CORPORATE-BOOKING.md`) are announced to staff as `"online"`. The
comment above the call ("corporate / walkin bookings take a different path")
is also stale: corporate bookings go through `handleCreateBooking` and this
exact send.

**Fix:** include the booking's `source` in `computedData` inside the
transaction (or read it from the fresh booking snapshot the dedup check
already fetches) and drop the stale comment.

### BR-05 — Corporate 409 recovery shows an error but never routes the guest anywhere
**Status:** Fixed
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:716-721`

Per `CORPORATE-BOOKING.md` (BI-10), a `"Corporate code no longer valid"` 409
at create time should send the guest **back to the gate** to re-validate or
continue without a code; the page only renders the error string (the copy does
include re-enter guidance). Likewise, a `"Room no longer available"` 409 shows
the error with no navigation, while the standard flow auto-redirects to
Step 1 after 5 seconds (`BookingPage.tsx:746-756`). Functional — Turnstile is
correctly reset so retries work — but inconsistent with both the spec's stated
recovery and the sibling flow.

**Fix:** on a code-invalid 409, clear the stored code/rate state and navigate
to the gate step; on a room-conflict 409, mirror the standard flow's redirect
to the room-selection step.

---

## What was verified as correctly wired

Checked against the full spec checklists; no action needed on any of the
following.

**Server authority & pricing**
- `isCorporate`, `companyName`, and all rates derived server-side; the
  `corporateFlatRate` intent flag carries no pricing power and falls back to
  the standard rate when `corporateRate` is unset (never ₱0); a validated
  `corporateCode` always wins over the flag (BI-04 holds).
- Corporate codes re-validated inside the transaction with the `code`-field
  fallback and a distinct 409 instead of a silent downgrade (BI-10 holds);
  vouchers re-validated in-transaction with the same fallback; vouchers
  zeroed on corporate bookings (decision #100).
- Discount stacking order (Senior/PWD → voucher → member) matches
  `DECISIONS-FEATURES.md #13b` on both server and `shared/utils/pricing.ts`;
  discount-ID photo required server-side when a discount is selected;
  `originalTotalPrice` stored for rejection restore (BF-05 holds).
- Client/server pricing parity confirmed for both flows, including weekend
  handling: standard flow substitutes weekend rates per night on both sides;
  corporate flow is flat on both sides (server's `!isCorporate` weekend guard
  mirrored by the client's pre-computed `roomTotal`).
- Confirmation pages display the server-computed `totalPrice` (BF-39 holds).

**Availability locking**
- Room-type auto-assignment inside the transaction: deterministic
  `roomNumber` sort, per-candidate blocked-window checks, occupying-status
  overlap checks, assigned `roomId`/`roomNumber` surfaced in the response.
- Idempotent preallocated booking ID (`bookings/{id}` existence read short-
  circuits to the existing ref); walk-in handler's transaction read ordering
  is correct (LR-C1 holds); server rejects past check-ins on the public route
  while exempting walk-ins (BI-12 holds); guest count validated against the
  type's `maxCapacity` server-side.

**Abuse protection**
- `/api/bookings/create`: 5/IP/min rate limit, honeypot with silent fake
  success that never echoes the real booking ID (BF-44 holds), Turnstile
  verified server-side with the bypass gated to `NODE_ENV === "test"` only
  (BI-02 holds) and production determined from `VERCEL_ENV` (LR-H1 holds).
- Both corporate steps run real Turnstile challenges via `useTurnstileToken`
  with correct `enabled` gating, and the corporate page resets after every
  token-consuming call (BI-01/BI-03 hold — the reset gap is standard-flow
  only, see BR-02).
- Voucher/corporate-code validation endpoints rate-limited and
  Turnstile-gated; lookup endpoint keeps the token/backoff hardening (H1/H2/S2
  hold); honeypot field hidden via `absolute opacity-0 pointer-events-none`,
  not `display:none`.
- Guest details Zod-validated and length-capped server-side; corporate
  metadata persisted in the nested `corporate` block only for corporate
  bookings (BI-11/BI-16 hold).

**Compliance & UX**
- Consent checkbox with `/privacy` + `/terms` links (new tabs) required at
  Step 2 in both flows; Step 2 guest-count edits reach the submitted body
  (BI-09 holds); LOU note on the chargeback path with no Phase-1 collection
  (decision #99); personal-pay receipt compressed and uploaded to the
  preallocated `bookings/{bookingId}/payment-proof/` path, landing the booking
  as `payment-uploaded` (BI-05 holds); `linkedInquiryId` plumbing intact
  (decision #102).
- Confirmation page: prominent booking ref, ICS download + Google Calendar
  link, payment-method-specific instructions, Rewards join prompt hidden for
  members; `booking-submitted` guest email + deduped `staff-new-booking`
  notification fire post-transaction (BF-04 holds — modulo the BR-04 label).
- `/api/rooms/availability` returns PII-stripped `{ roomId, checkIn,
  checkOut, status }` ranges only, rate-limited, with the overlap upper bound
  pushed into the Firestore query (W4.7 / BF-22 hold).
- Corporate gate: "Continue without code" path, direct-step navigation
  redirects back to the gate, persistent corporate badge across steps, dark
  header treatment, white logo from `config.logos.white`, brand/currency/
  prefix all from config (white-label rules hold).

**Tests**
- 5 booking-related API suites (50 tests) pass at audit time:
  `bookings-create`, `corporate-code`,
  `batch-8-isCorporate-server-authoritative`, `honeypot-position`,
  `audit-batch-3-bi12-bi16`. See BR-03 for the coverage gap that keeps BR-01
  green.
