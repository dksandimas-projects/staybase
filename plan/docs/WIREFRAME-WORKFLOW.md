# Wireframe Workflow
> Requires: CLAUDE.md, docs/FRONTEND.md

---

## Overview

Before any backend work, every screen in Spark Inn is built as a working UI wireframe — real React components, correct layout, brand tokens applied, routing wired up, but **no live data**. All data is static/hardcoded mock values.

This approach lets UI/UX issues be caught and fixed before Firebase, API routes, or business logic are introduced.

---

## Stitch Assets

All final Google Stitch exports live in `plan/stitch/stitch_spark_inn_final/`. Every screen folder contains both:

| File | What it is |
|---|---|
| `code.html` | Stitch-exported HTML — primary wireframe source. Port this to React. |
| `screen.png` | Screenshot — use as visual QA reference. |

**Logos (ready to use in `plan/stitch/stitch_spark_inn_final/`):**

| File | Config key |
|---|---|
| `nav_bar_logo.png` | `config.logos.navbar` |
| `final_logo_white.png` | `config.logos.white` |
| `final_logo.png` | `config.logos.standard` |

Copy logos into `guest-app/public/brand/` and `admin-app/public/brand/` during monorepo setup.

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

All Stitch source paths below are relative to `plan/stitch/stitch_spark_inn_final/`.

### Guest App components

| Done | Component | Best Stitch source | Notes |
|---|---|---|---|
| [x] | `Navbar` | `homepage_desktop` | Transparent over hero, solid white on scroll, sticky |
| [x] | `Footer` | `homepage_desktop` | Dark bg `#111827`, white logo, nav links, version |
| [x] | `PrimaryButton` | spec only | Orange `primary`, `8px` radius, `44px` min-height |
| [x] | `GhostButton` | spec only | Transparent, orange border + text |
| [x] | `StatusBadge` | `rooms_rates_desktop` | Pill, all status variants from spec color table |
| [x] | `RoomCard` | `rooms_rates_desktop` | Photo top, name, amenities, price — never price first |
| [x] | `BookingSummaryCard` | `booking_step_3_desktop` | Read-only recap panel |
| [x] | `StepIndicator` | `booking_step_1_desktop` | 4-step, orange active + completed, gray inactive |
| [x] | `DateRangePicker` | `availability_filter_drawer_mobile` | Blocks past dates, min 1-night enforced |
| [x] | `PaymentMethodCard` | `booking_step_3_desktop` | Radio card, orange border when selected |
| [x] | `Modal` | `room_detail_modal_desktop` | Centered overlay, `16px` radius, backdrop blur, close X |
| [x] | `Drawer` (guest) | spec only | Right-side, full height, `~480px` wide |

### Admin App components

| Done | Component | Best Stitch source | Notes |
|---|---|---|---|
| [x] | `Sidebar` | `admin_dashboard_desktop` | `#111827`, `240px`, white logo, orange active indicator, version bottom |
| [x] | `StatsCard` | `admin_dashboard_desktop` | White card, `12px` radius, label + value + optional trend |
| [x] | `DataTable` | `bookings_management_desktop` | Sortable, filterable, skeleton rows, row click |
| [x] | `Drawer` (admin) | `booking_detail_drawer_desktop_1` | Right-side, full height, `~480px` wide |
| [x] | `StatusBadge` (admin) | `bookings_management_desktop` | Same component as guest — all admin statuses included |
| [x] | `ChatBubble` | `intercom_inbox_desktop_1` | Guest: right orange; Staff: left white with border |
| [x] | `QuickRequestChip` | `intercom_guest_chat_mobile_1` | Pill button in quick-select row |

### Mark component done when

- [ ] File exists at `guest-app/src/components/` or `admin-app/src/components/`
- [ ] Uses only Tailwind tokens — no hardcoded hex
- [ ] Uses `config.*` for any brand value
- [ ] Renders correctly at both breakpoints (where applicable)
- [ ] No backend/Firebase imports

---

## Agent Rules for Wireframe Tasks

When an agent is assigned a wireframe screen:

1. **Read the Stitch HTML first.** Open `plan/stitch/stitch_spark_inn_final/<screen>/code.html` and use it as the layout/visual reference.
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

