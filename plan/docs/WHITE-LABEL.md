# White-Label Deployment Guide
> Requires: CLAUDE.md, docs/FILE-STRUCTURE.md, docs/FRONTEND.md

---

## Overview

This codebase is a white-label hotel booking and management system. Spark Inn is the first client deployment. Every brand value — colors, fonts, logos, name, room types, currency, locale, legal content — lives in `hotel.config.ts` or Firestore Settings. No code changes are needed to rebrand for a new hotel client.

---

## What Is Config-Driven vs. Runtime

| Concern | Where it lives | Changed by |
|---|---|---|
| Brand colors | `hotel.config.ts` | DK (deploy-time) |
| Fonts | `hotel.config.ts` | DK (deploy-time) |
| Logos + favicon | `hotel.config.ts` + `public/brand/` | DK (deploy-time) |
| Hotel name, tagline | `hotel.config.ts` | DK (deploy-time) |
| Legal name, DPO email | `hotel.config.ts` | DK (deploy-time) |
| Room type definitions | `hotel.config.ts` | DK (deploy-time) |
| Currency + locale + timezone | `hotel.config.ts` | DK (deploy-time) |
| Booking ref prefix | `hotel.config.ts` | DK (deploy-time) |
| Page titles, SEO meta | `hotel.config.ts` | DK (deploy-time) |
| Analytics ID | `hotel.config.ts` | DK (deploy-time) |
| Domain | Vercel + Firebase Console | DK (deploy-time) |
| Hotel address, contact | Firestore `settings/hotelConfig` | Hotel admin (runtime) |
| Room inventory, rates | Firestore | Hotel admin (runtime) |
| Payment methods | Firestore `settings/hotelConfig` | Hotel admin (runtime) |
| Privacy policy body | Firestore `settings/websiteContent` | Hotel admin (runtime) |
| Cancellation policy | Firestore `settings/websiteContent` | Hotel admin (runtime) |
| House rules | Firestore `settings/websiteContent` | Hotel admin (runtime) |
| Website content | Firestore `settings/websiteContent` | Hotel admin (runtime) |
| Staff accounts | Firebase Auth | Hotel admin (runtime) |

---

## `hotel.config.ts` — Full Schema

Lives at repo root. Imported by both apps via `@config` alias.

```
HotelConfig {

  // Identity
  hotelId: string           // unique slug e.g. "spark-inn", "ocean-view-hotel"
  brandName: string         // display name e.g. "spark inn" — exact casing as intended
  legalName: string         // legal business name e.g. "Spark Inn Hotel Corp"
  tagline: string
  brandPromise: string

  // Booking
  bookingRefPrefix: string        // e.g. "SI" → generates "SI-20260601-001"
  memberNumberPrefix: string      // e.g. "SR" → generates "SR-00042"
  storeName: string               // e.g. "Spark Essentials" — shown in store UI, emails, receipts

  // Colors
  colors: {
    primary: string         // main CTA color e.g. "#EA8A1A"
    primaryDark: string     // hover state e.g. "#C4720E"
    primaryLight: string    // tint/background e.g. "#FEF3E2"
    sectionBg: string       // alternating section bg e.g. "#FDF8F3"
    sidebar: string         // dashboard sidebar bg e.g. "#111827"
  }

  // Typography
  fonts: {
    heading: {
      name: string          // CSS font-family name e.g. "Apollo"
      files: {
        regular: string     // path in public/brand/fonts/ e.g. "APOLLO.otf"
        italic: string      // optional italic variant
      }
      letterSpacing: string // e.g. "0.06em"
    }
    body: {
      name: string          // CSS font-family name e.g. "Inter"
      source: string        // "google" | "local" | "system"
      googleFamily: string  // if source = "google" e.g. "Inter:wght@400;500;600;700"
      localFile: string     // if source = "local", path in public/brand/fonts/
    }
  }

  // Logos (filenames in public/brand/)
  logos: {
    standard: string        // default stacked lockup
    white: string           // white version for dark backgrounds
    navbar: string          // horizontal lockup for navbar
    icon: string            // icon only (favicon-safe)
    wordmark: string        // wordmark only
  }
  favicon: string           // filename in public/brand/

  // Room Types — fully flexible per hotel
  roomTypes: {
    value: string           // internal key e.g. "deluxe-sea-view" (used in Firestore)
    label: string           // display label e.g. "Deluxe Sea View"
    shortLabel: string      // for badges/chips e.g. "Deluxe"
  }[]

  // Locale & Currency
  currency: string          // ISO 4217 e.g. "PHP", "USD", "SGD"
  currencySymbol: string    // e.g. "₱", "$", "S$"
  locale: string            // BCP 47 e.g. "en-PH", "en-US", "en-SG"
  timezone: string          // IANA tz e.g. "Asia/Manila", "America/New_York"
  dateFormat: string        // display format e.g. "MMM DD, YYYY"
  phoneCountryCode: string  // e.g. "+63", "+1"

  // Legal & Privacy
  dpoEmail: string          // Data Protection Officer contact email
  privacyPolicyLastUpdated: string  // e.g. "June 2, 2026"
  applicableLaw: string     // e.g. "Republic Act No. 10173 (Data Privacy Act of 2012)"

  // SEO & Meta
  pageTitle: string         // browser tab prefix e.g. "spark inn"
  metaDescription: string   // default SEO description
  ogImage: string           // Open Graph image filename in public/brand/ (1200×630px)

  // Structured address — used in LodgingBusiness JSON-LD schema
  address: {
    street: string          // e.g. "J. Borja St"
    city: string            // e.g. "Tagbilaran City"
    region: string          // e.g. "Bohol"
    postalCode: string      // e.g. "6300"
  }

  // Analytics (optional)
  analyticsId: string       // Google Analytics 4 Measurement ID e.g. "G-XXXXXXXXXX" — empty string to disable

  // Contact (optional extras)
  whatsappNumber: string    // e.g. "+639171234567" — empty string to hide

  // Contact extras
  frontDeskPhone: string    // used as tel: fallback in WebRTC intercom call

  // Domains
  domain: string            // e.g. "sparkinnbohol.com"
  adminDomain: string       // e.g. "admin.sparkinnbohol.com"
  supportEmail: string      // displayed in Privacy Policy + footer
}
```

