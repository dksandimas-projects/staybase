# Settings
> App: admin-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Settings

## Overview

Admin-only page at `/settings`. Organized into tabs. Covers hotel information, payment methods, email configuration, staff account management, discount rules, voucher management, intercom quick requests, and website content editing for all public pages.

---

## Tabs

### 1. Hotel Info

- [ ] Hotel name, address, contact email, contact phone
- [ ] Check-in time, check-out time
- [ ] Facebook URL, Instagram URL
- [ ] Mission statement (textarea)
- [ ] Vision statement (textarea)
- [ ] Hotel story (textarea or short rich-text)
- [ ] Save button
- [ ] Source: `settings/hotelConfig` — `updateDoc` on save

---

### 2. Payment Methods

- [ ] List of payment methods with enable/disable toggle
- [ ] Per method: name, QR code upload, account info text field
- [ ] Pay at Hotel global toggle
- [ ] Add payment method form — name, QR, account info
- [ ] Delete payment method (with confirmation)
- [ ] Source: `settings/hotelConfig.paymentMethods[]`
- See `features/RATE-MANAGEMENT.md` for rate-related settings

---

### 3. Email

- [ ] From email address (Resend sender — `sparkinn.reservations@gmail.com`)
- [ ] Admin notification email (for new corporate inquiries)
- [ ] Preview of each email trigger type (read-only label list)
- [ ] Source: `api/.env` — note to admin: "Email settings require a code deploy to change"
- [ ] These fields may be read-only in UI if managed via env vars

---

### 4. Staff Accounts

- [ ] List of all staff accounts (name, email, role, date created)
- [ ] Create staff account form — email, display name, role (Front Desk / Admin), temporary password
- [ ] Disable / enable staff account toggle
- [ ] Delete staff account (with confirmation modal)
- [ ] Admin-only — front desk cannot see or access this tab
- [ ] Account creation uses Firebase Admin SDK via API route — not client-side `createUserWithEmailAndPassword`

---

### 5. Discount Rules

- [ ] Senior Citizen discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [ ] PWD discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [ ] Note: "ID is verified physically at check-in — this discount is applied on guest's honor at booking."

---

### 6. Vouchers

- [ ] Full voucher management UI — see `features/VOUCHERS.md §Admin UI Checklist`
- [ ] Both Admin and Front Desk can access this tab

---

### 7. Intercom

- [ ] Quick request items list — current items with edit/delete per item
- [ ] Add quick request item — text input + Add button (e.g. "Extra Towels")
- [ ] Reorder items — drag or up/down arrows
- [ ] Notification sound — upload audio file to Firebase Storage, URL stored in `settings/hotelConfig.notificationSoundUrl`
- [ ] Audio preview button — play the current notification sound
- [ ] Source: `settings/hotelConfig.intercomQuickRequests[]` + `notificationSoundUrl`

---

### 8. Website Content

Editable copy and photos for public pages. Changes reflect on the guest site in real-time (Firestore listener or on-load fetch).

**Homepage:**
- [ ] Hero heading (text)
- [ ] Hero subtext (text)
- [ ] Hero background photo (upload)
- [ ] Amenities section — list of items (title, description, icon name); add/remove/reorder
- [ ] Featured rooms selector — pick 3 rooms from a dropdown of active rooms

**About Us:**
- [ ] Hero / banner photo (upload)
- [ ] Mission, vision, hotel story fields (also in Hotel Info tab — link or sync)

**Corporate:**
- [ ] Hero heading (text)
- [ ] Hero subtext (text)
- [ ] Hero background photo (upload)
- [ ] Perks section — list of items (title, description, icon name); add/remove/reorder

**Services (Tour Packages & Car Rentals):**
- [ ] Services section enable/disable toggle
- [ ] List of service cards — title, description, icon name; add/remove/reorder
- [ ] Default items pre-seeded: "Tour Packages", "Car Rentals"
- [ ] CTA is always "Contact Us" → `/contact` — not editable

**Spark Rewards Promo (Homepage):**
- [ ] Enable/disable Spark Rewards homepage section toggle
- [ ] Heading text
- [ ] Description text (key perks to highlight)

**Our Rooms / Contact Us:**
- [ ] Note: "Room content managed in Room Management. Contact details managed in Hotel Info."

Source: `settings/websiteContent` — `setDoc` on save per section.

---

### 9. Breakfast

- [ ] Enable/disable breakfast add-on globally — toggle
- [ ] Silog menu management — list of items with edit/delete per item
- [ ] Add silog item — name input + Add button (e.g. "Tapsilog", "Longsilog", "Tocilog", "Bangsilog")
- [ ] Enable/disable individual silog items — hidden from booking flow and registration form when inactive
- [ ] Note: "Breakfast rate is set in Rate Management"
- [ ] Both Admin and Front Desk can manage the silog menu
- [ ] Source: `settings/breakfastConfig`

---

### 10. Store (Spark Essentials)

