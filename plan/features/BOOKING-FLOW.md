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

- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Back navigation never loses user input
- [x] Confirmation/success state feels celebratory, not just "OK"

---

## Step 1 — Select Dates & Room

### UI Checklist
- [x] Check-in / check-out date pickers — blocks past dates, min 1 night enforced
- [x] Guest count input — validated against the chosen room type's `maxCapacity`
- [x] **Available room types grid** — one card per room type defined in `settings/hotelConfig.roomTypes[]` (falling back to `DEFAULT_ROOM_TYPES`). Cards are grouped by type, not per physical room — see "Room type booking" below.
- [x] Each type card shows "X of Y available for your dates" so guests see live capacity without exposing specific room numbers
- [x] Each type card shows two options (if breakfast is enabled in `settings/breakfastConfig`):
  - [x] **Room Only** — standard rate per night
  - [x] **Room + Breakfast** — combined rate: `pricePerNight + (breakfastRatePerPerson × numGuests)` per night
- [x] Breakfast rate shown as combined nightly total — not broken out separately on the card
- [x] If breakfast is disabled (`breakfastConfig.isEnabled: false`) — Room Only shown, no breakfast option
- [x] Rate per night + computed total displayed on each card
- [x] Whenever any night uses a non-standard rate (weekend, seasonal/holiday, or corporate), show the rate panel so the headline "From {base rate}" is never higher than the total without explanation. For a single-source stay, the panel renders one line (e.g. "Weekend nights: 1 × ₱2,700" with the line subtotal on the right). For a multi-source stay, the existing "This stay uses mixed nightly rates" heading + per-source line list is used. Fully regular stays render no panel. Option price labels match the selected stay: a one-source stay shows that source's actual nightly amount, a multi-source stay prefixes the option price with "From", and a fully regular stay shows the base rate with no prefix. Per WRV (2026-08-01).
- [x] Pre-populated if navigating from Homepage checker or Rooms page CTA
- [x] Step indicator showing current step (1 of 4)
- [x] "No room types available for these dates" empty state with "try fewer guests or different dates" nudge

### Data & Logic Checklist
- [x] **Room type booking** — per the `feature/booking-by-room-type` refactor: the client posts `roomType` (not `roomId`). The server's transaction reads the type entry from `settings/hotelConfig.roomTypes[]`, queries all active physical rooms of that type, and auto-assigns the first non-conflicting one. `Booking.roomId` is still a real `rooms/{id}` reference; the assigned room is server-derived and surfaced to the client via the `/api/bookings/create` response payload.
- [x] Query available rooms for selected date range — exclude rooms with overlapping confirmed/checked-in bookings. Per W4.7: client calls `GET /api/rooms/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` (rate-limited, 30/IP/min) which returns PII-stripped booked date ranges (`{ roomId, checkIn, checkOut, status }`). Client joins with the type catalog to compute "X of Y available" per type. The actual double-booking safety is the Firestore transaction in `/api/bookings/create` — see `plan/features/AVAILABILITY-LOCKING.md`.
- [x] Weekend rate applied automatically when stay includes Saturday or Sunday nights
- [x] Holiday/seasonal rate overrides applied per night before weekend/base rates, using the shared seasonal-aware pricing utility.
- [x] Price breakdown model derived from the same nightly-rate calculation as the booking total; never maintain a separate client-only formula.
- [x] Fetch `settings/breakfastConfig` on load — show breakfast option only if `isEnabled: true`
- [x] Breakfast combined rate: `pricePerNight + (breakfastRatePerPerson × numGuests)` — recompute when guest count changes
- [x] Selected room type, dates, guest count, and breakfast choice (`hasBreakfast: boolean`) persisted in booking context/state
- [x] `breakfastRate` locked at selection time (snapshot of `ratePerPersonPerNight`) — stored on booking document

---

## Step 2 — Guest Details

### UI Checklist
- [x] First name, last name (required)
- [x] Email (required, validated)
- [x] Phone number (required)
- [x] Number of guests (required, max = room capacity)
- [x] Special requests (optional, textarea)
- [x] Corporate fields (shown only on `/corporate/book` flow): company name (required), designation, company address, number of rooms, purpose of stay, preferred billing arrangement
- [x] Privacy and terms consent checkbox — "I agree to the [Privacy Policy] and [Terms of Service] and consent to the collection of my personal data for booking purposes." — required, links to `/privacy` and `/terms` in new tabs
- [x] Back button to Step 1, Next button to Step 3
- [x] Inline Zod validation — errors shown per field on blur
- [x] Next button disabled until consent checkbox is checked

### Data & Logic Checklist
- [x] Validate all required fields before allowing Step 3
- [x] Guest details persisted in booking context/state

---

## Step 3 — Review & Confirm

