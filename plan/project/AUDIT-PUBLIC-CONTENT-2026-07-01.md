# Public App Content Editability Audit
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** Findings were triaged into `plan/project/ROADMAP.md`; anything still open is tracked there, everything closed is recorded in `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md`. Canonical specs may have evolved since this audit ran.
> Source: full read-through of every public page, every shared component, and the admin `Settings` page
> Date: July 1, 2026
> Scope: every string rendered to a guest in the public app (`guest-app/`) and the public emails — what's already admin-editable, what's only in `hotel.config.ts` (white-label config), and what's still hardcoded
> Goal: catalogue the full surface so we can decide which of the hardcoded strings should become editor fields, without bloating the admin with low-value inputs

---

## How to use this file

1. **Section 1** — the per-page inventory of every string the guest sees, tagged with its current source.
2. **Section 2** — the per-page *what's already dynamic today* snapshot, so the existing editor surface is easy to reason about.
3. **Section 3** — the recommendation: which hardcoded strings should become editor fields, in tiers.
4. **Section 4** — the work plan: which new editor fields land in which Settings tab, with effort estimates.
5. **Section 5** — what we explicitly decided to **keep hardcoded** and why.

The tiering in Section 3 is the input to the Phase 11.8 checklist items added to `plan/project/ROADMAP.md`.

---

## Section 1 — Full per-page inventory

Legend:
- 🟢 **Dynamic** — already editable from the admin app (Settings → X)
- 🟡 **Config-only** — read from `hotel.config.ts` (white-label config, requires a redeploy)
- 🔴 **Hardcoded** — string literal in the page or component, no admin surface

### 1.1 Global elements (every page)

| Element | Source location | Tag |
|---|---|---|
| Brand name (`spark inn`) | `hotel.config.ts → brandName` | 🟡 |
| Rewards program name (`Spark Rewards`) | `hotel.config.ts → rewardsName` | 🟡 |
| Legal name (`Spark Inn Hotel Corp`) | `hotel.config.ts → legalName` | 🟡 |
| Tagline (homepage hero eyebrow) | `hotel.config.ts → tagline` | 🟡 |
| Brand promise ("Peaceful, consistent stays…") | `hotel.config.ts → brandPromise` | 🟡 |
| Navbar logo | `config.logos.navbar` → admin override `branding.logoNavbar` | 🟢 |
| Navbar logo on dark hero | `config.logos.navbar` → admin override `branding.logoNavbarOnDark` | 🟢 |
| Footer logo | `config.logos.white` → admin override `branding.logoFooter` | 🟢 |
| Favicon | `hotel.config.ts → favicon` | 🟡 |
| OG image | `hotel.config.ts → ogImage` | 🟡 |
| Address (street, city, region, postal) | `hotel.config.ts → address.*` | 🟡 |
| Front-desk phone | `hotel.config.ts → frontDeskPhone` | 🟡 |
| Support email | `hotel.config.ts → supportEmail` | 🟡 |
| DPO email | `hotel.config.ts → dpoEmail` | 🟡 |
| Facebook URL | `hotel.config.ts → facebookUrl` | 🟡 |
| Instagram URL | `hotel.config.ts → instagramUrl` | 🟡 |
| Check-in / check-out default times | `hotel.config.ts` (not in current schema; only `adminSettings.checkInTime/checkOutTime` strings) | 🟢 |
| Currency / locale / timezone | `hotel.config.ts` | 🟡 |
| Version badge (`v0.x.x`) | `shared/VERSION.ts` (auto-bumped by Husky) | 🟢 |
| Navbar items + order | `Navbar.tsx:11` — hardcoded array `{label, to}[]` | 🔴 |
| Footer items + order | `Footer.tsx:8` — hardcoded array `{label, to}[]` | 🔴 |
| Hero LQIP gradient | `data/homepage.ts → buildHeroLqip()` — built from `config.colors.primary` | 🟡 |

### 1.2 `/` Homepage — `HomePage.tsx`

