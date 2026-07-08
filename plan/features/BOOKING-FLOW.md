# Booking Flow
> App: guest-app
> Phase: Phase 4 — Booking Flow
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, docs/TYPES.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Booking Flow

## Overview

The 4-step public booking flow at `/book`. Converts room interest into a confirmed booking with payment intent. Progressive commitment across 4 steps increases completion rate. Booking creation is always server-side via `/api/bookings/create` using a Firestore transaction to prevent double-booking.

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

## Step 1 — Select Dates & Room

### UI Checklist
- [ ] Check-in / check-out date pickers — blocks past dates, min 1 night enforced
- [ ] Guest count input — validated against the chosen room type's `maxCapacity`
- [ ] **Available room types grid** — one card per room type defined in `settings/hotelConfig.roomTypes[]` (falling back to `DEFAULT_ROOM_TYPES`). Cards are grouped by type, not per physical room — see "Room type booking" below.
- [ ] Each type card shows "X of Y available for your dates" so guests see live capacity without exposing specific room numbers
- [ ] Each type card shows two options (if breakfast is enabled in `settings/breakfastConfig`):
  - [ ] **Room Only** — standard rate per night
  - [ ] **Room + Breakfast** — combined rate: `pricePerNight + (breakfastRatePerPerson × numGuests)` per night
- [ ] Breakfast rate shown as combined nightly total — not broken out separately on the card
- [ ] If breakfast is disabled (`breakfastConfig.isEnabled: false`) — Room Only shown, no breakfast option
- [ ] Rate per night + computed total displayed on each card
- [ ] If selected dates include mixed pricing, show a compact total breakdown so guests can see which nights used regular, weekend, or holiday/seasonal rates before they continue.
- [ ] Pre-populated if navigating from Homepage checker or Rooms page CTA
- [ ] Step indicator showing current step (1 of 4)
- [ ] "No room types available for these dates" empty state with "try fewer guests or different dates" nudge

### Data & Logic Checklist
- [ ] **Room type booking** — per the `feature/booking-by-room-type` refactor: the client posts `roomType` (not `roomId`). The server's transaction reads the type entry from `settings/hotelConfig.roomTypes[]`, queries all active physical rooms of that type, and auto-assigns the first non-conflicting one. `Booking.roomId` is still a real `rooms/{id}` reference; the assigned room is server-derived and surfaced to the client via the `/api/bookings/create` response payload.
- [ ] Query available rooms for selected date range — exclude rooms with overlapping confirmed/checked-in bookings. Per W4.7: client calls `GET /api/rooms/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` (rate-limited, 30/IP/min) which returns PII-stripped booked date ranges (`{ roomId, checkIn, checkOut, status }`). Client joins with the type catalog to compute "X of Y available" per type. The actual double-booking safety is the Firestore transaction in `/api/bookings/create` — see `plan/features/AVAILABILITY-LOCKING.md`.
- [ ] Weekend rate applied automatically when stay includes Saturday or Sunday nights
- [ ] Holiday/seasonal rate overrides applied per night before weekend/base rates, using the shared seasonal-aware pricing utility.
- [ ] Price breakdown model derived from the same nightly-rate calculation as the booking total; never maintain a separate client-only formula.
- [ ] Fetch `settings/breakfastConfig` on load — show breakfast option only if `isEnabled: true`
- [ ] Breakfast combined rate: `pricePerNight + (breakfastRatePerPerson × numGuests)` — recompute when guest count changes
- [ ] Selected room type, dates, guest count, and breakfast choice (`hasBreakfast: boolean`) persisted in booking context/state
- [ ] `breakfastRate` locked at selection time (snapshot of `ratePerPersonPerNight`) — stored on booking document

---

## Step 2 — Guest Details

### UI Checklist
- [ ] First name, last name (required)
- [ ] Email (required, validated)
- [ ] Phone number (required)
- [ ] Number of guests (required, max = room capacity)
- [ ] Special requests (optional, textarea)
- [ ] Corporate fields (shown only on `/corporate/book` flow): company name (required), designation, company address, number of rooms, purpose of stay, preferred billing arrangement
- [ ] Privacy and terms consent checkbox — "I agree to the [Privacy Policy] and [Terms of Service] and consent to the collection of my personal data for booking purposes." — required, links to `/privacy` and `/terms` in new tabs
- [ ] Back button to Step 1, Next button to Step 3
- [ ] Inline Zod validation — errors shown per field on blur
- [ ] Next button disabled until consent checkbox is checked