### UI Checklist
- [x] Full booking summary (read-only) — room name, dates, nights, rate breakdown, breakfast add-on (if selected), subtotal
- [x] Price breakdown section:
  - [x] Shows regular nights count × regular nightly rate when present.
  - [x] Shows weekend nights count × weekend nightly rate when present.
  - [x] Shows each holiday/seasonal override label, affected nights count, and nightly rate when present.
  - [x] Shows room subtotal before breakfast, discounts, vouchers, and points.
  - [x] Shows breakfast as a separate line when selected: guests × nights × breakfast rate.
  - [x] Shows discount/voucher/member/points deductions as separate negative lines after the subtotal.
  - [x] Shows final total with the same value that will be submitted to `/api/bookings/create`.
- [x] Discount selector — Senior Citizen (20%) / PWD (20%) / None
- [x] Discount ID upload — shown immediately when Senior Citizen or PWD is selected; hidden when None
  - [x] Label: "Upload your OSCA Card" (Senior) or "Upload your PWD ID" (PWD)
  - [x] Helper text: "A photo or scan of your valid ID. Our team will verify before confirming your discount."
  - [x] Accepts jpg/png/webp, max 5MB
  - [x] Required if a discount is selected — Confirm button disabled until uploaded
  - [x] Thumbnail preview shown after upload
  - [x] If guest switches back to "None" — upload cleared and field hidden
- [x] Voucher code input — text field + Apply button
- [x] Voucher feedback — valid (show discount), expired, usage limit reached, invalid code, room type mismatch
- [x] Updated total after discount/voucher applied
- [x] Payment method selector — Pay at Hotel / GCash / PayPal / other enabled methods (from `settings/hotelConfig`)
- [x] Payment screenshot upload — shown only for non-pay-at-hotel methods
- [x] Screenshot upload: accepts image files only, max 5MB
- [x] **No payment-reference field on the guest form** (2026-07-24) — `refactor/unify-payment-reference-fields` retired the guest-entered reference input from the booking page (and the corporate personal-pay path). The canonical payment reference now lives exclusively on each entry in the `bookings/{id}/payments/` ledger as `transactionReference`, staff-populated via **Verify & Record Payment** / **Record Payment**. The per-method `requireReferenceNumber` flag in `settings/hotelConfig.paymentMethods[]` is now enforced only on the staff verify/add-payment endpoints, never on the guest form. See `plan/features/BOOKINGS-MANAGEMENT.md §Payment Reference Semantics` for the post-unification contract.
- [x] Payment method QR code or account info displayed based on selection
- [x] Cancellation policy — collapsible section showing `settings/websiteContent.cancellationPolicy`
- [x] Terms & conditions checkbox (required)
- [x] Cloudflare Turnstile widget — invisible, renders before Confirm button
- [x] Honeypot field — hidden from users via CSS (`position: absolute; opacity: 0; pointer-events: none`), never `display: none`
- [x] Confirm Booking button (Spark Orange) — disabled until terms checked and Turnstile token received
- [x] Review-pending expectation copy — surfaced on Step 4 for online payments ("Booking submitted for review" heading + "Our team is verifying your payment and will send an official confirmation shortly") and in the acknowledgment email, rather than as micro-copy beneath the Step 3 CTA

### Data & Logic Checklist
- [x] Voucher validation calls `/api/validate/voucher` — server-side only
- [x] Discount and voucher calculations happen client-side for display, server-side for storage
- [x] The breakdown shown in Step 3 is recomputed server-side during booking creation; client-provided totals or breakdown lines are advisory only and must not be trusted.
- [x] Server response returns the persisted breakdown so Step 4 can show the authoritative explanation for the final total.
- [x] Booking flow preallocates a Firestore booking document ID before Step 3 uploads; `/api/bookings/create` must create the booking document at that same ID
- [x] Payment screenshot uploaded to Firebase Storage before booking creation using the preallocated booking ID path
- [x] `paymentProofUrl` stored in booking document
- [x] **No top-level `paymentReferenceNumber` is written by the public flow** (2026-07-24) — guests no longer provide a payment reference number at booking creation. The server-side `requireReferenceNumber` re-check in `/api/bookings/create` was removed. The flag now applies only to staff-side verify/add-payment endpoints (see `plan/features/BOOKINGS-MANAGEMENT.md §Payment Reference Semantics`).
- [x] Pay at Hotel: no upload required, `paymentMethod = "pay-at-hotel"`
- [x] Discount ID photo uploaded to Firebase Storage before booking creation (when discount is selected) using the preallocated booking ID path; `discountIdPhotoPath` stored on booking document (staff resolves a short-lived signed URL via `/api/storage/signed-url` for the drawer preview — per X-01, anonymous guest clients must never call `getDownloadURL` on the private bucket, see `plan/docs/AUDIT-E2E-REPORT.md §X-01`)
- [x] Discount ID upload is required client-side but also validated server-side — if `discountType != ""` and `discountIdPhotoPath` is null, booking creation is rejected. The path is sufficient evidence the ID was uploaded: it has already been matched against `isExpectedBookingUploadPath` (strict prefix `bookings/{bookingId}/discount-id/` + randomized filename) and the `discountIdPhotoUrl` field, if provided, has been allowlist-validated against the Firebase Storage bucket prefix

---

## Step 4 — Booking Confirmation

