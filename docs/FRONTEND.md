# Frontend Conventions
> Requires: CLAUDE.md, docs/WHITE-LABEL.md

---

## Design Philosophy

**Public Website (`guest-app`):** Warm Minimal — boutique hotel premium. Not budget, not flashy luxury. Lead with emotion, not features.

**Dashboard (`admin-app`):** Efficiency first. Front desk scans, not reads. Clean data hierarchy, no decorative elements.

---

## Config-Driven Tokens

All brand colors, fonts, and logo paths come from `hotel.config.ts` — never hardcoded in components or Tailwind config. See `docs/WHITE-LABEL.md` for full config schema.

`tailwind.config.ts` reads `hotel.config.ts` at build time and maps config values to Tailwind theme tokens. CSS variables are also injected on `:root` for non-Tailwind contexts.

---

## Brand Colors

Brand colors are per-client via `hotel.config.ts`. The Tailwind tokens below map to config values — the names are fixed, the values change per deployment.

| Tailwind Token | Config Key | Spark Inn Value | Usage |
|---|---|---|---|
| `primary` | `colors.primary` | `#EA8A1A` | All primary CTAs, active states, highlights |
| `primary-dark` | `colors.primaryDark` | `#C4720E` | Hover state for primary elements |
| `primary-light` | `colors.primaryLight` | `#FEF3E2` | Selected state backgrounds, badge backgrounds |
| `section-bg` | `colors.sectionBg` | `#FDF8F3` | Alternating public site section backgrounds |
| `sidebar` | `colors.sidebar` | `#111827` | Dashboard sidebar background |
| `gray-50` | fixed | `#F9FAFB` | Dashboard page background |
| `gray-100` | fixed | `#F3F4F6` | Table row hover, input backgrounds |
| `gray-200` | fixed | `#E5E7EB` | Borders, dividers |
| `gray-600` | fixed | `#4B5563` | Secondary body text |
| `gray-900` | fixed | `#111827` | Primary body text |

**Gray values are fixed across all deployments** — only the brand color tokens change per client.

**Always use Tailwind token names** (`primary`, `primary-dark`, etc.) in components — never raw hex values. This ensures rebranding requires only a config change.

---

## Status Badge Colors

| Status | Text Color | Background |
|---|---|---|
| Available / Confirmed | `#16A34A` | `#F0FDF4` |
| Occupied / Cancelled | `#DC2626` | `#FEF2F2` |
| Check-in Today / Warning | `#D97706` | `#FFFBEB` |
| Blocked | `#6B7280` | `#F3F4F6` |
| Pending | `#2563EB` | `#EFF6FF` |
| Checked In | `#EA8A1A` | `#FEF3E2` |
| Checked Out | `#6B7280` | `#F3F4F6` |
| Payment Uploaded | `#7C3AED` | `#F5F3FF` |
| Clean (HK) | `#16A34A` | `#F0FDF4` |
| Dirty (HK) | `#DC2626` | `#FEF2F2` |
| In Progress (HK) | `#D97706` | `#FFFBEB` |

---

## Typography

### Heading Font — config-driven
- Source: `hotel.config.ts → fonts.heading`
- Used for: display headings, hero text, section headings, H1, H2
- Italic variant (if provided): taglines, pull quotes, emotional emphasis ONLY
- Letter-spacing: `hotel.config.ts → fonts.heading.letterSpacing`
- Headlines: sentence case always
- Spark Inn uses Apollo (`APOLLO.otf` / `APOLLOItalic.otf`)

### Body Font — config-driven
- Source: `hotel.config.ts → fonts.body`
- Used for: all body copy, labels, navigation, dashboard, form fields
- Can be a Google Font or local file — see config `source` field
- Spark Inn uses Inter (Google Fonts)

### Type Scale

| Role | Font | Desktop | Mobile |
|---|---|---|---|
| Display / Hero | Apollo | 56–72px | 36–44px |
| H1 | Apollo | 40px | 28px |
| H2 | Apollo | 32px | 24px |
| H3 | Inter SemiBold | 24px | 20px |
| H4 | Inter SemiBold | 18px | 16px |
| Body | Inter Regular | 16px | 15px |
| Body Small | Inter Regular | 14px | 13px |
| Label | Inter Medium | 13px | 12px |

---

## Logo Usage

Logo file paths come from `hotel.config.ts → logos.*`. Never hardcode logo filenames in components — always reference config.

| Variant | Config Key | When to Use |
|---|---|---|
| Full Lockup — Standard | `logos.standard` | Default — light backgrounds, documents, receipts |
| Full Lockup — White | `logos.white` | Dark backgrounds, hero overlays, footer, sidebar |
| Navbar Horizontal | `logos.navbar` | Navigation bar ONLY |
| Icon Only | `logos.icon` | Favicons, loading states, small formats |
| Wordmark Only | `logos.wordmark` | Email headers, letterheads |

**Logo rules:** Never stretch, distort, recolor, or add effects. Min size (full lockup): 120px height. Navbar: 40px height. Brand icon color must always match `colors.primary`.

