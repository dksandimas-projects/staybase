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
- Guest self-service cancellation restricted to `pending` and `payment-uploaded`.
