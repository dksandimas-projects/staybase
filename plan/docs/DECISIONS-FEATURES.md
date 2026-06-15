# Feature & Product Decisions
> Requires: CLAUDE.md

Resolved product, feature scope, business rules, compliance, and UX decisions. Load this when building a specific feature to understand what was decided and why.

For architecture and stack decisions see `plan/docs/DECISIONS-ARCH.md`.

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
| 12 | Discounts: Senior Citizen 20% + PWD 20% — OSCA-mandated; guest uploads OSCA Card / PWD ID photo at booking Step 3; staff verifies or rejects in booking drawer; rejection restores full `totalPrice`, triggers discount-rejected email instructing guest to pay full amount at check-in |
| 13 | Promo vouchers: guest enters code at Step 3 of booking flow — admin/front-desk manages in Settings |
| 13b | **Discount stacking order** (when multiple discounts apply on the same booking): **1.** Senior/PWD (20% subtotal) → **2.** Voucher (flat or percent, applied to post–Senior/PWD subtotal) → **3.** Spark Rewards member discount (percent, applied to post–voucher subtotal). Member discount only applies when the guest is signed in AND `settings/rewardsConfig.memberDiscountEnabled === true`. Implemented in `shared/utils/pricing.ts` `calculateBookingTotal()` — applied in the listed order, not cumulatively on the original subtotal. UI shows each discount as a separate line in the price summary. |
| 14 | Walk-in bookings: front desk creates manually from dashboard — source field captures origin |
| 15 | Housekeeping status: tracked per room as clean / dirty / in-progress — toggleable from dashboard |
| 16 | Intercom notification sound: Web Audio API only — no extra library — hosted in Firebase Storage |
| 17 | Intercom notification sound plays on every incoming guest message — not just the first per conversation |
| 18 | Intercom security model: physical QR gate + room ID from URL + name prompt — no login required |
| 19 | Reports: occupancy + revenue + bookings by source — Recharts — exportable PDF/CSV/XLSX |
| 63 | Data backup: single "Download Full Backup" button (admin-only) generates one multi-sheet XLSX covering all 8 operational collections — Bookings, Payments, Members, Store Orders, Store Catalog, Breakfast Selections, Vouchers, Corporate Inquiries; all queries run in parallel client-side via SheetJS |
| 73 | Additional onsite payments tracked in `bookings/{id}/payments` subcollection — append-only audit trail; outstanding balance computed client-side; covers discount rejections, points reversals, and Pay at Hotel confirmations; no editing or deletion allowed |
| 64 | DOT/RA 11862 compliance: guest registry fields (nationality, ID type + number, DOB, gender, address) collected at physical check-in via the Guest Registration Form PDF — not required at online booking step |
| 65 | DOT/RA 11862 compliance: guest registry records must be retained minimum 6 months — erasure requests cannot apply to this data within that window |
| 66 | RA 11862 (Anti-Trafficking): unaccompanied minor warning shown as informational banner in booking detail drawer — front desk must verify guardian presence at check-in; system does not block the booking |
| 67 | Guest ID photo captured by front desk at check-in via upload in booking detail drawer — stored in Firebase Storage (staff-only), `guestIdPhotoUrl` on booking document, embedded in Guest Registration Form PDF; if not yet uploaded, PDF shows blank placeholder box |
| 68 | Reports page organized into two tabs: Performance (occupancy, bookings by source) and Sales (all revenue streams consolidated) |
| 69 | Sales Report consolidates all three revenue streams — room bookings, breakfast add-ons, store orders — into one view with summary cards, charts, detail tables, printable PDF, and multi-sheet XLSX export |
| 70 | Sales Report PDF uses html2canvas to capture Recharts SVG charts + jsPDF autoTable for data tables — generated client-side, no API route needed |
| 71 | Sales XLSX export is multi-sheet: Summary, Bookings, Breakfast, Store Orders — one file covers all revenue data for the selected period |
| 72 | Breakfast kitchen prep report and store low-stock alerts remain as separate operational tools — their revenue figures appear in the Sales tab, not duplicated |
| 20 | Website content editable from Settings (homepage, about, corporate sections) — no full CMS |
| 21 | `isCorporate` and `corporateCode` set server-side — never trusted from client |
| 22 | Corporate codes and vouchers validated server-side via API route |
| 23 | Booking reference format: `{config.bookingRefPrefix}-YYYYMMDD-NNN` — generated server-side |
| 24 | Domain: `sparkinnbohol.com` — DK purchases as part of project |
| 25 | Data Privacy Act of 2012 (RA 10173) compliance required — hotel processes guest PII |
| 26 | Data retention: indefinitely — guests may request erasure via email to hotel |
| 27 | Privacy Policy and Terms of Service: dedicated `/privacy` and `/terms` pages on guest site — linked from footer, booking form, and emails where applicable |
| 28 | Consent checkbox required at booking Step 2 — links to `/privacy` and `/terms`, blocks submission if unchecked |
| 29 | Hotel owner/admin serves as Data Protection Officer (DPO) |
| 30 | Data breach notification: NPC within 72 hours if breach affects guest PII |
| 31 | Legal content (privacy policy body, cancellation policy, house rules) editable at runtime from Settings |
| 32 | Spark Essentials store accessible only via room QR scan — not from public website |
| 33 | Store orders linked to room ID and active booking (null if no active booking found) |
| 34 | Store payment methods: CoD, Add to Bill, GCash — independent of booking payment methods |
| 35 | "Add to Bill" = note for front desk to collect at checkout — does not auto-update booking totalPrice |
| 36 | Store stock: null = unlimited, 0 = out of stock, n = tracked quantity |
| 37 | Stock decremented on order confirmed (not placed) — restored if cancelled before confirmed |
| 38 | Store order status flow: Placed → Confirmed → Out for Delivery → Delivered; Cancelled is terminal at any point |
| 39 | Store item deleted with existing orders: soft-delete only (isActive: false) — never hard delete |
| 40 | Store order ref format: SO-YYYYMMDD-NNN — generated server-side |
| 41 | Spark Rewards Phase 1: auth, member profile, booking history, configurable points earning, configurable member discount, SR-XXXXX member card |
| 42 | Spark Rewards Phase 2: points redemption, tier system, tier-based perks — TBD |
| 43 | Guest auth: Google Sign-In + email/password — separate from admin auth, same Firebase project |
| 44 | Guest registration available post-booking (Step 4 prompt) and standalone at `/rewards` |
| 45 | Past anonymous bookings linked to member account by email match on registration |
| 46 | Points redemption is Phase 1 but admin-only — staff applies it manually from the booking detail drawer; guests cannot redeem online; redemption rate is configurable in Settings |
| 47 | Early check-in request: always available to members — not configurable on/off; sends tagged intercom message or email to front desk |
| 48 | Manual points adjustment by staff requires a reason — always logged to points history |
| 49 | Member account deletion triggers data erasure per RA 10173 right to erasure |
| 50 | `guests/` collection = staff only; `members/` collection = guest loyalty members |
| 51 | Breakfast add-on: per person per night — rate × numGuests × numNights |
| 52 | Breakfast shown at Step 1 as "Room Only" vs "Room + Breakfast" combined rate — not as a separate add-on at Step 3 |
| 53 | Breakfast rate locked at booking time — stored as `breakfastRate` on booking document |
| 54 | Silog selection: per guest per day — each guest can choose a different silog each morning |
| 55 | Silog menu fully configurable from Settings — hotel can add/remove/disable items |
| 56 | Silog selections entered by front desk in booking detail drawer at check-in — not by guest online |
| 57 | Silog choices appear on the guest registration form PDF — guests fill in at check-in |
| 58 | Daily kitchen prep report: counts of each silog needed for a given morning — printable |
| 59 | Breakfast globally enable/disable from Settings — hides option from booking flow when off |
| 60 | Homepage Services section (Tour Packages, Car Rentals) — display only, CTA links to Contact Us — no booking or pricing |
| 61 | Homepage Spark Rewards section — shows Join CTA for non-members, Welcome back for logged-in members |
| 62 | Services and Spark Rewards homepage sections editable from Settings → Website Content — sections hidden when disabled |
| 74 | Email acknowledgment: the booking submitted email acts as an acknowledgment/receipt submission, warning the guest that their booking and payment are under manual review and a final confirmation email will follow after verification |
| 75 | Breakfast pricing model: add-on only — booking flow shows "Room Only" vs "Room + Breakfast" toggle at Step 1, with `breakfastRate` charged per-person-per-night on top of the room rate. No `includedInRoomRate` field on `breakfastConfig`. The current implementation already handles the use case. If a future hotel client needs "breakfast always included" as a per-room differentiator, add it as a scoped feature then. *(Per audit W1.7, 2026-06-15)* |