---

## Spark Inn Config (Reference Implementation)

```
hotelId: "spark-inn"
brandName: "spark inn"
legalName: "Spark Inn Hotel Corp"
tagline: "Where comfort is felt, care is intentional, and every stay is consistent."
brandPromise: "Peaceful, consistent stay where guests feel warmth of genuine, intentional hospitality."

bookingRefPrefix: "SI"
memberNumberPrefix: "SR"
storeName: "Spark Essentials"

colors:
  primary: "#EA8A1A"
  primaryDark: "#C4720E"
  primaryLight: "#FEF3E2"
  sectionBg: "#FDF8F3"
  sidebar: "#111827"

fonts:
  heading:
    name: "Apollo"
    files:
      regular: "APOLLO.otf"
      italic: "APOLLOItalic.otf"
    letterSpacing: "0.06em"
  body:
    name: "Inter"
    source: "google"
    googleFamily: "Inter:wght@400;500;600;700"

logos:
  standard: "FINAL LOGO.png"
  white: "FINAL LOGO-white.png"
  navbar: "nav-bar-logo.png"
  icon: "ICON LOGO.png"
  wordmark: "TEXT LOGO.png"
favicon: "favicon.ico"

roomTypes:
  - { value: "single", label: "Single", shortLabel: "Single" }
  - { value: "standard-double", label: "Standard Double", shortLabel: "Std Double" }
  - { value: "standard-twin", label: "Standard Twin", shortLabel: "Std Twin" }
  - { value: "executive", label: "Executive", shortLabel: "Executive" }
  - { value: "family", label: "Family", shortLabel: "Family" }

currency: "PHP"
currencySymbol: "₱"
locale: "en-PH"
timezone: "Asia/Manila"
dateFormat: "MMM DD, YYYY"
phoneCountryCode: "+63"

dpoEmail: "sparkinn.reservations@gmail.com"
privacyPolicyLastUpdated: "June 2, 2026"
applicableLaw: "Republic Act No. 10173 (Data Privacy Act of 2012)"

pageTitle: "spark inn"
metaDescription: "Book your stay at spark inn — a boutique hotel in Bohol, Philippines."
ogImage: "og-image.png"

address:
  street: "J. Borja St"
  city: "Tagbilaran City"
  region: "Bohol"
  postalCode: "6300"

frontDeskPhone: "+63-38-000-0000"   // update with real number before launch

analyticsId: ""
whatsappNumber: ""

domain: "sparkinnbohol.com"
adminDomain: "admin.sparkinnbohol.com"
supportEmail: "sparkinn.reservations@gmail.com"
```

