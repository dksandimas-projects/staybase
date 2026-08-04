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
