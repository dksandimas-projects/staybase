# Booking Lookup
> App: guest-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Lookup

## Overview

The `/my-booking` page lets guests retrieve their booking using their booking reference number and the email address used at booking. No login required. Guests can view their booking status, cancel (if eligible), and resend their confirmation email.

---

## UI Checklist

- [ ] Lookup form — booking reference input + email input + Find My Booking button
- [ ] Booking result card — booking ref, room name, check-in / check-out dates, number of nights, number of guests, total amount, payment method, current status badge
- [ ] Status timeline — visual step indicator showing booking status flow (Pending → ... → Checked Out)
- [ ] Cancel booking button — shown only when status allows cancellation (see logic below)
- [ ] Cancellation confirmation modal — "Are you sure?" + optional cancellation reason input
- [ ] Resend confirmation email button — always shown on found booking
- [ ] "Back to search" link after finding booking

## Data & Logic Checklist

- [ ] Query `bookings` collection where `bookingRef == input` AND `guestEmail == input` — one-time fetch (`getDoc` / `getDocs`)
- [ ] Never return booking details if email does not match — security by obscurity for anonymous guests
- [ ] Cancellation allowed only when status is `"pending"` or `"payment-uploaded"` — not after payment confirmed
- [ ] Cancel action calls `/api/bookings/cancel` with `bookingRef` + `guestEmail` for server-side auth
- [ ] Cancellation sets status to `"cancelled"`, records `cancellationReason`, triggers `/api/email/booking-cancelled`
- [ ] Resend email calls `/api/email/booking-submitted` with existing booking data
- [ ] Rate and total display the values stored on the booking document — never recomputed

## Edge Cases & States

- [ ] Loading state — spinner while querying
- [ ] Not found — "We couldn't find a booking with those details. Please check your reference number and email."
- [ ] Already cancelled — show booking with cancelled status, hide cancel button
- [ ] Checked-out booking — show booking history, no actions available
- [ ] Cancellation fails server-side — show error, booking status unchanged
- [ ] Email resend rate-limited — show "Email already resent recently, please wait"

## Manual QA

- [ ] Valid ref + email returns correct booking details
- [ ] Wrong email for valid ref returns not found (never reveals booking exists)
- [ ] Status badge matches actual booking status in admin dashboard
- [ ] Cancel button hidden for confirmed/checked-in/checked-out bookings
- [ ] Cancellation modal requires confirmation before proceeding
- [ ] Cancelled booking reflects in admin dashboard immediately
- [ ] Cancellation email received by guest
- [ ] Resend email button sends confirmation email successfully

## References

- Booking schema and status flow: `docs/BACKEND.md §bookings`
- Cancel API route: `docs/API-ROUTES.md §bookings`
- Email triggers: `features/EMAIL-PDF-STORAGE.md`
- Admin cancellation flow: `features/BOOKINGS-MANAGEMENT.md`