| Section | Content | Tag |
|---|---|---|
| Hero heading | `settings/websiteContent.homepage.heroHeading` | 🟢 |
| Hero subtext | `settings/websiteContent.homepage.heroSubtext` | 🟢 |
| Hero photo | `settings/websiteContent.homepage.heroPhotoUrl` | 🟢 |
| Hero eyebrow (tagline) | `config.tagline` | 🟡 |
| "Book your stay" / "View rooms" CTAs | hardcoded | 🔴 |
| "Stay with us" eyebrow / title / lead | hardcoded | 🔴 |
| Featured rooms (3 cards) | `websiteContent.homepage.featuredTypeValues[]` → `useRoomTypes()` | 🟢 |
| "Amenities" eyebrow / title / lead | hardcoded | 🔴 |
| Amenity cards (icon + title + desc) | `websiteContent.homepage.amenities[]` | 🟢 |
| "Services" eyebrow / title / lead | hardcoded | 🔴 |
| Service cards | `websiteContent.homepage.services[]` | 🟢 |
| "Contact us" CTA per service card | hardcoded | 🔴 |
| Spark Rewards heading | `websiteContent.homepage.sparkRewards.heading` | 🟢 |
| Spark Rewards description | `websiteContent.homepage.sparkRewards.description` | 🟢 |
| Spark Rewards enabled toggle | `websiteContent.homepage.sparkRewards.isEnabled` | 🟢 |
| Spark Rewards perk cards | `websiteContent.homepage.sparkRewards.perks[]` | 🟢 |
| "Join Spark Rewards" CTA label | hardcoded | 🔴 |
| "Location" section eyebrow / title / body | hardcoded | 🔴 |
| Google Maps embed | `config.address.*` | 🟡 |

### 1.3 `/about` About — `AboutPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Hero eyebrow ("Our Story") | hardcoded | 🔴 |
| Hero heading | `websiteContent.about.heroHeading` | 🟢 |
| Hero subtext | hardcoded (includes hardcoded "in Bohol") | 🔴 |
| Hero photo | `websiteContent.about.heroPhotoUrl` | 🟢 |
| "Our Promise" banner body | `config.brandPromise` | 🟡 |
| "our mission" / "our vision" section titles | hardcoded | 🔴 |
| Mission body | `hotelConfig.missionStatement` | 🟢 |
| Vision body | `hotelConfig.visionStatement` | 🟢 |
| Mission/vision footer chips ("Intentional Care & Consistency" / "A Premium Sanctuary in Bohol") | hardcoded | 🔴 |
| "Heritage & Growth" eyebrow | hardcoded | 🔴 |
| "The Spark of Hospitality" heading | hardcoded | 🔴 |
| Hotel story paragraphs | `hotelConfig.hotelStory` | 🟢 |

### 1.4 `/rooms` Rooms catalog — `RoomsPage.tsx`

| Section | Content | Tag |
|---|---|---|
| "Rooms & rates" eyebrow | hardcoded | 🔴 |
| "Our rooms" title | hardcoded | 🔴 |
| "Browse every room type we offer…" lead | hardcoded | 🔴 |
| Room type cards (image, label, desc, beds, capacity, weekend rate, price, amenities) | `settings/hotelConfig.roomTypes[]` (per W3.6/W3.7) | 🟢 |
| Modal: "Beds" / "Capacity" / "Weekend" / "Amenities" labels | hardcoded | 🔴 |
| Modal: "Book this type" button | hardcoded | 🔴 |
| Empty state copy | hardcoded | 🔴 |

### 1.5 `/book` Booking flow — `BookingPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Step names ("Select Room" / "Guest Details" / "Review & Pay" / "Confirmation") | hardcoded `steps` array | 🔴 |
| Step 1: "Step 1 of 4" eyebrow / title / lead | hardcoded | 🔴 |
| Breakfast add-on copy ("Room + Breakfast", "Room only") | hardcoded | 🔴 |
| Breakfast rate + enabled toggle | `settings/breakfastConfig` | 🟢 |
| Step 2: "Guest details" title + lead | hardcoded | 🔴 |
| Field labels (First/Last/Email/Phone/Guests/Special requests) | hardcoded | 🔴 |
| Field placeholders | hardcoded | 🔴 |
| Validation error messages | hardcoded | 🔴 |
| Consent block copy | hardcoded | 🔴 |
| Step 3: "Review & Pay" title + lead | hardcoded | 🔴 |
| "Voucher or Promo Code" / "Discount Options" / "Payment Method" section headings | hardcoded | 🔴 |
| Discount buttons ("None" / "Senior Citizen (20%)" / "PWD (20%)") | hardcoded (incl. hardcoded 20%) | 🔴 |
| ID upload prompts ("Upload OSCA Card Photo" / "Upload PWD ID Card Photo") | hardcoded | 🔴 |
| Payment method card labels ("Digital Wallet / GCash or Maya", "Bank Transfer / Direct Deposit", "PayPal / International card…", "Pay at Hotel / Upon arrival") | hardcoded | 🔴 |
| GCash / Maya QR + accountInfo text | `hotelConfig.paymentMethods[]` | 🟢 |
| PayPal / Bank account info | `hotelConfig.paymentMethods[]` | 🟢 |
| Member discount % | `settings/rewardsConfig.memberDiscountPct` | 🟢 |
| Voucher error messages ("This voucher expired already…" etc.) | hardcoded `voucherMessages` map | 🔴 |
| Bottom bar status text | hardcoded | 🔴 |