---

## Spacing & Sizing

**Breakpoints:**
- Mobile: 375px
- Tablet: 768px (dashboard minimum)
- Desktop: 1440px

**Border Radius:**
- Buttons / inputs: `8px`
- Cards: `12px`
- Large cards: `16px`
- Badges / pills: `9999px`

**Touch targets:** All form fields and interactive elements minimum `44px` height.

---

## Tailwind Configuration

`tailwind.config.ts` imports `hotel.config.ts` and maps brand values to Tailwind theme tokens (both apps share the same config via `shared/`):

- Colors: `primary`, `primary-dark`, `primary-light`, `section-bg`, `sidebar` — sourced from `hotel.config.ts`
- Font family: `heading` (from config), `body` (from config)
- Border radius: `card` (12px), `card-lg` (16px) — fixed across all deployments

**Never hardcode hex values in Tailwind config** — always read from `hotel.config.ts`. This is what makes the white-label system work.

---

## Component Conventions

- **Named exports** for all components — no default exports except pages
- **PascalCase** filenames for components (`RoomCard.tsx`, `BookingSummary.tsx`)
- **camelCase** filenames for hooks (`useRooms.ts`, `useBookings.ts`)
- **kebab-case** for all other files and folders
- One component per file
- Props interface defined inline above the component

---

## Framer Motion

- Use for: page transitions, modal open/close, card hover states, step transitions in booking flow
- Keep animations under `300ms` — never slow or decorative for the sake of it
- Dashboard: minimal animation — data visibility over aesthetics
- Public site: subtle entrance animations on scroll (opacity + translateY only)

---

## Data Fetching Patterns

**Firestore real-time data** (rooms, bookings, intercom):
- Use custom hooks in `firebase/` (`useRooms`, `useBookings`, etc.)
- Always return `{ data, loading, error }` shape
- Always unsubscribe `onSnapshot` in `useEffect` cleanup — see `docs/GOTCHAS.md`

**Vercel API routes** (email, voucher validation, code validation):
- Use TanStack Query (`useQuery` / `useMutation`)
- Pass Firebase ID token in `Authorization: Bearer <token>` header

---

## Form Validation

- Use Zod for all form schemas
- Derive TypeScript types from Zod schemas via `z.infer<typeof Schema>`
- Show inline validation errors — never block submit without visible feedback
- Error messages: friendly, specific — "Check-in date must be before check-out" not "Invalid date"

---

## Conversion Psychology (Public Site Only)

- **3-second rule:** Hero answers "why stay here?" emotionally before any words are read
- **Availability checker above the fold** — never make visitors hunt for it
- **Room cards:** Photo → Name → Amenities → Price (never price first)
- **Booking flow:** 4 steps builds progressive commitment — reassure with micro-copy at each step
- **Confirmation page:** celebratory — Peak-End Rule, last thing they feel
- **Never use:** fake countdowns, "X people viewing this", cold blue tones, pop-ups on load

---

## Currency & Locale

All price, date, and number formatting is config-driven — never hardcoded.

- **Currency symbol:** `config.currencySymbol` — e.g. `₱500` not `PHP500`
- **Number formatting:** use `Intl.NumberFormat(config.locale)` for prices — e.g. `₱1,500.00`
- **Date formatting:** use `config.dateFormat` + `config.timezone` for all date displays
- **Phone numbers:** prefix with `config.phoneCountryCode` in forms and display
- **Never hardcode `₱`, `PHP`, `Asia/Manila`, or `en-PH`** — use config values

---

## Room Types

Room type dropdowns, filters, rate tables, and badges are always built dynamically from `config.roomTypes[]`. Never hardcode room type strings like `"single"` or `"executive"` in UI components — iterate over `config.roomTypes` instead.

---

## Page Titles & SEO

### Meta Tags (all public pages)

All meta tags injected via a shared `<SEO>` component that accepts per-page overrides. Placed inside `<head>` via React Helmet or Vite's `index.html` + dynamic injection.

```
<title>{pageTitle} | {config.pageTitle}</title>
<meta name="description" content="{pageDescription}" />
<link rel="canonical" href="https://{config.domain}{currentPath}" />

<!-- Open Graph -->
<meta property="og:type" content="{ogType}" />         <!-- "website" default, "article" for blog -->
<meta property="og:title" content="{pageTitle} | {config.pageTitle}" />
<meta property="og:description" content="{pageDescription}" />
<meta property="og:image" content="https://{config.domain}/brand/{config.ogImage}" />
<meta property="og:url" content="https://{config.domain}{currentPath}" />
<meta property="og:locale" content="{config.locale}" />
<meta property="og:site_name" content="{config.brandName}" />

<!-- Twitter/X Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{pageTitle} | {config.pageTitle}" />
<meta name="twitter:description" content="{pageDescription}" />
<meta name="twitter:image" content="https://{config.domain}/brand/{config.ogImage}" />
```

### Per-Page Titles & Descriptions