### Data & Logic Checklist
- [ ] Validate all required fields before allowing Step 3
- [ ] Guest details persisted in booking context/state

---

## Step 3 — Review & Confirm

### UI Checklist
- [ ] Full booking summary (read-only) — room name, dates, nights, rate breakdown, breakfast add-on (if selected), subtotal
- [ ] Price breakdown section:
  - [ ] Shows regular nights count × regular nightly rate when present.
  - [ ] Shows weekend nights count × weekend nightly rate when present.
  - [ ] Shows each holiday/seasonal override label, affected nights count, and nightly rate when present.
  - [ ] Shows room subtotal before breakfast, discounts, vouchers, and points.
  - [ ] Shows breakfast as a separate line when selected: guests × nights × breakfast rate.
  - [ ] Shows discount/voucher/member/points deductions as separate negative lines after the subtotal.
  - [ ] Shows final total with the same value that will be submitted to `/api/bookings/create`.
- [ ] Discount selector — Senior Citizen (20%) / PWD (20%) / None
- [ ] Discount ID upload — shown immediately when Senior Citizen or PWD is selected; hidden when None
  - [ ] Label: "Upload your OSCA Card" (Senior) or "Upload your PWD ID" (PWD)
  - [ ] Helper text: "A photo or scan of your valid ID. Our team will verify before confirming your discount."
  - [ ] Accepts jpg/png/webp, max 5MB
  - [ ] Required if a discount is selected — Confirm button disabled until uploaded
  - [ ] Thumbnail preview shown after upload
  - [ ] If guest switches back to "None" — upload cleared and field hidden
- [ ] Voucher code input — text field + Apply button
- [ ] Voucher feedback — valid (show discount), expired, usage limit reached, invalid code, room type mismatch
- [ ] Updated total after discount/voucher applied
- [ ] Payment method selector — Pay at Hotel / GCash / PayPal / other enabled methods (from `settings/hotelConfig`)
- [ ] Payment screenshot upload — shown only for non-pay-at-hotel methods
- [ ] Screenshot upload: accepts image files only, max 5MB
- [ ] Payment method QR code or account info displayed based on selection
- [ ] Cancellation policy — collapsible section showing `settings/websiteContent.cancellationPolicy`
- [ ] Terms & conditions checkbox (required)
- [ ] Cloudflare Turnstile widget — invisible, renders before Confirm button
- [ ] Honeypot field — hidden from users via CSS (`position: absolute; opacity: 0; pointer-events: none`), never `display: none`
- [ ] Confirm Booking button (Spark Orange) — disabled until terms checked and Turnstile token received
- [ ] Micro-copy beneath CTA: "Your booking is not confirmed until payment is verified by our team."

### Data & Logic Checklist
- [ ] Voucher validation calls `/api/validate/voucher` — server-side only
- [ ] Discount and voucher calculations happen client-side for display, server-side for storage
- [ ] The breakdown shown in Step 3 is recomputed server-side during booking creation; client-provided totals or breakdown lines are advisory only and must not be trusted.
- [ ] Server response returns the persisted breakdown so Step 4 can show the authoritative explanation for the final total.
- [ ] Booking flow preallocates a Firestore booking document ID before Step 3 uploads; `/api/bookings/create` must create the booking document at that same ID
- [ ] Payment screenshot uploaded to Firebase Storage before booking creation using the preallocated booking ID path
- [ ] `paymentProofUrl` stored in booking document
- [ ] Pay at Hotel: no upload required, `paymentMethod = "pay-at-hotel"`
- [ ] Discount ID photo uploaded to Firebase Storage before booking creation (when discount is selected) using the preallocated booking ID path; `discountIdPhotoUrl` stored on booking document
- [ ] Discount ID upload is required client-side but also validated server-side — if `discountType != ""` and `discountIdPhotoUrl` is null, booking creation is rejected

