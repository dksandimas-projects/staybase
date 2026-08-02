# Bookings Management
> Requires: CLAUDE.md, plan/docs/FRONTEND.md, plan/docs/BACKEND.md, plan/docs/API-ROUTES.md, plan/admin-app/CLAUDE.md

## Overview

The primary operational tool for front desk staff at `/bookings`. Displays all bookings in a filterable, sortable table. Staff view and work bookings in a status-aware four-section drawer workspace, advance booking status, manage the folio (payments, refunds, discounts, incidental charges, store charges), generate receipts, log cancellations, and create walk-in or manual bookings.

---

## Workspace Layout & BDUX Contract

The drawer is a status-aware workspace (`BookingDrawerWorkspace.tsx`):

- **Sticky Header:** Booking context (guest, room, stay, status, source), lifecycle indicator, Total/Paid/Balance summary, and actionable alerts.
- **Four Task-Based Sections:**
  - **Overview:** Guest info, room/dates, breakfast inclusion, compact payment status, financial summary.
  - **Check-in:** Readiness checklist, registration, signature, guest ID photo, discount verification, breakfast selections.
  - **Folio:** Money ledgers, discounts, payment proofs, receipts, incidental & store charges.
  - **Activity & More:** Email actions/history, move/upgrade/reschedule, audit detail, cancellation.
- **Sticky Footer:** Context-aware primary action button for the current status plus a **More actions** dropdown menu.
- **Focused Task Modals:** Bounded responsive modals for discount verification, payment recording, refund recording, charge adding/voiding, and cancellation.

---

## Multi-Room Reservations (MRB-07)

The New Booking modal creates a reservation covering one **or more** rooms — walk-in groups, phone bookings, and OTA entry all book blocks.

- **Room stay list:** each stay picks its own room type + specific vacant room and carries its own occupancy steppers (adults / children / extra beds). Rooms may be of different types. The lead guest, dates, source, payment, discount, and voucher stay reservation-level; guests are distributed across rooms, never repeated on each.
- **Picker safety:** a room already claimed by another stay is filtered out, and the submit button stays disabled until every stay names a vacant room and fits its own type's caps — all of these are server rejects.
- **Preview:** the accommodation figure is the sum of the per-stay charges, each priced against its own type; a multi-room reservation states its room count and room numbers.
- **Reset:** a successful create drops the modal back to a single empty stay, so the next booking never inherits the previous group's rooms.

**List rendering.** The main Bookings list shows one row per reservation with its room stays nested beneath it (collapsed by default; the row expands rather than opening a workspace). The reservation row shows the public reservation ref, room count, aggregate total, group balance due, and a **Mixed** status pill when its rooms disagree. Operational quick views — Needs attention, Arrivals today, Departures today, In house — stay **room rows**, because the unit of work there is a room. A reservation is only grouped when it holds more than one row currently in view, so filters never misreport the result set; single-room reservations and legacy bookings without a reservation link render as plain room rows.

**Action scope.** Inside a multi-room reservation, the drawer shows a reservation strip (ref, "Room X of N", one-tap navigation to sibling rooms) and every action states what it touches: `This room` for check-in, confirm, move/upgrade, and cancel; `All rooms` for the reservation-owned folio actions (payment review, collect balance, confirm with balance). Single-room and legacy bookings show no scope labels.

**Deep links.** `?bookingId=` opens that room's drawer. `?reservationId=` / `?reservationRef=` expand the reservation in the list and open its lead room.

---

## Table Filtering & Search (FSO Contract)

- **Two-Level Controls:** Quick-view chips, search input, result counts (`n of total`), and advanced filter panel.
- **URL Parameter Sync:** Search query (`bq`), quick view (`bqv`), status (`bs`), and main tab (`tab`) live in normalized URL parameters.
- **Quick Views:** Needs attention, Arrivals today, Departures today, In house, Upcoming, Balance due, Cancelled, All bookings.
- **Search Coverage:** Guest name, booking ref, room number, email, phone, transaction references (`transactionReference`).

