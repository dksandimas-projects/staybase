# HISTORICAL ARCHIVE — Bookings Management Feature Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical implementation notes, prior-state narratives, and detailed design specs for the admin bookings management workspace up to August 2, 2026. Do not read routinely for active tasks. For active feature rules, see [`plan/features/BOOKINGS-MANAGEMENT.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/features/BOOKINGS-MANAGEMENT.md).

---

## Historical Feature Implementations & Detailed Specs

### 1. Booking Drawer UX (BDUX) Refactor (2026-07-16)
- **Four-Section Layout:** Replaced monolithic drawer with 4 focused sections:
  1. `Overview` — Core stay metadata, guest contact details, sticky action bar, quick status transitions.
  2. `Check-in & Registration` — Physical check-in registry form, purpose of stay, guest ID photo upload, PDF registration form generator.
  3. `Folio & Payments` — Itemized charges, payment ledger, onsite payment recording, refund workflow, balance breakdown.
  4. `Activity & Audit` — Complete immutable audit log of status changes, payment reviews, discount verifications, and staff notes.
- **Mobile Readability (<768px):** Single-column stacked layout, full-bleed bottom sheets for entry forms, safe-area padded primary CTA button.
- **Sticky Proof Header:** Direct deep link to uploaded payment proof image with 1-tap approval/rejection actions without needing to scroll the folio.

### 2. Table Filtering, Search & Quick Views (FSO-01..18, 2026-07-16)
- **Two-Level Filter Controls:** Quick-filter status pills (`All`, `Pending`, `Confirmed`, `In-House`, `Checked Out`, `Cancelled`) combined with an advanced filter drawer.
- **Active Filter Chips:** Visible dismissable chips showing active date range, room type, booking source, and payment method filters.
- **URL Query State Normalization:** Bidirectional synchronization between active filter state and URL query parameters (`/bookings?status=pending&source=walk-in`).
- **AND Composition Rules:** All active filters compose using strict logical AND criteria across Firestore query and client-side fallback predicates.

### 3. Unpaid Checkout & Balance Approvals (UCO-01..14, 2026-07-16)
- **Staff Departure Reason:** Required free-text staff reason input (up to 500 characters) when checking out a booking with a positive balance.
- **Elevated Admin Threshold:** Configurable `unpaidCheckoutApprovalThreshold` (default ₱5,000). Balances exceeding the threshold require elevated admin authorization before checkout is permitted.
- **Departure Snapshots:** Stamping `checkedOutWithBalance`, `unpaidCheckoutReason`, `unpaidCheckoutApprovedBy`, and departure-time balance snapshots.

### 4. Special Photo Formats & Walk-in Enhancements
- **HEIC Photo Conversion (HSD-01..05, 2026-07-24):** Format validation for iPhone photos, client-side Web Worker conversion via `heic-to@1.5.2`, and fallback error rendering.
- **Walk-in Split Name (WSN-01..02, 2026-07-25):** Dedicated `firstName` and `lastName` collection inputs in the walk-in booking creation modal.
- **Cancellation Rules & Audit Stamps (CRL-01..04, 2026-08-01..02):** Server-authoritative audit fields (`cancelledAt`, `cancelledBy`, `cancellationSource`) and dual-gate cancellation restriction matrix.
