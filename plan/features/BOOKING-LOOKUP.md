# Booking Lookup
> App: guest-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Lookup

## Overview

The `/my-booking` page lets guests retrieve their booking using their booking reference number and the email address used at booking. No login required. Guests can view their booking status, cancel (if eligible), and resend their confirmation email.

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

- [x] Lookup form — booking reference input + email input + Find My Booking button
- [x] Booking result card — booking ref, room name, check-in / check-out dates, number of nights, number of guests, total amount, payment method, current status badge
- [x] Status timeline — visual step indicator showing booking status flow (Pending → ... → Checked Out)
- [x] Cancel booking button — shown only when status allows cancellation (see logic below)
- [x] Cancellation confirmation modal — "Are you sure?" + optional cancellation reason input
- [x] Resend confirmation email button — always shown on found booking
- [x] "Back to search" link after finding booking

## Data & Logic Checklist

- [x] Lookup goes through `POST /api/bookings/lookup` (ref + email verified server-side, PII-safe response, rate-limited) — the guest client never queries the `bookings` collection directly (Firestore rules deny guest reads; see `plan/docs/GOTCHAS.md`)
- [x] Never return booking details if email does not match — security by obscurity for anonymous guests
- [x] Cancellation allowed only when status is `"pending"` or `"payment-uploaded"` — not after payment confirmed
- [x] Cancel action calls `/api/bookings/cancel` with `bookingRef` + `guestEmail` for server-side auth
- [x] Cancellation sets status to `"cancelled"`, records `cancellationReason`, triggers `/api/email/booking-cancelled`
- [x] Resend email calls `/api/email/booking-submitted` for `pending`/`payment-uploaded` bookings or `/api/email/booking-confirmed` for confirmed/checked-in bookings, with a 60s client cooldown + server-side rate limit (3/ref/hour)
- [x] Rate and total display the values stored on the booking document — never recomputed

## Edge Cases & States

- [x] Loading state — spinner while querying
- [x] Not found — "We couldn't find a booking with those details. Please check your reference number and email."
- [x] Already cancelled — show booking with cancelled status, hide cancel button
- [x] Checked-out booking — show booking history, no actions available
- [x] Cancellation fails server-side — show error, booking status unchanged
- [x] Email resend rate-limited — show "Email already resent recently, please wait"

## Manual QA

- [x] Valid ref + email returns correct booking details
- [x] Wrong email for valid ref returns not found (never reveals booking exists)
- [x] Status badge matches actual booking status in admin dashboard
- [x] Cancel button hidden for confirmed/checked-in/checked-out bookings
- [x] Cancellation modal requires confirmation before proceeding
- [x] Cancelled booking reflects in admin dashboard immediately
- [x] Cancellation email received by guest
- [x] Resend email button sends confirmation email successfully

## References

- Booking schema and status flow: `plan/docs/BACKEND.md §bookings`
- Cancel API route: `plan/docs/API-ROUTES.md §bookings`
- Email triggers: `plan/features/EMAIL-PDF-STORAGE.md`
- Admin cancellation flow: `plan/features/BOOKINGS-MANAGEMENT.md`
