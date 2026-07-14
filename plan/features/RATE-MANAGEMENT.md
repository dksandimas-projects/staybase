# Rate Management
> App: admin-app
> Phase: Phase 3 — Room System (W3.6: type-driven rate matrix)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Rate Management

## Overview

Admin-only page at `/rates` for managing all pricing and payment configuration. As of W3.6, the rate matrix (`pricePerNight` / `weekendRate` / `corporateRate`) and `maxCapacity` are owned by the **room type** (not the individual room) — see `settings/hotelConfig.roomTypes[]`. As of W3.7, the same is true for `bedDefinition`, `description`, and `amenities` (see `plan/features/ROOM-MANAGEMENT.md §W3.7`). The Rates tab is one edit surface for the rate matrix; the **Settings → Room Types → Edit** modal is the other (and is more convenient for adjusting a single type's rates together with its bed / description / amenities). Rate changes take effect for new bookings — existing bookings retain their locked rate.

Planned post-launch enhancement: an Airbnb-style **Rate Calendar** for month-based room type × date pricing, multi-select seasonal rate edits, and holiday labels from seasonal overrides. See `plan/features/RATE-CALENDAR.md`.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## UI Checklist

- [x] Base rates section — one row per room type, rows generated dynamically from `roomTypes` context state (seeded from `DEFAULT_ROOM_TYPES` in `@spark-inn/shared`) — never hardcoded
- [x] Weekend rates section — one row per room type (same dynamic list)
- [x] Flat corporate rate section — one row per room type; note: "This is the public rate at `/corporate/book`. Custom rates are set per inquiry via access codes."
- [x] All price inputs display `config.currencySymbol` prefix
- [x] Each row also shows the type's `maxCapacity` (read-only here — edited in Settings → Room Types when creating the type)
- [x] Save button writes one `updateRoomType(t.value, { pricePerNight, weekendRate, corporateRate })` per type; toast on save: "Rates saved — Rate matrix updated for all room types"
- [x] Breakfast rate section — single rate per person per night input; note: "Rate applies to all room types. Guests × nights × rate = breakfast total."
- [x] Discount rules section — Senior Citizen (20%) and PWD (20%) displayed as read-only (OSCA-mandated, not editable) with explanatory note.
- ✅ **Senior/PWD online-booking toggle** *(owner request 2026-07-11 — see ROADMAP Phase 12)* — admin-only toggle in this section: `settings/hotelConfig.seniorPwdOnlineEnabled` (default **on**). Off = the guest booking flow (`/book` Step 3) hides the Senior/PWD selector + ID upload and shows a note directing eligible guests to claim the discount at check-in; server rejects/ignores `discountType` on online creates while disabled. **The 20% rate stays hardcoded and the walk-in/front-desk path stays always available — the toggle removes the online self-service path only, never the discount itself (RA 9994 / RA 10754 compliance).** Also cross-reference: **Spark Rewards member discount** is configured separately in `settings/rewardsConfig.memberDiscountEnabled` + `memberDiscountPct` (see `plan/features/SETTINGS.md §11. Spark Rewards`); admins should treat the Rate Management page as the single source of truth for *all* stacking discount sources in use at the property.
- [x] **Booking payment methods** are managed in Settings → Payment Methods (per `plan/features/SETTINGS.md §2 Payment Methods`), not on this page. A "Manage payment methods" link at the bottom of the page deep-links to `/settings?tab=payment` for convenience.
- [x] Save button per section or global save
- [x] Admin-only — front desk cannot access this page (see `plan/features/AUTH-ROLES.md`)

## Data & Logic Checklist

- [x] All settings tabs fetch from `settings/hotelConfig` or `settings/websiteContent` on mount
- [x] Photo uploads: Firebase Storage → `getDownloadURL` → store URL in Firestore
- [x] Staff account creation: POST to `/api/admin/create-staff` (Vercel API route using Firebase Admin SDK)
- [x] Staff account disable: POST to `/api/admin/disable-staff`
- [x] Website content changes: `setDoc` (merge) on `settings/websiteContent`
- [x] Hotel info changes: `updateDoc` on `settings/hotelConfig`
- [x] **Rates stored on `settings/hotelConfig.roomTypes[].pricePerNight / weekendRate / corporateRate`** — read at the type level, not per room
- [x] **Rate update: `updateRoomType(t.value, { pricePerNight, weekendRate, corporateRate })` — one update per type, no batch across rooms**
- [x] **Max occupancy stored on `settings/hotelConfig.roomTypes[].maxCapacity`** — edited in Settings → Room Types when creating the type
- [x] **Weekend rate logic: applied automatically in booking flow when stay includes Saturday or Sunday nights**
- [x] **Discount rules: hardcoded 20% for Senior and PWD — stored in `settings/hotelConfig` for reference but not user-editable**
- [x] **Payment methods: stored in `settings/hotelConfig.paymentMethods[]` and edited from Settings → Payment Methods (see `plan/features/SETTINGS.md §2`). `updateDoc` (or `setDoc` with merge) on `settings/hotelConfig`. QR code images: `uploadBytes` to Firebase Storage at `assets/payment-methods/{method}/{filename}`, `getDownloadURL`, stored in payment method `qrUrl`.**
- [x] **Seasonal rate overrides: stored on `settings/hotelConfig.seasonalRateOverrides[]`** — each override has name, inclusive date range, nightly rate, optional room-type scope, and active toggle. Overrides apply to new standard and walk-in bookings, beat weekend rates for matching nights, and do not apply to negotiated/flat corporate bookings.
- [x] **Rate changes do NOT retroactively update existing bookings — `ratePerNight` and `breakfastRate` both locked on booking creation**
- [x] **Breakfast rate saved to `settings/breakfastConfig.ratePerPersonPerNight`**
- [x] **Breakfast pricing model: add-on only** (per `DECISIONS-FEATURES.md #75`). Booking flow Step 1 toggles "Room Only" vs "Room + Breakfast"; the latter adds `breakfastRate × guests × nights` to the room total. No `includedInRoomRate` field on `breakfastConfig` — if a future client needs "breakfast always included" as a differentiator, add it then.
- [x] **W3.6 migration (one-off backfill required for legacy data):** existing `rooms/{roomId}` docs may still carry `pricePerNight` / `weekendRate` / `corporateRate` / `maxCapacity`. These fields are no longer read by the app — the canonical values now live on each `roomTypes[].{pricePerNight, …, maxCapacity}`. To backfill: read the per-room values for a representative room of each type, then write a single `updateDoc` on `settings/hotelConfig` setting the matching `roomTypes[]` entry. After backfill, the per-room fields can be ignored (they are not deleted from existing docs to keep this PR a no-op migration).

## Edge Cases & States

- [x] Loading state — skeleton while fetching current rates
- [x] Save fails — show error, preserve unsaved values in form
- [ ] Rate set to 0 — warn staff ("Are you sure? This will show as free for guests.")
- [x] Corporate rate lower than standard rate — allow, no warning needed

## Manual QA

- [ ] Update Standard Twin base rate — new rate appears on guest-facing room cards
- [ ] Update weekend rate — booking total reflects weekend rate for stays including Saturday/Sunday
- [ ] Update corporate rate — new rate appears on `/corporate/book` for flat-rate bookings
- [ ] Update rates — reflected in RoomsPage card "Base Rate" line and in the room detail modal
- [ ] Existing confirmed bookings unaffected by rate change (check `ratePerNight` field)
- [ ] Front desk account cannot access `/rates` — sees access denied

## References

- Room schema: `plan/docs/BACKEND.md §rooms` (note: `maxCapacity` and rates are no longer room fields)
- Room type schema: `plan/docs/BACKEND.md §settings/hotelConfig.roomTypes` (now owns photos + maxCapacity + rate matrix + bedDefinition + description + amenities)
- TypeScript shape: `plan/docs/TYPES.md §RoomType` and `RoomTypeEntry` in `shared/constants`
- Room management: `plan/features/ROOM-MANAGEMENT.md` (creates/edits/deletes rooms; type is referenced by `value`)
- Weekend rate calculation: `plan/features/BOOKING-FLOW.md §Step 1`
- Corporate flat rate usage: `plan/features/CORPORATE-BOOKING.md`
- Planned rate calendar: `plan/features/RATE-CALENDAR.md`
- Auth guard: `plan/features/AUTH-ROLES.md`
