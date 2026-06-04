# Rate Management
> App: admin-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Rate Management

## Overview

Admin-only page at `/rates` for managing all pricing and payment configuration. Sets base rates and weekend rates per room type, the public flat corporate rate, discount rules, and payment method setup. Rate changes take effect for new bookings — existing bookings retain their locked rate.

---

## UI Checklist

- [ ] Base rates section — one row per room type, rows generated dynamically from `config.roomTypes[]` — never hardcoded
- [ ] Weekend rates section — one row per room type (same dynamic list)
- [ ] Flat corporate rate section — one row per room type; note: "This is the public rate at `/corporate/book`. Custom rates are set per inquiry via access codes."
- [ ] All price inputs display `config.currencySymbol` prefix
- [ ] Breakfast rate section — single rate per person per night input; note: "Rate applies to all room types. Guests × nights × rate = breakfast total."
- [ ] Discount rules section — Senior Citizen (20%) and PWD (20%) displayed as read-only (OSCA-mandated, not editable) with explanatory note
- [ ] Payment methods section — list of payment methods with enable/disable toggle, QR code upload, account info text field per method
- [ ] Pay at Hotel toggle — global enable/disable
- [ ] Add payment method — allow adding custom method name + QR + account info
- [ ] Save button per section or global save
- [ ] Admin-only — front desk cannot access this page (see `features/AUTH-ROLES.md`)

## Data & Logic Checklist

- [ ] Rates stored on `rooms/{roomId}` documents — `pricePerNight`, `weekendRate`, `corporateRate`
- [ ] Rate update: `updateDoc` on each room of the selected type — batch update across all rooms of that type
- [ ] Weekend rate logic: applied automatically in booking flow when stay includes Saturday or Sunday nights
- [ ] Discount rules: hardcoded 20% for Senior and PWD — stored in `settings/hotelConfig` for reference but not user-editable
- [ ] Payment methods: stored in `settings/hotelConfig.paymentMethods[]` — `updateDoc` on `settings/hotelConfig`
- [ ] QR code image: `uploadBytes` to Firebase Storage, `getDownloadURL`, stored in payment method `qrUrl`
- [ ] Rate changes do NOT retroactively update existing bookings — `ratePerNight` and `breakfastRate` both locked on booking creation
- [ ] Breakfast rate saved to `settings/breakfastConfig.ratePerPersonPerNight`

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
- [ ] Disable a payment method — method no longer appears in guest booking flow Step 3
- [ ] Upload QR code for GCash — QR displays correctly in guest booking flow
- [ ] Existing confirmed bookings unaffected by rate change (check `ratePerNight` field)
- [ ] Front desk account cannot access `/rates` — sees access denied

## References

- Room schema (rate fields): `docs/BACKEND.md §rooms`
- Settings schema (payment methods): `docs/BACKEND.md §settings/hotelConfig`
- Weekend rate calculation: `features/BOOKING-FLOW.md §Step 1`
- Corporate flat rate usage: `features/CORPORATE-BOOKING.md`
- Auth guard: `features/AUTH-ROLES.md`
