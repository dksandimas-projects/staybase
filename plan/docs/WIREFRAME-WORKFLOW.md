# Wireframe Workflow
> Requires: CLAUDE.md, docs/FRONTEND.md

---

## Overview

Before any backend work, every screen in Spark Inn is built as a working UI wireframe — real React components, correct layout, brand tokens applied, routing wired up, but **no live data**. All data is static/hardcoded mock values.

This approach lets UI/UX issues be caught and fixed before Firebase, API routes, or business logic are introduced.

---

## Stitch Assets

All Google Stitch exports live in `plan/stitch/Mockups - v1/`. Each screen folder may contain:

| File | What it is |
|---|---|
| `code.html` | Stitch-exported HTML — the primary wireframe source. Port this to React. |
| `screen.png` | Screenshot of the design — use as visual reference when no `code.html` exists. |

**Logos (ready to use):**

| File | Tailwind token / config key |
|---|---|
| `nav_bar_logo.png` | `config.logos.navbar` |
| `final_logo_white.png` | `config.logos.white` |
| `final_logo.png` | `config.logos.standard` |
| `icon_logo.png` | `config.logos.icon` |

Copy logos from `plan/stitch/Mockups - v1/` into `guest-app/public/brand/` and `admin-app/public/brand/` during monorepo setup.

---

## Resolving Stitch Inconsistencies

Google Stitch generates each screen independently, so shared elements (navbar, buttons, badges, cards) drift between screens. The rule is: **the design spec wins, not the HTML.**

### Resolution hierarchy (highest to lowest authority)

1. `plan/stitch/design.md` — canonical brand tokens, component specs, spacing rules. Always the tiebreaker.
2. `plan/docs/FRONTEND.md` — Tailwind token mapping and component conventions.
3. The Stitch screen that best matches the spec — pick one, ignore the others for that component.

### What to do when screens disagree

- **Navbar looks different on homepage vs. rooms page** → use whichever matches the spec, apply it once in the shared `Navbar` component, ignore the other.
- **Button sizes, radii, or colors vary** → always use spec values: `8px` radius, `44px` height, `primary` token. Strip whatever Stitch generated.
- **Spacing or font sizes drift** → follow `plan/stitch/design.md §Typography` and `§Spacing & Shape Rules` exactly.
- **A component appears in one screen but is missing from another** → add it — Stitch omissions are not design decisions.

### Never do this

- Do not average or blend two conflicting Stitch outputs.
- Do not preserve Stitch inline styles, hardcoded hex values, or px font sizes — replace all with Tailwind tokens.
- Do not treat a Stitch screen as pixel-perfect. Treat it as a layout reference only.

---

## Component Library — Build First

Before porting any full page, build these shared components once. Every page then composes from them. This is what eliminates cross-screen inconsistency.

### Guest App components

| Done | Component | Best Stitch source | Notes |
|---|---|---|---|
| [ ] | `Navbar` | `spark_inn_homepage_refined_2` | Transparent over hero, solid white on scroll, sticky |
| [ ] | `Footer` | `spark_inn_homepage_refined_2` | Dark bg `#111827`, white logo, nav links, version |
| [ ] | `PrimaryButton` | spec only | Orange `primary`, `8px` radius, `44px` min-height |
| [ ] | `GhostButton` | spec only | Transparent, orange border + text |
| [ ] | `StatusBadge` | `spark_inn_our_rooms` | Pill, all status variants from spec color table |
| [ ] | `RoomCard` | `spark_inn_our_rooms` | Photo top, name, amenities, price — never price first |
| [ ] | `BookingSummaryCard` | `spark_inn_complete_your_booking` | Read-only recap panel |
| [ ] | `StepIndicator` | `spark_inn_select_room` | 4-step, orange active + completed, gray inactive |
| [ ] | `DateRangePicker` | `spark_inn_availability_calendar` | Blocks past dates, min 1-night enforced |
| [ ] | `PaymentMethodCard` | `spark_inn_complete_your_booking` | Radio card, orange border when selected |
| [ ] | `Modal` | spec only | Centered overlay, `16px` radius, backdrop blur, close X |
| [ ] | `Drawer` (guest) | spec only | Right-side, full height, `~480px` wide |

### Admin App components

| Done | Component | Best Stitch source | Notes |
|---|---|---|---|
| [ ] | `Sidebar` | `spark_inn_front_desk_dashboard` | `#111827`, `240px`, white logo, orange active indicator, version bottom |
| [ ] | `StatsCard` | `spark_inn_front_desk_dashboard` | White card, `12px` radius, label + value + optional trend |
| [ ] | `DataTable` | `spark_inn_manage_bookings` | Sortable, filterable, skeleton rows, row click |
| [ ] | `Drawer` (admin) | spec only | Right-side, full height, `~480px` wide |
| [ ] | `StatusBadge` (admin) | `spark_inn_manage_bookings` | Same component as guest — all admin statuses included |
| [ ] | `ChatBubble` | `spark_inn_intercom_inbox` | Guest: right orange; Staff: left white with border |
| [ ] | `QuickRequestChip` | `spark_inn_guest_chat_mobile` | Pill button in quick-select row |

