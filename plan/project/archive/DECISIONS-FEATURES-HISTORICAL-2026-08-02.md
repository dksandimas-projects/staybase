# HISTORICAL ARCHIVE — Feature & Product Decisions (Decisions #1 – #107)

> **HISTORICAL ARCHIVE** — This document contains historical product, feature scope, business rules, compliance, and UX decisions (#1 through #107) established up to June 2026. Do not read routinely for active tasks. For active decisions, see [`plan/docs/DECISIONS-FEATURES.md`](file:///Users/danielkennethsandimas/GitHub/staybase/plan/docs/DECISIONS-FEATURES.md).

---

| # | Decision |
|---|---|
| 1 | Room photos: architectural renders for now — managed via Room Management and Settings |
| 2 | Payment flow Phase 1: manual screenshot upload — no payment gateway |
| 3 | Payment gateway Phase 2: PayMongo (deferred) |
| 4 | Admin accounts: DK creates initial; owner gets admin; front desk accounts by admin only |
| 5 | About page: Mission, vision, hotel story only — no team/owner section |
| 6 | Add to Calendar included on booking confirmation page |
| 7 | BIR receipts: NOT generated — system generates booking confirmation receipts only |
| 8 | Corporate rates: NOT shown on marketing page — inquiry-based or via `/corporate/book` |
| 9 | Corporate booking: `/corporate/book` reuses 4-step flow with flat rate (public) or access code (negotiated) |
| 10 | Guest intercom: QR-based, browser chat, no app, no login — quick requests configurable in Settings |
| 11 | Booking statuses: Pending → Payment Uploaded → Payment Confirmed → Confirmed → Checked In → Checked Out → Cancelled |
| 12 | Discounts: Senior Citizen 20% + PWD 20% — OSCA-mandated; guest uploads OSCA Card / PWD ID photo at booking Step 3 |
| 13 | Promo vouchers: guest enters code at Step 3 of booking flow |
| 13b | Discount stacking order: Senior/PWD (20%) → Voucher → Spark Rewards member discount |
| 14 | Walk-in bookings: front desk creates manually from dashboard |
| 15 | Housekeeping status: tracked per room as clean / dirty / in-progress |
| 16 | Intercom notification sound: Web Audio API only — no extra library |
| 17 | Intercom notification sound plays on every incoming guest message |
| 18 | Intercom security model: physical QR gate + room ID from URL + name prompt |
| 19 | Reports: occupancy + revenue + bookings by source — Recharts — exportable PDF/CSV/XLSX |
| 20 | Website content editable from Settings (homepage, about, corporate sections) |
| 21 | `isCorporate` and `corporateCode` set server-side — never trusted from client |
| 22 | Corporate codes and vouchers validated server-side via API route |
| 23 | Booking reference format: `{config.bookingRefPrefix}-YYYYMMDD-NNN` |
| 24 | Domain: `sparkinnbohol.com` — DK purchases as part of project |
| 25 | Data Privacy Act of 2012 (RA 10173) compliance required |
| 26 | Data retention: indefinitely — guests may request erasure via email to hotel |
| 27 | Privacy Policy and Terms of Service: dedicated `/privacy` and `/terms` pages |
| 28 | Consent checkbox required at booking Step 2 |
| 29 | Hotel owner/admin serves as Data Protection Officer (DPO) |
| 30 | Data breach notification: NPC within 72 hours if breach affects guest PII |
| 31 | Legal content (privacy policy body, cancellation policy, house rules) editable from Settings |
| 32 | Spark Essentials store accessible only via room QR scan |
| 33 | Store orders linked to room ID and active booking |
| 34 | Store payment methods: CoD, Add to Bill, GCash |
| 35 | "Add to Bill" = note for front desk to collect at checkout |
| 36 | Store stock: null = unlimited, 0 = out of stock, n = tracked quantity |
| 37 | Store stock decremented on order confirmed — restored if cancelled before confirmed |
| 38 | Store order status flow: Placed → Confirmed → Out for Delivery → Delivered; Cancelled is terminal |
| 39 | Store item deleted with existing orders: soft-delete only (isActive: false) |
| 40 | Store order ref format: SO-YYYYMMDD-NNN |
| 41 | Spark Rewards Phase 1: auth, member profile, booking history, points earning, member discount, SR-XXXXX card |
| 42 | Spark Rewards Phase 2: points redemption, tier system, tier-based perks |
| 43 | Guest auth: Google Sign-In + email/password — separate from admin auth |
| 44 | Guest registration available post-booking (Step 4 prompt) and standalone at `/rewards` |
| 45 | Past anonymous bookings linked to member account by email match on registration |
| 46 | Points redemption is Phase 1 but admin-only — staff applies manually from booking drawer |
| 47 | Early check-in request: available to members; sends tagged intercom message or email to front desk |
| 48 | Manual points adjustment by staff requires a reason |
| 49 | Member account deletion triggers data erasure per RA 10173 right to erasure |
| 50 | `guests/` collection = staff only; `members/` collection = guest loyalty members |
| 51 | Breakfast add-on: per person per night — rate × numGuests × numNights |
| 52 | Breakfast shown at Step 1 as "Room Only" vs "Room + Breakfast" combined rate |
| 53 | Breakfast rate locked at booking time — stored as `breakfastRate` on booking document |
| 54 | Silog selection: per guest per day |
| 55 | Silog menu fully configurable from Settings |
| 56 | Silog selections entered by front desk in booking detail drawer at check-in |
| 57 | Silog choices appear on the guest registration form PDF |
| 58 | Daily kitchen prep report: counts of each silog needed for a given morning — printable |
| 59 | Breakfast globally enable/disable from Settings |
| 60 | Homepage Services section (Tour Packages, Car Rentals) — display only, CTA links to Contact Us |
| 61 | Homepage Spark Rewards section — shows Join CTA for non-members, Welcome back for members |
| 62 | Services and Spark Rewards homepage sections editable from Settings → Website Content |
| 63 | Data backup: single "Download Full Backup" button (admin-only) generates multi-sheet XLSX |
| 64 | DOT/RA 11862 compliance: guest registry fields collected at physical check-in via Guest Registration Form PDF |
| 65 | DOT/RA 11862 compliance: guest registry records retained minimum 6 months |
| 66 | RA 11862 (Anti-Trafficking): unaccompanied minor warning shown as informational banner in drawer |
| 67 | Guest ID photo captured by front desk at check-in via upload in booking drawer |
| 68 | Reports page organized into two tabs: Performance and Sales |
| 69 | Sales Report consolidates room bookings, breakfast add-ons, and store orders |
| 70 | Sales Report PDF uses html2canvas to capture Recharts SVG charts + jsPDF autoTable |
| 71 | Sales XLSX export is multi-sheet: Summary, Bookings, Breakfast, Store Orders |
| 72 | Breakfast kitchen prep report and store low-stock alerts remain as separate operational tools |
| 73 | Additional onsite payments tracked in `bookings/{id}/payments` subcollection |
| 74 | Email acknowledgment: booking submitted email acts as receipt submission warning |
| 75 | Breakfast pricing model: add-on only — Step 1 toggle |
| 76 | Contact form on `/contact`: real `/api/contact` endpoint with Turnstile + honeypot |
| 77 | `payment-confirmed` state set automatically when payment total ≥ `totalPrice` |
| 78 | Room block date range stored as structured fields (`blockedFrom`/`blockedTo`) |
| 79 | `isCorporate` server-authoritative — validated inside booking transaction |
| 80 | Store stock decremented on `confirmed`, not `placed` |
| 81 | Vouchers managed in Rates page (admin-only) |
| 82 | Booking Confirmation Receipt PDF added to drawer & email attachment |
| 83 | Check-in reminder cron idempotency via `reminderSentAt` timestamp |
| 84 | Firestore `checkIn`/`checkOut` stored strictly as `Timestamp` |
| 85 | `AdminContext.members` sourced from real `onSnapshot` listener |
| 86 | No personal names in default config |
| 87 | Honeypot inputs placed inside `<form>` element, hidden via CSS |
| 88 | Housekeeping cycle order: `clean → dirty → in-progress → clean` |
| 89 | Overlapping bookings by same email allowed across different rooms/dates |
| 90 | Member discount server-side enforcement via `Authorization: Bearer` header |
| 91 | Past-booking linkage beyond email deferred to Phase 2 |
| 92 | Early check-in request with multiple bookings picks first upcoming booking |
| 93 | No member-registration welcome email for Phase 1 |
| 94 | Multiple concurrent calls in admin inbox: second wins |
| 95 | Intercom thread auto-archive on checkout |
| 96 | Cancellation messages rendered as distinct greyed-out visual card |
| 97 | Notification sound mute persisted in `localStorage` per-staff |
| 98 | `calls/{roomId}` deleted after 30s grace period after call end |
| 99 | LOU for corporate chargeback: manual confirmation toggle in drawer |
| 100 | Corporate bookings never accept promo vouchers |
| 101 | Negotiated corporate rate model: flat rate per room type |
| 102 | Converted-inquiry bookings get `linkedInquiryId` field |
| 103 | Booking source for converted inquiry is `"corporate"` |
| 104 | 7 new transactional email templates added (Wave 4) |
| 105 | Wave 3 UI/UX spec closures (12 items) |
| 106 | Wave 4 Infrastructure closures (8 items) |
| 107 | Admin app responsive mobile layout (Phase 11.7) |
