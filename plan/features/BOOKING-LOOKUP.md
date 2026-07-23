# Booking Lookup
> App: guest-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Lookup

## Overview

The `/my-booking` page lets guests retrieve their booking by entering **either** their booking reference number **or** the email address used at booking (one is enough — no login required). The third path, a per-booking `lookupToken` from a magic-link email or the `/account/stays` deep link, is also accepted by the server. Guests can view their booking status, cancel (if eligible), and resend their confirmation email.

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
