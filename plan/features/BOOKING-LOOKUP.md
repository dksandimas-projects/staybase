# Booking Lookup
> App: guest-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Lookup

## Overview

The `/my-booking` page lets guests retrieve their booking by entering **either** their booking reference number **or** the email address used at booking (one is enough — no login required). The third path, a per-booking `lookupToken` from a magic-link email or the `/account/stays` deep link, is also accepted by the server. Guests can view their booking status, cancel (if eligible), and resend their confirmation email.

---

## Multi-Booking Picker (MBP, decision #123)

When a guest enters only their email (no ref, no token) and the email matches more than one booking, the page renders a **privacy-preserving picker** instead of silently showing the most-recent one. Repeat guests (the same person with multiple stays) and shared-email households (e.g. spouses who share an inbox) both benefit — repeat guests see all their stays at a glance, and shared-email users see exactly enough to pick the right booking without leaking anyone's identity.

### Two privacy modes — picked automatically by the server

The picker renders one of two layouts based on whether the matched bookings share the same `guestName` (trimmed, lowercased):

- **Single-name mode** (all matches have the same `guestName`) — almost certainly the same person. The picker shows: `bookingRef` + `checkIn/checkOut` + `numNights` + `roomType` (never `roomNumber` — the room-number-visibility rule still applies) + `status`. No folio, no payment method, no balance, no PII beyond the booking summary the guest already entered. Click a row → existing strict `ref + email` lookup → the standard single-booking card renders.
- **Multi-name mode** (mixed `guestName` across the matches) — almost certainly a shared email between two people. The picker shows the same row shape **minus** the `guestName` field, so neither party's name is disclosed to the other. Click a row → same strict `ref + email` lookup → standard card.

The picker never tells the guest which mode triggered. From the user's perspective, the experience is the same: a list of "this is a stay with us" cards sorted by date. The mode difference is invisible by design.

### Server contract — `kind` discriminator

`POST /api/bookings/lookup` adds a `kind` field to the response payload so the page can branch deterministically:

- `kind: "single"` + the existing booking fields — the **strict** paths (`ref + token`, `ref + email`, `ref alone`, `token alone`) and the email-alone path when only 1 booking matches. Identical to the current response shape except for the added `kind` field at the top level. Backward-compatible: the page reads `data.kind ?? "single"` so any older client still works.
- `kind: "list"` + `bookings: Array<{ id, bookingRef, guestName?, checkIn, checkOut, numNights, roomType, status }>` — the **email-alone** path when >1 booking matches. `guestName` is present in single-name mode and absent in multi-name mode (the omission is the privacy signal; the client never needs to know which mode it is).

The strict `ref + (email | token)` paths are **unchanged** and always return `kind: "single"`. The picker is only reachable through the email-alone path. The `ref + email` strict path also acts as the page's "deep link" — once a guest picks a row from the picker, the page re-queries with the selected ref + the email they originally typed, and that query flows through the strict path with no PII widening.

### Cap and "more exist" signal

`guest-app/server/handlers/bookings.ts` currently does `.where("guestEmail", "==", email).limit(50)` then sorts in memory by `createdAt desc`. The multi-booking path uses the same index with `.limit(11)` — the 11th row is the "more exist" sentinel, not displayed. The picker shows up to 10 rows; if `length >= 11`, a footer reads "10 most recent — contact us for older stays." At 14 rooms an email has at most a handful of bookings, so the cap is conservative.

