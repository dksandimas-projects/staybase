# Bookings Management
> App: admin-app
> Phase: Phase 5 — Admin Bookings Management
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, docs/API-ROUTES.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Bookings Management

## Overview

The primary operational tool for front desk staff at `/bookings`. Displays all bookings in a filterable, sortable table. Staff can view booking details in a side drawer, advance booking status, generate receipts, log cancellations, and create walk-in or manual bookings directly from the dashboard.

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

- [ ] Booking table — columns: Booking Ref, Guest Name, Room, Check-in, Check-out, Source, Payment Method, Status badge, Actions
- [ ] Table filters — by status, by date range, by source, by room type; search by guest name or booking ref
- [ ] Table sort — by check-in date (default desc), by created date
- [x] Booking detail drawer — slides in from right on row click, full booking details
- [x] Drawer — guest info, room, dates, nights, rate, total, source, notes, status overview
- [ ] Discount ID photo — shown in drawer when `booking.discountType != ""`:
  - [ ] Thumbnail with "View Full Size" link (opens Firebase Storage URL in new tab)
  - [ ] Label: "OSCA Card" or "PWD ID" depending on `discountType`
  - [ ] Three-state verification control — **Pending** (default) / **Verified** / **Rejected**:
    - [ ] **Pending** — yellow badge "Pending ID Verification"; shown until staff acts
    - [ ] **Verified** — green badge "ID Verified"; discount stands; stores `discountVerified: true`, `discountVerifiedBy: staffUID`
    - [ ] **Rejected** — red badge "Discount Rejected"; discount removed from booking total; triggers rejection email to guest (see `plan/features/EMAIL-PDF-STORAGE.md §Discount Rejected`); stores `discountVerified: false`, `discountRejected: true`, `discountRejectedBy: staffUID`, `discountRejectionReason`
  - [ ] Reject action opens a confirmation modal with an optional reason input (e.g. "ID expired", "ID does not match guest name", "Invalid OSCA card") — reason stored and included in rejection email
  - [ ] On rejection: `totalPrice` restored to pre-discount amount; guest is informed to pay full amount at check-in
  - [ ] Once rejected, discount cannot be re-applied from the drawer — guest must contact the hotel if they believe it's a mistake
- [x] **Additional Payments panel** — shown in drawer for all bookings with status `confirmed`, `checked-in`, or `checked-out`
  - [x] Section heading: "Payments Collected Onsite"
  - [x] List of all recorded onsite payments — each row shows: amount (₱), method, note, recorded by, timestamp
  - [x] **Total Collected** summary line — reflected in checkout folio review
  - [x] **Outstanding Balance** line — `booking.totalPrice − totalCollected`; shown in red if > 0, green if 0
  - [x] "Record Payment" button — opens inline form:
    - [x] Amount input (₱) — required
    - [x] Payment method selector — Cash / card / GCash
    - [x] Note field — optional (e.g. "Balance after discount rejection", "Points reversal top-up")
    - [ ] Save — `addDoc` to `bookings/{bookingId}/payments` subcollection
  - [ ] Payments list is read-only once saved — no editing, no deletion (audit trail)
  - [ ] When outstanding balance reaches ₱0 — show green "Fully Settled" badge
  - [ ] Walk-in bookings (Pay at Hotel, `status: "confirmed"`) — this panel is how staff confirms cash was received
- [x] Status action buttons in drawer — context-aware, show only valid next transitions
- [x] Status transitions available per current status (see logic below)
- [ ] Notes field in drawer — staff can add/edit internal notes, saved to booking
- [ ] Receipt button — generates and opens printable/downloadable PDF receipt (jsPDF)
- [ ] Email receipt button — triggers email with receipt to guest
- [x] Check-in registration workstation — shown in drawer for `confirmed` / `checked-in`
  - [x] Guest registry fields: nationality, address, DOB, gender, ID type + number, emergency contact, vehicle plate
  - [x] Physical registration signature status toggle
  - [x] Registration PDF preview action placeholder
  - [ ] Check-in action is disabled until required guest registration fields are saved and a guest ID photo is uploaded
- [x] Breakfast selections panel — shown in drawer only if `booking.hasBreakfast: true`
  - [x] Grid of dates (one column per night) × guests (one row per guest)
  - [x] Each cell: dropdown of active silog items from `settings/breakfastConfig.silogItems`
  - [x] Front desk fills this in at check-in after guest completes physical registration form
  - [x] Save button — updates `bookings/{bookingId}.breakfastSelections` map per guest per date
  - [x] Already-entered selections shown and editable in the wireframe drawer
- [x] Guest ID upload — shown in drawer when status is `confirmed` or `checked-in`
  - [x] Upload button: "Attach Guest ID Photo" — accepts jpg/png/webp
  - [x] Image compression uses shared `compressImageFile()`
  - [x] Thumbnail preview of uploaded ID shown in drawer after upload
  - [x] Staff can replace the photo if uploaded incorrectly (re-upload overwrites)
  - [ ] `guestIdPhotoUrl` stored on booking document — viewable only by staff/admin
  - [ ] Stored at `bookings/{bookingId}/guest-id/{filename}` in Firebase Storage (staff-only read rule)