| Page | Title | Meta Description |
|---|---|---|
| Homepage `/` | `{config.brandName} — Bohol Hotel` | `Stay at {config.brandName} in Tagbilaran City, Bohol. Book comfortable rooms with free WiFi, great service, and easy online booking. Best rates guaranteed.` |
| Rooms `/rooms` | `Rooms & Rates` | `Browse all room types at {config.brandName}. Single, Standard, Executive, and Family rooms available. Check availability and book directly for the best rate.` |
| About `/about` | `About Us` | `Learn about {config.brandName} — our story, mission, and commitment to warm, reliable hospitality in the heart of Tagbilaran City, Bohol.` |
| Corporate `/corporate` | `Corporate Stays` | `{config.brandName} offers corporate rates, group bookings, and dedicated account management for business travelers in Bohol. Inquire today.` |
| Contact `/contact` | `Contact Us` | `Get in touch with {config.brandName}. Find our address, phone number, email, and location map. We're happy to help with your booking.` |
| Booking `/book` | `Book Your Stay` | `Book your stay at {config.brandName} online. Choose your dates, select a room, and confirm your reservation in minutes.` |
| Booking Confirmation `/book/confirm` | `Booking Confirmed` | (noindex — do not expose to search engines) |
| My Booking `/my-booking` | `My Booking` | (noindex) |
| Privacy Policy `/privacy` | `Privacy Policy` | (noindex) |
| Spark Rewards `/rewards` | `Spark Rewards` | `Join Spark Rewards — {config.brandName}'s loyalty program. Earn points on every stay, get member discounts, and enjoy exclusive perks.` |
| 404 `*` | `Page Not Found` | (noindex) |

All `/account/*` routes are noindex — authenticated pages should never be crawled.

### `robots.txt`

```
User-agent: *
Allow: /
Disallow: /account/
Disallow: /book/confirm
Disallow: /my-booking

Sitemap: https://{config.domain}/sitemap.xml
```

Generated as a static file at `guest-app/public/robots.txt`. Domain substituted at build time or hardcoded per deployment.

### `sitemap.xml`

Generated at **build time** as a static file at `guest-app/public/sitemap.xml`. Only static/public routes — no booking IDs or dynamic user paths.

```xml
<urlset>
  <url><loc>https://{domain}/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>
  <url><loc>https://{domain}/rooms</loc><priority>0.9</priority><changefreq>weekly</changefreq></url>
  <url><loc>https://{domain}/book</loc><priority>0.9</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://{domain}/about</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://{domain}/corporate</loc><priority>0.7</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://{domain}/contact</loc><priority>0.7</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://{domain}/rewards</loc><priority>0.5</priority><changefreq>monthly</changefreq></url>
</urlset>
```

Sitemap is static — no room-level URLs (rooms are filtered/searched on one page, not individual URLs).

### Structured Data (JSON-LD)

Injected as `<script type="application/ld+json">` in `<head>` on the relevant pages. Tells Google what kind of business this is — critical for appearing in local hotel search results.

#### `LodgingBusiness` — Homepage only

```json
{
  "@context": "https://schema.org",
  "@type": "LodgingBusiness",
  "name": "{config.brandName}",
  "description": "{config.metaDescription}",
  "url": "https://{config.domain}",
  "telephone": "{config.contactPhone}",
  "email": "{config.contactEmail}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{config.address.street}",
    "addressLocality": "{config.address.city}",
    "addressRegion": "{config.address.region}",
    "postalCode": "{config.address.postalCode}",
    "addressCountry": "PH"
  },
  "checkinTime": "{config.checkInTime}",
  "checkoutTime": "{config.checkOutTime}",
  "image": "https://{config.domain}/brand/{config.ogImage}",
  "sameAs": [
    "{config.facebookUrl}",
    "{config.instagramUrl}"
  ]
}
```

#### `HotelRoom` — Rooms page (one per active room, injected as array)

```json
{
  "@context": "https://schema.org",
  "@type": "HotelRoom",
  "name": "{room.name}",
  "description": "{room.description}",
  "occupancy": { "@type": "QuantitativeValue", "maxValue": "{room.maxCapacity}" },
  "bed": { "@type": "BedDetails", "typeOfBed": "{room.bedDefinition}" },
  "amenityFeature": [ ...room.amenities.map(a => ({ "@type": "LocationFeatureSpecification", "name": a, "value": true })) ]
}
```

#### Implementation notes
- All JSON-LD values sourced from `hotel.config.ts` and Firestore `rooms` data — never hardcoded
- Use a `useStructuredData(type, data)` hook that injects/removes the script tag on mount/unmount
- `HotelRoom` schema injected only when rooms are loaded from Firestore — not on skeleton state
- Validate output with Google's Rich Results Test before launch

### Analytics

- GA4 script injected in `index.html` only when `config.analyticsId` is non-empty
- No analytics on admin-app — staff usage should not pollute guest data

---

## Version Display

- Import `VERSION` from `shared/`
- Display in footer of **all pages** — guest and dashboard
- Format: `spark inn v0.1.0`
- See `docs/FILE-STRUCTURE.md` for `shared/VERSION` location