---

## How Config Is Used

- **Tailwind** — `tailwind.config.ts` reads colors and fonts from config at build time
- **CSS variables** — config colors injected on `:root` for non-Tailwind use
- **Font loading** — heading font loaded via `@font-face` in `index.html`; body font loaded via Google Fonts link if `source: "google"`
- **Logos** — all components reference `config.logos.*` — never hardcoded filenames
- **Brand name** — all UI copy uses `config.brandName` — never hardcoded strings
- **Room types** — dropdowns, filters, and rate tables built dynamically from `config.roomTypes[]`
- **Currency** — all price displays use `config.currencySymbol` + `config.locale` for number formatting
- **Dates** — all date displays use `config.dateFormat` and `config.timezone`
- **Booking ref** — format is `{bookingRefPrefix}-{YYYYMMDD}-{NNN}`
- **Member number** — format is `{memberNumberPrefix}-{NNNNN}` (zero-padded 5 digits)
- **Store name** — all store UI labels, the intercom "Shop" tab title, emails, and receipts use `config.storeName`
- **Page titles** — `<title>{pageTitle} | {pageName}</title>` on every page
- **Open Graph** — `og:title`, `og:description`, `og:image` populated from config
- **Analytics** — GA4 script injected only if `analyticsId` is non-empty
- **WhatsApp** — contact link shown in footer/contact page only if `whatsappNumber` is non-empty

---

## Runtime-Editable Legal Content (Firestore `settings/websiteContent`)

These fields are editable by the hotel admin from Settings — no redeploy needed:

- `privacyPolicyBody` — full privacy policy text (plain text or light markdown)
- `cancellationPolicy` — displayed at booking Step 3 and in confirmation emails
- `houseRules` — used in guest registration PDF at check-in

---

## Deploying for a New Hotel Client

### Step 1 — Fork or copy the repo
New repo per client. Do not modify the Spark Inn repo.

### Step 2 — Set up Firebase project
New Firebase project for the client. Enable Auth, Firestore, Storage. Copy config to `.env` files.

### Step 3 — Set up Vercel
New Vercel project. Connect repo. Set all env vars. Configure custom domains.

### Step 4 — Fill in `hotel.config.ts`
Update all fields for the client. Define their room types in `roomTypes[]`.

### Step 5 — Drop brand assets in `public/brand/`
Fonts, logos, favicon, OG image. Filenames must match paths in `hotel.config.ts`.

### Step 6 — Seed Firestore
Create `settings/hotelConfig`, `settings/websiteContent` (with privacy policy, cancellation policy, house rules). Create room documents using the `value` keys from `config.roomTypes`. Create first admin account.

### Step 7 — Test
- All pages render with correct brand, colors, fonts, logos
- Room type dropdowns show client's room types
- Prices display in correct currency
- Dates in correct timezone/format
- Booking ref uses correct prefix
- Privacy policy page shows client's legal content
- Footer shows correct hotel name and version

---

## Asset Checklist for New Client

- [ ] Brand primary color (hex)
- [ ] Heading font files (OTF/TTF/WOFF2) or Google Fonts name
- [ ] Body font name (Google Fonts or local)
- [ ] Logo — standard stacked
- [ ] Logo — white version
- [ ] Logo — navbar/horizontal
- [ ] Logo — icon only
- [ ] Logo — wordmark only
- [ ] Favicon
- [ ] Open Graph image (1200×630px)
- [ ] Hotel name (exact casing)
- [ ] Legal business name
- [ ] Tagline
- [ ] Room type list (name + short label per type)
- [ ] Currency + locale
- [ ] Timezone
- [ ] DPO contact email
- [ ] Domain + admin domain
- [ ] Privacy policy text
- [ ] Cancellation policy text
- [ ] House rules text
- [ ] Google Analytics ID (optional)
- [ ] WhatsApp number (optional)
- [ ] Booking reference prefix (2–4 letters)
- [ ] Member number prefix (2–4 letters, e.g. "SR")
- [ ] Store name (e.g. "Spark Essentials", "Blue Sky Store")

---

## References

- Config usage in UI: `plan/docs/FRONTEND.md`
- File locations: `plan/docs/FILE-STRUCTURE.md`
- Room type usage in rates: `plan/features/RATE-MANAGEMENT.md`
- Legal content editing: `plan/features/SETTINGS.md §Legal Content`
- Privacy policy page: `plan/features/STATIC-PAGES.md §Privacy Policy`
