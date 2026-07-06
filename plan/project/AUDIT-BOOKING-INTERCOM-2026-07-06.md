# Booking Flow (Regular + Corporate) & Intercom Audit — 2026-07-06
> Focused wiring audit of the public booking flow, the corporate booking flow,
> and the guest/admin intercom feature (chat, quick requests, WebRTC voice call,
> store-order messages). Read-only at audit time. Successor to
> `plan/project/AUDIT-BOOKING-FLOW-2026-06-26.md` (all 50 BF-* findings closed);
> this pass verifies what the BF batches left behind and extends coverage to the
> intercom, which the 2026-06-26 audit did not touch.
>
> Workspace: staybase
> Audited: 2026-07-06 (branch `dev`, HEAD `c593560`)
> Method: read-only — read `plan/features/{BOOKING-FLOW,CORPORATE-BOOKING,
> AVAILABILITY-LOCKING,INTERCOM-GUEST,INTERCOM-INBOX}.md` +
> `plan/docs/{API-ROUTES,GOTCHAS}.md`; traced every code path in
> `guest-app/src/pages/{BookingPage,CorporateBookingPage,BookingConfirmPage,
> IntercomPage}.tsx`, `guest-app/server/apiRouter.ts`,
> `guest-app/server/handlers/{bookings,vouchers,corporate-codes,rooms}.ts`,
> `admin-app/src/pages/IntercomInboxPage.tsx`,
> `admin-app/src/components/IntercomChatPanel.tsx`,
> `admin-app/src/context/AdminContext.tsx` (intercom/calls sections);
> cross-checked `firebase/{firestore,storage}.rules`, `vercel.json`,
> `guest-app/vercel.json`, `admin-app/vercel.json`, `shared/schemas/booking.ts`.
>
> **Convention:** findings are numbered `BI-<n>` (Booking & Intercom). Severity
> matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until
> a commit references the fix in this doc.
>
> **Last status sync: 2026-07-06** — all 6 SEV-1 findings fixed in `f20c0bb`
> (`fix/audit-bi-sev1`, shared VERSION 0.119.8); all 5 SEV-2 findings fixed
> in `bcb1b38` (`fix/audit-bi-sev2`, shared VERSION 0.119.8).
> Typecheck + full test suite (99 shared / 254 guest-api / 580 admin) pass;
> API bundle rebuilt and committed. SEV-3..SEV-4 remain open.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 6 (`f20c0bb`) | **6** |
| **SEV-2 (major)** | 0 | 5 (`bcb1b38`) | **5** |
| **SEV-3 (minor)** | 7 | 0 | **7** |
| **SEV-4 (nit / doc drift)** | 5 | 0 | **5** |
| **Total** | **12** | **11** | **23** |

The server side of the booking flow (`handleCreateBooking`, `handleCreateWalkin`,
availability transaction, ref counter, discount stacking, idempotency, email
dedup) is in very good shape after the BF-* batches. The critical problems found
in this pass are concentrated in three places:

1. **Bot protection is decorative.** The server unconditionally accepts the
   `"mock_token"` sentinel (BI-02), every guest-app caller falls back to it,
   and the Turnstile widget never actually mounts on the booking page (BI-03).
2. **The corporate booking flow is broken end-to-end.** The create request
   sends no Turnstile token at all, so it is rejected outside test env (BI-01);
   the flat-rate path prices at the standard rate with `isCorporate: false`
   (BI-04); the personal-pay receipt never leaves the browser (BI-05); the
   corporate metadata collected in Step 2 is dropped by the server (BI-11);
   `usageCount` never increments (BI-07).
3. **The intercom voice call cannot work in production.** Both apps ship
   `Permissions-Policy: microphone=()`, which denies `getUserMedia` for the
   page itself (BI-06). Chat, quick requests, store orders, notification sound,
   and resolve/reopen are all correctly wired.

### Top 5 to fix first

| # | ID | Why | File:line | Status |
|---|---|---|---|---|
| 1 | **BI-01** | Corporate booking creation always returns 400 outside `NODE_ENV=test` — the flow cannot complete at all | `guest-app/src/pages/CorporateBookingPage.tsx:534-564` | Fixed in `f20c0bb` |
| 2 | **BI-02** | `"mock_token"` bypasses Turnstile server-side in every environment — all bot gates (create, cancel, lookup, voucher, corp-code, inquiry, contact) are void | `guest-app/server/apiRouter.ts:250-262` | Fixed in `f20c0bb` |
| 3 | **BI-05** | Corporate personal-pay proof is never uploaded and the booking is recorded as `pay-at-hotel` — guests pay real money and staff have no trace | `guest-app/src/pages/CorporateBookingPage.tsx:482-486,556` | Fixed in `f20c0bb` |
| 4 | **BI-04** | "Continue without code" corporate bookings are priced at the standard rate with `isCorporate: false`, `source: "online"`, no company name | `guest-app/server/handlers/bookings.ts:347-385` | Fixed in `f20c0bb` |
| 5 | **BI-06** | `Permissions-Policy: microphone=()` on both apps kills the intercom WebRTC call in production (works only in local dev) | `guest-app/vercel.json`, `admin-app/vercel.json`, root `vercel.json` | Fixed in `f20c0bb` |

