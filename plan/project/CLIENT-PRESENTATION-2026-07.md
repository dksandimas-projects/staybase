# spark inn — Project Milestones & Delivery Report

> Prepared for: Spark Inn Hotel Corp
> Prepared by: DK
> Date: July 23, 2026 · System version: v0.180.7
> Purpose: client presentation — build milestones, delivered features, recent updates, and value-added features delivered beyond the contracted scope (Schedule A of the Software Development Agreement, signed June 23, 2026).

---

## 1. Project Milestones

| Date | Milestone |
|---|---|
| May 30, 2026 | Project kickoff — repository, planning system, and full feature specifications established |
| Early June 2026 | Complete wireframe pass — all guest and admin screens designed and approved as working React wireframes |
| June 2026 | Core build — guest website, booking flow, admin dashboard, rooms, rates, corporate pipeline, vouchers, automated email |
| June 16, 2026 | Full internal audit completed — 50 findings across 20 fix batches, all resolved before staging |
| June 18, 2026 | Admin dashboard made fully mobile-responsive (v0.90.0) — staff can run the front desk from a phone |
| Late June 2026 | Spark Rewards membership program and Spark Essentials in-room store completed |
| July 11–12, 2026 | Finance & Accounting suite delivered (collections, refunds, receivables, VAT, daily close, KPIs) |
| July 16, 2026 | Front-desk workflow overhaul — redesigned booking drawer, folio & payment ledger, checkout controls, list filtering |
| July 17, 2026 | End-to-end user-journey security audit — all 17 findings fixed and **deployed to production** the same day |
| **Next** | Staging review with client → production cutover to dedicated environment → launch at v1.0.0 |

**Where we are today:** every build phase is substantially complete. The remaining work is operational — client review and training, final data seeding (real room photos and content), domain/production cutover, and manual QA sign-off. Details in §5.

---

## 2. Delivered Features — Guest Website (`www.sparkinnbohol.com`)

- **Homepage** with live availability checker, featured rooms, amenities, and map
- **Rooms catalog** with filters, real-time availability badges, and detail views
- **4-step booking flow** — room selection, guest details with privacy consent, payment proof upload (GCash / bank / pay-at-hotel), confirmation with PDF receipt and Add-to-Calendar
- **Double-booking prevention** — transactional availability locking; overbooking is structurally impossible
- **Senior Citizen / PWD discounts** — RA 9994 / RA 10754 compliant 20% discount flow with ID verification
- **Corporate booking** — dedicated `/corporate/book` flow with access codes and flat corporate rates, plus a corporate inquiry pipeline
- **Promo vouchers** — server-validated discount codes
- **My Booking lookup** — reference + email self-service booking access
- **In-room QR intercom** — scan a QR in the room to chat with the front desk, send quick requests, or order from the store; no app, no login
- **Spark Essentials store** — in-room ordering with cart, COD / add-to-bill / GCash payment, and live order status
- **Spark Rewards** — member sign-up, profile portal, stay history, and points
- **Static pages** — About, Corporate Stays, Contact (wired to staff inbox), Privacy, Terms, 404
- **SEO & link previews** — Google/Bing indexability, sitemap, structured data, and branded preview cards for Facebook, Messenger, WhatsApp, and Viber

## 3. Delivered Features — Admin Dashboard (`admin.sparkinnbohol.com`)

- **Dashboard overview** — today's arrivals/departures, room status grid, housekeeping toggle, pending payments
- **Bookings management** — full booking table, detail drawer with folio and payment ledger, walk-in creation, room transfer/reschedule, check-in gate with digital registration and signature, receipt printing
- **Calendar view** — visual room × date grid with room blocking
- **Room management** — photos, status, descriptions, block reasons
- **Rate management** — base/weekend/corporate/breakfast rates, seasonal and holiday overrides, and a month-grid Rate Calendar
- **Reports & finance** — occupancy, revenue, ADR/RevPAR, bookings by source, collections, refunds, receivables, VAT breakdown, daily close with cash-drawer count, PDF/XLSX exports
- **Intercom inbox** — live guest chat, quick-request badges, store order processing, notification sounds
- **Corporate inquiries** — pipeline with notes log and access-code generation
- **Voucher management** — create, limit, and track promo codes
- **Members management** — Spark Rewards member administration and points
- **Store management** — catalog, stock, and order reports
- **QR management** — per-room QR generation, regeneration, and printing
- **Settings** — hotel info, payment methods, staff accounts, website content editing, email previews (10 tabs)
- **Notification center** — persistent alert bell with real-time audio alerts
- **Fully mobile-responsive** — the entire dashboard works on a phone (375px and up)
- **Role-based access** — Admin vs. Front Desk permissions throughout

## 4. Recent Updates (July 2026)

- **Finance & Accounting suite** — cash-basis collections, payment-method reconciliation, refund ledger, receivables & aging, discounts report, VAT breakdown for the accountant, daily close with drawer variance, revenue proration, hotel KPIs, and prior-period comparisons
- **Front-desk UX overhaul** — redesigned booking drawer with a dedicated Folio tab (running balance, payments, refunds, incidental charges, store charges in one ledger), controlled unpaid-checkout handling, and payment reference tracking
- **Bookings & store order filtering** — quick filter chips and search designed for one-handed phone use
- **Incidental charges** — late checkout, damage, laundry, and other folio charges wired through receipts, reports, and exports
- **Test-data environment controls** — tagged test runs and controlled staging resets so demos never contaminate real records
- **Security hardening** — full end-to-end user-journey audit (17 findings fixed and live in production), locked-down file storage for payment proofs and government IDs, server-side validation on all public endpoints, and an ongoing Spark Rewards security review

