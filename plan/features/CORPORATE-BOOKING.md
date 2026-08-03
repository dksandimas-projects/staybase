# Corporate Booking Flow
> App: guest-app
> Phase: Phase 7 — Corporate, Vouchers & Breakfast
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, features/BOOKING-FLOW.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Corporate Booking

## Overview

A dedicated booking route at `/corporate/book` for corporate clients. Reuses all 4-step booking flow components but applies a corporate skin, adds company-specific fields, and supports two rate modes: a public flat corporate rate (no code needed) and a negotiated custom rate unlocked via an access code. The route is easy to remember and share with clients.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Back navigation never loses user input
- [x] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [x] Landing section before Step 1 — dark header treatment, "Corporate Rate" heading, brief intro copy
- [x] Access code input field + Validate button — shown on landing before entering the flow
- [x] "Continue without code" option — proceeds with flat corporate rate
- [x] Code validation feedback — valid (show company name + unlocked rate), expired, usage cap reached, inactive, invalid
- [x] Persistent "Corporate Rate — [Company Name or Flat Rate]" badge throughout all 4 steps
- [x] Dark header/hero treatment maintained across all steps (distinct from standard booking flow)
- [x] Step 2 — Guest Details: additional corporate fields (see `plan/features/BOOKING-FLOW.md §Step 2`)
- [x] All other steps inherit from standard booking flow with no changes
- [x] Back button on landing returns to `/corporate` marketing page

## Data & Logic Checklist

- [x] Access code validation calls `/api/validate/corporate-code` — server-side only
- [x] Valid code response returns: `companyName`, `ratePerRoomType` map
- [x] Rate applied to room type cards in Step 1 — overrides standard and weekend rates
- [x] **Room type booking** — per the `feature/booking-by-room-type` refactor: Step 1 shows one card per room type, "X of Y available for your dates" copy. The client posts `roomType` (not `roomId`); the server auto-assigns a physical room of the chosen type inside the availability transaction. `Booking.roomId` is still a real `rooms/{id}` reference.
- [x] Flat corporate rate (no code) pulled from the room type's `corporateRate` field in `settings/hotelConfig.roomTypes[]` — no longer from the per-room `room.corporateRate` (per W3.6, pricing lives on the type). *(Per BI-04, booking-intercom audit 2026-07-06)*: the client signals the no-code path with a `corporateFlatRate: true` intent flag on `/api/bookings/create`; the flag carries no pricing power — the server resolves the rate from its own type entry, falling back to the standard rate when `corporateRate` is unset (never ₱0), and a validated `corporateCode` always takes precedence over the flag
- [x] `isCorporate: true` always set on bookings from this route — set server-side, derived from either a validated `corporateCode` or the `corporateFlatRate` intent flag
- [x] `corporateCode` stored on booking only if a code was used — set server-side
- [x] `companyName` stored on booking — sourced from code validation response (authoritative) or entered by guest on the flat-rate path (stored as unverified metadata, capped at 160 chars)
- [x] `usageCount` on `corporateCodes` document incremented server-side on successful booking
- [x] Corporate booking source: `source = "corporate"`
- [x] **Negotiated rate is flat per room type** *(Per `DECISIONS-FEATURES.md #101`)*. `ratePerRoomType[roomType]` overrides the standard rate. UI label is "Negotiated rate applied" (no `(X% additional discount applied)` wording). Falls back to `room.corporateRate` if the room type is missing from the map, with a console warning.
- [x] **No promo vouchers in corporate bookings** *(Per `DECISIONS-FEATURES.md #100`)*. The `voucherDiscount` is hardcoded to `0` in `CorporateBookingPage`. Negotiated rates are the only discount.
- [x] **LOU (Letter of Undertaking) is not collected in Phase 1** *(Per `DECISIONS-FEATURES.md #99`)*. The "Charge Back" path on the form shows a note: "Our accounts team will email you within 24 hours to request your LOU." Staff tracks receipt via the `louReceived: boolean` field on the booking drawer.
- [x] **Personal-pay receipt is a real Storage upload** *(Per BI-05, booking-intercom audit 2026-07-06)*. The Step 3 personal-payment path compresses and uploads the receipt to `bookings/{bookingId}/payment-proof/` (preallocated booking ID, same pattern as the standard flow), submits the guest's actual `paymentMethod` (gcash/maya/bank) plus `paymentProofUrl`, and the booking lands as `payment-uploaded`. Confirm is disabled until the upload completes. Chargeback bookings stay `paymentMethod: "pay-at-hotel"` with no upload (settled via LOU).
- [x] **Both corporate steps run a real Turnstile challenge** *(Per BI-01, booking-intercom audit 2026-07-06)*. The gate widget gates `/api/validate/corporate-code`; the review-step widget gates `/api/bookings/create`. Both use the shared `useTurnstileToken` hook; Validate/Confirm wait for the token and the widget is reset after each token-consuming request (tokens are single-use). Never render a decorative "verified" panel without a live widget behind it.
- [x] **Bookings created from a converted inquiry have `linkedInquiryId: string` set** *(Per `DECISIONS-FEATURES.md #102`)*. The inquiry's `convertedBookingId` is set in the same transaction.