---

## Step 4 — Booking Confirmation

### UI Checklist
- [ ] Booking reference number displayed prominently (Apollo heading)
- [ ] Full booking summary with authoritative price breakdown returned by `/api/bookings/create`
- [ ] Add to Calendar button (ICS file download or Google Calendar deep link)
- [ ] Payment instructions based on selected payment method
- [ ] Pay at Hotel: "Present this confirmation at check-in. Payment is due upon arrival."
- [ ] Online payment: "Your payment is under review. You will receive a confirmation email within 24 hours."
- [ ] Celebratory design treatment — Peak-End Rule, positive final impression
- [ ] Link to `/my-booking` to check status anytime
- [ ] Spark Rewards prompt — shown only to logged-out guests or non-members:
  - [ ] Heading: "Join Spark Rewards and earn points on this stay!"
  - [ ] Perks list — same items as homepage section, pulled from `settings/websiteContent.homepage.sparkRewards.perks`; displayed as icon + perk name chips to entice sign-up
  - [ ] Google Sign-In button + "Sign up with email" link inline
  - [ ] Hidden for logged-in members — no prompt shown

### Data & Logic Checklist
- [ ] Booking creation via `/api/bookings/create` using Firestore transaction — see `plan/features/AVAILABILITY-LOCKING.md`
- [ ] Booking document ID is preallocated client-side for Storage uploads; booking reference generated server-side: `{config.bookingRefPrefix}-YYYYMMDD-NNN`
- [ ] Rate locked at booking creation time — stored in `ratePerNight`
- [ ] Rate breakdown locked at booking creation time — stored in `rateBreakdown` so later guest lookup, admin drawer, emails, and receipts explain the same total even if rates change.
- [ ] Email triggered via `/api/email/booking-submitted` after successful creation — acts as an acknowledgment/receipt submission warning the guest that their booking/payment is under review and that an official confirmation will follow once verified
- [ ] `isCorporate`, `corporateCode`, `companyName` set server-side — never trusted from client
- [ ] Initial status: `"pending"` (or `"payment-uploaded"` if screenshot provided)

---

## Edge Cases & States

- [ ] Loading state during booking creation — disable Confirm button, show spinner
- [ ] Room becomes unavailable between Step 1 and Step 3 — show conflict error, redirect back to Step 1
- [ ] Voucher expired between validation and submission — re-validate server-side at creation
- [ ] Screenshot upload fails — show error, allow retry before submission
- [ ] Network error on booking creation — show error, do not create duplicate booking
- [ ] Invalid booking reference format caught server-side
- [ ] Back navigation between steps preserves form state

## Manual QA

- [ ] Complete full booking flow from Step 1 to Step 4 — verify booking appears in admin dashboard
- [ ] Date range picker blocks past dates and enforces min 1 night
- [ ] Guest count filter hides rooms below capacity
- [ ] Weekend rate applies correctly when stay includes weekend
- [ ] Mixed weekday/weekend stay shows separate regular and weekend lines and the sum matches the submitted total
- [ ] Holiday/seasonal override stay shows the override label and rate, and override nights beat weekend/base rates
- [ ] Stay with breakfast plus discount/voucher shows room subtotal, add-on, deductions, and final total in the expected order
- [ ] Voucher code applies and updates total correctly
- [ ] Invalid voucher shows appropriate error message
- [ ] Pay at Hotel flow: no upload required, correct confirmation message
- [ ] GCash flow: upload required, correct payment instructions shown
- [ ] Booking confirmation email received by guest
- [ ] Add to Calendar creates correct event with check-in/out times
- [ ] Double-booking prevented — test by opening two sessions simultaneously

## References

- Availability locking implementation: `plan/features/AVAILABILITY-LOCKING.md`
- Corporate booking variations: `plan/features/CORPORATE-BOOKING.md`
- Voucher validation: `plan/features/VOUCHERS.md`
- Booking schema: `plan/docs/BACKEND.md §bookings`
- API routes: `plan/docs/API-ROUTES.md`
- Email triggers: `plan/features/EMAIL-PDF-STORAGE.md`

## Implementation Plan — Guest Price Breakdown

### Goal