### Mark component done when

- [ ] File exists at `guest-app/src/components/` or `admin-app/src/components/`
- [ ] Uses only Tailwind tokens — no hardcoded hex
- [ ] Uses `config.*` for any brand value
- [ ] Renders correctly at both breakpoints (where applicable)
- [ ] No backend/Firebase imports

---

## Agent Rules for Wireframe Tasks

When an agent is assigned a wireframe screen:

1. **Read the Stitch HTML first.** Open `plan/stitch/Mockups - v1/<screen>/code.html` and use it as the layout/visual reference.
2. **Read the feature MD.** Each screen has a corresponding feature MD listed in the checklist below — read it before building.
3. **Use Tailwind tokens, never raw hex.** `primary`, `primary-dark`, `section-bg`, `sidebar`, etc. See `plan/docs/FRONTEND.md`.
4. **Use `config.*` for all brand values.** Never hardcode logo filenames, brand name, or colors. See `plan/docs/WHITE-LABEL.md`.
5. **Static data only.** No Firestore reads, no API calls, no auth checks. Use hardcoded arrays and objects that mirror the shape of real data.
6. **Wire up routing.** Navigation links and CTAs must use React Router `<Link>` or `useNavigate` — not `<a href>`.
7. **Both breakpoints.** If a mobile `code.html` exists for the screen, implement responsive layout to match both desktop and mobile designs.
8. **No backend imports.** Do not import Firebase, Resend, Zod validators, or API route handlers in wireframe components.
9. **Mark the checklist item done** in this file when the screen passes a visual QA against the Stitch screenshot.

---

## Definition of Done (per screen)

A wireframe screen is complete when:

- [ ] Component file exists at the correct path (see `plan/docs/FILE-STRUCTURE.md`)
- [ ] Route is registered in the app router
- [ ] Layout matches the Stitch screenshot at desktop width
- [ ] Layout matches the mobile Stitch screenshot (if one exists)
- [ ] All Tailwind tokens used — zero hardcoded hex values
- [ ] All `config.*` values used for brand name, logos, colors
- [ ] Navigation links are functional (React Router)
- [ ] No console errors
- [ ] No backend/Firebase imports

---

## Screen Checklist

Mark each screen `[ ]` → `[x]` when its Definition of Done is met.

---

### Guest App — Pages

| Done | ID | Screen | Route | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | G-01 | Homepage | `/` | `spark_inn_homepage/code.html` + `spark_inn_homepage_mobile/code.html` | `plan/features/HOMEPAGE.md` |
| [ ] | G-02 | Rooms Page | `/rooms` | `spark_inn_our_rooms/code.html` + `spark_inn_our_rooms_mobile/code.html` | `plan/features/ROOMS-PAGE.md` |
| [ ] | G-03 | Booking Step 1 — Select Room | `/book` | `spark_inn_select_room/code.html` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-04 | Booking Step 2 — Guest Details | `/book` | `spark_inn_guest_details/code.html` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-05 | Booking Step 3 — Review & Pay | `/book` | `spark_inn_complete_your_booking/code.html` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-06 | Booking Step 4 — Confirmation | `/book/confirm` | `spark_inn_booking_confirmed/code.html` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-07 | My Booking Lookup | `/my-booking` | `screen.png` only | `plan/features/BOOKING-LOOKUP.md` |
| [ ] | G-08 | Corporate Stays Marketing | `/corporate` | `spark_inn_corporate_stays/code.html` + `spark_inn_corporate_stays_mobile/code.html` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-09 | Corporate Booking Gate + Flow | `/corporate/book` | `screen.png` only | `plan/features/CORPORATE-BOOKING.md` |
| [ ] | G-10 | Spark Rewards Landing | `/rewards` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-11 | Sign In | `/signin` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-12 | Sign Up | `/signup` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-13 | Member Profile | `/account/profile` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-14 | My Stays | `/account/stays` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-15 | My Rewards Portal | `/account/rewards` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-16 | Intercom Guest Chat | `/intercom/:roomId` | `spark_inn_guest_chat_mobile/code.html` | `plan/features/INTERCOM-GUEST.md` |
| [ ] | G-17 | About Us | `/about` | `spark_inn_about_us/code.html` + `spark_inn_about_us_mobile/code.html` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-18 | Contact Us | `/contact` | `spark_inn_contact_us/code.html` + `spark_inn_contact_us_mobile/code.html` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-19 | 404 Not Found | `*` | `screen.png` only | `plan/features/STATIC-PAGES.md` |

---

### Guest App — Modals / Overlays

