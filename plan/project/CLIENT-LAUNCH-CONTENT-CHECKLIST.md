# Production Launch — Client Content Update Checklist

> **Audience:** the hotel client (or DK on the client's behalf) — the operator who has to load everything the system needs into the admin app before the public site goes live.
>
> **Where it lives in the codebase:** everything on this list maps to an existing Settings tab, an existing Firestore collection, or a `hotel.config.ts` field. Nothing on this list requires a code change.
>
> **Companion docs:**
> - `plan/project/DEPLOY.md` — staging → production cutover (DK / engineering work)
> - `plan/project/AUDIT-LAUNCH-READINESS-2026-07-07.md` — code-side launch audit (DK / engineering work)
> - `plan/project/AUDIT-PUBLIC-CONTENT-2026-07-01.md` — every string that ships hardcoded vs. every string the admin can already edit (use it to know which "missing" copy blocks launch)
>
> **Legend:**
> - 🟢 = editable from **Admin app → Settings** (no redeploy needed)
> - 🟡 = lives in **`hotel.config.ts`** (requires a redeploy, but DK can do it during the staging cutover)
> - 🔴 = hardcoded in code (Phase 1 scope: we ship it as-is; client cannot edit it pre-launch)
>
> **Default status convention:** all items unchecked. Anything checked off but not yet in production = still open.

---

## 0. Pre-flight — Read First

Before you start filling things in, open the staging admin and click through every tab once. Anything that says "(unset)" or shows a fallback image is something on this list. Staging is already populated with Spark Inn Bohol defaults — **verify each default against the actual hotel** before approving it.

| # | Item | Status |
|---|---|---|
| 0.1 | Admin URL reachable + owner can log in (Settings → all tabs render without errors) | ☐ |
| 0.2 | Hotel owner has signed off on the **production launch date** + a 1-hour buffer before/after for any DNS or cron surprises | ☐ |
| 0.3 | DK has confirmed staging data can be **cloned to a fresh production Firebase project** (or whatever the cutover plan is for this client) | ☐ |
| 0.4 | One person is the **owner of this checklist** — sign every section before moving on, don't half-fill four tabs | ☐ |

---

## 1. Brand Identity (deploy-time + first-session overrides)

> **Source:** `hotel.config.ts` for the static files; **Settings → Branding** for runtime logo overrides.
>
> **Owner:** DK supplies the source files; the client signs off on the final picks.

| # | Item | Type | Where | Status |
|---|---|---|---|---|
| 1.1 | Brand name (exact casing — appears in every page header, footer, email, and chatbot) | 🟡 | `hotel.config.ts → brandName` | ☐ |
| 1.2 | Legal business name (receipts, privacy policy, terms of service footer) | 🟡 | `hotel.config.ts → legalName` | ☐ |
| 1.3 | Tagline (homepage hero eyebrow, meta descriptions) | 🟡 | `hotel.config.ts → tagline` | ☐ |
| 1.4 | Brand promise ("Our Promise" banner on About page + footer tagline area) | 🟡 | `hotel.config.ts → brandPromise` | ☐ |
| 1.5 | Standard logo (stacked lockup — fallback everywhere) | 🟡 | `public/brand/FINAL LOGO.png` + `hotel.config.ts → logos.standard` | ☐ |
| 1.6 | White logo (footer + dark navbar) | 🟡 | `public/brand/FINAL LOGO-white.png` + `hotel.config.ts → logos.white` | ☐ |
| 1.7 | Navbar/horizontal logo | 🟡 | `public/brand/nav-bar-logo.png` + `hotel.config.ts → logos.navbar` | ☐ |
| 1.8 | Icon-only logo (favicon-safe) | 🟡 | `public/brand/ICON LOGO.png` + `hotel.config.ts → logos.icon` | ☐ |
| 1.9 | Wordmark-only logo | 🟡 | `public/brand/TEXT LOGO.png` + `hotel.config.ts → logos.wordmark` | ☐ |
| 1.10 | Favicon (`favicon/favicon.ico` + the `.png` variants in `favicon/`) | 🟡 | `public/brand/favicon/` + `hotel.config.ts → favicon` | ☐ |
| 1.11 | Open Graph share image (1200×630px, branded) | 🟡 | `public/brand/og-image.png` + `hotel.config.ts → ogImage` | ☐ |
| 1.12 | Optional: navbar logo override on dark hero (if the colored logo doesn't read well over the hero photo) | 🟢 | Settings → Branding → Logo Overrides | ☐ |
| 1.13 | Optional: white logo override for the footer | 🟢 | Settings → Branding → Logo Overrides | ☐ |
| 1.14 | Heading font files + license (OTF/TTF/WOFF2 — required for Apollo or any custom heading face) | 🟡 | `public/brand/fonts/` + `hotel.config.ts → fonts.heading.files` | ☐ |
| 1.15 | Body font name (Google Fonts family name, or local file path) | 🟡 | `hotel.config.ts → fonts.body` | ☐ |
| 1.16 | Primary color hex (CTAs, accent badges, member card border) | 🟡 | `hotel.config.ts → colors.primary` | ☐ |
| 1.17 | Primary dark (hover state) | 🟡 | `hotel.config.ts → colors.primaryDark` | ☐ |
| 1.18 | Primary light (tinted backgrounds — featured room cards, hero overlays) | 🟡 | `hotel.config.ts → colors.primaryLight` | ☐ |
| 1.19 | Section bg (alternating section background — homepage services, amenities) | 🟡 | `hotel.config.ts → colors.sectionBg` | ☐ |
| 1.20 | Sidebar (admin dashboard left nav background) | 🟡 | `hotel.config.ts → colors.sidebar` | ☐ |
| 1.21 | **QA:** Open `/` on phone + desktop — logo reads correctly on the white navbar (scroll past hero) and over the dark hero photo (both states). Header size, footer alignment, brand name spelling. | — | — | ☐ |

---

## 2. Hotel Information (Settings → Hotel)

> **Source:** `settings/hotelConfig` (Hotel tab in admin). Drives the JSON-LD `LodgingBusiness` schema on every page, the `/contact` page, the `+tel:` button, and every footer.

| # | Item | Where | Status |
|---|---|---|---|
| 2.1 | Hotel name (display) | Settings → Hotel → Hotel Info | ☐ |
| 2.2 | Street address (e.g. "J. Borja St") | Settings → Hotel → Address | ☐ |
| 2.3 | City | Settings → Hotel → Address | ☐ |
| 2.4 | Region / Province / State | Settings → Hotel → Address | ☐ |
| 2.5 | Postal code | Settings → Hotel → Address | ☐ |
| 2.6 | Front-desk phone (24/7 line that guests can call) — `tel:` link on Contact + footer + JSON-LD | Settings → Hotel → Contact Phone | ☐ |
| 2.7 | Support email (general inbox shown on `/privacy`, `/terms`, footer) | Settings → Hotel → Contact Email | ☐ |
| 2.8 | DPO / Data Protection Officer email (privacy policy + RA 10173 compliance) | Settings → Hotel → DPO Email | ☐ |
| 2.9 | Check-in time (e.g. "14:00") — booking confirmation, guest registration PDF | Settings → Hotel → Check-in | ☐ |
| 2.10 | Check-out time (e.g. "12:00") — booking confirmation, guest registration PDF | Settings → Hotel → Check-out | ☐ |
| 2.11 | Facebook page URL | Settings → Hotel → Facebook | ☐ |
| 2.12 | Instagram URL | Settings → Hotel → Instagram | ☐ |
| 2.13 | X / Twitter handle (optional — leave blank to omit) | Settings → Hotel → Twitter | ☐ |
| 2.14 | WhatsApp number (optional — leave blank to omit the icon) | `hotel.config.ts → whatsappNumber` | ☐ |
| 2.15 | Google Maps address matches the address fields above exactly | Google Maps embed on `/` + `/contact` | ☐ |
| 2.16 | Google Maps embedded iframe URL on `/` and `/contact` (in `data/homepage.ts`) | `guest-app/src/data/homepage.ts` → `homepageMapEmbedUrl` | ☐ |
| 2.17 | Optional admin notification email — the staff inbox that receives failed-email alerts, refund review alerts, and corporate inquiries (NOT the public `supportEmail`) | Server env var `ADMIN_NOTIFICATION_EMAIL` | ☐ |
| 2.18 | **QA:** Google search for the hotel name → result shows correct address + phone + map pin | — | ☐ |
| 2.19 | **QA:** Tap the phone number on mobile → opens the dialer with the right number (no spaces, correct country code) | — | ☐ |
| 2.20 | **QA:** Tap the email on mobile → opens a mail compose with the right address | — | ☐ |

---

## 3. Room Inventory (Settings → Room Types + Room Management)

> **Source:** Room types (catalog + rates + bed/amenities + photos) live in `settings/hotelConfig.roomTypes[]` (W3.6 + W3.7). Physical rooms live in the `rooms/` collection.
>
> **This is the most time-consuming section of the checklist.** Plan a half-day with whoever is supplying photos.

### 3.1 Room Types (Settings → Room Types)

| # | Item | Where | Status |
|---|---|---|---|
| 3.1.1 | One entry per distinct room type (e.g. Single, Standard Double, Standard Twin, Executive, Family) | Settings → Room Types | ☐ |
| 3.1.2 | `value` slug (internal key — kebab-case, no spaces; matches existing booking refs in Firestore) | per type | ☐ |
| 3.1.3 | `label` — guest-facing display name (e.g. "Deluxe Sea View") | per type | ☐ |
| 3.1.4 | `shortLabel` — for chips and badges (e.g. "Deluxe") | per type | ☐ |
| 3.1.5 | `maxCapacity` adults (NOT total occupancy — adults and children are tracked independently) | per type | ☐ |
| 3.1.6 | `maxChildren` per room (CHD-02) | per type | ☐ |
| 3.1.7 | `maxExtraBeds` (EXB-01..10) — 0 if the type doesn't support extra beds | per type | ☐ |
| 3.1.8 | `bedDefinition` (e.g. "1 queen size bed") | per type | ☐ |
| 3.1.9 | `description` — 1-paragraph marketing copy that all rooms of this type share | per type | ☐ |
| 3.1.10 | `amenities` — comma-separated list | per type | ☐ |
| 3.1.11 | `pricePerNight` — base rate (default applies to any night that isn't weekend or seasonal) | per type | ☐ |
| 3.1.12 | `weekendRate` — Saturday or Sunday nights (per `RATE-MANAGEMENT.md` §Weekend rate logic) | per type | ☐ |
| 3.1.13 | `corporateRate` — flat rate displayed at `/corporate/book` (note: negotiated codes override this) | per type | ☐ |
| 3.1.14 | `extraBedRate` per bed per night (EXB-01..10) | per type | ☐ |
| 3.1.15 | **5–10 photos per type** — landscape, ≥1920×1080, JPEG ≤500KB each, all rooms of a type share the same gallery (max 10 photos per type, per MRB-15-11) | Settings → Room Types → Photos | ☐ |
| 3.1.16 | Hero image (the first photo in the gallery) is the strongest marketing shot | first photo per type | ☐ |
| 3.1.17 | Room type shows up on `/rooms` with the correct label, image, price, beds, and capacity | `/rooms` page | ☐ |
| 3.1.18 | Featured room types selected for the homepage (max 3) | Settings → Website Content → Homepage → Featured Room Types | ☐ |

### 3.2 Physical Rooms (Room Management)

| # | Item | Where | Status |
|---|---|---|---|
| 3.2.1 | One document per physical room — count matches the actual hotel | Room Management page | ☐ |
| 3.2.2 | `roomNumber` (unique, case-insensitive trim compare) — used as the intercom thread doc ID | per room | ☐ |
| 3.2.3 | `name` (guest-facing display name, e.g. "Room 202 — Deluxe Sea View") | per room | ☐ |
| 3.2.4 | `type` — must match one of the `value` slugs from §3.1 | per room | ☐ |
| 3.2.5 | `status` = `"available"` (default), `"occupied"`, or `"blocked"` | per room | ☐ |
| 3.2.6 | `housekeepingStatus` = `"clean"` (default), `"dirty"`, or `"inspected"` | per room | ☐ |
| 3.2.7 | `isActive` = `true` (rooms not yet online must be inactive — they're hidden from `/rooms` until flipped on) | per room | ☐ |
| 3.2.8 | If any room starts as Blocked: `blockReason` = "Maintenance" / "Hold" / "Other" (required) | per blocked room | ☐ |
| 3.2.9 | Optional `remarks` (staff-only — never visible to guests) | per room | ☐ |
| 3.2.10 | Optional `blockedFrom` / `blockedTo` date range if the block is date-scoped (not indefinite) | per blocked room | ☐ |
| 3.2.11 | Each room has a unique `qrToken` — auto-generated on room creation (used for QR codes) | auto | ☐ |
| 3.2.12 | **QA:** Open `/rooms` — all active room types visible with the right photos | `/rooms` | ☐ |
| 3.2.13 | **QA:** Open Room Management — all rooms listed with correct status badges + housekeeping badges | `/rooms` admin | ☐ |

---

## 4. Rates, Discounts, Breakfast & Seasonal Pricing (Settings → Rates)

> **Source:** rate matrix lives on `settings/hotelConfig.roomTypes[]` (covered in §3.1). Seasonal overrides + breakfast + discount toggles live in their own `settings/hotelConfig` sub-fields and `settings/breakfastConfig`. Everything here is admin-editable.

| # | Item | Where | Status |
|---|---|---|---|
| 4.1 | Base rate per room type verified (covered in §3.1) | ⚠ already counted above | — |
| 4.2 | Weekend rate per room type verified (covered in §3.1) | ⚠ already counted above | — |
| 4.3 | Corporate flat rate per room type (covered in §3.1) | ⚠ already counted above | — |
| 4.4 | **Breakfast config** — enabled yes/no + rate per person per night | Settings → Breakfast & Dining | ☐ |
| 4.5 | Silog / breakfast menu items, each with active toggle (only relevant if breakfast is enabled) | Settings → Breakfast & Dining → Items | ☐ |
| 4.6 | Seasonal rate overrides — name (guest-facing label like "Holy Week"), date range (inclusive), nightly rate, active toggle | Settings → Rates → Seasonal Overrides | ☐ |
| 4.7 | Senior/PWD online-booking toggle — RA 9994 / RA 10754 compliance | Settings → Rates → Discounts | ☐ |
| 4.8 | Discount scope matrix — Senior/PWD × Room / Breakfast / Extra Bed (defaults: all three on for the statutory discount) | Settings → Rates → Discount Scope | ☐ |
| 4.9 | Payment hold window (hours) for auto-expiry of unpaid pending bookings — 1..72h, default 24h | Settings → Rates → Payment Hold Window | ☐ |
| 4.10 | **QA:** Step 1 on `/book` — pick a weekend date → shows the weekend rate label (not the base rate) | `/book` | ☐ |
| 4.11 | **QA:** Step 1 on `/book` — pick a date inside a seasonal override window → override label appears (and beats weekend rate) | `/book` | ☐ |
| 4.12 | **QA:** Step 1 with breakfast enabled — "Room + Breakfast" option appears and the combined nightly rate is correct | `/book` | ☐ |

---

## 5. Payment Methods (Settings → Payment Methods)

> **Source:** `settings/hotelConfig.paymentMethods[]`. Each method has independent toggles for Booking / Store / Corporate visibility (`isEnabled`, `showInStore`, `showInCorporate`). `pay-at-hotel` and `add-to-bill` are protected and cannot be deleted.
>
> **Verify the QR code image for every digital method** — uploaded via the admin to `assets/payment-methods/{method}/{filename}` and stored as a URL on the method entry.

| # | Item | Where | Status |
|---|---|---|---|
| 5.1 | `pay-at-hotel` — protected, always present (verify it shows in the booking flow Step 3) | Settings → Payment Methods | ☐ |
| 5.2 | `add-to-bill` — protected, always present (verify it shows in store checkout + corporate) | Settings → Payment Methods | ☐ |
| 5.3 | GCash (or other digital wallet) — `isEnabled`, `showInStore`, `showInCorporate` all set as needed | Settings → Payment Methods | ☐ |
| 5.4 | GCash QR code image uploaded (readable on a phone screen, ≤500KB) | per method | ☐ |
| 5.5 | GCash account name (the registered account holder name guests should send to) | per method | ☐ |
| 5.6 | GCash account number / mobile number | per method | ☐ |
| 5.7 | Bank Transfer (if used) — bank name, account name, account number | per method | ☐ |
| 5.8 | Bank Transfer QR / proof image (optional — often a screenshot of bank details) | per method | ☐ |
| 5.9 | PayPal (if used) — PayPal email + QR / link | per method | ☐ |
| 5.10 | Per-method `requireReferenceNumber` flag — if true, staff must record a reference number when verifying payment (guest does not enter one — see `BOOKING-FLOW.md` §Step 3 note) | per method | ☐ |
| 5.11 | **QA:** Step 3 of `/book` — each enabled method renders the right QR + account info | `/book` | ☐ |
| 5.12 | **QA:** `/intercom` Shop tab — only methods with `showInStore: true` appear | `/intercom` | ☐ |
| 5.13 | **QA:** `/corporate/book` — only methods with `showInCorporate: true` appear | `/corporate/book` | ☐ |

---

## 6. Booking Sources (Settings → Booking Sources)

> **Source:** `settings/hotelConfig.bookingSources[]`. Protected keys: `online`, `walk-in`, `corporate` cannot be deleted or set as front-desk-selectable.

| # | Item | Where | Status |
|---|---|---|---|
| 6.1 | Default sources present: `online`, `walk-in`, `corporate` (verify, don't delete) | Settings → Booking Sources | ☐ |
| 6.2 | Add hotel-specific sources — e.g. "Travel Agent: <name>", "Booking.com", "Agoda", "Direct Phone" | Settings → Booking Sources | ☐ |
| 6.3 | Each custom source has a clear `label` and a unique `value` | per source | ☐ |
| 6.4 | `frontDeskSelectable` set to `true` for sources front-desk should see when creating a walk-in (e.g. "Phone booking", "Email booking") | per source | ☐ |
| 6.5 | **QA:** Admin → Bookings → New Walk-in — the source dropdown shows only the `frontDeskSelectable` sources | `/bookings` admin | ☐ |

---

## 7. Legal & Compliance Content (Settings → Legal Content + admin-only overrides)

> **Source:** `settings/websiteContent.privacyPolicyBody`, `.cancellationPolicy`, `.houseRules`, `.privacyPolicyLastUpdated` (auto-stamped on save). Terms of Service body is hardcoded in `plan/features/STATIC-PAGES.md §Terms` for now (Phase 1) — Tier A in the public-content audit will surface a Terms editor later.

| # | Item | Where | Status |
|---|---|---|---|
| 7.1 | Privacy Policy — full body (plain text or light markdown) — final review by hotel owner / lawyer | Settings → Legal Content → Privacy Policy Body | ☐ |
| 7.2 | Privacy Policy — "Last Updated" date (auto-set on save, but confirm) | Settings → Legal Content | ☐ |
| 7.3 | Cancellation Policy — booking Step 3 collapsible + confirmation email | Settings → Legal Content → Cancellation Policy | ☐ |
| 7.4 | House Rules — used in the Guest Registration PDF at check-in | Settings → Legal Content → House Rules | ☐ |
| 7.5 | Applicable law string (e.g. "Republic Act No. 10173 (Data Privacy Act of 2012)") | `hotel.config.ts → applicableLaw` | ☐ |
| 7.6 | "Terms Last Updated" date displayed on `/terms` | `hotel.config.ts → termsLastUpdated` | ☐ |
| 7.7 | **Owner sign-off:** Lawyer / owner has reviewed the Privacy Policy body and the Cancellation Policy text against the actual operations | Owner ack | ☐ |
| 7.8 | **QA:** Open `/privacy` and `/terms` on a phone — readable, sections render, DPO email is clickable, "Last Updated" dates match | `/privacy`, `/terms` | ☐ |
| 7.9 | **QA:** Booking Step 3 — cancellation policy collapsible expands and the text matches what staff quote on the phone | `/book` Step 3 | ☐ |
| 7.10 | **QA:** Guest Registration PDF (printed at check-in) — House Rules block renders correctly | admin → check-in flow | ☐ |

---

## 8. Homepage Marketing Content (Settings → Branding + Website Content)

> **Source:** `settings/websiteContent.*` for the editable fields, `guest-app/src/data/homepage.ts` for the static fallbacks (DK-supplied).

### 8.1 Hero + 4 hero pages (Settings → Branding)

| # | Item | Where | Status |
|---|---|---|---|
| 8.1.1 | Homepage hero photo — landscape, ≥1920×1080, JPG ≤400KB | Settings → Branding → Homepage Hero | ☐ |
| 8.1.2 | Homepage hero heading (e.g. "Stay where comfort is felt") | Settings → Branding | ☐ |
| 8.1.3 | Homepage hero subtext (one sentence — emotional answer to "why stay here?") | Settings → Branding | ☐ |
| 8.1.4 | About hero photo | Settings → Branding → About Hero | ☐ |
| 8.1.5 | About hero heading | Settings → Branding | ☐ |
| 8.1.6 | About mission statement (Settings → Hotel → Mission Statement) | Settings → Hotel | ☐ |
| 8.1.7 | About vision statement | Settings → Hotel | ☐ |
| 8.1.8 | About hotel story (multi-paragraph — Heritage & Growth section) | Settings → Hotel | ☐ |
| 8.1.9 | Corporate hero photo (corporate stays marketing page — dark hero, brand promise overlay) | Settings → Branding → Corporate Hero | ☐ |
| 8.1.10 | Corporate hero eyebrow | Settings → Branding | ☐ |
| 8.1.11 | Corporate hero heading | Settings → Branding | ☐ |
| 8.1.12 | Corporate hero subtext | Settings → Branding | ☐ |
| 8.1.13 | Rewards hero photo (Spark Rewards loyalty landing) | Settings → Branding → Rewards Hero | ☐ |
| 8.1.14 | Rewards hero eyebrow | Settings → Branding | ☐ |
| 8.1.15 | Rewards hero heading | Settings → Branding | ☐ |
| 8.1.16 | Rewards hero subtext | Settings → Branding | ☐ |
| 8.1.17 | **QA:** Each hero photo loads in under 2.5s on 4G mobile (LCP target per `HOMEPAGE.md` §Hero Image Loading) | — | ☐ |
| 8.1.18 | **QA:** Open homepage, About, Corporate, Rewards on phone + desktop — hero images don't crop awkwardly on either | — | ☐ |

### 8.2 Homepage sections (Settings → Website Content)

| # | Item | Where | Status |
|---|---|---|---|
| 8.2.1 | Featured room types — pick up to 3 (already counted in §3.1.18) | Settings → Website Content → Homepage → Featured | ☐ |
| 8.2.2 | Amenities — icon + title + description per item (3–6 cards) | Settings → Website Content → Homepage → Amenities | ☐ |
| 8.2.3 | Services — Tour Packages card + Car Rentals card, each with icon + name + description + "Contact Us" CTA | Settings → Website Content → Homepage → Services | ☐ |
| 8.2.4 | Spark Rewards promo section — enabled toggle | Settings → Website Content → Homepage → Spark Rewards | ☐ |
| 8.2.5 | Spark Rewards promo section — heading + description | Settings → Website Content | ☐ |
| 8.2.6 | Spark Rewards promo section — perks list (icon + name + short description, e.g. "Earn Points", "Member Discounts", "Early Check-In") | Settings → Website Content | ☐ |

### 8.3 Corporate page sections (Settings → Website Content)

| # | Item | Where | Status |
|---|---|---|---|
| 8.3.1 | Perks list — 6 cards (title, description, icon) — defaults: Negotiated Rates, Group Bookings, Dedicated Support, High-Speed Wi-Fi, Premium Security, Flexible Bookings | Settings → Website Content → Corporate → Perks | ☐ |
| 8.3.2 | Rooms overview eyebrow + heading + description | Settings → Website Content → Corporate → Rooms Overview | ☐ |
| 8.3.3 | Retreat CTA banner — heading + description + button label | Settings → Website Content → Corporate → Retreat CTA | ☐ |
| 8.3.4 | Inquiry form fields — company name, contact person, email, phone, number of rooms, preferred dates, special requirements (test via `/corporate` form submission) | live form | ☐ |
| 8.3.5 | **QA:** Submit a test corporate inquiry — appears in admin Corporate Inquiries pipeline + triggers the staff notification email | `/corporate` + admin | ☐ |

### 8.4 About page

| # | Item | Where | Status |
|---|---|---|---|
| 8.4.1 | Hotel story multi-paragraph (already counted in §8.1.8) | ⚠ already counted above | — |
| 8.4.2 | Mission + Vision (already counted in §8.1.6–7) | ⚠ already counted above | — |

---

## 9. Contact Page (`/contact`)

> **Source:** mostly `hotel.config.ts` (🟡) + Settings → Hotel (🟢). Form submits to `/api/contact/inquiry` and creates a `corporateInquiries/{id}` doc.

| # | Item | Where | Status |
|---|---|---|---|
| 9.1 | Hotel address displayed (covered in §2.2–5) | ⚠ already counted above | — |
| 9.2 | Phone displayed (covered in §2.6) | ⚠ already counted above | — |
| 9.3 | Email displayed (covered in §2.7) | ⚠ already counted above | — |
| 9.4 | Google Maps embed shows the correct location | `/contact` | ☐ |
| 9.5 | Facebook + Instagram links (covered in §2.11–12) | ⚠ already counted above | — |
| 9.6 | Contact form — name, email, subject, message — submits via `POST /api/contact/inquiry` | live form | ☐ |
| 9.7 | **QA:** Submit a test contact form — message lands in the admin inquiry pipeline + staff email notification fires | `/contact` + admin inbox | ☐ |
| 9.8 | **QA:** Honeypot field present and hidden via CSS (not `display: none` — see `STATIC-PAGES.md`) | inspect DOM | ☐ |
| 9.9 | **QA:** Cloudflare Turnstile widget renders on the form (invisible) | inspect form | ☐ |

---

## 10. Intercom (in-room chat via QR)

> **Source:** `settings/hotelConfig.intercomQuickRequests[]` (quick request chips) + the QR management page (admin generates codes per room).
>
> **Operational note:** QR codes that will be physically placed in rooms MUST be generated from the **production** admin (`admin.<domain>`), not staging — the QR encodes the production guest-app URL (per `QR-MANAGEMENT.md §QR URL env-awareness`).

### 10.1 Intercom config (Settings → Hotel)

| # | Item | Where | Status |
|---|---|---|---|
| 10.1.1 | Quick request chips — defaults are "Extra Towels", "Bottled Water", "Room Cleaning", "Do Not Disturb"; edit per hotel ops | Settings → Hotel → Intercom | ☐ |
| 10.1.2 | Notification sound URL (the Web Audio API tone played when a new message lands — optional, defaults work) | Settings → Hotel → Intercom | ☐ |
| 10.1.3 | Cloudflare Turnstile configured for the guest intercom page (same key as `/book` Step 3) | Server env | ☐ |

### 10.2 QR codes for physical rooms (admin → QR Management)

| # | Item | Where | Status |
|---|---|---|---|
| 10.2.1 | Open `/qr` on the **production** admin (not staging) | `/qr` | ☐ |
| 10.2.2 | QR target = Front Desk Intercom (default) | dropdown | ☐ |
| 10.2.3 | Each physical room renders a QR code with the room number + name + logo + instruction ("Scan to chat with the front desk") | per room | ☐ |
| 10.2.4 | "Print all QRs" generates a 4-up A4 print layout | `/qr` | ☐ |
| 10.2.5 | Printed cards laminated and placed in each room (front desk handles) | physical | ☐ |
| 10.2.6 | **QA:** Scan one printed QR with a phone — opens `/intercom/{roomNumber}` on the production guest app, lands on the chat tab, shows "You're chatting about Room N" | physical scan | ☐ |
| 10.2.7 | Optional: a second batch of QRs for "Scan to order from <storeName>" (sets `?tab=shop`) — place near the in-room menu | `/qr` → target = Spark Essentials | ☐ |

---

## 11. Spark Essentials — In-Room Store (Settings → In-Room Store)

> **Source:** `settings/storeConfig.isEnabled`, `lowStockThreshold`; catalog in `storeItems/` collection; orders in `storeOrders/`.
>
> **Three Settings tabs touch this:** Store (catalog + config), Payment Methods (already covered in §5 — store visibility flag is here).

| # | Item | Where | Status |
|---|---|---|---|
| 11.1 | Store enabled toggle | Settings → In-Room Store → Enable | ☐ |
| 11.2 | Low stock alert threshold (default 5) | Settings → In-Room Store | ☐ |
| 11.3 | **Catalog items** — name, category (Drinks / Snacks / Toiletries / Rentals / Other), description, price, stock count (or "Unlimited" toggle) | Settings → In-Room Store → Items | ☐ |
| 11.4 | Each item has a compressed photo (use the shared `compressImageFile()` helper — uploads to `store-items/{itemId}/{filename}` in Storage) | per item | ☐ |
| 11.5 | Each item has an `active` toggle (inactive items are hidden from the guest store but keep historical orders valid) | per item | ☐ |
| 11.6 | At least one store-visible payment method is enabled (covered in §5 — `showInStore: true`) | ⚠ already counted above | — |
| 11.7 | **QA:** Open `/intercom/{roomNumber}?tab=shop` — all active items render with photo + price + stock badge | physical / phone | ☐ |
| 11.8 | **QA:** Add an item to the cart, place a test order with Add-to-Bill — order appears in admin Store Management with `status: "placed"` and is linked to the test booking | end-to-end test | ☐ |
| 11.9 | **QA:** Try ordering an out-of-stock item — server returns a stock error | `/intercom` | ☐ |
| 11.10 | **QA:** Cancel a placed order — item stock is unchanged (cancel-before-confirm does NOT restore stock because confirm is when stock decrements per `STORE-MANAGEMENT.md`) | admin + intercom | ☐ |
| 11.11 | **QA:** Confirm a placed order — stock decrements in the catalog | admin | ☐ |

---

## 12. Breakfast & Dining (Settings → Breakfast & Dining)

> Already covered in §4.4–5. Re-listed here for traceability so the section isn't accidentally skipped when going through Settings tabs top-to-bottom.

| # | Item | Where | Status |
|---|---|---|---|
| 12.1 | Enabled toggle + rate per person per night (covered in §4.4) | ⚠ already counted above | — |
| 12.2 | Silog items with active toggle (covered in §4.5) | ⚠ already counted above | — |
| 12.3 | **QA:** `/book` Step 1 — "Room + Breakfast" option appears when enabled, and the combined nightly rate matches `ratePerPersonPerNight × adults` | `/book` | ☐ |

---

## 13. Spark Rewards Loyalty Program (Settings → Loyalty Rewards)

> **Source:** `settings/rewardsConfig` (points, member discount, early check-in toggle, redemption rate, tier placeholder). Display name lives in `hotel.config.ts → rewardsName`.

| # | Item | Where | Status |
|---|---|---|---|
| 13.1 | Rewards program name (e.g. "Spark Rewards" / "Ocean Perks" / "Members Club") | `hotel.config.ts → rewardsName` | ☐ |
| 13.2 | Member number prefix (e.g. "SR" → "SR-00042") | `hotel.config.ts → memberNumberPrefix` | ☐ |
| 13.3 | Booking reference prefix (e.g. "SI" → "SI-20260822-001") | `hotel.config.ts → bookingRefPrefix` | ☐ |
| 13.4 | Program tagline (sub-headline on `/rewards`) | Settings → Loyalty Rewards → Tagline | ☐ |
| 13.5 | Points earning — enabled toggle | Settings → Loyalty Rewards | ☐ |
| 13.6 | Points earning mode: "per-booking" (1 point per night/booking) OR "per-spend" (e.g. 1 point per ₱100) | Settings → Loyalty Rewards | ☐ |
| 13.7 | If per-booking: points per booking (numeric) | Settings → Loyalty Rewards | ☐ |
| 13.8 | If per-spend: points per ₱100 (numeric) | Settings → Loyalty Rewards | ☐ |
| 13.9 | Points redemption rate (e.g. "100 points = ₱100 off") — only used by staff from the booking drawer; no guest UI yet in Phase 1 | Settings → Loyalty Rewards | ☐ |
| 13.10 | Member discount — enabled toggle | Settings → Loyalty Rewards | ☐ |
| 13.11 | Member discount percentage (e.g. 5) | Settings → Loyalty Rewards | ☐ |
| 13.12 | Early check-in requests — enabled toggle (Phase 12, EC-02) | Settings → Loyalty Rewards | ☐ |
| 13.13 | Phase 2 tier labels — **deferred** (tier system not built yet) | n/a | — |
| 13.14 | **QA:** Sign in to the guest app with a test member → My Rewards shows the correct points balance + tier ("Standard Member" placeholder until Phase 2) | `/account/rewards` | ☐ |
| 13.15 | **QA:** Sign in as a member, place a booking → discount applies automatically at Step 3 (member discount badge) | `/book` | ☐ |
| 13.16 | **QA:** Admin → Members → search for the test member → all profile fields populated, member number matches the prefix | `/members` admin | ☐ |

---

## 14. Vouchers & Promotional Codes (Settings → Rates → Vouchers)

> **Source:** `vouchers/` collection. Managed on the Rates page.
>
> **Pre-launch recommendation:** seed 0–2 promo codes (e.g. `LAUNCH20` for 20% off the first stay, valid for 90 days). More can be added after launch from the admin.

| # | Item | Where | Status |
|---|---|---|---|
| 14.1 | Voucher `code` (unique, alphanumeric, what guests type in) | per voucher | ☐ |
| 14.2 | Discount type: `percentage` OR `flat` | per voucher | ☐ |
| 14.3 | Discount value (e.g. 20 for 20%, or 500 for ₱500 off) | per voucher | ☐ |
| 14.4 | Usage cap (optional — leave blank for unlimited) | per voucher | ☐ |
| 14.5 | Expiry date (optional — leave blank for no expiry) | per voucher | ☐ |
| 14.6 | Applicable room types: empty = all room types; multi-select = restricted subset (VOU-03 all-or-none semantics — the voucher applies to a multi-room booking only if **every** selected room type is in the subset) | per voucher | ☐ |
| 14.7 | Active toggle | per voucher | ☐ |
| 14.8 | **QA:** Apply the test voucher in booking Step 3 — total updates correctly, success message shows the discount value | `/book` | ☐ |
| 14.9 | **QA:** Try a voucher for a room type outside the applicable set — rejected with the right error | `/book` | ☐ |
| 14.10 | **QA:** Drive usage to cap → next attempt rejected with "usage limit reached" | `/book` | ☐ |

---

## 15. Staff Accounts (Settings → Staff Accounts)

> **Source:** Firebase Auth + custom claims (`role: "admin"` | `"front-desk"`). Created via `POST /api/admin/create-staff` with an existing admin's Bearer token. Per `AUTH-ROLES.md`: front-desk cannot access Rates / Settings / Members; admin can access everything.

| # | Item | Where | Status |
|---|---|---|---|
| 15.1 | **Hotel Owner** admin account — full name, email, strong password, phone, role = `admin` | Settings → Staff Accounts → Create | ☐ |
| 15.2 | **Hotel Manager** admin account (secondary owner / GM) — same shape, role = `admin` | per manager | ☐ |
| 15.3 | **Front Desk Lead** account — role = `front-desk` | per lead | ☐ |
| 15.4 | **Front Desk Staff** accounts — one per shift worker who needs login access; role = `front-desk` | per staff | ☐ |
| 15.5 | **Night Auditor / Accountant** account (if applicable) — role = `front-desk` (the daily-close + reports tabs are reachable from front-desk) | per role | ☐ |
| 15.6 | **Backup admin account** held by DK (engineering contact) for emergencies — role = `admin`; password in the password manager | DK owned | ☐ |
| 15.7 | All staff passwords reset to strong, unique values — stored in the hotel's password manager (1Password / LastPass / Bitwarden) | password vault | ☐ |
| 15.8 | Front-desk accounts verified to NOT have access to Rates / Settings / Members (sign in as one and confirm) | `/login` → role gate | ☐ |
| 15.9 | **QA:** "Forgot password" link works — staff can self-serve password reset via Firebase Auth email | `/login` | ☐ |

---

## 16. Intercom Quick Requests (Settings → Intercom)

> Default quick request chips: `["Extra Towels", "Bottled Water", "Room Cleaning", "Do Not Disturb"]`. Edit to match the hotel's actual service menu.

| # | Item | Where | Status |
|---|---|---|---|
| 16.1 | Quick request chips — list of strings the guest can tap to send a one-click request | Settings → Intercom → Quick Requests | ☐ |
| 16.2 | Notification sound URL (previewed in Settings) | Settings → Intercom → Sound | ☐ |
| 16.3 | **QA:** Open `/intercom/{roomNumber}` on phone — quick request chips appear at the bottom of the chat | `/intercom` | ☐ |
| 16.4 | **QA:** Tap a chip → message appears in admin Intercom Inbox with the chip text + room number | `/inbox` admin | ☐ |

---

## 17. Email Configuration (Settings → Email Config + Resend)

> **Source:** Resend API for delivery; `settings/websiteContent` for from-name and from-address display; env vars for the actual credentials.

| # | Item | Where | Status |
|---|---|---|---|
| 17.1 | Resend account created (production account — separate from any staging account) | Resend dashboard | ☐ |
| 17.2 | Custom sending domain verified in Resend (e.g. `bookings.<domain>` — must match the hotel's domain for SPF/DKIM to pass) | Resend dashboard | ☐ |
| 17.3 | DNS records added: SPF, DKIM, DMARC for the sending domain | DNS registrar | ☐ |
| 17.4 | `RESEND_API_KEY` env var set in Vercel (production) | Vercel env | ☐ |
| 17.5 | `RESEND_FROM_EMAIL` env var set (the verified sender) | Vercel env | ☐ |
| 17.6 | `ADMIN_NOTIFICATION_EMAIL` env var set — staff inbox that receives failed-email alerts, corporate inquiries, refund-review alerts, and early-check-in requests | Vercel env | ☐ |
| 17.7 | 7+ active email triggers listed in Settings → Email Config — verify each one fires end-to-end (booking-submitted, booking-confirmed, check-in reminder, etc.) | Settings → Email Config → Preview | ☐ |
| 17.8 | **QA:** Place a test booking → booking-submitted email lands in the guest's inbox within 60s | end-to-end | ☐ |
| 17.9 | **QA:** Submit a test corporate inquiry → staff notification email lands in `ADMIN_NOTIFICATION_EMAIL` inbox | end-to-end | ☐ |
| 17.10 | **QA:** Vercel cron at midnight UTC → `/api/email/checkin-reminder` fires for tomorrow's check-ins | cron log | ☐ |
| 17.11 | **QA:** Resend bounce rate is 0% in the first 24h (set a Resend alert at 5%) | Resend dashboard | ☐ |

---

## 18. SEO, Analytics & Open Graph

> **Source:** `hotel.config.ts` for the static fields; `settings/websiteContent` for the runtime hero overrides; `index.html` for the meta tags.

| # | Item | Where | Status |
|---|---|---|---|
| 18.1 | `pageTitle` (browser tab prefix, e.g. "spark inn") | `hotel.config.ts → pageTitle` | ☐ |
| 18.2 | `metaDescription` (default SEO description — used when a page doesn't override) | `hotel.config.ts → metaDescription` | ☐ |
| 18.3 | `og-image.png` (1200×630px, branded, already covered in §1.11) | ⚠ already counted above | — |
| 18.4 | `robots.txt` — production version allows indexing of public pages, disallows admin + `/account/*` + `/api/*` | `guest-app/public/robots.txt` | ☐ |
| 18.5 | `sitemap.xml` — generated and submitted to Google Search Console + Bing Webmaster Tools | search console | ☐ |
| 18.6 | Google Analytics 4 Measurement ID (optional — `G-XXXXXXXXXX`) | `hotel.config.ts → analyticsId` | ☐ |
| 18.7 | Facebook Pixel ID (optional — leave blank to disable) | `hotel.config.ts` (verify field exists) | ☐ |
| 18.8 | **QA:** Open homepage → View Source → `<title>` is correct, `<meta name="description">` is correct, `<meta property="og:image">` resolves | inspect HTML | ☐ |
| 18.9 | **QA:** Paste homepage URL into Facebook / Messenger / WhatsApp / Viber / X → link preview shows the right hero photo, title, and description | per platform | ☐ |
| 18.10 | **QA:** Google Search Console — submit sitemap, request indexing for `/`, `/rooms`, `/about`, `/contact` | search console | ☐ |

---

## 19. Notifications & Cron

> **Source:** Vercel cron in `guest-app/vercel.json`; `settings/notifications` collection + retention cron; intercom notification sound.

| # | Item | Where | Status |
|---|---|---|---|
| 19.1 | Vercel cron — `0 0 * * *` → `/api/email/checkin-reminder` for tomorrow's check-ins | `guest-app/vercel.json` | ☐ |
| 19.2 | Vercel cron secret (`CRON_SECRET` env var) set in production | Vercel env | ☐ |
| 19.3 | Storage janitor cron — sweeps orphaned uploads (per `LR-L8`) | `guest-app/vercel.json` | ☐ |
| 19.4 | Notifications collection retention cron (deletes >90d old bell notifications) | `guest-app/vercel.json` | ☐ |
| 19.5 | `ADMIN_NOTIFICATION_EMAIL` receives failed-email delivery alerts | env + Resend | ☐ |
| 19.6 | Bell icon in admin header — click → opens notification center, deep-links to relevant booking | live test | ☐ |
| 19.7 | **QA:** Trigger a refund review alert (cancel a paid GCash store order per `STORE-MANAGEMENT.md §CRL-04`) → staff notification appears in the bell | admin | ☐ |
| 19.8 | **QA:** Trigger an early-check-in request as a member → bell badge increments, dashboard widget shows the request, Approve/Decline buttons work | admin | ☐ |

---

## 20. QR for In-Room Use (re-verify, physical placement)

> Already covered in §10. Re-listed here so the QR step doesn't get dropped when the operator is walking the property with a printed checklist.

| # | Item | Where | Status |
|---|---|---|---|
| 20.1 | QR codes generated from **production** admin (covered in §10.2.1) | ⚠ already counted above | — |
| 20.2 | Cards laminated (waterproof — bathrooms) | physical | ☐ |
| 20.3 | One QR per room, placed at the desk or bedside table | physical | ☐ |
| 20.4 | Optional: second QR for the in-room store, placed next to the in-room menu / minibar list | physical | ☐ |
| 20.5 | **QA:** Scan each physical QR with 2 different phones (iPhone + Android) — both open the right intercom page | physical walk | ☐ |

---

## 21. Final Pre-Launch Sign-Off

> **Only sign this section when every other box above is checked.** If anything is unchecked, do not cut over to production.

| # | Item | Status |
|---|---|---|
| 21.1 | Every admin section (Hotel, Branding, Website Content, Room Types, Room Management, Rates, Payment Methods, Booking Sources, Breakfast, In-Room Store, Loyalty Rewards, Staff Accounts, Email Config, Intercom, Legal Content) was opened at least once and saved successfully | ☐ |
| 21.2 | A real test booking was created end-to-end on production (search → Step 1 → Step 2 → Step 3 → Step 4 → confirmation email) and appears in admin Bookings with the correct rates, breakfast, voucher (if any), discount (if any), and totals | ☐ |
| 21.3 | A real test walk-in booking was created from admin (with immediate check-in) — room status flips to `occupied`, booking status is `checked-in`, the booking shows up on the dashboard | ☐ |
| 21.4 | A real test check-out was performed — room returns to `available`, points awarded (if Rewards enabled), invoice/receipt downloadable | ☐ |
| 21.5 | Spark Rewards: a test member signed up, was linked to the test booking, and My Stays shows the booking | ☐ |
| 21.6 | In-room store: a test order was placed from `/intercom/{roomNumber}?tab=shop`, confirmed by staff, and the linked booking's folio reflects the Add-to-Bill | ☐ |
| 21.7 | All 7+ transactional emails fire to a real inbox and pass SPF/DKIM/DMARC | ☐ |
| 21.8 | Cloudflare Turnstile blocks obvious bot submissions (test by omitting the token — request rejected with 400) | ☐ |
| 21.9 | Both apps load over HTTPS with a valid TLS cert (green padlock), CSP headers present in DevTools, no mixed-content warnings | ☐ |
| 21.10 | The hotel owner's admin account is the one being used for the launch — DK's temporary admin has been disabled or downgraded | ☐ |
| 21.11 | 24h post-launch monitoring plan is in place (see `DEPLOY.md §9`): Resend alerts, Firebase quota alerts, Vercel error rate alerts, page-load monitoring | ☐ |
| 21.12 | DK contact + escalation path on call for the first 72h after launch (the launch-window bug class per `silent-rate-limit-fallback` skill — banner messages that hide real API errors) | ☐ |
| 21.13 | **Hotel owner has signed off in writing that the public site is ready to receive real bookings** | ☐ |

---

## Appendix A — What This Checklist Intentionally Does NOT Cover

These are out of scope for a content-only checklist (they're handled in `DEPLOY.md`):

- **Code-side launch audit** — see `plan/project/AUDIT-LAUNCH-READINESS-2026-07-07.md`. All 20 LR findings (LR-C1 through LR-L8) were closed on `fix/launch-readiness-must-fix`; re-run `npm test` and the build before tagging.
- **Staging → production Firebase cutover** — `DEPLOY.md §8.1` (new production Firebase project, deploy rules, seed from staging export).
- **DNS + Vercel domain provisioning** — `DEPLOY.md §5` and `§8.4`.
- **Vercel env var configuration** — `DEPLOY.md §3` (full list of every variable, both apps).
- **Version bump to v1.0.0** — `DEPLOY.md §8.3` (`release:` commit prefix triggers Husky's major bump).
- **Rollback procedure** — `DEPLOY.md §10` (don't need it, but know where it is).

## Appendix B — Items Deferred to Post-Launch

These are real features but not launch-blockers. They are explicitly NOT in the v1.0.0 launch scope:

- Loyalty tier system (Phase 2 of Spark Rewards)
- Points redemption guest UI (staff-only in Phase 1)
- Browser push notifications for the admin bell
- Booking modification flow (dates / room change) — staff workaround is cancel + re-create
- Staff availability calendar (forward-looking room occupancy)
- Tier A public-content fields from `AUDIT-PUBLIC-CONTENT-2026-07-01.md` (bookmark labels, FAQ copy, modal labels) — ship as fast-follows
- Terms of Service body editor — mirror of `privacyPolicyBody`; build when the first client asks