Let guests understand why the final booking total changes when their stay includes regular weekdays, weekend nights, and holiday/seasonal rates. The display must match the actual amount charged and remain explainable after the booking is created.

### Scope

- Guest booking Step 1 room cards: compact preview when mixed rates are present.
- Guest booking Step 3 review: full itemized breakdown before confirmation.
- Guest booking Step 4 confirmation: authoritative persisted breakdown from the booking-create response.
- `/my-booking`, guest emails, and admin receipt surfaces: reuse the persisted breakdown where available.
- Public online and corporate personal-pay booking creation: server recomputes and persists the breakdown.
- Staff walk-in/manual booking creation: use the same breakdown contract when pricing is calculated from public/walk-in rates.

### Data Contract

- Add `Booking.rateBreakdown` as a locked-at-booking snapshot.
- Breakdown should include:
  - Nightly room groups by rate source: regular, weekend, seasonal/holiday, and corporate flat when applicable.
  - Date range covered by each group, night count, nightly rate, subtotal, and optional seasonal override label.
  - Room subtotal before add-ons.
  - Breakfast line when selected.
  - Discount, voucher, Spark Rewards member discount, and points redemption deductions when present.
  - Final total, matching `Booking.totalPrice`.
- Keep `Booking.ratePerNight` for backward compatibility and summary displays, but prefer `rateBreakdown` for itemized explanations.
- Existing bookings without `rateBreakdown` should fall back to the legacy summary: nights × locked `ratePerNight`, breakfast, discounts/vouchers, and total.

### Pricing Rules

- Reuse the shared seasonal-aware pricing calculator as the source of truth.
- Per-night hierarchy remains: seasonal/holiday override beats weekend, weekend beats regular.
- Seasonal override names are the guest-facing holiday/event labels.
- Breakfast, discounts, vouchers, member discount, and points apply after the room subtotal.
- Existing bookings are never repriced when rates or seasonal overrides change.
- Corporate negotiated/flat rates should be labeled clearly and should not be mixed with public seasonal/weekend pricing unless the existing corporate flow explicitly uses public pricing.

### UX Requirements

- Step 1 room cards should stay scannable: show the final stay total and a small expandable/inline note only when more than one rate source is present.
- Step 3 must show the full breakdown before terms/payment confirmation so the guest can catch surprises before submitting.
- Labels should use plain language: "Regular nights", "Weekend nights", and the seasonal override name such as "Holy Week".
- Deductions should be visibly negative and ordered after add-ons.
- Totals must use `config.currencySymbol` and existing locale/currency formatting helpers.
- Do not expose internal override IDs, room IDs, payment proof URLs, or admin-only notes.

### Implementation Steps

1. Extend the shared booking/pricing type docs and TypeScript types with `rateBreakdown`.
2. Update the shared seasonal-aware pricing utility to return grouped rate lines and additive/deduction lines in addition to the numeric total.
3. Refactor guest Step 1 and Step 3 to consume the shared breakdown output rather than duplicating price math in components.
4. Update `/api/bookings/create` and `/api/bookings/create-walkin` to recompute the breakdown inside the booking transaction and persist it with the booking.
5. Return the persisted breakdown from `/api/bookings/create` for Step 4 confirmation.
6. Update `/api/bookings/lookup` to include the guest-safe breakdown for `/my-booking`.
7. Update booking-submitted and booking-confirmed email templates to include the itemized room/add-on/discount/final-total summary.
8. Update admin booking drawer/receipt rendering to prefer `rateBreakdown`, with the legacy fallback for older bookings.
9. Add focused tests for mixed weekday/weekend, weekend plus seasonal override, breakfast, discount/voucher, corporate flat, and legacy booking fallback.

### Acceptance Criteria

- A booking that spans weekday and weekend nights shows separate lines explaining both rates.
- A booking that spans a holiday/seasonal override shows the override label and rate, and does not double-count weekend pricing for those nights.
- The Step 3 total, API-created `totalPrice`, Step 4 total, lookup page, email summary, and admin receipt agree.
- Existing bookings without `rateBreakdown` still render a sensible summary.
- No public response leaks payment proof URLs, internal notes, or unrelated booking PII.
