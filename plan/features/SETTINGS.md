# Settings
> App: admin-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Settings

## Overview

Admin-only page at `/settings`. Organized into tabs. Covers hotel information, email configuration, staff account management, discount rules, intercom quick requests, and website content editing for all public pages. **Booking payment methods are managed in Rates** — see `plan/features/RATE-MANAGEMENT.md` (per W3.1).

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

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
- See `plan/features/RATE-MANAGEMENT.md` for rate-related settings

---

### 3. Email

- [ ] From email address (Resend sender — `sparkinn.dev@gmail.com`)
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

- [ ] Full voucher management UI — see `plan/features/VOUCHERS.md §Admin UI Checklist`
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

### 8. Branding

The single edit surface for everything the guest sees at the top of every public page: per-page hero photos, per-page hero copy, and the three logo overrides (navbar solid, navbar over hero, footer). Changes reflect on the guest site in real-time via the `usePublicSiteContent` listener.

**Hero Photos** (upload + preview + reset-to-default per page):
- [ ] **Homepage hero photo** — full-bleed background for `/`. Recommended 1920x1080.
- [ ] **About hero photo** — top of `/about`. Recommended 1920x600.
- [ ] **Corporate hero photo** — top of `/corporate`. Recommended 1920x1080.
- [ ] **Rewards hero photo** — top of `/rewards`. Recommended 1920x1080.
- [ ] Per row: thumbnail preview (custom override or deploy-time fallback), "Upload" / "Replace" button, "Reset to default" button (only when an override is set), and a status pill ("Custom override" / "Using default").
- [ ] Compressed client-side via `compressImageFile` (max 1920x1080 for full-bleed, 1920x600 for about, 600x200 for logos; JPEG @ 0.85 quality).
- [ ] Uploaded to Firebase Storage at `assets/branding/<key-as-path>/<timestamp>-<filename>` (e.g. `assets/branding/homepage/heroPhotoUrl/...`).
- [ ] Download URL written to `settings/websiteContent` via merged `setDoc`.

**Hero Copy** (text inputs grouped by page, one "Save Hero Copy" button at the bottom):
- [ ] Homepage — heading + subtext
- [ ] About — heading
- [ ] Corporate — eyebrow + heading + subtext
- [ ] Rewards — eyebrow pill (e.g. "Loyalty Program") + heading + subtext
- [ ] Helper text under the rewards eyebrow: "Renders as '{config.rewardsName} {rewards.heroEyebrow}' in the pill."

**Logo Overrides** (upload + preview + reset-to-default per variant):
- [ ] **Navbar logo (solid background)** — used in the sticky/scrolled state and on every non-hero page. Colored version on a light background.
- [ ] **Navbar logo (over hero, dark background)** — use a light/white version for visibility over the dark hero photo. This is the variant that fixes the dark-on-dark logo bug in the over-hero state.
- [ ] **Footer logo** — white version for the dark sidebar footer.
- [ ] Helper text: "If you only upload one variant it's mirrored across both states."
- [ ] Fallback chain: custom URL → `hotel.config.ts → logos.*` (deploy-time static file in `public/brand/`).
- [ ] Navbar selection: when `solid === true` (scrolled, non-hero page) use `logoNavbar`; when `solid === false` (over hero, transparent) use `logoNavbarOnDark` — or fall back to whichever variant the admin uploaded.

**Edge cases & behaviors:**
- [ ] Photo upload fails — show error inline under the uploader, leave existing override intact
- [ ] Reset button only visible when an override is set
- [ ] Reset writes empty string to Firestore + best-effort deletes the Storage object
- [ ] Hero eyebrow on homepage is not editable — it remains the deploy-time `config.tagline` (preserves W3.10 design intent)
- [ ] All uploads require Admin role (Storage rule `match /assets/branding/{fileName}` is `isStaff`; the page itself is admin-only by the sidebar guard)

Source: `settings/websiteContent` — `setDoc` on save (copy fields) or per-upload merged `setDoc` (photos + logos).

---

### 9. Website Content

List-shaped editable content for the public homepage. Hero copy + photos were moved to the Branding tab. This tab is organized into four sub-sections, each with its own editor and a single "Save Content" button at the bottom that persists all four at once.

**Homepage Amenities** (four-up grid)
- [ ] Add / remove / reorder the amenity cards. Each row: title, description, icon name (dropdown of `KNOWN_CONTENT_ICONS` from `shared/constants`), isEnabled toggle
- [ ] Disabled items are hidden from the guest site but stay in the data so the order is preserved
- [ ] Default items pre-seeded: "Consistent comfort", "Easy city access", "Warm front desk care"
- [ ] Source: `settings/websiteContent.homepage.amenities`

**Featured Room Types** (up to 3 on the "Stay with us" section)
- [ ] Two-pane selector: available room types on the left, featured types on the right
- [ ] Each row in the left pane shows the type label + the count of *active* rooms of that type. Types with zero active rooms are grayed out and can't be added (no card would render anyway)
- [ ] Each row in the right pane shows the type label + active-room count + a position number badge (the order here is the render order on the public site)
- [ ] Add / remove / reorder (up/down) the picked list; capped at `MAX_FEATURED_TYPES = 3` (renamed from the old `MAX_FEATURED_ROOMS = 3` alias which is kept for the migration window)
- [ ] When the picked list is empty the guest site falls back to the first `MAX_FEATURED_TYPES` *distinct* types that have at least one active room (NOT raw room IDs — that was the bug the type-driven model fixes)
- [ ] The card content (image, bed, amenities, capacity, price, description) all comes from the room TYPE via `roomTypes[value]` — the picked physical room is only used for the `key` and the Book Now deep link
- [ ] A picked type that has no active rooms is silently skipped (no empty card)
- [ ] Source: `settings/websiteContent.homepage.featuredTypeValues`

