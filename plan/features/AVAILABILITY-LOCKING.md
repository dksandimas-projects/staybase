# Availability Locking
> App: both (enforced server-side)
> Phase: Phase 4 — Booking Flow (cross-cutting, enforced server-side)
> Requires: CLAUDE.md, docs/BACKEND.md, docs/API-ROUTES.md, docs/TYPES.md
> Design ref: N/A — backend logic only

## Overview

Prevents double-booking by using Firestore transactions for all booking creation. This is a critical safety feature — the client's prior Excel-based system had documented overbooking incidents. Every booking creation (online, walk-in, corporate) must go through a transaction-based API route. Never write bookings directly to Firestore from the client.

### Guest-side availability UX query (per W4.7)

The booking page shows date-aware availability in Step 1 (rooms hidden when they have an overlapping active booking). Because Firestore rules deny guest reads on `bookings` (`allow read: if isStaff()`), the client cannot subscribe to active bookings directly. Instead, the public endpoint `GET /api/rooms/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` returns a PII-stripped list of active booked date ranges (`{ roomId, checkIn, checkOut, status }`) for rooms whose stay overlaps the requested window. The client applies the overlap filter locally and hides those rooms.

This endpoint is rate-limited (30 requests / IP / minute) and is a UX optimization only — the authoritative double-booking prevention is the Firestore transaction in `/api/bookings/create` and `/api/bookings/create-walkin` described below. Never weaken Firestore rules to allow guest reads on `bookings`; the endpoint is the only sanctioned path.

---

## How It Works

1. Guest completes booking flow and hits Confirm
2. `guest-app` calls `/api/bookings/create` with booking data and a preallocated Firestore booking document ID
3. API route runs a Firestore transaction:
   - **Read:** query `bookings` for the selected room and date range — check for conflicts
   - **Write:** if no conflict, create the booking document atomically at the preallocated ID
   - **Fail:** if conflict found, transaction aborts — return conflict error to client
4. Client receives success or conflict error and responds accordingly

Transactions guarantee no two bookings can be created for the same room/dates simultaneously — even with concurrent requests.

The booking document ID and the public booking reference are different values. The client preallocates the Firestore document ID before Step 3 uploads so payment proof and discount ID files can be stored under `bookings/{bookingId}/...` before the booking document exists. The API still generates the guest-facing `bookingRef` inside the transaction to preserve uniqueness and ordering.

Staff-created walk-in bookings use the authenticated `/api/bookings/create-walkin` route, but the safety rule is the same: it must run the same conflict checks and reference counter write inside a Firestore transaction before creating the booking. This route exists only for front-desk/admin workflows that need staff auth, immediate check-in, onsite payment handling, and optional staff price override.

---

## UI Checklist

- [ ] Guest app: loading state on Confirm Booking button during API call
- [ ] Guest app: conflict error shown if room becomes unavailable between Step 1 and submission — "Sorry, this room is no longer available for your selected dates. Please go back and choose another room."
- [ ] Guest app: redirect back to Step 1 on conflict error
- [ ] Admin app (walk-in): same conflict error handling in booking creation modal

## Data & Logic Checklist

- [ ] Public online and corporate booking creation ALWAYS via `/api/bookings/create` — never direct Firestore write from client
- [ ] Staff walk-in/manual booking creation ALWAYS via authenticated `/api/bookings/create-walkin` — never direct Firestore write from admin client
- [ ] Online and corporate booking flows preallocate a Firestore booking document ID before uploads, then pass that exact ID to `/api/bookings/create`
- [ ] Transaction reads `bookings` where:
  - `roomId == selectedRoomId`
  - `status` NOT IN `["cancelled"]`
  - `checkIn < requestedCheckOut` AND `checkOut > requestedCheckIn`
- [ ] If any conflicting booking found → abort transaction, return `{ success: false, error: "Room no longer available" }`
- [ ] If no conflict → create booking document with all fields, return `{ success: true, data: { bookingId, bookingRef } }`
- [ ] Booking document created at the preallocated `bookingId` supplied by the client; never generate a different document ID inside the transaction
- [ ] Booking reference (`{config.bookingRefPrefix}-YYYYMMDD-NNN`) generated within the transaction to ensure uniqueness
- [ ] Walk-in bookings follow the same transaction checks via admin API call (with staff auth token)
- [ ] Corporate bookings follow `/api/bookings/create` with `isCorporate: true` — no bypass

## Edge Cases & States

- [ ] Two guests submitting for the same room/dates simultaneously — transaction ensures only one succeeds
- [ ] Room blocked between guest viewing availability and submitting — transaction catches this
- [ ] Network timeout during transaction — client receives error, booking NOT created (idempotent)
- [ ] Retry on network error — safe, transaction will either succeed or fail cleanly (no duplicates)
- [ ] Upload succeeds but booking transaction fails — no booking document is created; uploaded proof/ID objects are orphaned and staff-invisible until a future cleanup job removes unused preallocated paths
- [ ] Room status changes to "blocked" after Step 1 — transaction checks bookings, not room status directly; blocked rooms should also have an active blocking booking entry or status check added to transaction

## Manual QA

- [ ] Open two browser sessions, both on Step 3 for the same room/dates — submit simultaneously — only one booking created, other receives conflict error
- [ ] Room manually blocked in admin while guest is in booking flow — guest receives unavailability error on submit
- [ ] Walk-in booking in admin for dates that conflict with an online booking — authenticated API route returns conflict error and the modal shows it
- [ ] All created bookings have unique `bookingRef` values — no duplicates in Firestore

## References

- Booking creation API route: `plan/docs/API-ROUTES.md §bookings`
- Booking schema: `plan/docs/BACKEND.md §bookings`
- Firestore transaction pattern: `plan/docs/GOTCHAS.md §Firebase`
- Booking flow (guest): `plan/features/BOOKING-FLOW.md`
- Walk-in booking creation: `plan/features/BOOKINGS-MANAGEMENT.md`
