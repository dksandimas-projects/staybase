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
