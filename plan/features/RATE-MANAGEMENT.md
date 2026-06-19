# Rate Management
> App: admin-app
> Phase: Phase 3 — Room System (W3.6: type-driven rate matrix)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Rate Management

## Overview

Admin-only page at `/rates` for managing all pricing and payment configuration. As of W3.6, the rate matrix (`pricePerNight` / `weekendRate` / `corporateRate`) and `maxCapacity` are owned by the **room type** (not the individual room) — see `settings/hotelConfig.roomTypes[]`. The Rates tab is the single edit surface for the rate matrix. Rate changes take effect for new bookings — existing bookings retain their locked rate.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

---

## UI Checklist

- [ ] Base rates section — one row per room type, rows generated dynamically from `roomTypes` context state (seeded from `DEFAULT_ROOM_TYPES` in `@spark-inn/shared`) — never hardcoded
- [ ] Weekend rates section — one row per room type (same dynamic list)
- [ ] Flat corporate rate section — one row per room type; note: "This is the public rate at `/corporate/book`. Custom rates are set per inquiry via access codes."
- [ ] All price inputs display `config.currencySymbol` prefix
- [ ] Each row also shows the type's `maxCapacity` (read-only here — edited in Settings → Room Types when creating the type)
- [ ] Save button writes one `updateRoomType(t.value, { pricePerNight, weekendRate, corporateRate })` per type; toast on save: "Rates saved — Rate matrix updated for all room types"
- [ ] Breakfast rate section — single rate per person per night input; note: "Rate applies to all room types. Guests × nights × rate = breakfast total."
- [ ] Discount rules section — Senior Citizen (20%) and PWD (20%) displayed as read-only (OSCA-mandated, not editable) with explanatory note. Also cross-reference: **Spark Rewards member discount** is configured separately in `settings/rewardsConfig.memberDiscountEnabled` + `memberDiscountPct` (see `plan/features/SETTINGS.md §11. Spark Rewards`); admins should treat the Rate Management page as the single source of truth for *all* stacking discount sources in use at the property.
- [ ] Payment methods section — list of payment methods with enable/disable toggle, QR code upload, account info text field per method
- [ ] Pay at Hotel toggle — global enable/disable
- [ ] Add payment method — allow adding custom method name + QR + account info
- [ ] Save button per section or global save
- [ ] Admin-only — front desk cannot access this page (see `plan/features/AUTH-ROLES.md`)

## Data & Logic Checklist

- [ ] All settings tabs fetch from `settings/hotelConfig` or `settings/websiteContent` on mount
- [ ] Photo uploads: Firebase Storage → `getDownloadURL` → store URL in Firestore
- [ ] Staff account creation: POST to `/api/admin/create-staff` (Vercel API route using Firebase Admin SDK)
- [ ] Staff account disable: POST to `/api/admin/disable-staff`
- [ ] Website content changes: `setDoc` (merge) on `settings/websiteContent`
- [ ] Hotel info changes: `updateDoc` on `settings/hotelConfig`
- [ ] **Rates stored on `settings/hotelConfig.roomTypes[].pricePerNight / weekendRate / corporateRate`** — read at the type level, not per room
- [ ] **Rate update: `updateRoomType(t.value, { pricePerNight, weekendRate, corporateRate })` — one update per type, no batch across rooms**
- [ ] **Max occupancy stored on `settings/hotelConfig.roomTypes[].maxCapacity`** — edited in Settings → Room Types when creating the type
- [ ] **Weekend rate logic: applied automatically in booking flow when stay includes Saturday or Sunday nights**
- [ ] **Discount rules: hardcoded 20% for Senior and PWD — stored in `settings/hotelConfig` for reference but not user-editable**
- [ ] **Payment methods: stored in `settings/hotelConfig.paymentMethods[]` — `updateDoc` on `settings/hotelConfig`**
- [ ] **QR code image: `uploadBytes` to Firebase Storage, `getDownloadURL`, stored in payment method `qrUrl`**
- [ ] **Rate changes do NOT retroactively update existing bookings — `ratePerNight` and `breakfastRate` both locked on booking creation**
- [ ] **Breakfast rate saved to `settings/breakfastConfig.ratePerPersonPerNight`**
- [ ] **Breakfast pricing model: add-on only** (per `DECISIONS-FEATURES.md #75`). Booking flow Step 1 toggles "Room Only" vs "Room + Breakfast"; the latter adds `breakfastRate × guests × nights` to the room total. No `includedInRoomRate` field on `breakfastConfig` — if a future client needs "breakfast always included" as a differentiator, add it then.
- [ ] **W3.6 migration (one-off backfill required for legacy data):** existing `rooms/{roomId}` docs may still carry `pricePerNight` / `weekendRate` / `corporateRate` / `maxCapacity`. These fields are no longer read by the app — the canonical values now live on each `roomTypes[].{pricePerNight, …, maxCapacity}`. To backfill: read the per-room values for a representative room of each type, then write a single `updateDoc` on `settings/hotelConfig` setting the matching `roomTypes[]` entry. After backfill, the per-room fields can be ignored (they are not deleted from existing docs to keep this PR a no-op migration).

## Edge Cases & States

- [ ] Loading state — skeleton while fetching current rates
- [ ] Save fails — show error, preserve unsaved values in form
- [ ] Rate set to 0 — warn staff ("Are you sure? This will show as free for guests.")
- [ ] QR upload fails — show error per method, allow retry
- [ ] All payment methods disabled — warn staff ("Guests will have no payment option.")
- [ ] Corporate rate lower than standard rate — allow, no warning needed

## Manual QA

- [ ] Update Standard Twin base rate — new rate appears on guest-facing room cards
- [ ] Update weekend rate — booking total reflects weekend rate for stays including Saturday/Sunday
- [ ] Update corporate rate — new rate appears on `/corporate/book` for flat-rate bookings
- [ ] Update rates — reflected in RoomsPage card "Base Rate" line and in the room detail modal
- [ ] Disable a payment method — method no longer appears in guest booking flow Step 3
- [ ] Upload QR code for GCash — QR displays correctly in guest booking flow
- [ ] Existing confirmed bookings unaffected by rate change (check `ratePerNight` field)
- [ ] Front desk account cannot access `/rates` — sees access denied

## References

- Room schema: `plan/docs/BACKEND.md §rooms` (note: `maxCapacity` and rates are no longer room fields)
- Room type schema: `plan/docs/BACKEND.md §settings/hotelConfig.roomTypes` (now owns photos + maxCapacity + rate matrix)
- TypeScript shape: `plan/docs/TYPES.md §RoomType` and `RoomTypeEntry` in `shared/constants`
- Room management: `plan/features/ROOM-MANAGEMENT.md` (creates/edits/deletes rooms; type is referenced by `value`)
- Weekend rate calculation: `plan/features/BOOKING-FLOW.md §Step 1`
- Corporate flat rate usage: `plan/features/CORPORATE-BOOKING.md`
- Auth guard: `plan/features/AUTH-ROLES.md`