All Stitch source paths below are relative to `plan/stitch/stitch_spark_inn_final/`.

### Guest App — Pages

| Done | ID | Screen | Route | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | G-01 | Homepage | `/` | `homepage_desktop` + `homepage_mobile` | `plan/features/HOMEPAGE.md` |
| [ ] | G-02 | Rooms Page | `/rooms` | `rooms_rates_desktop` + `rooms_rates_mobile` | `plan/features/ROOMS-PAGE.md` |
| [ ] | G-03 | Booking Step 1 — Select Room | `/book` | `booking_step_1_desktop` + `booking_step_1_mobile` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-04 | Booking Step 2 — Guest Details | `/book` | `booking_step_2_desktop` + `booking_step_2_mobile` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-05 | Booking Step 3 — Review & Pay | `/book` | `booking_step_3_desktop` + `booking_step_3_mobile` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-06 | Booking Step 4 — Confirmation | `/book/confirm` | `booking_confirmation_desktop` + `booking_confirmation_mobile` | `plan/features/BOOKING-FLOW.md` |
| [ ] | G-07 | My Booking Lookup | `/my-booking` | no Stitch source — build from feature MD | `plan/features/BOOKING-LOOKUP.md` |
| [ ] | G-08 | Corporate Stays Marketing | `/corporate` | `corporate_stays_marketing_desktop` + `corporate_stays_marketing_mobile` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-09 | Corporate Booking Gate + Flow | `/corporate/book` | `corporate_access_code_gate_desktop` + `corporate_access_code_gate_mobile` | `plan/features/CORPORATE-BOOKING.md` |
| [ ] | G-10 | Spark Rewards Landing | `/rewards` | `spark_rewards_landing_desktop` + `spark_rewards_landing_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-11 | Sign In | `/signin` | `sign_in_desktop` + `sign_in_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-12 | Sign Up | `/signup` | `sign_up_desktop` + `sign_up_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-13 | Member Profile | `/account/profile` | no Stitch source — build from feature MD | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-14 | My Stays | `/account/stays` | `my_stays_desktop` + `my_stays_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-15 | My Rewards Portal | `/account/rewards` | `my_rewards_desktop` + `my_rewards_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | G-16 | Intercom Guest Chat | `/intercom/:roomId` | `intercom_guest_chat_desktop` + `intercom_guest_chat_mobile_1` + `intercom_guest_chat_mobile_2` | `plan/features/INTERCOM-GUEST.md` |
| [ ] | G-17 | About Us | `/about` | `about_us_desktop` + `about_us_mobile` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-18 | Contact Us | `/contact` | `contact_us_desktop` + `contact_us_mobile` | `plan/features/STATIC-PAGES.md` |
| [ ] | G-19 | 404 Not Found | `*` | `404_not_found_desktop` + `404_not_found_mobile` | `plan/features/STATIC-PAGES.md` |

---

### Guest App — Modals / Overlays

| Done | ID | Component | Trigger | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | M-01 | Room Detail Modal | Rooms Page "View Details" | `room_detail_modal_desktop` + `room_detail_modal_mobile` | `plan/features/ROOMS-PAGE.md` |
| [ ] | M-02 | Availability Filter Drawer (mobile) | Rooms Page filter bar | `availability_filter_drawer_mobile` | `plan/features/ROOMS-PAGE.md` |
| [ ] | M-03 | Corporate Access Code Gate | `/corporate/book` landing | `corporate_access_code_gate_desktop` + `corporate_access_code_gate_mobile` | `plan/features/CORPORATE-BOOKING.md` |
| [ ] | M-04 | Voucher Input (inline) | Booking Step 3 | `booking_step_3_with_voucher_desktop` + `booking_step_3_with_voucher_mobile` | `plan/features/BOOKING-FLOW.md` |

---

### Admin App — Pages

| Done | ID | Screen | Route | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | A-01 | Admin Login | `/login` | `admin_login_desktop` + `admin_login_mobile` | `plan/features/AUTH-ROLES.md` |
| [ ] | A-02 | Dashboard Overview | `/` | `admin_dashboard_desktop` + `admin_dashboard_mobile` | `plan/features/DASHBOARD-OVERVIEW.md` |
| [ ] | A-03 | Bookings Management | `/bookings` | `bookings_management_desktop` + `bookings_management_mobile` | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | A-04 | Room Management | `/rooms` | `room_management_desktop_1` + `room_management_desktop_2` + `room_management_mobile` | `plan/features/ROOM-MANAGEMENT.md` |
| [ ] | A-05 | Rate Management | `/rates` | `rate_management_desktop_1` + `rate_management_desktop_2` + `rate_management_mobile` | `plan/features/RATE-MANAGEMENT.md` |
| [ ] | A-06 | Reports | `/reports` | `reports_desktop` + `reports_mobile` | `plan/features/REPORTS.md` |
| [ ] | A-07 | Corporate Inquiries | `/corporate` | `corporate_inquiries_desktop` + `corporate_inquiries_mobile` | `plan/features/CORPORATE-INQUIRIES.md` |
| [ ] | A-08 | Intercom Inbox | `/intercom` | `intercom_inbox_desktop_1` + `intercom_inbox_desktop_2` + `intercom_inbox_mobile` | `plan/features/INTERCOM-INBOX.md` |
| [ ] | A-09 | QR Management | `/qr` | `qr_management_desktop` + `qr_management_desktop_refined` + `qr_management_mobile` | `plan/features/QR-MANAGEMENT.md` |
| [ ] | A-10 | Members (Spark Rewards) | `/members` | `member_management_desktop` + `member_management_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | A-11 | Settings | `/settings` | `hotel_settings_desktop` + `hotel_settings_mobile` + `staff_management_desktop` + `staff_management_mobile` | `plan/features/SETTINGS.md` |

