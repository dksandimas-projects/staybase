# Availability Locking
> App: both (enforced server-side)
> Phase: Phase 4 — Booking Flow (cross-cutting, enforced server-side)
> Requires: CLAUDE.md, docs/BACKEND.md, docs/API-ROUTES.md, docs/TYPES.md
> Design ref: N/A — backend logic only

## Overview

Prevents double-booking by using Firestore transactions for all booking creation. This is a critical safety feature — the client's prior Excel-based system had documented overbooking incidents. Every booking creation (online, walk-in, corporate) must go through the transaction-based API route. Never write bookings directly to Firestore from the client.

---

## How It Works

1. Guest completes booking flow and hits Confirm
2. `guest-app` calls `/api/bookings/create` with booking data
3. API route runs a Firestore transaction:
   - **Read:** query `bookings` for the selected room and date range — check for conflicts
   - **Write:** if no conflict, create the booking document atomically
   - **Fail:** if conflict found, transaction aborts — return conflict error to client
4. Client receives success or conflict error and responds accordingly

Transactions guarantee no two bookings can be created for the same room/dates simultaneously — even with concurrent requests.

---

## UI Checklist

- [ ] Guest app: loading state on Confirm Booking button during API call
- [ ] Guest app: conflict error shown if room becomes unavailable between Step 1 and submission — "Sorry, this room is no longer available for your selected dates. Please go back and choose another room."
- [ ] Guest app: redirect back to Step 1 on conflict error
- [ ] Admin app (walk-in): same conflict error handling in booking creation modal

## Data & Logic Checklist

- [ ] Booking creation ALWAYS via `/api/bookings/create` — never direct Firestore write from client
- [ ] Transaction reads `bookings` where:
  - `roomId == selectedRoomId`
  - `status` NOT IN `["cancelled"]`
  - `checkIn < requestedCheckOut` AND `checkOut > requestedCheckIn`
- [ ] If any conflicting booking found → abort transaction, return `{ success: false, error: "Room no longer available" }`
- [ ] If no conflict → create booking document with all fields, return `{ success: true, data: { bookingId, bookingRef } }`
- [ ] Booking reference (`{config.bookingRefPrefix}-YYYYMMDD-NNN`) generated within the transaction to ensure uniqueness
- [ ] Walk-in bookings follow the same transaction path via admin API call (with staff auth token)
- [ ] Corporate bookings follow the same path — no bypass

## Edge Cases & States

- [ ] Two guests submitting for the same room/dates simultaneously — transaction ensures only one succeeds
- [ ] Room blocked between guest viewing availability and submitting — transaction catches this
- [ ] Network timeout during transaction — client receives error, booking NOT created (idempotent)
- [ ] Retry on network error — safe, transaction will either succeed or fail cleanly (no duplicates)
- [ ] Room status changes to "blocked" after Step 1 — transaction checks bookings, not room status directly; blocked rooms should also have an active blocking booking entry or status check added to transaction

## Manual QA

- [ ] Open two browser sessions, both on Step 3 for the same room/dates — submit simultaneously — only one booking created, other receives conflict error
- [ ] Room manually blocked in admin while guest is in booking flow — guest receives unavailability error on submit
- [ ] Walk-in booking in admin for dates that conflict with an online booking — conflict error shown
- [ ] All created bookings have unique `bookingRef` values — no duplicates in Firestore

## References

- Booking creation API route: `plan/docs/API-ROUTES.md §bookings`
- Booking schema: `plan/docs/BACKEND.md §bookings`
- Firestore transaction pattern: `plan/docs/GOTCHAS.md §Firebase`
- Booking flow (guest): `plan/features/BOOKING-FLOW.md`
- Walk-in booking creation: `plan/features/BOOKINGS-MANAGEMENT.md`