**Migration from the old per-room picker** — the previous model was `featuredRoomIds: string[]` (a list of physical room doc IDs). That was wrong: every card field is type-driven, so picking "Room 201" vs "Room 202" (both `executive`) rendered identically. `AdminContext.mergeWebsiteContent` does a one-time migration on read: if the doc still carries the old `featuredRoomIds` and no new `featuredTypeValues`, it maps each id to its room type via the `roomTypes` already in context, dedupes, and returns the new field. The next admin save writes the new field and the old one is dropped. localStorage cache key bumped from `publicSiteContent:v1` to `v2` so old cached entries are ignored.

**Homepage Services** (two-up service cards)
- [ ] Add / remove / reorder the service cards. Each row: title, description, icon, isEnabled toggle
- [ ] CTA is always "Contact us" → `/contact` and is not editable
- [ ] Default items pre-seeded: "Tour Packages", "Car Rentals"
- [ ] Source: `settings/websiteContent.homepage.services`

**Spark Rewards Promo** (the dark promo block on the homepage)
- [ ] Enable / disable the entire block — global toggle. Block hides entirely when disabled
- [ ] Heading + description (one-line marketing copy)
- [ ] Perks list — add / remove / reorder perks. Each row: title, description, icon, isEnabled toggle. Disabled perks stay in the data so the order is preserved
- [ ] Default items pre-seeded: "Earn points on completed stays", "Member-only stay offers", "Request early check-in"
- [ ] Source: `settings/websiteContent.homepage.sparkRewards`

**Our Rooms / Contact Us:**
- [ ] Note: "Room content managed in Room Management. Contact details managed in Hotel Info."

**Implementation notes:**
- The four editors use two reusable components: `ListEditor` (amenities, services, perks) and `RoomPicker` (featured rooms). Both live in `admin-app/src/components/`
- All four sub-objects are persisted together via `setDoc(settings, "websiteContent", { homepage: {…} }, { merge: true })` on a single "Save Content" button
- `KNOWN_CONTENT_ICONS` is a kebab-case string union exported from `shared/constants/index.ts` — the admin app renders a dropdown, the guest app's per-page `resolveIcon` helper maps each name to a `lucide-react` component

Source: `settings/websiteContent` — `setDoc` on save per section.

**Room Type Photos** *(per W3.5 — type-driven gallery, cross-reference)* — lives on the **Room Types** tab. The room type entry owns its `imageUrls[]` plus rate matrix + `maxCapacity` (W3.6) and `bedDefinition` + `description` + `amenities` (W3.7). The Settings → Room Types table is the single edit surface: Add captures every type field including rates; the **Edit** modal updates every type field; the **Photos** modal handles the type's gallery. Photos are stored at `room-types/{typeValue}/{filename}` in Storage (public read, staff write). Maximum `MAX_ROOM_TYPE_PHOTOS` (currently 10) per type — enforced in the upload UI. Source: `settings/hotelConfig.roomTypes[].imageUrls`.

**Room Type Photos** *(per W3.5 — type-driven gallery)* — note: lives on the **Room Types** tab, not here. Documented for cross-reference only.

> **W3.6 + W3.7 update:** The room type entry owns the rate matrix + `maxCapacity` (W3.6) and `bedDefinition` + `description` + `amenities` (W3.7). The Settings → Room Types table is the single edit surface: Add captures every type field including rates; the **Edit** modal updates every type field; the **Photos** modal handles the type's gallery. The **Rates** tab still exists for bulk rate review but rates can also be edited per-type from Settings. Rooms created against a type inherit all of these properties by joining `Room.type` at read time.

---

### 10. Breakfast

- [ ] Enable/disable breakfast add-on globally — toggle
- [ ] Silog menu management — list of items with edit/delete per item
- [ ] Add silog item — name input + Add button (e.g. "Tapsilog", "Longsilog", "Tocilog", "Bangsilog")
- [ ] Enable/disable individual silog items — hidden from booking flow and registration form when inactive
- [ ] Note: "Breakfast rate is set in Rate Management"
- [ ] Both Admin and Front Desk can manage the silog menu
- [ ] Source: `settings/breakfastConfig`

---

### 11. Store (`config.storeName` — "Spark Essentials" for Spark Inn)

- [ ] Enable/disable store globally — toggle
- [ ] Product catalog management — see `plan/features/STORE-MANAGEMENT.md §Catalog Management` for full checklist
- [x] Store payment methods — CoD, Add to Bill, GCash (with QR URL + account info) — independent of booking payment methods
- [ ] Low stock threshold — number input (default 5)
- [ ] Both Admin and Front Desk can access this tab
- [ ] Source: `settings/storeConfig`

---

### 12. Spark Rewards

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

### 13. Legal Content

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

- Hotel config schema: `plan/docs/BACKEND.md §settings/hotelConfig`
- Website content schema: `plan/docs/BACKEND.md §settings/websiteContent`
- Voucher management: `plan/features/VOUCHERS.md`
- Payment methods (rates): `plan/features/RATE-MANAGEMENT.md`
- Auth guard (admin-only): `plan/features/AUTH-ROLES.md`
- Intercom usage: `plan/features/INTERCOM-INBOX.md`, `plan/features/INTERCOM-GUEST.md`