---

## Key Workflows & Rules

### Discount Verification (Senior/PWD)
- Uploaded OSCA/PWD ID photo thumbnail displayed in Check-in section.
- Verification actions: **Verified** (`discountVerified: true`), **Rejected** (`discountRejected: true`, requires staff reason).
- Rejection restores `totalPrice` to pre-discount amount, triggers rejection email, and requires guest to pay full balance.

### Onsite Payments & Refunds
- **Record Payment:** Collects payment amount, method (from `hotelConfig.paymentMethods`), and tender reference (`transactionReference`). Append-only ledger in `payments` subcollection.
- **Refunds:** Admin-only, requires method and reason. Appends immutable negative refund record. Idempotent via client-preallocated doc ID.
- **Receipt:** Reservation-linked stays generate one reservation-referenced PDF with deterministic child-room allocation lines, aggregated VAT, attributed folio charges, and one reservation payment/balance section. Legacy bookings retain the historical single-room PDF.

### Unpaid Checkout (UCO) & Confirm with Balance (CWB)
- **Unpaid Checkout:** Requires staff reason; balances above `unpaidCheckoutApprovalThreshold` (default ₱5,000) require `admin` authorization. Stamped immutably on departure.
- **Confirm with Balance:** Staff can confirm a `payment-uploaded` booking with an intentional partial balance via `/api/bookings/confirm-with-balance`.

### Guest ID Upload & HEIC Conversion
- Accepts JPEG, PNG, WebP, HEIC, HEIF.
- HEIC files auto-converted client-side via `heic-to@1.5.2` Web Worker before compression.
- Bounded 5s decode timeout in PDF generator prevents stuck UI.

### Cancellation Rules (CRL)
- Staff can cancel any pre-arrival status (`pending`, `payment-uploaded`, `payment-confirmed`, `confirmed`).
- Stamps `cancelledAt`, `cancelledBy`, and `cancellationSource` (`"staff"` vs `"guest"`) atomically inside transaction.
- Guest self-service cancellation covers every pre-arrival status (`pending`, `payment-uploaded`, `payment-confirmed`, `confirmed`) after CRL-06's authenticated financial preview. Any applicable refund still requires staff processing.

