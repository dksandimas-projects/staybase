# HISTORICAL ARCHIVE — Spark Inn Roadmap Snapshot (2026-08-02)

> **HISTORICAL ARCHIVE** — This document contains historical roadmap detail, shipped feature checklists, and completed batch logs up to August 2, 2026. Do not read routinely for active tasks. For active roadmap status, see [`plan/project/ROADMAP.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/project/ROADMAP.md).

---

## Completed Phases (Phases 0 – 11.7)

### Phase 0 — Foundation
- ✅ Project repository structure initialized (guest-app, admin-app, shared)
- ✅ Firebase Authentication & Firestore configuration initialized
- ✅ Tailwind CSS design token system & typography configured
- ✅ White-label configuration system (`hotel.config.ts`) established
- ✅ Husky git hooks & Conventional Commits configured

### Phase 0.5 — Wireframes
- ✅ 60 wireframe screens designed & reviewed via Stitch workflow
- ✅ UI component conventions & responsive breakpoints established
- ✅ Canonical design tokens documented in `plan/stitch/design.md`

### Phase 1 — Guest App Shell & Pages
- ✅ Homepage (hero, availability bar, featured rooms, amenities, location map)
- ✅ Rooms Catalog (`/rooms`, filterable grid, detail modals)
- ✅ Corporate Stays marketing & booking lookup (`/my-booking`)
- ✅ Static pages (About Us, Contact Us with Turnstile/honeypot protection, 404, Privacy, Terms)

### Phase 2 — Admin App Shell & Auth
- ✅ Firebase Email/Password auth & role-based route guards (`admin`, `front-desk`)
- ✅ Admin Layout (collapsible responsive sidebar, header, version display)
- ✅ Staff account creation API & permissions

### Phase 3 — Rooms Management
- ✅ Room grid, photo uploads to Firebase Storage
- ✅ Room status toggles (`available`, `occupied`, `blocked`)
- ✅ Housekeeping status lifecycle (`clean` → `dirty` → `in-progress`)

### Phase 4 — Guest Booking Flow
- ✅ 4-Step Booking Flow: Step 1 (Room & dates selection) → Step 2 (Guest details & TOS consent) → Step 3 (Payment proof upload / Voucher input / OSCA PWD ID upload) → Step 4 (Confirmation & receipt generation)
- ✅ Double-booking prevention via Firestore transactions
- ✅ Email confirmation notifications via Resend API

### Phase 5 — Admin Bookings Management
- ✅ Filterable/sortable bookings data table with status quick filters
- ✅ 4-section drawer workspace (Overview, Check-in, Folio, Activity)
- ✅ Onsite payment recording, refund workflow, and discount verification/rejection
- ✅ Guest ID photo upload & PDF registration form generator

### Phase 6 — Transactional Email System
- ✅ Resend email templates integration for all 15 transactional triggers
- ✅ Booking submitted, payment confirmed, booking confirmed, check-in reminder, cancellation, and store order updates

### Phase 7 — Corporate Bookings & Promo Vouchers
- ✅ Corporate booking portal (`/corporate/book`) with flat-rate & access code validation
- ✅ Admin promo voucher management (percentage & flat discounts, usage caps, expiration dates)

### Phase 8 — Intercom & QR Systems
- ✅ QR code generation per room (`/intercom/{roomId}`)
- ✅ Live browser chat between guest room and admin Inbox
- ✅ WebRTC audio call support & quick request badges

### Phase 9 — Static Content & Legal Compliance
- ✅ Editable legal pages (Privacy Policy, Terms of Service, House Rules)
- ✅ RA 10173 (Data Privacy Act of 2012) compliance rules & PII protection
- ✅ Full Data Backup export (multi-sheet XLSX covering all 8 collections)

### Phase 11.5 / 11.6 — Audit Fixes & Pre-Launch Polish
- ✅ 50 audit items across 20 batches shipped (security rule hardening, date parsing fixes, payment proof security)

### Phase 11.7 — Admin Mobile UX (Shipped 2026-06-18 v0.90.0)
- ✅ 30 mobile layout items shipped across all 11 admin screens (<768px responsive layout, bottom-sheet drawers, card views, sticky headers)

---

## Shipped Phase 12 Enhancement Blocks

- ✅ **GCR** — Guest check-in registration: required purpose of stay (#121, 2026-07-24)
- ✅ **CWB** — Confirm with balance for partial-payment bookings (#122, 2026-07-24)
- ✅ **LCE** — Editable Terms & Conditions + booking consent version capture (#137, 2026-07-25)
- ✅ **ECE** — House Rules in payment-confirmed, booking-confirmed, and check-in reminder emails (#139, 2026-07-24/26)
- ✅ **GSD** — Guest store search + category browsing (#138, 2026-07-25)
- ✅ **BSP** — Breakfast served persistence (#132, 2026-07-25)
- ✅ **MBP** — Multi-booking picker + privacy tightenings (#126/#128/#131, 2026-07-24/25)
- ✅ **WSN** — Walk-in first/last name split (#127, 2026-07-25)
- ✅ **HSD** — HEIC support via `heic-to` (#125, 2026-07-24)
- ✅ **MBZ** — Modal/drawer backdrop z-index two-tier model (2026-07-24)
- ✅ **WRV** — Weekend Rate Visibility (#151, 2026-08-01)
- ✅ **WPM** — Walk-in Payment Method from Settings (#141, 2026-07-31)
- ✅ **NBS** — New Booking & Customizable Booking Sources (#142, 2026-07-31/08-01)
- ✅ **PEX** — Pending Booking Expiry & Hold Window (#147, 2026-08-01)
- ✅ **DSC** — Discount Scope Configuration & VAT Breakdown (#146/#148/#149/#150, 2026-07-31/08-01)
- ✅ **MRB** — Multi-Room Bookings & Reservation Header (#159/#164, 2026-08-02)
