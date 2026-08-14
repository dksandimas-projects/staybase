# HISTORICAL ARCHIVE — GOTCHAS.md Incident Narratives (2026-08-14)

> **HISTORICAL ARCHIVE** — This document contains the full incident narratives that were previously embedded in `plan/docs/GOTCHAS.md` (the always-read agent contract). The active file has been compacted to one-line "lesson + rule" entries per CONTRIBUTING.md §Move out rule ("Branch/commit diaries, passing test logs, completed walkthroughs, and superseded proposals"). The original rule statements + the corrections stay in `GOTCHAS.md`; only the root-cause narratives + the multi-paragraph remediation walkthroughs moved here. For active rules, see [`plan/docs/GOTCHAS.md`](../docs/GOTCHAS.md). For the rules update lifecycle, see `plan/docs/CONTRIBUTING.md §When to Update Which MD`.

---

## Why this archive exists

Before 2026-08-14, `GOTCHAS.md` was structured as **"incident narrative → rule"** for every entry — the FOL-01 entry, for example, was ~700 words of operator-reported symptom + root cause + fix walkthrough followed by 3 lines of rule. The structural pattern worked when GOTCHAS.md was 5k tokens, but grew with each shipped audit (BF-44, BI-01..03, BI-08, BI-12, BI-17, INC-01, MRB-15-09, MRB-15-10, MRB-15-11, FOL-01, FOL-02, FOL-03, FOL-04, the 2026-07-06 booking-intercom audit, the 2026-07-17 E2E audit, the 2026-07-18 Spark Rewards audit, the 2026-08-03 follow-up audits, the 2026-08-06 test-discipline retrofit, the 2026-08-08 BAR audit, FOL-03 reschedule follow-up), bringing the file to ~43k bytes / ~10.7k tokens — 7% over the always-read ceiling of 10k.

The narrative carried three things: (1) the **operator-reported symptom** (useful for triage when the rule fires in a new context), (2) the **root cause** (useful for understanding why the rule is a rule and not just a convention), and (3) the **fix walkthrough** (mostly duplicates of the entry's `plan/docs/DECISIONS-FEATURES.md #N` record + the commit message). The compaction decision: keep the symptom + root cause inline as a one-line "lesson" (so a future agent hitting the rule can recognize the pattern), archive the full narrative.

This file preserves the verbatim text of every incident narrative that was in `GOTCHAS.md` as of 2026-08-14. If a future audit needs to re-add a narrative to the active file (e.g., a new operator hits the same shape of bug), the original text is here.

---

## BF-44 — Honeypot echo leaked preallocated booking ID

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-flow audit 2026-06-26 entry).

The pre-fix honeypot handler echoed `req.body.bookingId` if the bot supplied one — a real preallocated UUIDv4 was leaked back to the bot as part of the fake success. The handler now constructs a fresh `hp_<random>` ID inside the handler and never reflects the bot's input. The fake-success `bookingRef` echoes the configured prefix + a hardcoded date and counter so the bot's response shape is consistent with no real data present.

## BF-03 — Re-submit with same bookingId clobbered prior booking

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-flow audit 2026-06-26 entry).

The pre-fix transaction did not check for an existing booking at the preallocated ID before writing. A client retry (network timeout, user double-click) with the same `bookingId` would clobber the first booking's data. The fix reads the booking doc first inside the transaction and returns the existing `bookingRef` when the doc exists. Inverse follow-up: a future `reservationId` (MRB-02) plus a `requestFingerprint` is the deeper guarantee — the same `reservationId` + same `requestFingerprint` returns the original response (`idempotentReplay: true`); the same `reservationId` + a different `requestFingerprint` is a 409 conflict.

## BF-17 — Discount ID URL allowlist bypass

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (E2E audit 2026-07-17 entry).

