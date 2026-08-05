# Homepage
> App: guest-app
> Phase: Phase 1 — Guest App Shell & Static Pages
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Homepage

## Overview

The public homepage at `/`. First impression for all guests — must emotionally answer "why stay here?" within 3 seconds. Leads with hero, immediately followed by an availability checker above the fold. Content is editable from the admin Settings → Website Content tab (list-based content) and Settings → Branding (hero photos, hero copy, logos).

**Sections in order:** Hero → Availability Checker → Featured Rooms → Amenities → Services → Spark Rewards → Map → Footer

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Single primary action is obvious — user knows what to do next without reading
- [x] Loading state uses skeleton, not spinner
- [x] Validation is inline (on blur), not on submit
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Back navigation never loses user input
- [x] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [x] Hero section — full-viewport, background photo, Apollo heading, tagline in Apollo Italic, single CTA button (Spark Orange)
- [x] Availability checker — check-in / check-out date pickers + guest count + Search button, rendered above the fold within or directly below the hero
- [ ] Availability checker — children count is part of the guest picker (CHD-13, proposed 2026-08-03) — the "Guests" field becomes a popover with two steppers (Adults 1-10, Children 0-10) instead of a flat 1-6 select. The trigger label shows the split ("2 adults" or "2 adults, 1 child"). The Search button navigates to `/book?checkIn=...&checkOut=...&guests=...&children=...` — the `/book` page already reads `searchParams.get("children")` (per CHD-05), so the URL contract is in place; the homepage widget just needs to send the new param.
- [x] 3 featured room cards — pulled from `settings/websiteContent.homepage.featuredTypeValues` (a list of room TYPE values, not physical room IDs). The page resolves each type to its first *active* room of that type. Card content — image, name, bed description, key amenities, price per night, Book Now CTA — all comes from the room's **type** via `useRoomTypes` (per `plan/features/SETTINGS.md §Room Type Photos`) — `roomType.imageUrls[0]` is the hero image, pricing + max guests come from the type via `getRoomTypeRates(roomTypes, room.type)` (per W3.6), bed description + amenities come from the type via `roomTypes.find(t => t.value === room.type)?.X` (per W3.7). The resolved physical room is only used for the `key` and the Book Now deep link. Capped at `MAX_FEATURED_TYPES = 3`.
- [x] Amenities grid — icon + title + description per item, content from `settings/websiteContent.homepage.amenities`
- [x] Services section — displays Tour Packages and Car Rentals as two service cards
  - [x] Each card: icon, service name, short description, "Contact Us" CTA button → links to `/contact`
  - [x] Section heading and service card content editable from Settings → Website Content
  - [x] No pricing displayed — inquiry-only
- [x] Spark Rewards promo section — marketing block promoting the loyalty program
  - [x] Heading and short description editable from Settings → Website Content
  - [x] Perks list — icon + perk name + short description per item from `settings/websiteContent.homepage.sparkRewards.perks` (e.g. "Earn Points", "Member Discounts", "Early Check-In"); editable from Settings, with disabled perks hidden
  - [x] CTA: "Join Spark Rewards" → links to `/rewards`
  - [x] If guest is already a logged-in member — show "Welcome back, [name]" with link to `/account/rewards` instead; hide perks list
  - [x] Section hidden entirely if `isEnabled: false`
- [x] Location section — Google Maps embed showing hotel address
- [x] Footer — dark background (`config.colors.sidebar`), white logo (`config.logos.white`), address, contact, social links, version display
- [x] Navbar — horizontal logo (`config.logos.navbar`), transparent over hero, solid on scroll
- [x] Responsive layout — stacks vertically on mobile (375px), grid on desktop

## Data & Logic Checklist

- [x] Fetch `settings/websiteContent` on load for hero content, amenities, featuredTypeValues, services section, and Spark Rewards section
- [x] Resolve `featuredTypeValues` to physical rooms — for each type value, find the first *active* room of that type; skip types with no active rooms; cap the resolved list at `MAX_FEATURED_TYPES = 3` from `shared/constants`
- [x] Availability checker submits to `/book` with date + guest count as query params — per the catalog-only `/rooms` refactor, the rooms page no longer surfaces date-aware availability, so Search sends guests straight into the booking flow with their chosen dates
- [x] Featured room cards do not show per-room operational status badges. Guests choose dates in the booking flow, where real availability is computed server-side; homepage cards are type-driven marketing cards.
- [x] Handle case where `featuredTypeValues` is empty — fall back to the first `MAX_FEATURED_TYPES` *distinct* types that have at least one active room (NOT raw room IDs — that was the bug the type-driven model fixes)
- [x] Spark Rewards section: check auth state — show "Join" CTA if not logged in or not a member; show "Welcome back" if logged-in member
- [x] Hero photo falls back to `data/homepage.ts → homepageHeroImage` when `homepage.heroPhotoUrl` is empty — see `plan/features/SETTINGS.md §Branding` for the upload UI

