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
- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends

**Admin-facing screens:**
- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Destructive actions have a single confirmation step — not buried in menus

---

## Admin UI Checklist (within Rates)

- [x] Vouchers list — table of all vouchers: code, discount type, value, usage (used/cap), expiry, status badge (Active/Inactive/Expired)
- [x] Create/Edit voucher form — code (unique), discount type (% or ₱), discount value, usage cap (optional), expiry date (optional), applicable room types (all or multi-select). Vouchers are editable, but the code field is locked after creation.
- [x] Enable / disable toggle per voucher
- [x] Usage stats — used count vs. cap displayed per voucher row
- [x] Expired vouchers shown in list with visual distinction (muted/greyed)
- [x] Admins can create and manage vouchers; Front Desk can redeem/inspect applied voucher outcomes from booking details but cannot manage campaigns.

## Guest UI Checklist (Booking Flow Step 3)

- [x] Voucher code input field + Apply button
- [x] Loading state while validating
- [x] Success state — "Code applied: -₱500" or "-20%" with updated total
- [x] Error states — invalid code, expired, usage limit reached, not applicable to selected room type
- [x] Remove applied voucher option — "Remove" link next to applied voucher
- [x] Only one voucher can be applied at a time

## Data & Logic Checklist

- [x] Voucher creation: deterministic write to `vouchers/{code}` with duplicate-code protection
- [x] Voucher validation (guest): calls `/api/validate/voucher` — server-side checks: exists, `isActive`, not expired, under usage cap, room type match
- [x] Validation response: returns `{ valid: true, discountType, discountValue }` or `{ valid: false, reason }`
- [x] `usageCount` increment: happens server-side at booking creation (`/api/bookings/create`) — not at validation time
- [x] `usageCount` restore: if a booking with an applied voucher is cancelled before check-in, `/api/bookings/cancel` decrements the voucher usage count inside the cancellation transaction (never below 0), releasing capped voucher capacity for another guest
- [x] `voucherCode` and `voucherDiscount` stored on booking document
- [x] Discount calculation: percent voucher applies to total after senior/PWD discount; flat voucher subtracts fixed amount; total never goes below ₱0
- [x] Voucher and senior/PWD discount can stack — apply senior/PWD first, then voucher
- [x] `applicableRoomTypes: []` (empty) means applies to all room types

## Edge Cases & States

- [x] Voucher used up between validation and booking creation — server re-validates at creation, returns error
- [x] Voucher expires between validation and booking creation — same handling
- [x] Duplicate voucher code on creation — show error "Code already exists"
- [x] Flat discount exceeds total — total set to ₱0, not negative
- [x] Voucher deactivated by admin while guest is in booking flow — server-side catch at creation
- [x] Voucher applied then booking cancelled — voucher usage count is restored so usage-capped campaigns count active redemptions, not abandoned bookings

## Manual QA

- [x] Create percent voucher (20%) with usage cap of 5 — validate and apply in booking flow
- [x] Create flat voucher (₱500) for Standard Twin only — verify it rejects other room types
- [x] Apply voucher in Step 3 — total updates correctly
- [x] Use voucher to cap — 6th attempt returns "usage limit reached"
- [x] Expired voucher returns correct error
- [x] Disable voucher — immediately rejected in guest flow
- [x] `usageCount` increments only on completed booking (not on validation)
- [x] Front desk account cannot access voucher campaign management; admin account can create, disable, and email vouchers.

## References

- Voucher schema: `plan/docs/BACKEND.md §vouchers`
- Validation API: `plan/docs/API-ROUTES.md §validate`
- Booking flow redemption step: `plan/features/BOOKING-FLOW.md §Step 3`
- Rates page location: `plan/features/RATE-MANAGEMENT.md`