- [ ] **Spark Rewards — Points Redemption panel** — shown in drawer when booking status is `confirmed`, `checked-in`, or `checked-out` AND `booking.memberId` is set
  - [ ] Member info row: member name, `memberNumber` (e.g. `SR-00042` — prefix from `config.memberNumberPrefix`), current points balance
  - [ ] If `booking.pointsRedeemed > 0` — show read-only summary: "X pts redeemed = ₱Y deducted" with an undo button (admin only)
  - [ ] If no points redeemed yet — show "Redeem Points" form:
    - [ ] Points input — number field labeled "Points to redeem"
    - [ ] Live preview: "= ₱{computed value} off" — computed from `settings/rewardsConfig.pointsRedemptionRate`
    - [ ] Remaining balance preview: "New total: ₱{totalPrice - redemptionValue}"
    - [ ] "Apply" button — confirms redemption (requires admin role)
  - [ ] Only one redemption per booking — once applied, form replaced by read-only summary
  - [ ] Undo: removes redemption, restores original `totalPrice`, returns points to member balance — admin only, only available on `confirmed` status (not after check-in)
- [ ] Unaccompanied minor warning — if booking has `numGuests > 0` and guest age data or staff observation indicates a minor without an adult guardian, show a yellow warning banner in the drawer: "Please verify that minor guests are accompanied by a parent or guardian (RA 11862)." — informational only, does not block actions
- [ ] Cancellation — opens confirmation modal with optional reason input
- [x] Checkout folio review — room/add-ons, billed store charges, payments collected, balance due/overpaid/settled state
- [x] Checkout confirmation guard — warns if staff tries to check out with balance still due
- [x] Walk-in / manual booking button — "New Booking" CTA opens a creation modal/drawer
- [x] Walk-in booking form — standard walk-in fields and immediate check-in option
- [x] Calendar view — `/calendar` renders a live room × date grid for active rooms, occupying bookings, and blocked rooms. Staff can click a start/end range on one room, then block or book the selected dates. Booked ranges open a booking drawer with full-booking link, cancel action, and server-backed move/reschedule transaction. Blocked ranges open a block drawer with edit/unblock actions. Active `roomBlocks` render with strikethrough styling.
- [ ] Pagination or infinite scroll on booking table
- [ ] Loading skeleton on initial data fetch

## Data & Logic Checklist

- [ ] `onSnapshot` on `bookings` collection — real-time updates
- [ ] Status transition rules:
  - `pending` → `payment-uploaded` (auto on screenshot), `confirmed` (pay-at-hotel), `cancelled`
  - `payment-uploaded` → `payment-confirmed`, `cancelled`
  - `payment-confirmed` → `confirmed`
  - `confirmed` → `checked-in`, `cancelled`
  - `checked-in` → `checked-out`
  - `checked-out` → no further transitions
  - `cancelled` → no further transitions
- [ ] Check-in gate: `/api/bookings/checkin` must reject check-in unless the booking is in `confirmed` or `payment-confirmed` status, has `guestIdPhotoUrl`, and has saved required `guestRegistration` fields. The admin drawer should mirror the same rule client-side with a disabled CTA and plain-language missing-items checklist.
- [ ] Status update: direct staff `updateDoc` on `bookings/{bookingId}` for ordinary operational transitions, updating `status` + `updatedAt` + `handledBy`
- [ ] `confirmed` and `payment-confirmed` status changes trigger corresponding emails via email API route after the staff update succeeds
- [ ] Cancellation: POST to `/api/bookings/cancel` so owner/staff authorization, status validation, `cancellationReason`, and cancellation email stay server-side
- [ ] Walk-in booking creation: POST to authenticated `/api/bookings/create-walkin`; API runs the availability-locking transaction, writes `source: "walk-in"`, default `status: "confirmed"` unless immediate check-in is selected, and stores `handledBy` from the verified staff token
- [ ] Walk-in booking ref generated inside the same transaction as booking creation; do not call `/api/reference/generate` separately for walk-ins
- [ ] Points redemption: POST to `/api/members/redeem-points` — validates member balance, computes `₱ value = pointsRedeemed × (redemptionRate / 100)`, updates booking `totalPrice`, `pointsRedeemed`, `pointsRedeemedValue`; deducts from `members/{uid}.rewardsPoints`; logs to `members/{uid}/pointsHistory` with `type: "redeem"`, `bookingId`, `by: staffUID`
- [ ] Redemption rate fetched from `settings/rewardsConfig.pointsRedemptionRate` — never hardcoded
- [ ] Undo redemption: POST to `/api/members/undo-redemption` — restores `totalPrice`, zeroes `pointsRedeemed`/`pointsRedeemedValue`, returns points to member balance, logs `type: "manual"` reversal to pointsHistory; only allowed on `confirmed` status, admin role only
- [ ] Receipt PDF generated client-side with jsPDF — see `plan/features/EMAIL-PDF-STORAGE.md`
- [ ] Payment proof image viewable in drawer from Firebase Storage URL
- [ ] Additional payments: POST to `/api/bookings/add-payment` — API appends `{ amount, method, note, recordedBy: staffUID, recordedAt: timestamp }` to `bookings/{bookingId}/payments`
- [ ] `onSnapshot` on `bookings/{bookingId}/payments` in drawer — real-time list updates
- [ ] Outstanding balance computed client-side: `booking.totalPrice − sum(payments[].amount)`
- [ ] Discount verification: `updateDoc` on `bookings/{bookingId}` — set `discountVerified: true` + `discountVerifiedBy: staffUID`
- [ ] Discount rejection: POST to `/api/bookings/reject-discount` — sets `discountRejected: true`, `discountVerified: false`, `discountRejectedBy`, `discountRejectionReason`; restores `totalPrice` to pre-discount amount; triggers `/api/email/discount-rejected`; staff role required