---

## Hero Image Loading

The hero photo is the LCP element on every public page. Performance budget: under 2.5s LCP on simulated 4G mobile. All four hero-bearing pages (Home, About, Corporate, Rewards) **must** render the hero via the shared `HeroImage` component (`guest-app/src/components/HeroImage.tsx`), not a raw `<img>`.

### What `HeroImage` does

1. **Preloads the resolved URL** — on mount, injects `<link rel="preload" as="image" href={src} fetchpriority="high">` into `<head>` so the browser starts the download in parallel with the JS bundle. Removed on unmount or when the URL changes (e.g. admin swaps the photo). The tag is keyed with `data-hero-image-preload="true"` so multiple heroes on the same page don't stack preload tags.
2. **Marks the `<img>` as the LCP** — `loading="eager"`, `decoding="async"`, `fetchPriority="high"`. `priority={false}` opts out of all three for non-LCP reuse.
3. **Blur-up LQIP** — when a `placeholder` data URL is passed, renders it as a heavily-blurred `background-image` underneath the real image. The real image fades in on `onLoad` (420ms ease-out) so the photo appears to develop into focus, not pop in. Layout stays steady — the LQIP fills the same absolute container the real image will.
4. **No layout shift** — the component always renders into the same `absolute inset-0` slot the `<img>` would have used. The skeleton-to-image transition has no reflow.

### LQIP generation

LQIPs are inline-SVG data URLs in `guest-app/src/data/homepage.ts` — not real image files. Each one is a tiny vertical gradient tinted to the brand palette (`lighten(config.colors.primary, 0.55)` → `config.colors.sectionBg`). Per-page variants are exported as `HOMEPAGE_HERO_LQIP`, `ABOUT_HERO_LQIP`, `CORPORATE_HERO_LQIP`, `REWARDS_HERO_LQIP`. White-label clients automatically get a placeholder that matches their palette — no per-client asset step.

The trade-off vs a per-photo JPEG LQIP is that the placeholder is a generic color block, not a blurred preview of the actual photo. For hero photos this is fine — the brand gradient is more cohesive than a 20px JPEG of a hotel pool.

### Static CDN preconnects

`guest-app/index.html` preconnects to the three image CDNs the guest app can load from:

- `https://lh3.googleusercontent.com` (static fallbacks)
- `https://firebasestorage.googleapis.com` (admin uploads)
- `https://images.unsplash.com` (some static fallbacks)