A guest could submit a `discountIdPhotoUrl` pointing to any HTTPS URL (not the project's Firebase Storage bucket). The fix enforces a `storageUrlRefiner` (the URL must start with the configured storage bucket host) on the strict Zod schema. Pre-fix: the URL was written into the booking doc verbatim and the admin drawer fetched it as a signed-URL bypass. Post-fix: the URL is rejected at parse time before the transaction starts.

## BI-01 — Fake "verified" panel without a live Turnstile widget

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (booking-intercom audit 2026-07-06 entry).

The pre-fix intro page rendered a CSS-styled "you are verified" panel with no actual Turnstile widget behind it. A bot could skip the widget entirely. The fix renders the widget through `useTurnstileToken` with `enabled: true` on every public form, and the visible "verified" panel is only rendered after the hook callback fires with a real token.

## BI-02 — Client-side `|| "mock_token"` fallback bypassed Turnstile

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (booking-intercom audit 2026-07-06 entry).

The pre-fix client posted `turnstileToken: turnstileToken || "mock_token"` to the verification endpoint. The server's `verifyTurnstile` accepted the sentinel as a pass in non-test environments. Every bot gate was decorative. The fix removes the client-side fallback entirely and the server rejects `mock_token` outside `NODE_ENV === "test"`. Local dev needs no bypass: non-production origins verify against Cloudflare's always-pass test secret.

## BI-03 — Turnstile widget ref null in step-gated forms

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (booking-intercom audit 2026-07-06 entry).

The pre-fix page rendered the Turnstile widget inside a `useEffect` with `[]` deps. The container div was conditionally rendered (step-gated forms, loading skeletons), so the ref was null on first render and the effect bailed out — the widget never mounted. The fix renders the widget through `useTurnstileToken` with the `enabled` gate tied to the parent component's render state, so the widget is mounted when the parent's JSX reaches the render branch.

## BI-08 — Public read of `corporateCodes` exposed usage data

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (booking-intercom audit 2026-07-06 entry).

The pre-fix `POST /api/validate/corporate-code` endpoint included `usageCount` + `usageCap` + `expiresAt` in the response. Aby admin could enumerate code usage without being staff. The fix strips the response to `{ code, companyName, ratePerRoomType }` only. The Firestore rules also deny `corporateCodes` read to non-staff (the spy-path through collectionGroup).

## BI-12 — Corporate URL-seeded check-in in the past

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-intercom audit 2026-07-06 entry).

The pre-fix corporate booking page seeded check-in dates from URL params without past-date validation. A crafted link could submit a check-in in the past on the public path. The fix rejects any `checkIn < manilaToday` at the top of `handleCreateBooking`. Walk-ins are exempt (staff may backfill past stays for guests who forgot to register).

## BI-17 — 500 on retry after uncertain response

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-intercom audit 2026-07-06 entry).

The pre-fix transaction raised a generic 500 if the first POST failed mid-transaction and the client retried with the same `bookingId`. The fix returns the existing booking's data (with the existing `bookingRef`) when the doc is found at the preallocated ID. Inverse follow-up: the MRB-02 `reservationId` + `requestFingerprint` is the cleaner contract.

## INC-01 — Rules tightened before the client code shipped

**Original location:** `plan/docs/GOTCHAS.md §Firebase` (E2E audit 2026-07-17 entry).

Operator-reported 2026-07-17: guest online-payment bookings broke after a `firestore.rules` deploy that tightened Storage reads to `isStaff()` only. The pre-deploy app build still called `getDownloadURL` on the guest payment-proof object (the client-side API needed an authenticated Firebase Auth token). Until the new client build with the Admin-SDK signed-URL change shipped, every online-payment booking failed at Step 3. The fix is the procedure: **rules and client ship together, or rules ship second.** Tightened rules against an older deployed client silently break guest flows with `permission-denied` errors. Verify the live app build contains the matching client change before any rules deploy.

## X-01 — Granular `allow get: if true` next to staff-only `allow read`

**Original location:** `plan/docs/GOTCHAS.md §Firebase` (E2E audit 2026-07-17 entry).

The pre-fix Storage rules had `match /bookings/{bookingId}/payment-proof/{filename} { allow read: if isStaff(); allow get: if true; }` — the explicit `allow get` overrode the staff-only `allow read` and the payment-proof URLs were public. The same shape shipped on the discount ID path. The fix: **never add a granular `allow get: if true` (or `allow list`) next to a staff-only `allow read` in Storage rules** — allows are OR'd, so the public grant wins. The fix keeps the rule as `match /{path=**} { allow read, write: if isStaff(); }` and mints download URLs server-side with the Admin SDK for the staff-facing preview surface.

## C-01 — Dead room-doc fields silently price bookings at ₱0

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (E2E audit 2026-07-17 entry).