## Edge Cases & States

- [x] No access code entered — proceed with flat corporate rate, no `corporateCode` on booking
- [x] Code valid but all rooms unavailable for selected dates — show availability error after entering flow
- [x] Code expires between validation and booking creation — re-validate server-side at creation, return clear error
- [x] Code usage cap reached between validation and booking — same as above
- [x] `corporateRate` not set on room (0 or null) — fall back to standard rate, do not show ₱0
- [x] Guest navigates directly to `/corporate/book/step-2` — redirect to landing first

## Manual QA

- [x] Valid access code unlocks correct company name and rates
- [x] Rates in Step 1 reflect corporate pricing (not standard rates)
- [x] "Corporate Rate — [Company]" badge visible on all 4 steps
- [x] Corporate fields appear in Step 2 and are required
- [x] Completed booking shows `isCorporate: true` in admin dashboard
- [x] Flat rate (no code) booking works correctly
- [x] Expired/invalid code shows friendly error, does not block flow entry (can continue without code)
- [x] Usage count increments on `corporateCodes` document after successful booking

## References

- Standard booking flow steps: `plan/features/BOOKING-FLOW.md`
- Corporate code schema: `plan/docs/BACKEND.md §corporateCodes`
- Access code generation (admin side): `plan/features/CORPORATE-INQUIRIES.md`
- Validation API route: `plan/docs/API-ROUTES.md §validate`
- Corporate marketing page CTA: `plan/features/STATIC-PAGES.md`

---

## Extra Bed (EXB-07)

Corporate Step 1 uses the same adult, child, and extra-bed steppers and shared overflow hint as the public booking flow. The submitted total remains `numAdults + numChildren`, with the split and `extraBedCount` sent to the existing booking API. Legacy `?guests=N` links hydrate as N adults and zero children. See `plan/features/BOOKING-FLOW.md §Extra Bed` for the server rules and pricing contract.

The shared booking API re-derives and validates the total, normalizes the selected room type before reading its caps, and evaluates adults and children independently. A corporate group may therefore use the full adult cap plus the allowed children; children are not incorrectly counted against `maxCapacity`.

---

## Multi-Room Block (MRB-08) — proposed 2026-08-02 (decision #167)

> The corporate `/corporate/book` flow mirrors the public `/book` room cart from MRB-06 so a corporate group can book a block of rooms in one reservation. The negotiated/flat corporate rate applies **per stay type**, and the corporate code's `usageCount` records **N rooms as N uses**. Mirrors the admin New Booking modal (MRB-07) — same per-stay shape, same reservation header, same per-stay negotiated rate fallback chain.

### UX Checklist

