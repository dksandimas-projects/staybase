# Vouchers
> App: admin-app (management) + guest-app (redemption)
> Phase: Phase 7 — Corporate, Vouchers & Breakfast
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, features/BOOKING-FLOW.md
> Design ref: spark-inn-design-spec.md §Vouchers

## Overview

Promo vouchers allow admins to create discount codes redeemable during the guest booking flow at Step 3. Vouchers support percentage or flat ₱ discounts with optional usage caps, expiry dates, and room type restrictions. Management lives on the admin-only Rates page. Redemption calls a server-side validation API to prevent abuse.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

**Guest-facing screens:**
- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends

**Admin-facing screens:**
- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Destructive actions have a single confirmation step — not buried in menus

---

## Admin UI Checklist (within Rates)

- [x] Vouchers list — table of all vouchers: code, discount type, value, usage (used/cap), expiry, status badge (Active/Inactive/Expired)
- [x] Create/Edit voucher form — code (unique), discount type (% or ₱), discount value, usage cap (optional), expiry date (optional), applicable room types (all or multi-select). Vouchers are editable, but the code field is locked after creation.
- [x] Enable / disable toggle per voucher
- [x] Usage stats — used count vs. cap displayed per voucher row
- [x] Expired vouchers shown in list with visual distinction (muted/greyed)
- [x] Admins can create and manage vouchers; Front Desk can redeem/inspect applied voucher outcomes from booking details but cannot manage campaigns.

## Guest UI Checklist (Booking Flow Step 3)

- [ ] Voucher code input field + Apply button
- [ ] Loading state while validating
- [ ] Success state — "Code applied: -₱500" or "-20%" with updated total
- [ ] Error states — invalid code, expired, usage limit reached, not applicable to selected room type
- [ ] Remove applied voucher option — "Remove" link next to applied voucher
- [ ] Only one voucher can be applied at a time

## Data & Logic Checklist

- [ ] Voucher creation: deterministic write to `vouchers/{code}` with duplicate-code protection
- [ ] Voucher validation (guest): calls `/api/validate/voucher` — server-side checks: exists, `isActive`, not expired, under usage cap, room type match
- [ ] Validation response: returns `{ valid: true, discountType, discountValue }` or `{ valid: false, reason }`
- [ ] `usageCount` increment: happens server-side at booking creation (`/api/bookings/create`) — not at validation time
- [ ] `usageCount` restore: if a booking with an applied voucher is cancelled before check-in, `/api/bookings/cancel` decrements the voucher usage count inside the cancellation transaction (never below 0), releasing capped voucher capacity for another guest
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
- [ ] Voucher applied then booking cancelled — voucher usage count is restored so usage-capped campaigns count active redemptions, not abandoned bookings

## Manual QA

- [ ] Create percent voucher (20%) with usage cap of 5 — validate and apply in booking flow
- [ ] Create flat voucher (₱500) for Standard Twin only — verify it rejects other room types
- [ ] Apply voucher in Step 3 — total updates correctly
- [ ] Use voucher to cap — 6th attempt returns "usage limit reached"
- [ ] Expired voucher returns correct error
- [ ] Disable voucher — immediately rejected in guest flow
- [ ] `usageCount` increments only on completed booking (not on validation)
- [ ] Front desk account cannot access voucher campaign management; admin account can create, disable, and email vouchers.

## References

- Voucher schema: `plan/docs/BACKEND.md §vouchers`
- Validation API: `plan/docs/API-ROUTES.md §validate`
- Booking flow redemption step: `plan/features/BOOKING-FLOW.md §Step 3`
- Rates page location: `plan/features/RATE-MANAGEMENT.md`
