# HISTORICAL ARCHIVE — Settings & Configuration Feature Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical rollout notes, dynamic settings evolution, and detailed configuration specs up to August 2, 2026. Do not read routinely for active tasks. For active configuration rules, see [`plan/features/SETTINGS.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/features/SETTINGS.md).

---

## Historical Feature Implementations & Detailed Specs

### 1. Dynamic Payment Methods (WPM, 2026-07-31)
- **Surface Pills:** Dynamic CRUD for booking, store, and corporate payment methods stored in `settings/hotelConfig.paymentMethods[]`.
- **Surface Scope Toggles:** Independent visibility toggles per method: `isEnabled` (Booking Step 3), `showInStore` (Intercom shop COD/Add-to-bill/GCash), and `showInCorporate` (Corporate booking portal).
- **Protected Methods:** `pay-at-hotel` and `add-to-bill` protected from deletion via `PROTECTED_PAYMENT_METHODS` constant.
- **Reference Guard:** `requireReferenceNumber` forces required transaction reference input at Step 3 before submission.

### 2. Dynamic Booking Acquisition Sources (NBS-04, 2026-07-31)
- **Source CRUD:** Dynamic source management in `settings/hotelConfig.bookingSources[]`.
- **Protected Keys:** System acquisition sources (`online`, `walk-in`, `corporate`) protected from deletion and forced front-desk availability.

### 3. Discount Scope & Statutory Guardrails (DSC-01..05, 2026-07-31)
- **3×3 Discount Scope Matrix:** Configurable toggle matrix governing charge component discount eligibility (room, breakfast, extra bed) per discount class (Senior/PWD, Promo Voucher, Spark Rewards Member).
- **Statutory Guardrails:** Senior/PWD discount scope restricted to Admin-only modification, defaulting to broad scope (all components) with OSCA/RA 9994 compliance advisories.
- **Payment Hold Window:** Configurable `paymentHoldWindowHours` (1..72h, default 24h) for auto-expiry of unpaid pending bookings.

### 4. Email Template Catalog & Website Content
- **Transactional Catalog:** Preview catalog covering all 22 transactional email templates with live test trigger capabilities.
- **Website Content Editing:** Dynamic text editing for Homepage Hero, About Us, Corporate Stays, and legal pages stored in `settings/websiteContent`.