### 1.6 `/book/confirm` Booking confirmation — `BookingConfirmPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Headlines ("Booking submitted for review" / "Your booking is confirmed.") | hardcoded | 🔴 |
| Subtext | hardcoded | 🔴 |
| "Booking Reference" eyebrow | hardcoded | 🔴 |
| Reservation details card labels (Room Type / Stay Dates / Guests / Payment Method / Total Price) | hardcoded | 🔴 |
| Payment method display labels ("Digital Wallet (GCash/Maya)" / "Bank Transfer (Direct Deposit)" / "Pay at Hotel") | hardcoded `paymentLabels` map (PayPal missing) | 🔴 |
| Email alert banner | hardcoded | 🔴 |
| Calendar button labels | hardcoded | 🔴 |
| Spark Rewards upsell block ("Join Spark Rewards" / "Earn Points" / "Member Discounts") | hardcoded | 🔴 |
| Sign-up / Learn more buttons | hardcoded | 🔴 |
| Empty state ("No booking details found…") | hardcoded | 🔴 |

### 1.7 `/corporate` Corporate Stays marketing — `CorporateStaysPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Hero eyebrow | `corporate.heroEyebrow` | 🟢 |
| Hero heading | `corporate.heroHeading` | 🟢 |
| Hero subtext | `corporate.heroSubtext` | 🟢 |
| Hero photo | `corporate.heroPhotoUrl` | 🟢 |
| "Book with Corporate Rate" / "Submit an Inquiry" CTAs | hardcoded | 🔴 |
| Perks section eyebrow ("Exclusive Client Benefits") | hardcoded | 🔴 |
| Perks section title ("Unrivaled Professional Perks") | hardcoded | 🔴 |
| Perks cards (6) | `corporate.perks[]` | 🟢 |
| "Onboarding Flow" 3-step process (all step titles + descriptions + photo) | hardcoded | 🔴 |
| "Integration Process" eyebrow / title / lead ("Simple Integration, Superior Results") | hardcoded | 🔴 |
| Rooms overview eyebrow / heading / description | `corporate.roomsOverview*` | 🟢 |
| Rooms overview cards | `useRoomTypes()` (one per type) | 🟢 |
| "Type Details" / "Inquire" CTAs per card | hardcoded | 🔴 |
| Type details modal labels ("Beds" / "Max Occupancy" / "Included Amenities" / "Corporate Rates Negotiable" / "Inquire About This Type") | hardcoded | 🔴 |
| Retreat CTA heading / description / button | `corporate.retreat*` | 🟢 |
| Inquiry form labels + placeholders + button | hardcoded | 🔴 |
| Form success / error copy | hardcoded | 🔴 |

### 1.8 `/corporate/book` Corporate booking — `CorporateBookingPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Page heading + lead | hardcoded | 🔴 |
| Form labels, placeholders, validation, success/error copy | hardcoded | 🔴 |

### 1.9 `/rewards` Rewards landing — `RewardsLandingPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Hero eyebrow pill (`{rewardsName} {eyebrow}`) | `rewards.heroEyebrow` | 🟢 |
| Hero heading | `rewards.heroHeading` | 🟢 |
| Hero subtext | `rewards.heroSubtext` | 🟢 |
| Hero photo | `rewards.heroPhotoUrl` | 🟢 |
| CTAs ("Join Spark Rewards" / "Sign In" / "Enroll in Spark Rewards (One-Click)" / "Go to My Rewards Dashboard") | hardcoded | 🔴 |
| "How It Works" — eyebrow / title / 3 step cards ("1. Join for free" / "2. Stay & Earn" / "3. Redeem & Relax") | hardcoded | 🔴 |
| "Member Privileges" — eyebrow / title / lead | hardcoded | 🔴 |
| 4 perk cards ("Member-Only Rates" / "Early Check-in Priority" / "Welcome to the Program" / "Exclusive Presales") | hardcoded | 🔴 |
| Bottom CTA banner ("Start earning today." / "Join our community…") | hardcoded | 🔴 |

### 1.10 `/contact` Contact — `ContactPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Hero eyebrow ("Get in Touch") | hardcoded | 🔴 |
| Hero title ("contact us") | hardcoded | 🔴 |
| Hero lead ("Have a question about reservations…") | hardcoded | 🔴 |
| "direct channels" / "send a message" headings | hardcoded | 🔴 |
| Address | `config.address.*` | 🟡 |
| Phone | `config.frontDeskPhone` | 🟡 |
| Email | `config.supportEmail` | 🟡 |
| Facebook / Instagram | `config.facebookUrl` / `config.instagramUrl` | 🟡 |
| Subtext ("Available 24/7 for guest services" / "Response within 24 hours") | hardcoded | 🔴 |
| "Booking modifications?" FAQ box | hardcoded | 🔴 |
| Form labels / placeholders / buttons | hardcoded | 🔴 |
| "find our resort" / "Located strategically in Tagbilaran City, Bohol" | hardcoded | 🔴 |

