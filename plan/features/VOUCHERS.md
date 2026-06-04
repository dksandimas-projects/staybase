# Vouchers
> App: admin-app (management) + guest-app (redemption)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, features/BOOKING-FLOW.md
> Design ref: spark-inn-design-spec.md §Vouchers

## Overview

Promo vouchers allow staff to create discount codes redeemable during the guest booking flow at Step 3. Vouchers support percentage or flat ₱ discounts with optional usage caps, expiry dates, and room type restrictions. Management lives in Settings. Redemption calls a server-side validation API to prevent abuse.

---

## Admin UI Checklist (within Settings)

- [ ] Vouchers list — table of all vouchers: code, discount type, value, usage (used/cap), expiry, status badge (Active/Inactive/Expired)
- [ ] Create voucher form — code (unique), discount type (% or ₱), discount value, usage cap (optional), expiry date (optional), applicable room types (all or multi-select)
- [ ] Enable / disable toggle per voucher
- [ ] Usage stats — used count vs. cap displayed per voucher row
- [ ] Expired vouchers shown in list with visual distinction (muted/greyed)
- [ ] Both Admin and Front Desk can create and manage vouchers

## Guest UI Checklist (Booking Flow Step 3)

- [ ] Voucher code input field + Apply button
- [ ] Loading state while validating
- [ ] Success state — "Code applied: -₱500" or "-20%" with updated total
- [ ] Error states — invalid code, expired, usage limit reached, not applicable to selected room type
- [ ] Remove applied voucher option — "Remove" link next to applied voucher
- [ ] Only one voucher can be applied at a time

## Data & Logic Checklist

- [ ] Voucher creation: `addDoc` to `vouchers` collection
- [ ] Voucher validation (guest): calls `/api/validate/voucher` — server-side checks: exists, `isActive`, not expired, under usage cap, room type match
- [ ] Validation response: returns `{ valid: true, discountType, discountValue }` or `{ valid: false, reason }`
- [ ] `usageCount` increment: happens server-side at booking creation (`/api/bookings/create`) — not at validation time
- [ ] `voucherCode` and `voucherDiscount` stored on booking document
- [ ] Discount calculation: percent voucher applies to total after senior/PWD discount; flat voucher subtracts fixed amount; total never goes below ₱0
- [ ] Voucher and senior/PWD discount can stack — apply senior/PWD first, then voucher
- [ ] `applicableRoomTypes: []` (empty) means applies to all room types

## Edge Cases & States

- [ ] Voucher used up between validation and booking creation — server re-validates at creation, returns error
- [ ] Voucher expires between validation and booking creation — same handling
- [ ] Duplicate voucher code on creation — show error "Code already exists"
- [ ] Flat discount exceeds total — total set to ₱0, not negative
- [ ] Voucher deactivated by admin while guest is in booking flow — server-side catch at creation

## Manual QA

- [ ] Create percent voucher (20%) with usage cap of 5 — validate and apply in booking flow
- [ ] Create flat voucher (₱500) for Standard Twin only — verify it rejects other room types
- [ ] Apply voucher in Step 3 — total updates correctly
- [ ] Use voucher to cap — 6th attempt returns "usage limit reached"
- [ ] Expired voucher returns correct error
- [ ] Disable voucher — immediately rejected in guest flow
- [ ] `usageCount` increments only on completed booking (not on validation)
- [ ] Front desk account can create vouchers (not admin-only)

## References

- Voucher schema: `plan/docs/BACKEND.md §vouchers`
- Validation API: `plan/docs/API-ROUTES.md §validate`
- Booking flow redemption step: `plan/features/BOOKING-FLOW.md §Step 3`
- Settings page location: `plan/features/SETTINGS.md §Vouchers`
