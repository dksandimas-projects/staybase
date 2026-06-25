# Frontend Conventions
> Requires: CLAUDE.md, docs/WHITE-LABEL.md

---

## Design Philosophy

**Public Website (`guest-app`):** Warm Minimal — boutique hotel premium. Not budget, not flashy luxury. Lead with emotion, not features.

**Dashboard (`admin-app`):** Efficiency first. Front desk scans, not reads. Clean data hierarchy, no decorative elements.

---

## UX Philosophy — It Just Works

Spark Inn should feel effortless — like an Apple product. Users should never have to think about how to use it. Every screen, every interaction, every state is designed to guide the user forward without friction, confusion, or dead ends. This philosophy applies to every screen built in both apps.

### Core Tenets

**1. Zero friction to the goal**
Every screen has one obvious primary action. The user's next step is never ambiguous. The booking flow gets a guest from "I want a room" to "booking confirmed" in as few taps as possible. The admin app gets staff from "I need to update this" to "done" without navigating away.

**2. Progressive disclosure**
Show only what the user needs right now. Don't front-load every option, field, or action on a screen. Reveal details, secondary actions, and advanced options only when the context calls for it. Booking flow is the best example: collect info one step at a time, never all at once.

**3. Smart defaults**
Pre-fill what we know. Availability checker defaults to tomorrow check-in, 1 night, 2 guests (most common pattern). Admin drawers open with current values pre-populated. Forms remember the last selections when it helps. Never make the user type what we can infer.

**4. Optimistic UI**
Don't make users wait to feel success. On booking submission, show the confirmation UI immediately while the request is processing — roll back only on actual failure. Status changes in the admin app update instantly in the UI before the Firestore write confirms. Speed is a feature.

**5. Skeleton loaders, never spinners**
Empty states and loading states always use skeleton screens that match the shape of the real content — never a spinner in the middle of the page. The layout never jumps or reflows when data arrives.

**6. Inline validation, not submit errors**
Validate fields as the user completes them (on `blur`), not on form submit. The user never fills out 5 fields, hits submit, and gets a wall of errors. Each field gives immediate, specific, friendly feedback.

**7. Every error has a next step**
No dead ends. If something fails, the user always sees what went wrong in plain language and what to do next. Never show a raw error code or a generic "something went wrong" message without guidance.

**8. Delight at the right moments**
Micro-interactions and animations are used purposefully at emotional peaks — booking confirmation, first login, successful status change. Not on every button tap. Delight should feel earned, not cheap.

**9. Consistency is trust**
The same action always looks and behaves the same way across every screen. Drawers open the same way. Badges use the same colors. Primary CTAs are always `primary`. Toasts always appear in the same position. Predictability builds confidence.

**10. Forgiveness over caution**
Destructive actions (cancel booking, block room, delete voucher) require a single confirmation — not a multi-step process. Non-destructive actions (edit, update, toggle) are instant with an undo toast. Never make users afraid to explore the app.

---

### Guest App — UX Checklist (apply to every guest-facing screen)

- [ ] Single primary CTA visible above the fold on mobile
- [ ] No required field that isn't genuinely necessary for the booking
- [ ] Back navigation never loses user input
- [ ] Loading state matches the shape of the real content (skeleton)
- [ ] Confirmation/success state feels celebratory — not just "OK"
- [ ] Error messages are in plain Filipino/English with a clear next action
- [ ] Page answers "where am I and what do I do next?" within 3 seconds of load

### Admin App — UX Checklist (apply to every staff-facing screen)

- [ ] Most common action for this screen is reachable in ≤ 2 clicks from the sidebar
- [ ] Data tables are scannable — status, name, date visible without horizontal scroll on 1440px
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do (not just "No results")
- [ ] Keyboard-navigable for power users (Tab order is logical, Enter submits forms)

### Admin App — Mobile UX Checklist (apply to every staff-facing screen)

> Full spec: `plan/features/ADMIN-MOBILE.md`. This checklist is the per-screen essentials — load ADMIN-MOBILE.md for the per-page rules and component patterns.

- [ ] Layout works at 375px (iPhone SE) without horizontal page scroll
- [ ] Sidebar collapses to a hamburger on mobile; never permanently overlaps content
- [ ] All form fields and buttons are minimum 44×44px touch targets
- [ ] No table requires horizontal page scroll — switch to a card list below 768px (per `DataTable.renderMobileCard`)
- [ ] Drawer becomes a full-screen bottom sheet on mobile with a sticky action footer
- [ ] Modal becomes a full-screen sheet on mobile
- [ ] Intercom chat shows one pane at a time on mobile (threads OR chat, not both)
- [ ] Primary action of the screen is reachable in the bottom 50% of the viewport (one-handed use)
- [ ] Safe-area-insets respected on iOS notched devices (`pb-[env(safe-area-inset-bottom)]` on sticky footers)
- [ ] No native browser `alert()` / `confirm()` / `prompt()` on mobile — use inline forms + toast (per `DECISIONS-FEATURES.md #106g` and ADMIN-MOBILE.md)
- [ ] Hamburger, close, and icon-only buttons have `aria-label`; sidebar uses `aria-expanded` + `aria-controls`; drawer uses `role="dialog"` + `aria-modal="true"`
- [ ] Focus is trapped inside open drawer/modal; restored to trigger on close
- [ ] All animations respect `prefers-reduced-motion` (Framer `useReducedMotion()`)