### 1.11 `/privacy` Privacy — `PrivacyPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Custom body override | `settings/websiteContent.privacyPolicyBody` | 🟢 |
| "Last Updated" date | `config.privacyPolicyLastUpdated` (overridden by `websiteContent.privacyPolicyLastUpdated`) | 🟢/🟡 |
| All structured sections (1-6: Who We Are, What We Collect, How Long We Keep It, Who We Share With, Your Rights, DPO Contact) | hardcoded (only reachable if `privacyPolicyBody` is empty) | 🔴 |
| DPO email | `config.dpoEmail` | 🟡 |

### 1.12 `/terms` Terms — `TermsPage.tsx`

| Section | Content | Tag |
|---|---|---|
| "Last Updated" date | `config.termsLastUpdated` (no Settings surface today) | 🟡 |
| All 11 sections (Booking Agreement, Accuracy, Payment, Cancellation, Senior/PWD, Conduct, Liability, Privacy, Data Retention, Governing Law, Contact) | hardcoded | 🔴 |
| Support email | `config.supportEmail` | 🟡 |

### 1.13 `/*` 404 — `NotFoundPage.tsx`

| Section | Content | Tag |
|---|---|---|
| "Page not found" / "lost in bohol?" / "We couldn't find the page…" / "Back to Homepage" | hardcoded | 🔴 |

### 1.14 `/my-booking` Booking lookup — `BookingLookupPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Form labels, placeholders, validation, success/error copy | hardcoded | 🔴 |

### 1.15 `/signin` / `/signup` Auth — `SignInPage.tsx` / `SignUpPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Headings, body copy, form labels, placeholders, button text, OAuth copy | hardcoded | 🔴 |

### 1.16 `/account/profile` Member portal — `ProfilePage.tsx`

| Section | Content | Tag |
|---|---|---|
| "Standard Member" tier label | hardcoded | 🔴 |
| "Earn points" / "Member Discounts" labels in confirm upsell | hardcoded | 🔴 |

### 1.17 `/intercom/:roomId` In-room chat — `IntercomPage.tsx`

| Section | Content | Tag |
|---|---|---|
| Quick request chips ("Extra Towels" / "Bottled Water" / "Room Cleaning" / "Do Not Disturb") | `hotelConfig.intercomQuickRequests` | 🟢 |
| Notification sound URL | `hotelConfig.notificationSoundUrl` | 🟢 |
| Chat copy, store panel copy, all UI labels | hardcoded | 🔴 |

### 1.18 Public emails (Resend templates)

| Template | Source | Tag |
|---|---|---|
| Email layout (header / footer / colors) | `api/lib/emailLayout.ts` reads `config.colors.primary`, `config.brandName`, `config.logos.navbar`, `config.address.*`, `config.frontDeskPhone`, `config.supportEmail`, `config.checkInTime`/`checkOutTime`, `config.locale`/`config.timezone`/`config.currency` | 🟡 |
| Per-trigger subject lines + body copy | hardcoded in `api/handlers/email/*.ts` and `api/lib/emailTemplates.ts` | 🔴 |

---

## Section 2 — Snapshot: what's already dynamic today

The current editor surface is wide. The following list enumerates every Settings tab in the admin app and the data it already covers. Anything *not* on this list is either config-only or hardcoded.

### 2.1 Settings → Hotel
- `hotelName`, `contactEmail`, `contactPhone`, `checkInTime`, `checkOutTime`
- `missionStatement`, `visionStatement`, `hotelStory`
- `paymentMethods[]` (label, isEnabled, qrUrl, accountInfo)
- `intercomQuickRequests[]`
- `notificationSoundUrl`
- `roomTypes[]` (label, shortLabel, bedDefinition, description, amenities, maxCapacity, pricePerNight, weekendRate, corporateRate, imageUrls[])

### 2.2 Settings → Branding
- 4 hero photos (homepage, about, corporate, rewards) — upload + reset
- Homepage hero heading + subtext
- About hero heading
- Corporate hero eyebrow + heading + subtext
- Rewards hero eyebrow + heading + subtext
- 3 logo overrides (navbar, navbar on dark, footer)

### 2.3 Settings → Website Content
- Homepage amenities (list editor)
- Homepage services (list editor)
- Homepage featured room types (type picker)
- Homepage Spark Rewards promo (enabled, heading, description, perks)
- Corporate perks (list editor)
- Corporate rooms overview (eyebrow, heading, description)
- Corporate retreat CTA (heading, description, ctaLabel)

### 2.4 Settings → Loyalty Rewards
- Program name (`rewardsName`)
- Tagline
- Points enabled, earning mode, points per booking, points per ₱100
- Points redemption rate
- Member discount enabled + %