- [x] Step 1 shows the room cart above the room-type card grid: each cart row carries the room type label, the per-stay negotiated or flat rate, the per-stay occupancy (auto-distributed from the page-level adults + children totals), and a remove button when N>1.
- [x] "Add another room" picker lists every available room type as a chip; clicking appends a new stay of that type. Disabled when no types have availability.
- [x] Cart hydrates from the `?rooms=` URL param (round-tripped via `parseBookingRoomCart` / `serializeBookingRoomCart`) so a refresh preserves the selection. Auto-seeds with one stay of the first available type when the URL has no `?rooms=` and no `?roomType=`.
- [x] Page-level adults + children steppers stay (the user states "we are N adults and M children"); the rebalance helper distributes them across the cart's per-stay occupancy.
- [x] Page-level "Extra beds" stepper is hidden when N>1 (the per-stay count is derived by the rebalance helper from each room type's `maxExtraBeds` + leftover guests).
- [x] Sticky footer shows the aggregate total for the whole block and the room count + nights + guests summary.
- [x] No promo vouchers in corporate bookings (unchanged from `DECISIONS-FEATURES.md #100`); negotiated rates are the only discount.
- [x] LOU "Charge Back" wording unchanged (per `DECISIONS-FEATURES.md #99`).

### Data & Logic Checklist

- [x] The submit body carries `roomCount` + `roomSelections[]` (same shape MRB-06 uses for the public cart and MRB-07 uses for the admin New Booking modal). The server (`handleCreateBooking`) prices each stay against its own type.
- [x] Negotiated rate is resolved **per stay type** from `corporateCodes/{code}.ratePerRoomType[stay.roomType]` (then the stay type's flat `corporateRate`, then the standard `pricePerNight`). The "Continue without code" flat-rate path applies the same per-stay fallback chain. A pre-MRB-08 single-rate lookup (resolved once for the primary type) would silently over- or under-charge a mixed-type block.
- [x] The corporate code's `usageCount` increments by `assignedRooms.length` inside the create transaction (N rooms = N uses). The shared `validateCorporateCode` helper accepts an optional `requestedUses` (default 1) so the cap check (`usageCount + requestedUses > usageCap`) catches over-cap multi-room reservations.
- [x] Cancel of one child decrements `usageCount` by 1 (per child, per child cancel) — the MRB-13 reservation-scope cancel will consolidate the decrement into a single `usageCount -= N` transaction.
- [x] Reservation header (`reservations/{id}`), reservation-aware folio, and idempotency (`reservationId` + `requestFingerprint`) all carry over from MRB-02/04/06/07. The single-room corporate path (N=1) is byte-equivalent to the pre-MRB-08 contract.

### Edge Cases & States

- [x] N=1 — the pre-MRB-08 single-room UX, byte-equivalent: one stay, no cart row remove button, no per-stay chip picker. The legacy `selectedRoomType` / `rateChoice` / `numAdults` / `numChildren` / `extraBedCount` body fields carry the first stay's values for back-compat with the server's pre-MRB-06 single-room schema validation.
- [x] N>1, all same type — every stay uses the same negotiated rate (the lookup is by type, not by index).
- [x] N>1, mixed types — each stay's rate resolves independently from the negotiated map.
- [x] Cart overflow (`unassignedAdults + unassignedChildren > 0`) — the cart UI surfaces an "X guests overflow" badge; the user can add another room or pick a type with more capacity.
- [x] Corporate code at cap (5 of 5 used, requesting 3) — the server returns the `validateCorporateCode` error and the cart stays on Step 1.
- [x] Empty cart — the page auto-seeds with one stay of the first available type, matching the pre-MRB-08 default.

### References

- Public room cart: `plan/features/BOOKING-FLOW.md §Multi-Room Cart` (MRB-06)
- Admin multi-room walk-in: `plan/features/BOOKINGS-MANAGEMENT.md §MRB-07`
- Reservation header + idempotency: `plan/docs/DECISIONS-FEATURES.md #159`, `#164`
- Cancellation scope: `plan/docs/DECISIONS-FEATURES.md #166` (MRB-13)
- Helper test: `shared/__tests__/corporate-codes.test.ts` (the `requestedUses` cap check)
- End-to-end source-text test: `guest-app/tests/api/mrb-08-corporate-multi-room.test.ts`

---

## Corporate Code `usageCount` Counter Ownership (MRB-15-03, MRB-15-08)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-03 + MRB-15-08 sub-items, shipped v0.250.0 + v0.255.0). The corporate code `usageCount` field is incremented once per room added to a corporate reservation, and decremented once per room cancelled. The counter is per-reservation (not per-child) per MRB-08's "N rooms = N uses" rule.

### Increment + decrement contract

- **Create (`handleCreateBooking` / `handleCreateWalkin`)**: `corporateCodes.usageCount += assignedRooms.length` (decision #167). A 3-room corporate reservation increments by 3.
- **Add room (`handleAddRoomToReservation`)**: `corporateCodes.usageCount += 1` (per MRB-08 rule — same `+= 1` per room added). The new child does NOT re-apply the corporate code (the spec keeps corporate per-reservation, not per-child).
- **Cancel (`handleCancelBooking`)**:
  - **Room scope**: `usageCount -= 1` (one room cancelled, one use removed).
  - **Reservation scope**: deduplicates by building a `Map<code, count>` from every cancelled child — a code shared across N children decrements by N (matches the create-time `+= assignedRooms.length` increment).
- **Legacy null-`reservationId` bookings**: the corporate code lives on the booking doc itself; the read is a single `bookings/{id}.corporateCode` field. The counter ownership contract still applies (a legacy single-room cancel decrements by 1).

### Test coverage

`guest-app/tests/api/mrb-15-01-lifecycle-invariants.test.ts` (14 tests) + `mrb-15-03-transactional-counters.test.ts` (13 tests) + `mrb-15-08-legacy-fallback.test.ts` (19 tests) — 46 source-text tests pin the corporate code `usageCount` counter ownership contract.