After W3.6/W3.7 moved `pricePerNight` / `weekendRate` / `corporateRate` / `maxCapacity` / `bedDefinition` / `description` / `amenities` from per-room docs to the `RoomType` entry in `settings/hotelConfig.roomTypes[]`, every read of those fields from `rooms/{id}` returned `undefined`. The walk-in handler was reading them from the room doc and pricing bookings at ₱0 + skipping capacity checks. The fix: **never read these fields from a room document** — always resolve the type entry (server: read `settings/hotelConfig` in the transaction; client: `useRoomTypes` helpers).

## G-01 — `guests` not validated → negative price math

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (E2E audit 2026-07-17 entry).

The pre-fix `/api/bookings/create` validated only the nested `guestDetails` object with a strict Zod schema but left the top-level `guests` count unvalidated. A negative or non-numeric value passed parse and reached the price math. The fix: **Zod-validate the entire request body with one strict schema** — `guests` is `z.number().finite().int().min(1).max(100)` and computed totals have a `Number.isFinite` guard before the booking write.

## G-02 — No max stay or advance window

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (E2E audit 2026-07-17 entry — fixed 2026-08-14).

The pre-fix server had no upper bound on `numNights` or the booking horizon. A guest could book a 365-night stay 5 years in advance, occupying inventory that no guest could reach. The fix enforces `MAX_STAY_NIGHTS = 30` and `MAX_ADVANCE_DAYS = 365` at the top of `handleCreateBooking` (constants in `shared/constants`). The walk-in handler is exempt from the advance-window check.

## HIGH-1 — Spark Rewards email-match without `email_verified`

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (Spark Rewards audit 2026-07-18 entry).

The pre-fix `linkBookingsByEmail` / `/api/members/stays` / `/api/email/early-checkin-request` `findBooking` matched `guestEmail == token.email` without checking `decodedToken.email_verified`. An attacker could register with a stranger's email (Firebase email/password signup lets the user claim any unverified address), then read the stranger's bookings (the stay projection leaks `bookingRef` + `lookupToken` = the public cancel credential) and act on them. The fix: **never match a booking to a member by the token's `email` claim without checking `email_verified` first**. Matching by `memberId == token.uid` is always safe.

## MED-1 — Manual `rewardsPoints` adjust bypasses `pointsHistory` invariant

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (Spark Rewards audit 2026-07-18 entry).

The pre-fix manual-adjustment path was a client-side Firestore transaction that updated `members/{uid}.rewardsPoints` directly. The `rewardsPoints` rule allowed `isStaff()` to write the field for the manual-adjustment UI, which meant a stray client write could set a balance with no `pointsHistory` entry — the `rewardsPoints == sum(pointsHistory.points)` invariant was broken. The fix: **never change `members/{uid}.rewardsPoints` without a coupled `pointsHistory` entry in the same transaction**. The preferred direction is to move manual adjustment server-side and lock `rewardsPoints` to Admin-SDK-only writes in `firestore.rules`; until then, the manual-adjustment transaction must contain both the `members` update and the `pointsHistory.add` inside one `runTransaction`.

## MED-3 — Staff-only `bookings` write without rate limit

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (Spark Rewards audit 2026-07-18 entry).

The pre-fix admin `bookings` write paths (status flips, payment recordings) had no rate limit. A staff token could be replayed. The fix: every staff-only write goes through the shared `bookings-*` rate-limit bucket (the apiRouter-level check), and the handler also re-checks the role for the admin-only paths.

## NEW-MED-1 — Cancel points-redeemed booking without paired restore

**Original location:** `plan/docs/GOTCHAS.md §Security & PII` (Spark Rewards re-audit 2026-08-14 entry).

The pre-fix cancel handler wrote the `cancelledAt` / `cancelledBy` / `cancellationSource` audit stamps + the per-child loyalty clawback (`clawback-${bookingId}`) but did NOT write a paired `restore-redemption-${bookingId}` `pointsHistory` entry. The member permanently lost their redeemed points because the `redeem-${bookingId}` entry's `-N` was stranded. The fix: **never cancel a points-redeemed booking without writing a paired `restore-redemption-${bookingId}` history entry**. The `guest-app/tests/api/mrb-15-09-redeem-cancel-pairing.test.ts` source-text test pins the cancel handler as the only legitimate restore site.