## Edge Cases & States

- [ ] Empty state (no bookings matching filters) — "No bookings found" with reset filters option
- [ ] Booking updated by another session while drawer is open — refresh data, notify staff
- [ ] Walk-in booking: date conflict with existing booking — show conflict error returned by `/api/bookings/create-walkin`
- [ ] Receipt generation fails — show error, allow retry
- [ ] Notes field: auto-save or explicit save button (choose one, be consistent)
- [ ] Additional payment recorded as ₱0 — prevent with validation
- [ ] Outstanding balance goes negative (overpayment) — show "Overpaid by ₱X" in amber, no error (staff handles manually)

## Manual QA

- [ ] All bookings appear in table with correct data
- [ ] Filter by each status works correctly
- [ ] Search by guest name returns correct results
- [ ] Booking detail drawer opens with complete information
- [ ] Payment proof image loads correctly in drawer
- [ ] Status transition buttons show only valid next states
- [ ] Status change reflects in table immediately (real-time)
- [ ] Status change emails sent for confirmed/payment-confirmed transitions
- [ ] Receipt PDF generates with correct booking data
- [ ] Walk-in booking created with source "walk-in" — appears in table
- [ ] Cancelled booking shows cancellation reason in drawer
- [ ] Cancellation email sent to guest
- [ ] Record onsite cash payment for a walk-in booking — appears in payments list, outstanding balance updates
- [ ] Record GCash payment after discount rejection — outstanding balance drops to ₱0, "Fully Settled" badge shown
- [ ] Overpayment scenario — "Overpaid by ₱X" shown in amber

## Implementation Plan — Check-In Gate

### Goal

Prevent staff from checking in a guest until payment/booking status is eligible and the front desk has captured the minimum registration packet: guest ID photo plus required registration fields.

### Required State

- Booking status must be `confirmed` or `payment-confirmed`.
- `guestIdPhotoUrl` must be present.
- `guestRegistration` must include at minimum:
  - Nationality
  - Residential address
  - Date of birth
  - Gender
  - ID type
  - ID number
  - Emergency contact
  - Signature status marked `signed`
- Vehicle plate remains optional.

### Implementation Steps

1. Add a shared helper for check-in readiness so the drawer UI and server validation use the same required-field list.
2. Update the booking drawer to show a compact "Ready for check-in" checklist beside the check-in action.
3. Disable **Verify Guest ID & Check In** until all required items pass, and show the exact missing items in plain language.
4. Update `/api/bookings/checkin` to enforce the same rule server-side before changing the booking or room status.
5. Fix the current `payment-confirmed → confirmed` mismatch by allowing `/api/bookings/confirm` to accept `payment-confirmed`, or simplify the operational flow so check-in from `payment-confirmed` is the documented path.
6. Add tests for blocked check-in without guest ID, blocked check-in with incomplete registration, successful check-in from `confirmed`, successful check-in from `payment-confirmed`, and rejected check-in from terminal statuses.

### Acceptance Criteria

- Staff cannot check in a booking without a guest ID photo.
- Staff cannot check in a booking without the required guest registration fields.
- The UI explains what is missing instead of letting the server fail silently.
- The server rejects direct/API check-in attempts that bypass the UI.
- Existing room occupancy checks still run inside the transaction before the room is marked occupied.

## References

- Booking schema and status flow: `plan/docs/BACKEND.md §bookings`
- Receipt generation: `plan/features/EMAIL-PDF-STORAGE.md`
- Availability locking for walk-in creation: `plan/features/AVAILABILITY-LOCKING.md`
- Email triggers: `plan/features/EMAIL-PDF-STORAGE.md`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