---

### Admin App — Drawers / Modals

| Done | ID | Component | Trigger | Stitch Source | Feature MD |
|---|---|---|---|---|---|
| [ ] | D-01 | Booking Detail Drawer | Bookings table row click | `booking_detail_drawer_desktop_1` + `booking_detail_drawer_desktop_2` + `booking_detail_drawer_mobile` | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | D-02 | Room Edit Drawer | Room Management "Edit" | `room_edit_drawer_desktop` + `room_edit_drawer_mobile_1` + `room_edit_drawer_mobile_2` | `plan/features/ROOM-MANAGEMENT.md` |
| [ ] | D-03 | Corporate Inquiry Detail Drawer | Corporate Inquiries card click | `inquiry_detail_drawer_desktop` + `inquiry_detail_drawer_mobile` | `plan/features/CORPORATE-INQUIRIES.md` |
| [ ] | D-04 | Member Detail Drawer | Members table row click | `member_detail_drawer_desktop` + `member_detail_drawer_mobile` | `plan/features/SPARK-REWARDS.md` |
| [ ] | D-05 | Store Order Detail Drawer | Intercom / Store Reports | `store_order_detail_drawer_desktop_1` + `store_order_detail_drawer_desktop_2` + `store_order_detail_drawer_mobile` | `plan/features/STORE-MANAGEMENT.md` |
| [ ] | M-05 | Walk-in Booking Modal | Bookings "+ Walk-in Booking" button | `walk_in_booking_modal_desktop` + `walk_in_booking_modal_mobile` | `plan/features/BOOKINGS-MANAGEMENT.md` |
| [ ] | M-06 | Add/Edit Voucher Modal | Rate Management Vouchers tab | `add_edit_voucher_modal_desktop` + `add_edit_voucher_modal_mobile` | `plan/features/VOUCHERS.md` |

---


## Phase Order

Build in this order — components before pages, guest before admin.

1. **Component library** — all guest + admin components in the table above. Do not start any page until these are done.
2. **Guest pages** — G-01 Homepage → G-02 Rooms → G-03–G-06 Booking Flow → G-07 Lookup → G-17 About → G-18 Contact → G-08 Corporate → G-16 Intercom → G-19 404 → G-10–G-15 Rewards/Auth
3. **Guest modals** — M-01–M-04
4. **Admin pages** — A-01 Login → A-02 Dashboard → A-03 Bookings → A-04 Rooms → A-05 Rates → A-06–A-11 remaining
5. **Admin drawers/modals** — D-01–D-05, M-05–M-06