## FOL-01 — Payment-verified state lost on `payment-confirmed` → `confirmed` transition

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (FOL-01 entry, 2026-08-06).

Operator-reported 2026-08-06: "I received a new booking and I confirmed the payment and confirmed the booking but when I viewed the bookings page in the booking drawer folio, the payment was not confirmed, can you check why is this? there should be one source of truth right?" The pre-FOL-01 admin booking drawer's Folio + Overview "Pending" / "Verified" payment badges both read `status === "payment-confirmed"` directly — a transient state that doesn't survive the lifecycle move. The fix: **never read "is this thing done?" from a transient lifecycle state — use the durable signal**. The shared `isPaymentVerified(booking)` helper ORs the transient `status === "payment-confirmed"` axis with the durable `paymentConfirmedAt` timestamp.

## FOL-02 — Admin `bookings` mapper dropped 8 fields

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (FOL-02 entry, 2026-08-07).

The admin `bookings` mapper at `AdminContext.tsx:1335-1448` was missing 8 fields from the snapshot-to-state mapping: `reservationId` / `reservationRef` / `reservationPosition` / `reservationRoomCount` (the MRB-01 cluster), `onsitePayments` (the denormalized payment ledger), `paymentRejectionReason` / `paymentRejectedAt` / `paymentRejectedBy` (the rejection audit cluster). Each dropped field silently broke the read site that depended on it. The fix: **a Firestore snapshot hydration `useEffect` that maps to an extension of a shared type MUST preserve every field the contract guarantees**. The same shape as MRB-15-10 (room types).

## FOL-03 — Reads-after-writes in `runTransaction`

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (FOL-03 entry, 2026-08-07).

The pre-FOL-03 `handleCheckinBooking` and `handleCheckoutBooking` placed the `childrenForCount` read AFTER the writes that mutate the child statuses — the very thing the read needs to count. Firestore's `runTransaction` API enforces that a transaction body with any read landing AFTER any write throws the canonical error `Firestore transactions require all reads to be executed before all writes`. The fix: **in a `runTransaction`, all reads must complete before any writes**. The pattern is "pre-read + post-update construct" — every read completes first, the derived value is computed from the pre-read with a per-document ternary that injects the post-update state for the document being mutated. Same pattern applied to `handleRescheduleBooking` (2026-08-10 follow-up) and the BAR-03 helper.

## FOL-04 — Hardcoded payment-method labels

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (FOL-04 entry, 2026-08-07).

The pre-FOL-04 `BookingConfirmPage` and `BookingLookupPage` carried their own `paymentLabels` / `legacy` hardcoded label maps. Drift after admin rename + ugly raw keys for custom methods. The fix: **every guest-facing page that displays a payment-method label MUST source it from `settings/hotelConfig.paymentMethods[].label`, not from a hardcoded map**. The `resolvePaymentMethodLabel` helper is the single source of truth.

## MRB-15-09 — Staff-gated listener attached with stale token

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (MRB-15-09 entry, 2026-08-03).

The pre-MRB-15-09 `AdminContext` `subscribeToReservations` listener attached `onSnapshot(collection(db, "reservations"), ...)` after the auth gate at `onAuthStateChanged` validated the `role` claim, but the Firestore SDK uses its own cached ID token for the listener handshake. If the SDK's cache was one refresh behind the React `currentUser` state, the handshake landed with a stale token and the `isStaff()` rule on `/reservations/{id}` replied `Missing or insufficient permissions`. The fix: **always force-refresh the ID token before attaching a staff-gated `onSnapshot` listener**. The pattern applies to every staff-gated listener (`bookings` / `rooms` / `roomPrivate` / `roomBlocks` / `notifications` / `members` / `reservations`).

## MRB-15-10 — Room types hydration dropped 3 fields

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (MRB-15-10 entry, 2026-08-03).

The pre-MRB-15-10 room-types hydration `useEffect` silently dropped `maxChildren` / `maxExtraBeds` / `extraBedRate` from the mapping. Two visible symptoms: display bug (the table always showed `0`), save bug (opening Edit + saving without changes overwrote the stored value with `0`). The fix: **a Firestore snapshot hydration for any list-shaped collection must preserve EVERY field the contract guarantees**. Payment methods + booking sources already use a `normalize*` helper; room types should follow the same shape as the field count grows.

## MRB-15-11 — Photo gallery race on sequential uploads