- [ ] Enable/disable store globally — toggle
- [ ] Product catalog management — see `features/STORE-MANAGEMENT.md §Catalog Management` for full checklist
- [ ] Store payment methods — CoD, Add to Bill, GCash (with QR upload + account info) — independent of booking payment methods
- [ ] Low stock threshold — number input (default 5)
- [ ] Both Admin and Front Desk can access this tab
- [ ] Source: `settings/storeConfig`

---

### 11. Spark Rewards

Admin-only tab. Controls all configurable loyalty program settings.

**Points Earning**
- [ ] Enable/disable points earning globally — toggle (`settings/rewardsConfig.pointsEnabled`)
- [ ] Earning mode selector — "Per Booking (flat)" or "Per ₱ Spent"
  - [ ] **Per Booking (flat):** number input — "Points per booking" (e.g. 50 pts per completed stay)
  - [ ] **Per ₱ Spent:** number input — "Points per ₱100 spent" (e.g. 1 pt per ₱100 of booking total)
- [ ] When disabled — points balance still visible to members but no new points awarded; My Rewards page hides points earning info and shows "Points earning is currently unavailable"

**Member Discount**
- [ ] Enable/disable member discount — toggle (`settings/rewardsConfig.memberDiscountEnabled`)
- [ ] Discount percentage input — shown only when enabled (e.g. 10%)
- [ ] Discount applies automatically at booking Step 1 for logged-in members — shown as "Member Rate"
- [ ] When disabled — no discount shown, no auto-apply; My Rewards page hides discount badge

**Points Redemption**
- [ ] Redemption rate input — "₱ value per 100 points" (e.g. `100` = 100 pts gives ₱100 off; `50` = 100 pts gives ₱50 off)
- [ ] Helper text shown below input: "e.g. at ₱100/100pts, a member with 500 points can get ₱500 off a booking"
- [ ] Note: "Points redemption is applied manually by staff from the booking detail drawer — guests cannot redeem online"
- [ ] Source: `settings/rewardsConfig.pointsRedemptionRate`

**Early Check-In Perk**
- [ ] Display note: "Early check-in request is always available to members — not configurable"

**Program Info (visible on guest-facing rewards pages)**
- [ ] Program name — default "Spark Rewards" (editable)
- [ ] Tagline — short marketing line for homepage section and `/rewards` page
- [ ] Source: `settings/websiteContent.homepage.sparkRewards` (heading/description already there) + `settings/rewardsConfig`

- [ ] Source: `settings/rewardsConfig` — `updateDoc` on save
- [ ] Admin-only — front desk cannot access this tab

---

### 10. Legal Content

Editable by hotel admin — no redeploy required. Changes reflect on guest site immediately.

- [ ] Privacy Policy body — textarea (plain text or light markdown), saved to `settings/websiteContent.privacyPolicyBody`
- [ ] Cancellation Policy — textarea, saved to `settings/websiteContent.cancellationPolicy`; displayed at booking Step 3 and in confirmation emails
- [ ] House Rules — textarea, saved to `settings/websiteContent.houseRules`; used in guest registration PDF at check-in
- [ ] "Last Updated" date for Privacy Policy — auto-set to current date on save
- [ ] Note to admin: "Some legal fields (legal name, DPO email, applicable law) are set at deployment and require DK to update."

---

## Data & Logic Checklist

- [ ] All settings tabs fetch from `settings/hotelConfig` or `settings/websiteContent` on mount
- [ ] Photo uploads: Firebase Storage → `getDownloadURL` → store URL in Firestore
- [ ] Staff account creation: POST to `/api/admin/create-staff` (Vercel API route using Firebase Admin SDK)
- [ ] Staff account disable: POST to `/api/admin/disable-staff`
- [ ] Website content changes: `setDoc` (merge) on `settings/websiteContent`
- [ ] Hotel info changes: `updateDoc` on `settings/hotelConfig`

## Edge Cases & States

- [ ] Loading state per tab — skeleton while fetching
- [ ] Save fails — show error, preserve unsaved changes
- [ ] Photo upload fails — show error per upload
- [ ] Staff creation: email already in use — show clear error
- [ ] Deleting last admin account — prevent with error message

## Manual QA

- [ ] Update hotel name in Hotel Info — change reflects in guest site footer
- [ ] Add payment method with QR — appears in guest booking flow Step 3
- [ ] Disable payment method — disappears from guest booking flow
- [ ] Create front desk account — can log in and access dashboard
- [ ] Admin account cannot be deleted if it's the only admin
- [ ] Add quick request item — appears in guest intercom quick request panel
- [ ] Upload notification sound — plays in intercom inbox when new message arrives
- [ ] Update homepage hero heading — change reflects on guest homepage
- [ ] Change featured rooms — guest homepage shows updated 3 rooms

## References

- Hotel config schema: `docs/BACKEND.md §settings/hotelConfig`
- Website content schema: `docs/BACKEND.md §settings/websiteContent`
- Voucher management: `features/VOUCHERS.md`
- Payment methods (rates): `features/RATE-MANAGEMENT.md`
- Auth guard (admin-only): `features/AUTH-ROLES.md`
- Intercom usage: `features/INTERCOM-INBOX.md`, `features/INTERCOM-GUEST.md`
