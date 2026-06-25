# Rooms Page
> App: guest-app
> Phase: Phase 3 — Room System
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Our Rooms

## Overview

The `/rooms` page is the public room type catalog. It renders one card per room type defined in `settings/hotelConfig.roomTypes[]` (falling back to `DEFAULT_ROOM_TYPES` from `@spark-inn/shared`), with a Book Now CTA on each card. The page has no filters, no date pickers, and no availability surface — every guest sees the full catalog in the same order. Date selection and availability checking live entirely in the booking flow at `/book` (Step 1) and the homepage availability checker's Search button now routes directly to `/book`. This page is the "browse all our room types" entry point (linked from the navbar and footer).

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

- [ ] Page hero — Apollo heading "Our rooms", brief subtitle that sets the expectation ("Browse every room type we offer, then pick your dates in the next step")
- [ ] No filter bar, no filter sidebar, no filter drawer, no mobile Filters button
- [ ] Type grid — responsive (1 col mobile, 2 col tablet, 3 col desktop) — one card per room type
- [ ] Room type card — image (from type), type label as title, bed definition (from type, W3.7), max capacity (from type, W3.6), key amenities (from type, W3.7), price per night (from type, W3.6), **no availability badge** (this is a static catalog, not a date-aware view), Details + Book Now CTAs
- [ ] Book Now CTA — navigates to `/book` (no query params). The booking flow's Step 1 collects dates and guests. No "Sold out" state on this surface.
- [ ] Room type detail modal — full description (from type, W3.7), all amenities (from type, W3.7), all photos carousel (from type), bed definition (from type, W3.7), capacity (from type, W3.6), price + weekend rate (from type, W3.6), "Book this type" CTA → `/book`
- [ ] Photo carousel in modal — multiple images, dots indicator, swipeable on mobile
- [ ] Framer Motion entrance animation on cards — subtle opacity + translateY on scroll
- [ ] Empty state — if the room type catalog is empty after Firestore loads: "No room types available right now" with a "contact us" nudge (this should never happen in practice, but the empty path is handled)

## Data & Logic Checklist

- [ ] Fetch room types via `useRoomTypes` (live `settings/hotelConfig.roomTypes[]` with `DEFAULT_ROOM_TYPES` fallback). No `useRoomAvailability` subscription. No `useRooms` consumption. No `bookings` collection reads from this page.
- [ ] Render every type from the catalog as a card — no `isActive` filter, no per-type active-room count, no date-overlap predicate
- [ ] Book CTA handoff: `PrimaryButton to="/book"` with no query params. The booking flow's `BookingPage.tsx` (Step 1) owns all date handling and falls back to `getTodayIso()` / `getTomorrowIso()` defaults if URL params are missing
- [ ] Modal "Book this type" CTA — same destination (`/book`) as the per-card Book CTA
- [ ] The page silently ignores any `?checkIn=...&checkOut=...&guests=...` URL params (no UI mention). These were the old homepage Search handoff params; the homepage Search button now navigates to `/book?...` directly so they shouldn't normally land on /rooms, but a guest who hand-crafts a /rooms URL with those params still gets the catalog view
- [ ] Per-room `pricePerNight` / `weekendRate` / `corporateRate` / `maxCapacity` are no longer in the data model (per W3.6) — values come from the joined `roomType` entry
- [ ] Per-room `bedDefinition` / `description` / `amenities` are no longer in the data model (per W3.7) — values come from the joined `roomType` entry
- [ ] Photo source — `roomType.imageUrls[]` (per `plan/features/SETTINGS.md §Room Type Photos`)

## Edge Cases & States

- [ ] Loading state — skeleton cards in grid layout (waits for `useRoomTypes` to resolve)
- [ ] Empty state — if `useRoomTypes` returns an empty list, show a single "No room types available right now" card with a "contact us" nudge instead of an empty grid
- [ ] Single image type — no carousel, just single hero photo in the modal
- [ ] Missing type photo — show brand placeholder ("Photo coming soon") on the card
- [ ] Homepage Search handoff — `HomePage.tsx searchAvailability` now navigates to `/book?checkIn=...&checkOut=...&guests=...` (not `/rooms?…`). Per-card Book on this page is the only `/book` entry from the rooms surface

> **Photos are resolved per room TYPE, not per room** *(per `plan/features/SETTINGS.md §Room Type Photos`)*. The hero image is the first entry of the joined `roomType.imageUrls[]` from `useRoomTypes`. The "Missing room photo" branch fires when the type's `imageUrls[]` is empty AND the static `ROOM_TYPE_IMAGES` fallback (in `guest-app/src/data/homepage.ts`) has no entry for that type.
>
> **Pricing + max occupancy are resolved per room TYPE** *(per W3.6 / `plan/features/RATE-MANAGEMENT.md §W3.6`)*. The card "Up to N guests" + "From ₱X" values come directly from the `roomType` entry. The detail modal's Capacity and Weekend fields are also type-driven.
>
> **Bed description, full description, and amenities are resolved per room TYPE** *(per W3.7 / `plan/features/ROOM-MANAGEMENT.md §W3.7`)*. The card's bed description line, the detail modal's full description block, and the amenity list all come from the joined `roomType`.

## Removed behavior (do not reintroduce)

The following behavior was intentionally removed in the catalog refactor and must NOT be re-added to this page:

- Filter sidebar (desktop) / filter drawer (mobile) with date range, guest count, and "Room type" picker
- Per-type "X of Y available" availability StatusBadge
- "Sold out for these dates" badge + disabled "Sold out" Book CTA
- `useRoomAvailability` hook (deleted — no callers)
- "Book selected dates" button in the hero section
- "X room types match your stay" result-count header
- "No room types match your filters" empty state with a "Reset filters" button

Date-aware availability + the date range picker live on `BookingPage.tsx` Step 1, not here. The rooms page is the catalog.

## Manual QA

- [ ] All room types in `settings/hotelConfig.roomTypes[]` display as cards (no per-room duplicates, no `isActive` filter)
- [ ] No filter UI on the page (no sidebar, no drawer, no Filters button on mobile)
- [ ] No availability badge or "Sold out" state on any card or in the modal
- [ ] Book Now CTA on each card navigates to `/book` with no query params
- [ ] Room type detail modal opens with all type data and closes on backdrop click / close button
- [ ] Photo carousel in the modal swipes on mobile
- [ ] Homepage availability checker → Search button lands on `/book?checkIn=…&checkOut=…&guests=…` (not `/rooms?…`)
- [ ] Direct navigation to `/rooms?checkIn=2026-12-01&checkOut=2026-12-03&guests=2` renders the catalog view (URL params silently ignored)
- [ ] Page loads in under 3s on 4G mobile

## References

- Room type definitions and schema: `plan/docs/BACKEND.md §rooms`
- Booking flow entry: `plan/features/BOOKING-FLOW.md`
- Room photo management: `plan/features/ROOM-MANAGEMENT.md`
- Design tokens: `plan/docs/FRONTEND.md`
- Homepage availability checker: `plan/features/HOMEPAGE.md`