### UI Checklist
- [x] Booking reference number displayed prominently (Apollo heading)
- [x] Full booking summary with authoritative price breakdown returned by `/api/bookings/create`
- [x] Add to Calendar button (ICS file download or Google Calendar deep link)
- [x] Payment instructions based on selected payment method
- [x] Pay at Hotel: "Present this confirmation at check-in. Payment is due upon arrival."
- [x] Online payment: "Your payment is under review. You will receive a confirmation email within 24 hours."
- [x] Celebratory design treatment — Peak-End Rule, positive final impression
- [x] Link to `/my-booking` to check status anytime
- [x] Spark Rewards prompt — shown only to logged-out guests or non-members:
  - [x] Heading: "Join Spark Rewards and earn points on this stay!"
  - [x] Perks chips — two static icon + name chips ("Earn Points", "Member Discounts"); NOT settings-driven (the settings-driven perks list lives on the homepage section only)
  - [x] "Sign up with email" CTA → `/signup` + "Learn more" → `/rewards` (no inline Google Sign-In button — Google auth lives on the sign-in/sign-up pages)
  - [x] Hidden for logged-in members — no prompt shown

### Data & Logic Checklist
- [x] Booking creation via `/api/bookings/create` using Firestore transaction — see `plan/features/AVAILABILITY-LOCKING.md`
- [x] Booking document ID is preallocated client-side for Storage uploads; booking reference generated server-side: `{config.bookingRefPrefix}-YYYYMMDD-NNN`
- [x] Rate locked at booking creation time — stored in `ratePerNight`
- [x] Rate breakdown locked at booking creation time — stored in `rateBreakdown` so later guest lookup, admin drawer, emails, and receipts explain the same total even if rates change.
- [x] Email triggered via `/api/email/booking-submitted` after successful creation — acts as an acknowledgment/receipt submission warning the guest that their booking/payment is under review and that an official confirmation will follow once verified
- [x] `isCorporate`, `corporateCode`, `companyName` set server-side — never trusted from client
- [x] Initial status: `"pending"` (or `"payment-uploaded"` if screenshot provided)

---

## Edge Cases & States

- [x] Loading state during booking creation — disable Confirm button, show spinner
- [x] Room becomes unavailable between Step 1 and Step 3 — show conflict error, redirect back to Step 1
- [x] Voucher expired between validation and submission — re-validate server-side at creation
- [x] Screenshot upload fails — show error, allow retry before submission
- [x] Network error on booking creation — show error, do not create duplicate booking
- [x] Invalid booking reference format caught server-side
- [x] Back navigation between steps preserves form state

## Manual QA

- [x] Complete full booking flow from Step 1 to Step 4 — verify booking appears in admin dashboard
- [x] Date range picker blocks past dates and enforces min 1 night
- [x] Guest count filter hides rooms below capacity
- [x] Weekend rate applies correctly when stay includes weekend
- [x] Mixed weekday/weekend stay shows separate regular and weekend lines and the sum matches the submitted total
- [x] Holiday/seasonal override stay shows the override label and rate, and override nights beat weekend/base rates
- [x] Stay with breakfast plus discount/voucher shows room subtotal, add-on, deductions, and final total in the expected order
- [x] Voucher code applies and updates total correctly
- [x] Invalid voucher shows appropriate error message
- [x] Pay at Hotel flow: no upload required, correct confirmation message
- [x] GCash flow: upload required, correct payment instructions shown
- [x] Booking confirmation email received by guest
- [x] Add to Calendar creates correct event with check-in/out times
- [x] Double-booking prevented — test by opening two sessions simultaneously

## Audit Remediation (2026-07-17)

- **G-01 (HIGH, fixed):** `/api/bookings/create` now strict-Zod validates the complete request. `guests` is a finite integer from 1–100, unknown fields are rejected, and computed totals have a final `Number.isFinite` guard before the booking write. The already-strict walk-in schema remains unchanged.
- **G-02 (MED, open):** No maximum stay length or advance-booking window server-side. Anonymous pay-at-hotel `pending` bookings occupy inventory until staff cancel them — long or far-future bookings can deny availability. Fix: cap `numNights` and the booking horizon in the create handlers and mirror in the date picker.

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

- Step 1 room cards should stay scannable: show the final stay total and a small inline note whenever any rate source is non-standard, not only when more than one source is present. A single-source weekend stay is the most common weekend booking and was previously silent on the rate charged. The option price label must match the selected stay — no headline-vs-total surprise. Per WRV (2026-08-01).
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
- A booking that is **entirely** a non-regular rate (e.g. a Saturday→Sunday weekend-only stay, or a stay fully inside a seasonal/holiday window) shows the rate panel on Step 1 even though the breakdown is a single line, and the option price labels reflect the actual source's nightly amount. Per WRV (2026-08-01).
- The Step 3 total, API-created `totalPrice`, Step 4 total, lookup page, email summary, and admin receipt agree.
- Existing bookings without `rateBreakdown` still render a sensible summary.
- No public response leaks payment proof URLs, internal notes, or unrelated booking PII.