**Original location:** `plan/docs/GOTCHAS.md §Auth & Security` (MRB-15-11 entry, 2026-08-04).

Operator-reported 2026-08-04: "in the admin settings, upload photos for room types, when I select more than 1 image for upload, it only uploads 1 image at a time and replaces the previously uploaded image." The pre-MRB-15-11 photo-gallery functions did a read-modify-write on the in-memory `roomTypes` state. Between the N sequential `await uploadRoomTypePhoto` calls, the subscription may not have fired yet, so the (N+1)th call read stale in-memory state and overwrote the array with a single-element array `[url(N+1)]`. 5 uploads → 5 overwrites of a single-element array → only the last URL survived. The fix: **for sequential per-item writes inside a `for...of await` loop, use `runTransaction` — never read from the in-memory React cache and write the full document**. The MAX cap check goes INSIDE the transaction.

## BF-04 — staff-new-booking email re-fire on retry

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (BF-04 entry, 2026-06-26).

The pre-BF-04 transaction re-fired the `sendStaffNewBookingTrigger` on every retry. Multiple emails arrived after a network blip. The fix: stamp `emailNotificationsSent.staffNewBooking: Date` on the first commit and guard the email send with `if (!alreadySent)`. The dedup marker is the second line of defense behind MRB-02's existence check.

## BF-29 — Replace one-way booking flow

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-flow audit 2026-06-26 entry).

The pre-fix booking flow assumed a single forward path. Confirming with a stale Turnstile token + missing consent silently submitted a partial booking. The fix: the `canConfirm` gate is the single gate that must be true for the POST to fire (Turnstile token + Step 2 consent + Step 3 terms + discount ID uploaded if discount + payment proof uploaded if non-pay-at-hotel + cart complete).

## CDS-01 — CORP/CRL handler wired to wrong receipt

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (per the 2026-08-11 follow-up fixing the receipt wiring for CRL-07).

Pre-fix: the CRL-07 destructive cancel handler routed the `booking-cancelled` email through the per-child legacy template regardless of reservation scope. Post-fix: the handler routes the email through `buildReservationEmailView` (per MRB-09) when the booking has a `reservationId` AND the reservation is being cancelled as a scope, and through the per-child template otherwise.

## BF-31 — Discount ID URL allowlist detail

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (E2E audit 2026-07-17 entry).

Same rule as BF-17 above; this entry captured the per-room selection schema's `discountIdPhotoUrl` validation. The strict Zod schema with `storageUrlRefiner` ensures the URL host matches the configured Firebase Storage bucket. The path validation (`isExpectedBookingUploadPath`) is the deeper guarantee.

## BF-20 — Step 3 review copy mismatch

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-flow audit 2026-06-26 entry).

The pre-fix Step 3 review showed the per-room `numAdults` / `numChildren` / `extraBedCount` from the cart selection, but the rate math at submit time read from the request body's top-level `numAdults` / `numChildren` / `extraBedCount`. A mismatch between cart and request was possible. The fix: the post-`MRB-06` request body has `roomSelections[]` carrying the per-room occupancy + extras, and the server reads only from there. The top-level `numAdults` / `numChildren` / `extraBedCount` are kept for back-compat but unused.

## CDT-01 — Cancellation policy copy stale

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (CRL-06 follow-up, 2026-08-11).

Pre-CRL-06 the `/my-booking` page and the cancel modal showed the operator-defined `websiteContent.cancellationPolicy` text but never cross-referenced the actual `reservationCancellationPolicySnapshot`. The fix: the preview modal renders the live snapshot's `refundPct` / `hoursRemaining` / `isBeforeCutoff` / `staffProcessingRequired` alongside the operator's policy copy. The operator's copy is the contract; the snapshot is the math.

## BF-32 — Stray discount ID upload outside the booking prefix

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (E2E audit 2026-07-17 entry).

The pre-fix `isExpectedBookingUploadPath` check was permissive — any path string under `bookings/{id}/...` passed. The fix narrows the prefix to `bookings/{bookingId}/discount-id/` + randomized filename, with the same shape for payment-proof. A stray `bookings/{id}/notes/...` upload is rejected.

## BF-39 — Honeypot success response leaked creation details

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (booking-flow audit 2026-06-26 entry).

