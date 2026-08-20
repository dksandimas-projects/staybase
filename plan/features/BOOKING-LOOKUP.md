# Booking Lookup
> App: guest-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Lookup

## Overview

The `/my-booking` page lets guests retrieve their booking by entering **either** their booking reference number **or** the email address used at booking (one is enough — no login required). The third path, a per-booking `lookupToken` from a magic-link email or the `/account/stays` deep link, is also accepted by the server. Guests can view their booking status, cancel (if eligible), and resend their confirmation email.

---

## Multi-Booking Picker (MBP, decision #123) — shipped 2026-07-24; **tightened 2026-07-25 (decision #126) + 2026-07-25 (decision #128)**

When a guest enters only their email (no ref, no token) and the email matches more than one booking, the page renders a **privacy-preserving picker** instead of silently showing the most-recent one. Repeat guests (the same person with multiple stays) and shared-email households (e.g. spouses who share an inbox) both benefit — repeat guests see all their stays at a glance, and shared-email users see exactly enough to pick the right booking without leaking anyone's identity.

### One uniform row shape (decision #126 tightening)

The original MBP (decision #123) shipped with two auto-detected modes:

- **Single-name mode** — every match shares the same trimmed+lowercased `guestName`. The row included the name.
- **Multi-name mode** — mixed names. The row omitted the name.

On 2026-07-25 we closed a remaining leak: **even single-name mode revealed the full guest name to anyone with access to the email** (a spouse, an ex-partner, a shared family inbox). Decision #126 retired both modes and the `guestName` field on the wire. The row shape is now uniform regardless of how many distinct names sit behind the email:

```
{ id, bookingRef, maskedEmail, checkIn, checkOut, numNights, roomType, status }
```

- `maskedEmail` — first char of the local part + `***` + the full domain (e.g. `j***@gmail.com`). The attacker already typed this email so the leak surface is zero; for the legit user it's a small UX confirmation that the search keyed on the email they typed.
- `guestName` — **never on the wire from the picker**. The legit user has `bookingRef` + dates + room + status to disambiguate. The full name is still revealed on the **single-booking card** the page renders after the user picks a row, because by that point they've passed the existing `ref + email` second factor (decision #123's deep-link pattern).
- The earlier "single vs multi-name mode" branch is gone. There is no mode for the client to detect — the response shape is identical regardless of who the bookings are for. (This is also the cleanest path for the rate-limit oracle concern: fewer fields ⇒ fewer ways to differentiate replies.)

### Server contract — `kind` discriminator

`POST /api/bookings/lookup` adds a `kind` field to the response payload so the page can branch deterministically:

- `kind: "single"` + `{ id, bookingRef, maskedEmail, guestPhone, roomId, roomNumber, roomName, roomType, checkIn, checkOut, numNights, numGuests, ratePerNight, totalPrice, rateBreakdown, paymentMethod, status, hasBreakfast, specialRequests, paymentRejectionReason }` — every path that returns a single booking (strict or email-alone, 1 match or picker click). **`guestName` and `guestEmail` are NEVER on the wire** (decision #131). `maskedEmail` is always present (first char of local + `***` + full domain). The booking doc still stores both fields for staff-gated readers. Backward-compat: the page reads `data.kind ?? "single"` so any older client still works; the "Lead Guest" / name-echo sections are now gone entirely from the public page.
- `kind: "list"` + `bookings: Array<{ id, bookingRef, maskedEmail, checkIn, checkOut, numNights, roomType, status }>` — the **email-alone** path when >1 booking matches. `guestName` is **never** present (decision #126). `maskedEmail` is always present.

The strict `ref + (email | token)` paths are **unchanged** and always return `kind: "single"`. The picker is only reachable through the email-alone path. The `ref + email` strict path also acts as the page's "deep link" — once a guest picks a row from the picker, the page navigates to `/my-booking?ref=…&email=…` (URL-driven so the booking is bookmarkable + refreshable + shareable, and the Back button works), and the existing `useEffect` on `searchParams` re-queries with the selected ref + the email they originally typed through the strict path with no PII widening. **The Turnstile token is kept alive across the picker click** — `performLookup`'s `finally` block resets it only when the picker was NOT shown; the row click reuses the same token (Cloudflare `siteverify` is idempotent within the 300s validity window, and the existing 10/min rate limit + 3-failure 1-hour backoff still gate enumeration). **The search form is always mounted** (decision #130, the `hidden` class suppresses it when the picker or card is the active view) so the Turnstile widget's container div is a stable DOM node across picker/card transitions — clicking "Back to search" doesn't drop the widget, the token stays valid, the user can re-submit without re-solving the challenge.

### Cap and "more exist" signal

`guest-app/server/handlers/bookings.ts` currently does `.where("guestEmail", "==", email).limit(50)` then sorts in memory by `createdAt desc`. The multi-booking path uses the same index with `.limit(11)` — the 11th row is the "more exist" sentinel, not displayed. The picker shows up to 10 rows; if `length >= 11`, a footer reads "10 most recent — contact us for older stays." At 14 rooms an email has at most a handful of bookings, so the cap is conservative.

For scale (when the combined ledger passes a few thousand rows, per FLR-03's trigger), switch to a `(guestEmail, createdAt desc)` composite index in `firebase/firestore.indexes.json` and replace the in-memory sort with `orderBy("createdAt", "desc").limit(11)`. The picker is built to upgrade to that path with no contract change.

### Privacy + RA 10173 stance

The email-alone path's existing privacy contract (one booking, not a list) was driven by the RA 10173 + shared-email concern: a stranger who knows another person's email must not be able to enumerate that person's booking history. The multi-booking picker preserves that contract by:

- **Cap at 10** (recent): even a single long-time guest has a finite surface; an attacker with their email cannot read 50+ years of stays.
- **No folio / balance / payment method** in the picker payload — only the same fields the guest already entered (email) plus the public booking summary (ref + dates + room type + status + masked email echo). No new PII is disclosed.
- **No `guestName` or full `guestEmail` anywhere on the public `/my-booking` page** (decisions #126, #128, #131). The picker omits the name on every row regardless of single-name vs multi-name mode. The single-booking card omits the name AND the full email on every path (email-alone, ref+email, ref+token, ref alone, token alone) — the user always identifies the booking by `bookingRef` + dates + room + status, and the card surfaces a `maskedEmail` echo (e.g. `j***@gmail.com`) for the "yes, the search keyed on the email I typed" confirmation. The booking doc still stores `guestName` and `guestEmail` for staff-gated readers (drawer, table, PDF, email); the public lookup just stops reflecting them back.
- **Click → strict `ref + email` lookup** — the page never deep-links straight into a booking without re-running the auth check. The picker's "happy path" is the same auth path that protects every other guest action.
- **No email-existence oracle** — the same "Booking not found." / "No bookings with this email" reply (whichever copy the page uses) is returned whether the email has 0 matches, 1 match, or many. The page's "10 most recent — contact us for older stays" footer only shows when the picker actually renders, so it doesn't leak counts.

The 4-eyes pattern from the email-only path is unchanged: Turnstile + 10/min/IP rate limit + 3-failure 1-hour backoff still guard the entry point.

### UX Checklist (MBP)

- [x] Picker is reachable only via the email-alone path. Ref + email / ref + token / ref alone / token alone are unchanged.
- [x] Picker shows the same row fields the page already renders (ref + dates + room type + status + masked email echo). No new PII fields are added (decision #126: `guestName` was removed, `maskedEmail` carries no new info).
- [x] All rows look identical to the user (no badge, no copy difference). The single-name vs multi-name mode distinction was retired in #126.
- [x] Clicking a row re-queries with the selected ref + the original email, going through the strict `ref + email` path. No new auth path, no PII widening.
- [x] Back navigation: picker has a "Back to search" link that clears the picker state and re-shows the form with the email field pre-filled.
- [x] Deep linking: `?ref=...` on the lookup page pre-fills the form and, if it resolves, skips the picker.
- [x] "10 most recent — contact us for older stays" footer shows only when the cap is hit; the guest can still cancel / resend / re-find any of the 10 via the strict path.
- [x] Empty state preserved: 0 matches → existing "Booking not found" error; 1 match → existing single-booking card.
- [x] Loading state during the picker render: same skeleton as the existing single-booking path.

### Data & Logic Checklist (MBP)

- [x] `kind: "list"` response from `POST /api/bookings/lookup` when email matches >1 booking; `kind: "single"` otherwise.
- [x] Picker payload: `{ id, bookingRef, maskedEmail, checkIn, checkOut, numNights, roomType, status }` — `maskedEmail` always present, `guestName` never (decision #126).
- [x] Server uses `.limit(11)` and treats `length >= 11` as "more exist" (10th row is the last displayed; 11th is the sentinel).
- [x] Picker rows are sorted by `checkIn` desc (most-recent stay first). If two bookings share the same `checkIn`, secondary sort by `createdAt` desc.
- [x] Strict `ref + (email | token)` paths are unchanged.
- [x] Cancel / resend-email / register-member actions still go through their existing endpoints, each requiring `ref + (email | token)` (no widening).
- [x] No new Firestore composite index at 14 rooms; in-memory sort is bounded to 11 rows.
- [x] No new collection, no schema change.

### Edge Cases & States (MBP)

- [x] 0 matches: existing "Booking not found" — no list rendered.
- [x] 1 match: existing single-booking card (no list rendered; the page is identical to today's flow for this case).
- [x] 2–10 matches: picker renders N rows, no footer.
- [x] 11+ matches: picker renders 10 rows + "10 most recent — contact us for older stays" footer.
- [x] All matches: uniform row shape (decision #126). No `guestName` on any row, regardless of how many distinct names sit behind the email.
- [x] Every row carries a `maskedEmail` echo of the search key (e.g. `j***@gmail.com`). Same value on every row (the email is the search key).
- [x] Guest picks a row, then hits Back: the picker re-renders with the same email pre-filled in the search form.
- [x] Guest picks a row, then refreshes: the URL carries `?ref=...` and the page deep-links straight to the strict `ref + email` lookup result.
- [x] Guest has 1 row + clicks it: the strict path returns that booking as `kind: "single"` and the page renders the standard card (no double-render of the picker).
- [x] Cancelled bookings appear in the picker with a "Cancelled" status badge (same as the card), so a guest who cancels one stay still sees it in the list.

### Manual QA (MBP)

- [x] Repeat guest with 2+ bookings under the same email + same name → picker renders uniform rows (no name); clicking shows the right booking with the name on the single-booking card.
- [x] Shared email between 2 guests (mixed names) → picker renders identical rows (also no name, same shape); clicking shows the right booking.
- [x] 11+ bookings under one email → picker shows 10 + "more exist" footer; the 11th is not displayed.
- [x] Picker never appears when the guest enters a ref (alone or with email/token) — strict path always returns `kind: "single"`.
- [x] Back from a picked booking returns to the picker with the email pre-filled.
- [x] Cancel from a picked booking still works (the strict cancel endpoint requires `ref + email | token`; the picker passes through the same email it was opened with).
- [x] Rate-limit + 3-failure backoff still apply on the email-alone path (no new auth surface).
- [x] The masked email format renders cleanly across common cases (multi-char local, single-char local, subdomains).

### Open questions

- 🔴 **OQ-1.** Should the picker also show on the `/account/stays` (member-authenticated) page? Today `handleListMemberStays` returns a projection of all the member's stays, so the authed path is already list-shaped. MBP is only the public unauth path. (No — leave the authed path alone; the member is already authenticated and the contract is different.)
- 🔴 **OQ-2.** Should the picker support sorting (e.g. "most recent first" vs "upcoming first")? Default to upcoming-first feels right for a planning-minded guest. (Defer — "recent first" is the simpler MVP; revisit if the owner sees repeat guests asking.)

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Back navigation never loses user input
- [x] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [x] Lookup form — booking reference input + email input (either is enough) + Find My Booking button. A subtle "or" divider between the two fields makes the either-or affordance clear; the helper text above reads "Enter your booking reference or the email you used to book."
- [x] Booking result card — booking ref, room name, check-in / check-out dates, number of nights, number of guests, total amount, payment method, current status badge
- [x] Status timeline — visual step indicator showing booking status flow (Pending → ... → Checked Out)
- [x] Cancel booking button — shown only when status allows cancellation (see logic below)
- [x] Cancellation confirmation modal — "Are you sure?" + optional cancellation reason input
- [x] Resend confirmation email button — always shown on found booking
- [x] "Back to search" link after finding booking

## Data & Logic Checklist

- [x] Lookup goes through `POST /api/bookings/lookup` — the guest client never queries the `bookings` collection directly (Firestore rules deny guest reads; see `plan/docs/GOTCHAS.md`)
- [x] **Per `feat/relax-booking-lookup`:** the endpoint accepts any ONE of `bookingRef`, `guestEmail`, or `lookupToken`. The form lets the guest fill in either the ref or the email. The lookup token is wired through the existing email magic link + the `/account/stays` deep link.
- [x] **Per RFO-01 (decision #209, 2026-08-10):** the endpoint also accepts an optional `reservationRef` (regex `R-YYYYMMDD-NNNNN`); **a bare R- is accepted** with the same defense posture as the SI- `ref`-alone path (Turnstile + 10/min rate limit + 3-failure 1-hour backoff). The previous 400 reply (the original MRB-10 / decision #169 spec) was retired because the R- is the reservation's public identifier and the page's form copy reads "Enter your booking reference or the email you used to book". The form's ref input accepts both `SI-…` and `R-…`; the page's auto-lookup reads `?reservationRef=…&email=…` in priority over `?ref=…&token=…`. The N=1 + legacy per-child paths stay byte-equivalent.
- [x] **Dispatch priority** (most-specific-first, so an attacker can't bypass a stricter check by adding an extra field): `ref + token` → `ref + email` → `ref alone` → `email alone` → `token alone`.
- [x] **Ref-alone path** queries `bookings where bookingRef == ref limit 1`. Refs are globally unique (`{prefix}-YYYYMMDD-NNN`), so a single match is the correct one. Enumeration is bounded by the 3-digit daily sequence (~1000 keys/day) + Turnstile + the 10/min rate limit + 3-failure 1-hour backoff. Per `plan/docs/SECURITY.md §Booking Lookup Security`.
- [x] **Email-alone path** queries `bookings where guestEmail == email limit 50`, then sorts in memory by `createdAt desc` and returns the most recent. The error message ("Booking not found.") is the same whether the email has no bookings or doesn't exist, so the endpoint is not an email-existence oracle. At 14 rooms an email has at most a handful of bookings; for scale, add a `(guestEmail, createdAt desc)` composite index and switch to `orderBy(...).limit(1)`.
- [x] **Cancel is stricter than lookup** — `ref + (email OR token)` is still required server-side. Destructive actions keep a second factor. The cancel modal reuses the email from the lookup response when available, so the UX is unchanged.
- [x] **Response payload is PII-safe** — never returns `paymentProofUrl`, `discountIdPhotoUrl`, `paymentProofPath`, `discountIdPhotoPath`, `lookupToken`, internal `notes`, or staff-only `remarks` (per BF-21 / RA 10173). The response is the same shape regardless of which key the caller used to look up.
- [x] Cancellation allowed only when status is `"pending"` or `"payment-uploaded"` — not after payment confirmed
- [x] Cancel action calls `/api/bookings/cancel` with `bookingRef` + `(guestEmail OR token)` for server-side auth
- [x] Cancellation sets status to `"cancelled"`, records `cancellationReason`, triggers `/api/email/booking-cancelled`; **CRL-02 (2026-08-02)** stamps `cancelledAt` + `cancelledBy: "guest"` + `cancellationSource: "guest"` in the same transaction (no PII — the lookupToken / email are not stored on the booking). Server derives the source from the auth check; a client cannot forge `"system"` or `"staff"`. **CRL-06 (2026-08-02)** — the cancel button is shown for every pre-arrival status in the shared `GUEST_CANCELLABLE_STATUSES` matrix. Opening the modal first loads the credential-gated financial preview; paid cancellations complete without moving money automatically and clearly identify when staff processing remains required. The UI and server share the same matrix. **CRL-04 (2026-08-02)** — the guest confirm modal adds the explicit "No refund is issued automatically" line. The same line is in the `booking-cancelled` email's "What happens next" callout. **CRL-07 (2026-08-03)** — the post-cancel lookup card immediately reflects the new CRL-07 `cancellationLiability` snapshot: the "Refund summary" card shows the net collected at cancel, policy refund, retained under policy, approved, processed so far, outstanding, and current state (one of `not-required` / `pending-processing` / `partially-processed` / `processed` / `retained`). The same `liabilityBreakdownCard` helper the email + admin drawer use lives in `guest-app/src/components/CancellationPreviewPanel.tsx` (the data-testid `cancellation-preview-panel` is the source-text anchor for both apps). **CRL-08 (2026-08-03)** — when staff record a processed refund against the cancelled booking, the `booking-refund-processed` email fires (gated on the state-change condition so a sub-state partial does NOT re-send) and the lookup card re-projects on the next refresh.
- [x] Resend email calls `/api/email/booking-submitted` for `pending`/`payment-uploaded` bookings or `/api/email/booking-confirmed` for confirmed/checked-in bookings, with a 60s client cooldown + server-side rate limit (3/ref/hour)
- [x] Rate and total display the values stored on the booking document — never recomputed

## Edge Cases & States

- [x] Loading state — spinner while querying
- [x] Not found — "Booking not found." (identical message for any of the three keys, so the response is not a "did this email/ref/token exist?" oracle)
- [x] Empty form — "Please enter your booking reference or the email you used to book." (client-side guard, no API call)
- [x] Already cancelled — show booking with cancelled status, hide cancel button
- [x] Checked-out booking — show booking history, no actions available
- [x] Cancellation fails server-side — show error, booking status unchanged
- [x] Email resend rate-limited — show "Email already resent recently, please wait"
- [x] Guest enters both ref and email — endpoint uses the ref+email composite path (most specific)
- [x] Guest enters both email and token — rejected with 400 (email and token remain alternative auth modes, per H2)
- [x] Guest enters a well-formed but unmatched ref alone — 404, no information leak
- [x] Guest enters an unknown email alone — 404, same message as the ref case (no email-existence oracle)

## Manual QA

- [x] Valid ref + email returns correct booking details
- [x] Valid ref alone returns correct booking details (no email required)
- [x] Valid email alone returns the most recent booking under that email
- [x] Wrong email for valid ref returns not found (never reveals booking exists)
- [x] Status badge matches actual booking status in admin dashboard
- [x] Cancel button hidden for confirmed/checked-in/checked-out bookings
- [x] Cancellation modal requires confirmation before proceeding
- [x] Cancelled booking reflects in admin dashboard immediately
- [x] Cancellation email received by guest
- [x] Resend email button sends confirmation email successfully
- [x] Ref-alone enumeration: 3 consecutive misses park the IP in the 1-hour backoff bucket (per S2)

## References

- Booking schema and status flow: `plan/docs/BACKEND.md §bookings`
- Cancel API route: `plan/docs/API-ROUTES.md §bookings`
- Email triggers: `plan/features/EMAIL-PDF-STORAGE.md`
- Admin cancellation flow: `plan/features/BOOKINGS-MANAGEMENT.md`

---

## Reservation-Scope Guest Lookup (MRB-10) — shipped 2026-08-02
> Decision: `plan/docs/DECISIONS-FEATURES.md #169`. Server contract: `plan/docs/API-ROUTES.md §bookings lookup`. The /my-booking page renders a single card with the reservation header + a list of N room children when the looked-up booking is part of a multi-room reservation.

- **New `kind: "reservation"` response.** `handleLookupBooking` returns a `kind: "reservation"` payload (with a `rooms[]` array of per-stay projections: position + ref + type + occupancy + per-stay total + status + masked email) when the looked-up booking has a `reservationId` AND the reservation has N>1 children. N=1 falls through to the legacy `kind: "single"` path (byte-equivalent to the per-child view for N=1). Legacy pre-MRB-01 bookings (no `reservationId`) also stay `kind: "single"`.
- **Optional `reservationRef` input.** The `lookupSchema` accepts an optional `reservationRef` (regex `R-YYYYMMDD-NNNNN`) for direct reservation-scope lookups (the MRB-09 reservation-scope emails carry this in the footer). **Per the #209 audit amendment (2026-08-10, RFO-01 follow-up):** a bare R- is accepted with the same defense posture as the SI- `ref`-alone path — the page's form copy reads "Enter your booking reference or the email you used to book" and the R- is the reservation's public identifier (subject line + body header + receipt PDF filename), so the guest expects the R- to work without a second factor. The 99,999-key per-day namespace (5-digit sequence per `RESERVATION_REF_REGEX`) has the same enumeration risk as the SI- `ref`-alone path; the same defenses (Turnstile + 10/min rate limit + 3-failure 1-hour backoff) apply. The original MRB-10 spec (decision #169) called for a credential-required R- path, but the rationale ("~1k/day enumerable") was wrong — the 5-digit sequence widening in the H3 hardening batch raised the namespace to 99,999/day, identical to SI-. The handler also accepts a credential when one is supplied: an email-second-factor gate against `reservation.leadGuestEmail` (a stricter check; a mismatch returns the same 404 as not-found) or a token gate against the first child's `lookupToken` (the per-child magic link). The 404 reply is identical for the not-found / credential-mismatch / R- alone cases so the response is not an email-existence or ref-existence oracle.
- **R- ref is a first-class lookup input on the public surface (RFO-01, decision #209, shipped 2026-08-10 + audit amendment same day).** The page's auto-lookup `useEffect` reads `searchParams.get("reservationRef")` in priority over `searchParams.get("ref")` so the `?reservationRef=…&email=…` deep link from the MRB-09 email lands the guest on the page. The form's single ref input (label "Booking or Reservation Reference", placeholder `SI-20260612-042 or R-20260815-00012`) accepts both shapes; the submit handler runs `RESERVATION_REF_REGEX.test(trimmedRef)` from `@spark-inn/shared/utils/references` and routes the lookup to the server's `reservationRef` body key. **A bare R- is accepted without a second factor** — the form's header copy reads "Enter your booking reference or the email you used to book" and the R- is the reservation's public identifier (subject line + body header + receipt PDF filename), so the guest expects the R- to work alone. The server reads the reservation doc by `reservationRef`, hands the first child to `enrichAndRespond`, and returns `kind: "reservation"` (N>1) or `kind: "single"` (N=1). If the user did type an email, the server uses it as a second-factor gate against `reservation.leadGuestEmail` (a mismatch returns the same 404 as not-found). The 404 reply is identical for not-found / credential-mismatch / R- alone cases so the response is not an email-existence or ref-existence oracle. The legacy `?ref=<SI>&token=<token>` / `?ref=<SI>&email=<email>` / `?token=<token>` / `?email=<email>` paths are unchanged — N=1 bookings + legacy pre-MRB-01 bookings + the existing per-child magic links continue to work byte-equivalent. The `performLookup` signature gained a 4th optional `reservationRef` arg; the payload construction reads `reservationRef` first and falls through to the existing `ref + token` / `ref + email` / `ref alone` / `email alone` / `token alone` paths. See `guest-app/tests/api/rfo-01-reservation-ref-lookup-surface.test.ts` for the source-text contract (16 tests across the email's new `?reservationRef=…&email=…` branch + the page's auto-lookup + the form's R- regex route + the `performLookup` signature + the server's R- alone fall-through).
- **Privacy posture is unchanged from decisions #126 / #128 / #131.** The response never reflects the guest name back; `maskedEmail` (`j***@gmail.com`) is the only email-shaped field. The "Booking not found." reply is identical for zero / one / many matches so the response is not a name or email-existence oracle.
- **Cancel routes through `scope: "reservation"`** (per `plan/docs/DECISIONS-FEATURES.md #166` spec + `#170` implementation record / MRB-13). The cancel modal copy states the room count ("This will cancel all N rooms in your reservation.") + a per-room list so the guest can verify before confirming. The page sets `cancelPayload.scope = "reservation"` when `activeReservation` is set; the server's `handleCancelBooking` honours the flag (MRB-13 implementation). For the reservation-scope path the server runs ONE `runTransaction` that cancels every cancellable child + dedups voucher / corporate code `usageCount` decrements + runs the per-child MRB-05 loyalty clawback + updates the reservation header (`cancelledRoomCount` + `activeRoomCount` + `paymentStatus`); one `sendBookingTrigger("booking-cancelled-reservation", view)` fires after the commit. The existing `ref + (email | token)` credential is unchanged.
- **Resend fires the primary child's email.** The MRB-09 reservation-scope email templates are fired server-side on create; the resend endpoint is per-child. For MVP the resend fires the primary child's email — the per-child template now renders the full reservation view (per MRB-09), so the guest gets the same block layout on resend. A future "resend reservation email" endpoint (MRB-15 follow-up) can fire the active-state email.
- **UX Checklist (Reservation-Scope Lookup)**
  - [x] Single primary action: the page renders one card with the reservation header + a per-room list. There is no per-room expand/collapse — the card is intentionally compact.
  - [x] Loading state uses skeleton, not spinner.
  - [x] Validation is inline (on blur), not on submit.
  - [x] Every error state has a plain-language message and a next step — no dead ends.
  - [x] Back navigation never loses user input.
  - [x] Confirmation/success state feels celebratory, not just "OK".
  - [x] The cancel modal copy states the room count and a per-room list (per MRB-13 + the spec above).
  - [x] The resend button fires the primary child's email (per-child template renders the full reservation view per MRB-09).
- **Data & Logic Checklist (Reservation-Scope Lookup)**
  - [x] The `lookupSchema` accepts an optional `reservationRef` (regex `R-YYYYMMDD-NNNNN`) and requires a credential (email or token) when `reservationRef` is present.
  - [x] `handleLookupBooking` reads the reservation doc by `reservationRef` + the first child by `reservationPosition` + the credential against `leadGuestEmail` / first child's `lookupToken`.
  - [x] `enrichAndRespond` detects the looked-up booking's `reservationId` and routes to the `kind: "reservation"` branch when the reservation has N>1 children.
  - [x] The response shape is stable: `id` (reservation doc id), `reservationRef`, `maskedEmail`, `guestPhone`, `checkIn`, `checkOut`, `numNights`, `totalPrice`, `paymentMethod`, `status` (aggregate), `roomCount`, `activeRoomCount`, `cancelledRoomCount`, `rooms[]` (per-stay projections), `primaryBookingId`, `primaryBookingRef`. Cancel + resend use `primaryBookingRef` as the server credential.
  - [x] N=1 falls through to `kind: "single"` (byte-equivalent to pre-MRB-10 contract). Legacy pre-MRB-01 bookings (no `reservationId`) stay `kind: "single"`.
- **Edge Cases & States (Reservation-Scope Lookup)**
  - [x] N=1 (single-room reservation): the response is `kind: "single"`; the page renders the legacy single-booking card.
  - [x] N>1, all same type: every room is in the same `rooms[]` row; the per-stay total + ref are the only differentiators.
  - [x] N>1, mixed types: every room carries its own type + ref; the header shows the aggregate total + the room count.
  - [x] Bare `reservationRef` (no credential): 200 with the reservation view (or 404 if the R- doesn't exist). The defense is the same Turnstile + 10/min rate limit + 3-failure 1-hour backoff as the SI- `ref`-alone path. The 404 reply is identical to every other not-found case so the response is not a ref-existence oracle.
  - [x] Credential mismatch (wrong email or wrong token): 404 "Booking not found." (same reply for zero / one / many matches; not an email-existence oracle).
  - [x] Reservation header missing (data integrity bug): the handler falls through to the legacy `kind: "single"` shape.
- **References**
  - Server: `guest-app/server/handlers/bookings.ts §handleLookupBooking + §enrichAndRespond + §buildReservationLookupView`
  - Page: `guest-app/src/pages/BookingLookupPage.tsx §ReservationView + §ReservationRoom + §activeReservation + §handleCancelBookingSubmit (scope: "reservation")`
  - Tests: `guest-app/tests/api/mrb-10-reservation-lookup.test.ts` (20 source-text tests)
  - Decision: `plan/docs/DECISIONS-FEATURES.md #169`
  - Privacy contract: decisions #126 / #128 / #131 (no `guestName` reflected, `maskedEmail` only)

---

## Reservation-Scope Guest Cancellation (MRB-13)
> Decision: `plan/docs/DECISIONS-FEATURES.md #166`. Scope model + reservation-scope server transaction live in `plan/features/BOOKINGS-MANAGEMENT.md §Reservation-Scope Cancellation (MRB-13)`. The guest surface this section owns: the `/my-booking` cancel modal copy + body shape.

- **Guest scope is always whole-reservation.** The public `/my-booking` cancel modal always cancels the WHOLE reservation when the looked-up booking has a `reservationId`. There is no per-room scope selector on the public path — the verbatim MRB-13 spec is "Guest-facing cancellation defaults to the whole reservation and must state the room count." For a legacy null-`reservationId` booking, the existing single-room behavior is preserved.
- **Modal copy.** The cancel modal must state the room count ("This will cancel all N rooms in this reservation.") and a per-room list (room number + dates) so the guest can verify they're cancelling the right reservation before confirming. The existing CRL-04 "No refund is issued automatically" line stays verbatim.
- **Server body.** The cancel POST sends `scope: "reservation"` when the looked-up booking has a `reservationId`; otherwise the body omits `scope` and the server default `"room"` applies (byte-compatible legacy behavior). The existing `ref + (email | token)` credential is the auth surface and is unchanged.
- **No new public auth surface.** The server resolves `reservationId` from the child booking. A guest who can cancel one child of a reservation can cancel the whole reservation with the same credential; the credential gates entry to the reservation, not the unit of action. The existing rate limit + Turnstile + 3-failure 1-hour backoff still apply.
- **Email.** One `booking-cancelled-reservation` email for the whole reservation; the per-room break-up is in the email body. Per `plan/docs/DECISIONS-FEATURES.md #168` (MRB-09), the template renders a per-room table with the cancelled room marked as such and the surviving rooms (if any) marked Confirmed — so a partial cancel ("one room out of N cancelled at your request") reads naturally. The existing per-booking `booking-cancelled` template stays for the per-child path; the two never overlap at call time.
- **Picker interaction.** When the picker (MBP) renders and the guest picks a row, the strict `ref + email` lookup that follows returns the child booking as today; the cancel modal then sees the child's `reservationId` and renders the whole-reservation copy. The picker is not affected by MRB-13 — it still returns single-child rows; the reservation resolution happens at cancel time.
- **Edge cases.**
  - One-room reservation (post-MRB-01 with `reservationRoomCount === 1`): the modal copy degrades gracefully ("This will cancel your 1-room reservation."); the `scope` body field still rides as `"reservation"` for consistency, the server treats it the same as a one-child reservation cancel.
  - Reservation with a mix of `cancelled` and active children: the modal lists the active rooms only; already-cancelled rooms do not appear. The server's CRL-03 dual gate skips already-cancelled children in the transaction.
  - Reservation where every remaining child is in a terminal status that the guest can cancel (`payment-confirmed` / `confirmed`): the modal renders normally; the server cancels every cancellable child and the result is an empty reservation (header `activeRoomCount === 0`, `paymentStatus: "cancelled"`).
  - Paid pre-arrival reservation (`payment-confirmed` / `confirmed`): CRL-06 allows the guest to cancel after the modal shows net collected, policy refund, retained amount, and whether staff processing remains required. No refund is issued automatically.
  - Lookup returns a child whose `reservationId` no longer exists (orphaned header): the server returns a 500 `RESERVATION_HEADER_WITHOUT_CHILD` (matches the MRB-02.x create error shape), the modal surfaces a generic "We couldn't reach the booking service" error. This case is theoretical (Firestore writes inside the create transaction guarantee both docs exist) and is guarded for completeness.