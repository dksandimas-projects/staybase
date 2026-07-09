# Settings
> App: admin-app
> Phase: Phase 9 — Remaining Features
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Settings

## Overview

Admin-only page at `/settings`. Organized into tabs. Covers hotel information, booking payment methods, email configuration, staff account management, discount rules, intercom quick requests, and website content editing for all public pages.

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
- [ ] **Phase 11.8 PR 3 — Hotel Contact Details card**: address (single-line), front-desk phone, support email, DPO email, Facebook URL, Instagram URL — all admin-editable runtime overrides of the deploy-time `hotel.config.ts` values. Each falls back to the white-label config when the input is empty. Renders on Footer, Contact page, and Privacy page via `usePublicSiteContent.contact.*`.
- [ ] Save button
- [ ] Source: `settings/hotelConfig` — `updateDoc` on save

---

### 2. Payment Methods

Fully dynamic CRUD for the booking payment list. The list rendered on `/book` Step 3 is sourced directly from `settings/hotelConfig.paymentMethods[]`, filtered to `isEnabled` — add / remove / reorder / toggle from this tab and the guest site reflects the change on the next snapshot tick. The previous per-method `accountInfo` text field and the separate `payAtHotelEnabled` global toggle have been replaced by structured `accountName` + `accountNumber` fields and a per-method `isEnabled` flag (so "Pay at Hotel" is just another method).

**Persistent callout (top of the tab)**

- [ ] Amber callout listing the supported methods: **GCash, Maya, Bank Transfer (InstaPay), PayPal, Pay at Hotel** — and explicitly calling out **Pesonet as not supported** (batch-based with T+1 settlement, incompatible with instant booking confirmation). Not dismissible — it is policy, not a tip.
- [ ] Helpers sourced from `SUPPORTED_PAYMENT_METHODS` in `shared/constants` (single source of truth).

**Method list**

- [ ] One card per method: icon, label, method key pill, "Hidden" pill when disabled, "Unsupported" pill for Pesonet etc., enable toggle, edit (pencil), delete (trash, two-click confirm), up/down reorder arrows.
- [ ] Disabled rows are dimmed and show a "Hidden" pill.
- [ ] Empty state when `paymentMethods[]` is empty — CTA "Add payment method" with copy explaining why data is missing.
- [ ] Reorder via up/down arrows (no full drag library — same pattern as Intercom quick requests). Up arrow disabled on the first row, down arrow disabled on the last.

**Add / Edit modal**