| Done | ID | Component | Trigger | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | M-01 | Room Detail Modal | Rooms Page "View Details" | `screen.png` only | `plan/features/ROOMS-PAGE.md` |
| [ ] | M-02 | Availability Filter Drawer (mobile) | Rooms Page filter bar | `spark_inn_availability_calendar/code.html` | `plan/features/ROOMS-PAGE.md` |
| [ ] | M-03 | Corporate Access Code Gate | `/corporate/book` landing | `screen.png` only | `plan/features/CORPORATE-BOOKING.md` |
| [ ] | M-04 | Voucher Input (inline) | Booking Step 3 | `screen.png` only | `plan/features/BOOKING-FLOW.md` |

---

### Admin App — Pages

| Done | ID | Screen | Route | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | A-01 | Admin Login | `/login` | `screen.png` only | `plan/features/AUTH-ROLES.md` |
| [ ] | A-02 | Dashboard Overview | `/` | `spark_inn_front_desk_dashboard/screen.png` | `plan/features/DASHBOARD-OVERVIEW.md` |
| [ ] | A-03 | Bookings Management | `/bookings` | `spark_inn_manage_bookings/screen.png` | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | A-04 | Room Management | `/rooms` | `spark_inn_manage_rooms/screen.png` | `plan/features/ROOM-MANAGEMENT.md` |
| [ ] | A-05 | Rate Management | `/rates` | `spark_inn_rate_management/screen.png` | `plan/features/RATE-MANAGEMENT.md` |
| [ ] | A-06 | Reports | `/reports` | `screen.png` only | `plan/features/REPORTS.md` |
| [ ] | A-07 | Corporate Inquiries | `/corporate` | `screen.png` only | `plan/features/CORPORATE-INQUIRIES.md` |
| [ ] | A-08 | Intercom Inbox | `/intercom` | `spark_inn_intercom_inbox/code.html` | `plan/features/INTERCOM-INBOX.md` |
| [ ] | A-09 | QR Management | `/qr` | `spark_inn_qr_code_management/screen.png` | `plan/features/QR-MANAGEMENT.md` |
| [ ] | A-10 | Members (Spark Rewards) | `/members` | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | A-11 | Settings | `/settings` | `screen.png` only | `plan/features/SETTINGS.md` |

---

### Admin App — Drawers / Modals

| Done | ID | Component | Trigger | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | D-01 | Booking Detail Drawer | Bookings table row click | `screen.png` only | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | D-02 | Room Edit Drawer | Room Management "Edit" | `screen.png` only | `plan/features/ROOM-MANAGEMENT.md` |
| [ ] | D-03 | Corporate Inquiry Detail Drawer | Corporate Inquiries card click | `screen.png` only | `plan/features/CORPORATE-INQUIRIES.md` |
| [ ] | D-04 | Member Detail Drawer | Members table row click | `screen.png` only | `plan/features/SPARK-REWARDS.md` |
| [ ] | D-05 | Store Order Detail Drawer | Intercom / Store Reports | `screen.png` only | `plan/features/STORE-MANAGEMENT.md` |
| [ ] | M-05 | Walk-in Booking Modal | Bookings "+ Walk-in Booking" button | `screen.png` only | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | M-06 | Add/Edit Voucher Modal | Rate Management Vouchers tab | `screen.png` only | `plan/features/VOUCHERS.md` |

---

## Stitch Reference Variants

These exports were iteration variants — use the **most refined** version as the canonical source for G-01.

| File | Role |
|---|---|
| `spark_inn_homepage/code.html` | Base homepage |
| `spark_inn_homepage_refined_1/code.html` | Refined iteration 1 |
| `spark_inn_homepage_refined_2/code.html` | Refined iteration 2 — **use this as canonical G-01 source** |
| `spark_inn_homepage_brand_colors/code.html` | Brand color experiment |
| `spark_inn_homepage_location_hero/code.html` | Location hero variant |
| `spark_inn_homepage_actual_room_images/code.html` | Actual room photos swap-in |
| `spark_inn_homepage_mobile/code.html` | Mobile layout |
| `spark_inn_intercom_inbox_synced/code.html` | Synced intercom variant — use for A-08 |

---

## Phase Order

Build in this order — components before pages, guest before admin.

1. **Component library** — all guest + admin components in the table above. Do not start any page until these are done.
2. **Guest pages** — G-01 Homepage → G-02 Rooms → G-03–G-06 Booking Flow → G-07 Lookup → G-17 About → G-18 Contact → G-08 Corporate → G-16 Intercom → G-19 404 → G-10–G-15 Rewards/Auth
3. **Guest modals** — M-01–M-04
4. **Admin pages** — A-01 Login → A-02 Dashboard → A-03 Bookings → A-04 Rooms → A-05 Rates → A-06–A-11 remaining
5. **Admin drawers/modals** — D-01–D-05, M-05–M-06
