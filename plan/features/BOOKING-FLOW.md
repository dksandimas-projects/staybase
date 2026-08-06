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

## Step 1 — Select Dates & Rooms

### UI Checklist
- [x] Check-in / check-out date pickers — blocks past dates, min 1 night enforced
- [x] Adult and child inputs — validated independently against the chosen room type's adult cap (`maxCapacity`) and child cap (`maxChildren`), with configured extra beds covering either kind of overflow
- [x] **Available room types grid** — one card per room type defined in `settings/hotelConfig.roomTypes[]` (falling back to `DEFAULT_ROOM_TYPES`). Cards are grouped by type, not per physical room — see "Room type booking" below.
- [x] Each type card shows "X of Y available for your dates" so guests see live capacity without exposing specific room numbers
- [x] Each type card has a 44px quantity selector, capped by live availability; selected types form a small room cart and the sticky summary shows the running reservation total
- [x] Adults and children are distributed across the selected rooms, with one adult required per room. Each child stay is checked against that type's adult/child/extra-bed limits before the guest can continue.
- [x] Each type card shows two options (if breakfast is enabled in `settings/breakfastConfig`):
  - [x] **Room Only** — standard rate per night
  - [x] **Room + Breakfast** — combined rate uses the chargeable breakfast occupancy: adults plus children when the booking's include-children toggle is on
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
- [x] Breakfast combined rate uses adults plus included children and recomputes whenever either occupancy count or the include-children toggle changes
- [x] Selected room types and quantities, per-room `numAdults`, `numChildren`, extra-bed count and breakfast choice, dates, and aggregate guest total persist in booking context/state
- [x] `breakfastRate` locked at selection time (snapshot of `ratePerPersonPerNight`) — stored on booking document
- [x] The client sends one explicit `roomSelections[]` entry per requested room. The transaction assigns distinct physical rooms, prices every child stay, applies reservation-level discounts once, and allocates the exact rounded total back to the child bookings.

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
- [x] Multi-room summary lists each room's type, distributed occupancy, breakfast choice, and extra-bed requirement while collecting one lead guest and one payment for the reservation
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
- [x] Per MRB-06, `/api/bookings/create` accepts the explicit room cart, returns all assigned rooms, and keeps the historical single-room fields for compatible callers. The request fingerprint includes per-room occupancy, extra beds, and breakfast choices so changed retries conflict instead of replaying stale pricing.
- [x] Booking flow preallocates a Firestore booking document ID before Step 3 uploads; `/api/bookings/create` must create the booking document at that same ID
- [x] Per MRB-02 (2026-08-02, per decision #164): the public `/book` flow preallocates a `reservationId` (UUIDv4, generated client-side via the shared `generateReservationId()` helper) and sends it in the body of `/api/bookings/create`. The server's transaction reads the `reservations/{id}` header first as the idempotency anchor: same `reservationId` + same `requestFingerprint` → idempotent replay (returns the existing booking's response with `idempotentReplay: true`); same `reservationId` + different `requestFingerprint` → 409 conflict; header exists but child missing → 500. The preallocation is held in a `useState` lazy init so the same id survives across renders and retry-after-uncertain-response (the user re-tries without reloading the page; the id is reused). The response payload mirrors the same `reservationId` + `reservationRef` + `idempotentReplay` shape across the three paths (fresh create, reservation-level replay, legacy booking-level replay) so the confirmation page can deep-link to `/manage?reservation=<id>` regardless of which path produced the booking.
- [x] Payment screenshot uploaded to Firebase Storage before booking creation using the preallocated booking ID path
- [x] `paymentProofUrl` stored in booking document
- [x] **No top-level `paymentReferenceNumber` is written by the public flow** (2026-07-24) — guests no longer provide a payment reference number at booking creation. The server-side `requireReferenceNumber` re-check in `/api/bookings/create` was removed. The flag now applies only to staff-side verify/add-payment endpoints (see `plan/features/BOOKINGS-MANAGEMENT.md §Payment Reference Semantics`).
- [x] Pay at Hotel: no upload required, `paymentMethod = "pay-at-hotel"`
- [x] Discount ID photo uploaded to Firebase Storage before booking creation (when discount is selected) using the preallocated booking ID path; `discountIdPhotoPath` stored on booking document (staff resolves a short-lived signed URL via `/api/storage/signed-url` for the drawer preview — per X-01, anonymous guest clients must never call `getDownloadURL` on the private bucket, see `plan/docs/AUDIT-E2E-REPORT.md §X-01`)
- [x] Discount ID upload is required client-side but also validated server-side — if `discountType != ""` and `discountIdPhotoPath` is null, booking creation is rejected. The path is sufficient evidence the ID was uploaded: it has already been matched against `isExpectedBookingUploadPath` (strict prefix `bookings/{bookingId}/discount-id/` + randomized filename) and the `discountIdPhotoUrl` field, if provided, has been allowlist-validated against the Firebase Storage bucket prefix

---

## Step 4 — Booking Confirmation

### UI Checklist
- [x] Reservation reference number displayed prominently (Apollo heading)
- [x] Full booking summary with authoritative price breakdown returned by `/api/bookings/create`
- [x] Multi-room confirmations list every assigned room and use the reservation reference for calendar and management links
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

---

## Children in Booking (CHD-05)

Step 1 separates the total group into adults aged 12+ and children aged 0–11. Room-type availability evaluates the adult and child caps independently; it does not count every child against the adult cap.

The server validates `numAdults + numChildren === numGuests` inside both public and walk-in creation transactions. Room types are normalized before their caps are read, so legacy types receive the configured per-capacity child default. The historical combined `numGuests > maxCapacity` check must not return: `maxCapacity` is the adult cap, not total occupancy. Legacy requests without the split derive to all adults and zero children.

- [x] The child stepper states the selected room type's included child allowance and explains when the current group reaches its limit.
- [x] Extra beds may cover adult or child overflow. The picker uses the same shared overflow rule as the server, explains the exact number of additional beds required, and blocks continuation until that requirement is met.
- [x] Room cards show adult, child, and extra-bed allowances instead of an ambiguous total capacity.
- [x] Children and extra-bed counts persist across booking-step URLs and refreshes.
- [x] The picker and price summary explicitly state that children have no additional room charge. Breakfast and a required extra bed remain separate chargeable add-ons.
- [x] Touched stepper controls meet the 44px minimum and cap guidance is announced as live status text.

---

## Soft-Constraint Children Picker (CHD-11)
> Proposed 2026-08-03, per decision #184. Spec-only — no code yet.

### The problem

CHD-05 enforces the per-type child cap (`RoomTypeEntry.maxChildren`, see CHD-02) at the picker level: the +/− stepper for "Children (0–11)" on `/book` is disabled at the cap, and the helper text reads "You have reached this room type's limit for the current group." The constraint is real — a Single Room cannot physically sleep three children — but enforcing it at the picker is the wrong layer:

1. **It's a dead-end at the exploration stage.** The guest is still choosing room type and/or quantity. They might know they have three kids before they know which room type works. Greyed-out + is a hard "no" with no path forward.
2. **It hides the multi-room escape hatch.** Two adjacent Single Rooms can sleep the same three children; the picker doesn't surface that path because the cap is computed against one room, not the cart.
3. **It treats the picker as if the cart were final.** The cart is a draft until Step 3. The cap belongs at the commit surface, not at the draft surface.

The single-source change: let the picker be unbounded, and move the cap to (a) a live indicator on each room-type card, and (b) a single hard validation at the Step 1 → Step 2 transition. The picker becomes a draft; the room-type card + the submit gate become the truth.

### The pattern: exploration-first, validation-on-commit

Three layers, with the constraint surfacing at the right one for each.

**Layer 1 — Children picker: unbounded (within a sane soft cap).**

- Drop the `disabled` condition on the `+` button at `guest-app/src/pages/BookingPage.tsx:2055-2058` (the `numChildren >= selectedMaxSelectableChildren || numChildren >= Math.max(0, guests - 1)` guard). The `-` button stays gated at `numChildren > 0` (the existing invariant — you can't have negative children).
- Soft-cap the picker at `MIN(10, guests - 1)` (the existing `Math.max(0, guests - 1)` invariant — at least one adult is always required). No hard upper bound from the room type. The soft cap is "no one in their right mind books 10 kids into one room" — it's a guard against the + going to 100, not a capacity rule.
- Drop the "You have reached this room type's limit for the current group" tail at `BookingPage.tsx:2080`. Replace with: "Children stay free of the room charge. Pick a room type that fits your group, or add a second room." — a forward-looking nudge instead of a back-looking dead-end.
- Keep the existing "Up to N can fit when extra beds cover the overflow" sentence at `BookingPage.tsx:2076-2078` — it's a real and useful hint about the extra-bed escape hatch and stays accurate with the cap removed (it now describes a soft limit, not a hard one).

**Layer 2 — Room-type card: live per-type capacity indicator.**

The room-type card at `BookingPage.tsx:2203-2283` is the surface that responds to the guest count. Today it shows static text — "Up to N adults + M children" + "X of Y available" + the room quantity stepper. Add a third chip: a per-type **Fits / Tight / Doesn't fit** badge that recomputes live against the current `(numAdults, numChildren)` and the cart's current room count.

The indicator is a derived view, not a gating control. The three states:

- **Fits** (green / primary-tint) — `requiredExtraBedsFor({ numAdults, numChildren, maxCapacity, maxChildren })` returns `requiredExtraBeds <= type.maxExtraBeds` for the type as a single-room choice, OR the total fits in the cart's current room count (sum across rooms ≥ total occupants). Soft-passes; the card stays clickable.
- **Tight** (amber) — fits exactly at the cap with zero extra beds (`requiredExtraBeds === 0` and `numAdults === maxCapacity` and `numChildren === maxChildren`). The user is at the edge; the card stays clickable but the "Rooms" quantity stepper highlights the cap.
- **Doesn't fit** (red / muted) — `requiredExtraBedsFor(...) > type.maxExtraBeds` for the single-room case AND the cart's current room count is below what the total needs. The card stays clickable (the user is still exploring) but the quantity stepper caps the selectable rooms at what would be required.

For multi-room, the indicator shows a small "You'd need 2 of [type]" callout when the total exceeds a single room's capacity. The callout is informational; the cart can be increased to satisfy it.

The indicator is computed by a new pure helper in `shared/utils/roomTypes.ts` — `deriveRoomTypeCapacityFit({ type, numAdults, numChildren, currentCartCount })` returns `{ state: "fits" | "tight" | "doesnt-fit", roomsNeeded: number, extraBedsNeeded: number }`. The helper is the single derivation point; both the card and the submit-time validator use it.

**Layer 3 — Step 1 → Step 2 submit: hard validation.**

The `disabled` on the "Next" button at the bottom of Step 1 currently checks some pre-distribution conditions. Extend it with one additional check:

```
const cartFitsGroup = distributedRoomCart.every((room, i) => {
  const type = roomTypes.find((t) => t.value === room.roomType);
  if (!type) return false;
  return requiredExtraBedsFor({
    numAdults: room.numAdults,
    numChildren: room.numChildren,
    maxCapacity: Number(type.maxCapacity) || 0,
    maxChildren: Number(type.maxChildren) || 0,
  }).requiredExtraBeds <= (Number(type.maxExtraBeds) || 0);
});
const totalFits = distributedRoomCart.reduce((sum, r) => sum + r.numAdults, 0) === numAdults
                && distributedRoomCart.reduce((sum, r) => sum + r.numChildren, 0) === numChildren;
```

The Next button stays disabled while `!cartFitsGroup || !totalFits`. The helper text under the cart renders a single error message: **"Room N ([type label]) maxes at [cap] children. Pick a different room type, add a second room, or remove a child."** with a small "Adjust room" CTA that scrolls to and highlights the offending room card.

The server's existing transaction validation (the `requiredExtraBedsFor` check inside `handleCreateBooking` and the `numAdults + numChildren === numGuests` check) is the authoritative gate — the client-side submit gate is UX feedback, not security. Per the standing rule in `plan/docs/GOTCHAS.md`, server-side is authoritative; client-side is advisory.

### What this changes for the existing CHDs

- **CHD-02** stays as the source of truth. `RoomTypeEntry.maxChildren` is still the per-type cap, still admin-editable (the MRB-15-10 fix made the admin surface work).
- **CHD-05** stays — the contract (server validates `numAdults + numChildren === numGuests`, adult + child caps enforced independently) doesn't change. Only the *layer* of enforcement on the client moves from the picker to the submit gate.
- **CHD-10** (breakfast includes children default) is unaffected.
- **EXB-01..10** stays — extra beds are the existing escape hatch for overflow; CHD-11 just stops blocking the picker from exploring the overflow path.

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

- `shared/__tests__/room-types.test.ts` (extend) — new `deriveRoomTypeCapacityFit` test cases: Single with 1 adult 0 children (fits), Single with 1 adult 1 child (doesnt-fit), Family with 2 adults 2 children (fits), Family with 3 adults 1 child (tight — 1 overflow adult + 0 overflow children = 1 extra bed), cart 2× Single with 1 adult 1 child (fits — sum of caps ≥ total).
- `guest-app/tests/api/chd-11-soft-constraint-picker.test.ts` (new) — source-text guards on `BookingPage.tsx`: the `+` button on the children stepper is no longer `disabled` when the count exceeds the single-type cap; the "You have reached this room type's limit" tail is gone; the new soft-cap text is present; the per-type capacity indicator renders all three states (Fits / Tight / Doesn't fit); the submit gate's `disabled` condition includes `!cartFitsGroup || !totalFits`; the error message renders with the room type label + cap + the "Adjust room" CTA; the existing `requiredExtraBedsFor` import is reused (no new client-side math).
- `guest-app/tests/api/chd-children-occupancy.test.ts` (existing) — re-verify CHD-05 contract is preserved (server still validates `numAdults + numChildren === numGuests`, server still rejects per-type overflow, legacy `numGuests > maxCapacity` check does not return).

### Phase 2 (deferred, NOT in this CHD-11)

- The "you'd need N of [type]" multi-room estimate on the room-type card. Useful but a larger UX work item; ship the single-room indicator first, then iterate.
- An automatic "add a second room" CTA that pre-fills the cart with the right room type when the indicator flips to "Doesn't fit" + single-room. The cart always requires explicit confirmation; don't auto-mutate user state.
- A breakfast-occupancy-aware capacity indicator (children who are breakfast-included count as a different unit for breakfast cost but not for capacity). Out of scope for CHD-11 — the capacity indicator uses physical occupancy only.

### Rejected alternatives

- **Keep the picker cap, add a "switch to family" CTA inside the warning.** Same dead-end, just dressed up. The constraint belongs at the cart, not at the picker.
- **Drop the per-type cap from the model entirely.** Removes the constraint, not the wrong enforcement. A Single is still a Single — `maxChildren: 0` is the operator's expression of the type's physical reality.
- **Move the cap to the room quantity stepper instead of the children picker.** Same problem, different surface. The guest would still hit a "you've reached the cap" dead-end, just when adjusting rooms instead of children.
- **Auto-add a second room when the picker crosses the single-type cap.** Surprises the user — the cart mutates under their hand. Bad UX. The indicator + the "Adjust room" CTA on submit is the user-respecting version.
- **Implement as a `useRoomTypeCapacityAdvisor` hook with a separate indicator component.** The derivation is small (5 lines of math, see `deriveRoomTypeCapacityFit` above) and the indicator is a single badge inside an existing card. The hook + component pattern is over-engineered for the size of the change. Re-evaluate if a second consumer (e.g. the corporate booking page or the admin New Booking modal) needs the same indicator — that's the right trigger to extract.
- **Add the soft cap (e.g. 10) to the picker but also gate the indicator's "Fits" state behind the same soft cap.** Mixing physical capacity with UI ergonomics — they have different reasons to exist. The soft cap is a "stop the + at 100" guard, the indicator is the "this room can fit your group" answer.

---

## Extra Bed (EXB-01..10)

Step 1 shows adults, children, and extra-bed steppers; extra beds appear only when the selected room type allows them and reset when the type changes. The shared overflow rule requires enough beds for adult and child occupancy above the type caps, while the server separately rejects counts above `maxExtraBeds`.

The server snapshots `extraBedRate` on creation and preserves that snapshot during reschedule. Extra-bed cost is count × snapshotted rate × nights and remains independent of breakfast occupancy. Step 3 displays it as its own add-on line. Hotel-wide inventory, when configured above zero, is enforced transactionally; the field currently has no admin Settings editor.

Coverage: room-type boundary tests, server cap guards, multi-night add-on tests, and `guest-app/tests/api/exb-09-rate-snapshotting-and-breakfast-coupling.test.ts`. See decisions #145, #153–#158 and `plan/docs/BACKEND.md` for the canonical data contracts.

---

## Cart-Style Summary (CHD-12)
> Proposed 2026-08-03, per decision #185. Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:2089-2115` (the current "Guest distribution" block). Follows CHD-11 in the same screen but a different concern — CHD-11 is about the *constraint surface*, CHD-12 is about the *cart display*.

### The problem

The current "Guest distribution" block on `/book` Step 1 lists one line per room in the cart:

```
Room 1 · Single Room           1 adult · 2 children
Room 2 · Standard Double Room  2 adults
Room 3 · Standard Twin Room    2 adults
Room 4 · Family Double Room    1 adult
```

Three reasons this is the wrong shape:

1. **The label says "distribution" but it's an auto-rebalance** — the system assigns 1 adult to each room and fills the rest. The user didn't choose "Room 4 · Family Double · 1 adult" — the algorithm did. So the label implies a user decision that never happened.
2. **The "Room 1 / Room 2 / Room 3 / Room 4" naming is positional and meaningless** — there's no way to tell which Single Room is "Room 1" vs "Room 2" in a cart with two of them. The type name is the real identifier; the index is filler.
3. **The per-room occupancy is the only actually useful info** — the rest is just "you have N rooms of type T". Showing the cart contents and the per-room occupancy as one line per type is denser and more scannable, especially for 3+ rooms where the current list starts to scroll.

### The pattern: one line per distinct room type, with the per-type occupancy inline

**Replace the "Guest distribution" section with a cart summary that mirrors the mental model "your cart is the source of truth, the per-room occupancy is derived from it":**

```
Your cart
  1× Single Room           1 adult · 2 children
  1× Standard Double Room  2 adults
  1× Standard Twin Room    2 adults
  1× Family Double Room    1 adult
```

(Or, for the common case of 1 of each, the format can compress to "4 rooms · 6 adults · 2 children" plus a small per-type chip strip. The spec leans toward the explicit per-type line because it makes the per-room occupancy visible without a second interaction — the chip strip is a Phase 2 micro-improvement.)

### Why this is better

- **One line per distinct type** — not one line per room. 4 Single Rooms = 1 line, not 4.
- **Per-room occupancy inline** — "1× Single Room · 1 adult · 2 children" tells you both the cart entry and the auto-rebalanced guest count in one read. No need to mentally join "1 of Single Room" with "Room 1 has 1 adult" + "Room 1 has 2 children" from a separate list.
- **The "Room N" naming goes away** — the type name is the real identifier.
- **Scannable for 3+ rooms** — the current list at 4 rooms already takes ~4 lines; for a 5-6 room group it's a wall.

### What this changes for the data model

**Nothing.** The auto-rebalance stays as the source of truth — `rebalanceGuestDistribution` in `guest-app/src/utils/bookingRoomCart.ts` is the function that computes the per-room occupancy. The change is purely the display layer — render `distributedRoomCart` as a per-type list grouped by `roomType`, summing the `numAdults` + `numChildren` within each type. No new user input, no new state, no new validation, no new helper.

### What this changes for CHD-11 (the soft-constraint picker)

**Slightly good news** — the cart summary is a natural home for the per-type **Fits / Tight / Doesn't fit** indicator from CHD-11. The current CHD-11 spec puts the indicator on the room-type card (the selector surface). With the cart summary, the same `deriveRoomTypeCapacityFit` derivation can also drive a small capacity chip on each cart line — so the user sees the capacity state both at the selection surface (the card) and at the cart surface (the summary). Same green/amber/red semantics, no new code in the helper.

The card-level indicator stays the primary surface (it's where the selection happens), the cart-line indicator is the secondary read (it's where the user verifies their cart fits). Both derive from the same pure helper.

### Edge cases

- **Two rooms of the same type** — "2× Standard Double Room · 4 adults" implies the sum of occupancy across both rooms. If the user wants per-room individuality (e.g. "1× Standard Double with 2 adults, 1× Standard Double with 1 adult + 1 child"), they can't — the auto-rebalance treats them symmetrically. That manual assignment is a bigger UX work item and stays out of scope (see "Phase 2 (deferred)" below).
- **Cart of 0 rooms** — the section is hidden (same as today).
- **Cart of 1 room** — the section shows one line. Still cleaner than the current "Room 1 · [type] · [count]" because the type name leads and the index doesn't appear.
- **Same type with mixed extras** (e.g. "2× Family Room, 1 with extra bed, 1 without") — the per-type line collapses the difference. Out of scope for CHD-12; aligns with the per-type-not-per-room extra-bed toggle in EXB-11 (the toggles are per-type, not per-room).

### Phase 2 (deferred, NOT in CHD-12)

- A per-room individual toggle for extra beds (vs. the per-type toggle in EXB-11). The cart line would then show the breakdown by room: "1× Family Room (Room 1: 1 extra bed, Room 2: 0 extra beds)". A real UX work item — ship per-type first, then iterate.
- A manual per-room occupancy assignment (let the user drag-and-drop adults/children across specific rooms). Out of scope for the post-MRB reservation-scope work; a future CHD-13.
- The compressed "N rooms · X adults · Y children" header line + per-type chip strip variant. Pure styling — the explicit per-type line is the primary form.

### Rejected alternatives

- **Keep the "Guest distribution" list, just rename to "Your rooms"** — same dead-end naming, just relabeled. The auto-rebalance result is still showing as if the user chose it.
- **One line per room (per the current shape) but rename "Room N" to the booking's `roomId`** — leaks server-assigned identity into the draft surface (the room isn't assigned until booking creation). The user shouldn't see `roomId` at this stage.
- **Show only the cart contents, no per-room occupancy** — loses the useful "1 adult + 2 children" signal. The occupancy is the whole reason the cart summary needs to exist as more than a numeric total.
- **Auto-collapse identical room types into a single line with a "+N more" expansion** — clever but adds a click. The explicit per-type line is more scannable for the common case.
- **Add the CHD-11 capacity indicator only to the cart line, not the card** — the card is the *action* surface (where the user picks the type + quantity), the cart is the *read* surface (where the user verifies the cart fits). The indicator belongs on both.

---

## User-Controlled Extra Bed Toggle (EXB-11)
> Proposed 2026-08-03, per decision #186. Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:2270-2290` (the current "Rooms" stepper block on the room-type card). Follows EXB-01..10 in the extra-bed system; same screen as CHD-11 + CHD-12.

### The problem

The current extra-bed flow auto-requires extra beds based on the overflow rule. If 3 adults pick a Single Room (max 1 adult, maxExtraBeds 1), the system requires 2 extra beds and silently adds them to the cart — there's no point where the user is asked "do you want an extra bed here?" or sees the per-bed-per-night price until the Step 3 review. Three reasons this is the wrong shape:

1. **The user is in control of the cart, not the system** — if the user wants 2 extra beds (one in each of 2 Single Rooms), the auto-rebalance has to guess. The guess is usually right but it's still a guess.
2. **The price is hidden until Step 3** — the user can't see "this will cost ₱X extra" until the review screen. Surprises on a money decision are bad UX.
3. **Extra beds are a real product** — the operator has set a `maxExtraBeds` per type and a `extraBedRate` per bed per night. The guest should see this as an opt-in add-on, like breakfast, with the price visible at the point of decision.

### The pattern: per-type counter (0..maxExtraBeds) with the rate and stay cost inline

**On each room-type card, add a small "Extras" sub-section below the room description and above the "Rooms" stepper:**

```
┌──────────────────────────────────────────┐
│ Single Room                              │
│ Up to 1 adult · 0 children               │
│                                          │
│ Extras:                                  │
│   Extra beds  [−] 0 [+]   ₱500/bed/night │
│                               ₱0 for 2 nights │
│                                          │
│ Rooms    [−] 0 [+]                        │
│ Up to N available                        │
└──────────────────────────────────────────┘
```

The control is a **counter (0..maxExtraBeds)** rather than a binary toggle because:

- `maxExtraBeds` can be 1, 2, 3, or up to 5 (per the admin Edit form's `max={5}`).
- The required overflow can be > 1 (3 adults in a Single = 2 extra beds required).
- A counter naturally subsumes the binary case (when `maxExtraBeds === 1`, the counter reads as on/off).
- The shape is consistent with the existing Adults / Children steppers (same `−` / counter / `+` UI affordance, same 44px touch target, same `aria-label` + `aria-live="polite"` pattern).

### The soft-floor pattern: counter min is `max(0, requiredExtraBeds)`

If the user's group has overflow that the room type's `maxExtraBeds` can't cover, the counter is clamped at the soft floor:

```
Extras:
  Extra beds  [−] 2 [+]   ₱500/bed/night
                          ₱1,000 for 2 nights

  ⚠ Room needs 2 extra beds to fit your group. You can add up to 1 here.
```

The `[−]` is disabled at the soft floor (clamped at `max(0, requiredExtraBeds)`). The `[+]` is disabled at the soft ceiling (`maxExtraBeds`). The user can still scroll up to see the room-type card's CHD-11 capacity indicator (Fits / Tight / Doesn't fit) and the submit gate catches the overflow at Step 1 → Step 2.

The cart summary (CHD-12) shows the per-type extra-bed count inline: "1× Single Room · 1 adult · 2 children · 2 extra beds".

### What the toggle shows

- **Per-bed-per-night rate** — `formatPrice(extraBedRate) + " / bed / night"`, pulled from the type's `extraBedRate` field (EXB-01).
- **Stay total** — `formatPrice(extraBedRate * extraBedCount * numNights) + " for " + numNights + " nights"`. Hidden when `extraBedCount === 0` (don't show "₱0 for 2 nights" — it's noise).
- **Soft-floor warning** — "Room needs N extra beds to fit your group" when `requiredExtraBeds > 0` and `requiredExtraBeds < extraBedCount` (the counter is above the soft floor but the room still doesn't have enough capacity to cover the overflow at the type's cap).

### What the toggle does NOT do

- **No auto-add of extra beds** — the user is in control. If they need 2 extra beds to fit 3 adults in a Single and `maxExtraBeds === 1`, the system surfaces the constraint (CHD-11 capacity indicator + soft-floor warning + submit-gate error) and lets the user decide: pick a different room, add a second room, or remove a guest.
- **No auto-remove** — if the user manually sets extra beds to 0 when overflow requires > 0, the system surfaces the constraint (soft floor) but does NOT auto-bump. The cart mutates only on explicit user action.

### What this changes for the data model

**Nothing.** `room.extraBedCount` is already a per-room field in the cart shape (`distributedRoomCart[i].extraBedCount` per the cart type). The change is:
- `extraBedCount` becomes a per-type value the user sets (0..maxExtraBeds), mirrored onto each room of that type in the cart.
- The auto-rebalance's `requiredExtraBeds` becomes a soft floor on the counter, not an auto-set.

The `Booking.extraBedCount` server-side write is unchanged — the cart still writes the same per-room count.

### What this changes for EXB-01..10

**EXB-01..10 contract preserved** — `maxExtraBeds` is still the per-type cap (admin-editable, the MRB-15-10 fix made the admin surface work), `extraBedRate` is still the per-bed-per-night rate (server-snapshotted at create), the overflow rule still applies (server validates the count), Step 3 still shows the extra-bed add-on line. EXB-11 only changes the *client-side selection surface* — the user is now in control of the extra-bed count, not the system.

### Edge cases

- **`maxExtraBeds === 0`** — the entire "Extras" sub-section is hidden. The room type doesn't offer extra beds; nothing to toggle.
- **`maxExtraBeds === 1`** — the counter effectively becomes a toggle (0 or 1). Same shape, same UX, same minimum-touch interaction.
- **`maxExtraBeds > 1` and no overflow** — the counter starts at 0, the `[+]` is enabled up to `maxExtraBeds`, the stay total is hidden (no extra beds yet).
- **`maxExtraBeds > 1` and overflow > 1** — the counter starts at `requiredExtraBeds` (clamped at `maxExtraBeds`); if `requiredExtraBeds > maxExtraBeds`, the soft-floor warning fires and the submit gate catches the over-cap case.
- **Per-type vs per-room** — the toggle is per-type: if the user has 2× Single Room and toggles "Extra beds: 1", both Singles get 1 extra bed. The per-room case (1 extra bed in one Single, 0 in the other) is a Phase 2 follow-up (see below).
- **Breakfast occupancy** — extra beds don't affect the breakfast occupancy. The existing EXB-01 contract is preserved: extra-bed cost is independent of breakfast cost.

### Phase 2 (deferred, NOT in EXB-11)

- **Per-room individual extra-bed toggles** — let the user add an extra bed to one Single but not the other. The cart summary would then show the breakdown by room. The current "Extras" sub-section becomes a small expandable list per room in the cart. A real UX work item; ship per-type first.
- **A "you'd need N extra beds to fit your group" callout on the room-type card** — the per-type callout that mirrors the CHD-11 capacity indicator. Same `deriveRoomTypeCapacityFit` helper can power this; out of scope for EXB-11.
- **A "best fit" suggestion** — if the user has overflow that no single room type can cover, suggest a specific room-type combination (e.g. "Consider 2× Standard Twin with 1 extra bed each — fits 4 adults and 2 children"). A real recommendation engine; out of scope for EXB-11.

### Rejected alternatives

- **Binary toggle (0 or maxExtraBeds)** — too coarse. `maxExtraBeds` can be > 1, and the user might want exactly 1 (not all-or-nothing).
- **Auto-add extra beds to cover the overflow** — the current behavior; the user is asking to flip it. The auto-rebalance is a guess; the user knows their group better than the algorithm.
- **Hide the price until Step 3** — the current behavior; the user is asking to surface it. Hidden prices on a money decision are a known UX anti-pattern.
- **A "Breakfast / Extra bed / Voucher" add-on bundle selector** — combines too many unrelated choices into one widget. Each add-on is its own opt-in with its own price; combine them later if the data shows users want it.
- **A separate "Extras" page / modal** — over-engineered for a 1-line counter. The card-level sub-section is the right surface.
- **Show the per-bed-per-night rate only on hover / "more info"** — hidden prices are the problem this spec is solving. The rate is the primary signal, not a detail.
- **Apply the toggle to the cart summary (CHD-12) instead of the room-type card** — the card is the *action* surface (where the user picks the type + quantity), the cart is the *read* surface (where the user verifies the cart). The toggle belongs on the card; the cart summary mirrors the result.

---

## EXB-11.1 — Bottom-of-Card Placement + Checkbox for `maxExtraBeds === 1`
> Proposed 2026-08-04, per decision #189. Spec-only — no code yet. Two refinements to the EXB-11 "Extras" sub-section on `/book` Step 1: **(1) move the sub-section to the bottom of the card** (after the rate options + mixed-rates panel) and **(2) render a binary checkbox instead of a counter when `maxExtraBeds === 1`** (the counter `[−] 0 [+]` is the wrong shape for a yes/no decision). The data model is unchanged: `room.extraBedCount: number`, the `rebalanceGuestDistribution` clamping, the `updateExtraBedCount` helper, the cart URL serialization, the Step 2/3 aside aggregation — all stay the same. Only the placement + render shape change. Same screen as EXB-11 (room-type card on `/book`). The "Rejected alternatives" entry from EXB-11 ("Binary toggle (0 or maxExtraBeds) — too coarse") is REVERSED for the `maxExtraBeds === 1` case: a counter is the wrong shape for a binary choice, the checkbox is the right shape.

### The problem (Part 1: placement)

The EXB-11 spec placed the "Extras" sub-section between the CHD-11 capacity chip and the "Rooms" stepper on each room-type card. After shipping v0.257.0, operator UX feedback on 2026-08-04 surfaced that this is the wrong layer: the user is forced to make the extras decision *before* they've chosen how many rooms or which rate — backwards from the natural scan order. The extras counter is an opt-in add-on (same shape as the breakfast add-on, which is in the rate-option layer); it belongs with the other add-on choices, grouped at the bottom of the card.

The current top-to-bottom order on a room-type card is: header → Fits/Tight/Doesn't fit chip → **Extras (wrong place)** → Rooms stepper → Room Only / Room + Breakfast → mixed-rates panel. The desired order: header → Fits/Tight/Doesn't fit chip → Rooms stepper → Room Only / Room + Breakfast → mixed-rates panel → **Extras (moved here)**. The placement change is a pure code move — same IIFE, different parent in the JSX tree.

### The problem (Part 2: counter for a binary choice)

When `maxExtraBeds === 1`, the EXB-11 counter `[−] 0 [+]` is the wrong shape. The user can only set 0 or 1 (the counter has 2 meaningful states), but the counter presents 3 affordances (decrement / display / increment) where 1 (the checkbox) would do. The spec's own "Rejected alternatives" entry acknowledged "Binary toggle (0 or maxExtraBeds) — too coarse" — but that rejection was framed for the *general* case where `maxExtraBeds` can be > 1. The *specific* case where `maxExtraBeds === 1` is precisely where a binary toggle is the right shape. A counter for a yes/no decision is a "wrong fit" UX that the user noticed.

A counter for the binary case also has a soft-floor enforcement problem the checkbox avoids cleanly: the EXB-11 soft floor disables the `[−]` when `count <= softFloor`. For a 0-or-1 counter, the `[−]` is disabled at count=1 (the only meaningful value), making the counter a single-click UI anyway. The checkbox makes that single-click explicit.

### The fix (Part 1: bottom-of-card placement)

Move the existing "Extras" IIFE from `BookingPage.tsx:2456-2565` (right after the CHD-11 capacity chip IIFE) to right after the mixed-rates panel (currently at `BookingPage.tsx:2620-2644`). The IIFE body is unchanged; only the JSX parent changes. The `data-testid` markers (`extras-stepper-${type.value}` + `extras-count-${type.value}` / `extras-checkbox-${type.value}` + `extras-stay-total-${type.value}` + `extras-soft-floor-warning-${type.value}`) stay the same (no test churn for the move alone).

**Discoverability hook**: the existing amenities row at `BookingPage.tsx:2348-2353` already shows "Up to N extra beds" for types with `maxExtraBeds > 0`. The visual cue is still at the top of the card, so the user knows the room type has an extra-bed option before they reach the bottom. The actual toggle lives at the bottom (where the action is) but the discoverability hint lives at the top (where the eye lands first). The `aria-label="${type.label} extras"` on the wrapper section means screen readers still land on the toggle when the user tabs through the card.

### The fix (Part 2: checkbox when `maxExtraBeds === 1`)

Add a branch in the Extras IIFE: if `typeMaxExtraBeds === 1`, render a checkbox + label + per-night price + stay total instead of the counter. The underlying `room.extraBedCount` stays a number (0 or 1) — only the rendered shape changes. `updateExtraBedCount` is unchanged (still takes 0 or 1 as `nextCount`).

The new checkbox shape:
- `<input type="checkbox" id="extras-checkbox-${type.value}" data-testid="extras-checkbox-${type.value}" />`
- `<label for="extras-checkbox-${type.value}">` containing "Add an extra bed" + the per-night price inline ("Add an extra bed · ₱500 / bed / night")
- The `[−] 0 [+]` counter is gone for this case (the `data-testid="extras-count-${type.value}"` testid is also gone for this case — the checkbox replaces it as the testable surface)
- The stay total + soft-floor warning render the same as the counter case (the data is 0 or 1 either way; the `extras-stay-total-${type.value}` + `extras-soft-floor-warning-${type.value}` testids stay)

**Soft-floor enforcement for the checkbox case** (3 states):

  - **`softFloor === 0`** (no overflow; the user is free to choose): checkbox `unchecked`, `enabled`. The user clicks to toggle 0 ↔ 1. The per-night price + stay total update on toggle.
  - **`softFloor === 1`** (overflow exactly matches the cap; the user MUST have the extra bed): checkbox `checked`, `disabled` (with `aria-describedby="extras-soft-floor-warning-${type.value}"` pointing at the warning text). The user can't uncheck it because the room doesn't fit without the bed. The visual is a grayed-out checked box — clear "this is on, and it has to be" affordance.
  - **`overCap`** (`softFloor > maxExtraBeds`, e.g. 3 adults in a Single with `maxExtraBeds 1` → soft floor 2, cap 1): checkbox `checked`, `disabled`, the soft-floor warning text "This room needs 2 extra beds to fit your group. You can add up to 1 here." renders below. Same as the EXB-11 over-cap case for the counter.

**The new `if/else` switch inside the IIFE** (sketch):

```ts
if (typeMaxExtraBeds === 0) return null;        // EXB-11: hidden
if (typeMaxExtraBeds === 1) {
  // EXB-11.1: checkbox branch
  // ... <input type="checkbox" data-testid={`extras-checkbox-${type.value}`} />
  //     <label>Add an extra bed · {per-bed-per-night price}</label>
  //     stay total (same as counter case)
  //     soft-floor warning (same condition, same text, same testid)
} else {
  // EXB-11: counter branch (typeMaxExtraBeds >= 2)
  // ... existing `[−] count [+]` stepper
}
```

### What this changes for EXB-11

  - **Placement**: the existing IIFE moves ~30 lines down in the JSX tree. Same parent chain shape, different sibling. No state, no helper, no model change.
  - **Render branch for `maxExtraBeds === 1`**: the IIFE returns a different JSX block. The `extras-count-${type.value}` testid is replaced by `extras-checkbox-${type.value}`. All other testids stay.
  - **Data model**: unchanged. `room.extraBedCount: number` (0 or 1 for the checkbox case; 0..maxExtraBeds for the counter case). `rebalanceGuestDistribution` clamping unchanged. `updateExtraBedCount(typeValue, 0|1, maxExtraBeds)` unchanged. The cart URL serialization (`rooms=`) unchanged. The Step 2/3 aside aggregation unchanged. The per-type cart summary pill unchanged. The server-side create transaction unchanged.
  - **Source-text tests** in `guest-app/tests/api/exb-11-user-controlled-extra-bed-toggle.test.ts`: the existing tests pin the counter shape + soft-floor + over-cap + stay total + cap = 0 hide. They still apply — only for the `maxExtraBeds >= 2` branch. EXB-11.1 adds ~6 new tests pinning the checkbox branch + the placement + the disabled-when-soft-floor-states. See "Tests" below.
  - **Discoverability hook at `BookingPage.tsx:2348-2353`**: the "Up to N extra beds" line in the amenities row stays. The N value comes from `type.maxExtraBeds`, which still works for `maxExtraBeds === 1` (renders "Up to 1 extra bed" — singular, per the existing pluralization).

### What this does NOT change

  - The data model is unchanged. `room.extraBedCount: number` stays; the `0..maxExtraBeds` range stays; the cart serialization stays.
  - The `rebalanceGuestDistribution` clamp is unchanged. The `updateExtraBedCount` helper is unchanged.
  - The CHD-12 cart summary's per-type extra-bed count inline ("1× Family Room · 2 adults · 2 children · 2 extra beds") is unchanged — the data is the same, the placement move doesn't affect the cart surface.
  - The CHD-11 capacity chip is unchanged. The Fits/Tight/Doesn't fit chip stays at the top of the card, right after the header.
  - The Step 2/3 aside extra-bed pill is unchanged.
  - The server-side create transaction's `extraBedCount` validation + rate snapshot is unchanged (per EXB-01..10 contract).

### Edge cases

  - **`maxExtraBeds === 0`** — section hidden (per EXB-11). Unchanged.
  - **`maxExtraBeds === 1`, 0 rooms of this type in the cart** (`typeQuantity === 0`) — checkbox renders but is `disabled` (same as the counter's "both buttons disabled" case in EXB-11); the user has to add a room first. The helper text "Add at least one room to set extra beds" still renders (the spec's `typeQuantity === 0` guard in the EXB-11 IIFE covers both branches).
  - **`maxExtraBeds === 1`, 1+ rooms, `softFloor === 0`** — checkbox unchecked, enabled, no warning.
  - **`maxExtraBeds === 1`, 1+ rooms, `softFloor === 1`** — checkbox checked, disabled, no warning (the chosen value already matches the soft floor; no over-cap message needed). The disabled state is the "you must have this" affordance.
  - **`maxExtraBeds === 1`, 1+ rooms, `overCap`** (`softFloor > 1`) — checkbox checked, disabled, soft-floor warning renders below. Same warning text as the counter case.
  - **`maxExtraBeds >= 2`** — counter shape (EXB-11 unchanged). Counter soft-floor still works.
  - **Race between two operators uploading the same room type's photos** — unrelated to this spec; the MRB-15-11 `runTransaction` fix handles that.

### Tests

  Extend `guest-app/tests/api/exb-11-user-controlled-extra-bed-toggle.test.ts` (source-text guards per `plan/docs/CONTRIBUTING.md §Testing` — cheap, deterministic, <5s). The behavioural emulator test (the user toggles the checkbox / counter on a real room type, sees the per-night price + stay total update) is out of scope for this sandbox.

  New source-text guards (one tripwire per contract point):
    - **Placement**: the Extras IIFE appears AFTER the mixed-rates panel and the rate options in the JSX tree (not between the CHD-11 capacity chip and the Rooms stepper). Sliced by anchoring on the IIFE's `data-testid="extras-stepper-${type.value}"` marker + asserting that the slice's preceding-sibling block ends with the `</div>` of the mixed-rates panel + the rate options.
    - **Counter branch (`maxExtraBeds >= 2`)**: existing tests still pass. EXB-11's tests pin the counter shape + soft-floor + over-cap; they apply to the `else` branch of the new switch.
    - **Checkbox branch (`maxExtraBeds === 1`)**: the slice contains `<input type="checkbox"` + `data-testid={`extras-checkbox-${type.value}`}` + a `<label for={`extras-checkbox-${type.value}`}>` containing "Add an extra bed" + the per-night price. The slice does NOT contain `data-testid={`extras-count-${type.value}`}` (the counter testid is gone in this branch).
    - **Checkbox disabled-when-soft-floor-1**: the slice contains `disabled={... || softFloor >= 1 || ...}` (or equivalent expression) for the checkbox. The exact condition: `userExtraBeds === 0 && softFloor === 1` (forced on) OR `softFloor > 1` (over-cap forced on). The implementation may use a single expression like `disabled={typeQuantity === 0 || (softFloor >= 1 && userExtraBeds < softFloor)}`.
    - **Checkbox default-checked-when-soft-floor-1**: `defaultChecked={... || softFloor >= 1 || ...}`. Same expression shape.
    - **The switch**: the IIFE contains `if (typeMaxExtraBeds === 1)` (or `=== 0` then `=== 1` then `>= 2`) that branches the render.
    - **Helper text for `typeQuantity === 0`** still renders in both branches (the EXB-11 "Add at least one room to set extra beds" message is outside the inner if/else so it covers both counter and checkbox).
    - **Stay total + soft-floor warning** render the same way in both branches (the `extras-stay-total-${type.value}` + `extras-soft-floor-warning-${type.value}` testids + their text shape are shared).

  Re-verify the existing `exb-11-user-controlled-extra-bed-toggle.test.ts` (16 source-text tests still pass — the counter branch is unchanged). Re-verify `chd-11-soft-constraint-picker-and-cart-summary.test.ts` (the CHD-11 capacity chip at the top of the card is unchanged) and `chd-05-guest-child-cap.test.ts` (the URL contract is unchanged).

### Rejected alternatives

  - **Always render the counter, never the checkbox** (the EXB-11 default) — wrong shape for the binary case. The counter for `maxExtraBeds === 1` is a 3-affordance UI for a 2-state decision; the checkbox is a 1-affordance UI for the same decision. The user noticed the wrong fit.
  - **Always render the checkbox, even for `maxExtraBeds > 1`** — wrong shape for the N-ary case. Per EXB-11's "Binary toggle (0 or maxExtraBeds) — too coarse" rejection: the user might want exactly 1 (not all-or-nothing) for a 2+ room type, and the checkbox forces 0/1. The counter is the right shape for N >= 2.
  - **A "dropdown" with 0/1/2/3 options for `maxExtraBeds <= 3`** — the counter is a more direct control (one click for increment vs. two clicks for dropdown-open + option-select). The dropdown adds a click before the click. Out of scope.
  - **A "radio" group (0 / 1) for `maxExtraBeds === 1`** — radio is for "pick one of N where N >= 3". For a yes/no decision, the checkbox is the right shape (semantically "is it on?"). The screen reader + keyboard semantics differ: radio requires arrow-key navigation between options, checkbox is a single tap.
  - **Keep Extras at the top of the card (between the CHD-11 chip and the Rooms stepper)** — the placement reasoning in "The problem (Part 1: placement)" above. The discoverability is handled by the amenities row; the action is at the bottom.
  - **A combined "Add-ons" section that bundles Extras + Breakfast + Voucher** — out of scope (rejected in EXB-11's "Rejected alternatives" for the same reason — combines too many unrelated choices into one widget). The rate option (with breakfast) is the natural breakfast surface; Extras is a per-room-type opt-in (independent of rate choice); Voucher is a Step 3 discount. Three separate surfaces.
  - **Hide the checkbox when `typeQuantity === 0`** (vs. render-but-disabled) — same trade-off as the EXB-11 "render counter but disable both buttons" choice. The render-but-disabled form keeps the section in the layout (no CLS when the user adds a room) and surfaces the helper text "Add at least one room to set extra beds" immediately.

### Gates

  - **EXB-11** — the underlying contract is unchanged (per-room `extraBedCount: number`, the per-type mirror via `updateExtraBedCount`, the soft-floor derived from `requiredExtraBedsFor`, the per-cart aggregation). Only the placement + render branch for the `maxExtraBeds === 1` case change.
  - **EXB-01..10** — server-side contract is unchanged. The cart writes the same per-room `extraBedCount`. The server still validates against `maxExtraBeds` and snapshots `extraBedRate` onto the booking doc. The Step 3 add-on line is unchanged.
  - **CHD-11** — the capacity chip is at the top of the card (unchanged). The Extras move doesn't touch the chip.
  - **CHD-12** — the per-type cart summary's "N extra beds" inline pill is unchanged (the data is the same; the surface just renders it from the same cart field).
  - **MRB-15-10** — the admin surface for editing `maxExtraBeds` and `extraBedRate` is the input side. EXB-11.1 only changes the *client-side selection surface* (placement + checkbox branch).
  - **MRB-15-11** — unrelated (photo gallery, not extras toggle). The two specs are independent.

### Phase 2 (deferred, NOT in EXB-11.1)

  - **Per-room individual extra-bed toggles** — let the user add an extra bed to one Single but not the other. Carried over from EXB-11's Phase 2 list. A real UX work item; ship per-type first, then iterate.
  - **A "you'd need N extra beds to fit your group" callout on the room-type card** — the per-type callout that mirrors the CHD-11 capacity indicator. Carried over from EXB-11's Phase 2 list. Same `deriveRoomTypeCapacityFit` helper can power this.
  - **A "best fit" suggestion** — recommend a specific room-type combination when the user's group can't fit any single room. Carried over from EXB-11's Phase 2 list. A real recommendation engine; out of scope.
  - **A "Set as hero" drag-to-front interaction on the first photo** — out of scope (the photo gallery's first-photo-is-hero contract is implicit; an explicit drag-to-front is a separate UX work item, mentioned in MRB-15-11's Phase 2 list).

---

## EXB-11.2 — Auto-Initiate Extra Bed Count to Soft Floor
> Proposed 2026-08-04, per decision #190 (operator feedback on the EXB-11.1 shipped surface). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:2562-2735` (the Extras IIFE; both the checkbox branch for `maxExtraBeds === 1` and the counter branch for `maxExtraBeds >= 2`). Sibling to EXB-11 + EXB-11.1 — same surface, different bug fix.

### The problem

Operator-reported 2026-08-04 (post-EXB-11.1): "for a single room that can only have 1 max person but can add 1 extra bed, when I put 2 guests, it doesn't allow me to add an extra bed." The reproduction: 1 Single Room (`maxCapacity: 1`, `maxExtraBeds: 1`), 2 guests (e.g. 2 adults, or 1 adult + 1 child). The system computes `softFloor = 1` (1 overflow adult + 0 overflow children = 1 required extra bed), but the cart has 0 extra beds. The checkbox renders as `unchecked + disabled` — the user can't click to enable it (disabled), and the cart is silently at 0.

**Root cause.** The EXB-11.1 spec explicitly rejected auto-init ("the CHD-11 submit gate catches the over-cap; simpler than the auto-init path") — but the consequence is the visual and the cart get out of sync when the soft floor exceeds the cart value. The spec's "checked + disabled" affordance (per EXB-11.1's 3-state soft-floor model) requires `checked = true`, which requires `userExtraBeds >= softFloor`, which the user must reach. The current disabled rule `disabled = (userExtraBeds === 0 && softFloor >= 1)` blocks the user from reaching it via the UI, while the soft-floor warning text only fires when `overCap` (i.e. `softFloor > maxExtraBeds`). The user is stuck in an unreachable state.

The counter branch has the same shape (less visible): Family Room with 5 adults (`maxCapacity: 4`, `maxExtraBeds: 2`, soft floor 1). Counter shows 0, `[−]` is disabled (because `0 <= 1`), `[+]` is enabled. The user CAN click `[+]` to add — but the visual still shows 0 when the system requires 1, and the `[−]` disabled condition fires too early (below the floor, not at it).

### The fix — auto-init the cart to the soft floor + use a derived display value

**Two-part change to the Extras IIFE in `BookingPage.tsx`:**

**1. Auto-init via `useEffect`.** A component-level `useEffect` (placed before the return) loops over the cart's `roomCart` and, for each type, checks whether `softFloor > userExtraBeds && typeQuantity > 0`. If so, it calls `updateExtraBedCount(type.value, softFloor, typeMaxExtraBeds)` to sync the cart to the floor. The effect's dependency array is `[numAdults, numChildren, roomCart, roomTypes]` — it re-fires when the guest count, the cart, or the room types change. After the first fire, the cart has the soft-floor value, and the effect's next run sees `userExtraBeds >= softFloor` and is a no-op (no infinite loop).

**2. Derived display value.** Inside the IIFE, compute `const displayExtraBeds = Math.max(softFloor, userExtraBeds)`. Use `displayExtraBeds` (not `userExtraBeds`) for the visual: the checkbox `checked = displayExtraBeds === 1`, the counter shows `displayExtraBeds`, the `[−]` is disabled when `displayExtraBeds <= softFloor`, the `[+]` is disabled when `displayExtraBeds >= typeMaxExtraBeds`. This prevents the brief "0 → 1" flash on first render (the useEffect fires AFTER the first render, but the derived value is correct on the first render).

**What the user sees now:**

- **Single Room (maxExtraBeds: 1), 2 guests** — soft floor 1, cart auto-inits to 1. Checkbox renders `checked + disabled` (the "forced on" affordance per EXB-11.1's 3-state model). The soft-floor warning text (`aria-describedby` target) explains why it's forced on.
- **Single Room, 1 guest** — soft floor 0, cart stays at 0. Checkbox renders `unchecked + enabled`. No auto-init fires (the condition is `softFloor > userExtraBeds`).
- **Family Room (maxExtraBeds: 2), 5 adults** — soft floor 1, cart auto-inits to 1. Counter shows 1, `[−]` is disabled (at the floor), `[+]` is enabled (can add up to 2). The user can still increment to 2; the auto-init only enforces the floor, not the cap.
- **Family Room, 4 adults** — soft floor 0, cart stays at 0. Counter shows 0, both buttons enabled. No auto-init.
- **Family Room, 6 adults** — soft floor 2, cart auto-inits to 2. Counter shows 2, both buttons disabled (at the cap). The over-cap warning text also fires (6 adults with maxCapacity 4 → 2 overflow adults, maxExtraBeds 2 → soft floor 2 = cap, NOT over-cap; but 6 adults with maxCapacity 3 → 3 overflow adults, maxExtraBeds 2 → soft floor 3 > cap 2 = over-cap; the warning fires).

**The auto-init is silent.** No "We added an extra bed for you" message. The `checked + disabled` checkbox + the existing soft-floor warning text (`aria-describedby` for the checkbox, visible text for the counter's over-cap case) are enough explanation. A "we added this" message reads as patronizing and the EXB-11 spec's "no auto-add of extra beds" was specifically about hiding the user's intent — this auto-init only enforces the FLOOR (the minimum required for the group to fit), not the cap. The user can decrement back to 0 if the soft floor drops (e.g. they change guest count from 2 to 1).

### Why this changes the "no auto-init" stance from EXB-11.1

The EXB-11.1 spec said: "Did NOT add auto-init in `updateRoomQuantity` (the spec doesn't require it). User can be in state where cart is 0 but softFloor = 1 — submit gate catches the over-cap. Simpler than the auto-init path." That reasoning was wrong in two ways:

1. **The visual can't be honest without auto-init.** The EXB-11.1 spec ALSO says the soft-floor state for the checkbox case is "checked + disabled" — but `checked` reads from the cart, and the cart is at 0. The only way to make the visual match the spec is to either (a) auto-init the cart, or (b) decouple the visual from the cart via a derived value (which creates a display/cart mismatch that the submit gate then has to defend against). Auto-init is the cleaner of the two.
2. **The submit gate catches it, but the UX is broken in the meantime.** The user can't reach the correct cart state via the UI, so the only path to a valid cart is to (a) notice the submit-gate error, (b) read the error message, (c) understand that they need an extra bed, (d) navigate back, (e) try again. The auto-init makes the correct state the DEFAULT state — the user only has to do something if they want to deviate from the system requirement.

The new stance: **auto-init enforces the floor; the user is still in control of the cap**. The system says "you need at least N extra beds for your group; you can have up to M." The user can decrement back to 0 only if the soft floor drops (e.g. they reduce the guest count), and the useEffect re-fires to re-init.

### What this changes for the data model

**Nothing.** The `room.extraBedCount: number` field stays. The `updateExtraBedCount` helper is unchanged (it's the mechanism the useEffect calls). The cart URL serialization (`rooms=`) is unchanged. The per-type cart summary pill is unchanged. The Step 2/3 aside is unchanged. The server-side validation is unchanged. The only change is that the cart is auto-synced to the soft floor on render (via useEffect), so the user is never in a state where the cart is below the floor.

### What this changes for the related work

- **EXB-11 + EXB-11.1** — the underlying contract is unchanged. The same `requiredExtraBedsFor` helper derives the soft floor; the same `updateExtraBedCount` helper writes to the cart; the same `room.extraBedCount` field stores the value. EXB-11.2 only adds an auto-sync useEffect + a derived display value.
- **EXB-01..10** — server-side contract is unchanged. The cart writes the same per-room `extraBedCount`. The server still validates against `maxExtraBeds` and snapshots `extraBedRate`. The Step 3 add-on line is unchanged.
- **CHD-11** — the capacity chip is at the top of the card and is unchanged. The Extras move + auto-init doesn't touch the chip.
- **CHD-12** — the per-type cart summary's "N extra beds" inline pill is unchanged (the data is the same; the surface just renders it from the same cart field). The auto-init means the pill will show the soft-floor value for the "Single Room, 2 guests" case (1) instead of 0.
- **MRB-15-10** — the admin surface for editing `maxExtraBeds` and `extraBedRate` is the input side. EXB-11.2 only changes the *client-side selection surface* (the auto-init).
- **MRB-15-11** — unrelated (photo gallery, not extras toggle).
- **CHD-13** — unrelated (homepage search widget, not the /book extras toggle).

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

Extend `guest-app/tests/api/exb-11-user-controlled-extra-bed-toggle.test.ts` (the existing EXB-11 + EXB-11.1 source-text test file) with a new `describe` block for EXB-11.2:

- The IIFE defines a derived `displayExtraBeds = Math.max(softFloor, userExtraBeds)` (NOT `userExtraBeds` directly).
- The checkbox `checked` is bound to `displayExtraBeds === 1` (NOT `userExtraBeds === 1`).
- The counter display `<span>` reads `displayExtraBeds` (NOT `userExtraBeds`).
- The counter `[−]` disabled is `displayExtraBeds <= softFloor` (NOT `userExtraBeds <= softFloor`).
- The counter `[+]` disabled is `displayExtraBeds >= typeMaxExtraBeds` (NOT `userExtraBeds >= typeMaxExtraBeds`).
- The checkbox `disabled` is `typeQuantity === 0 || softFloor >= 1` (the "forced on" rule, NOT the old `userExtraBeds === 0 && softFloor >= 1` rule that blocked the user from clicking).
- A `useEffect` is present at the component level (NOT inside the IIFE) that loops over `roomCart` and calls `updateExtraBedCount(type.value, softFloor, typeMaxExtraBeds)` when `softFloor > userExtraBeds && typeQuantity > 0`.
- The `useEffect`'s dependency array includes `roomCart` (so it re-fires when the cart changes).
- The `useEffect` re-syncs the cart for every type in the cart that has `softFloor > userExtraBeds` (not just the first one — multi-type carts are common).

Also add a regression test for the EXB-11.1 spec's `rejected alternatives` list: the comment in `BookingPage.tsx` notes "no auto-init" was rejected in EXB-11.1; EXB-11.2 reverses that decision and the comment must be updated to explain the new behavior.

The behavioural test (the user adds a room + changes the guest count, the counter auto-inits to the soft floor) is out of scope for this sandbox.

### Rejected alternatives

- **Decouple visual from cart via derived value only, NO useEffect.** The visual would be correct, but the cart stays at 0. The submit gate would catch it (the server's `numAdults + numChildren > maxCapacity` validation), but the user has to navigate back and try again. Worse UX than auto-init. Also: the per-type cart summary pill in CHD-12 (which reads from the cart, not the visual) would show "0 extra beds" when the system requires 1, creating a display/cart mismatch the user can see.
- **Auto-init only in `updateRoomQuantity`** (when the user adds a room). Same problem — the soft floor is dynamic (it changes when the guest count changes, or when the user changes room type). A one-time auto-init on add doesn't cover the case where the guest count changes from 1 to 2 after the room is added. The useEffect covers all cases.
- **Auto-init via useEffect but with a toast notification ("We added an extra bed for your group").** A notification is patronizing. The user can see the `checked + disabled` checkbox + the soft-floor warning text — that's enough signal. The auto-init is silent and the user notices the change the same way they notice any other cart mutation (the per-type pill in the cart summary updates).
- **Auto-init via useEffect but to the soft floor MAX typeMaxExtraBeds** (i.e. clamp to the cap). Already covered by `updateExtraBedCount`'s `safeCount = Math.min(Math.max(nextCount, 0), maxCount)` clamp at `BookingPage.tsx:958`. The auto-init calls `updateExtraBedCount(type.value, softFloor, typeMaxExtraBeds)`, which already clamps to `[0, typeMaxExtraBeds]`. The `softFloor > typeMaxExtraBeds` case (overCap) is handled by the existing soft-floor warning text — the cart is clamped to the cap, the warning fires.
- **Show a "this is required" badge on the toggle instead of auto-initing.** Same UX problem as the original bug — the user has to click to enable, but the click is blocked by `disabled`. The badge is a label, not a fix.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - **Add a `useEffect` before the `return`** (around line 530, where the other effects live): `useEffect(() => { ... sync cart to soft floor for each type in the cart ... }, [numAdults, numChildren, roomCart, roomTypes])`.
  - **In the Extras IIFE (lines 2562-2735)**: add `const displayExtraBeds = Math.max(softFloor, userExtraBeds)`. Replace `userExtraBeds` with `displayExtraBeds` in the visual bindings (`checked`, the counter `<span>`, the `[−]` and `[+]` disabled conditions). Change the checkbox disabled condition from `(userExtraBeds === 0 && softFloor >= 1)` to `softFloor >= 1` (the "forced on" rule).
  - **Update the comment block** at the top of the IIFE (lines 2543-2561) to note that EXB-11.2 reverses the EXB-11.1 "no auto-init" stance.
  - The `updateExtraBedCount` helper at `BookingPage.tsx:957-971` is unchanged.
- No changes to the data model, the URL contract, the server-side validation, the Step 2/3 aside, or the per-type cart summary pill.

### Gates

- **EXB-11 + EXB-11.1** — the underlying contract is unchanged. The auto-init is a constrained `useEffect` that only fires when the soft floor exceeds the cart value, and only when the user has at least one room of the type.
- **EXB-01..10** — server-side contract is unchanged. The cart writes the same per-room `extraBedCount`. The server still validates against `maxExtraBeds` and snapshots `extraBedRate`.
- **CHD-11** — the capacity chip is at the top of the card and is unchanged.
- **CHD-12** — the per-type cart summary's "N extra beds" inline pill now reflects the auto-init value (the data is the same shape, just the initial value is the soft floor instead of 0).
- **MRB-15-10** — the admin surface for editing `maxExtraBeds` and `extraBedRate` is the input side.
- **MRB-15-11** — unrelated (photo gallery, not extras toggle).
- **CHD-13** — unrelated (homepage search widget, not the /book extras toggle).

### Phase 2 (deferred, NOT in EXB-11.2)

- **Auto-init on first render** (no flash). The current useEffect fires after the first render, so there's a brief moment where the visual shows `0` and the cart is `0`, then the effect fires and the visual + cart both show `1`. The derived value (`displayExtraBeds = Math.max(softFloor, userExtraBeds)`) prevents the visual flash, but the cart still has a brief `0` value. A future optimization could use a `useState` initializer to compute the initial cart from the URL params + the soft floor — out of scope for EXB-11.2.
- **A "1 extra bed added" toast notification on the first auto-init.** Rejected as patronizing; the `checked + disabled` checkbox + the existing soft-floor warning text are enough signal.
- **Auto-init the cart to `0` when the soft floor drops to `0`** (e.g. guest count changes from 2 to 1). Currently the auto-init only fires when `softFloor > userExtraBeds` (the floor rises above the cart), not when the cart exceeds a falling floor. The user can manually decrement back to 0. A future "auto-decrement on floor drop" optimization would mirror the auto-init — out of scope for EXB-11.2.

---

## EXB-11.4 — Revert Auto-Initiate Extra Bed Count; User Is in Full Control
> Proposed 2026-08-06, per decision #197 (operator feedback post-EXB-11.2 shipped surface). Files: `guest-app/src/pages/BookingPage.tsx:754-809` (the auto-init `useEffect` — removed) + the Extras IIFE (the `displayExtraBeds` derivation — removed; the checkbox + counter `[−]` disabled conditions — relaxed; the `aria-describedby` — aligned with the warning's actual render condition). Sibling to EXB-11 + EXB-11.1 + EXB-11.2 — same Extras sub-section on `/book`, different enforcement surface for the soft floor.

### The problem

The post-EXB-11.2 surface (current `main` as of 2026-08-06) has a UX anti-pattern that violates the EXB-11 "the user is in control of the cart, not the system" promise. The auto-init `useEffect` at `BookingPage.tsx:778-808` silently bumps the cart's per-type `extraBedCount` to the soft floor (the per-room overflow derived from `requiredExtraBedsFor`) whenever the soft floor exceeds the cart value. Combined with the EXB-11.2 checkbox `disabled = typeQuantity === 0 || softFloor >= 1` rule, the extra-bed checkbox renders as `checked + disabled` when the group needs the bed — and the user can't uncheck it. The counter case has the same issue (the auto-init bumps it to the soft floor too, so the counter starts at the soft-floor value instead of 0; the counter's `[−]` is also disabled at the soft floor, so the user can't go below).

Two specific symptoms the operator reported 2026-08-06:

1. **"It is ticked by default"** — for a Single Room (`maxExtraBeds: 1`) with 2 guests, the checkbox is `checked` even on first render, before the user has done anything. The user didn't choose to check it; the auto-init did.
2. **"I am unable to tick the extra bed"** — the user can't uncheck the checkbox (it's `disabled`), and can't increment/decrement the counter below the soft floor (the `[−]` is disabled at the soft floor). The user is stuck in a state they didn't choose.

**Root cause.** The EXB-11.2 design chose the wrong enforcement surface for the soft floor. The soft floor is a *constraint* (the group needs at least N extra beds to fit), but the EXB-11.2 surface turned it into a *choice* (the system silently sets the count to N). Three specific design choices from EXB-11.2 that violated the EXB-11 promise:

- **(a) The auto-init `useEffect`** — silently mutated the cart on every render where `softFloor > userExtraBeds`, without any user input. The effect ran on `[numAdults, numChildren, roomCart, roomTypes]` changes, so it would re-fire and re-bump the cart every time the user changed the guest count, the room count, or the room type. The user couldn't escape the auto-init by interacting with the toggle.
- **(b) The `displayExtraBeds` derivation** — decoupled the visual from the cart (the visual showed the soft floor, the cart was bumped to match), creating a derived state that hid the user's actual choice. The visual said "checked" (or "1" on the counter), the cart said "1", but neither reflected a user action.
- **(c) The `disabled = ... || softFloor >= 1` rule on the checkbox + the `disabled = ... || userExtraBeds <= softFloor` rule on the counter `[−]`** — enforced the soft floor at the UI layer, blocking the user from reaching a valid state they wanted to be in. The user who unticks the extra bed (or decrements the counter to 0) when the group needs it would be blocked by the `disabled` attribute.

The user is the one paying for the extra bed; the user should be the one choosing it. The EXB-11 spec's "the user is in control of the cart, not the system" promise was the right shape — EXB-11.2 reversed it; EXB-11.4 restores it.

### The fix — three-part revert + one a11y fix

**1. Delete the auto-init `useEffect` (lines 754-809).** The cart starts at 0 and stays at 0 until the user explicitly ticks the checkbox or increments the counter. The soft floor is still computed (for the over-cap warning text + the submit gate's `cartFitsGroup` check) but no longer feeds the cart. The `requiredExtraBedsFor` helper (used to derive the soft floor) is unchanged. The `updateExtraBedCount` helper (used to write the count to the cart) is unchanged — the user just no longer has the system calling it on their behalf.

**2. Drop the `displayExtraBeds` derivation.** The visual reads directly from `userExtraBeds` (the cart value) — no derived floor, no off-by-one between the visual and the price. The stay total reverts to `userExtraBeds * extraBedRate * nights` and the stay-total render gate reverts to `userExtraBeds > 0` (the EXB-11.1 spec). The counter display reverts to `userExtraBeds`. The checkbox `checked` reverts to `userExtraBeds === 1`. The counter onClick handlers revert from `displayExtraBeds ± 1` to `userExtraBeds ± 1`.

**3. Relax the checkbox + counter `[−]` disabled conditions.** The checkbox `disabled` reverts from `typeQuantity === 0 || softFloor >= 1` (the EXB-11.2 "forced on" affordance) to just `typeQuantity === 0` (the EXB-11.1 "no room to mirror the count onto" affordance). The counter `[−]` reverts from `typeQuantity === 0 || userExtraBeds <= softFloor` (the EXB-11.1 spec's soft-floor enforcement) to just `typeQuantity === 0` — the user can go below the soft floor freely. The counter `[+]` keeps the cap enforcement (`typeQuantity === 0 || userExtraBeds >= typeMaxExtraBeds`).

**4. Fix the `aria-describedby` (a11y fix).** The pre-EXB-11.4 checkbox `aria-describedby` was wired to `softFloor >= 1` (the soft-floor condition), but the warning text only renders on `overCap` (soft floor > cap). The `aria-describedby` now points to the warning only when the warning is on screen (`overCap`), so screen readers don't announce a non-existent element. This is a pre-existing bug from EXB-11.2 that EXB-11.4 fixes as part of the visual revert.

### What the user sees now

- **Single Room (`maxExtraBeds: 1`), 2 guests** — soft floor 1, cap 1, not over-cap. Cart starts at 0. Checkbox renders `unchecked + enabled` (was `checked + disabled`). The user can tick the box to add the bed (cart = 1), or leave it unticked and hit Continue → "Adjust room" CTA. The soft-floor warning does NOT fire (soft floor = 1, not over-cap; the cap matches the floor).
- **Family Room (`maxExtraBeds: 2`), 5 adults** — soft floor 1, cap 2, not over-cap. Cart starts at 0. Counter shows 0 (was 1). Both buttons enabled (the `[−]` was disabled at the soft floor pre-EXB-11.4; now enabled). The user can go from 0 → 1 → 2 freely.
- **3 adults in a Single Room (`maxExtraBeds: 1`)** — soft floor 2, cap 1, `overCap = true`. Cart starts at 0. Checkbox renders `unchecked + enabled`. The soft-floor warning fires: "Single Room needs 2 extra beds to fit your group. You can add up to 1 here." The user can tick the box (cart = 1) but the submit gate still blocks them (the group needs 2 beds, the cap is 1). The "Adjust room" CTA guides them to add a second room.
- **Family Room (`maxExtraBeds: 2`), 4 adults** — soft floor 0, cap 2, not over-cap. Cart starts at 0. Counter shows 0, both buttons enabled. No auto-init, no warning. The user adds a bed if they want; the system doesn't push them.

### Why this is the right shape

- **(1) Honest UI** — the checkbox's `checked` reads from the cart, the counter's display reads from the cart, the stay total reads from the cart. No derived state, no off-by-one between the visual and the price. The user sees exactly what they're going to pay for.
- **(2) User agency** — the user can tick/untick freely, increment/decrement freely, go to 0 even if the group needs the bed. The system doesn't make the choice; the user does.
- **(3) Submit gate as the validation surface** — per CHD-11's "exploration-first, validation-on-commit" pattern, the under-floor case is caught at Step 1 → Step 2 by the `cartFitsGroup` check (the Continue button is disabled with the "Adjust room" CTA). The user who unticks the extra bed and tries to continue sees the gate fire with a clear next-step.
- **(4) Over-cap warning still fires** — when `softFloor > typeMaxExtraBeds` (the group physically can't fit in the type's bed capacity), the soft-floor warning text renders below the toggle ("Room needs N extra beds to fit your group. You can add up to M here."). This is the case where the user's free choice is bounded by a real physical constraint, not a UI policy. The user can still tick the box (cart = cap) but the submit gate catches the over-cap case.
- **(5) A11y fix bundled in** — the `aria-describedby` is now aligned with the warning's actual render condition. Screen readers announce the warning when it's on screen, not when the soft floor condition fires (which was the pre-EXB-11.4 bug).

### What this changes for the data model

Nothing. `room.extraBedCount: number` stays. `updateExtraBedCount` helper is unchanged (still clamps to `[0, typeMaxExtraBeds]`). Cart URL serialization (`rooms=`) is unchanged. Per-type cart summary pill is unchanged (reads from the cart, which now starts at 0; the pill shows "0 extra beds" for the under-floor case, which is the honest signal). Step 2/3 aside aggregation is unchanged (`totalExtraBeds` still sums the per-room `extraBedCount`). Server-side validation is unchanged (the server still validates against `maxExtraBeds` and snapshots `extraBedRate`). The over-cap soft-floor warning text is unchanged. The submit gate's `cartFitsGroup` check is unchanged.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - **Remove the auto-init `useEffect` (lines 754-809).** The effect's body (loop over `roomCart`, compute soft floor per type via `requiredExtraBedsFor`, call `updateExtraBedCount(type.value, softFloor, typeMaxExtraBeds)` when `softFloor > currentExtraBeds && softFloor <= typeMaxExtraBeds`) is gone. The soft-floor `<= cap` infinite-loop guard added in the 2026-08-06 hotfix is moot.
  - **In the Extras IIFE**: drop the `displayExtraBeds = Math.max(softFloor, userExtraBeds)` derivation. The visual reads directly from `userExtraBeds`. The stay total becomes `userExtraBeds * typeExtraBedRate * nights`. The stay-total render gate becomes `typeQuantity > 0 && userExtraBeds > 0`.
  - **Checkbox branch**: `checked` reverts from `displayExtraBeds === 1` to `userExtraBeds === 1`. `disabled` reverts from `typeQuantity === 0 || softFloor >= 1` to just `typeQuantity === 0`. `aria-describedby` reverts from `softFloor >= 1 ? ... : undefined` to `overCap ? ... : undefined`.
  - **Counter branch**: display reverts from `displayExtraBeds` to `userExtraBeds`. `[−]` `disabled` reverts from `typeQuantity === 0 || displayExtraBeds <= softFloor` to just `typeQuantity === 0`. `[+]` `disabled` reverts from `typeQuantity === 0 || displayExtraBeds >= typeMaxExtraBeds` to `typeQuantity === 0 || userExtraBeds >= typeMaxExtraBeds`. The onClick handlers revert from `displayExtraBeds ± 1` to `userExtraBeds ± 1`.
  - **Update the IIFE comment block** at the top of the IIFE to document the new behavior (EXB-11.4 reverses the EXB-11.2 auto-init stance; the user is in full control; the soft floor is still computed for the over-cap warning + the submit gate).
- No changes to the data model, the URL contract, the server-side validation, the Step 2/3 aside, the per-type cart summary pill, or the `requiredExtraBedsFor` / `updateExtraBedCount` helpers.

### Gates

- **EXB-11** — the underlying contract is unchanged. The toggle is still per-type, the soft floor is still derived from `requiredExtraBedsFor`, the per-type mirror via `updateExtraBedCount` is unchanged.
- **EXB-11.1** — the placement + checkbox-for-`maxExtraBeds === 1` shape is unchanged. Only the auto-init is removed.
- **EXB-11.2** — the auto-init `useEffect` + `displayExtraBeds` derivation are removed. The soft-floor `<= cap` infinite-loop guard added in the 2026-08-06 hotfix is moot.
- **CHD-11** — the capacity chip is at the top of the card and is unchanged. The Extras move doesn't touch the chip.
- **CHD-12** — the per-type cart summary's "N extra beds" inline pill is unchanged. It reads from the cart, which now starts at 0; the pill shows "0 extra beds" for the under-floor case, which is the honest signal.
- **EXB-01..10** — server-side contract is unchanged. The cart writes the same per-room `extraBedCount`; the server still validates against `maxExtraBeds` and snapshots `extraBedRate`.
- **Step 2/3 aside** — unchanged. Reads from the cart's `totalExtraBeds`.
- **MRB-15-10** — the admin surface for editing `maxExtraBeds` and `extraBedRate` is the input side. EXB-11.4 only changes the *client-side selection surface*.
- **MRB-15-11** — unrelated (photo gallery, not extras toggle).
- **CHD-13** — unrelated (homepage search widget).

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

Extend `guest-app/tests/api/exb-11-user-controlled-extra-bed-toggle.test.ts`:

- **Updated existing tests** (use `userExtraBeds` instead of `displayExtraBeds`): the counter's `[+]` disabled condition (`typeQuantity === 0 || userExtraBeds >= typeMaxExtraBeds`); the counter's `[−]` disabled condition (now just `typeQuantity === 0` — the user can go below the soft floor); the checkbox `checked` (`userExtraBeds === 1`); the checkbox `disabled` (now just `typeQuantity === 0` — the user can tick/untick freely); the `aria-describedby` (now `overCap ? ... : undefined`); the `updateExtraBedCount` onClick handlers (`userExtraBeds + 1`); the IIFE does NOT define `displayExtraBeds`.
- **Removed EXB-11.2 describe block**: the auto-init useEffect tests, the `displayExtraBeds` derivation tests, the soft-floor `<= cap` infinite-loop guard tests.
- **New EXB-11.4 describe block** (~6 source-text guards): the IIFE does NOT define `displayExtraBeds`; the stay total reads from `userExtraBeds`; the stay-total gate is `userExtraBeds > 0`; there is NO auto-init useEffect (the pre-EXB-11.4 useEffect's signature is gone); the IIFE comment block documents the EXB-11.4 reversal of the EXB-11.2 auto-init; the IIFE comment block explicitly notes the user-explicit "no auto-init" stance ("user is in full control" + "cart starts at 0").

The behavioural emulator test (the user ticks/unticks the checkbox on a real room type, sees the per-night price + stay total update; the user increments/decrements the counter below the soft floor; the user can submit with 0 extra beds and sees the "Adjust room" CTA) is out of scope for this sandbox.

### Rejected alternatives

- **Keep the auto-init, just un-disable the checkbox** — the user explicitly said "do not make choices for the user". The auto-init IS the choice; removing the `disabled` doesn't fix the root cause. The user would still see a checked checkbox they didn't choose, and the counter would still start at the soft floor. The user's complaint is about the auto-tick, not just the inability to untick.
- **Keep the auto-init but only enforce it on the visual (not the cart — i.e., the `displayExtraBeds` derivation stays, the cart stays at 0)** — same root cause. The visual says "checked" but the cart says 0; the per-type cart summary pill in CHD-12 would show "0 extra beds" when the system requires 1, creating a display/cart mismatch the user can see. The price breakdown at Step 3 would show "0 extra beds" while the visual at Step 1 says "checked". The user would notice the mismatch and ask the same question.
- **Keep the `[−]` disabled at the soft floor** — the user explicitly said "do not make choices for the user". The `[−]` enforcement IS a choice; the submit gate is the right surface for the under-floor case. The user who wants 0 extra beds can go to 0, hit Continue, and see the "Adjust room" CTA — a clear, honest path. Keeping the `[−]` disabled is a softer version of the same anti-pattern.
- **Keep the `aria-describedby` at `softFloor >= 1`** — the pre-EXB-11.4 condition points to a non-existent element in the common case (soft floor = 1, not over-cap). The fix aligns the `aria-describedby` with the warning's actual render condition so screen readers don't announce a non-existent element. This is a pre-existing bug from EXB-11.2 that EXB-11.4 fixes as part of the visual revert.
- **Show a "we added an extra bed for your group" toast notification on auto-init** — a notification is patronizing. EXB-11.4 removes the auto-init entirely, so the toast is moot.
- **Add a "we recommend N extra beds" hint next to the checkbox** — a hint is a soft push, not a choice. But the user wants no system guidance at all. The over-cap warning text stays for the case where the group physically can't fit, and the submit gate catches the under-floor case. A recommendation hint is a softer version of the same anti-pattern.
- **Revert the soft-floor floor on the `[−]` only (keep the checkbox relaxed)** — inconsistent UX. The user would have full control on the checkbox case (`maxExtraBeds === 1`) but constrained control on the counter case (`maxExtraBeds >= 2`). The user explicitly asked for full control on both.
- **Auto-init as a hidden `?autoInitExtraBeds=true` URL param for A/B testing** — a future testing work item. Out of scope — the operator's ask is "no auto-init", and a hidden URL param is a different shape.

### Phase 2 (deferred, NOT in EXB-11.4)

- **Auto-init as a hidden `?autoInitExtraBeds=true` URL param for A/B testing** — a future testing work item. Out of scope — the operator's ask is "no auto-init", and a hidden URL param is a different shape.
- **A "Recommended: N extra beds" badge on the card** — a label, not a fix. The user wants no system guidance.
- **A "We added this for you" toast on auto-init** — moot. Auto-init is removed.
- **Per-room individual extra-bed toggles** — let the user add an extra bed to one Single but not the other. Carried over from EXB-11's Phase 2 list.
- **A "Reset to 0 extra beds" quick action** — out of scope. The counter's `[−]` is now freely clickable; the user can reset to 0 manually.

---

## EXB-11.5 — Rate Option Toggle on `/book` Step 1 (User Can Untick Room Only / Room + Breakfast)
> Proposed 2026-08-06, per decision #198 (operator feedback post-EXB-11.4 shipped surface). Files: `guest-app/src/pages/BookingPage.tsx:989-1014` (the `selectRoomType` function — refactored to a per-type toggle) + the hint text at `BookingPage.tsx:2415` (updated to teach the toggle). Sibling to EXB-11.3 + EXB-11.4 — same `/book` Step 1 surface, different control.

### The problem

The post-EXB-11.3 surface (current `main` as of 2026-08-06, post-EXB-11.4) has a one-way rate-option click: clicking a rate option (`Room Only` or `Room + Breakfast`) on a card adds the room (or updates the rate if the type is already in the cart), but clicking the same rate again is a no-op — the user has no way to "untick" the room via the rate option itself. The only way to remove a room is via the "Rooms" stepper (decrement to 0), which is a per-quantity control, not a per-type toggle. The rate option is a per-type control (one button per type, not per room); it should be toggleable. Same "user is in full control" pattern as EXB-11.4 (extra-bed toggle), different surface.

**Root cause.** The pre-EXB-11.5 `selectRoomType` function at `BookingPage.tsx:989-1014` had a single ternary: `hasType ? updateRate : addRoom`. The "type in cart" branch only updated the rate; it never removed the type. The user could add a room and switch between Room Only / Room + Breakfast, but they couldn't deselect the room via the rate option. The `RateOption` component is a `<button>` (per `BookingPage.tsx:3425`), and the `onSelect` handler always adds or updates — never removes.

**Three reasons this was the wrong shape:**

1. **Inconsistent with the per-type toggle pattern** — the rate option is a per-type control, and the natural mental model is "click to add, click again to remove" (the same pattern as the extra-bed checkbox added in EXB-11.4). The "Rooms" stepper is the per-quantity control; the rate option is the per-type control. Mixing the two shapes (one is a toggle, the other is a one-way click) is inconsistent.
2. **Hidden state mutation** — the user adds a room via the rate option, then has to find the "Rooms" stepper to remove it. The rate option's "active" state (the checkmark) shows the room is in the cart, but the only way to change that state is via a different control. The user has to scan the card for the "Rooms" stepper, which is below the rate options and the Extras sub-section.
3. **Asymmetric with the extra-bed toggle** — the extra-bed checkbox (EXB-11.4) is a toggle (tick/untick), but the rate option is a one-way click. The user expects toggles to be toggles. If one toggle on the card is toggleable and the other isn't, the user has to learn a different mental model for each.

### The fix — three-part change

**1. Split the "type in cart" branch into two.** The new `selectRoomType` function has three cases:

- **(a) Type not in cart** → add 1 room with the chosen rate (Room Only or Room + Breakfast). The pre-EXB-11.5 function had this in the `false` branch of the ternary.
- **(b) Type in cart with the same rate** → untick (per-type toggle) — remove all rooms of this type from the cart. The pre-EXB-11.5 function had this case missing entirely; the "type in cart" branch only updated the rate, never removed the type.
- **(c) Type in cart with a different rate** → update the rate in place for every room of that type. The pre-EXB-11.5 function had this in the `true` branch of the ternary.

**2. Guard the `setSelectedRoomType` + `setRateChoice` calls with a `shouldSyncSelection` flag.** The pre-EXB-11.5 function always called these setters regardless of which branch fired. The EXB-11.5 function sets the flag to `true` only on the add and switch-rate paths (cases a and c). The untick path (case b) skips the sync — the `useEffect` at `BookingPage.tsx:865` handles the selection sync when the current selection is no longer in the cart (it picks `roomCart[0]` as the new selection, or clears if the cart is empty).

**3. Update the hint text on `/book` Step 1.** The pre-EXB-11.5 hint said "Select Room Only or Room + Breakfast to lock the Step 1 summary" — a one-way instruction. The EXB-11.5 hint says "Click a rate to add a room. Click the same rate again to remove it." — a two-way instruction that teaches the toggle.

### What the user sees now

- **Empty cart → click "Room Only" on Single Room** → 1 Single Room added to the cart with rate "room-only". The "Room Only" rate option shows the checkmark (`active = true`). The "Rooms" stepper shows 1. The Step 1 summary is now active.
- **1 Single Room (rate "room-only") → click "Room Only" again** → Single Room removed from the cart. The "Room Only" rate option no longer shows the checkmark (`active = false`). The "Rooms" stepper is hidden (no rooms of this type). The selection sync useEffect picks another type (or clears if the cart is empty). The bottom bar shows the "Add at least one room" CTA.
- **1 Single Room (rate "room-only") → click "Room + Breakfast"** → the rate is updated in place to "room-breakfast" (same as the pre-EXB-11.5 behavior). The "Room + Breakfast" rate option shows the checkmark; the "Room Only" rate option does not. The "Rooms" stepper still shows 1.
- **2 Single Rooms (rate "room-only") → click "Room Only" again** → both rooms removed (per-type toggle, not per-room). The "Rooms" stepper is hidden.
- **1 Single Room + 1 Family Room → click "Room Only" on Single Room** → Single Room removed; Family Room stays. The selection sync useEffect picks the Family Room as the new selection. The Step 2/3 aside updates to show the Family Room.

### Why this is the right shape

- **(1) Consistent with the per-type toggle pattern** — the rate option is a per-type control, and the toggle is the natural shape. Same pattern as the extra-bed checkbox (EXB-11.4). The "Rooms" stepper is the per-quantity control; the rate option is the per-type control. No mixing of shapes.
- **(2) Discoverable** — the rate option's "active" state (the checkmark) shows the room is in the cart, and clicking the same option removes it. No need to find a different control to change the state. The hint text teaches the toggle.
- **(3) Symmetric with the extra-bed toggle** — both toggles on the card are toggleable. The user has a consistent mental model: "click to add, click again to remove."
- **(4) Per-type toggle, not per-room** — the rate option removes ALL rooms of that type, not just 1. This matches the per-type shape of the rate option (one button per type, not per room). The "Rooms" stepper is the per-quantity control for fine-grained adjustments.

### What this changes for the data model

Nothing. `roomCart` shape is unchanged. `roomType`, `rateChoice`, `numAdults`, `numChildren`, `extraBedCount`, `bookingId` are all unchanged. The `serializeBookingRoomCart` / `parseBookingRoomCart` helpers are unchanged. Cart URL serialization (`rooms=`) is unchanged. Server-side validation is unchanged.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - **Refactor `selectRoomType` (lines 989-1014).** Replace the one-way ternary with a three-branch if/else: (a) type not in cart → add 1 room with the chosen rate; (b) type in cart with the same rate → untick (remove all rooms of that type); (c) type in cart with a different rate → update the rate in place. Guard the `setSelectedRoomType` + `setRateChoice` calls with a `shouldSyncSelection` flag (only set to `true` on paths a and c). The `setSearchParams` call stays inside the `setRoomCart` callback (matches the existing pattern; idempotent in React 18 StrictMode).
  - **Update the hint text at line 2415.** Change "Select Room Only or Room + Breakfast to lock the Step 1 summary." to "Click a rate to add a room. Click the same rate again to remove it."
- No changes to the data model, the URL contract, the server-side validation, the `RateOption` component (the toggle logic lives in the parent), the `updateRoomQuantity` function (it's the per-quantity control), the `useEffect` at `BookingPage.tsx:865` (it already handles the "selection no longer in cart" case), the `selectedRoomType` + `rateChoice` state, or the `serializeBookingRoomCart` / `parseBookingRoomCart` helpers.

### Gates

- **EXB-11** — the underlying contract is unchanged. The toggle is a refinement of the user-explicit path.
- **EXB-11.1** — the Extras sub-section placement + checkbox-for-`maxExtraBeds === 1` shape is unchanged. The EXB-11.5 fix is on the rate options, not the Extras sub-section.
- **EXB-11.2** — the auto-init useEffect is still removed per EXB-11.4. EXB-11.5 doesn't reintroduce it.
- **EXB-11.3** — the "no default room-type on page load" invariant is preserved. The function still has the user-explicit add path; the toggle is a refinement, not a replacement.
- **EXB-11.4** — the extra-bed toggle is unchanged. The rate-option toggle is a parallel pattern on the same card.
- **CHD-11** — the capacity chip is unchanged.
- **CHD-12** — the per-type cart summary is unchanged. It reads from the cart, which the toggle now mutates more often.
- **EXB-01..10** — server-side contract is unchanged. The cart writes the same per-room data.
- **Step 2/3 aside** — unchanged. Reads from `selectedTypeEntry` and the cart.
- **MRB-15-10** — the admin surface for editing room types is the input side. EXB-11.5 only changes the *client-side selection surface*.
- **MRB-15-11** — unrelated (photo gallery, not extras toggle).
- **CHD-13** — unrelated (homepage search widget).

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/exb-11-5-rate-option-toggle.test.ts` (~8 source-text guards):

- The `selectRoomType` function declares the toggle with three branches (add / untick / switch rate).
- The untick branch removes ALL rooms of the type (per-type toggle, not per-room).
- The add branch stays (type not in cart → add 1 room with the chosen rate).
- The switch-rate branch stays (type in cart with different rate → update rate in place).
- The `setSelectedRoomType` + `setRateChoice` calls are guarded by `shouldSyncSelection` (skipped on the untick path).
- The comment block documents the per-type toggle (add / untick / switch) and references EXB-11.5 + decision #198.
- The hint text on `/book` Step 1 is updated to "Click a rate to add a room. Click the same rate again to remove it." (and the pre-EXB-11.5 hint is gone).
- The `selectRoomType` function is still wired to the rate-option `onSelect` handlers (sanity check).

The existing `exb-11-3-no-default-room-type-on-load.test.ts` tests still pass (the function still has the user-explicit add path). The behavioural emulator test (the user clicks a rate option on a real room type, sees the room added; clicks the same rate again, sees the room removed; clicks a different rate, sees the rate updated) is out of scope for this sandbox.

### Rejected alternatives

- **Keep the one-way click + add a separate "Remove" button next to each rate option** — friction point. Adds a new control; the toggle is the natural shape. The "Rooms" stepper already provides a way to remove rooms (decrement to 0); the toggle is a more discoverable alternative.
- **Decrement by 1 instead of remove all** — per-room toggle, inconsistent with the per-type shape of the rate option. The "Rooms" stepper is the per-quantity control; the rate option should be the per-type toggle.
- **Add a confirmation dialog ("Are you sure you want to remove this room?")** — friction point. The toggle is a clear, explicit action; the user clicked the same rate again, they know what they're doing. A confirmation dialog adds noise.
- **Show a "Room removed" toast notification** — patronizing. The checkmark disappearing is enough signal; a toast notification adds noise.
- **Add a separate "Clear cart" button** — different scope. Clears the entire cart, not just one type. A future UX work item; out of scope for EXB-11.5.
- **Auto-clear the `selectedRoomType` when the type is removed from the cart** — handled by the existing useEffect at `BookingPage.tsx:865`. It picks `roomCart[0]` as the new selection; auto-clearing would be a third option in the useEffect, but the existing behavior is correct.
- **Keep the pre-EXB-11.5 hint text and let the user discover the toggle** — worse discoverability. The hint text teaches the toggle explicitly, which is the right shape for a user-facing control.

### Phase 2 (deferred, NOT in EXB-11.5)

- **Per-room individual rate toggles** — let the user pick Room Only for one Single and Room + Breakfast for another. Out of scope — the rate is per-type, and the per-room shape would require a bigger data model change. Carried over from EXB-11's Phase 2 list.
- **A "Clear cart" button** — a future UX work item. Clears the entire cart, not just one type.
- **A "Remove all rooms of this type" button next to the "Rooms" stepper** — a more discoverable alternative to the rate-option toggle. Out of scope — the toggle is the natural shape, and the button would be redundant.
- **Keyboard shortcut for the toggle** (e.g., Escape to remove the currently-active rate) — a future accessibility work item.

---

## EXB-12 — Extra-Bed Breakfast Toggle on `/book` Step 1
> Proposed 2026-08-06, per decision #199 (operator feedback post-EXB-11.4 shipped surface). Files: `shared/utils/bookingAddOns.ts` (extended `calculateBreakfastAddOn` with `extraBedCount` + `extraBedBreakfast`) + `shared/types/index.ts` (added `extraBedBreakfast?: boolean` to the booking room line type) + `shared/schemas/booking.ts` (added the field to the public + walkin schemas) + `guest-app/src/utils/bookingRoomCart.ts` (added the field to the cart shape) + `guest-app/src/pages/BookingPage.tsx` (added `updateExtraBedBreakfast` helper + toggle UI + breakfast total update + booking body) + `guest-app/server/handlers/bookings.ts` (invariant enforcement + pricing + booking doc snapshot) + `guest-app/server/lib/rate-breakdown.ts` (rebuild reads the field from the doc). Sibling to EXB-11 + EXB-11.1 + EXB-11.4 + EXB-11.5 — same `/book` Step 1 room-type card surface, different control (per-type toggle on the Extras sub-section).

### The problem

The pre-EXB-12 surface (post-EXB-11.4) had no coupling between the extra-bed add-on and the breakfast add-on. The breakfast total was strictly `(numAdults + (breakfastIncludesChildren ? numChildren : 0))`, and the extra beds were priced as a separate add-on with no breakfast coupling. The user had no way to opt in to breakfast for the extra-bed occupant(s) — even if the extra bed was for a person, that person wasn't counted in the breakfast total unless the user manually added the person to `numAdults` / `numChildren`. The two add-ons were orthogonal.

**Root cause.** The pre-EXB-12 `calculateBreakfastAddOn` helper at `shared/utils/bookingAddOns.ts:79-101` only took `numGuests` + `numAdults` + `numChildren` (per CHD-10) and computed `effectiveOccupancy = numAdults + (includesChildren ? numChildren : 0)`. There was no field for the extra beds, so they were invisible to the breakfast calculation. The extra bed was a separate add-on (`calculateExtraBedAddOn` at `shared/utils/bookingAddOns.ts:108-122`), priced as `extraBedCount × extraBedRate × nights` — no breakfast coupling.

### The fix — end-to-end change to 7 files

**1. `shared/utils/bookingAddOns.ts` — extended `calculateBreakfastAddOn`.** The helper interface gains two new optional fields: `extraBedCount?: number | null` + `extraBedBreakfast?: boolean | null`. The helper's `effectiveOccupancy` is now `(numAdults + (includesChildren ? numChildren : 0)) + (extraBedBreakfast ? extraBedCount : 0)`. When the toggle is off (the default) or `extraBedCount` is 0, the extra beds are not counted — byte-equivalent to the pre-EXB-12 behavior for existing callers. When the toggle is on and `extraBedCount > 0`, the extra beds are counted toward the breakfast total (priced as `breakfastRate × extraBedCount × nights`).

**2. `shared/types/index.ts` — added `extraBedBreakfast?: boolean` to the booking room line type.** The field is on the booking doc (snapshotted from the cart at create time). Older booking docs without the field render the same total (nullish → `false`, no breakfast for extra beds).

**3. `shared/schemas/booking.ts` — added the field to the public + walkin schemas.** The public booking schema (`CreateBookingSchema`) gains `extraBedBreakfast: z.boolean().optional()`. The walkin schema (`WalkinRoomLineSchema`) gains the same field for admin consistency — a walk-in booking can also opt in to breakfast for extra beds. The walkin admin form is a separate scope (not updated in EXB-12); the schema accepts the field, but the UI doesn't expose it yet.

**4. `guest-app/src/utils/bookingRoomCart.ts` — added the field to the cart shape.** The `BookingRoomCartItem` interface gains `extraBedBreakfast?: boolean` (default `false`). The `parseBookingRoomCart` helper normalizes `extraBedBreakfast === true` from the URL (any other value → `false`), so a stale URL with a non-boolean value can't slip through. The serialization includes the field in the `rooms=` URL param.

**5. `guest-app/src/pages/BookingPage.tsx` — added the toggle + helper + body field.** The `updateExtraBedBreakfast` helper mirrors the user's pick onto every room of the type (per-type pattern). The helper enforces the invariant: `safeEnabled = nextEnabled && (room.extraBedCount || 0) > 0` — when `extraBedCount === 0`, the toggle is forced off. The toggle is rendered in both Extras IIFE branches (checkbox for `maxExtraBeds === 1` + counter for `maxExtraBeds >= 2`), gated on `breakfastConfig.isEnabled` (no point offering breakfast when breakfast is off) and disabled when `userExtraBeds === 0`. The price hint "+ ₱X / bed / night" is shown next to the toggle when the extra-bed count > 0. The `breakfastTotal` calculation passes both fields to `calculateBreakfastAddOn`. The booking body adds `extraBedBreakfast: room.extraBedBreakfast === true` to the `rooms[]` array (multi-room) and `extraBedBreakfast: firstRoomSelection.extraBedBreakfast === true` to the single-room create body.

**6. `guest-app/server/handlers/bookings.ts` — invariant + pricing + snapshot.** The `validatedRoomStays` loop enforces the invariant: `extraBedBreakfast: selection.extraBedBreakfast === true && extraBedCount > 0`. A `true` toggle with 0 extra beds is a client bug (or a stale URL); the server forces it off. The pricing loop at line 2252 passes both fields to `calculateBreakfastAddOn`. The booking doc at line 3059 snapshots `extraBedBreakfast: pricingForRoom.extraBedBreakfast === true` alongside the existing `extraBedCount` + `extraBedRate` + `hasBreakfast` + `breakfastRate` + `breakfastIncludesChildren` fields.

**7. `guest-app/server/lib/rate-breakdown.ts` — rebuild reads the field from the doc.** The early-departure / reschedule rebuild path reads `booking.extraBedCount` + `booking.extraBedBreakfast` from the booking doc and passes them to `calculateBreakfastAddOn`. Nullish → `false` (no breakfast for extra beds), for back-compat with older booking docs that don't have the field. The rebuild matches the create-time total.

### What the user sees

- **1 Single Room + Room + Breakfast + 1 extra bed (toggle off, the default)** — breakfast total = `breakfastRate × 1 adult × nights`. The toggle is visible but unchecked. The price hint "+ ₱X / bed / night" is shown next to the toggle.
- **Same setup, toggle ON** — breakfast total = `breakfastRate × 1 adult × nights + breakfastRate × 1 extra bed × nights`. The Step 3 review shows the extra-bed breakfast as part of the "Breakfast add-on" line (the helper's effective occupancy is `1 adult + 1 extra bed = 2`).
- **Drop extra bed to 0 (toggle was ON)** — the toggle is forced off by the `updateExtraBedBreakfast` helper's `safeEnabled = nextEnabled && (room.extraBedCount || 0) > 0` guard. The breakfast total drops back to the adult-only total.
- **Toggle ON with 0 extra beds (e.g., via stale URL)** — the client renders the toggle as unchecked (because `userExtraBeds === 0`). The server-side invariant enforcement in `validatedRoomStays` forces the toggle off before pricing. The booking is created with `extraBedBreakfast: false` regardless of what the client sent.
- **No rooms of this type** — the toggle is hidden (gated on `typeQuantity > 0`).
- **Breakfast config disabled** — the toggle is hidden (gated on `breakfastConfig.isEnabled`).

### Why the explicit opt-in is the right shape

- **(1) Explicit opt-in** — the guest decides whether to include breakfast for the extra-bed occupant(s). The default is `false` (no breakfast for extra beds, matching the pre-EXB-12 behavior). The user opts in via a single toggle that applies to all extra beds in the room. No surprise charges.
- **(2) Per-type** — the toggle is per-type (mirrored onto every room of the type), same shape as the extra-bed count + rate choice. One click applies to all rooms of the type.
- **(3) Invariant enforcement** — the server validates the invariant `extraBedBreakfast implies extraBedCount > 0`. A `true` toggle with 0 extra beds is a client bug (or a stale URL); the server forces it off. The client also enforces the invariant via the toggle's `disabled` state when `userExtraBeds === 0` and the `updateExtraBedBreakfast` helper's `safeEnabled` guard.
- **(4) Back-compat with older booking docs** — the `extraBedBreakfast` field is optional. When absent, the server treats it as `false` (no breakfast for extra beds). The rate-breakdown rebuild reads the field from the booking doc and passes it to the helper; nullish → `false`. Older booking docs render the same total.
- **(5) End-to-end** — the change touches the client cart, the helper, the schemas, the server handler, the booking doc, and the rate-breakdown rebuild. All surfaces are updated; the create + reschedule + early-departure paths all honor the toggle.

### What this changes for the data model

Adds `extraBedBreakfast?: boolean` to:
1. The `BookingRoomCartItem` shape (guest-app cart, URL serialization)
2. The `BookingRoom` type on the booking doc (shared/types)
3. The public booking schema (`CreateBookingSchema`)
4. The walkin schema (`WalkinRoomLineSchema`) — for admin consistency

The helper's `BreakfastAddOnInput` gains `extraBedCount?: number | null` + `extraBedBreakfast?: boolean | null`. The `extraBedCount` field on the booking doc is unchanged (already exists from EXB-01).

### What this changes for the server

- The `validatedRoomStays` loop enforces the invariant (`extraBedBreakfast && extraBedCount > 0`).
- The pricing loop includes the extra beds in the breakfast total when the toggle is on.
- The booking doc snapshots the field.
- The rate-breakdown rebuild reads the field from the doc + passes it to the helper.

### Implementation

- `shared/utils/bookingAddOns.ts` — extended `calculateBreakfastAddOn` with `extraBedCount` + `extraBedBreakfast`; added `if (input.extraBedBreakfast) { effectiveOccupancy += extraBedCount; }` to the helper body.
- `shared/types/index.ts` — added `extraBedBreakfast?: boolean` to the `BookingRoom` type.
- `shared/schemas/booking.ts` — added `extraBedBreakfast: z.boolean().optional()` to the public + walkin schemas.
- `guest-app/src/utils/bookingRoomCart.ts` — added `extraBedBreakfast?: boolean` to `BookingRoomCartItem`; `parseBookingRoomCart` normalizes the field.
- `guest-app/src/pages/BookingPage.tsx` — added `updateExtraBedBreakfast` helper (per-type mirror + invariant enforcement); added the toggle UI in both Extras IIFE branches (gated on `breakfastConfig.isEnabled` + `typeQuantity > 0`, disabled when `userExtraBeds === 0`); updated `breakfastTotal` to pass the new fields; added `extraBedBreakfast` to the booking body's `rooms[]` + `firstRoomSelection`.
- `guest-app/server/handlers/bookings.ts` — `validatedRoomStays` enforces the invariant; pricing loop passes the new fields; booking doc snapshots the field.
- `guest-app/server/lib/rate-breakdown.ts` — rebuild reads the field from the doc + passes it to the helper.

~50 lines changed across 7 files.

### Gates

- **EXB-01..10** — server-side contract is unchanged. The cart still writes the same per-room `extraBedCount` + `extraBedRate`; the server still validates against `maxExtraBeds` and snapshots `extraBedRate`.
- **EXB-11** — the underlying extra-bed toggle contract is unchanged. The new `extraBedBreakfast` field is additive.
- **EXB-11.1** — the Extras sub-section placement + checkbox-for-`maxExtraBeds === 1` shape is unchanged. The new toggle is added to both branches.
- **EXB-11.2** — the auto-init useEffect is still removed per EXB-11.4. The new toggle has no auto-init behavior.
- **EXB-11.3** — the "no default room-type on page load" invariant is preserved. The new toggle is per-type, user-explicit.
- **EXB-11.4** — the extra-bed toggle is unchanged. The new `extraBedBreakfast` toggle is a parallel pattern on the same card.
- **EXB-11.5** — the rate-option toggle is unchanged. The new toggle is a separate control.
- **CHD-10** — the adult/child split + `breakfastIncludesChildren` toggle is unchanged. The new toggle is per-bed, not per-person. The helper's effective occupancy is `(numAdults + (includesChildren ? numChildren : 0)) + (extraBedBreakfast ? extraBedCount : 0)`.
- **CHD-11** — the capacity chip is at the top of the card and is unchanged. The new toggle is at the bottom with the other add-on choices.
- **CHD-12** — the per-type cart summary is unchanged — it reads from the cart, which now has the new `extraBedBreakfast` field but renders the same per-type line. The pill can show the breakfast count in a future refinement.
- **Step 2/3 aside** — unchanged. Reads from the cart's `totalExtraBeds` + `totalBreakfast`.
- **MRB-15-10** — the admin surface for editing `maxExtraBeds` + `extraBedRate` is the input side. EXB-12 only changes the *client-side selection surface* + the server pricing.
- **MRB-15-11** — unrelated (photo gallery, not extras toggle).
- **CHD-13** — unrelated (homepage search widget).

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/exb-12-extra-bed-breakfast.test.ts` (~16 source-text guards):

- The `BookingRoomCartItem` shape gains an optional `extraBedBreakfast: boolean` field.
- The `parseBookingRoomCart` helper preserves `extraBedBreakfast` from the URL (normalizes to `true`/`false`).
- The `calculateBreakfastAddOn` helper accepts `extraBedCount` + `extraBedBreakfast`.
- The helper's `effectiveOccupancy` includes `extraBedCount` when `extraBedBreakfast` is truthy.
- The public booking schema accepts `extraBedBreakfast: z.boolean().optional()`.
- The walkin schema also accepts `extraBedBreakfast` (admin consistency).
- The booking room line type gains an `extraBedBreakfast?: boolean` field.
- The BookingPage exposes an `updateExtraBedBreakfast` helper (per-type mirror).
- The BookingPage's `breakfastTotal` passes `extraBedCount` + `extraBedBreakfast` to the helper.
- The Extras IIFE renders an "Include breakfast for the extra beds" toggle (both branches).
- The toggle only renders when the breakfast config is enabled.
- The booking body passes `extraBedBreakfast` to the server (multi-room + single-room).
- The server handler validates the invariant `extraBedBreakfast implies extraBedCount > 0`.
- The server's `calculateBreakfastAddOn` call includes `extraBedCount` + `extraBedBreakfast`.
- The server snapshots `extraBedBreakfast` onto the booking doc.
- The rate-breakdown rebuild path passes `extraBedCount` + `extraBedBreakfast` to the helper.

The behavioural emulator test (the user adds a room, adds an extra bed, toggles breakfast for the extra bed, sees the price update; the user toggles off, sees the price drop; the user drops the extra bed, sees the toggle forced off; the user submits and the server stores the toggle on the booking doc) is out of scope for this sandbox.

### Rejected alternatives

- **Auto-count extra beds as breakfast guests** — the other option I presented. The user explicitly chose the per-type toggle for the explicit-opt-in pattern. Auto-counting is the "user is in control" anti-pattern in reverse — the system would force breakfast for every extra bed, even when the extra bed is for storage or a child who doesn't need breakfast.
- **Per-bed counter (0 to extraBedCount) for the breakfast toggle** — more flexible but more UI. The per-type single toggle is simpler and matches the per-type mirror pattern of the extra-bed count + rate choice. Per-bed can be a future refinement if guests want it.
- **Include the extra-bed breakfast in the existing "Breakfast add-on" line item without a separate line** — the existing line already covers it via the helper's effective occupancy. No separate line is needed; the per-room `extraBedBreakfast` toggle is the only UI surface. A separate "Breakfast for extra beds" line would break the receipt layout convention.
- **Show a per-bed stepper next to the extra-bed counter** — a "Breakfast: 0/1/2" stepper. More flexible but more UI. The single toggle is simpler and matches the "all or nothing" pattern of other add-on toggles like the breakfast-includes-children toggle.
- **Add a server-side warning when `extraBedBreakfast` is `true` but `extraBedCount` is 0** — instead of silently forcing it off. The silent fix is cleaner — the client should never have a `true` toggle with 0 extra beds, and the server is the authoritative gate. A warning would be noise.
- **Add the toggle to the walkin admin surface** — the walkin schema accepts the field for consistency, but the admin UI is a separate scope. The walkin form can be updated in a follow-up to expose the toggle.
- **Auto-enable the toggle when the user adds an extra bed** — the "let the user decide" pattern from EXB-11.4. The system should not make the choice for the user. The toggle is unchecked by default; the user opts in explicitly.

### Phase 2 (deferred, NOT in EXB-12)

- **A per-bed breakfast stepper** (0 to `extraBedCount`) — a future refinement if guests want to opt in for some extra beds but not all.
- **A "Breakfast for extra beds" line item in the receipt PDF** — currently included in the "Breakfast add-on" line via the helper's effective occupancy. A separate line would be clearer but breaks the receipt layout convention.
- **A walkin admin surface for the new toggle** — the walkin schema accepts the field for consistency, but the admin form doesn't expose it yet. A future UX work item.
- **An admin setting to default the toggle on or off per room type** — a future UX work item. Some room types might want breakfast included by default for extra beds.
- **A per-room individual toggle** — let one Single have breakfast for the extra bed and another not. Out of scope — the toggle is per-type, and the per-room shape would require a bigger data model change.
- **A "Reset to 0" quick action for the extra-bed breakfast toggle** — a future UX work item. The user can uncheck the toggle manually.

---

## EXB-11.3 — No Default Room-Type Selection on `/book` Page Load
> Proposed 2026-08-04, per decision #191 (operator feedback post-EXB-11.2 shipped surface). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:836-863` (the auto-select useEffect). Sibling to EXB-11 + EXB-11.1 + EXB-11.2 — same `/book` surface, different UX refinement.

### The problem

Operator-reported 2026-08-04 (post-EXB-11.2 review): "can we also maybe remove the default selection of room type upon page load for /book." The pre-EXB-11.3 surface has a UX anti-pattern: on page load, the first available room type is auto-selected and silently added to the cart (1 room). The user lands on `/book` with a pre-checked rate option, a "Fits your group" chip, an active "Rooms" stepper showing "1", and a pre-populated "Your cart" line — all without the user having explicitly chosen anything.

**Root cause.** The pre-EXB-11.3 `useEffect` at `BookingPage.tsx:836-849` had this branch:
```ts
if (roomCart.length === 0 && availableRoomTypes[0]) {
  const defaultType = availableRoomTypes[0].type.value;
  setSelectedRoomType(defaultType);
  setRoomCart([{ ...defaultType, numAdults, numChildren, extraBedCount: 0 }]);
  return;
}
```
This was added as a "smart default" — the user lands on `/book`, sees a preselected room, can immediately proceed to Step 2. The operator now thinks this is the wrong default: the user should explicitly choose a room type. The pre-selection is presumptuous — the system has silently committed the user to a specific room type before they've made any choice. The user has to actively CHANGE the selection if they don't want the first type, which is a worse UX than actively CHOOSING a type.

### The fix — delete the auto-select branch, keep the sync branch + URL pre-fill

**Two-part change to `BookingPage.tsx:836-863`:**

1. **Delete the auto-select branch (lines 837-849)** — the `if (roomCart.length === 0 && availableRoomTypes[0])` block. On page load, the cart is empty and no room type is pre-selected. The user must click a rate option ("Room Only" or "Room + Breakfast") on a card to add 1 of that type to the cart (the existing `selectRoomType` function at `BookingPage.tsx:935-960` handles this — it's the user-explicit path that was already wired).

2. **Keep the sync branch (lines 851-854)** — `if (!roomCart.some((room) => room.roomType === selectedRoomType) && roomCart[0]) { setSelectedRoomType(roomCart[0].roomType); ... }`. This branch fires when the cart has rooms but the selection doesn't match (e.g., after a URL-driven pre-fill, or after the user adds a second room type). It syncs the selection to match the cart. Without this branch, a deep-link to `/book?rooms=single-room:1:2:0:0` would have an empty selection even though the cart has 1 Single Room.

**URL-driven pre-fill stays.** The `selectedRoomType` state is initialized from `searchParams.get("roomType")` at `BookingPage.tsx:244`, and `roomCart` is initialized from `searchParams.get("rooms")` (via the cart parser). A deep-link to `/book?roomType=single-room` or `/book?rooms=single-room:1:2:0:0` is intentional pre-fill — the user explicitly chose that URL. The auto-select branch is only about the case where neither is present, and the user lands on a fresh `/book` page with an empty cart.

**Dependency array trims `availableRoomTypes`.** The remaining sync branch doesn't read `availableRoomTypes`, so it can come out of the `useEffect`'s dependency array. (The `availableRoomTypes` is still used elsewhere — the sync branch's check `roomCart[0]` is enough; the selection stays as the cart's first type, regardless of availability, until `fetchAvailability` finishes and the cart is rebuilt.)

### What the user sees

**Before EXB-11.3 (the bug):**
- Page load: `Single Room` is pre-selected (the orange "Room Only" radio is filled), 1 Single Room is in the cart, the "Fits your group" chip is showing, the "Your cart" section shows `1× Single Room · 1 adult · 1 child`.
- The user has to ACTIVELY CHANGE the selection if they don't want the Single Room.

**After EXB-11.3 (the fix):**
- Page load: no rate option is active on any card, the cart is empty, no "Fits your group" chip is showing, the "Your cart" section is empty (just the header), the bottom bar shows the existing disabled "Add at least one room" CTA.
- The user ACTIVELY CHOOSES a room type by clicking a rate option on a card → that type is added to the cart (1 room), the selection is set, the rate option becomes active, the chip + cart summary + bottom bar update.
- Deep-link to `/book?roomType=single-room` or `/book?rooms=single-room:1:2:0:0`: the pre-fill is intentional (the user typed the URL), the cart + selection are populated from the URL params. No behavior change here.

### Why the "smart default" was wrong

Three reasons the auto-select was a worse UX than the explicit-choice pattern:

1. **Presumptuous.** The system committed the user to a room type before any input. If the user wanted a different type (e.g., a Family instead of a Single), they had to actively CHANGE the selection, which is a worse path than actively CHOOSING.
2. **Hidden state mutation.** The auto-select silently mutates two state values (`selectedRoomType` and `roomCart`) on first render. The user doesn't know about the mutation unless they look at the URL or the cart. The explicit-choice pattern is honest: the cart is empty until the user does something.
3. **Surprise on re-render.** If the user has a `?roomType=family` URL param, the auto-select branch (which only fires when `selectedRoomType` is empty) doesn't fire — but if the URL param is missing, the auto-select picks the first available, which might not match what the user wanted from a previous session. The URL pre-fill is the right shape for "user has chosen"; the auto-select is the wrong shape for "user hasn't chosen yet".

The new pattern: **page load = empty cart, empty selection**. The user fills both. The deep-link URL pre-fill is intentional (the user typed the URL).

### What this changes for the data model

**Nothing.** The `selectedRoomType: string` state stays. The `roomCart: RoomCartEntry[]` state stays. The `selectRoomType` function (user click handler) stays. The `updateRoomQuantity` function (user changes quantity) stays. The `useEffect` is the only change.

### What this changes for the related work

- **CHD-12 (cart summary)** — the "Your cart" section already has an empty-state (just shows the "Your cart" header, no rows below at `BookingPage.tsx:2255-2256`). No change needed.
- **CHD-11 (capacity chip)** — the per-type `Fits / Tight / Doesn't fit` chip is gated on `isSelected = typeQuantity > 0` at `BookingPage.tsx:2346`. With no auto-select, no chip is showing on page load. The user adds a room → the chip renders. No change needed.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extras toggle)** — the IIFE renders when `typeMaxExtraBeds > 0`, but the extras are only meaningful when the user has selected the type. The auto-init useEffect at `BookingPage.tsx:740-758` only fires for types in the cart, so empty cart = no auto-init. No change needed.
- **Step 2/3 aside** — the extra-bed + breakfast + voucher aside is gated on `selectedRoomType` non-empty. With no auto-select, the aside is hidden on page load. The user adds a room → the aside renders. No change needed.
- **Step 1 → Step 2 "Next" button** — the disabled button's label is already wired at `BookingPage.tsx:2896-2900` to be "Add at least one room" when `distributedRoomCart.length === 0`. With no auto-select, this is the default state on page load. No change needed.

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/exb-11-3-no-default-room-type-on-load.test.ts` (source-text guards on `BookingPage.tsx`):

- The `if (roomCart.length === 0 && availableRoomTypes[0])` auto-select branch is **gone** from the `useEffect` at `BookingPage.tsx:836-863`.
- The auto-select branch's `setSelectedRoomType(defaultType)` call is **gone**.
- The auto-select branch's `setRoomCart([{ ...defaultType, ... }])` call is **gone**.
- The sync branch (`!roomCart.some((room) => room.roomType === selectedRoomType) && roomCart[0]`) is **still present** (for the deep-link / re-render path).
- The `selectRoomType` function (user click handler) at `BookingPage.tsx:935-960` is **unchanged** — it still adds 1 of the type to the cart when called.
- The `updateRoomQuantity` function (user changes quantity) is **unchanged**.
- The bottom bar's "Add at least one room" CTA label is **still present** (the existing disabled-state label at `BookingPage.tsx:2900`).
- The URL-driven pre-fill (`searchParams.get("roomType")` at line 244, `searchParams.get("rooms")` via the cart parser) is **unchanged**.

The behavioural test (the user lands on `/book` with no URL params, sees no selection, clicks a rate option, the type is added to the cart) is out of scope for this sandbox.

### Rejected alternatives

- **Keep the auto-select but show a small "we picked this for you" helper text.** The helper text is a label, not a fix. The user still has to actively change the selection to opt out. Same UX problem.
- **Auto-select the first type that FITS the current group, not just the first available.** Smarter default, but the user might have a preference (e.g., they want a Family Room even if the Single Room fits). The auto-select is still presumptuous; the user should choose.
- **Auto-select the first type but require the user to confirm ("Confirm your selection: Single Room").** A confirmation step is a friction point. The empty-cart default + the existing rate-option buttons is the cleaner shape.
- **Replace the auto-select with a "Recommended for you" badge on the first card.** The badge is a label, not a fix. The user can still ignore it. The empty-cart default is more honest.
- **Auto-select based on the homepage's URL params (e.g., if the user came from the homepage with 2 adults, pre-select the type that fits 2 adults).** Smart default, but the operator's ask is explicit: no default. The user should choose. (The URL param `?roomType=` is still respected — that's the user EXPLICITLY choosing via a deep link, which is a different intent.)
- **Auto-select the first type but don't add to the cart (just mark the rate option as "active").** Half-fix. The active rate option without a cart row is confusing — the "Your cart" section is empty, but the rate option is filled. The user can't tell if they have 0 rooms or 1 room.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - Remove the `if (roomCart.length === 0 && availableRoomTypes[0]) { ... }` branch at lines 837-849.
  - Keep the sync branch at lines 851-854.
  - Trim `availableRoomTypes` from the `useEffect`'s dependency array at line 856 (no longer used in the remaining branch).
  - The `selectRoomType` function at `BookingPage.tsx:935-960` is unchanged.
  - The `updateRoomQuantity` function at `BookingPage.tsx:962-...` is unchanged.
  - The `selectedRoomType` state at `BookingPage.tsx:244` is unchanged (still initialized from `searchParams.get("roomType")`).
  - The `roomCart` state at `BookingPage.tsx:243` is unchanged (still initialized from `searchParams.get("rooms")` via the cart parser).
  - The bottom bar's disabled-state label at `BookingPage.tsx:2900` ("Add at least one room") is unchanged.
  - ~14 lines removed + 1 line from the dependency array.

### Gates

- **CHD-12 (cart summary)** — the "Your cart" empty-state is already wired (just shows the header). No change.
- **CHD-11 (capacity chip)** — the chip is gated on `isSelected = typeQuantity > 0`. No change.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extras toggle + auto-init)** — the IIFE + auto-init useEffect are gated on `typeMaxExtraBeds > 0` and `roomCart.length > 0` (via the per-type check). No change.
- **Step 2/3 aside** — gated on `selectedRoomType` non-empty. No change.
- **Step 1 → Step 2 "Next" button** — the "Add at least one room" CTA is already wired. No change.
- **MRB-15-10 + MRB-15-11 (admin room-type CRUD + photo gallery)** — unrelated. The admin surface for editing room types is unchanged.
- **CHD-13 (homepage search widget)** — unrelated. The homepage widget sends the user to `/book?guests=...&children=...` without a `?roomType=` param, so the deep-link pre-fill doesn't fire; the user lands on the empty-cart default state and picks a type. That's the intended flow.

### Phase 2 (deferred, NOT in EXB-11.3)

- **"Recommended for you" badge on the first card** (e.g., based on the homepage's search params). A future UX work item if the operator wants to add a soft hint without auto-selecting. Out of scope — the operator's ask is "no default", and a recommendation badge is a different shape.
- **A "Recently viewed" section on `/book`** that shows room types the user has clicked on in previous sessions. A future UX work item; would require storing the click history in localStorage or a session-scoped store.
- **Auto-select the first type that fits AND add it to the cart, but only for returning users** (e.g., a returning user with a saved cart). A future UX work item; would require user auth + cart persistence.
- **Re-introduce the auto-select as a hidden `?autoSelect=true` URL param** for A/B testing. A future testing work item; out of scope.

---

---

---

## Lifecycle Invariants (MRB-15-01)
> Decision: `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-01 sub-item, shipped v0.249.0). The full create → cancel lifecycle must produce exactly ONE of each cross-cutting effect: counter increment, email template render, loyalty earn/clawback entry, status flip. The MRB-15-01 audit pins these invariants in source-text form so a future refactor cannot silently double-fire any of them.

### Cross-cutting invariants (the lifecycle "exactly-once" guarantees)

- **Counter increments**: exactly ONE `roomCount` increment at create, exactly ONE `activeRoomCount` increment at create, exactly ONE `cancelledRoomCount` increment per cancelled child. See `plan/docs/BACKEND.md §Reservation Aggregate Counter Ownership (MRB-15)` for the full counter ownership table.
- **Email template renders**: exactly ONE per-action email template render (no `booking-cancelled` AND `booking-cancelled-reservation` firing for the same destroy). The dispatch is in `handleCancelBooking`'s `postTransactionAction: "booking-cancelled" | "booking-cancelled-reservation"` local.
- **Loyalty earn + clawback**: exactly ONE `earn-${bookingId}` pointsHistory entry on the eventual check-out, exactly ONE `clawback-${bookingId}` pointsHistory entry per cancelled child. The pairing uses deterministic doc ids (see `plan/docs/TYPES.md §Loyalty Earn + Clawback Pairing (MRB-15-07)`).
- **Status flips**: exactly ONE status transition per child per lifecycle event. The status matrix is the server-authoritative source.

### Test coverage

`guest-app/tests/api/mrb-15-01-lifecycle-invariants.test.ts` (14 tests) — pins the "exactly-once" guarantees for every cross-cutting effect in the create → cancel lifecycle.

---

## CHD-11.1 — Picker Auto-Bumps Guests to Fit More Children
> Proposed 2026-08-04, per decision #192 (operator feedback post-EXB-11.3 review). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:874-903` (the `updateGuests` + `updateChildren` functions), `BookingPage.tsx:536-552` (the `selectedMaxSelectableChildren` derivation), `BookingPage.tsx:2189-2220` (the children stepper's `+` button disabled condition). Sibling to CHD-11 — same picker surface, different UX refinement.

### The problem

Operator-reported 2026-08-04 (post-EXB-11.3 review): "why is it for the single room, it says up to 1 adult + 2 children but for the picker, the + button is disabled so I am only limited to 1 children." The reproduction: 1 Single Room (`maxCapacity: 1`, `maxChildren: 2`, `maxExtraBeds: 1`), 2 guests (1 adult + 1 child). The user wants to add a 2nd child. The room card's amenity line says "Up to 1 adult + 2 children", but the picker's `+` button is disabled (greyed out) at 1 child.

**Root cause.** The pre-CHD-11.1 `updateChildren` function at `BookingPage.tsx:892-903` clamps to `Math.min(Math.max(nextChildren, 0), selectedMaxSelectableChildren, Math.max(0, guests - 1))`. The `Math.max(0, guests - 1)` is the "at least one adult in the booking" invariant (per CHD-05) — a hard cap that prevents the picker from going past `guests - 1` children. With 2 guests, that's 1 child max. The user can't even attempt to add a 2nd child.

But the room CAN hold 1 adult + 2 children (= 3 occupants, within the Single Room's soft capacity of `maxCapacity + maxChildren = 1 + 2 = 3` occupants, no extra bed needed). The picker's hard cap is preventing the user from reaching a state the room card says is valid.

The constraint is two-layered:
- **Booking constraint** (per CHD-05): `numAdults + numChildren = guests`, `numAdults >= 1`. With 2 guests, the booking can have at most 1 child.
- **Room constraint** (per CHD-11): the room can hold up to `maxCapacity + maxChildren + maxExtraBeds` occupants, with the per-bucket caps (`maxCapacity` adults, `maxChildren` children). The room can hold 1 adult + 2 children in the Single Room's 3-slot soft capacity.

The pre-CHD-11.1 picker enforces the **booking** constraint as a hard cap, but the **room** constraint is more permissive. The fix: let the picker respect the **room** constraint (the higher of the two), and auto-bump the booking's `guests` to maintain the **booking** invariant when needed.

### The fix — refactor `updateChildren` + `selectedMaxSelectableChildren` to auto-bump `guests`

**Three-part change to `BookingPage.tsx`:**

1. **Refactor `updateGuests` + `updateChildren` to share a `setOccupancy` helper.** The two functions duplicate the URL-update logic (both write `guests` + `children` + `roomType` to the URL). Extract a `setOccupancy(nextGuests, nextChildren)` helper that does the clamping + URL write, and have both functions call it. The clamping in `setOccupancy` includes the `safeGuests - 1` floor for children (so `updateGuests(1)` still clamps children to 0 — the "at least 1 adult" invariant is preserved for guest drops too).

2. **Change `updateChildren` to auto-bump `guests` when the desired children would leave 0 adults.** Instead of clamping to `Math.max(0, guests - 1)`, compute `desiredChildren = min(max(nextChildren, 0), selectedMaxSelectableChildren)`, then `newGuests = max(guests, desiredChildren + 1)`, and call `setOccupancy(newGuests, desiredChildren)`. The auto-bump ensures `numAdults = newGuests - desiredChildren >= 1` — the "at least 1 adult" invariant is preserved.

3. **Update `selectedMaxSelectableChildren` derivation to account for the auto-bump.** The existing derivation at `BookingPage.tsx:536-552` loops `children` from 0 to `Math.max(0, guests - 1)`, computing the overflow for each `(children, guests - children)` pair. With the auto-bump, the user can go above `guests - 1` (the auto-bump handles the invariant). The new derivation:
   - For each `N` from 0 to 10 (the soft cap from CHD-11):
     - `effectiveGuests = max(originalGuests, N + 1)` (auto-bump if needed)
     - `numAdults = effectiveGuests - N` (always >= 1 after auto-bump)
     - `overflow = requiredExtraBedsFor({ numAdults, numChildren: N, maxCapacity, maxChildren }).requiredExtraBeds`
     - If `overflow <= maxExtraBeds`, `N` is supported.
   - The highest supported `N` is the cap.
   - The existing `for` loop's bound `Math.max(0, guests - 1)` becomes `10` (or some higher bound). The new formula handles the auto-bump scenario.

4. **Update the children stepper's `+` button disabled condition.** Currently `numChildren >= Math.min(10, Math.max(0, guests - 1))` (per `BookingPage.tsx:2217`). The new condition: `numChildren >= Math.min(10, selectedMaxSelectableChildren)`. The `selectedMaxSelectableChildren` is now the room's capacity (with auto-bump), not the booking's "guests - 1" cap.

### What the user sees

**Before CHD-11.1 (the bug):**
- 2 guests (1 adult + 1 child), 1 Single Room in cart.
- Children picker shows "1 child (1 adult)" with the `+` button disabled.
- User can't add a 2nd child even though the room can hold 1 adult + 2 children.
- Room card's amenity line says "Up to 1 adult + 2 children" but the picker prevents it.

**After CHD-11.1 (the fix):**
- 2 guests (1 adult + 1 child), 1 Single Room in cart.
- Children picker shows "1 child (1 adult)" with the `+` button **enabled**.
- User clicks `+` on children → 3 guests (1 adult + 2 children), picker shows "2 children (1 adult)", room card's "Fits your group" chip shows (the room fits 1 adult + 2 children in the soft capacity).
- User clicks `+` again → 4 guests (1 adult + 3 children), picker shows "3 children (1 adult)", room card's "Fits your group" chip shows (the room fits 1 adult + 3 children with 1 extra bed).
- User clicks `+` again → 5 guests (1 adult + 4 children), picker shows "4 children (1 adult)", `+` button is now disabled (the room's cap with `maxExtraBeds 1` is 3 children; the `+` won't go past).
- The CHD-11 capacity chip on the room card updates live (Fits / Tight / Doesn't fit) based on the new guest count.

**The "at least 1 adult" invariant is still preserved.** The auto-bump maintains `numAdults = newGuests - numChildren >= 1` for every state transition. If the user manually decrements `guests` (via the Adults stepper — wait, there's no Adults stepper, just Guests; the `updateGuests` function is the entry point), `updateGuests(1)` clamps children to 0 (via `safeChildren = min(numChildren, max(0, safeGuests - 1))` in `setOccupancy`).

### Why the new derivation is right

The pre-CHD-11.1 derivation was bounded by `guests - 1` (the booking's "at least 1 adult" invariant). This was correct for the pre-CHD-11.1 cap (the picker hard-capped at `guests - 1`), but the cap was too restrictive — the user couldn't reach states the room supported. With the auto-bump, the user can go above `guests - 1` (the auto-bump handles the invariant), so the derivation should bound by the **room's** capacity (10, the soft cap), not the booking's invariant.

The auto-bump in the derivation handles the invariant naturally:
- For each candidate `N`, compute the post-bump `effectiveGuests` and `numAdults`.
- The room supports `N` children if the overflow (with the post-bump `numAdults`) fits in `maxExtraBeds`.

This is the right model: the user is free to pick any `N` the room supports, and the auto-bump maintains the booking's invariant.

### What this changes for the data model

**Nothing.** The `guests: number` state stays. The `numChildren: number` state stays. The `numAdults = max(0, guests - numChildren)` derivation stays. The `selectedMaxSelectableChildren` derivation is updated (same name, new formula). The `setOccupancy` helper is new (extracted from `updateGuests` + `updateChildren`). The `updateGuests` and `updateChildren` functions stay (call `setOccupancy`).

### What this changes for the related work

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` per child. CHD-11.1 only changes the client-side picker behavior. The invariant is preserved via auto-bump (client) and server-side validation (server).
- **CHD-11 (soft-constraint picker)** — the per-type `maxChildren` cap is still the upper bound. The picker just allows the user to explore up to that cap (and beyond, with extra beds) instead of hard-capping at `guests - 1`. The CHD-11 capacity chip on the room card is the verification surface.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extra-bed toggle + auto-init)** — the extras toggle's `requiredExtraBedsFor` is the same helper used in the new `selectedMaxSelectableChildren` derivation. The auto-init useEffect at `BookingPage.tsx:740-758` re-fires when `numAdults` or `numChildren` change (via the `roomCart` and the per-type check). No change.
- **Step 2/3 aside** — the extra-bed pricing updates live as the user changes the children count. No change.
- **MRB-15-10 + MRB-15-11 (admin room-type CRUD + photo gallery)** — unrelated. The admin surface for editing `maxChildren` and `maxExtraBeds` is unchanged.
- **CHD-13 (homepage search widget)** — unrelated. The homepage widget sends `?guests=...&children=...` to `/book`, which is the URL pre-fill. The `/book` page reads both via `searchParams.get("guests")` and `searchParams.get("children")` at `BookingPage.tsx:214,220`. The picker init from the URL params is unchanged.
- **EXB-11.3 (no default room-type selection)** — independent. EXB-11.3 removes the auto-select branch on page load. CHD-11.1 changes the children picker's auto-bump behavior. They don't interact (EXB-11.3 affects the room-type card selection; CHD-11.1 affects the children stepper).

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/chd-11-1-picker-auto-bump-guests.test.ts` (source-text guards on `BookingPage.tsx`):

- A `setOccupancy(nextGuests, nextChildren)` helper is **defined** (the extracted shared function).
- `updateGuests` calls `setOccupancy(nextGuests, numChildren)` (no change in children's behavior).
- `updateChildren` computes `desiredChildren = min(max(nextChildren, 0), selectedMaxSelectableChildren)` (no `guests - 1` cap) and `newGuests = max(guests, desiredChildren + 1)` (the auto-bump).
- The `Math.max(0, guests - 1)` clamp is **gone** from `updateChildren` (was at line 896 of the pre-CHD-11.1 file).
- The `selectedMaxSelectableChildren` derivation's loop bound is **not** `Math.max(0, guests - 1)` anymore — it's the soft cap (e.g., `10`).
- The new derivation uses `effectiveGuests = max(guests, N + 1)` (the auto-bump scenario) when computing the overflow.
- The children stepper's `+` button disabled condition is `numChildren >= Math.min(10, selectedMaxSelectableChildren)` (not `Math.max(0, guests - 1)`).
- The `Math.max(0, guests - 1)` formula in the `+` button's disabled condition is **gone**.

The behavioural test (the user starts at 2 guests + 1 child, clicks `+` on children, sees 3 guests + 2 children, the room's "Fits your group" chip shows) is out of scope for this sandbox.

### Rejected alternatives

- **Don't auto-bump; let the user manually bump guests via the Guests stepper first.** Forces the user to do a 2-step action (bump guests, then bump children). The auto-bump is a 1-step action. Worse UX.
- **Show a hint: "Want 2 children? Bump up guests to 3+" with a quick action.** Hint + quick action is more UI than auto-bump. The auto-bump is invisible and the right thing happens.
- **Remove the "at least 1 adult" invariant entirely (allow 0 adults + N children).** Violates the CHD-05 contract. The server validates `numAdults >= 1`; the client should too. The auto-bump is the right way to maintain the invariant.
- **Keep the existing `selectedMaxSelectableChildren` derivation bounded by `guests - 1` and just allow the picker to go above that bound (without a derivation update).** The cap would be wrong for higher children counts. The derivation must be updated to match the new cap.
- **A "harder" fix: when the user clicks `+` on children and it would leave 0 adults, show a modal asking "Bump up to 3 guests?"** Modal is a friction point. The auto-bump is invisible.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - **Extract `setOccupancy(nextGuests, nextChildren)` helper** at the location of the existing `updateGuests` (around line 874). The helper does the clamping (`safeGuests`, `safeChildren`), the `setGuests` + `setNumChildren` + `setGuestDetails` updates, and the URL write.
  - **Refactor `updateGuests`** to call `setOccupancy(nextGuests, numChildren)` (no change in behavior).
  - **Refactor `updateChildren`** to:
    - Compute `desiredChildren = Math.min(Math.max(nextChildren, 0), selectedMaxSelectableChildren)`.
    - Compute `newGuests = Math.max(guests, desiredChildren + 1)`.
    - Call `setOccupancy(newGuests, desiredChildren)`.
  - **Update `selectedMaxSelectableChildren` derivation** to:
    - Loop `N` from 0 to 10 (the soft cap).
    - For each `N`, compute `effectiveGuests = Math.max(guests, N + 1)` and `numAdults = effectiveGuests - N`.
    - Compute the overflow via `requiredExtraBedsFor` with `(numAdults, N, maxCapacity, maxChildren)`.
    - If `overflow <= maxExtraBeds`, the cap is at least `N`.
  - **Update the children stepper's `+` button disabled condition** from `numChildren >= Math.min(10, Math.max(0, guests - 1))` to `numChildren >= Math.min(10, selectedMaxSelectableChildren)`.
  - The `−` button's disabled condition (`numChildren <= 0`) is unchanged.
  - The `setNumChildren` and `setGuests` state setters stay.
  - The URL pre-fill from `searchParams.get("guests")` and `searchParams.get("children")` is unchanged.
  - ~20 lines changed in `BookingPage.tsx` (extracted helper + refactored functions + updated derivation + updated disabled condition).

### Gates

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` and `numAdults >= 1`. The client-side auto-bump maintains the invariant; the server-side validation is a safety net.
- **CHD-11 (soft-constraint picker)** — the per-type `maxChildren` cap is still the upper bound. The picker just allows the user to explore up to that cap (and beyond, with extra beds) instead of hard-capping at `guests - 1`. The CHD-11 capacity chip on the room card is the verification surface.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extra-bed toggle + auto-init)** — the extras toggle uses the same `requiredExtraBedsFor` helper as the new `selectedMaxSelectableChildren` derivation. The auto-init useEffect re-fires when `numAdults` or `numChildren` change. No change.
- **Step 2/3 aside** — the extra-bed pricing updates live. No change.
- **MRB-15-10 + MRB-15-11** — unrelated.
- **CHD-13 (homepage search widget)** — unrelated. The homepage widget sends `?guests=...&children=...`; the `/book` page reads both. The picker init from the URL is unchanged.
- **EXB-11.3 (no default room-type selection)** — independent. EXB-11.3 affects the room-type card selection on page load; CHD-11.1 affects the children stepper. They don't interact.

### Phase 2 (deferred, NOT in CHD-11.1)

- **A separate "Adults" stepper on the homepage widget and `/book` picker** (instead of the single "Guests" stepper that auto-derives adults from `guests - children`). The current shape (one Guests stepper + one Children stepper, with `numAdults` derived) is consistent with `/book` and the homepage widget. Mirroring CHD-13's "Adults + Children" popover. Out of scope — the auto-bump is the right fix for the current surface; a separate Adults stepper is a bigger UX change.
- **Smarter auto-bump: when the user clicks `+` on children and the room doesn't support the result, show a hint ("Add a second room to fit 3 children") instead of just disabling the `+` button.** A future UX work item; the CHD-11 capacity chip + the submit gate are the current surfaces for "room doesn't fit".
- **A "Reset to 1 adult + 0 children" quick action** that sets guests to 1 and children to 0 in one click. A future UX work item; out of scope.
- **Visual feedback when the auto-bump fires** (e.g., the Guests stepper briefly highlights to show "we added a guest for you"). The auto-bump is silent in the spec; a future UX work item could add visual feedback. Out of scope — the auto-bump is the right default; the user notices the change in the stepper display.

---

## CHD-11.2 — Picker Cap Raised to Soft 10 (No Per-Type Cap on the `+` Button)
> Proposed 2026-08-05, per decision #193 (operator feedback post-CHD-11.1 review). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:2189-2220` (the children stepper's `+` button disabled condition). Sibling to CHD-11 + CHD-11.1 — same picker surface, different UX refinement.

### The problem

Operator-reported 2026-08-05 (post-CHD-11.1 review): "why is it the children + chip is disabled after 3? maybe we can disable that disabling?" The pre-CHD-11.2 surface has a UX issue: the children picker's `+` button is disabled at the room's capacity (e.g., 3 for a Single Room with `maxCapacity: 1`, `maxChildren: 2`, `maxExtraBeds: 1`). The user can pick up to 3 children, but not more — even though the system can validate the over-cap case via the "Fits your group" chip + the submit gate.

**Root cause.** The pre-CHD-11.2 `+` button's `disabled` condition was `numChildren >= Math.min(10, selectedMaxSelectableChildren)` (per `BookingPage.tsx:2217`). The `selectedMaxSelectableChildren` is the room's capacity (with auto-bump, per CHD-11.1) — for a Single Room, that's 3 children (1 adult + 3 children = 4 occupants, with 1 extra bed, within the hard capacity of `maxCapacity + maxChildren + maxExtraBeds = 1 + 2 + 1 = 4`). The picker is hard-capping at the room's capacity, which is the wrong enforcement surface — per CHD-11's "exploration-first, validation-on-commit" pattern, the picker should be an exploration surface (let the user pick any number), and the "Fits your group" chip + the submit gate are the commit surfaces (validate the room fits).

**The trade-off the operator hit.** With the pre-CHD-11.2 cap, the user wanted to pick 4 children in 1 Single Room (which would require 3 extra beds, maxExtraBeds 1 → "doesn't fit"). The picker blocked them at 3. The "Fits your group" chip would have shown "Doesn't fit", and the submit gate would have surfaced the over-cap error. But the picker never gave them the chance to explore the over-cap state — they were stuck at 3.

### The fix — raise the picker cap to the soft 10 (CHD-11's sanity guard)

**One-line change to `BookingPage.tsx`:**

The `+` button's `disabled` condition changes from:
```tsx
disabled={numChildren >= Math.min(10, selectedMaxSelectableChildren)}
```
to:
```tsx
disabled={numChildren >= 10}
```

The `selectedMaxSelectableChildren` derivation stays (it's still used by the "Fits your group" chip + the CHD-11 capacity indicator at `BookingPage.tsx:2175` and the cart summary). The `−` button's `disabled` condition (`numChildren <= 0`) is unchanged. The auto-bump in `updateChildren` is unchanged (per CHD-11.1). The URL pre-fill from `searchParams.get("children")` is unchanged.

### What the user sees

**Before CHD-11.2 (the bug):**
- 1 Single Room (maxCapacity: 1, maxChildren: 2, maxExtraBeds: 1), 2 guests.
- Children picker: `+` button enabled at 0, 1, 2; disabled at 3 (the room's capacity).
- User wants to pick 4 children to see the "Doesn't fit" chip + decide whether to add a second room.
- The picker blocks them at 3. They have to manually change `guests` to 5 first (to allow 4 children via auto-bump), then back to 4 — a 2-step action.

**After CHD-11.2 (the fix):**
- 1 Single Room, 2 guests, 0 children.
- Children picker: `+` button enabled at 0..9; disabled at 10 (the soft cap from CHD-11).
- User clicks `+` 3 times → 3 children, 3 guests (auto-bump), `+` still enabled. "Fits your group" chip shows.
- User clicks `+` once more → 4 children, 4 guests (auto-bump), `+` still enabled. "Doesn't fit" chip shows (the room needs 3 extra beds, maxExtraBeds 1).
- User clicks `+` repeatedly until 10 children, 10 guests. `+` disabled. The "Doesn't fit" chip stays. The submit gate catches it.
- User can now explore freely: pick any number, the chip + submit gate tell them if it works. They can decide whether to add a second room, remove children, or pick a different room type.

**The auto-bump from CHD-11.1 still works.** When the user clicks `+` on children beyond the current `guests - 1` (the "at least 1 adult" invariant), `updateChildren` auto-bumps `guests` to `max(guests, desiredChildren + 1)`. The user can keep clicking `+` without manually bumping `guests` first.

**The submit gate still validates.** The existing CHD-11 submit gate (at `BookingPage.tsx:2896-2900` and the `cartFitsGroup` derivation) catches the over-cap case at Step 1 → Step 2 with the "Pick a different room type, add a second room, or remove a guest" error. The picker is no longer blocking the user from reaching this state; the submit gate is.

### Why the soft 10 is the right cap (not the room's capacity, not unlimited)

The CHD-11 spec says the soft cap is `MIN(10, guests - 1)` — a "stop the + at 100" sanity guard, not a capacity rule. The 10 is a UX sanity guard (no one books a 50-child hotel room via the homepage widget). The pre-CHD-11.2 cap of `MIN(10, selectedMaxSelectableChildren)` overrode the 10 with the room's capacity, which is the wrong layer.

The new cap `10` (the CHD-11 sanity guard) is:
- **Higher than the per-type capacity** for most room types (a Family Room's `selectedMaxSelectableChildren` is typically 4-6, so the soft 10 is more permissive).
- **Lower than "unlimited"** — a sanity guard against pathological inputs (e.g., a returning user who hits `+` 50 times).
- **Consistent with the homepage widget's children picker** (CHD-13), which also uses 0-10.

### What this changes for the data model

**Nothing.** The `numChildren: number` state stays. The `selectedMaxSelectableChildren` derivation stays (used by the chip + capacity indicator). The `updateChildren` function is unchanged (per CHD-11.1). The `setOccupancy` helper is unchanged. The auto-bump is unchanged. The submit gate is unchanged.

### What this changes for the related work

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` and `numAdults >= 1`. The client-side picker is just less restrictive; the server is the authoritative gate.
- **CHD-11 (soft-constraint picker)** — the picker is now a true exploration surface. The "Fits your group" chip + the submit gate are the commit surfaces. The CHD-11 promise ("exploration-first, validation-on-commit") is now fully realized.
- **CHD-11.1 (auto-bump guests)** — the auto-bump in `updateChildren` is unchanged. The user's experience is smoother because they can now click `+` repeatedly without manually bumping `guests` first.
- **CHD-12 (cart summary)** — the per-type "N extra beds" inline pill is unchanged. The data is the same shape; only the picker's cap changes.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extras toggle + auto-init)** — the extras toggle uses `requiredExtraBedsFor` to compute the soft floor; the auto-init useEffect re-fires when `numAdults` or `numChildren` change. No change.
- **Step 2/3 aside** — the extra-bed pricing updates live. No change.
- **MRB-15-10 + MRB-15-11** — unrelated.
- **CHD-13 (homepage search widget)** — the homepage widget's children picker is also capped at 0-10 (per CHD-13). The new cap is consistent with the homepage widget.
- **EXB-11.3 (no default room-type selection)** — independent.

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/chd-11-2-picker-cap-soft-10.test.ts` (source-text guards on `BookingPage.tsx`):

- The children stepper's `+` button disabled condition is `numChildren >= 10` (NOT `Math.min(10, selectedMaxSelectableChildren)`).
- The pre-CHD-11.2 disabled condition (`numChildren >= Math.min(10, selectedMaxSelectableChildren)`) is **gone**.
- The `selectedMaxSelectableChildren` derivation is **still present** (still used by the "Fits your group" chip + the CHD-11 capacity indicator).
- The `−` button's disabled condition (`numChildren <= 0`) is unchanged.
- The `updateChildren` function (with the CHD-11.1 auto-bump) is unchanged.
- The `setOccupancy` helper (with the `safeGuests - 1` floor for children) is unchanged.
- The submit gate (`cartFitsGroup` derivation) is unchanged.

The behavioural test (the user clicks `+` on children past 3, sees the "Doesn't fit" chip, decides what to do) is out of scope for this sandbox.

### Rejected alternatives

- **No upper cap at all (let the user click `+` indefinitely).** A sanity guard is needed. The soft 10 is the right balance: more permissive than the room's capacity, less chaotic than unlimited.
- **Cap at `MIN(20, selectedMaxSelectableChildren)` or some other higher value.** The CHD-11 spec's `10` is the right sanity guard. No reason to deviate.
- **Cap at `guests` (the booking's total).** This is the pre-CHD-11.1 behavior — the user can pick `guests - 1` children max, then the picker blocks them. The auto-bump in CHD-11.1 already handles the "at least 1 adult" invariant; the soft 10 is the only cap needed.
- **Remove the cap AND remove the auto-bump (let the user pick 0 adults + N children).** Violates the CHD-05 contract. The server validates `numAdults >= 1`; the client should too.
- **Show a "Room full" tooltip when the user clicks `+` past the room's capacity.** A tooltip is a friction point. The "Doesn't fit" chip + the submit gate are the existing surfaces for "the room doesn't fit"; the picker doesn't need to add another.
- **Change the chip to be more aggressive (e.g., red border + warning text) when the user is over the room's capacity.** The existing chip is already a "Fits / Tight / Doesn't fit" indicator. The color + label is enough signal. No new visual treatment needed.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - Change the children stepper's `+` button disabled condition from `numChildren >= Math.min(10, selectedMaxSelectableChildren)` to `numChildren >= 10` (one-line change at `BookingPage.tsx:2217`).
  - Update the comment block above the disabled condition (currently at `BookingPage.tsx:2211-2216`) to document the new shape and reference the CHD-11.2 decision.
  - The `selectedMaxSelectableChildren` derivation is unchanged.
  - The `−` button's disabled condition is unchanged.
  - The `updateChildren` function (with the auto-bump) is unchanged.
  - The "Fits your group" chip + the submit gate are unchanged.
  - ~5 lines changed (1 regex update + the comment block).

### Gates

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` and `numAdults >= 1`. The client-side picker is just less restrictive; the server is the authoritative gate.
- **CHD-11 (soft-constraint picker)** — the picker is now a true exploration surface. The "Fits your group" chip + the submit gate are the commit surfaces. The CHD-11 promise is now fully realized.
- **CHD-11.1 (auto-bump guests)** — the auto-bump in `updateChildren` is unchanged. The user's experience is smoother because they can now click `+` repeatedly without manually bumping `guests` first.
- **CHD-12 (cart summary)** — the per-type "N extra beds" inline pill is unchanged. The data is the same shape; only the picker's cap changes.
- **EXB-11 + EXB-11.1 + EXB-11.2** — the extras toggle + auto-init useEffect are unchanged. The auto-init re-fires when `numAdults` or `numChildren` change.
- **Step 2/3 aside** — unchanged.
- **MRB-15-10 + MRB-15-11** — unrelated.
- **CHD-13 (homepage search widget)** — the homepage widget's children picker is also capped at 0-10. The new cap is consistent.
- **EXB-11.3 (no default room-type selection)** — independent.

### Phase 2 (deferred, NOT in CHD-11.2)

- **A more aggressive "Fits your group" chip when the user is over the room's capacity** (e.g., red border + warning text). The existing chip is already a "Fits / Tight / Doesn't fit" indicator; the color + label is enough signal. A future UX work item could add more visual treatment.
- **A "Room full" tooltip on the `+` button when the user is past the room's capacity.** A tooltip is a friction point. The "Doesn't fit" chip + the submit gate are the existing surfaces.
- **A "0 adults + N children" mode (remove the "at least 1 adult" invariant for dorm-style rooms).** Out of scope — the CHD-05 contract preserves the invariant. A future work item could add a "Dorm" room type with `maxAdults: 0, maxChildren: 20` if the operator wants to support youth-group bookings.
- **A "Reset to 1 adult + 0 children" quick action** (a single click to reset the picker). A future UX work item; out of scope.
- **Per-room-type picker cap** (e.g., a "Preschool" room type caps at 5 children, a "Family" room type caps at 8). A future work item; out of scope — the soft 10 is the right sanity guard for now.

---

## CHD-11.3 — Symmetric Auto-Bump + Remove All Per-Type Caps from the Picker
> Proposed 2026-08-05, per decision #194 (operator feedback post-CHD-11.2 review). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:910-960` (the `setOccupancy` + `updateGuests` + `updateChildren` functions), `BookingPage.tsx:550-566` (the `selectedMaxSelectableChildren` derivation — stays for the chip hint but is no longer used as a clamp). Sibling to CHD-11 + CHD-11.1 + CHD-11.2 — same picker surface, deeper UX fix.

### The problem

Operator-reported 2026-08-05 (post-CHD-11.2 review): "the maximum I can have is still 3 — the max config I can have is 4 adults and 3 children, when I make it 6 guests, no more children it becomes 0. Can we not have any guards to the numbers?" The pre-CHD-11.3 surface has two residual UX issues that violate the CHD-11 "exploration-first, validation-on-commit" promise:

**Issue 1: "the maximum I can have is still 3"** — the per-type cap (`selectedMaxSelectableChildren`) is still firing in `setOccupancy` and `updateChildren`. Even with CHD-11.2 (which removed the per-type cap from the `+` button's `disabled` condition), the value silently snaps back to `selectedMaxSelectableChildren` when the user clicks `+` past the cap. For a Single Room with `maxCapacity: 1`, `maxChildren: 2`, `maxExtraBeds: 0`, the cap is 3 (1 adult + 3 children fits in 0 extra beds; 4 children would need 1 extra bed, maxExtraBeds 0 → doesn't fit). The user wants to pick 4 children, but the system silently drops it back to 3.

**Issue 2: "when I make it 6 guests, no more children it becomes 0"** — the `Math.max(0, safeGuests - 1)` clamp in `setOccupancy` fires when the user lowers `guests` to a value where `children + 1 > guests` (would leave 0 adults). With guests=2 and children=3, the formula says `max(0, 2-1) = 1`, so children drops from 3 to 1. The user was at 3, then adjusted guests down past the "at least 1 adult" floor, and the system silently dropped their children count instead of bumping guests up.

**Root cause.** Both issues come from the same root: the client-side guards in `setOccupancy` + `updateChildren` are enforcing things the submit gate can validate. Per CHD-11's "exploration-first, validation-on-commit" promise, the picker should be a pure exploration surface — let the user pick any (guests, children) combination, and let the "Fits your group" chip + the submit gate do the validation.

### The fix — symmetric auto-bump + remove all per-type caps

**Three-part change to `BookingPage.tsx`:**

1. **Remove the per-type cap (`selectedMaxSelectableChildren`) from `setOccupancy` + `updateChildren`.** The clamping chain in `setOccupancy`'s `safeChildren` becomes `Math.max(0, Math.min(nextChildren, safeGuests - 1))` (the "at least 1 adult" invariant only, no per-type cap). The `updateChildren`'s `desiredChildren` becomes `Math.max(nextChildren, 0)` (no per-type cap, just the floor of 0). The `selectedMaxSelectableChildren` derivation stays (used by the "Up to N can fit when extra beds cover the overflow" hint in the chip), but it's no longer a clamp.

2. **Add a symmetric auto-bump to `updateGuests`.** Currently `updateGuests(nextGuests)` calls `setOccupancy(nextGuests, numChildren)` directly. If the user lowers `guests` to a value where `children + 1 > guests` (would leave 0 adults), the new behavior is to auto-bump `guests` up to `children + 1` instead of clamping `children` down to `guests - 1`. The new `updateGuests` becomes:
   ```ts
   function updateGuests(nextGuests: number) {
     // Per CHD-11.3: symmetric auto-bump. If the user
     // lowers `guests` below `children + 1` (would
     // leave 0 adults), bump `guests` up to
     // `children + 1` instead of clamping `children`
     // down. This is the mirror of `updateChildren`'s
     // auto-bump.
     const newGuests = Math.max(nextGuests, numChildren + 1);
     setOccupancy(newGuests, numChildren);
   }
   ```
   The "at least 1 adult" invariant is maintained via auto-bump (not clamp), consistent with `updateChildren`'s auto-bump.

3. **Keep the `Math.max(0, safeGuests - 1)` clamp in `setOccupancy` as defense in depth.** The server-side CHD-05 validation is the authoritative gate, but the client-side mirror is a UX safety net (e.g., if a deep-link sends `?children=99&guests=2`, the system shouldn't display 99 children with 0 adults — the clamp keeps the UI consistent with the invariant). After `updateGuests`'s auto-bump, the clamp is mostly redundant for the user-driven case, but it catches deep-links and edge cases.

**Net effect on `setOccupancy`:**
```ts
function setOccupancy(nextGuests: number, nextChildren: number) {
  const safeGuests = Math.min(Math.max(nextGuests, 1), maxGuestCapacity);
  const safeChildren = Math.max(0, Math.min(nextChildren, safeGuests - 1));
  setGuests(safeGuests);
  setNumChildren(safeChildren);
  setGuestDetails((current) => ({
    ...current,
    guestCount: String(safeGuests)
  }));
  const next = new URLSearchParams(searchParams);
  next.set("checkIn", checkIn);
  next.set("checkOut", checkOut);
  next.set("guests", String(safeGuests));
  next.set("children", String(safeChildren));
  if (selectedRoomType) next.set("roomType", selectedRoomType);
  setSearchParams(next, { replace: true });
}
```
The `selectedMaxSelectableChildren` clamp is gone. The `Math.max(0, safeGuests - 1)` clamp stays (defense in depth).

**Net effect on `updateChildren`:**
```ts
function updateChildren(nextChildren: number) {
  // Per CHD-11.3: no per-type cap. The auto-bump
  // maintains the "at least 1 adult" invariant; the
  // `setOccupancy` clamp is the final defense.
  const desiredChildren = Math.max(nextChildren, 0);
  const newGuests = Math.max(guests, desiredChildren + 1);
  setOccupancy(newGuests, desiredChildren);
}
```
The `selectedMaxSelectableChildren` clamp is gone. The auto-bump (bumping `guests` to `desiredChildren + 1`) is unchanged.

### What the user sees

**Before CHD-11.3 (the bug):**
- 1 Single Room (`maxCapacity: 1`, `maxChildren: 3`, `maxExtraBeds: 0`), 2 guests.
- User clicks `+` on children past 3 (the per-type cap) → children silently snaps back to 3. The picker says "3 children" but the user clicked `+` 4 times. **Issue 1**.
- User has guests=2, children=3. Adjusts guests to 1 → children drops to 0 (the `max(0, 1-1) = 0` clamp). The user was at 3, now they're at 0. **Issue 2**.

**After CHD-11.3 (the fix):**
- 1 Single Room, 2 guests.
- User clicks `+` on children to 4 → `desiredChildren = 4` (no per-type cap), `newGuests = max(2, 5) = 5`, `setOccupancy(5, 4)`. Result: guests=5, children=4. The "Fits your group" chip says "Doesn't fit" (the room needs 1 extra bed for 1 adult + 4 children, but `maxExtraBeds: 0`). The submit gate blocks Step 2. The user can add a second room or pick a different room type.
- User has guests=2, children=3. Adjusts guests to 1 → `newGuests = max(1, 3+1) = 4` (the auto-bump), `setOccupancy(4, 3)`. Result: guests=4, children=3. The "Fits your group" chip might say "Fits" or "Tight" depending on the room's capacity. The auto-bump preserves the user's children count.

**The picker is now a pure exploration surface.** The user picks any (guests, children) combination; the system figures out the right total via symmetric auto-bump; the "Fits your group" chip + the submit gate do the validation. No more silent snap-backs. No more "children becomes 0" surprises.

### Why the symmetric auto-bump is the right shape

The pre-CHD-11.3 model was asymmetric:
- `updateChildren`: auto-bump `guests` up to `children + 1` (so the user can pick more children than the current total).
- `updateGuests`: clamp `children` down to `guests - 1` (so the user can lower guests without leaving 0 adults).

This asymmetry is unintuitive. The user expects "I pick a number, the system figures out the right total." The fix is to make `updateGuests` symmetric: if the user picks a `guests` that would leave 0 adults, bump `guests` up to `children + 1` instead of clamping `children` down.

The new model:
- `updateChildren(N)`: `desiredChildren = N`, `newGuests = max(guests, N + 1)`. **Auto-bump guests up**.
- `updateGuests(N)`: `newGuests = max(N, children + 1)`. **Auto-bump guests up** (symmetric).

Both functions bump `guests` up; neither clamps `children` down. The "at least 1 adult" invariant is maintained via auto-bump, not clamp. The user picks a number; the system respects it.

### Why the `Math.max(0, safeGuests - 1)` clamp stays as defense in depth

The user-driven case is covered by the symmetric auto-bump. The clamp catches:
- **Deep-links** — `?children=99&guests=2` shouldn't display 99 children with 0 adults. The clamp brings `children` down to `guests - 1` (e.g., 1 child with 2 guests).
- **Race conditions** — if `updateGuests` and `updateChildren` fire in quick succession, the clamp is a safety net.
- **Edge cases** — e.g., a future refactor that bypasses the auto-bump.

The clamp is a safety net, not an enforcement layer. The enforcement layer is the submit gate (per CHD-11) + the server-side CHD-05 validation.

### What this changes for the data model

**Nothing.** The `guests: number` state stays. The `numChildren: number` state stays. The `numAdults = max(0, guests - numChildren)` derivation stays. The `selectedMaxSelectableChildren` derivation stays (used by the chip's hint text). The `setOccupancy` helper stays. The `updateChildren` function stays. The `updateGuests` function stays. The clamping chain in `setOccupancy` is updated (per-type cap removed).

### What this changes for the related work

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` and `numAdults >= 1`. The client-side auto-bump + clamp mirror this; the server is the authoritative gate.
- **CHD-11 (soft-constraint picker)** — the picker is now a true exploration surface. The "Fits your group" chip + the submit gate are the commit surfaces. The CHD-11 promise is now fully realized (the picker is unconstrained; the validation layers do the work).
- **CHD-11.1 (auto-bump guests from `updateChildren`)** — the auto-bump in `updateChildren` is unchanged. CHD-11.3 adds a symmetric auto-bump in `updateGuests`.
- **CHD-11.2 (picker cap raised to soft 10)** — the picker cap (10) is unchanged. The per-type cap is now gone from the picker (CHD-11.2 already removed it from the `+` button; CHD-11.3 removes it from the clamping chain).
- **CHD-12 (cart summary)** — the per-type "N extra beds" inline pill is unchanged. The data is the same shape; only the picker's clamping chain changes.
- **EXB-11 + EXB-11.1 + EXB-11.2 (extras toggle + auto-init)** — the extras toggle uses `requiredExtraBedsFor` to compute the soft floor; the auto-init useEffect re-fires when `numAdults` or `numChildren` change. No change.
- **Step 2/3 aside** — the extra-bed pricing updates live. No change.
- **MRB-15-10 + MRB-15-11** — unrelated.
- **CHD-13 (homepage search widget)** — the homepage widget's children picker is capped at 0-10 (per CHD-13). The new client-side cap is the same. The homepage widget doesn't have a per-type cap (it doesn't know the room type yet). The submit gate on `/book` catches the over-cap case. No change.
- **EXB-11.3 (no default room-type selection)** — independent.

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

New `guest-app/tests/api/chd-11-3-symmetric-auto-bump.test.ts` (source-text guards on `BookingPage.tsx`):

- The `setOccupancy` helper's `safeChildren` clamp chain is `Math.max(0, Math.min(nextChildren, safeGuests - 1))` (the "at least 1 adult" invariant only, NO `selectedMaxSelectableChildren` in the chain).
- The pre-CHD-11.3 `setOccupancy` clamp chain `..., selectedMaxSelectableChildren, ...` is **gone**.
- The `updateChildren` function's `desiredChildren` is `Math.max(nextChildren, 0)` (NO `selectedMaxSelectableChildren` in the chain).
- The pre-CHD-11.3 `updateChildren` `desiredChildren = Math.min(..., selectedMaxSelectableChildren, ...)` is **gone**.
- The `updateGuests` function computes `newGuests = Math.max(nextGuests, numChildren + 1)` (the symmetric auto-bump).
- The pre-CHD-11.3 `updateGuests` (which called `setOccupancy(nextGuests, numChildren)` directly without auto-bump) is **gone**.
- The `selectedMaxSelectableChildren` derivation is **still present** (used by the "Up to N can fit when extra beds cover the overflow" hint in the chip).
- The `selectedMaxSelectableChildren` is **not** used in any clamping chain (setOccupancy, updateGuests, updateChildren).
- The `Math.max(0, safeGuests - 1)` clamp in `setOccupancy` is **still present** (defense in depth).
- The `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged).
- The `updateChildren`'s `newGuests = Math.max(guests, desiredChildren + 1)` auto-bump is **still present** (the original CHD-11.1 auto-bump).
- The submit gate (`cartFitsGroup` derivation) is **unchanged**.

Update `chd-11-1-picker-auto-bump-guests.test.ts` to remove the `selectedMaxSelectableChildren` references (since they're gone from the clamping chain). Update `chd-05-guest-child-cap.test.ts` similarly.

The behavioural test (the user picks 4 children, the system shows "Doesn't fit" + blocks Step 2; the user lowers guests to 1, the system auto-bumps to children + 1) is out of scope for this sandbox.

### Rejected alternatives

- **Keep the per-type cap in `setOccupancy` but raise it to a higher value** (e.g., `Math.max(0, safeGuests - 1)` + the soft 10). The per-type cap is a soft constraint, not a domain rule. The chip + submit gate catch the over-cap case. The per-type cap belongs in the chip's hint text, not the clamping chain.
- **Remove the per-type cap but keep the asymmetric auto-bump** (only `updateChildren` auto-bumps, `updateGuests` still clamps). The asymmetry is unintuitive. The user expects symmetric behavior.
- **Remove the `Math.max(0, safeGuests - 1)` clamp entirely** (rely only on the auto-bump). The auto-bump covers the user-driven case, but deep-links and race conditions could bypass it. The clamp is a safety net.
- **Show a warning when the user picks more children than the room supports** (e.g., a toast: "You're over the room's capacity"). The "Fits your group" chip + the submit gate are the existing surfaces for this. A toast is a friction point.
- **Auto-add a second room when the user is over the cap** (the "you'd need 2 of [type]" callout from CHD-11). The user might not want a second room; they might want to pick a different room type. The auto-add is presumptuous. The chip + submit gate let the user decide.
- **Move the per-type cap to the server-side validation** (let the client pick anything, the server rejects the over-cap). The server is already the authoritative gate. But the client-side mirror is a UX safety net (e.g., the submit gate catches the over-cap, but the chip should show "Doesn't fit" first to give the user a clear signal before they try to submit).

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - **`setOccupancy` (~3 lines changed):** the `safeChildren` clamp chain becomes `Math.max(0, Math.min(nextChildren, safeGuests - 1))` (remove `selectedMaxSelectableChildren` from the chain). The rest of the function is unchanged.
  - **`updateChildren` (~3 lines changed):** the `desiredChildren` becomes `Math.max(nextChildren, 0)` (remove `selectedMaxSelectableChildren` from the chain). The auto-bump (`newGuests = Math.max(guests, desiredChildren + 1)`) is unchanged.
  - **`updateGuests` (~3 lines changed):** add the symmetric auto-bump. The new function body becomes `const newGuests = Math.max(nextGuests, numChildren + 1); setOccupancy(newGuests, numChildren);`. The pre-CHD-11.3 direct call `setOccupancy(nextGuests, numChildren)` is gone.
  - **`selectedMaxSelectableChildren` derivation (~0 lines changed):** the derivation stays (used by the chip's hint text). The `useMemo`'s dependency array is unchanged.
  - **`+` button (~0 lines changed):** the `disabled` condition is `numChildren >= 10` (CHD-11.2's soft cap, unchanged).
  - **Comments (~10 lines changed):** update the comment blocks above the three functions to document the new shape and reference the CHD-11.3 decision.
  - **Total:** ~10 lines changed.

### Gates

- **CHD-05 (server-side children validation)** — the server still validates `numAdults + numChildren === numGuests` and `numAdults >= 1`. The client-side auto-bump + clamp mirror this; the server is the authoritative gate.
- **CHD-11 (soft-constraint picker)** — the picker is now a true exploration surface. The "Fits your group" chip + the submit gate are the commit surfaces. The CHD-11 promise is now fully realized.
- **CHD-11.1 (auto-bump guests from `updateChildren`)** — the auto-bump in `updateChildren` is unchanged. CHD-11.3 adds a symmetric auto-bump in `updateGuests`.
- **CHD-11.2 (picker cap raised to soft 10)** — the picker cap (10) is unchanged. The per-type cap is now gone from the picker.
- **CHD-12 (cart summary)** — unchanged.
- **EXB-11 + EXB-11.1 + EXB-11.2** — unchanged.
- **Step 2/3 aside** — unchanged.
- **MRB-15-10 + MRB-15-11** — unrelated.
- **CHD-13 (homepage search widget)** — unchanged.
- **EXB-11.3 (no default room-type selection)** — independent.

### Phase 2 (deferred, NOT in CHD-11.3)

- **Per-room-type picker cap** (e.g., a "Preschool" room type caps at 5 children, a "Family" room type caps at 8). A future work item; out of scope — the soft 10 is the right sanity guard for now.
- **A "Room full" warning** when the user is over the cap, separate from the chip. A future UX work item; the chip + submit gate are the existing surfaces.
- **A "Reset to 1 adult + 0 children" quick action** in the picker. A future UX work item; out of scope.
- **Visual feedback when the auto-bump fires** (e.g., the Guests stepper briefly highlights to show "we added a guest for you"). A future UX work item; out of scope — the auto-bump is silent and the user notices the change in the stepper display.
- **Server-side validation for the per-type cap** (mirror the client's removed per-type cap on the server). The server already validates `numAdults + numChildren === numGuests` and the per-room-capacity via `requiredExtraBedsFor`. The server-side `cartFitsGroup` check is the existing per-type-cap validator. No change needed.
- **Move the per-type cap to the homepage widget** (let the user pick children = 0 to 10 on the homepage, but the widget fetches the room's max from the URL and caps at that). A future work item; out of scope — the widget is pre-cart (no room type known), so it can't have a per-type cap.

---

---

---

## CHD-11.4 — Free Expression in the Picker (Submit-Gate Enforces "At Least 1 Adult")
> Proposed 2026-08-05, per decision #195 (operator feedback post-CHD-11.3 review). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:923-977` (the `setOccupancy` + `updateGuests` + `updateChildren` functions). Sibling to CHD-11 + CHD-11.1 + CHD-11.2 + CHD-11.3 — same picker surface, deeper UX fix.

### The problem

Operator-reported 2026-08-05 (post-CHD-11.3 review): "but why is it that there is a gate or connection to the number of adults and children? I want the user to freely express how many people they are in all (adults and children)." The pre-CHD-11.4 surface has one residual UX issue: even with the per-type caps gone (CHD-11.3), the **"at least 1 adult" invariant** is still auto-bumping the Guests stepper when the user adds children. With 2 guests and the user clicking `+` on children, the system silently bumps Guests from 2 to 3 to maintain 1 adult. The user wants to be able to set 5 children + 0 adults (or any other free expression) without the system auto-bumping.

The "at least 1 adult" is a **business rule** (per CHD-05, the server requires at least 1 guest per room; the client-side derivation of `numAdults = guests - children` makes the 1-adult-per-room a derived property). But the **auto-bump in the picker** is the wrong enforcement surface — the picker should be a free expression surface, and the **submit gate** should be the validation surface.

### The fix

Three-part change to `BookingPage.tsx`:

**(1) Remove the auto-bump in `updateChildren`.** The pre-CHD-11.4 `updateChildren` computes `newGuests = Math.max(guests, desiredChildren + 1)` to maintain the invariant. The new shape calls `setOccupancy(guests, desiredChildren)` directly (no auto-bump). The "at least 1 adult" rule is no longer enforced via auto-bump; the submit gate catches the violation.

**(2) Remove the symmetric auto-bump in `updateGuests` (reverses CHD-11.3).** The CHD-11.3 `updateGuests` computes `newGuests = Math.max(nextGuests, numChildren + 1)` to mirror `updateChildren`'s auto-bump. With `updateChildren`'s auto-bump gone, the symmetric counterpart is also gone. The new `updateGuests` calls `setOccupancy(nextGuests, numChildren)` directly (no auto-bump). The "at least 1 adult" rule is no longer enforced via auto-bump.

**(3) Remove the `Math.max(0, safeGuests - 1)` clamp in `setOccupancy`'s `safeChildren` chain (reverses CHD-11.3's defense-in-depth).** The pre-CHD-11.4 chain is `Math.max(0, Math.min(nextChildren, safeGuests - 1))` — the `safeGuests - 1` floor enforces "at least 1 adult" by clamping children down. The new chain is `Math.max(0, Math.min(nextChildren, safeGuests))` — children can be up to `safeGuests` (so `numAdults = safeGuests - safeChildren` can be 0). The submit gate catches the 0-adults case (see below).

### What this changes

- **Picker behavior** — the user can freely set `guests` and `numChildren` to any combination where both are non-negative and `numChildren <= guests` (the new clamp). The user can have 0 adults + 5 children (e.g., for a school group trip). The `+` / `−` buttons are unchanged (CHD-11.2's soft cap of 10 stays; the per-type cap stays gone per CHD-11.3).
- **Submit gate** — the `numAdults >= 1` check at `BookingPage.tsx:724` (in `guestErrors.guestCount`) catches the 0-adults case. The Continue button is disabled with the message "Choose enough rooms to assign every adult and child, with at least one adult in each room." The user adjusts (adds an adult, or removes a child, or removes a room) and Continue re-enables.
- **Per-room check** — the `cartDistributionComplete` check at `BookingPage.tsx:463` (every room has `numAdults >= 1`) catches the per-room violation. The "Adjust room" CTA (per CHD-11) is the existing surface for this error.
- **Server contract** — unchanged. The server (`bookings.ts:1062-1077`) accepts `numAdults: min(0).max(100)` + `numChildren: min(0).max(100)` with the `numAdults + numChildren >= 1` per-room check + the `numAdults + numChildren === guests` consistency check. The client's submit gate mirrors the per-room check; the consistency check is implicit (the client derives `numAdults = guests - children`).

### What the user sees after the change

- **0 adults + 5 children** — user sets Guests to 5, Children to 5. The picker shows 5 / 5 / 0 adults (derived). The chip says "Doesn't fit" (depending on the room's capacity). The submit button is disabled with "Choose enough rooms to assign every adult and child, with at least one adult in each room." The user adds an adult (or removes a child) and submit re-enables.
- **Lower Guests from 3 to 1 with Children=3** — pre-CHD-11.4, this would clamp Children to 0 (the auto-bump in reverse). Post-CHD-11.4, Children stays at 3, numAdults = max(0, 1-3) = 0, submit disabled. The user can freely express the state; the validation surfaces it.
- **Normal case (2 adults + 1 child)** — unchanged. `guests=3, children=1, numAdults=2`. Submit enabled.

### What this changes for the data model

Nothing. `guests` state stays, `numChildren` state stays, `numAdults = max(0, guests - numChildren)` derivation stays (line 221), `selectedMaxSelectableChildren` derivation stays (CHD-11.3 — used by the chip's hint text), `setOccupancy` helper stays (the clamp chain is updated), `updateChildren` function stays (the auto-bump is removed), `updateGuests` function stays (the symmetric auto-bump is removed). The cart URL serialization (`?guests=N&children=N`) stays; the new state shape is byte-equivalent to the old one (the user can have `numAdults = 0` in the state, but the URL still has the `guests` and `children` params).

### Implementation

- `guest-app/src/pages/BookingPage.tsx:923-977` (the `setOccupancy` + `updateGuests` + `updateChildren` functions):
  - `setOccupancy`: change `safeChildren` from `Math.max(0, Math.min(nextChildren, safeGuests - 1))` to `Math.max(0, Math.min(nextChildren, safeGuests))` (remove the `- 1`).
  - `updateChildren`: remove the `newGuests = Math.max(guests, desiredChildren + 1)` line, change `setOccupancy(newGuests, desiredChildren)` to `setOccupancy(guests, desiredChildren)`.
  - `updateGuests`: remove the `newGuests = Math.max(nextGuests, numChildren + 1)` line, change `setOccupancy(newGuests, numChildren)` to `setOccupancy(nextGuests, numChildren)`.
- Update 3 source-text test files to remove the auto-bump assertions: `chd-11-1-picker-auto-bump-guests.test.ts`, `chd-11-2-picker-cap-soft-10.test.ts`, `chd-11-3-symmetric-auto-bump.test.ts`.
- New test file `chd-11-4-picker-free-expression.test.ts` (10 source-text guards).

### Tests

New `chd-11-4-picker-free-expression.test.ts`:
- `setOccupancy` `safeChildren` clamp chain is `Math.max(0, Math.min(nextChildren, safeGuests))` (no `- 1`).
- `updateChildren` does NOT have the `newGuests = Math.max(guests, desiredChildren + 1)` auto-bump.
- `updateChildren` calls `setOccupancy(guests, desiredChildren)` directly (no auto-bump intermediate).
- `updateGuests` does NOT have the `newGuests = Math.max(nextGuests, numChildren + 1)` symmetric auto-bump.
- `updateGuests` calls `setOccupancy(nextGuests, numChildren)` directly (no auto-bump intermediate).
- The `numAdults = Math.max(0, guests - numChildren)` derivation stays (line 221).
- The `numAdults >= 1` submit-gate check stays (line 724).
- The `selectedMaxSelectableChildren` derivation stays (CHD-11.3).
- The `+` button's `disabled = numChildren >= 10` stays (CHD-11.2).
- The `cartFitsGroup` over-capacity check stays.

### MDs to update

- `plan/project/ROADMAP.md` (this entry, ⬜ open).
- `plan/docs/DECISIONS-FEATURES.md #195` (this decision).
- `plan/features/BOOKING-FLOW.md §CHD-11.4 — Free Expression in the Picker (Submit-Gate Enforces "At Least 1 Adult")` (this spec).
- Update the 3 prior CHD-11.X test files to reflect the removed auto-bumps.

### Why the submit gate is the right enforcement surface

The "at least 1 adult" rule is a domain constraint (per CHD-05, the server requires at least 1 guest per room; the client mirrors this as "at least 1 adult per booking" since the picker only has 1 room at a time before the cart). The submit gate is the existing surface for domain constraints — it catches over-capacity (CHD-11), the per-room cap, and the breakfast-occupancy mismatch. The auto-bump in the picker was a UX shortcut that **prevented the user from exploring the invalid state** — but the user benefits from being able to see the state (the picker shows "0 adults") and being told by the submit gate why the state is invalid ("Choose enough rooms to assign every adult and child, with at least one adult in each room."). The auto-bump hid the problem; the submit gate surfaces it.

### Rejected alternatives

- **Remove the "at least 1 adult" rule entirely** — would relax the server contract. The "at least 1 guest per room" is a real domain rule (per CHD-05), and the per-room adult constraint is a derived property of "1 room has at least 1 adult." Relaxing the rule would allow bookings like "0 adults + 5 children in 1 room" (no adult responsible for the children) which is not a real use case at a 14-room hotel. The user explicitly said "let's not drop at least 1 adult" in the operator feedback.
- **Add a separate "Adults" stepper** — would make the picker more direct (the user picks adults and children independently) but adds a third stepper to the UI. The current "Guests" + "Children" pair with `numAdults = guests - children` derived is sufficient for the free-expression use case (the user can set 0 adults by setting `guests = children`). The "Adults" stepper is a future UX work item.
- **Keep the auto-bump but add a "You can have 0 adults" toggle** — splits the picker into two modes (auto-bump on / auto-bump off), which is more UI than a free-expression picker. The submit gate is the simpler surface.
- **Auto-bump with a toast notification** — surfaces the auto-bump but doesn't give the user the freedom to explore. The submit gate is the right surface for the "at least 1 adult" rule.
- **Disable the Continue button when `numAdults = 0` AND the auto-bump is removed** — this is what the new spec does. The Continue button is disabled via the `numAdults >= 1` check at line 724; the error message at line 727 already mentions "at least one adult in each room" which is the right surface.

### Gates

- **CHD-05** (server contract) — the `numAdults: min(0).max(100)` + `numAdults + numChildren >= 1` per-room check + `numAdults + numChildren === guests` consistency check is unchanged. The client's submit gate mirrors the per-room check.
- **CHD-11** (the picker is an exploration surface) — the new spec fully realizes the CHD-11 promise. The chip + submit gate are the only validation surfaces; the picker is free.
- **CHD-11.1** (auto-bump in `updateChildren`) — **reversed by CHD-11.4**. The auto-bump is removed; the submit gate catches the violation.
- **CHD-11.2** (soft cap of 10) — unchanged. The `+` button's `disabled = numChildren >= 10` stays.
- **CHD-11.3** (symmetric auto-bump + per-type cap removed) — **the symmetric auto-bump is reversed by CHD-11.4; the per-type cap removal stays**. The submit gate catches the 0-adults case.
- **CHD-12** (cart summary) — unchanged. The per-type "N adults + M children" inline pill stays the same shape.
- **EXB-11** + **EXB-11.1** + **EXB-11.2** (extra-bed toggle) — unchanged. The extras toggle re-fires when `numAdults` or `numChildren` change.
- **Step 2/3 aside** (extra-bed pricing) — unchanged. The pricing uses `room.numAdults` + `room.numChildren` from the cart distribution.
- **MRB-15-10** + **MRB-15-11** (admin CRUD + photo gallery) — unrelated.
- **CHD-13** (homepage search widget) — unrelated. The homepage widget already has separate Adults + Children steppers (per CHD-13); the /book picker's free expression is a separate concern.
- **EXB-11.3** (no default room-type selection) — independent. The room-type card selection is unchanged.

### Phase 2 (deferred, NOT in CHD-11.4)

- **Add a separate "Adults" stepper to the /book picker** — the current "Guests" + "Children" pair with `numAdults = guests - children` derived is sufficient for the free-expression use case. A future UX work item if the operator wants the more direct shape.
- **A "0 adults + N children" preset button** (e.g., "School trip" / "Family with teens") — a future UX work item; out of scope — the free-expression picker is sufficient.
- **Visual feedback when the submit button is disabled due to 0 adults** (e.g., a red ring on the Guests stepper) — a future UX work item; the error message at line 727 is sufficient for now.
- **Server-side allow `numAdults: 0` per-room** (relax CHD-05) — out of scope; the per-room "at least 1 guest" is a real domain rule.
- **A "Reset to 1 adult + 0 children" quick action** — a future UX work item; out of scope.

## CHD-11.5 — Explicit Adults + Children Picker
> Proposed 2026-08-05, per decision #196 (operator feedback post-CHD-11.4 review). Spec-only — no code yet. Files: `guest-app/src/pages/BookingPage.tsx:214-221, 891-980, 2216-2242` (the Guests stepper, the `setOccupancy` + `updateGuests` helpers, the `selectedMaxSelectableChildren` derivation), `guest-app/src/pages/HomePage.tsx:160-180` (the URL writing in `searchAvailability`). Sibling to CHD-11 through CHD-11.4 — same picker surface, deeper UX fix.

### The problem

Operator-reported 2026-08-05 (post-CHD-11.4 review): "I was thinking of instead of asking the number of guests, lets just ask the number of adults and children." The pre-CHD-11.5 surface asks for "Guests" (the total) + "Children" (a sub-count), with `numAdults` derived as `guests - numChildren`. The user wants the picker to ask for **Adults** and **Children** directly, with the total derived. The current shape is indirect: the user thinks "I have 4 adults and 3 kids" but has to translate that to "7 guests" + "3 children." The new shape is direct: the user picks 4 adults and 3 kids, and the total is derived.

This is also the more honest shape:
- The "at least 1 adult" rule (per CHD-05) is enforced at the Adults stepper's min (1), not via the submit gate.
- The 0-adults case is naturally impossible (the picker min is 1).
- The homepage widget (per CHD-13) already has separate Adults + Children steppers — the /book picker now matches.
- CHD-11.1's auto-bump + CHD-11.3's symmetric auto-bump + CHD-11.4's "submit gate catches 0 adults" are all moot — the picker becomes a "naturally" free expression surface because the user picks adults directly.

### The fix

Multi-part change to `BookingPage.tsx` + `HomePage.tsx`:

**(1) Replace the "Guests" state with "Adults" state in `BookingPage`.** `const [guests, setGuests] = useState(...)` becomes `const [adults, setAdults] = useState(...)`. The `numAdults` derivation `Math.max(0, guests - numChildren)` is gone — `numAdults = adults` (the state itself). The `guests` value (used by the server + the cart summary + Step 2/3) is now derived as `const guests = adults + numChildren`.

**(2) Rename `updateGuests` → `updateAdults` and `setOccupancy(nextGuests, nextChildren)` → `setOccupancy(nextAdults, nextChildren)`.** The function signatures change. The `setOccupancy` body clamps `safeAdults = Math.min(Math.max(nextAdults, 1), maxGuestCapacity)` and `safeChildren = Math.max(0, Math.min(nextChildren, safeAdults))` (children can be up to `adults`, so `numAdults = adults - children` can be 0 in theory — but the Adults stepper's min 1 enforces the "at least 1 adult" rule). The `setOccupancy` writes the URL with `?adults=N&children=N` (replacing `?guests=N&children=N`).

**(3) Update the URL contract: `?guests=N&children=N` → `?adults=N&children=N`.** The new contract is `?adults=N&children=N`. For backward compat (deep links from CHD-13, SEO, etc.), the URL reader also accepts `?guests=N&children=N` and derives `adults = max(1, guests - children)` (the historical derivation). When the picker writes the URL, it writes the new contract (`?adults=N&children=N`). Old URLs continue to work; new URLs are the canonical shape.

**(4) Replace the "Guests" stepper with the "Adults" stepper in the picker UI.** The "Guests" stepper at `BookingPage.tsx:2216-2242` becomes the "Adults" stepper. The Adults stepper has min 1 (the "at least 1 adult" rule is enforced at the picker, not the submit gate) and max `maxGuestCapacity`. The Children stepper stays (min 0, max 10, soft cap from CHD-11.2). The helper text under Children (the "This room includes space for N children" line + the "Pick a room type" nudge) is updated to reference `adults` instead of `guests`.

**(5) Update `selectedMaxSelectableChildren` derivation.** The derivation at `BookingPage.tsx:550-571` uses `Math.max(guests, children + 1)` to model the historical auto-bump scenario. With CHD-11.5, the auto-bump is gone — `effectiveGuests = adults + children` is just the total. The derivation simplifies: for each candidate child count `N`, compute overflow with `numAdults = adults` (the user's chosen adults) + `N` children. The highest `N` with `overflow <= maxExtraBeds` is the cap. The derivation's purpose (chip's "Up to N can fit" hint) is unchanged.

**(6) Update `HomePage` URL writing.** `HomePage.tsx:160-180` writes `?guests=N&children=N` (where `N = adults + children`). The new shape writes `?adults=N&children=N` (without the `guests` param). The Homepage widget's state (`adults` + `children`, separate) is unchanged.

**(7) Update the submit gate's "at least 1 adult" check.** The existing `numAdults >= 1` check at `BookingPage.tsx:724` is now redundant (the picker enforces it), but stays as defense in depth (deep-links, race conditions). The error message at line 727 ("Choose enough rooms to assign every adult and child, with at least one adult in each room.") is unchanged. The per-room `cartDistributionComplete` check at line 463 (every room has `numAdults >= 1`) is unchanged.

### What this changes

- **Picker UI** — the "Guests" stepper becomes the "Adults" stepper. The user picks adults directly; the total is derived as `adults + numChildren`.
- **Picker behavior** — the Adults stepper has min 1 (the "at least 1 adult" rule). The Children stepper has min 0, max 10 (CHD-11.2). The user can freely set both values within these bounds.
- **URL contract** — `?adults=N&children=N` is the new canonical shape. `?guests=N&children=N` is still accepted (backward compat) and converted to `?adults=N&children=N` on the next URL write.
- **Server contract** — unchanged. The server still validates `numAdults + numChildren === guests` (consistency) + `numAdults + numChildren >= 1` per room (CHD-05). The client now sends `numAdults` + `numChildren` per room + `guests = adults + numChildren` for the booking.
- **Cart summary** — unchanged. The per-type "N adults + M children" inline pill (CHD-12) shows the same data; just `N` is now the state, not derived.
- **Submit gate** — the "at least 1 adult" check is now enforced at the picker (Adults min 1) + the submit gate (defense in depth). The 0-adults case is naturally impossible.

### What the user sees after the change

- **Picker** — two steppers: "Adults" (1-N) and "Children (0-11)" (0-10). The Children stepper's helper text shows "X adults" inline (same as before, just `X` is now the state).
- **2 adults + 1 child** — pickers: Adults=2, Children=1. Total: 3. Submit enabled.
- **17 guests (10 children) case from the operator screenshot** — pickers: Adults=7, Children=10. Total: 17. The Adults stepper can go up to `maxGuestCapacity` (whatever the cap is, e.g., 20). The Children stepper is capped at 10. Submit enabled if the room fits; disabled with the "Pick a room type" hint otherwise.
- **Deep link to `?guests=5&children=2`** — the URL reader derives `adults = max(1, 5 - 2) = 3`. The picker shows Adults=3, Children=2. On the next URL write, the URL becomes `?adults=3&children=2`.

### What this changes for the data model

Nothing. `numAdults` state (renamed from `guests - numChildren` derivation) is now the state. `numChildren` state stays. The server-side `numAdults + numChildren === guests` consistency check is preserved. The cart serialization (`?rooms=`) is unchanged. The Step 2/3 aside uses the same per-room `numAdults + numChildren` data.

### Implementation

- `guest-app/src/pages/BookingPage.tsx`:
  - `const [guests, setGuests] = useState(...)` → `const [adults, setAdults] = useState(...)`. The URL reader at line 214 reads `searchParams.get("adults")` first, falls back to `searchParams.get("guests")` (with `adults = max(1, guests - children)`).
  - `const numAdults = Math.max(0, guests - numChildren)` → `const numAdults = adults` (the state). The `guests` value is derived as `const guests = adults + numChildren` for the server + cart summary.
  - `function setOccupancy(nextGuests, nextChildren)` → `function setOccupancy(nextAdults, nextChildren)`. The body updates: `safeAdults = Math.min(Math.max(nextAdults, 1), maxGuestCapacity)` + `safeChildren = Math.max(0, Math.min(nextChildren, safeAdults))` (children can be up to `safeAdults` so `numAdults = safeAdults - safeChildren` can be 0). The URL write at line 942 changes `next.set("guests", ...)` to `next.set("adults", ...)`.
  - `function updateGuests(nextGuests)` → `function updateAdults(nextAdults)`. The body calls `setOccupancy(nextAdults, numChildren)`.
  - The picker UI at lines 2216-2242: "Guests" label becomes "Adults". The `aria-label="Remove one guest"` → `aria-label="Remove one adult"`. The `aria-label="Add one guest"` → `aria-label="Add one adult"`. The display `{guests} guests` → `{adults} {adults === 1 ? "adult" : "adults"}`. The `disabled={guests <= 1}` → `disabled={adults <= 1}`. The `onClick={() => updateGuests(guests - 1)}` → `onClick={() => updateAdults(adults - 1)}`. The `disabled={guests >= maxGuestCapacity}` → `disabled={adults >= maxGuestCapacity}`. The `onClick={() => updateGuests(guests + 1)}` → `onClick={() => updateAdults(adults + 1)}`.
  - The Children picker helper text at line 2315: `numChildren >= Math.min(10, Math.max(0, guests - 1))` → `numChildren >= Math.min(10, ...)` (the bound is different — the historical "guests - 1" was for the "at least 1 adult" invariant; now it's `adults + children - 1` but the helper text logic needs a re-look — likely just `numChildren >= 10` is the right condition since the picker is free).
  - The `selectedMaxSelectableChildren` derivation at lines 550-571: `Math.max(guests, children + 1)` → `Math.max(adults, 0) + children` (no auto-bump; the effective total is `adults + children` for the user's chosen adults + candidate child count).
  - The submit gate at line 724 (`numAdults >= 1`) is unchanged (defense in depth).
  - The Step 2 `Number of guests` field at line 1542 stays (it shows the total `guests = adults + numChildren`). The Step 2 handler at line 1303 (`guests: Number(guestDetails.guestCount) || guests`) stays. The Step 2 changes write back to `guests` (the total), which is now derived — the Step 2 changes update `adults` (if guests increases, bump adults; if guests decreases, clamp adults to max(1, guests - numChildren)).
  - The `cartFitsGroup` over-capacity check (line 471) is unchanged.
  - The `cartDistributionComplete` per-room check (line 463) is unchanged.

- `guest-app/src/pages/HomePage.tsx`:
  - The `searchAvailability` URL writing at lines 160-180: `guests: String(total)` (where `total = adults + children`) is removed. The new URL is `?adults=N&children=N` where `N = adults` (the state) and `N = children` (the state). The `guests` param is no longer written by HomePage.

- `guest-app/src/utils/bookingRoomCart.ts`:
  - The `rebalanceGuestDistribution` function (line 57) is unchanged (it takes `totalAdults` + `totalChildren`; the caller now passes `adults` + `numChildren` instead of `numAdults` + `numChildren`, but the shape is the same).

### Tests

New `chd-11-5-explicit-adults-picker.test.ts`:
- The "Guests" label in the picker is gone.
- The "Adults" label is present in the picker.
- The Adults stepper has `aria-label="Remove one adult"` + `aria-label="Add one adult"`.
- The Adults stepper's `disabled` condition is `adults <= 1` (the min) and `adults >= maxGuestCapacity` (the max).
- The `updateAdults` function is defined.
- The `setOccupancy(nextAdults, nextChildren)` helper is defined.
- The `setOccupancy` body writes `?adults=N&children=N` (not `?guests=N&children=N`).
- The URL reader reads `searchParams.get("adults")` first, falls back to `searchParams.get("guests")`.
- The `numAdults` state is `adults` (not derived from `guests - numChildren`).
- The `guests` derivation is `adults + numChildren` (for the server + cart summary).
- The `selectedMaxSelectableChildren` derivation uses `effectiveGuests = adults + children` (no auto-bump).
- The Children stepper's `+` button's `disabled` condition is `numChildren >= 10` (CHD-11.2, unchanged).
- The submit gate's `numAdults >= 1` check stays (defense in depth).
- The `cartFitsGroup` over-capacity check stays.
- The `cartDistributionComplete` per-room check stays.

### MDs to update

- `plan/project/ROADMAP.md` (this entry, ⬜ open).
- `plan/docs/DECISIONS-FEATURES.md #196` (this decision).
- `plan/features/BOOKING-FLOW.md §CHD-11.5 — Explicit Adults + Children Picker` (this spec).
- Update 5 prior test files (`chd-05-guest-child-cap.test.ts`, `chd-11-1-picker-auto-bump-guests.test.ts`, `chd-11-2-picker-cap-soft-10.test.ts`, `chd-11-3-symmetric-auto-bump.test.ts`, `chd-11-4-picker-free-expression.test.ts`) to reflect the new state shape (the references to `updateGuests`, `setOccupancy(nextGuests, nextChildren)`, the `Math.max(0, guests - 1)` clamp, etc. are gone).

### Why the explicit Adults + Children picker is the right shape

The current "Guests + Children" shape is a derived-shape picker. The user thinks in terms of adults and children (the domain model), but the picker asks for the total + a sub-count. The derivation `numAdults = guests - numChildren` is invisible to the user — they don't see "3 adults" in the picker, they see "3 guests" (and the "3 adults" only appears in the Children stepper's helper text as `(3 adults)`).

The explicit Adults + Children picker is the **direct-shape picker**. The user picks the domain model directly: "I have 4 adults and 3 kids." The total `guests = 7` is derived and shown in the cart summary, but the picker is honest about what's being asked. The "at least 1 adult" rule is enforced at the picker (Adults min 1), not via a hidden derivation. The 0-adults case is naturally impossible. The submit gate becomes defense in depth (the picker can't produce an invalid state via the UI).

This also matches the homepage widget (CHD-13) which already has separate Adults + Children steppers. The two surfaces are now consistent — the user sees the same shape on the homepage and on /book.

### Rejected alternatives

- **Keep the "Guests + Children" shape but rename "Guests" to "Adults"** — semantically wrong. "Guests" means the total; "Adults" means a sub-count. The user would pick "Adults" but see the total derivation break (the picker would say "4 adults" but `numChildren = 3` so `guests = 7`, and the chip's hint text would still say "(4 adults)" not "(7 guests)"). The shape change is the point.
- **Add a separate "Adults" stepper alongside the "Guests" stepper** — three steppers. The user picks Guests (total) + Children + Adults (extra). This is overengineered; the Adults picker REPLACES the Guests picker.
- **Change the URL contract without backward compat** — breaks deep links from CHD-13 + SEO + any external links. The backward-compat layer (read `?guests=N&children=N` as `?adults=N&children=N`) is cheap and handles the transition.
- **Server-side change to take `?adults=N&children=N` (drop the `guests` param)** — the server already takes `numAdults + numChildren` (per the createBookingSchema's optional fields). The `guests` param is derived server-side. No server change needed.
- **Rename the homepage widget's "Guests" trigger to "Adults" + "Children"** — the homepage widget is a popover with two steppers (Adults + Children). The trigger button is a single "Guests" button. Renaming it to "People" or "Travelers" is a separate UX work item; out of scope for CHD-11.5.

### Gates

- **CHD-05** (server contract) — the `numAdults: min(0).max(100)` + `numChildren: min(0).max(100)` + `numAdults + numChildren >= 1` per-room check + `numAdults + numChildren === guests` consistency check is unchanged. The client's new shape sends the same data (just `numAdults` is now the state, not derived).
- **CHD-11** (the picker is an exploration surface) — the new shape fully realizes the CHD-11 promise. The chip + submit gate are the only validation surfaces; the picker is free (within the Adults min 1 + Children max 10 bounds).
- **CHD-11.1** (auto-bump in `updateChildren`) — **reversed by CHD-11.4, moot in CHD-11.5**. The auto-bump is gone; the picker is free.
- **CHD-11.2** (soft cap of 10) — unchanged. The `+` button's `disabled = numChildren >= 10` stays.
- **CHD-11.3** (symmetric auto-bump + per-type cap removed) — **reversed by CHD-11.4, moot in CHD-11.5**. The auto-bump is gone; the per-type cap removal stays (the picker is free).
- **CHD-11.4** (free expression + submit-gate enforcement) — **the "submit gate catches 0 adults" check is now redundant** (the picker enforces Adults min 1). The check stays as defense in depth. The auto-bump removal is unchanged.
- **CHD-12** (cart summary) — unchanged. The per-type "N adults + M children" inline pill shows the same data; just `N` is now the state, not derived.
- **CHD-13** (homepage search widget) — **the URL contract changes from `?guests=N&children=N` to `?adults=N&children=N`**. The homepage widget's state (Adults + Children, separate) is unchanged. The URL writing in `searchAvailability` is updated to write the new contract.
- **EXB-11** + **EXB-11.1** + **EXB-11.2** (extra-bed toggle) — unchanged. The extras toggle re-fires when `numAdults` or `numChildren` change.
- **Step 2/3 aside** (extra-bed pricing) — unchanged. The pricing uses `room.numAdults` + `room.numChildren` from the cart distribution.
- **MRB-15-10** + **MRB-15-11** (admin CRUD + photo gallery) — unrelated.
- **EXB-11.3** (no default room-type selection) — independent.

### Phase 2 (deferred, NOT in CHD-11.5)

- **Rename the homepage widget's "Guests" trigger button** to "People" or "Travelers" (the popover trigger label is currently "Guests" but the popover content is "Adults + Children"). A future UX work item; the trigger label is a minor surface.
- **Add a "Reset to 1 adult + 0 children" quick action** in the picker. A future UX work item; out of scope.
- **Show the total `guests = adults + children` in the picker UI** (e.g., "Total: 7 guests" below the two steppers). A future UX work item; the cart summary already shows the total.
- **Server-side allow `numAdults: 0` per-room** (relax CHD-05) — out of scope; the per-room "at least 1 guest" is a real domain rule. The new picker enforces min 1 at the Adults stepper, so this doesn't affect the client.
- **A "0 adults + N children" preset button** — out of scope; the new picker enforces min 1 at the Adults stepper, so the user can't set 0 adults.

---
