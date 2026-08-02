# HISTORICAL ARCHIVE — Bookings Management Feature Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical implementation notes, prior-state narratives, and detailed design specs for the admin bookings management workspace up to August 2, 2026. Do not read routinely for active tasks. For active feature rules, see [`plan/features/BOOKINGS-MANAGEMENT.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/features/BOOKINGS-MANAGEMENT.md).

---

## Historical Feature Implementations & Narratives

- **BDUX Drawer Refactor (2026-07-16):** Four-section workspace (Overview, Check-in, Folio, Activity & More), sticky header & footer, focused task modals, folio read-first rules.
- **FSO Table Filtering & Search (2026-07-16):** Two-level controls, active filter chips, URL query state normalization, AND composition rules, quick views.
- **Unpaid Checkout (UCO, 2026-07-16):** Required staff reason, elevated admin approval threshold (default ₱5,000), immutable departure snapshots.
- **Payment Reference Unification (2026-07-24):** Retired top-level `paymentReferenceNumber` in favor of per-payment `transactionReference` on the onsite payments ledger.
- **Guest ID Upload & HEIC Conversion (HSD-01..05, 2026-07-24):** Format guards, lazy-loaded `heic-to@1.5.2` Web Worker conversion, 5s PDF decode timeout.
- **Walk-in Split Name (WSN-01..02, 2026-07-25):** Separate first and last name collection fields in the walk-in modal.
- **Cancellation Rules (CRL-01..04, 2026-08-01..02):** Immutable audit timestamps (`cancelledAt`, `cancelledBy`, `cancellationSource`), staff vs. guest self-service cancellation restrictions.