> **Fix-order warning (resolved):** BI-02 and BI-03 had to be fixed **together
> with** the client-side fallbacks. Removing the `mock_token` server bypass
> while the widget still failed to mount (BI-03) would have broken *all*
> public bookings, lookups, and voucher validation, because every caller sent
> `turnstileToken: turnstileToken || "mock_token"` with an empty real token.
> `f20c0bb` ships all three sides atomically: the test-only server bypass, the
> container-polling `useTurnstileToken` hook, and the removal of every
> client-side `|| "mock_token"` fallback (BookingPage, BookingLookupPage,
> CorporateStaysPage, CorporateBookingPage). Because Turnstile tokens are
> single-use, the same commit also resets widgets after each token-consuming
> request and makes the lookup magic-link auto-lookup wait for the token.

---

## SEV-1 — Critical (6)

### BI-01 — Corporate booking create sends no `turnstileToken` → always rejected
**Status:** **Fixed in `f20c0bb`** — real Turnstile widgets on the corporate
gate (covers `/api/validate/corporate-code`) and review step (covers
`/api/bookings/create`) via the shared `useTurnstileToken` hook; the fake
"Connection Verified" panel is replaced by the real challenge; Confirm and
Validate wait for the token and widgets reset after each consuming call.
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:534-564` (body), `guest-app/server/apiRouter.ts:421-424` + `:265-267` (rejection)

`handleConfirmSubmit` builds the `/api/bookings/create` body with `corporateCode`
and `_hp` but **no `turnstileToken` field**. The dispatcher calls
`verifyTurnstile(req.body?.turnstileToken, req)`; with `token === undefined`
none of the test-sentinel bypasses match and the function returns
`{ success: false, error: "Bot verification token is missing." }` **before**
any environment/origin logic runs. Result: every corporate booking submission
returns 400 in production, in `vercel dev`, and in preview — the only place it
passes is `NODE_ENV=test`.

The Step 3 UI even renders a **fake** "Connection Verified (Turnstile)" panel
(`CorporateBookingPage.tsx:1440-1447`) — a hardcoded green checkmark with no
widget behind it.

**Fix:** mount a real Turnstile widget on the corporate review step (reuse the
explicit-render pattern from `BookingPage`/`CorporateStaysPage`) and send the
token; remove the fake "verified" panel.

### BI-02 — Server accepts `"mock_token"` (and Cloudflare sentinel tokens) in every environment
**Status:** **Fixed in `f20c0bb`** — the bypass is now `NODE_ENV === "test"`
only; sentinel-token equality checks removed; every client-side
`|| "mock_token"` fallback removed. Local dev keeps working through the
existing non-production-origin → Cloudflare always-pass test-secret path.
**File:** `guest-app/server/apiRouter.ts:250-262`

`verifyTurnstile` short-circuits to success when the token equals
`"1x00000000000000000000AA"`, `"1x000...000"` or `"mock_token"` — **regardless
of `NODE_ENV` and regardless of origin**. BF-24 (2026-06-26) closed the
missing-Origin → test-secret fallback but left this sentinel bypass in place.
Any bot that reads the client bundle (all callers literally contain
`turnstileToken: turnstileToken || "mock_token"`) can bypass Turnstile on:
`/api/bookings/create`, `/api/bookings/cancel`, `/api/bookings/lookup` (defeats
the H1/S2 ref-oracle hardening), `/api/validate/voucher`,
`/api/validate/corporate-code`, `/api/corporate/inquiry`, `/api/contact`.
The only remaining protections are the honeypot and per-instance rate limits.

**Fix:** gate the sentinel bypass behind `NODE_ENV === "test"` (and optionally
a non-production origin check). Must land together with BI-03 and a real token
on every caller (BI-01), or production traffic breaks.

### BI-03 — Turnstile widget never mounts on `BookingPage` → token is always empty
**Status:** **Fixed in `f20c0bb`** — `useTurnstileToken` now polls for the
container ref (instead of bailing when conditional JSX hasn't rendered it)
and clears the token on unmount; `BookingPage` replaced its inline 60-line
effect with the hook gated on the review step; Confirm is disabled until the
token arrives (per BOOKING-FLOW.md §Step 3); the lookup page's magic-link
auto-lookup waits for the token and its widget resets after lookup/cancel.
**File:** `guest-app/src/pages/BookingPage.tsx:480-540` (effect), `:1341-1345` (container)

The mount effect runs **once** (`[]` deps) and bails immediately when
`turnstileContainerRef.current` is null. The container `<div>` exists only in
the review-step JSX — but the first render after mount is always either the
loading skeleton (`isScreenLoading`) or Step 1, so the ref is null when the
effect fires, and navigating Step 1 → 2 → 3 only changes search params (no
remount, effect never re-runs). Even a hard load on `?step=review` renders the
skeleton first. Net effect: the widget never renders, `turnstileToken` stays
`""`, and every submit/voucher call sends the `"mock_token"` fallback — which
the server accepts (BI-02). The two bugs mask each other; that is why bookings
"work" today.

**Fix:** re-run the render attempt when the review step becomes active (e.g.
keyed effect on `isReviewStep`, or render the container on all steps), and
drop the `|| "mock_token"` fallbacks once the widget reliably issues tokens.
`BookingLookupPage` uses a different hook-based mount but keeps the same
fallback — verify it issues real tokens as part of the same fix.

### BI-04 — Flat-rate corporate bookings priced at standard rate, stored as non-corporate
**Status:** **Fixed in `f20c0bb`** — the create body carries a
`corporateFlatRate: true` intent flag for the "Continue without code" path;
the server prices from its own `roomTypes[].corporateRate` (falling back to
the standard rate — never ₱0), sets `isCorporate: true` / `source:
"corporate"`, and stores the guest-entered `companyName` as unverified
metadata. A validated `corporateCode` always wins over the flag. Client-side
rate fallbacks (`corporateRate || pricePerNight`) mirror the server so ₱0 is
never rendered. Structural tests updated to pin the new invariants.
**File:** `guest-app/server/handlers/bookings.ts:347-385`; spec `plan/features/CORPORATE-BOOKING.md §Data & Logic`

The server derives corporate-ness **only** from a validated `corporateCode`.
The "Continue without code" path (`isFlatRate`) sends no code, so the server:
prices every night at `typeBaseRate` (weekend rate applies too, since the
`!isCorporate` guard is false), writes `isCorporate: false`,
`corporateCode: ""`, `companyName: ""`, `source: "online"`. Meanwhile the
client UI quotes `type.corporateRate` on every step, shows the "Flat Corporate
Rate" badge, and only reveals the (higher) server-computed total on the
confirmation screen. Spec requires: flat rate from
`roomTypes[].corporateRate`, `isCorporate: true` always set for this route,
`source: "corporate"`, `companyName` stored.

**Fix:** the create body should carry an explicit `isCorporateRoute`/flat-rate
marker that the server honors for *rate + flags only when the route is
corporate* — e.g. accept `corporateFlatRate: true`, verify nothing
client-trusted beyond intent, price from the type's `corporateRate`, set
`isCorporate: true`, `source: "corporate"`, and store the guest-entered
`companyName` (clearly marked unverified). Alternatively require a code for
corporate pricing and remove the flat-rate promise from the UI + spec.

### BI-05 — Corporate personal-pay receipt never uploaded; payment method hardcoded to `pay-at-hotel`
**Status:** **Fixed in `f20c0bb`** — the receipt is compressed and uploaded to
`bookings/{bookingId}/payment-proof/` (same pattern as BookingPage) and the
body submits the real `paymentMethod` + `paymentProofUrl`, so personal-pay
corporate bookings land as `payment-uploaded`; Confirm requires the upload;
chargeback keeps `pay-at-hotel` semantics (LOU per decision #99); a stale
payment-method selection now falls back to the first corporate-visible method.
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:482-486` (`handleFileChange` stores only the file name), `:556` (`paymentMethod: "pay-at-hotel"`), `:1278` (`canConfirm` ignores the file), `:1393` (UI marks upload required)

