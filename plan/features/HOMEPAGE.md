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

- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Back navigation never loses user input
- [ ] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [ ] Hero section — full-viewport, background photo, Apollo heading, tagline in Apollo Italic, single CTA button (Spark Orange)
- [ ] Availability checker — check-in / check-out date pickers + guest count + Search button, rendered above the fold within or directly below the hero
- [ ] 3 featured room cards — pulled from `settings/websiteContent.homepage.featuredTypeValues` (a list of room TYPE values, not physical room IDs). The page resolves each type to its first *active* room of that type. Card content — image, name, bed description, key amenities, price per night, Book Now CTA — all comes from the room's **type** via `useRoomTypes` (per `plan/features/SETTINGS.md §Room Type Photos`) — `roomType.imageUrls[0]` is the hero image, pricing + max guests come from the type via `getRoomTypeRates(roomTypes, room.type)` (per W3.6), bed description + amenities come from the type via `roomTypes.find(t => t.value === room.type)?.X` (per W3.7). The resolved physical room is only used for the `key` and the Book Now deep link. Capped at `MAX_FEATURED_TYPES = 3`.
- [ ] Amenities grid — icon + title + description per item, content from `settings/websiteContent.homepage.amenities`
- [ ] Services section — displays Tour Packages and Car Rentals as two service cards
  - [ ] Each card: icon, service name, short description, "Contact Us" CTA button → links to `/contact`
  - [ ] Section heading and service card content editable from Settings → Website Content
  - [ ] No pricing displayed — inquiry-only
- [ ] Spark Rewards promo section — marketing block promoting the loyalty program
  - [ ] Heading and short description editable from Settings → Website Content
  - [ ] Perks list — icon + perk name + short description per item from `settings/websiteContent.homepage.sparkRewards.perks` (e.g. "Earn Points", "Member Discounts", "Early Check-In"); editable from Settings, with disabled perks hidden
  - [ ] CTA: "Join Spark Rewards" → links to `/rewards`
  - [ ] If guest is already a logged-in member — show "Welcome back, [name]" with link to `/account/rewards` instead; hide perks list
  - [ ] Section hidden entirely if `isEnabled: false`
- [ ] Location section — Google Maps embed showing hotel address
- [ ] Footer — dark background (`config.colors.sidebar`), white logo (`config.logos.white`), address, contact, social links, version display
- [ ] Navbar — horizontal logo (`config.logos.navbar`), transparent over hero, solid on scroll
- [ ] Responsive layout — stacks vertically on mobile (375px), grid on desktop

## Data & Logic Checklist

- [ ] Fetch `settings/websiteContent` on load for hero content, amenities, featuredTypeValues, services section, and Spark Rewards section
- [ ] Resolve `featuredTypeValues` to physical rooms — for each type value, find the first *active* room of that type; skip types with no active rooms; cap the resolved list at `MAX_FEATURED_TYPES = 3` from `shared/constants`
- [ ] Availability checker submits to `/rooms` with date + guest count as query params
- [ ] Featured room cards do not show per-room operational status badges. Guests choose dates in the booking flow, where real availability is computed server-side; homepage cards are type-driven marketing cards.
- [ ] Handle case where `featuredTypeValues` is empty — fall back to the first `MAX_FEATURED_TYPES` *distinct* types that have at least one active room (NOT raw room IDs — that was the bug the type-driven model fixes)
- [ ] Spark Rewards section: check auth state — show "Join" CTA if not logged in or not a member; show "Welcome back" if logged-in member
- [ ] Hero photo falls back to `data/homepage.ts → homepageHeroImage` when `homepage.heroPhotoUrl` is empty — see `plan/features/SETTINGS.md §Branding` for the upload UI

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

- [ ] Loading state — skeleton for featured room cards and hero photo
- [ ] Empty state — if no featured rooms configured, show 3 most recently updated active rooms
- [ ] Hero photo missing — show brand color gradient fallback using `config.colors.sidebar` to `config.colors.primary`
- [ ] Map embed fails — show hotel address as text fallback
- [ ] Availability checker: check-out must be after check-in — disable invalid dates
- [ ] Availability checker: past dates disabled
- [ ] Services section: if no content configured in Settings — hide section entirely, do not show empty cards
- [ ] Spark Rewards section: if program disabled or not yet launched — hide section entirely

## Manual QA

- [ ] Hero answers "why stay here?" emotionally before reading any text
- [ ] Availability checker is visible without scrolling on desktop and mobile
- [ ] All 3 featured room cards render correctly with images
- [ ] Amenities grid matches content set in Settings
- [ ] Services section shows Tour Packages + Car Rentals cards with correct CTAs linking to `/contact`
- [ ] Spark Rewards section shows "Join" CTA when logged out
- [ ] Spark Rewards section shows "Welcome back" when logged in as a member
- [ ] Map embed shows correct hotel location (J. Borja St, Tagbilaran City, Bohol)
- [ ] Navbar goes transparent on hero, solid on scroll
- [ ] Footer displays correct version string
- [ ] Full page loads in under 3s on simulated 4G mobile

## References

- Room card layout: `plan/features/ROOMS-PAGE.md`
- Room type fields owned by Settings: `plan/features/ROOM-MANAGEMENT.md §W3.7`
- Footer and Navbar: `plan/guest-app/CLAUDE.md`
- Featured room + amenity content editing: `plan/features/SETTINGS.md §Website Content`
- Design tokens: `plan/docs/FRONTEND.md`
