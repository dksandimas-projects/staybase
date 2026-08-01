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

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## Tabs

### 1. Hotel Info

- [x] Address, support email, front-desk phone; hotel/brand name remains deploy-time in `hotel.config.ts`
- [x] Check-in time, check-out time
- [x] Facebook URL, Instagram URL, X handle
- [x] Mission statement, vision statement, and hotel story are managed only in Website Content → About Us
- [x] **Phase 11.8 PR 3 — Hotel Contact Details card**: address (single-line), front-desk phone, support email, DPO email, Facebook URL, Instagram URL, and X handle — all admin-editable runtime values. Missing fields fall back to white-label config; explicitly blank social fields hide their corresponding public icons. Renders through `usePublicSiteContent.contact.*`, including Facebook/Instagram/X in the Footer.
- [x] Save button
- [x] Source: `settings/hotelConfig` — `updateDoc` on save

---

### 2. Payment Methods

Fully dynamic CRUD for the booking payment list. The list rendered on `/book` Step 3 is sourced directly from `settings/hotelConfig.paymentMethods[]`, filtered to `isEnabled` — add / remove / reorder / toggle from this tab and the guest site reflects the change on the next snapshot tick. The previous per-method `accountInfo` text field and the separate `payAtHotelEnabled` global toggle have been replaced by structured `accountName` + `accountNumber` fields and a per-method `isEnabled` flag (so "Pay at Hotel" is just another method).

**Persistent callout (top of the tab)**

- [x] Amber callout listing the supported methods: **GCash, Maya, Bank Transfer (InstaPay), PayPal, Pay at Hotel** — and explicitly calling out **Pesonet as not supported** (batch-based with T+1 settlement, incompatible with instant booking confirmation). Not dismissible — it is policy, not a tip.
- [x] Helpers sourced from `SUPPORTED_PAYMENT_METHODS` in `shared/constants` (single source of truth).

**Method list**

- [x] One card per method: icon, label, method key pill, "Hidden" pill when disabled, "Unsupported" pill for Pesonet etc., enable toggle, edit (pencil), delete (trash, two-click confirm), up/down reorder arrows.
- [x] Disabled rows are dimmed and show a "Hidden" pill.
- [x] Empty state when `paymentMethods[]` is empty — CTA "Add payment method" with copy explaining why data is missing.
- [x] Reorder via up/down arrows (no full drag library — same pattern as Intercom quick requests). Up arrow disabled on the first row, down arrow disabled on the last.

**Add / Edit modal**