The Step 3 personal-pay path shows GCash/Maya/bank account details + QR and a
**required** "Upload payment receipt screenshot" field. But `handleFileChange`
only saves `e.target.files[0].name` into state — no Storage upload, no
`paymentProofUrl` — and the create body hardcodes
`paymentMethod: "pay-at-hotel"` with no `paymentProofUrl`, so the booking lands
as a plain pay-at-hotel `pending` booking. A guest who actually transferred
money has no recorded proof, staff sees nothing to verify, and the
`payment-uploaded` status / staff-new-payment email path never fires.
`canConfirm` also doesn't require the file despite the `*`.

**Fix:** reuse the `BookingPage` upload pattern (compress → upload to
`bookings/{bookingId}/payment-proof/` using the preallocated ID → send
`paymentProofUrl` + the real `paymentMethod`), and gate Confirm on the upload
for personal-pay. For chargeback keep `pay-at-hotel` semantics but persist the
billing arrangement (see BI-11).

### BI-06 — `Permissions-Policy: microphone=()` blocks the intercom voice call in production
**Status:** **Fixed in `f20c0bb`** — header changed to `microphone=(self)` in
all three `vercel.json` files (root, guest-app, admin-app); camera and
geolocation remain fully locked. Needs a manual voice-call QA on a Vercel
preview deploy to confirm end-to-end (see Manual QA in INTERCOM-INBOX.md).
**File:** `guest-app/vercel.json`, root `vercel.json`, `admin-app/vercel.json` (all send `Permissions-Policy: camera=(), microphone=(), geolocation=()` on `/(.*)`)

