# Settings
> Requires: CLAUDE.md, plan/docs/FRONTEND.md, plan/docs/BACKEND.md, plan/admin-app/CLAUDE.md

## Overview

Admin-only configuration hub at `/settings`. Organized into tabs covering hotel information, payment methods, booking sources, email configuration, staff accounts, discount scope rules, intercom quick requests, and website content editing.

---

## Tabs & Configuration Areas

### 1. Hotel Info
- Address, support email, front-desk phone, DPO email, and social media URLs (Facebook, Instagram, X).
- Check-in and check-out times.
- Source: `settings/hotelConfig` and `settings/websiteContent.contact`.

### 2. Payment Methods
- Dynamic CRUD for booking, store, and corporate payment methods (`settings/hotelConfig.paymentMethods[]`).
- **Surface Pills:** Independent toggles for `Booking` (`isEnabled`), `Store` (`showInStore`), and `Corporate` (`showInCorporate`).
- **Protected Methods:** `pay-at-hotel` and `add-to-bill` are protected from deletion (`PROTECTED_PAYMENT_METHODS`).
- **Reference Guard:** `requireReferenceNumber` forces required reference input at Step 3.
- **QR Uploads:** Stores images in Firebase Storage at `assets/payment-methods/{method}/{filename}`.

### 3. Booking Sources (NBS-04)
- Dynamic CRUD for acquisition sources (`settings/hotelConfig.bookingSources[]`).
- Protected system keys (`online`, `walk-in`, `corporate`) cannot be deleted or set as front-desk-selectable.

### 4. Discounts (DSC-01..05 & PEX-01)
- **Discount Scope Matrix:** 3×3 toggle matrix governing charge components (room, breakfast, extra bed) per discount class (Senior/PWD, Voucher, Member).
- **Statutory Guardrails:** Senior/PWD scope is Admin-only, defaults to broad scope (all components), and displays an OSCA/RA 9994 compliance advisory.
- **Payment Hold Window:** Configurable `paymentHoldWindowHours` (1..72h, default 24h) for auto-expiry of unpaid pending bookings.

### 5. Staff Accounts
- Staff account management (name, email, role, date created).
- Account creation & updates via authenticated API routes (`/api/admin/create-staff`, `/api/admin/update-staff`).
- Password reset and account disable/enable toggles.

### 6. Email & Notifications
- From address & notification emails.
- Preview catalog for all 22 transactional email templates.

### 7. Intercom Quick Requests & Operations
- Configurable quick request items for in-room QR chat (`/intercom/{roomId}`).
- Admin-only — Front Desk records guest selections
- Admin-only — Front Desk processes store orders

### 8. Website Content & Room Types
- Editable text for Homepage, About Us, Corporate Stays, and legal pages.
- **Room Type Photos:** Managed under rates/room types with `imageUrls` (Maximum 10 photos per type).