`crossorigin` is set on the Google and Firebase hosts (they return CORS-bearing responses) and omitted on Unsplash (it doesn't, and adding it would break the preconnect).

### Edge cases

- **`src` is empty** — `HeroImage` is not rendered at all; the page falls back to `HeroSkeleton` (the neutral `bg-section-bg animate-pulse` block). This is the same behavior as before the `HeroImage` wrapper was introduced.
- **Admin swaps the hero photo while the page is open** — the `<link rel=preload>` tag is removed and re-injected with the new URL. The `<img>` `src` changes, `loaded` resets to `false`, and the fade-in plays for the new image.
- **Custom upload uses a CDN that doesn't support `crossorigin`** — the preconnect may not save the full TLS handshake, but the `<link rel=preload>` will still work for the LCP image fetch itself.

### Future work

- **Responsive `srcSet` + `sizes`** — the wrapper already accepts `srcSet` and `sizes` props; the static fallback URLs (Unsplash `?w=`, Firebase Storage `=w`) support it. Wire up responsive variants when the admin upload pipeline starts emitting multiple sizes.
- **AVIF / WebP transcoding** — biggest size win for the photo. Either via Firebase Storage's image extension or a one-shot Vercel API route at upload time. Not blocking LCP < 2.5s but cuts payload ~30% for JPEG and ~50% for PNG sources.

## Edge Cases & States

- [x] Loading state — skeleton for featured room cards and hero photo
- [x] Empty state — if `featuredTypeValues` is empty, fall back to the first `MAX_FEATURED_TYPES` distinct room types that have at least one active room (see Data & Logic above)
- [x] Hero photo missing — render `HeroSkeleton` (neutral `bg-section-bg animate-pulse` block) per §Hero Image Loading edge cases
- [x] Map embed fails — show hotel address as text fallback
- [x] Availability checker: check-out must be after check-in — disable invalid dates
- [x] Availability checker: past dates disabled
- [x] Services section: if no content configured in Settings — hide section entirely, do not show empty cards
- [x] Spark Rewards section: if program disabled or not yet launched — hide section entirely

## Manual QA

- [x] Hero answers "why stay here?" emotionally before reading any text
- [x] Availability checker is visible without scrolling on desktop and mobile
- [x] All 3 featured room cards render correctly with images
- [x] Amenities grid matches content set in Settings
- [x] Services section shows Tour Packages + Car Rentals cards with correct CTAs linking to `/contact`
- [x] Spark Rewards section shows "Join" CTA when logged out
- [x] Spark Rewards section shows "Welcome back" when logged in as a member
- [x] Map embed shows correct hotel location (J. Borja St, Tagbilaran City, Bohol)
- [x] Navbar goes transparent on hero, solid on scroll
- [x] Footer displays correct version string
- [x] Full page loads in under 3s on simulated 4G mobile

## References

- Room card layout: `plan/features/ROOMS-PAGE.md`
- Room type fields owned by Settings: `plan/features/ROOM-MANAGEMENT.md §W3.7`
- Footer and Navbar: `plan/guest-app/CLAUDE.md`
- Featured room + amenity content editing: `plan/features/SETTINGS.md §Website Content`
- Design tokens: `plan/docs/FRONTEND.md`

---

## Children in Search Widget (CHD-13)
> Proposed 2026-08-03, per decision #187. Spec-only — no code yet. Files: `guest-app/src/pages/HomePage.tsx:194-228` (the availability checker block — current shape is a flat `<select>` for 1-6 guests). Sibling to CHD-11 (soft-constraint picker on `/book`) but a different surface — the homepage is a quick-search, not a full booking.

### The problem

The homepage availability checker at `guest-app/src/pages/HomePage.tsx:194-228` has a flat `<select>` for guests (1-6) — no children split. Three reasons this is the wrong shape:

1. **The first contact is missing the children's split.** Per CHD-05, every booking has an adults + children split, and the children's count is server-validated as part of the public creation transaction. The homepage widget's "2 guests" is ambiguous — 2 adults, or 1 adult + 1 child, or 2 children? The guest has to re-specify the split on `/book`.
2. **The current cap of 6 is artificially restrictive.** The 14-room hotel sees real "buy out the whole hotel" group bookings (e.g. 8 adults + 4 children for a wedding party). The flat `<select>` caps at 6 total, forcing the group to abandon the homepage search and re-specify on `/book` — and the /book picker has no total cap, so they get a different shape on the second surface.
3. **The Search button URL contract already has the `children` param.** The `/book` page reads `searchParams.get("children")` at `BookingPage.tsx:211` — the homepage widget just needs to send the new param. The change is purely a client-side widget + a URL param, no server-side work.

### The fix — popover with two steppers (Adults + Children), matching the /book picker shape

**Replace the flat `<select>` (1-6 guests) with a small popover anchored to a "Guests" trigger. The popover has two rows:**

```
┌──────────────────────────────┐
│ Adults                [−] 2 [+]│
│ Children (0-11)       [−] 0 [+]│
│                              │
│            [ Done ]          │
└──────────────────────────────┘
```

The trigger button shows the current split: "2 adults" (no children) or "2 adults, 1 child" (with children). When the popover is closed and the user reopens it, the steppers reflect the current state.

The popover's `−` / `+` controls follow the same shape as the `/book` picker:
- **Adults**: min 1, max 10, default 2 (matches the `/book` `guests` invariant of "at least one adult").
- **Children**: min 0, max 10 (matches the CHD-11 soft cap on the `/book` picker).
- **Total cap**: removed — the 1-6 cap on the current `<select>` was a UI simplification, not a domain constraint. The `/book` picker has no total cap (children are unbounded, adults can grow to fill the children step), so removing the homepage cap means the two surfaces agree.

The "Done" button closes the popover. Click-outside-to-close is also enabled (the standard popover dismissal). The trigger itself is a `button` with `aria-haspopup="dialog"` and `aria-expanded` for screen readers; the popover is a `role="dialog"` with `aria-labelledby="guests-popover-title"` and a focus trap.

### URL contract on Search

The Search button navigates to `/book` with all three occupancy params:
- `guests` = `adults + children` (total — the existing contract, what `/book` reads at `BookingPage.tsx:205`)
- `children` = children count (new — what `/book` already reads at `BookingPage.tsx:211`)
- (the third param, "adults", is derived on `/book` as `Math.max(0, guests - children)` at `BookingPage.tsx:212`)

The existing `searchAvailability` function at `HomePage.tsx:121-133` gains `children: String(children)` in the `URLSearchParams` constructor. No change to the `/book` page's URL reader.

### What this changes for the data model

**Nothing.** The popover is a UI control; the underlying state is two `useState<number>` hooks (`adults`, `children`). The URL is the only persistence path. No new schema, no new server-side field, no new validation.

### What this changes for the related work

- **CHD-05 contract preserved** — server still validates `numAdults + numChildren === numGuests` per child; the homepage widget just feeds the right `guests` + `children` pair into the URL so the `/book` page's pre-fill is correct.
- **CHD-11 (soft-constraint picker)** — the homepage widget uses the same soft cap (10) for children as the `/book` picker; the same age range label "Children (0-11)" appears in both surfaces. The shapes match.
- **CHD-12 (cart-style summary)** — unrelated; the cart summary is a post-cart surface, the homepage widget is a pre-cart surface. The two don't touch.
- **EXB-11 (extra-bed toggle)** — the homepage widget does NOT include an extra-bed picker. Extra beds are a cart-time decision (per EXB-01..10: server snapshots `extraBedRate` on creation); the homepage widget is a quick-search, not a full add-on picker. The `/book` page handles the extra-bed selection.

### Source-text tests (per `plan/docs/CONTRIBUTING.md §Testing`)

- `guest-app/tests/api/chd-13-children-in-search-widget.test.ts` (new) — source-text guards on `HomePage.tsx`:
  - The flat `<select>` (1-6 guests) is gone; replaced with a popover trigger button
  - The popover trigger has `aria-haspopup="dialog"` and `aria-expanded` attributes
  - The popover contains two stepper rows: "Adults" and "Children (0-11)" (with the age range label)
  - The "Children (0-11)" stepper has `aria-label="Children count"` and `aria-live="polite"` (matches the `/book` picker shape)
  - The "Adults" stepper is min 1 max 10, the "Children" stepper is min 0 max 10
  - The trigger label is "N adults" when `children === 0`, "N adults, M child(ren)" when `children > 0`
  - The "Done" button is present
  - The `searchAvailability` function includes `children: String(children)` in the URL params (verify via regex on the function body)
- `guest-app/tests/api/chd-children-occupancy.test.ts` (existing) — re-verify CHD-05 contract is preserved (the URL contract on `/book` is unchanged).

### Rejected alternatives

- **Keep the flat `<select>`, just add a separate `<select>` for children next to it.** Adds two drop-downs in a row that's already tight on mobile (the widget stacks vertically on small screens per the existing responsive layout, but two side-by-side selects take more horizontal space than a popover trigger). The popover is the more compact shape.
- **Use a single combined "Guests" stepper that decrements adults before children** (e.g. `[−] 3 [+]`, with an internal "adults=2, children=1" split). Hidden from the user but matches the soft-constraint "exploration-first" spirit. The split is too important to hide — adults and children have different rates (children are free, adults pay the room rate), different age semantics (0-11 vs 12+), and the /book picker is split. Hiding the split would create a different shape on the homepage than on /book.
- **Skip the children picker on the homepage — just send `children=0` and let /book re-prompt.** The /book page already inherits children from the URL; passing `children=0` silently when the user actually has 2 children is a worse outcome than adding a 2-row popover. The whole point of the spec is to capture the children's count at the first surface.
- **Make the popover a 4-row widget (Adults, Children 0-5, Children 6-11, Teens 12+).** The age range split (0-11 vs 12+) is a real domain boundary per CHD-10 (12+ counts as adult for both rate and breakfast). But the /book picker collapses to "Children (0-11)" only — a child of 12 is treated as an adult there. Mirroring that shape on the homepage keeps the two surfaces consistent. A "Children (0-5) / (6-11) / (12+)" age-tier split is a future CHD-14 if the operator wants to differentiate pricing by age.
- **Show the children picker on the homepage but cap at 6 (matching the old total cap).** Defeats the point of the spec — the 1-6 cap is what's being removed.