For scale (when the combined ledger passes a few thousand rows, per FLR-03's trigger), switch to a `(guestEmail, createdAt desc)` composite index in `firebase/firestore.indexes.json` and replace the in-memory sort with `orderBy("createdAt", "desc").limit(11)`. The picker is built to upgrade to that path with no contract change.

### Privacy + RA 10173 stance

The email-alone path's existing privacy contract (one booking, not a list) was driven by the RA 10173 + shared-email concern: a stranger who knows another person's email must not be able to enumerate that person's booking history. The multi-booking picker preserves that contract by:

- **Cap at 10** (recent): even a single long-time guest has a finite surface; an attacker with their email cannot read 50+ years of stays.
- **No folio / balance / payment method** in the picker payload — only the same fields the guest already entered (email) plus the public booking summary (ref + dates + room type + status). No new PII is disclosed.
- **No `guestName` in multi-name mode** — neither party's name is revealed to the other.
- **Click → strict `ref + email` lookup** — the page never deep-links straight into a booking without re-running the auth check. The picker's "happy path" is the same auth path that protects every other guest action.
- **No email-existence oracle** — the same "Booking not found." / "No bookings with this email" reply (whichever copy the page uses) is returned whether the email has 0 matches, 1 match, or many. The page's "10 most recent — contact us for older stays" footer only shows when the picker actually renders, so it doesn't leak counts.

The 4-eyes pattern from the email-only path is unchanged: Turnstile + 10/min/IP rate limit + 3-failure 1-hour backoff still guard the entry point.

### UX Checklist (MBP)

- [x] Picker is reachable only via the email-alone path. Ref + email / ref + token / ref alone / token alone are unchanged.
- [x] Picker shows the same row fields the page already renders (ref + dates + room type + status). No new fields are added that could leak PII.
- [x] Single-name mode and multi-name mode look identical to the user (no badge, no copy difference).
- [x] Clicking a row re-queries with the selected ref + the original email, going through the strict `ref + email` path. No new auth path, no PII widening.
- [x] Back navigation: picker has a "Back to search" link that clears the picker state and re-shows the form with the email field pre-filled.
- [x] Deep linking: `?ref=...` on the lookup page pre-fills the form and, if it resolves, skips the picker.
- [x] "10 most recent — contact us for older stays" footer shows only when the cap is hit; the guest can still cancel / resend / re-find any of the 10 via the strict path.
- [x] Empty state preserved: 0 matches → existing "Booking not found" error; 1 match → existing single-booking card.
- [x] Loading state during the picker render: same skeleton as the existing single-booking path.

### Data & Logic Checklist (MBP)

- [x] `kind: "list"` response from `POST /api/bookings/lookup` when email matches >1 booking; `kind: "single"` otherwise.
- [x] Picker payload: `{ id, bookingRef, guestName?, checkIn, checkOut, numNights, roomType, status }` — `guestName` only when every match shares the same name.
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
- [x] All matches have the same `guestName`: single-name mode (rows include the name).
- [x] Matches have mixed `guestName`: multi-name mode (rows omit the name; the rest is identical).
- [x] Mixed-case `guestName` ("Maria Santos" vs "maria santos") — trim+lowercase before comparison.
- [x] Empty `guestName` on a legacy booking: treated as a single bucket ("all empty names match each other") — never as multi-name. A legacy booking never triggers the privacy-safe mode.
- [x] Guest picks a row, then hits Back: the picker re-renders with the same email pre-filled in the search form.
- [x] Guest picks a row, then refreshes: the URL carries `?ref=...` and the page deep-links straight to the strict `ref + email` lookup result.
- [x] Guest has 1 row + clicks it: the strict path returns that booking as `kind: "single"` and the page renders the standard card (no double-render of the picker).
- [x] Cancelled bookings appear in the picker with a "Cancelled" status badge (same as the card), so a guest who cancels one stay still sees it in the list.

### Manual QA (MBP)

- [x] Repeat guest with 2+ bookings under the same email + same name → picker renders full rows; clicking shows the right booking.
- [x] Shared email between 2 guests (mixed names) → picker renders privacy-safe rows (no name); clicking shows the right booking.
- [x] 11+ bookings under one email → picker shows 10 + "more exist" footer; the 11th is not displayed.
- [x] Mixed-case `guestName` ("Maria Santos" vs "maria santos") → treated as the same person (single-name mode).
- [x] Picker never appears when the guest enters a ref (alone or with email/token) — strict path always returns `kind: "single"`.
- [x] Back from a picked booking returns to the picker with the email pre-filled.
- [x] Cancel from a picked booking still works (the strict cancel endpoint requires `ref + email | token`; the picker passes through the same email it was opened with).
- [x] Rate-limit + 3-failure backoff still apply on the email-alone path (no new auth surface).

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
- [x] **Dispatch priority** (most-specific-first, so an attacker can't bypass a stricter check by adding an extra field): `ref + token` → `ref + email` → `ref alone` → `email alone` → `token alone`.
- [x] **Ref-alone path** queries `bookings where bookingRef == ref limit 1`. Refs are globally unique (`{prefix}-YYYYMMDD-NNN`), so a single match is the correct one. Enumeration is bounded by the 3-digit daily sequence (~1000 keys/day) + Turnstile + the 10/min rate limit + 3-failure 1-hour backoff. Per `plan/docs/SECURITY.md §Booking Lookup Security`.
- [x] **Email-alone path** queries `bookings where guestEmail == email limit 50`, then sorts in memory by `createdAt desc` and returns the most recent. The error message ("Booking not found.") is the same whether the email has no bookings or doesn't exist, so the endpoint is not an email-existence oracle. At 14 rooms an email has at most a handful of bookings; for scale, add a `(guestEmail, createdAt desc)` composite index and switch to `orderBy(...).limit(1)`.
- [x] **Cancel is stricter than lookup** — `ref + (email OR token)` is still required server-side. Destructive actions keep a second factor. The cancel modal reuses the email from the lookup response when available, so the UX is unchanged.
- [x] **Response payload is PII-safe** — never returns `paymentProofUrl`, `discountIdPhotoUrl`, `paymentProofPath`, `discountIdPhotoPath`, `lookupToken`, internal `notes`, or staff-only `remarks` (per BF-21 / RA 10173). The response is the same shape regardless of which key the caller used to look up.
- [x] Cancellation allowed only when status is `"pending"` or `"payment-uploaded"` — not after payment confirmed
- [x] Cancel action calls `/api/bookings/cancel` with `bookingRef` + `(guestEmail OR token)` for server-side auth
- [x] Cancellation sets status to `"cancelled"`, records `cancellationReason`, triggers `/api/email/booking-cancelled`
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