### 2.5 Settings → Breakfast & Dining
- Enabled
- Rate per person per night
- Silog items (active/inactive toggle)

### 2.6 Settings → In-Room Store
- Enabled
- Low stock threshold
- Payment methods (label, enabled, QR, account info)
- Store items (CRUD)

### 2.7 Settings → Email Config
- Read-only env var display + 7 active email triggers list

### 2.8 Settings → Intercom
- Quick requests (CRUD)
- Notification sound URL + preview
- (also under Hotel tab for some properties — see Decision #107)

### 2.9 Settings → Legal Content
- Privacy policy body (full-text)
- Cancellation policy
- House rules
- Privacy last-updated (auto-set on save)

### 2.10 Settings → Staff Accounts
- Create staff (name, email, password, phone, role)
- Disable staff (with confirm)

---

## Section 3 — Recommendations

The goal is to give the hotel owner enough control over the public surface that they can run the site day-to-day (update marketing copy, change photos, publish a new policy), without turning the Settings page into a CMS for every microstring.

I recommend a **3-tier framework**. Every new editor field is assigned to a tier based on the question: *would the hotel owner reasonably want to change this in the first 6 months of running the live site?*

### Tier A — Make dynamic (high leverage, owner definitely wants)

These are the strings the owner will want to change without a code redeploy. They are the highest-leverage additions to the editor surface.

| Field | Page(s) | Settings tab | Effort |
|---|---|---|---|
| `tagline` (homepage hero eyebrow) | `/` | Branding | XS (read from `settings/websiteContent.homepage.heroEyebrow`, fallback to `config.tagline`) |
| `brandPromise` (footer + about banner) | `/`, `/about`, footer | Branding | S (new editor field; same fallback to `config.brandPromise`) |
| `address.street` / `city` / `region` / `postalCode` | footer, `/`, `/contact` | Hotel | S (new editor block; or move into existing Hotel tab) |
| `frontDeskPhone` / `supportEmail` / `dpoEmail` | footer, `/contact`, `/privacy`, `/terms` | Hotel | S |
| `facebookUrl` / `instagramUrl` | footer, `/contact` | Hotel | XS |
| Homepage section eyebrows + titles + leads (Stay with us, Amenities, Services, Spark Rewards, Location) | `/` | Website Content | M (extend the existing `homepage` editor block with eyebrow/title/lead per section) |
| About hero eyebrow ("Our Story") + subtext | `/about` | Branding | XS |
| About hero copy + mission/vision footer chips ("Intentional Care & Consistency" / "A Premium Sanctuary in Bohol") | `/about` | Branding | S |
| About "Heritage & Growth" eyebrow + "The Spark of Hospitality" heading | `/about` | Branding | XS |
| Contact hero (eyebrow / title / lead) + "direct channels" / "send a message" + address subtext + "find our resort" section | `/contact` | Website Content (new `contact` sub-object) | S |
| Contact "Booking modifications?" FAQ copy | `/contact` | Website Content (same `contact` sub-object) | XS |
| Corporate "Onboarding Flow" 3-step process (titles + descriptions + photo) | `/corporate` | Website Content (new `corporate.onboardingSteps[]`) | M (list editor; 3 steps is a small list) |
| Corporate "Book with Corporate Rate" / "Submit an Inquiry" CTA labels | `/corporate` hero | Branding | XS |
| Corporate "Exclusive Client Benefits" / "Unrivaled Professional Perks" eyebrows + title | `/corporate` perks section | Website Content | XS |
| Corporate "Type Details" / "Inquire" / "Inquire About This Type" modal labels | `/corporate` | Website Content (new `corporate.cardLabels` block) | XS |
| Corporate inquiry form labels + placeholders + button + success/error copy | `/corporate` | Website Content (new `corporate.inquiryForm` block) | S |
| Rewards hero CTAs ("Join Spark Rewards" / "Sign In" / "Enroll (One-Click)" / "Go to My Rewards Dashboard") | `/rewards` | Branding | XS |
| Rewards "How It Works" — eyebrow + title + 3 step cards (title + description per step) | `/rewards` | Website Content (new `rewards.howItWorks` block) | M (list editor) |
| Rewards "Member Privileges" — eyebrow + title + lead + 4 perk cards (title + description per card) | `/rewards` | Website Content (new `rewards.privileges[]` block) | M (list editor) |
| Rewards bottom CTA banner heading + body | `/rewards` | Website Content (extend `rewards` block) | XS |
| Booking confirmation headlines + subtext + "Booking Reference" eyebrow + reservation card labels + payment method display labels + email banner + calendar button labels + empty state copy | `/book/confirm` | Website Content (new `bookingConfirm` block) | S |
| Booking confirmation Spark Rewards upsell block (heading, body, perk labels, button labels) | `/book/confirm` | same `bookingConfirm` block | S |
| Booking flow step labels + section eyebrows + "Book your stay" / "View rooms" / "Continue to Step 3" / "Ready for review and payment" / "Complete required fields and consent" CTAs | `/book` | Website Content (new `bookingFlow` block) | M |
| Booking flow field labels + placeholders | `/book` | same `bookingFlow` block | M |
| Booking flow validation messages + voucher error messages | `/book` | same `bookingFlow` block | M |
| Booking flow payment method card labels + "Pay at Hotel" / "Digital Wallet / GCash or Maya" / etc. | `/book` | same `bookingFlow` block | S |
| Rooms page eyebrow + title + lead + "Beds" / "Capacity" / "Weekend" / "Amenities" / "Book this type" / "Empty state" copy | `/rooms` | Website Content (new `roomsCatalog` block) | S |
| 404 page copy ("Page not found" / "lost in bohol?" / body / "Back to Homepage") | `/*` | Website Content (new `notFound` block) | XS |
| Spark Rewards program name ("Spark Rewards" in pill, etc.) | `/`, `/rewards`, member portal | already a Settings field (`rewardsConfig.rewardsName`) | ✅ already dynamic — verify it's the one rendered on `/rewards` |
| Privacy page "Last Updated" date | `/privacy` | already a Settings field | ✅ already dynamic |
| Privacy page structured fallback body | `/privacy` | (only used if `privacyPolicyBody` is empty) | defer — keep hardcoded fallback for now |
| Terms page "Last Updated" date | `/terms` | Website Content (new `termsLastUpdated` field) | XS |
| Terms page full body override | `/terms` | Website Content (new `termsBody` field) | S (mirror of `privacyPolicyBody`) |
| Footer link labels + order | footer | (defer — see Tier C) | n/a |
| Navbar link labels + order | navbar | (defer — see Tier C) | n/a |

### Tier B — Keep hardcoded (low leverage, owner does not need to edit)

These are "product chrome" — the owner will not realistically want to change them in the first 6 months. If a hotel later asks to customize any of them, we can promote the individual field to Tier A on demand. **Adding them now would just add editor fields the owner has to ignore.**

- **Form validation messages** (email, phone, guest count, etc.) on `/book` Step 2 — code-side concern, never a hotel-content concern
- **Step labels and "Step N of 4" eyebrows** on `/book` — product IA, not marketing copy
- **Sign-in / sign-up page copy** — product IA, not marketing copy
- **404 page copy** — defer to Tier A; it's small but not high-leverage
- **Booking confirmation page labels** — defer to Tier A in bulk; they're tier-A but not "must ship first"
- **Member portal tier label ("Standard Member")** — defer until the loyalty tier system is built (Phase 2)

### Tier C — Defer to white-label config (not editor)

These are the values that change **once per hotel deployment**, not **once per quarter**. They belong in `hotel.config.ts` (which the white-label config doc says is the right place) — not in the editor.

- Brand name (`brandName`)
- Rewards program name (`rewardsName`) — actually dynamic in `rewardsConfig.rewardsName` already, see Section 3.1 below
- Legal name (`legalName`)
- Tagline (`tagline`) — promote to Tier A for the home hero, but the source of truth is still `hotel.config.ts` until first edit
- Brand promise (`brandPromise`) — same
- Address (street, city, region, postal)
- Front-desk phone / support email / DPO email
- Facebook / Instagram URLs
- Logos (the source files, not the runtime overrides)
- Favicon, OG image
- Currency / locale / timezone
- Color tokens (`primary`, `sidebar`, etc.) — keep in `hotel.config.ts` per `WHITE-LABEL.md`
- Font choices

### Tier D — Defer (Phase 2 / post-launch)

These are real content fields but they don't have a clear editor story yet, and shipping them now would force a UX decision that the owner has not asked for. Defer them and revisit in Phase 2.

- **Email subject + body for each of the 7 transactional triggers** — at most hotels, the same templates work; if a hotel asks for a custom welcome email, scope a separate "Email Templates" tab
- **In-room chat copy** (`/intercom`) — the entire panel is hardcoded; it has no marketing surface, so this is just product IA
- **Privacy page structured fallback body** — only shown if `privacyPolicyBody` is empty; not worth surfacing as a separate editor
- **Member portal "Standard Member" tier label and tier-specific copy** — depends on the tier system that doesn't exist yet

---

## Section 4 — Work plan

The Tier A items are the actual scope. The Tier A list is too long to ship as a single PR — split into three sequenced PRs, each one a single Settings-tab extension.

### PR 1 — `feat/content-tier-a-branding` (S effort, ~1 day)

Extends the existing **Branding** tab. All items are read from `settings/websiteContent.*` and rendered with `usePublicSiteContent` — no new Firestore collections, no new hooks.

New editor fields:
- `websiteContent.homepage.heroEyebrow` (optional override of `config.tagline`)
- `websiteContent.about.heroEyebrow` ("Our Story")
- `websiteContent.about.heroSubtext`
- `websiteContent.about.missionFooterLabel` / `visionFooterLabel`
- `websiteContent.about.heritageEyebrow` / `heritageHeading`
- `websiteContent.corporate.heroCtaBook` / `heroCtaInquiry`
- `websiteContent.rewards.heroCtaJoin` / `heroCtaSignIn` / `heroCtaEnroll` / `heroCtaMember`

Files touched:
- `admin-app/src/pages/SettingsPage.tsx` (extend the Branding form)
- `admin-app/src/context/AdminContext.tsx` (extend `mergeWebsiteContent` + `setWebsiteContent` useState seed)
- `guest-app/src/hooks/usePublicSiteContent.ts` (extend the `PublicSiteContent` interface + `buildFallback` + `pickString` chain)
- `guest-app/src/pages/HomePage.tsx`, `AboutPage.tsx`, `CorporateStaysPage.tsx`, `RewardsLandingPage.tsx` (swap hardcoded strings for `usePublicSiteContent` reads)

Test: extend `admin-app/src/__tests__/branding-content-fields.test.ts` + `guest-app/src/__tests__/usePublicSiteContent.test.ts`.

### PR 2 — `feat/content-tier-a-website` (M effort, ~2 days)

Extends the existing **Website Content** tab with new sub-objects for the rest of the public-facing pages.

New editor fields (in `settings/websiteContent`):
- `homepage.sectionHeaders: { stayWithUs, amenities, services, sparkRewards, location }` — eyebrow + title + lead per section
- `roomsCatalog: { eyebrow, title, lead, emptyStateTitle, emptyStateBody, cardLabels: { beds, capacity, weekend, amenities, book } }`
- `contact: { heroEyebrow, heroTitle, heroLead, infoHeading, formHeading, addressAvailableNote, emailResponseNote, mapTitle, mapSubtext, faqHeading, faqBody }`
- `corporate: { perksSectionEyebrow, perksSectionTitle, typeDetailsLabel, inquireLabel, inquiryForm: { labels, placeholders, button, success, error } }`
- `corporate: { onboardingSteps: [{ title, description, iconKey }] }` (3-step list, mirrors the `perks[]` editor)
- `rewards: { howItWorks: { eyebrow, title, steps: [{ title, description, iconKey }] }, privileges: { eyebrow, title, lead, perks: [{ title, description, iconKey }] }, ctaBanner: { heading, body } }`
- `bookingFlow: { stepLabels: [...], sectionHeaders: {...}, fieldLabels: {...}, placeholders: {...}, validationMessages: {...}, voucherErrorMessages: {...}, paymentMethodCards: [...], ctas: { bookStay, viewRooms, continue, ready, incomplete } }`
- `bookingConfirm: { headlinePending, headlineConfirmed, subtextPending, subtextConfirmed, detailsLabels, paymentMethodLabels, calendarButtons, upsellHeading, upsellBody, upsellPerks, upsellButtons, emptyState }`
- `notFound: { eyebrow, title, body, cta }`
- `termsLastUpdated: string`
- `termsBody: string` (full-text override, mirrors `privacyPolicyBody`)

Files touched: same as PR 1, plus the `ListEditor` component is reused (no new editor component needed).

Test: extend `admin-app/src/__tests__/website-content-fields.test.ts` + new `guest-app/src/__tests__/content-tier-a-render.test.ts` covering each new field's `pickString` chain end-to-end.

### PR 3 — `feat/content-tier-a-hotel` (S effort, ~1 day)

Extends the existing **Hotel** tab with the contact details + social URLs that are currently only in `hotel.config.ts`. (Optional: do this in PR 1 if the work is too small to justify a separate PR.)

New editor fields (in `settings/hotelConfig`):
- `address: { street, city, region, postalCode }`
- `frontDeskPhone`
- `supportEmail`
- `dpoEmail`
- `facebookUrl`
- `instagramUrl`

Fallback chain in `usePublicSiteContent`: Firestore value → `config.*`. The white-label config file becomes a deploy-time default only.

Files touched: `hotel.config.ts` (no change — still serves as the deploy-time default), `admin-app/src/pages/SettingsPage.tsx`, `admin-app/src/context/AdminContext.tsx`, `guest-app/src/hooks/usePublicSiteContent.ts`, all footer / navbar / `/contact` / `/privacy` / `/terms` reads.

Test: `admin-app/src/__tests__/hotel-contact-fields.test.ts` + render tests in `guest-app/`.

### Effort summary

| PR | Effort | Files touched | New editor fields |
|---|---|---|---|
| PR 1 — Branding extension | S | 6 | ~12 |
| PR 2 — Website Content extension | M | 8 + ListEditor reuse | ~80 (across all sections) |
| PR 3 — Hotel contact extension | S | 4 | 6 |

Total: ~100 new editor fields. Most of those are simple `string` fields that mirror the `ListEditor` pattern already in use. The actual implementation cost is in the per-page `usePublicSiteContent` reads and the corresponding `pickString` chain, not in the editor UI.

---

## Section 5 — What we explicitly decided NOT to do, and why

The following surfaces were considered and deferred. Recording the decision here so we don't re-litigate it next quarter.

### 5.1 Footer / Navbar link order

The footer has 8 links and the navbar has 7. Both are hardcoded arrays of `{label, to}` tuples.

**Why not editable:** the link set is part of the information architecture, not the content. If the owner wants to add a "Blog" link, that's a product change, not a content edit. Surface this only if a hotel actually asks for it.

### 5.2 Form validation messages + voucher error messages on `/book`

`BookingPage.tsx` has ~15 inline error messages and 5 voucher-specific ones in the `voucherMessages` map.

**Why not editable:** these are part of the booking flow's contract with the guest, not marketing copy. The owner never edits them; if they're wrong, we fix them in code.

### 5.3 Payment method card labels on `/book` Step 3 + `/book/confirm`

The 4 payment methods each have a short title + subtitle on the booking Step 3 card, and a display label on the confirm page.

**Why not editable:** these labels are tightly coupled to the payment methods themselves, which are already editable in Settings → Hotel (the `paymentMethods[]` block). If the owner wants to rename "Digital Wallet" to "E-Wallet", they can already do it in the existing payment-method editor — the only thing that doesn't reflect the change is the booking-flow card. **Decision: fix the bug, don't add new fields.** Wire the Step 3 card subtitle to read from `hotelConfig.paymentMethods[method].label` (falling back to a sensible default for the "Pay at Hotel" pseudo-method). This closes the gap without adding editor surface.

### 5.4 Sign-in / sign-up page copy

The auth pages have full page copy in `SignInPage.tsx` and `SignUpPage.tsx`.

**Why not editable:** these are product IA, not marketing copy. The owner is not going to rewrite the sign-up form labels. If they do (e.g. for a white-label spin), we ship a config-level change, not an editor field.

### 5.5 Email subject + body for the 7 transactional triggers

Each trigger has a hardcoded subject + body in `api/handlers/email/*.ts` and `api/lib/emailTemplates.ts`.

**Why not editable yet:** the templates use handlebars-style `{{guestName}}` interpolation and follow a layout that the owner has never asked to customize. If a hotel ever asks to send a custom welcome email, the work is a separate "Email Templates" tab — not a Tier A item. The current design (one email layout, one body per trigger) is intentional.

### 5.6 In-room chat copy (`/intercom`)

The entire guest intercom page is hardcoded. The owner has no marketing surface there.

**Why not editable:** the chat panel is product IA. The only configurable parts (quick request chips, notification sound) are already dynamic.

### 5.7 Privacy page structured fallback

The 6-section structured privacy body in `PrivacyPage.tsx` is only used when `websiteContent.privacyPolicyBody` is empty. The structured version exists as a deploy-time fallback.

**Why not editable:** if the owner wants to customize the privacy policy, they use the existing `privacyPolicyBody` textarea in Settings → Legal Content. The structured fallback is a "ship Spark Inn with a sensible default policy" convenience, not a long-term editor surface.

### 5.8 Member portal tier labels

The "Standard Member" badge on `ProfilePage.tsx:171` is hardcoded. There's no tier system yet.

**Why not editable:** the loyalty tier system is Phase 2. Adding a "tier label" editor field today would be one field for one string, and we'd have to redesign the editor in Phase 2 anyway. Defer.

---

## Section 6 — Open questions

If any of these answers change, the recommendation in Section 3 changes with them. **Surface these to the hotel owner during the staging review.**

1. **Does the owner want a custom "tagline" and "brand promise" different from `config.tagline` and `config.brandPromise`?** If yes, Tier A is right. If no, the white-label config file is enough.
2. **Does the owner want to customize the booking flow copy?** Most hotel SaaS sites do not let the owner rewrite the booking form labels. Confirm before PR 2.
3. **Does the owner want to customize the email subjects and bodies?** If yes, scope a Phase 12.1 "Email Templates" tab — see Section 5.5.
4. **Does the owner want the Spark Rewards "Member Privileges" copy to be different from the current 4 hardcoded cards?** If yes, Tier A covers it. If no, keep hardcoded.

These questions are tracked under Phase 11.8 in `ROADMAP.md` — close them with the owner during staging review.