---

## 5. Remaining Before Launch

All items below are operational (no major construction left):

1. **Staging review session** — walkthrough of bookings, dashboard, and intercom with your team; feedback collected and addressed
2. **Content & data finalization** — real room photos, hotel info, and website copy entered via the admin Settings (client)
3. **Production cutover** — dedicated clean production environment, domain configuration (`www.sparkinnbohol.com` / `admin.sparkinnbohol.com`)
4. **Manual QA sign-off** — cross-browser, mobile-device, performance, and accessibility passes
5. **Staff training session** — booking management, settings, and intercom
6. **Launch at v1.0.0**

---

## 6. Value Delivered Beyond the Contract

The Software Development Agreement's Schedule A (Parts 1–3) defines the contracted scope. Everything in this section was **built and delivered at no additional charge**, inside the fixed project fee. Under Schedule A Part 4, each of these would ordinarily be a separately quoted change request.

### 6.1 Finance & Accounting Suite
Schedule A required only summary charts, stat cards, a sales tab, and PDF/XLSX export. Delivered in addition:

| Feature | What it gives you |
|---|---|
| Collections (cash-basis) report | Billed vs. collected vs. outstanding, from actual payment entries |
| Payment-method breakdown | Real payment reconciliation, including Add-to-Bill collected vs. uncollected |
| Refund ledger | Append-only, admin-approved refunds with reason and approver |
| Receivables & aging | Aged unpaid balances + corporate charge-back invoice register |
| Incidental charge ledger | Late checkout, damage, laundry, etc. through folio, receipts, and reports |
| Per-booking payment recording | Every payment stamped with method and staff member |
| Discounts & adjustments report | Gross→net revenue bridge + outstanding points liability |
| VAT breakdown | 12% VAT / VATable / VAT-exempt figures ready for the accountant |
| Daily Close + cash drawer count | End-of-day handover reconciliation with variance tracking |
| Revenue proration | Accurate revenue recognition across stay dates |
| Hotel KPIs | ADR, RevPAR, revenue by room type |
| Prior-period comparison | Trend badges on revenue and booking cards |

### 6.2 Front-Desk Operations
- Early check-in request & approval workflow (guest request → staff approve/decline → automated emails)
- Check-in gate — enforced guest ID photo, registration fields, and digital signature before check-in
- Room transfer / upgrade & reschedule with automatic re-pricing
- Post-booking discount & voucher application by staff
- Senior/PWD online-booking toggle (admin control over the self-service discount path)
- OSCA/PWD ID photo upload (contract required only a checkbox)
- Itemized per-night rate breakdowns across the site, emails, and receipts

### 6.3 Rates & Calendar
- Seasonal / holiday rate overrides per room type
- Rate Calendar — month grid with multi-select seasonal editing and holiday labels
- Visual bookings calendar with date-ranged room blocking

### 6.4 Intercom Voice Calls
The contract specified text chat and quick requests only. Delivered in addition:
- Two-way guest-to-front-desk **voice calling** with accept/decline/end
- Ringtones and call popups on every admin page
- Automatic call log cleanup

### 6.5 Email & Notifications
The contract required 5 automated emails. Delivered in addition:
- ~8 extra email templates — check-in reminders, reschedule notices, early check-in updates, voucher issuance, store order status, staff alerts for new bookings and payments
- Email preview interface in Settings
- Real-time audio alerts for bookings, payments, messages, arrivals, and departures

### 6.6 Marketing, Content & Compliance Extras
- Full SEO & Open Graph package (search indexability + social link-preview cards)
- Terms of Service page (contract listed only the Privacy Policy)
- Guest account self-deletion — RA 10173 (Data Privacy Act) erasure flow
- Dashboard intercom widget with unread stats
- Breakfast (silog) menu management
- Store stock tracking with automatic decrement on confirmed orders
- Image preview modals for receipts and IDs
- Full backup XLSX export (all data, admin-only)
- Offline fallback page

**In total: ~40 features beyond the contracted scope**, delivered within the fixed fee and timeline.

---

## 7. What Was Replaced

| Before (Excel workflow) | Now |
|---|---|
| Booking monitor spreadsheet, availability checked by eye | Real-time availability with transactional locking — zero overbooking by design |
| Every confirmation typed manually on Facebook/phone | 13+ automated email triggers, zero manual sends |
| Payment receipts noted in free-text cells | Append-only payment ledger with staff stamps, proofs, and daily close |
| Paper registration form at check-in | Digital check-in gate with ID capture and signature → PDF |
| No guest history or loyalty | Spark Rewards membership with stay history and points |
| Owner opens Excel for numbers | Live occupancy, revenue, and KPI reports with exports |

---

*This document summarizes delivery status as of July 23, 2026. Feature-level detail is available on request. Phase 2 items (online payment gateway via PayMongo, and any newly requested features) are scoped and quoted separately per Schedule A Part 4.*
