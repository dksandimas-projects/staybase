# HISTORICAL ARCHIVE — Admin Settings Specification Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical rollout notes, verbose field checklists, and implementation logs for the admin settings page (`/settings`) up to August 2, 2026. Do not read routinely for active tasks. For active settings specifications, see [`plan/features/SETTINGS.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/features/SETTINGS.md).

---

## Historical Feature Implementations & Narratives

- **Hotel Contact Details Card (Phase 11.8 PR 3):** Admin-editable address, phone, support email, DPO email, social links stored in `settings/websiteContent.contact`.
- **Dynamic Payment Methods List (2026-07-01..09):** Admin CRUD for payment methods (`settings/hotelConfig.paymentMethods[]`), `requireReferenceNumber` toggle, QR code image uploads to Firebase Storage (`assets/payment-methods/{method}/{filename}`).
- **Surface Visibility Switches (2026-07-03):** `isEnabled` (booking site), `showInStore` (in-room store), `showInCorporate` (corporate booking).
- **Protected Payment Methods (2026-07-01):** `pay-at-hotel` and `add-to-bill` protected from deletion.
- **Booking Sources CRUD (NBS-04, 2026-08-01):** Dedicated `Booking Sources` tab (`/settings?tab=sources`) for managing source origins (`settings/hotelConfig.bookingSources[]`).
- **Discount Scope Matrix (DSC-01..05, 2026-08-01):** Dedicated `Discounts` tab (`/settings?tab=discounts`) controlling discount scope (room / breakfast / extra bed) for Senior/PWD, Voucher, and Member discounts with statutory guardrails.
- **Payment Hold Window (PEX-01, 2026-08-01):** Configurable pending hold window `paymentHoldWindowHours` (default 24h, range 1..72h).