---

## Config-Driven Tokens

All brand colors, fonts, and logo paths come from `hotel.config.ts` — never hardcoded in components or Tailwind config. See `plan/docs/WHITE-LABEL.md` for full config schema.

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
| Navbar Horizontal | `logos.navbar` | Navigation bar ONLY — scrolled/solid state and non-hero pages |
| Navbar (over dark) | `branding.logoNavbarOnDark` (runtime) or `logos.navbar` (fallback) | Navigation bar transparent over a dark hero. Use a light/white variant for visibility. See `plan/docs/WHITE-LABEL.md §Runtime Branding Overrides`. |
| Icon Only | `logos.icon` | Favicons, loading states, small formats |
| Wordmark Only | `logos.wordmark` | Email headers, letterheads |

**Logo overrides** — the three navbar/footer variants (`logoNavbar`, `logoNavbarOnDark`, `logoFooter`) can be uploaded from Settings → Branding. Each override wins over its `config.logos.*` counterpart; if only one navbar variant is set, it is mirrored across both states. See `plan/docs/WHITE-LABEL.md §Runtime Branding Overrides`.

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

## Animations (Framer Motion)

The animation language is **calm, intentional, and premium** — like a well-run hotel. Nothing bounces. Nothing spins. Every motion has a reason. The guest site is expressive; the admin app is near-static.

### Core Principles

- **Easing:** Always `easeOut` or custom `[0.25, 0.1, 0.25, 1]` cubic-bezier — never `linear` or `easeIn`
- **Duration:** Entrances 400–500ms · Exits 200–250ms · Micro-interactions 150ms
- **Distance:** Translate max `16px` on entrances — never large sweeping movements
- **Opacity:** Always pair movement with opacity — motion alone feels mechanical
- **Reduced motion:** All animations respect `prefers-reduced-motion` — wrap in `useReducedMotion()` from Framer Motion and skip transforms when true (keep opacity fade only)
- **Admin app:** No entrance animations — skeleton → content only. Drawers and modals use the same open/close spec as guest app.

---

### Shared Variants (define once in `shared/animations.ts`, import everywhere)

```ts
// Fade up — primary entrance for all content sections
export const fadeUp = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] } }
}

// Fade in — for elements that shouldn't move (overlays, badges, images)
export const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35, ease: 'easeOut' } }
}

// Stagger container — wraps lists of cards or items
export const staggerContainer = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
}

// Stagger child — used inside staggerContainer
export const staggerChild = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] } }
}

// Scale in — modals, confirmation states
export const scaleIn = {
  hidden:  { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } }
}

// Slide in from right — drawers
export const slideInRight = {
  hidden:  { opacity: 0, x: 48 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
  exit:    { opacity: 0, x: 48, transition: { duration: 0.2, ease: 'easeIn' } }
}

// Slide in from bottom — mobile sheet / mobile modals
export const slideInBottom = {
  hidden:  { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
  exit:    { opacity: 0, y: 32, transition: { duration: 0.2, ease: 'easeIn' } }
}
```

---

### Page Transitions (guest-app only)

Wrap the router outlet in `<AnimatePresence mode="wait">`. Each page component wraps its root element in `<motion.div>`.

```ts
// Page enter/exit — subtle fade + tiny upward drift
const pageVariant = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] } },
  exit:    { opacity: 0,        transition: { duration: 0.2, ease: 'easeIn' } }
}
```

Pages exit quickly (200ms) so the user doesn't wait. Entrance is slightly slower (400ms) so content feels like it arrives, not snaps.

---

### Scroll Entrance Animations (guest-app sections)

Use `whileInView` with `viewport={{ once: true, margin: "-80px" }}` — animates once as the section enters viewport, never repeats on scroll back.

Apply `fadeUp` variant to:
- Homepage: Hero content block, Availability Checker, each section heading + its content (`staggerContainer` + `staggerChild` for amenities grid, room cards grid, services grid)
- About Us: Hero text, mission/vision blocks
- Corporate: Feature perks list (staggered)
- Rooms Page: Room cards grid (staggered)
- Static pages: Any content block deeper than the fold

Do NOT apply scroll entrance to:
- Navbar
- Footer
- Any element visible above the fold on load (use page transition instead)