- [ ] **Method key** (text) — unique identifier stored in `paymentMethod` on each booking. Lowercase letters, numbers, and hyphens only. Immutable after creation (renaming would break existing booking records).
- [ ] **Label** (text) — display name shown to guests (e.g. "GCash", "Bank Transfer", "Pay at Hotel").
- [ ] **Account name** (text) — recipient name shown beside the QR. Leave empty for "Pay at Hotel" or methods that don't need it.
- [ ] **Account number** (text) — for PayPal, use the PayPal email address.
- [ ] **Require reference number** (toggle, owner request 2026-07-09) — `requireReferenceNumber?: boolean`, **defaults to `true`** when missing (so existing methods behave as "required" without needing a migration, matching the surface-pill default pattern above). When on, the guest booking flow (`/book` Step 3) shows a required "Reference Number" text field alongside the payment proof screenshot upload for that method; when off, the field is hidden and not required. Intended for methods like Pay at Hotel/COD where a transaction reference doesn't exist — admin can flip it off per method rather than it being hardcoded to only the online methods.
- [ ] **Enable toggle** — `isEnabled: boolean`; hidden methods are not shown to guests. Per #111, this is now the **regular-booking** surface switch (the leftmost of the three inline pills in the row).
- [ ] **Per-method surface pills** (per #111) — three inline pill toggles in each row control which surfaces the method is offered on:
  - **Booking** (leftmost, the existing `isEnabled` toggle) — visibility on `/book` Step 3.
  - **Store** — visibility on the in-room store checkout (`/intercom/:roomId` Shop tab). Persists as `showInStore: boolean`. `cod` and `add-to-bill` are store-only entries backfilled into this same list; `pay-at-hotel` is excluded from the store because `add-to-bill` is the folio option.
  - **Corp** — visibility on the corporate booking personal-pay selector (`/corporate/book` Step 3). The company charge-back path is unaffected. Persists as `showInCorporate: boolean`.
  - All three default to `true` when missing (pre-#111 entries are treated as "visible on all surfaces" — no migration required). Tooltip on each pill explains the surface name.
- [ ] **QR uploader** (only on edit, not add — the new method's storage path requires a saved method key) — file input, preview, "Upload QR" / "Replace QR" / "Remove QR" buttons, status pill ("Custom override" / "No QR"), error inline. Uploads to `assets/payment-methods/{method}/{timestamp}-{filename}` in Firebase Storage. Accepts `image/png`, `image/jpeg`, `image/webp` (max 2 MB). Best-effort deletes the previous QR on replace.
- [ ] **Pesonet warning** — inline warning when the typed method key matches `UNSUPPORTED_PAYMENT_METHODS` (case-insensitive). The Save button label flips to "I understand, save anyway" for 5 seconds; the second click persists. Schema is not hard-blocked — the friction is policy, not enforcement.
- [ ] **Save / Cancel** — single "Save" button in the modal footer.

**Delete**

- [ ] Two-click confirm: first click arms the button ("Tap again to confirm"), second click within 3 seconds executes. Auto-cancels after 3 seconds.
- [ ] **Protected methods** — entries whose key is in `PROTECTED_PAYMENT_METHODS` (currently `["pay-at-hotel", "add-to-bill"]`) render NO delete button. A blue "Required" pill with a lock icon is shown next to the label instead. The underlying `deletePaymentMethod` in `AdminContext` also blocks deletion as a second line of defense, so a future code path cannot remove the entry either. `pay-at-hotel` is protected because walk-in creation, corporate inquiry conversion, and booking step-3 fallback depend on it. `add-to-bill` is protected because checkout folios and reports derive billed store charges from `storeOrders.paymentMethod === "add-to-bill"`. To remove the protection, edit `PROTECTED_PAYMENT_METHODS` in `shared/constants`.
- [ ] **Block delete when bookings reference the method** — one-shot `getDocs(query(bookings, where("paymentMethod", "==", method), limit(1)))`. Toast surfaces the booking count and tells the admin to reassign or close those bookings first.
- [ ] Best-effort cleanup of the method's QR files in Storage (`listAll` + `deleteObject` under `assets/payment-methods/{method}/`).

**Source / persistence**

- [ ] All writes go through `setDoc(settings/hotelConfig, { paymentMethods: next }, { merge: true })` so the `onSnapshot` listener in `AdminContext` updates the UI in place.
- [ ] The admin URL is `/settings?tab=payment` (deep link from `/rates` and the sidebar both work).
- [ ] QR files are compressed client-side via `compressImageFile(file, { maxWidth: 800, maxHeight: 800, quality: 0.9, mimeType: "image/png" })` — PNG is critical because QR codes are sharp monochrome and JPEG artifacts destroy scannability. Maximum file size `MAX_PAYMENT_METHOD_QR_BYTES` (2 MB) enforced pre-compression with a clear error toast.
- [ ] Source: `settings/hotelConfig.paymentMethods[]`. Storage path: `assets/payment-methods/{method}/{timestamp}-{filename}`.

**One-time read migration (handled in `AdminContext`)**

- [ ] On first snapshot, if the doc carries the legacy `bookingPaymentMethods` key (the pre-feature field name) and no `paymentMethods` key, the entries are reshaped in place: `accountInfo` (single free-text field) is split into `accountName` (first line) + `accountNumber` (the rest, or empty when only one line). The legacy key is left in place on the doc — `setDoc(..., { merge: true })` cannot remove fields, and the few KB of dead data are harmless.
- [ ] The migration is gated by a `useRef` so it runs at most once per session and is idempotent.
- [ ] **One-shot protected-method backfill** — On first snapshot, if `paymentMethods[]` exists but does not contain every key in `PROTECTED_PAYMENT_METHODS` (currently `["pay-at-hotel"]`), the missing entries are appended with sensible defaults (e.g. `{ method: "pay-at-hotel", label: "Pay at Hotel", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true }`) and the merged array is persisted via `setDoc(settings/hotelConfig, { paymentMethods: next }, { merge: true })`. Gated by a separate `useRef` (`hasBackfilledProtectedPaymentMethodsRef`) so it runs at most once per session and is idempotent. This is the safe backfill for deployments that configured their list before "Pay at Hotel" was added to the default seed. Only `pay-at-hotel` is backfilled — `maya` and `bank` are NOT, so an admin who previously removed them keeps their decision. To add more backfill entries, extend `BACKFILL_DEFAULTS` in `AdminContext.tsx` and `PROTECTED_PAYMENT_METHODS` in `shared/constants`.

**See also**

- Schema: `plan/docs/TYPES.md §PaymentMethodConfig` and `plan/docs/BACKEND.md §settings/hotelConfig`.
- Storage rule: `firebase/storage.rules` `match /assets/payment-methods/{method}/{fileName}` (public read, staff write).
- Constants: `SUPPORTED_PAYMENT_METHODS`, `UNSUPPORTED_PAYMENT_METHODS`, and `PROTECTED_PAYMENT_METHODS` exported from `shared/constants`.

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
- [x] Edit staff account details — name, email, phone, and role via a dedicated edit modal
- [x] Reset staff password — support setting new password directly or triggering standard password reset email link
- [x] Update staff account endpoint uses Vercel API route `/api/admin/update-staff` with transactional consistency and auth rollback on failure

---

### 5. Discount Rules

- [ ] Senior Citizen discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [ ] PWD discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [ ] Note: "ID is verified physically at check-in — this discount is applied on guest's honor at booking."

---

### 6. Vouchers

- [ ] Voucher campaign management lives on the admin-only Rates page — see `plan/features/VOUCHERS.md §Admin UI Checklist`
- [ ] Front Desk cannot access voucher campaign management from Settings

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
- [ ] Homepage — eyebrow + heading + subtext (per Phase 11.8 PR 1, the eyebrow overrides `config.tagline`; falls back to `config.tagline` on the public site when empty)
- [ ] About — eyebrow + heading + subtext (per Phase 11.8 PR 1, the eyebrow overrides the page's hard-coded "Our Story" pill and the subtext overrides the page's deploy-time "Discover the vision and heart behind {config.brandName}…" line)
- [ ] Corporate — eyebrow + heading + subtext
- [ ] Rewards — eyebrow pill (e.g. "Loyalty Program") + heading + subtext
- [ ] Helper text under the rewards eyebrow: "Renders as '{config.rewardsName} {rewards.heroEyebrow}' in the pill."
- [ ] Helper text under the homepage eyebrow: "Optional override of the deploy-time tagline. Leave blank to use the white-label config."

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
- [ ] Hero eyebrow on homepage is editable as of Phase 11.8 PR 1 — it overrides the deploy-time `config.tagline` (W3.10 design intent is preserved via the safe-default `pickString` chain in `usePublicSiteContent.ts`)
- [ ] All uploads require Admin role (Storage rule `match /assets/branding/{fileName}` is `isStaff`; the page itself is admin-only by the sidebar guard)
- [ ] Edits reflect on a parallel guest tab in real time via the cross-tab bust mechanism (`bustPublicSiteContentCache` writes `localStorage["publicSiteContent:bust"]`; the public hook subscribes to the `storage` event and refetches). Same-browser demos see updates within ~200 ms; cross-device updates still rely on the 5-minute TTL.

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

**Corporate page** (everything on `/corporate` other than the hero, which lives on the Branding tab)
- [ ] **Perks grid** — add / remove / reorder perks shown in the three-up grid on the corporate page. Each row: title, description, icon (from `KNOWN_CONTENT_ICONS`), isEnabled toggle. Disabled perks stay in the data so the order is preserved
- [ ] Default perks pre-seeded from `DEFAULT_CORPORATE_PERKS` in `@spark-inn/shared` (6 entries: Negotiated Rates, Group Bookings, Dedicated Support, High-Speed Wi-Fi, Premium Security, Flexible Bookings) — same source as the guest-app fallback
- [ ] **Rooms overview** — eyebrow + heading + subtext shown above the room type cards. Empty fields fall back to `DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview` in `@spark-inn/shared`
- [ ] **Retreat CTA banner** — heading + description + button label for the orange banner between the rooms overview and the inquiry form. Empty fields fall back to `DEFAULT_CORPORATE_PAGE_CONTENT.retreat`. Button target (the inquiry form) is not editable
- [ ] **Auto-population** — the admin editor's state is pre-populated from `DEFAULT_CORPORATE_PAGE_CONTENT` whenever the corresponding Firestore field is empty, so the admin sees the current text in the inputs (no need to retype). On first admin load, a one-time backfill in `AdminContext` writes any empty `corporate.*` TEXT field (9 fields: hero eyebrow/heading/subtext + rooms overview eyebrow/heading/description + retreat heading/description/ctaLabel) to Firestore so the public site locks to the same copy the deploy-time fallback provides. The backfill is gated by a `useRef` so it runs at most once per session, and it is idempotent — subsequent loads short-circuit because every field is already populated. **`corporate.heroPhotoUrl` is intentionally NOT backfilled** — the guest app's `pickString` falls back to the static `corporateHeroImage` in `data/homepage.ts` when the field is empty, so persisting the default URL would (a) undo the admin's Reset action on the next dashboard load, and (b) freeze the hero image to the URL that existed at first load, preventing future edits to `corporateHeroImage` from reaching the public site
- [ ] Source: `settings/websiteContent.corporate.{perks[], roomsOverview{Eyebrow,Heading,Description}, retreat{Heading,Description,CtaLabel}}`

**Our Rooms / Contact Us:**
- [ ] Note: "Room content managed in Room Management. Contact details managed in Hotel Info."

**Implementation notes:**
- The editors use two reusable components: `ListEditor` (homepage amenities, homepage services, Spark Rewards perks, corporate perks) and `TypePicker` (featured room types). Both live in `admin-app/src/components/`
- All sub-objects are persisted together via `setDoc(settings, "websiteContent", { homepage: {…}, corporate: {…} }, { merge: true })` on a single "Save Content" button
- `KNOWN_CONTENT_ICONS` is a kebab-case string union exported from `shared/constants/index.ts` — the admin app renders a dropdown, the guest app's per-page `resolveIcon` helper maps each name to a `lucide-react` component
- `ContentItem` (the shape used by all four list editors) is exported from `shared/constants/index.ts` and used by both `ListEditorItem` in the admin and `usePublicSiteContent` in the guest app

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
- [ ] Admin-only — Front Desk records guest selections in the booking drawer but cannot manage the silog menu
- [ ] Source: `settings/breakfastConfig`

---

### 11. Store (`config.storeName` — "Spark Essentials" for Spark Inn)

- [ ] Enable/disable store globally — toggle
- [ ] Product catalog management — see `plan/features/STORE-MANAGEMENT.md §Catalog Management` for full checklist
- [x] **Store payment methods — managed only from Payment Methods**. See `§Store Payment Methods` below.
- [ ] Low stock threshold — number input (default 5)
- [ ] Admin-only — Front Desk processes store orders but cannot manage catalog/settings
- [ ] Source: `settings/storeConfig`

#### §Store Payment Methods

The store no longer owns a separate payment-method list. Settings → Payment Methods (`settings/hotelConfig.paymentMethods[]`) is the only edit surface for booking, in-room store, and corporate payment visibility.

**Effective list computation** — `getEffectiveStorePaymentMethods(hotelConfig.paymentMethods)` in `shared/utils/storePaymentMethods.ts`. The helper is called by the guest store checkout (`guest-app/src/pages/IntercomPage.tsx`) and the server-side `/api/store/create-order` handler (`guest-app/server/handlers/store.ts`).

The server reads `hotelConfig` inside the Firestore transaction so the allowlist stays in sync with any concurrent admin edits. Unknown `paymentMethod` keys are rejected with `PAYMENT_METHOD_DISABLED` (400).

**Proof of payment** — any non-`cod`/non-`add-to-bill` method requires a screenshot upload (mirrored on the server: `paymentProofUrl` is required for any such method). The client-side check uses an `isOnlinePaymentMethod()` helper that mirrors the server's check exactly.

**Store-only methods** — `cod` and `add-to-bill` are backfilled into `paymentMethods[]` if missing. They default to `isEnabled: false`, `showInStore: true`, and `showInCorporate: false`, so they appear in the store but not the regular booking or corporate personal-pay selectors. `add-to-bill` is protected from deletion because it powers the folio action.

**Source / persistence** — payment method visibility lives on `settings/hotelConfig.paymentMethods[]`. `settings/storeConfig` now only owns `isEnabled`, `lowStockThreshold`, and catalog-related store settings. Legacy `paymentMethods[]` / `useBookingPaymentMethods` fields may remain on old documents but are ignored by checkout.

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
- Payment methods: `plan/features/SETTINGS.md §2 Payment Methods` (this doc) — also referenced by `plan/features/RATE-MANAGEMENT.md` via the "Manage payment methods" deep link
- Auth guard (admin-only): `plan/features/AUTH-ROLES.md`
- Intercom usage: `plan/features/INTERCOM-INBOX.md`, `plan/features/INTERCOM-GUEST.md`