An empty allowlist (`microphone=()`) denies the feature for **all** origins
including the page's own — `navigator.mediaDevices.getUserMedia({ audio: true })`
rejects with `NotAllowedError` without ever prompting. Consequences:
- Guest app: "Call Front Desk" always falls into the catch branch
  (`IntercomPage.tsx:639-648`) and shows the `tel:` fallback.
- Admin app: `acceptCall` (`AdminContext.tsx:1646`) throws, is caught, and the
  call is force-ended — staff can never accept.

The feature works in local dev (no headers), so this only fails where it
matters. Both `INTERCOM-GUEST.md §Voice Call` and `INTERCOM-INBOX.md` mark the
call flow `[x]` shipped.

**Fix:** change the header to `microphone=(self)` on both apps (guest app needs
it on `/intercom/*` at minimum; admin app on the dashboard). Keep camera and
geolocation locked.

---

## SEV-2 — Major (5)

### BI-07 — `corporateCodes.usageCount` never incremented on booking creation
**Status:** **Fixed in `bcb1b38`** — `handleCreateBooking` now writes
`usageCount + 1` back to the corporateCodes doc inside the same
transaction as the booking (using the looked-up ref so the
`code`-field-fallback path also targets the right doc); the
`handleConvertInquiryToBooking` path got the same fix per the audit's
explicit callout. The corporate-code re-validation now runs *before*
the increment, so a code that failed re-validation does not advance
its count.
**File:** `guest-app/server/handlers/bookings.ts:402-490` (create path), `guest-app/server/handlers/corporate-inquiries.ts:214-234` (convert path); spec `CORPORATE-BOOKING.md` ("`usageCount` … incremented server-side on successful booking")

The create transaction validates the code (active / expiry / cap via
`validateCorporateCode`) and applies the negotiated rate, but never writes
`usageCount + 1` back to the `corporateCodes` doc (contrast with the voucher
branch at `:451-454`, which does). Usage caps therefore never advance —
a capped code is effectively unlimited. `handleConvertInquiryToBooking` should
be checked for the same omission when fixing.

### BI-08 — `vouchers` and `corporateCodes` are world-readable via the client SDK
**Status:** **Fixed in `bcb1b38`** — `allow read: if true;` is now
`allow read: if isStaff();` on both collections. The validation
endpoints (`/api/validate/voucher`, `/api/validate/corporate-code`)
already return only the minimum data needed (discount type/value or
rate map) — the raw docs are no longer reachable from anonymous
clients. The admin app reads both via authenticated staff sessions.
`SECURITY.md` is updated to reflect the staff-only read scope.
**File:** `firebase/firestore.rules:81-101`; spec `SECURITY.md` (corporateCodes / vouchers sections)