- [x] **Method key** (text) — unique identifier stored in `paymentMethod` on each booking. Lowercase letters, numbers, and hyphens only. Immutable after creation (renaming would break existing booking records).
- [x] **Label** (text) — display name shown to guests (e.g. "GCash", "Bank Transfer", "Pay at Hotel").
- [x] **Account name** (text) — recipient name shown beside the QR. Leave empty for "Pay at Hotel" or methods that don't need it.
- [x] **Account number** (text) — for PayPal, use the PayPal email address.
- [x] **Require reference number** (toggle, owner request 2026-07-09) — `requireReferenceNumber?: boolean`, **defaults to `true`** when missing (so existing methods behave as "required" without needing a migration, matching the surface-pill default pattern above). When on, the guest booking flow (`/book` Step 3) shows a required "Reference Number" text field alongside the payment proof screenshot upload for that method; when off, the field is hidden and not required. Intended for methods like Pay at Hotel/COD where a transaction reference doesn't exist — admin can flip it off per method rather than it being hardcoded to only the online methods.
- [x] **Enable toggle** — `isEnabled: boolean`; hidden methods are not shown to guests. Per #111, this is now the **regular-booking** surface switch (the leftmost of the three inline pills in the row).
- [x] **Per-method surface pills** (per #111) — three inline pill toggles in each row control which surfaces the method is offered on:
  - **Booking** (leftmost, the existing `isEnabled` toggle) — visibility on `/book` Step 3.
  - **Store** — visibility on the in-room store checkout (`/intercom/:roomId` Shop tab). Persists as `showInStore: boolean`. `cod` and `add-to-bill` are store-only entries backfilled into this same list; `pay-at-hotel` is excluded from the store because `add-to-bill` is the folio option.
  - **Corp** — visibility on the corporate booking personal-pay selector (`/corporate/book` Step 3). The company charge-back path is unaffected. Persists as `showInCorporate: boolean`.
  - All three default to `true` when missing (pre-#111 entries are treated as "visible on all surfaces" — no migration required). Tooltip on each pill explains the surface name.
  - **Front desk is a fourth consumer of the list, governed by no surface flag** (per WPM-03, 2026-07-31) — the walk-in modal + Record Payment + Verify & Record Payment all source from `onsitePaymentMethodOptions`, which deliberately ignores `isEnabled` so the desk can record a tender the hotel does not offer online. **Explicitly decided NOT to add a `showAtFrontDesk` pill** — over-restricting costs more than over-offering at the desk, and a fourth flag means a Settings UI change, a schema field, a migration-free default, and four more code paths reading it. Record as `DECISIONS-FEATURES.md #141`.
- [x] **QR uploader** (only on edit, not add — the new method's storage path requires a saved method key) — file input, preview, "Upload QR" / "Replace QR" / "Remove QR" buttons, status pill ("Custom override" / "No QR"), error inline. Uploads to `assets/payment-methods/{method}/{timestamp}-{filename}` in Firebase Storage. Accepts `image/png`, `image/jpeg`, `image/webp` (max 2 MB). Best-effort deletes the previous QR on replace.
- [x] **Pesonet warning** — inline warning when the typed method key matches `UNSUPPORTED_PAYMENT_METHODS` (case-insensitive). The Save button label flips to "I understand, save anyway" for 5 seconds; the second click persists. Schema is not hard-blocked — the friction is policy, not enforcement.
- [x] **Save / Cancel** — single "Save" button in the modal footer.

**Delete**

- [x] Two-click confirm: first click arms the button ("Tap again to confirm"), second click within 3 seconds executes. Auto-cancels after 3 seconds.
- [x] **Protected methods** — entries whose key is in `PROTECTED_PAYMENT_METHODS` (currently `["pay-at-hotel", "add-to-bill"]`) render NO delete button. A blue "Required" pill with a lock icon is shown next to the label instead. The underlying `deletePaymentMethod` in `AdminContext` also blocks deletion as a second line of defense, so a future code path cannot remove the entry either. `pay-at-hotel` is protected because walk-in creation, corporate inquiry conversion, and booking step-3 fallback depend on it. `add-to-bill` is protected because checkout folios and reports derive billed store charges from `storeOrders.paymentMethod === "add-to-bill"`. To remove the protection, edit `PROTECTED_PAYMENT_METHODS` in `shared/constants`.
- [x] **Block delete when bookings reference the method** — one-shot `getDocs(query(bookings, where("paymentMethod", "==", method), limit(1)))`. Toast surfaces the booking count and tells the admin to reassign or close those bookings first.
- [x] Best-effort cleanup of the method's QR files in Storage (`listAll` + `deleteObject` under `assets/payment-methods/{method}/`).

**Source / persistence**

- [x] All writes go through `setDoc(settings/hotelConfig, { paymentMethods: next }, { merge: true })` so the `onSnapshot` listener in `AdminContext` updates the UI in place.
- [x] The admin URL is `/settings?tab=payment` (deep link from `/rates` and the sidebar both work).
- [x] QR files are compressed client-side via `compressImageFile(file, { maxWidth: 800, maxHeight: 800, quality: 0.9, mimeType: "image/png" })` — PNG is critical because QR codes are sharp monochrome and JPEG artifacts destroy scannability. Maximum file size `MAX_PAYMENT_METHOD_QR_BYTES` (2 MB) enforced pre-compression with a clear error toast.
- [x] Source: `settings/hotelConfig.paymentMethods[]`. Storage path: `assets/payment-methods/{method}/{timestamp}-{filename}`.

**One-time read migrations (live idempotent code in `AdminContext`, each gated by a `useRef` to once per session)**

- [x] Legacy `bookingPaymentMethods` docs are reshaped on first snapshot: `accountInfo` splits into `accountName` (first line) + `accountNumber` (rest). The legacy key stays on the doc (merged `setDoc` can't remove fields; dead data is harmless).
- [x] **Protected-method backfill** — missing `PROTECTED_PAYMENT_METHODS` entries (currently `pay-at-hotel`, `add-to-bill`) are appended with sensible defaults and persisted. Only protected keys are backfilled — an admin who removed `maya`/`bank` keeps that decision. Extend via `BACKFILL_DEFAULTS` in `AdminContext.tsx` + `PROTECTED_PAYMENT_METHODS` in `shared/constants`.
- [x] **Staff-onsite-tender backfill** (per WPM-04, 2026-07-31) — `STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS` entries (currently `card`) are appended if missing. Same idempotent `useEffect` as the protected + store backfills. Not protected from deletion. The `card` method is backfilled because the walk-in modal sources its options from `paymentMethods[]` (WPM-01) and the hotel takes cards (CVQ-07); without the backfill the desk silently loses the "Onsite Card Reader" option on the day WPM lands. Historical `card` bookings still render via `LEGACY_ONSITE_PAYMENT_METHOD_LABELS` without the backfill.

**See also**

- Schema: `plan/docs/TYPES.md §PaymentMethodConfig` and `plan/docs/BACKEND.md §settings/hotelConfig`.
- Storage rule: `firebase/storage.rules` `match /assets/payment-methods/{method}/{fileName}` (public read, staff write).
- Constants: `SUPPORTED_PAYMENT_METHODS`, `UNSUPPORTED_PAYMENT_METHODS`, and `PROTECTED_PAYMENT_METHODS` exported from `shared/constants`.

---

### 2A. Booking Sources (NBS-04)

Admin-only CRUD for `settings/hotelConfig.bookingSources[]`, the shared list used by New Booking, booking filters, and acquisition reports.

- [x] Deep link: `/settings?tab=sources`; available in the mobile tab strip and desktop navigation.
- [x] One responsive card per source with label, immutable key, enabled status, and front-desk visibility.
- [x] Add/Edit modal validates a unique lowercase key (`a-z`, `0-9`, hyphens) and a required display label.
- [x] Custom sources can be enabled/disabled, shown/hidden in New Booking, reordered, edited, or deleted.
- [x] `online`, `walk-in`, and `corporate` show a **Required** pill, cannot be deleted, and cannot be made front-desk-selectable because server workflows assign them.
- [x] Delete uses a two-click three-second confirmation. The data layer also blocks deletion when existing bookings reference the source.
- [x] Every mutation uses the existing full-array `persistBookingSources` write. Failed writes roll optimistic state back and surface a plain-language toast.
- [x] Controls are at least 44px high; the shared `Modal` supplies mobile-sheet layout, focus trapping, reduced-motion handling, and safe-area footer spacing.
- [x] Source: `settings/hotelConfig.bookingSources[]`; seed and protected keys live in `shared/constants`.

---

### 3. Email

- [x] From email address (Resend sender — `sparkinn.dev@gmail.com`)
- [x] Admin notification email (for new corporate inquiries)
- [x] Complete preview catalog for all 22 server-side templates, grouped into Bookings & Payments, Requests & Promotions, In-room Store, and Staff Alerts
- [x] Every template card has an accessible 44px preview action and renders against safe mock data; the catalog includes payment rejection, public-form confirmations, voucher delivery, the full store lifecycle, and staff alerts
- [x] Source: `api/.env` — note to admin: "Email settings require a code deploy to change"
- [x] These fields may be read-only in UI if managed via env vars

---

### 4. Staff Accounts

- [x] List of all staff accounts (name, email, role, date created)
- [x] Create staff account form — email, display name, role (Front Desk / Admin), temporary password
- [x] Disable / enable staff account toggle
- [x] Delete staff account (with confirmation modal)
- [x] Admin-only — front desk cannot see or access this tab
- [x] Account creation uses Firebase Admin SDK via API route — not client-side `createUserWithEmailAndPassword`
- [x] Edit staff account details — name, email, phone, and role via a dedicated edit modal
- [x] Reset staff password — support setting new password directly or triggering standard password reset email link
- [x] Update staff account endpoint uses Vercel API route `/api/admin/update-staff` with transactional consistency and auth rollback on failure

---

### 5. Discount Rules

- [x] Senior Citizen discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [x] PWD discount: 20% — displayed as read-only with note "OSCA-mandated, not editable"
- [x] Note: "ID is verified physically at check-in — this discount is applied on guest's honor at booking."

---

### 6. Vouchers

- [x] Voucher campaign management lives on the admin-only Rates page — see `plan/features/VOUCHERS.md §Admin UI Checklist`
- [x] Front Desk cannot access voucher campaign management from Settings

---

### 7. Intercom

- [x] Quick request items list — current items with edit/delete per item
- [x] Add quick request item — text input + Add button (e.g. "Extra Towels")
- [x] Reorder items — drag or up/down arrows
- [x] Notification sound — upload audio file to Firebase Storage, URL stored in `settings/hotelConfig.notificationSoundUrl`
- [x] Audio preview button — play the current notification sound
- [x] Source: `settings/hotelConfig.intercomQuickRequests[]` + `notificationSoundUrl`

---

### 8. Branding

The single edit surface for everything the guest sees at the top of every public page: per-page hero photos, per-page hero copy, and the three logo overrides (navbar solid, navbar over hero, footer). Changes reflect on the guest site in real-time via the `usePublicSiteContent` listener.

**Hero Photos** (upload + preview + reset-to-default per page):
- [x] **Homepage hero photo** — full-bleed background for `/`. Recommended 1920x1080.
- [x] **About hero photo** — top of `/about`. Recommended 1920x600.
- [x] **Corporate hero photo** — top of `/corporate`. Recommended 1920x1080.
- [x] **Rewards hero photo** — top of `/rewards`. Recommended 1920x1080.
- [x] Per row: thumbnail preview (custom override or deploy-time fallback), "Upload" / "Replace" button, "Reset to default" button (only when an override is set), and a status pill ("Custom override" / "Using default").
- [x] Compressed client-side via `compressImageFile` (max 1920x1080 for full-bleed, 1920x600 for about, 600x200 for logos; JPEG @ 0.85 quality).
- [x] Uploaded to Firebase Storage at `assets/branding/<key-as-path>/<timestamp>-<filename>` (e.g. `assets/branding/homepage/heroPhotoUrl/...`).
- [x] Download URL written to `settings/websiteContent` via merged `setDoc`.

**Hero Copy** (text inputs grouped by page, one "Save Hero Copy" button at the bottom):
- [x] Homepage — eyebrow + heading + subtext (per Phase 11.8 PR 1, the eyebrow overrides `config.tagline`; falls back to `config.tagline` on the public site when empty)
- [x] About — eyebrow + heading + subtext (per Phase 11.8 PR 1, the eyebrow overrides the page's hard-coded "Our Story" pill and the subtext overrides the page's deploy-time "Discover the vision and heart behind {config.brandName}…" line)
- [x] Corporate — eyebrow + heading + subtext
- [x] Rewards — eyebrow pill (e.g. "Loyalty Program") + heading + subtext
- [x] Helper text under the rewards eyebrow: "Renders as '{config.rewardsName} {rewards.heroEyebrow}' in the pill."
- [x] Helper text under the homepage eyebrow: "Optional override of the deploy-time tagline. Leave blank to use the white-label config."

**Logo Overrides** (upload + preview + reset-to-default per variant):
- [x] **Navbar logo (solid background)** — used in the sticky/scrolled state and on every non-hero page. Colored version on a light background.
- [x] **Navbar logo (over hero, dark background)** — use a light/white version for visibility over the dark hero photo. This is the variant that fixes the dark-on-dark logo bug in the over-hero state.
- [x] **Footer logo** — white version for the dark sidebar footer.
- [x] Helper text: "If you only upload one variant it's mirrored across both states."
- [x] Fallback chain: custom URL → `hotel.config.ts → logos.*` (deploy-time static file in `public/brand/`).
- [x] Navbar selection: when `solid === true` (scrolled, non-hero page) use `logoNavbar`; when `solid === false` (over hero, transparent) use `logoNavbarOnDark` — or fall back to whichever variant the admin uploaded.

**Edge cases & behaviors:**
- [x] Photo upload fails — show error inline under the uploader, leave existing override intact
- [x] Reset button only visible when an override is set
- [x] Reset writes empty string to Firestore + best-effort deletes the Storage object
- [x] Hero eyebrow on homepage is editable as of Phase 11.8 PR 1 — it overrides the deploy-time `config.tagline` (W3.10 design intent is preserved via the safe-default `pickString` chain in `usePublicSiteContent.ts`)
- [x] All uploads require Admin role (Storage rule `match /assets/branding/{fileName}` is `isStaff`; the page itself is admin-only by the sidebar guard)
- [x] Edits reflect on a parallel guest tab in real time via the cross-tab bust mechanism (`bustPublicSiteContentCache` writes `localStorage["publicSiteContent:bust"]`; the public hook subscribes to the `storage` event and refetches). Same-browser demos see updates within ~200 ms; cross-device updates still rely on the 5-minute TTL.

Source: `settings/websiteContent` — `setDoc` on save (copy fields) or per-upload merged `setDoc` (photos + logos).

---

### 9. Website Content

List-shaped editable content for the public homepage. Hero copy + photos were moved to the Branding tab. This tab is organized into four sub-sections, each with its own editor and a single "Save Content" button at the bottom that persists all four at once.

**Homepage Amenities** (four-up grid)
- [x] Add / remove / reorder the amenity cards. Each row: title, description, icon name (dropdown of `KNOWN_CONTENT_ICONS` from `shared/constants`), isEnabled toggle
- [x] Disabled items are hidden from the guest site but stay in the data so the order is preserved
- [x] Default items pre-seeded: "Consistent comfort", "Easy city access", "Warm front desk care"
- [x] Source: `settings/websiteContent.homepage.amenities`

**Featured Room Types** (up to 3 on the "Stay with us" section)
- [x] Two-pane selector: available room types on the left, featured types on the right
- [x] Each row in the left pane shows the type label + the count of *active* rooms of that type. Types with zero active rooms are grayed out and can't be added (no card would render anyway)
- [x] Each row in the right pane shows the type label + active-room count + a position number badge (the order here is the render order on the public site)
- [x] Add / remove / reorder (up/down) the picked list; capped at `MAX_FEATURED_TYPES = 3` (renamed from the old `MAX_FEATURED_ROOMS = 3` alias which is kept for the migration window)
- [x] When the picked list is empty the guest site falls back to the first `MAX_FEATURED_TYPES` *distinct* types that have at least one active room (NOT raw room IDs — that was the bug the type-driven model fixes)
- [x] The card content (image, bed, amenities, capacity, price, description) all comes from the room TYPE via `roomTypes[value]` — the picked physical room is only used for the `key` and the Book Now deep link
- [x] A picked type that has no active rooms is silently skipped (no empty card)
- [x] Source: `settings/websiteContent.homepage.featuredTypeValues`

**Legacy `featuredRoomIds` migration (live read-migration in `AdminContext.mergeWebsiteContent`)** — docs still carrying the old per-room `featuredRoomIds` (and no `featuredTypeValues`) are mapped id → room type, deduped, and returned as the new field; the next admin save persists it. Guest localStorage cache key is `publicSiteContent:v2` so pre-migration cached entries are ignored.

**Homepage Services** (two-up service cards)
- [x] Add / remove / reorder the service cards. Each row: title, description, icon, isEnabled toggle
- [x] CTA is always "Contact us" → `/contact` and is not editable
- [x] Default items pre-seeded: "Tour Packages", "Car Rentals"
- [x] Source: `settings/websiteContent.homepage.services`

**Spark Rewards Promo** (the dark promo block on the homepage)
- [x] Enable / disable the entire block — global toggle. Block hides entirely when disabled
- [x] Heading + description (one-line marketing copy)
- [x] Perks list — add / remove / reorder perks. Each row: title, description, icon, isEnabled toggle. Disabled perks stay in the data so the order is preserved
- [x] Default items pre-seeded: "Earn points on completed stays", "Member-only stay offers", "Request early check-in"
- [x] Source: `settings/websiteContent.homepage.sparkRewards`

**Corporate page** (everything on `/corporate` other than the hero, which lives on the Branding tab)
- [x] **Perks grid** — add / remove / reorder perks shown in the three-up grid on the corporate page. Each row: title, description, icon (from `KNOWN_CONTENT_ICONS`), isEnabled toggle. Disabled perks stay in the data so the order is preserved
- [x] Default perks pre-seeded from `DEFAULT_CORPORATE_PERKS` in `@spark-inn/shared` (6 entries: Negotiated Rates, Group Bookings, Dedicated Support, High-Speed Wi-Fi, Premium Security, Flexible Bookings) — same source as the guest-app fallback
- [x] **Rooms overview** — eyebrow + heading + subtext shown above the room type cards. Empty fields fall back to `DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview` in `@spark-inn/shared`
- [x] **Retreat CTA banner** — heading + description + button label for the orange banner between the rooms overview and the inquiry form. Empty fields fall back to `DEFAULT_CORPORATE_PAGE_CONTENT.retreat`. Button target (the inquiry form) is not editable
- [x] **Auto-population** — the admin editor's state is pre-populated from `DEFAULT_CORPORATE_PAGE_CONTENT` whenever the corresponding Firestore field is empty, so the admin sees the current text in the inputs (no need to retype). On first admin load, a one-time backfill in `AdminContext` writes any empty `corporate.*` TEXT field (9 fields: hero eyebrow/heading/subtext + rooms overview eyebrow/heading/description + retreat heading/description/ctaLabel) to Firestore so the public site locks to the same copy the deploy-time fallback provides. The backfill is gated by a `useRef` so it runs at most once per session, and it is idempotent — subsequent loads short-circuit because every field is already populated. **`corporate.heroPhotoUrl` is intentionally NOT backfilled** — the guest app's `pickString` falls back to the static `corporateHeroImage` in `data/homepage.ts` when the field is empty, so persisting the default URL would (a) undo the admin's Reset action on the next dashboard load, and (b) freeze the hero image to the URL that existed at first load, preventing future edits to `corporateHeroImage` from reaching the public site
- [x] Source: `settings/websiteContent.corporate.{perks[], roomsOverview{Eyebrow,Heading,Description}, retreat{Heading,Description,CtaLabel}}`

**About Us page** (everything on `/about` other than the hero, which lives on the Branding tab)
- [x] **Mission statement** — text shown in the mission card.
- [x] **Vision statement** — text shown in the vision card.
- [x] **Hotel story** — long-form body copy shown in the story section. Blank lines split into paragraphs on the public page.
- [x] Empty fields fall back directly to deploy-time safe defaults; there is no second editable copy in `settings/hotelConfig`.
- [x] Source: `settings/websiteContent.about.{missionStatement,visionStatement,hotelStory}`

**Our Rooms / Contact Us:**
- [x] Note: "Room content managed in Room Management. Contact details managed in Hotel Info."

**Implementation notes:**
- The editors use two reusable components: `ListEditor` (homepage amenities, homepage services, Spark Rewards perks, corporate perks) and `TypePicker` (featured room types). Both live in `admin-app/src/components/`
- All sub-objects are persisted together via `setDoc(settings, "websiteContent", { homepage: {…}, corporate: {…} }, { merge: true })` on a single "Save Content" button
- `KNOWN_CONTENT_ICONS` is a kebab-case string union exported from `shared/constants/index.ts` — the admin app renders a dropdown, the guest app's per-page `resolveIcon` helper maps each name to a `lucide-react` component
- `ContentItem` (the shape used by all four list editors) is exported from `shared/constants/index.ts` and used by both `ListEditorItem` in the admin and `usePublicSiteContent` in the guest app

Source: `settings/websiteContent` — `setDoc` on save per section.

**Room Types & Room Type Photos** *(cross-reference — lives on the Room Types tab, not here)* — per W3.5/W3.6/W3.7, the room type entry owns its `imageUrls[]` gallery, rate matrix, `maxCapacity`, `bedDefinition`, `description`, and `amenities`. The Settings → Room Types table is the single edit surface (Add/Edit capture every type field; the Photos modal handles the gallery — max `MAX_ROOM_TYPE_PHOTOS` = 10, stored at `room-types/{typeValue}/{filename}`, public read / staff write). The Rates tab remains for bulk rate review. Rooms inherit all type properties by joining `Room.type` at read time. Source: `settings/hotelConfig.roomTypes[]`.

**Extra bed fields on the type entry (EXB-01):** the Add/Edit modal includes:
- **Max extra beds** (numeric, `0..99`) — `0` means the type does not allow extra beds (a booking with `extraBedCount > 0` is rejected server-side with a 400). Defaults to `0` for legacy types that pre-date EXB-01 — back-compat with the historical "no extra bed" shape.
- **Extra bed rate** (numeric, `>= 0`, prefixed with `config.currencySymbol`) — per-bed-per-night rate, snapshotted onto the booking doc at create time. `0` is allowed (free extra bed — rare but the schema permits it; the helper short-circuits to 0 anyway). The two fields are additively independent of the rate matrix (a type with a high `extraBedRate` doesn't change `pricePerNight`).

**Hotel-wide bed inventory (EXB-10, decision #157):** `settings/hotelConfig.extraBedInventory` is the hotel-wide rollaway-bed count; `0` or absent means no constraint. The admin data model currently defaults it to `0`, but Settings does not yet expose an editor. Positive configured values are enforced transactionally by booking creation, walk-in creation, and rescheduling. See `plan/features/BOOKING-FLOW.md §Extra Bed`.

**Delete behavior (per RTS-04 / RTS-05 / RTS-06, 2026-07-31):**
- [x] **Two-click confirm** — first click arms the Delete button ("Click to confirm"); second click within 3 seconds executes. The 3-second timer auto-disarms (RTS-05 candidate; cheap follow-up is the existing `ConfirmForm` primitive from Phase 11.7, deferred — not the active user-visible bug at the time of fix).
- [x] **Failure propagates** — `saveRoomTypes` checks the boolean return of `updateSettings`, throws on failure, and rolls back the optimistic `setRoomTypes` so a failed Firestore write no longer looks successful. `handleDeleteRoomType` already wraps the call in try/catch and surfaces its own error toast, so the new throw lands safely at the UI surface.
- [x] **Empty array is a legitimate state** — the `roomTypes` sync effect in `AdminContext` distinguishes "not loaded yet" from "loaded and legitimately empty" (RTS-06 candidate; deferred — not the active user-visible bug at the time of fix).
- [x] **Single-batch write contract** — Add / Edit / Delete / photo upload / photo remove / photo reorder all flow through the same `saveRoomTypes` primitive the Rates matrix uses, so a future multi-type writer cannot accidentally fan out per-item writes and race on the shared `roomTypes[]` field. See `plan/docs/GOTCHAS.md` Firebase section.

---

### 10. Breakfast

- [x] Enable/disable breakfast add-on globally — toggle
- [x] Silog menu management — list of items with edit/delete per item
- [x] Add silog item — name input + Add button (e.g. "Tapsilog", "Longsilog", "Tocilog", "Bangsilog")
- [x] Enable/disable individual silog items — hidden from booking flow and registration form when inactive
- [x] Note: "Breakfast rate is set in Rate Management"
- [x] Admin-only — Front Desk records guest selections in the booking drawer but cannot manage the silog menu
- [x] Source: `settings/breakfastConfig`

---

### 11. Store (`config.storeName` — "Spark Essentials" for Spark Inn)

- [x] Enable/disable store globally — toggle
- [x] Product catalog management — see `plan/features/STORE-MANAGEMENT.md §Catalog Management` for full checklist
- [x] **Store payment methods — managed only from Payment Methods**. See `§Store Payment Methods` below.
- [x] Low stock threshold — number input (default 5)
- [x] Admin-only — Front Desk processes store orders but cannot manage catalog/settings
- [x] Source: `settings/storeConfig`

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
- [x] Enable/disable points earning globally — toggle (`settings/rewardsConfig.pointsEnabled`)
- [x] Earning mode selector — "Per Booking (flat)" or "Per ₱ Spent"
  - [x] **Per Booking (flat):** number input — "Points per booking" (e.g. 50 pts per completed stay)
  - [x] **Per ₱ Spent:** number input — "Points per ₱100 spent" (e.g. 1 pt per ₱100 of booking total)
- [x] When disabled — points balance still visible to members but no new points awarded; My Rewards page hides points earning info and shows "Points earning is currently unavailable"

**Member Discount**
- [x] Enable/disable member discount — toggle (`settings/rewardsConfig.memberDiscountEnabled`)
- [x] Discount percentage input — shown only when enabled (e.g. 10%)
- [x] Discount applies automatically at booking Step 1 for logged-in members — shown as "Member Rate"
- [x] When disabled — no discount shown, no auto-apply; My Rewards page hides discount badge

**Points Redemption**
- [x] Redemption rate input — "₱ value per 100 points" (e.g. `100` = 100 pts gives ₱100 off; `50` = 100 pts gives ₱50 off)
- [x] Helper text shown below input: "e.g. at ₱100/100pts, a member with 500 points can get ₱500 off a booking"
- [x] Note: "Points redemption is applied manually by staff from the booking detail drawer — guests cannot redeem online"
- [x] Source: `settings/rewardsConfig.pointsRedemptionRate`

**Early Check-In Perk**
- [x] Display note: "Early check-in request is always available to members — not configurable"

**Program Info (visible on guest-facing rewards pages)**
- [x] Program name — deploy-time `config.rewardsName`, not duplicated in runtime settings
- [x] Marketing heading/tagline — managed only in Website Content → Spark Rewards Promo
- [x] Source: `hotel.config.ts` for identity; `settings/websiteContent.homepage.sparkRewards` for marketing copy

- [x] Source: `settings/rewardsConfig` — `updateDoc` on save
- [x] Admin-only — front desk cannot access this tab

---

### 13. Legal Content

Editable by hotel admin — no redeploy required. Changes reflect on guest site immediately.

- [x] Privacy Policy body — textarea (plain text or light markdown), saved to `settings/websiteContent.privacyPolicyBody`
- [x] Cancellation Policy — textarea, saved to `settings/websiteContent.cancellationPolicy`; displayed at booking Step 3 and in confirmation emails
- [x] House Rules — textarea, saved to `settings/websiteContent.houseRules`; used in guest registration PDF at check-in
- [x] "Last Updated" date for Privacy Policy — auto-set to current date on save
- [x] Note to admin: "Some legal fields (legal name, DPO email, applicable law) are set at deployment and require DK to update."

### 14. SEO & Search

Admin-only editor for crawler-facing metadata. SEO-only fields can be saved as a draft without changing the public site: default meta description (50–160 characters), relative price category, and a social preview image uploader with live preview, replace, and reset-to-default controls. The X handle is managed with the other social accounts in Hotel Settings. The uploader accepts images, compresses them to fit within 1200×630, stores them under `assets/seo/og-image/`, and saves the public HTTPS download URL in the draft. Publishing validates the draft, snapshots the current Hotel Settings address, front-desk phone, Facebook/Instagram URLs, X handle, and check-in/out times into `settings/seo.published`, then calls the server-side Vercel deploy hook. The rebuilt guest app reads that published snapshot during the Vite build and generates static meta tags and Hotel JSON-LD. If Firestore is unavailable or no published snapshot exists, `hotel.config.ts` remains the safe fallback. The deploy-hook URL is server-only and must never be stored in Firestore or exposed through a `VITE_` variable.

Saving Hotel Settings compares the schema-relevant operational fields with the last published snapshot. When they differ, it sets `settings/seo.sourceChangesPending`, adds a marker to the SEO & Search tab, shows a save notification directing the admin to publish, and keeps a warning in the SEO panel across sessions. A successful deploy-hook request clears the pending marker; a failed request leaves it active.

### 15. Environment Testing and Staging Reset

Admin-only tab. Test-run creation, close, and run-scoped cleanup are the normal tools for repeatable testing (TEST DATA badges, active-run banner, manifest-confirmed deletion). **Reset Operational Data** is the broader staging-only clean-slate operation — server-allowlisted by `STAGING_ALLOWLIST_PROJECT_IDS`, admin-re-validated, typed double confirmation (`RESET STAGING` + exact project ID), preview-manifest-bound execution, atomic job lock with resumable checkpoints, fail-closed integrity scan, and durable audit record. Production never renders the execute action; production Settings links to staging instead.

The hardening checklist and first-use fixture/injected-failure drill (ETR-S01..S15) completed 2026-07-16. Full shipped contract, open spec (production→staging refresh, Restricted Diagnostic Mode, pre-live production reset), and the current execution-gate caveat: `plan/features/ENVIRONMENT-TEST-RESET.md` — that file is the single source of truth for this tab's behavior; do not restate it here.

---

## Data & Logic Checklist

- [x] All settings tabs fetch from `settings/hotelConfig` or `settings/websiteContent` on mount
- [x] Photo uploads: Firebase Storage → `getDownloadURL` → store URL in Firestore
- [x] Staff account creation: POST to `/api/admin/create-staff` (Vercel API route using Firebase Admin SDK)
- [x] Staff account disable: POST to `/api/admin/disable-staff`
- [x] Website content changes: `setDoc` (merge) on `settings/websiteContent`
- [x] Hotel info changes: `updateDoc` on `settings/hotelConfig`

## Edge Cases & States

- [x] Loading state per tab — skeleton while fetching
- [x] Save fails — show error, preserve unsaved changes
- [x] Photo upload fails — show error per upload
- [x] Staff creation: email already in use — show clear error
- [x] Deleting last admin account — prevent with error message

## Manual QA

- [x] Update hotel name in Hotel Info — change reflects in guest site footer
- [x] Add payment method with QR — appears in guest booking flow Step 3
- [x] Disable payment method — disappears from guest booking flow
- [x] Create front desk account — can log in and access dashboard
- [x] Admin account cannot be deleted if it's the only admin
- [x] Add quick request item — appears in guest intercom quick request panel
- [x] Upload notification sound — plays in intercom inbox when new message arrives
- [x] Update homepage hero heading — change reflects on guest homepage
- [x] Change featured rooms — guest homepage shows updated 3 rooms

## References

- Hotel config schema: `plan/docs/BACKEND.md §settings/hotelConfig`
- Website content schema: `plan/docs/BACKEND.md §settings/websiteContent`
- Voucher management: `plan/features/VOUCHERS.md`
- Payment methods: `plan/features/SETTINGS.md §2 Payment Methods` (this doc) — also referenced by `plan/features/RATE-MANAGEMENT.md` via the "Manage payment methods" deep link
- Auth guard (admin-only): `plan/features/AUTH-ROLES.md`
- Intercom usage: `plan/features/INTERCOM-INBOX.md`, `plan/features/INTERCOM-GUEST.md`