### Reservation-Scope Cancellation (MRB-13)
> Decision: `plan/docs/DECISIONS-FEATURES.md #166` (spec) + `#170` (implementation record). Builds on MRB-01..06 (decision #159, reservation header) and CRL-02..05 (audit metadata + server-side status matrix + structured policy snapshot).

- **Scope field on the cancel endpoint.** `POST /api/bookings/cancel` accepts an optional `scope` field: `"room"` (default, byte-compatible with the current single-child behavior) or `"reservation"`. The `bookingId` / `bookingRef` in the body anchors the request as today; `scope` chooses the unit of action. The guest body validates `scope` through `guestCancelSchema` (`scope: z.enum(["room", "reservation"]).optional().default("room")`); the staff body reads `req.body.scope` directly (the staff router does not gate the staff body's shape — the same default `"room"` applies).
- **Server transaction (room scope).** Today's behavior is preserved byte-for-byte. The MRB-05 reservation header mirror still runs; the CRL-02 audit metadata still stamps; the existing per-booking `booking-cancelled` email still fires. The room-scope branch lives in the `else` arm of the `if (isReservationScope)` dispatch — the original per-child `runTransaction` is unchanged.
- **Server transaction (reservation scope).** When `scope === "reservation"` and the looked-up booking has a `reservationId`, the server runs a single `runTransaction` that: (a) reads the `reservations/{id}` header + every child via `where("reservationId", "==", lookedUpReservationId)`; (b) splits the children into a cancellable set (skipping `checked-in` / `cancelled` for any source, plus source-mismatched statuses for the guest path — the same matrix the per-child pre-transaction check enforces) and skips the rest; (c) for each cancelled child writes the canonical CRL-02 audit stamps (`status: "cancelled"`, `cancelledAt`, `cancelledBy`, `cancellationSource`, `updatedAt` — all sharing the `now` captured at the top of the try block) + the per-child MRB-05 loyalty clawback (`clawback-${bookingId}` negative `pointsHistory` entry, `rewardsPoints` field unchanged, `pointsAwarded` reset to `0` and `loyaltyAwardStatus` flipped to `"clawback-recorded"` — the invariant `rewardsPoints == sum(pointsHistory.points)` is preserved); (d) **deduplicates** voucher + corporate code `usageCount` decrements by building a `Map<code, count>` from every cancelled child — a code shared across N children decrements by N (matches the MRB-08 create-time `+= assignedRooms.length` increment, decision #167), not by 1; (e) updates the reservation header (`cancelledRoomCount += cancelledCount`, `activeRoomCount -= cancelledCount` floored at 0, `paymentStatus: computeReservationAggregatePaymentStatus(postStatuses)` where cancelled children report `"cancelled"` and survivors report their current status — a full cancel returns `"cancelled"`, a partial cancel returns the aggregate of the survivors).
- **First-created room has no special consequence.** The reservation folio (`reservations/{id}/payments` and `reservations/{id}/refunds`) is the source of truth. Cancelling the first child looks the same as cancelling any other child — the same `cancelledRoomCount++`, the same `activeRoomCount--`, no folio claim, no "primary room" concept. The decision entry records the rejected alternative of a "primary room" model.
- **Admin scope selector.** The `BookingsPage` cancel modal (`admin-app/src/pages/BookingsPage.tsx` cancel footer + the new `bookingCancelScope` state + the `ConfirmForm`'s `additionalFields?: ReactNode` slot) gains a `This room` / `All N rooms` segmented control when `selectedReservationContext` is set (N>1). The default is `"room"` (safer — staff must opt into the whole-reservation path). The control forwards the chosen scope to `updateBookingStatus` via a new 4th `options?: { scope?: "room" | "reservation" }` parameter, which sets `scope` in the API body. The `ConfirmForm`'s `additionalFields` slot is the source-text anchor (`data-testid="booking-cancel-scope-selector"`, `data-testid="booking-cancel-scope-room"`, `data-testid="booking-cancel-scope-reservation"`); other `ConfirmForm` callers (order cancel, discount reject) omit the prop and keep the legacy reason-only shape. For `reservationRoomCount === 1` or legacy null-`reservationId` bookings, the selector is hidden and the modal behaves as today.
- **Email action dispatch.** The handler computes a `postTransactionAction: "booking-cancelled" | "booking-cancelled-reservation"` local from `isReservationScope`. The reservation-scope path fires `sendBookingTrigger("booking-cancelled-reservation", view)` (the MRB-09 multi-room template — splits rooms into "cancelled" + "surviving" via the per-child `cancelledAt` stamp, subject reads "Reservation updated: R-… (N rooms)"); the per-child path keeps the legacy `sendBookingTrigger("booking-cancelled", view)` (which MRB-09 already taught to render the full reservation view when the booking has a `reservationId`). The view is loaded by the existing `loadReservationEmailView(bookingId)` helper. Per CRL-04 the explicit "no refund is issued automatically" callout stays.
- **Voucher / corporate code double-decrement fix.** The pre-MRB-13 code decrements `usageCount` once per cancelled child — a shared code on a 3-room reservation that gets all three rooms cancelled is decremented 3×. The reservation-scope path decrements once per shared code by the count of cancelled children that used it (a code shared by 3 children decrements by 3 — matches the MRB-08 create-time `+= assignedRooms.length` increment); the existing room-scope path is byte-compatible (decrements once per cancelled child, which is correct because the room-scope cancel never cancels more than one child). Source-text guard: `guest-app/tests/api/mrb-13-cancel-scope.test.ts` (29 tests).