---

### Navbar Scroll Transition

Transparent → solid white crossfade as page scrolls past 64px.

```ts
// In Navbar.tsx — controlled by scroll position
const navVariant = {
  transparent: { backgroundColor: 'rgba(255,255,255,0)', backdropFilter: 'blur(0px)' },
  solid:        { backgroundColor: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
                  boxShadow: '0 1px 0 rgba(0,0,0,0.06)' }
}
// Transition: duration 0.3s ease
// Use Framer Motion animate prop with the variant key toggled on scroll
```

The frosted glass effect (`backdrop-filter: blur(12px)`) at solid state gives a premium feel without a hard white block.

---

### Room Cards (guest-app)

```ts
// Hover: subtle lift + shadow deepening
whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.10)' }}
transition={{ duration: 0.2, ease: 'easeOut' }}

// Tap: slight press
whileTap={{ scale: 0.99 }}
```

Image inside the card: on hover, scale the image slightly for depth.
```ts
// Image wrapper inside card
whileHover={{ scale: 1.03 }}
transition={{ duration: 0.4, ease: 'easeOut' }}
```

---

### Buttons

```ts
// Primary + Ghost buttons
whileHover={{ scale: 1.02 }}
whileTap={{ scale: 0.97 }}
transition={{ duration: 0.15, ease: 'easeOut' }}
```

Never animate color on hover via Framer — use Tailwind's `hover:` for color changes. Framer handles only scale + shadow.

---

### Booking Flow — Step Transitions

Steps live in a single page (`/book`). When the active step changes, the new step content enters from the right, the old step exits to the left.

```ts
const stepVariant = {
  enter:  (direction: number) => ({ opacity: 0, x: direction > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
  exit:   (direction: number) => ({ opacity: 0, x: direction > 0 ? -40 : 40,
                                    transition: { duration: 0.2, ease: 'easeIn' } })
}
// direction = 1 for forward, -1 for back
// Wrap in <AnimatePresence custom={direction} mode="wait">
```

The `BookingSummary` card on the right stays fixed — only the left step content slides.

---

### Modals

Desktop: `scaleIn` variant (scale 0.97 → 1, opacity 0 → 1). Backdrop fades in separately.
Mobile: `slideInBottom` variant (slides up from bottom like a sheet).

```ts
// Backdrop
<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  transition={{ duration: 0.25 }} className="fixed inset-0 bg-black/40 backdrop-blur-sm" />

// Modal panel (desktop)
<motion.div variants={scaleIn} initial="hidden" animate="visible" exit="hidden" />

// Modal panel (mobile — detect via useBreakpoint or window.innerWidth < 768)
<motion.div variants={slideInBottom} initial="hidden" animate="visible" exit="exit" />
```

---

### Drawers (admin + guest)

Always slide in from the right. Backdrop fades independently.

```ts
<motion.div variants={slideInRight} initial="hidden" animate="visible" exit="exit" />
```

Drawer should be wrapped in `<AnimatePresence>` controlled by the open state so exit animation plays before unmount.

---

### Intercom Chat

Incoming messages animate in with a subtle fade + slide from the relevant side:

```ts
// Guest message (right side)
initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
transition={{ duration: 0.25, ease: 'easeOut' }}

// Staff message (left side)
initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
transition={{ duration: 0.25, ease: 'easeOut' }}
```

---

### Loading States

Skeleton screens use a shimmer animation — not pulse. Shimmer feels more premium.

