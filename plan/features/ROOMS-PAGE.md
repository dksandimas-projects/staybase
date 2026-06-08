# Rooms Page
> App: guest-app
> Phase: Phase 3 — Room System
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Our Rooms

## Overview

The `/rooms` page displays all active rooms in a grid. Guests can filter by room type and guest count, view real-time availability badges, and open a room detail modal before proceeding to book. This is the primary room discovery surface.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Back navigation never loses user input
- [ ] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [ ] Page hero — Apollo heading "our rooms", brief subtitle
- [ ] Filter bar — room type filter (All, Single, Standard Double, Standard Twin, Executive, Family) + guest count input
- [ ] Room grid — responsive (1 col mobile, 2 col tablet, 3 col desktop)
- [ ] Room card — image, name, type badge, bed definition, max capacity, key amenities, price per night, availability badge, Book Now CTA
- [ ] Availability badge — color-coded per `plan/docs/FRONTEND.md §Status Badge Colors` (Available green, Occupied red, Blocked gray)
- [ ] Room detail modal — full description, all amenities, all photos (carousel), bed definition, capacity, price + weekend rate, Book Now CTA
- [ ] Photo carousel in modal — multiple images, dots indicator, swipeable on mobile
- [ ] Book Now CTA — navigates to `/book?roomId=xxx&checkIn=xxx&checkOut=xxx` if dates selected, else to `/book`
- [ ] Framer Motion entrance animation on cards — subtle opacity + translateY on scroll

## Data & Logic Checklist

- [ ] Fetch all active rooms (`isActive: true`) via `onSnapshot` — real-time updates
- [ ] Filter rooms client-side by selected type and guest count (`maxCapacity >= numGuests`)
- [ ] Availability badge derived from room `status` field — not computed from bookings on this page
- [ ] Inactive rooms (`isActive: false`) never shown — filtered before render
- [ ] Availability checker params from URL query params (if navigating from Homepage checker) — pre-populate date pickers

## Edge Cases & States

- [ ] Loading state — skeleton cards in grid layout
- [ ] Empty state after filter — "No rooms match your filters" with reset option
- [ ] All rooms occupied — show all cards with Occupied badges, no hidden rooms
- [ ] Single image room — no carousel, just single photo
- [ ] Missing room photo — show brand placeholder with spark inn logo

## Manual QA

- [ ] All active rooms display correctly
- [ ] Filter by each room type works correctly
- [ ] Guest count filter hides rooms below capacity
- [ ] Real-time availability badge updates when room status changes (test in parallel tab)
- [ ] Room detail modal opens with all data, closes on backdrop click and close button
- [ ] Photo carousel swipes on mobile
- [ ] Book Now CTA carries correct room ID and dates to booking flow
- [ ] Page loads in under 3s on 4G mobile

## References

- Room type definitions and schema: `plan/docs/BACKEND.md §rooms`
- Booking flow entry: `plan/features/BOOKING-FLOW.md`
- Room photo management: `plan/features/ROOM-MANAGEMENT.md`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