The pre-fix honeypot success echoed the bot's `bookingDetails` + `voucherCode` back in the fake response. A bot could verify the message shape without triggering the real handler. The fix strips the response to a hardcoded shape with no relationship to the bot's input.

## CDT-02 — Cancellation preview shows "no refund" when refundPct > 0

**Original location:** `plan/docs/GOTCHAS.md §Booking Flow` (CRL-06 follow-up, 2026-08-11).

The pre-fix preview modal showed "No refund" when `refundPct === 0` even if the show-customer copy was "partial refund based on policy hours". The fix: the preview modal renders the policy's actual `refundPct` and the `policyRefund` amount, with the operator's `cancellationPolicy` text as the contract wording.

## Cross-cutting classification

The historical incident entries fall into 8 categories:

1. **Strict Zod schema enforcement** — FOL-01, FOL-02, FOL-03, FOL-04, G-01, G-02, BF-17, BF-31, BI-08, BI-12, BI-17, INC-01, X-01, C-01, the Field-must-be-preserved pattern (MRB-15-10, FOL-02, FOL-01)
2. **Idempotency + state transitions** — BF-03, BF-04, BI-17, MRB-02 (`reservationId` + `requestFingerprint`), the cancellation-lifecycle invariants (CRL-01..09)
3. **Auth tokens + listeners** — MRB-15-09, BI-08, HIGH-1, MED-1, MED-3, NEW-MED-1
4. **Bot gates** — BI-01, BI-02, BI-03, BF-44, BF-39, the honeypot pattern
5. **Data model moves** — C-01, W3.6/W3.7, FOL-02 (mapper drops), MRB-15-10 (field drops), MRB-15-11 (cache race)
6. **Pricing + rate semantics** — G-01, G-02, the per-room `revenueAllocation` invariant (MRB-11), the rate-breakdown persistence (MRB-14)
7. **Cancellation lifecycle** — CRL-01, CRL-07, CDT-01, CDT-02, the dual-source read pattern (legacy + new reservations)
8. **BAR + refactor follow-ups** — BAR-02, BAR-03, FOL-05 sibling-flip, the helper extraction pattern

The "active rules" that an agent needs to follow are still in `GOTCHAS.md`. The lessons + the rule application are still in the active file in one-line form. The "what happened, when, why" detail is here.

---

## Archive index (by commit + decision number)

| Incident | Commit | Decision | Date |
|---|---|---|---|
| BF-03, BF-04, BF-17, BF-20, BF-29, BF-31, BF-32, BF-39, BF-44 | booking-flow audit 2026-06-26 | #001..#005 | 2026-06-26 |
| BI-01, BI-02, BI-03, BI-08, BI-12, BI-17 | booking-intercom audit 2026-07-06 | #009..#015 | 2026-07-06 |
| INC-01, X-01, C-01, G-01, G-02 | E2E audit 2026-07-17 | #020..#030 | 2026-07-17 |
| HIGH-1, MED-1, MED-3 | Spark Rewards audit 2026-07-18 | #135..#138 | 2026-07-18 |
| MRB-15-09, MRB-15-10 | MRB-15 audits 2026-08-03 | #182, #183 | 2026-08-03 |
| MRB-15-11 | MRB-15 audits 2026-08-04 | #188 | 2026-08-04 |
| FOL-01 | FOL-01 fix 2026-08-06 | #197 | 2026-08-06 |
| FOL-02, FOL-03, FOL-04 | FOL audits 2026-08-07 | #200..#202 | 2026-08-07 |
| FOL-03 (reschedule) follow-up | fix/fol-03-reschedule-transaction-read-order 2026-08-10 | n/a | 2026-08-10 |
| CDT-01, CDT-02, CDS-01 | CRL-06 follow-up 2026-08-11 | #210, #211 | 2026-08-11 |
| NEW-MED-1 | Spark Rewards re-audit 2026-08-14 | #213 | 2026-08-14 |

For the verbatim commit messages + the original PR descriptions, see `git log --grep="<decision-number>"` on the `dev` branch.

---

## Re-activation rule

If a future audit finds that an agent is missing the *lesson* behind a rule (not just the rule itself), the relevant entry should be restored to `GOTCHAS.md` with a one-paragraph root-cause narrative (50-100 words, not 200-400). The full incident detail + the multi-paragraph fix walkthrough stays here. This is the "one-line lesson + rule" pattern the active file now uses.