```css
/* In global CSS or Tailwind plugin */
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

---

### Spark Rewards Member Card

The rewards card on `/account/profile` has an entrance that feels special — it's the member's identity.

```ts
// Card container: slightly longer entrance, slight rotation settling
initial={{ opacity: 0, y: 24, rotateX: 8 }}
animate={{ opacity: 1, y: 0, rotateX: 0 }}
transition={{ duration: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
style={{ transformPerspective: 800 }}
```

On hover, the card subtly reflects — a very gentle shimmer on the card surface using a CSS gradient animation. Not a full holographic effect — just enough to feel like a physical card.

---

### What Does NOT Animate

- Admin data tables — rows appear instantly (skeleton → content only)
- Status badges — color changes are instant via Tailwind, no Framer
- Form field focus states — CSS only (`ring`, `border-color`)
- Toast notifications — slide in from top-right (simple CSS `@keyframes`)
- Recharts — charts use their own built-in animation, do not override
- Any animation inside a loading spinner — CSS `animate-spin` only

---

## Data Fetching Patterns

**Firestore real-time data** (rooms, bookings, intercom):
- Use custom hooks in `firebase/` (`useRooms`, `useBookings`, etc.)
- Always return `{ data, loading, error }` shape
- Always unsubscribe `onSnapshot` in `useEffect` cleanup — see `plan/docs/GOTCHAS.md`

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

Room type dropdowns, filters, rate tables, and badges are always built dynamically from context (`roomTypes` in Admin App, `DEFAULT_ROOM_TYPES` from `@spark-inn/shared` on guest app). Never hardcode room type strings like `"single"` or `"executive"` in UI components — iterate over room types instead.

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
| Terms of Service `/terms` | `Terms of Service` | (noindex) |
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
  "description": "{roomType.description}",
  "occupancy": { "@type": "QuantitativeValue", "maxValue": "{roomType.maxCapacity}" },
  "bed": { "@type": "BedDetails", "typeOfBed": "{roomType.bedDefinition}" },
  "amenityFeature": [ ...roomType.amenities.map(a => ({ "@type": "LocationFeatureSpecification", "name": a, "value": true })) ]
}
```

> Per W3.6 + W3.7, `description`, `maxCapacity`, `bedDefinition`, and `amenities` are type-level fields joined on `room.type`. The schema is injected from the joined `roomType` entry, not from the room document.

#### Implementation notes
- All JSON-LD values sourced from `hotel.config.ts` and Firestore `rooms` / `settings/hotelConfig.roomTypes[]` data — never hardcoded
- Use a `useStructuredData(type, data)` hook that injects/removes the script tag on mount/unmount
- `HotelRoom` schema injected only when rooms are loaded from Firestore — not on skeleton state
- Validate output with Google's Rich Results Test before launch

### Analytics Events

GA4 script injected only when `config.analyticsId` is non-empty. No analytics on admin-app — staff usage pollutes guest data.

Track these 8 events. Every event must have a clear product decision it informs:

| Event name | Trigger | Decision it informs |
|---|---|---|
| `availability_searched` | Guest submits dates on availability checker | Are guests finding available dates? High drop-off here = pricing or availability problem |
| `room_selected` | Guest clicks a room card to start booking | Which room types convert best? Informs featured rooms and rate strategy |
| `booking_step_completed` | Guest advances past each of Steps 1–3 | Step-by-step funnel — where do guests drop off? |
| `booking_submitted` | Guest clicks Confirm Booking on Step 3 | Direct conversion event — the money metric |
| `voucher_applied` | Guest successfully applies a promo code | Are vouchers driving bookings? Informs marketing campaigns |
| `payment_method_selected` | Guest selects GCash / PayPal / Pay at Hotel | Which payment methods are most used? Informs which to prioritize in Phase 2 |
| `corporate_inquiry_submitted` | Corporate inquiry form submitted | Corporate pipeline lead volume |
| `rewards_member_registered` | New Spark Rewards member completes registration | Loyalty program growth rate |

Fire events using GA4's `gtag('event', name, params)`. Include `room_type` and `num_nights` as params on booking events where relevant.

---

## Accessibility

**Target:** WCAG 2.1 AA — the international standard, and the ethical minimum given the app explicitly serves PWD guests who receive a government-mandated discount.

AI agents should run through this checklist on every new screen before marking it complete:

| # | Check | Why it matters |
|---|---|---|
| 1 | Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI components | Spark Orange on white passes; always verify new combinations |
| 2 | All interactive elements reachable and operable via keyboard (Tab / Enter / Space / Arrow) | Motor disability support; also caught by screen readers |
| 3 | All images have descriptive `alt` text; decorative images have `alt=""` | Screen reader support |
| 4 | All form inputs have associated `<label>` elements (not just placeholder text) | Screen readers read labels, not placeholders |
| 5 | Error messages are programmatically associated with their inputs (`aria-describedby`) | Screen reader users must hear the error, not just see it |
| 6 | Modals and drawers trap focus while open; focus returns to trigger on close | Keyboard users must not get lost behind overlays |
| 7 | All icon-only buttons have `aria-label` | An icon alone is meaningless to a screen reader |
| 8 | Page has a logical heading hierarchy (one `<h1>`, then `<h2>`, then `<h3>`) | Screen reader navigation relies on heading structure |
| 9 | Motion respects `prefers-reduced-motion` — Framer Motion animations disabled when set | Some users experience nausea from motion |
| 10 | Touch targets are minimum 44×44px on mobile | Motor accessibility; also already in Hard Rules |

**How to check during build (AI-assisted):**
- Contrast: use the WebAIM Contrast Checker or browser DevTools accessibility panel
- Keyboard nav: Tab through the screen manually or ask AI to review for missing `tabIndex` / focus traps
- Screen reader: use macOS VoiceOver (`Cmd+F5`) or NVDA on Windows for a quick smoke test before phase sign-off

---

## Version Display

- Import `VERSION` from `shared/`
- Display in footer of **all pages** — guest and dashboard
- Format: `spark inn v0.1.0`
- See `plan/docs/FILE-STRUCTURE.md` for `shared/VERSION` location
