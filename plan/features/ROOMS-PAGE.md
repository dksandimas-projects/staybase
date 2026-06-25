# Rooms Page
> App: guest-app
> Phase: Phase 3 — Room System
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Our Rooms

## Overview

The `/rooms` page displays one card per active **room type** in a responsive grid, with a live count of how many rooms of that type are available for the selected dates. Guests can filter by room type and guest count, view date-aware availability badges, and open a room type detail modal before proceeding to book. The Book CTA pre-picks a specific room of the type and hands off to the existing booking flow. This is the primary room discovery surface.

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
- [ ] Filter bar — room type filter (All, Single, Standard Double, Standard Twin, Executive, Family) + guest count input + date range
- [ ] Type grid — responsive (1 col mobile, 2 col tablet, 3 col desktop) — one card per room type
- [ ] Room type card — image (from type), type label as title, bed definition (from type, W3.7), max capacity (from type, W3.6), key amenities (from type, W3.7), price per night (from type, W3.6), **availability count badge** ("X of Y available"), Book Now CTA
- [ ] Availability count badge — color-coded per `plan/docs/FRONTEND.md §Status Badge Colors` (green when at least 1 available, red/danger when 0 available for the selected dates)
- [ ] Room type detail modal — full description (from type, W3.7), all amenities (from type, W3.7), all photos carousel (from type), bed definition (from type, W3.7), capacity (from type, W3.6), price + weekend rate (from type, W3.6), availability count for the selected dates, Book Now CTA
- [ ] Photo carousel in modal — multiple images, dots indicator, swipeable on mobile
- [ ] Book Now CTA — navigates to `/book?roomId={firstAvailableRoomId}&checkIn=...&checkOut=...` (room is pre-picked from the type's available rooms). Disabled (label "Sold out") when no room of the type is available.
- [ ] Framer Motion entrance animation on cards — subtle opacity + translateY on scroll

## Data & Logic Checklist

- [ ] Fetch active room types via `useRoomTypes` (live `settings/hotelConfig.roomTypes[]`)
- [ ] Compute per-type availability via `useRoomAvailability(checkIn, checkOut, guests)` — joins live `rooms` + `bookings` collections and returns `{ total, available, firstAvailableRoomId }` per type
- [ ] Per-type availability counts are derived from the same date-overlap predicate as `BookingPage` (`bStart < reqEnd && bEnd > reqStart`) and the same booking status filter (`status != "cancelled"`)
- [ ] Hidden types: types with zero active rooms (`total === 0`) are filtered out before render
- [ ] Type filter (`selectedType`) hides all other types; "All Types" shows every type with at least one active room
- [ ] Guest count filter hides types whose `maxCapacity < guests`
- [ ] Sold-out types still render — the Book CTA is disabled and the availability badge shows "Sold out for these dates" / "0 of Y available"
- [ ] The Book CTA pre-picks `firstAvailableRoomId` and hands off to the booking flow with `?roomId=...` — the booking flow's existing per-room selection + availability logic is unchanged
- [ ] Inactive rooms (`isActive: false`) and blocked rooms (`status === "blocked"`) are excluded from the per-type totals
- [ ] Availability checker params from URL query params (if navigating from Homepage checker) — pre-populate date pickers

## Edge Cases & States

- [ ] Loading state — skeleton cards in grid layout (waits for both `useRoomTypes` and `useRoomAvailability` to resolve)
- [ ] Empty state after filter — "No room types match your filters" with reset option
- [ ] All types sold out for the selected dates — every card shows the disabled Book CTA; no cards are hidden
- [ ] Single image type — no carousel, just single hero photo
- [ ] Missing type photo — show brand placeholder ("Photo coming soon")
- [ ] Type with 0 active rooms — type is hidden entirely from the grid (consistent with the previous "inactive rooms hidden" behavior, just lifted to the type level)
- [ ] Default dates when no URL params are present — `getTodayIso()` / `getTomorrowIso()` (matches the booking flow's defaults so availability and the eventual handoff line up)

> **Photos are resolved per room TYPE, not per room** *(per `plan/features/SETTINGS.md §Room Type Photos`)*. The hero image is the first entry of the joined `roomType.imageUrls[]` from `useRoomTypes`. The "Missing room photo" branch fires when the type's `imageUrls[]` is empty AND the static `ROOM_TYPE_IMAGES` fallback (in `guest-app/src/data/homepage.ts`) has no entry for that type.
>
> **Pricing + max occupancy are resolved per room TYPE** *(per W3.6 / `plan/features/RATE-MANAGEMENT.md §W3.6`)*. The card "Up to N guests" + "From ₱X" values come directly from the `roomType` entry. The detail modal's Capacity and Weekend fields are also type-driven. Per-room `pricePerNight` / `weekendRate` / `corporateRate` / `maxCapacity` are no longer in the data model.
>
> **Bed description, full description, and amenities are resolved per room TYPE** *(per W3.7 / `plan/features/ROOM-MANAGEMENT.md §W3.7`)*. The card's bed description line, the detail modal's full description block, and the amenity list all come from the joined `roomType`. Per-room `bedDefinition` / `description` / `amenities` are no longer in the data model.

## Manual QA

- [ ] All active room types display correctly (one card per type, no per-room duplicates)
- [ ] Filter by each room type works correctly
- [ ] Guest count filter hides types below capacity
- [ ] Availability count updates when bookings are created or cancelled in a parallel tab
- [ ] Availability count updates when a room's `status` is changed (e.g. set to `blocked`) in a parallel tab
- [ ] Type with all rooms occupied for the selected dates shows "0 of N available" and the Book CTA is disabled
- [ ] Room type detail modal opens with all type data, closes on backdrop click and close button
- [ ] Photo carousel swipes on mobile
- [ ] Book Now CTA carries the pre-picked `roomId` + dates to the booking flow, and the booking flow lands on that room
- [ ] Page loads in under 3s on 4G mobile

## References

- Room type definitions and schema: `plan/docs/BACKEND.md §rooms`
- Booking flow entry: `plan/features/BOOKING-FLOW.md`
- Room photo management: `plan/features/ROOM-MANAGEMENT.md`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
- Date-overlap + booking status filter: `guest-app/src/pages/BookingPage.tsx`