`allow read: if true` on both collections lets any anonymous visitor run a
collection query and dump **every voucher code, discount value, usage cap,
corporate access code, company name, and negotiated `ratePerRoomType`**.
The whole point of `/api/validate/*` (per `GOTCHAS.md` "never expose full
voucher or code documents to the client") is defeated: promo codes are
discoverable without guessing, and negotiated corporate pricing (commercially
confidential per client) leaks. Guest-app code never reads these collections
client-side (verified), so the rules can be tightened without breakage.

**Fix:** `allow read: if isStaff();` on both. Run the
firebase-security-rules-auditor / emulator suite after (admin app reads them
via authenticated staff sessions).

### BI-09 — Regular flow: Step 2 "Number of guests" edits don't reach the submitted booking
**Status:** **Fixed in `bcb1b38`** — `updateGuestDetail("guestCount", ...)`
in `BookingPage.tsx` now also writes to the Step 1 `guests` state
(matching the corporate wiring at `CorporateBookingPage.tsx:1285-1288`),
so the Step 2 field is the single source of truth. The submit body
prefers the parsed Step 2 value and falls back to the Step 1 stepper
for guests who never reached Step 2. The sticky-bar total, aside, and
breakfast math now all see the same number.
**File:** `guest-app/src/pages/BookingPage.tsx:170-179, 522-545, 643-672`

Step 2 renders an editable, validated "Number of guests" field bound to
`guestDetails.guestCount`, and the summary aside displays that value — but the
create body, the breakfast total, and the member/voucher math all use the
separate `guests` state seeded from the Step 1 URL param. Editing the field
changes what the guest *sees* without changing what is *booked or charged*
(e.g. lower to 2 in Step 2 → aside says 2 guests, booking is created for 4 with
4-guest breakfast pricing). The corporate page wires it correctly
(`setGuests(Number(value) || 1)` at `CorporateBookingPage.tsx:1184-1187` and
submits `Number(guestDetails.guestCount) || guests`).

**Fix:** mirror the corporate wiring: sync `guests` from the Step 2 field (or
drop the Step 2 field and keep the Step 1 stepper as the single source).

### BI-10 — Corporate code silently downgraded at creation; doc-ID-only lookup
**Status:** **Fixed in `bcb1b38`** — (a) the corporate-code lookup
in `handleCreateBooking` now applies the same `code`-field fallback
as `handleValidateCorporateCode` so a code whose doc ID differs from
its `code` field is still found. (b) A code that fails re-validation
inside the transaction (expired / cap reached / deactivated between
gate and confirm) now throws a distinct `Corporate code no longer
valid: ...` error that the catch block maps to **409** so the client
can send the guest back to the gate. (c) The voucher create-time
lookup got the same `code`-field fallback; the voucher re-validation
itself stays silent (less critical than a deactivated corporate code).
The S1.5 source-pattern test in `batch-8-isCorporate-server-authoritative.test.ts`
was rewritten to assert the new throw-on-invalid contract.
**File:** `guest-app/server/handlers/bookings.ts:402-510` (corporate branch), `:535-595` (voucher branch), `:830-855` (catch); spec `CORPORATE-BOOKING.md §Edge Cases`

Two related issues:
1. When the code fails re-validation inside the transaction (expired / cap
   reached / deactivated between gate and confirm), the server **silently**
   books at the standard rate with `isCorporate: false`. The guest confirmed a
   negotiated total and gets charged the full rate with no error and no
   explanation (the confirm page just shows a bigger number). Spec requires a
   clear error instead.
2. The create-time lookup is `corporateCodes.doc(corporateCode)` only, while
   `/api/validate/corporate-code` also falls back to
   `where("code", "==", …)` for docs whose ID differs from their `code` field.
   A code that validates at the gate can therefore silently lose its rate at
   creation. Same doc-ID-vs-field asymmetry exists for vouchers
   (`vouchers.doc(formattedCode)` at `:417` vs the fallback in
   `handleValidateVoucher`).

**Fix:** on failed re-validation, abort the transaction with a distinct error
(mirroring "Room no longer available" → 409) so the client can send the guest
back to the gate; add the `code`-field fallback to both create-time lookups
(read outside/inside the txn consistently).

### BI-11 — Corporate Step 2 metadata dropped server-side
**Status:** **Fixed in `bcb1b38`** — the create handler now
persists a nested `corporate: { designation, companyAddress,
purposeOfStay, billingArrangement }` block on the booking doc when
`isCorporate: true` (omitted entirely for non-corporate bookings so
the schema doesn't drift with empty strings). `billingArrangement` is
normalized to `"personal"` or `"chargeback"` — the former requires a
payment proof, the latter triggers the LOU workflow
(`DECISIONS-FEATURES.md #99`). The `guestDetails` Zod schema
(BI-16, applied together) validates + trims + length-caps every
field, including `companyName` on the flat-rate path. The
`handleConvertInquiryToBooking` path persists the inquiry's
`specialRequirements` as `corporate.purposeOfStay` and forces
`billingArrangement: "chargeback"` (inquiries are always direct-bill).
`BACKEND.md §bookings` documents the new `corporate` block.
**File:** `guest-app/server/handlers/bookings.ts:66-109, 175-208, 736-770`; `guest-app/server/handlers/corporate-inquiries.ts:329-343`; spec `BACKEND.md` (`bookings/{bookingId}` table — `corporate` row)

The corporate flow collects and requires `designation`, `companyAddress`,
`purposeOfStay`, `preferredBillingArrangement` (personal vs chargeback), and —
on the flat-rate path — `companyName`. `handleCreateBooking` reads none of
them: `newBooking` has no such fields, and `companyName` comes exclusively
from the `corporateCodes` doc. Everything the guest typed in "Business
References" is discarded. Concretely: staff cannot tell a chargeback booking
(LOU workflow, `louReceived` tracking per decision #99) from a personal-pay
one, and flat-rate bookings have no company at all.

**Fix:** persist a `corporate: { designation, companyAddress, purposeOfStay,
billingArrangement }` block (or flat fields) on the booking doc when the
booking is corporate; store guest-entered `companyName` for the flat-rate path
(marked unverified). Update `BACKEND.md §bookings` accordingly.

---

## SEV-3 — Minor (7)

### BI-12 — Corporate flow defaults to hardcoded past dates; server accepts past check-ins
**Status:** Open
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:98-99` (`"2026-06-12"` / `"2026-06-14"`); `guest-app/server/handlers/bookings.ts:155-168` (no past-date check)

The corporate page seeds `checkIn`/`checkOut` with literal June 2026 dates
(already in the past). The regular page computes today/tomorrow. And because
`handleCreateBooking` validates only `checkOut > checkIn` (no "not in the
past" check), a corporate guest who never touches the date picker books a
completed-in-the-past stay. Fix both: dynamic defaults + a server-side
past-date rejection (with a small grace window for timezone skew).

### BI-13 — Wireframe placeholder copy shipped on Step 1
**Status:** Open
**File:** `guest-app/src/pages/BookingPage.tsx:1420`

Step 1 subheading reads: "Choose dates, guests, and a room option. **This is
static wireframe data shaped for the future booking context.**" — leftover
from the Phase 0.5 wireframe, visible to every guest.

### BI-14 — Corporate gate: "unlocked an extra 0% discount"
**Status:** Open
**File:** `guest-app/src/pages/CorporateBookingPage.tsx:691-693`

`discountPercent` is always set to 0 on successful validation (decision #101
made negotiated rates flat), but the verified-state copy still renders
"Code {code} unlocked an extra {discountPercent}% discount." → "an extra 0%
discount". Related dead code: the `discountPercent` rate math and the
"-{discountPercent}% Code" badge (`:890`, `:944-948`) can never display a
non-zero value. Replace with "Negotiated rate applied" per decision #101.

### BI-15 — Guest stepper hardcodes a max of 6 in both flows
**Status:** Open
**File:** `guest-app/src/pages/BookingPage.tsx:567`, `CorporateBookingPage.tsx:382` (`Math.min(Math.max(n, 1), 6)`)

The Step 1 guest stepper clamps at literal `6`. Room types are dynamic
(white-label rule: never hardcode room-shape values); a client with
8-capacity family rooms can't select 7-8 guests in Step 1. Clamp to the max
`maxCapacity` across active room types instead.

### BI-16 — `guestDetails` not schema-validated server-side
**Status:** Open
**File:** `guest-app/server/handlers/bookings.ts:146-153`; unused schema `shared/schemas/booking.ts` (`GuestDetailsSchema`)

`handleCreateBooking` checks only field presence + `consent`. Email format,
phone shape, and string lengths are unvalidated — a 100KB `requests` string or
a garbage email (breaks all booking emails) lands straight in Firestore. The
lookup/cancel endpoints got Zod schemas in BF-21; the create endpoint didn't.
Reuse/extend `GuestDetailsSchema` (note its field names differ —
`guestName` vs `firstName/lastName` — so it needs alignment) with `.trim()`
+ `.max()` caps.

### BI-17 — Idempotent-retry conflict surfaces as a raw error; guest loses their booking ref
**Status:** Open
**File:** `guest-app/server/handlers/bookings.ts:615-618` (`throw new Error("Booking already exists")` → 500), `guest-app/src/pages/BookingPage.tsx:756-772`

BF-03's existence check correctly prevents overwrites, but the retry UX is a
dead end: if the first request committed and the network response was lost,
the guest's retry (same preallocated `bookingId`) gets a 500 "Booking already
exists" and never learns their reference. Return the existing doc's
`bookingRef`/`totalPrice` as a `200 { alreadyExists: true }` (the server holds
the doc it just read) so the client can proceed to confirmation.

### BI-18 — Step 1 card totals ignore weekend rates
**Status:** Open
**File:** `guest-app/src/pages/BookingPage.tsx:1511-1521`

The per-type card totals (`roomOnlyTotal` / `breakfastTotal`) call
`calculateBookingTotal` with the flat `pricePerNight`, while the sticky-bar
total, the aside, and the server all walk nights with the weekend rate. For a
weekend-containing stay the card understates the price the guest is actually
charged. BF-08 fixed the aside but not the cards. (The corporate cards are
fine — corporate rates don't use weekend pricing.)

---

## SEV-4 — Nits & doc drift (5)

### BI-19 — Voucher usage not restored on cancellation
**Status:** Open
**File:** `guest-app/server/handlers/bookings.ts:451-454` (increment), `handleCancelBooking` (no decrement)

`usageCount` increments inside the create transaction but a cancelled booking
never releases the slot, so capped vouchers under-deliver. Decide policy
(restore on cancel vs burn on use) and document it in `VOUCHERS.md`.

### BI-20 — Honeypot fake response hardcodes the `SI-` prefix
**Status:** Open
**File:** `guest-app/server/apiRouter.ts:415`

The fake success ref is `` `SI-${year}0608-099` `` — hardcoded brand prefix
(white-label rule) and a 3-digit sequence that no longer matches the real
5-digit H3 format, which lets a careful bot fingerprint the honeypot. Use
`config.bookingRefPrefix` + a 5-digit sequence.

### BI-21 — Upload size/type limits not enforced client-side
**Status:** Open
**File:** `guest-app/src/pages/BookingPage.tsx:650-689`; spec `BOOKING-FLOW.md §Step 3` ("Accepts jpg/png/webp, max 5MB")

Discount-ID and payment-proof pickers rely on `accept="image/*"` and
`compressImageFile()`; there is no explicit 5MB / type check, and Storage
rules allow public writes on those paths, so an oversized or non-image file
is only caught (if at all) by compression failure. Add an explicit size/type
guard with a friendly error. Same applies to the intercom store-proof upload.

### BI-22 — Admin inbox lists message-less occupied rooms (spec drift)
**Status:** Open
**File:** `admin-app/src/pages/IntercomInboxPage.tsx:184-187`; spec `INTERCOM-INBOX.md §Edge Cases` ("Room has no messages yet — do not show in conversation list")

The thread list is `rooms.filter(room => room.status === "occupied" || intercoms[room.roomNumber])`,
so every occupied room appears even with zero messages. This is arguably
better (staff can initiate a greeting — the empty-state copy even says so),
but it contradicts the spec. Either update `INTERCOM-INBOX.md` to bless the
behavior or filter to rooms with messages.

### BI-23 — `staff-new-booking` dedup marker written before the send
**Status:** Open
**File:** `guest-app/server/handlers/bookings.ts:666-684`

The `emailNotificationsSent.staffNewBooking` timestamp is written **before**
`sendStaffNewBookingTrigger` runs; if Resend throws, the marker is already set
and the staff notification is permanently lost (no retry path will re-fire).
Write the marker after a successful send, or accept at-most-once and note it.

---

## What was verified as correctly wired

### Regular booking flow (guest-app `/book`)
- **Availability locking** matches `AVAILABILITY-LOCKING.md`: room-type
  transaction reads type entry → candidates sorted by `roomNumber` → per-room
  blocked-window + overlap checks → booking created atomically at the
  preallocated client ID; ref counter (`counters/bookings-{date}`) and 5-digit
  ref generated inside the transaction; idempotency existence check (BF-03).
- Step 1: live `settings/breakfastConfig` rates, "X of Y available" from the
  PII-stripped `/api/rooms/availability` endpoint (rate-limited 30/IP/min,
  status+checkIn index push-down), weekend-aware totals in the sticky bar/aside.
- Step 2: consent checkbox required + `/privacy` `/terms` links; Zod email
  validation; inline on-blur errors; back-navigation preserves state via URL
  params.
- Step 3: voucher validated via `/api/validate/voucher` with friendly error
  mapping; server re-validates + increments voucher usage in the transaction;
  discount ID + payment proof uploaded (compressed) to the preallocated
  `bookings/{bookingId}/…` paths before creation; discount-ID requirement
  enforced client **and** server side; honeypot field hidden with
  `position:absolute; opacity:0; pointer-events:none` (not `display:none`);
  Confirm disabled during uploads/submit; dynamic payment methods from
  `settings/hotelConfig.paymentMethods` with stale-selection fallback.
- Step 4: server-computed `totalPrice` displayed (BF-39); .ics download +
  Google Calendar link; payment-method-aware messaging; Spark Rewards prompt;
  friendly no-params empty state (BF-27).
- Server: member detection from optional `Authorization` header with
  infra-vs-auth error split (BF-32); stacking order Senior/PWD → voucher →
  member per decision #13b; `originalTotalPrice` for discount rejection
  (BF-05); `booking-submitted` + deduped `staff-new-booking` emails
  post-commit; 409 on conflict with client redirect to Step 1; conflict copy
  matches spec.
- `/api/bookings/lookup` + `cancel`: Zod input schemas, ref+email or
  `lookupToken` ownership, 404-backoff bucket (S2), case-insensitive email
  fallback, room-name enrichment, PII scope limited to the data subject.
- Firestore rules: guest client cannot read/create `bookings` (all creates via
  API); payments subcollection staff-only; storage payment-proof/discount-ID
  paths are staff-read/public-write as specced.

### Corporate booking flow (`/corporate/book`)
- Gate with access-code validation (`/api/validate/corporate-code`, friendly
  error mapping, sessionStorage persistence, "continue without code"), direct
  step-URL redirect back to the gate, persistent rate badge, dark header skin.
- Negotiated `ratePerRoomType` map honored per decision #101 with
  `corporateRate` fallback; vouchers hardcoded off per decision #100; LOU
  handled as an informational note per decision #99; corporate weekend-rate
  exemption on the server matches the client math.
- Server-side `isCorporate`/`companyName` derivation from the code doc (never
  trusts the body) per decision #79 — correct for the *coded* path (see BI-04
  for the flat-rate path).
- `/api/corporate/convert-inquiry` exists and is staff-gated (not re-audited
  in depth here; check BI-07's usageCount gap there too).

### Intercom (guest `/intercom/:roomId` + admin `/intercom`)
- Room resolution by doc ID, `roomNumber`, or `qrToken` with the specced
  invalid-QR error state; threads keyed by `roomNumber` consistently on both
  sides (checkout auto-archive in `handleCheckoutBooking` uses `roomNumber` —
  matches).
- Guest chat: name prompt (local state only), real-time `onSnapshot` with
  cleanup everywhere (guest page, admin per-room listeners, thread metadata,
  calls — all return unsubscribes), quick-request chips from
  `settings/hotelConfig.intercomQuickRequests` with defaults and hidden-when-
  empty, styled quick-request/store-order/cancelled bubbles, timestamps,
  offline banner, load-earlier pagination (50/+30), unread pulse on the Chat
  tab (spec's Phase-10 item — actually shipped; `INTERCOM-GUEST.md` checkbox
  can be flipped).
- Read receipts: guest marks front-desk messages read on view; admin
  `markChatAsRead` marks guest messages on thread open **and** re-marks live
  arrivals while focused; staff replies written with `isRead: true`.
- Admin inbox: Active/Resolved tabs backed by `intercoms/{room}.resolved`
  (guest messages reopen threads via `resolved: false` merge); resolve/reopen
  toggle; unread badges + dynamic `document.title` count; notification sound
  via Web Audio (buffer from `settings/hotelConfig.notificationSoundUrl`,
  unlock on first gesture, fires per new unread guest message and on incoming
  call, suppressed when the tab is focused, Bell/BellOff mute persisted in
  localStorage per decision #97, fails silently when unconfigured); store
  orders render as `StoreOrderMessageCard` with order linkage; mobile drawer
  layout per ADMIN-MOBILE.
- Voice call signaling: offer/answer + ICE subcollection per spec, 30s ring
  timeout, one-active-call-per-room guard, mute via `track.enabled`,
  second-call-wins supersede logic per decision #94, call-doc cleanup after
  30s grace per decision #98, `tel:` fallback when `getUserMedia` fails —
  everything correct **except** the production Permissions-Policy header
  (BI-06) which prevents `getUserMedia` from ever succeeding.
- Rules: `intercoms/**` and `calls/**` intentionally fully open per
  `BACKEND.md`; no PII pushed through chat by the system itself.

### Cross-cutting
- CORS allowlist + `Vary: Origin`, no credentials header (per decisions
  #106/#86); rate limits on every public endpoint (in-memory per instance —
  accepted for Phase 1 per `API-ROUTES.md`); honeypot returns silent fake
  success without reflecting bot input (BF-44); Vercel crons wired for
  `checkin-reminder` and `janitor/storage-sweep`; committed
  `guest-app/api/[...route].js` bundle present alongside the repo-root shim
  (per `VERCEL-FUNCTION-LIMIT.md`).

---

## Suggested fix batches

| Batch | Findings | Theme | Status |
|---|---|---|---|
| 1 (`fix/audit-bi-sev1`) | BI-01, BI-02, BI-03, BI-04, BI-05, BI-06 | All SEV-1: Turnstile real end-to-end, corporate pricing/proof, mic policy | **Fixed in `f20c0bb`** |
| 2 (`fix/audit-bi-sev2`) | BI-07, BI-08, BI-09, BI-10, BI-11 | All SEV-2: corporate flow correctness + rules tightening + input wiring | **Fixed in `bcb1b38`** |
| 3 | BI-12, BI-16 | Server-side input validation + past-date rejection | Open |
| 4 | BI-13, BI-14, BI-15, BI-17, BI-18, BI-19 … BI-23 | Copy, UX, nits, doc drift | Open |

## Status legend
- **Open** — no fix landed; the finding is reproducible on `dev` @ `c593560`.
- **Fixed in `<hash>`** — a commit referencing this doc closes the finding.
  (`f20c0bb` = `fix/audit-bi-sev1`, all six SEV-1 findings, VERSION 0.119.8.
  `bcb1b38` = `fix/audit-bi-sev2`, all five SEV-2 findings, VERSION 0.119.8.)
- **Verified** — re-checked and found already correct (none yet in this audit).
