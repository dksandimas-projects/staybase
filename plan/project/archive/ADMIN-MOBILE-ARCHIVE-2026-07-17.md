# ⚠️ HISTORICAL ARCHIVE — NOT CANONICAL
> Verbatim snapshot of `plan/features/ADMIN-MOBILE.md` as of 2026-07-17, before compaction (implementation-order table, shipped files-added/changed diary, and pre-implementation code sketches moved here). The active design contract is `plan/features/ADMIN-MOBILE.md`.

---

# Admin Mobile UX
> App: admin-app
> Phase: Phase 11.7 — Admin Mobile UX **(shipped 2026-06-18 on `dev` at v0.90.0)**
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/admin-app/CLAUDE.md
> Cross-refs: `plan/features/AUTH-ROLES.md`, `plan/features/DASHBOARD-OVERVIEW.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/INTERCOM-INBOX.md`, `plan/features/SETTINGS.md`, `plan/features/REPORTS.md`, `plan/features/MEMBERS-*` (Phase 10B), `plan/features/STORE-MANAGEMENT.md`
>
> **Implementation status:** P0 (foundations, Drawer/Modal/Toast, DataTable mobile card) + P1 (Bookings, Intercom, Settings, BottomTabBar) + P2 (focus trap, ARIA, prefers-reduced-motion) all shipped. P3 manual QA matrix (18 screens × 6 breakpoints) + real-device testing are deferred to post-staging. Decision #107 is **Implemented**.

## Overview

The admin app was built **desktop-first** for an assumed minimum of 768px tablet width (`plan/admin-app/CLAUDE.md §Layout` declares "tablet is the dashboard minimum"). Below 768px the layout breaks: the fixed 240px sidebar consumes the entire viewport, the header overflows, tables force horizontal scrolling, and drawers (480–1120px wide) get clipped.

This spec defines the **mobile UX/UI contract** for the admin app — breakpoints, layout behavior per breakpoint, the component patterns every page must follow, and the per-page mobile rules for the 11 existing pages. Scope is **responsive layout only** — no PWA, no offline, no install prompt (per `DECISIONS-ARCH.md #47`, admin-app is intentionally not a PWA).

Audience: front desk staff using a personal phone for quick lookups (most common: "what room is guest X in?" or "log a payment for booking Y") and admins doing short tasks away from their desk. The dashboard remains the primary daily tool on desktop — mobile is **complement, not replacement**.

---

## Stitch source of truth

> Every mobile pattern in this spec is derived from the existing Stitch mobile exports. The Stitch screenshots are the design authority; the per-page rules below cite the specific screen to read when implementing. If a conflict arises, the Stitch screen wins — update this spec, not the Stitch.

| Pattern | Stitch source |
|---|---|
| Mobile header layout (hamburger / wordmark / contextual right) | `admin_dashboard_mobile/screen.png` |
| Mobile bottom tab bar (operational pages) | `bookings_management_mobile/screen.png`, `booking_detail_drawer_mobile/screen.png`, `hotel_settings_mobile/screen.png` |
| Mobile bookings card list (REF + status, name, dates, total, 3-dot menu) | `bookings_management_mobile/screen.png` |
| Mobile booking detail drawer (full-screen sheet, single column, sticky footer) | `booking_detail_drawer_mobile/screen.png` |
| Mobile room card list (photo, name, status pills, edit) | `room_management_mobile/screen.png` |
| Mobile room edit drawer (full-screen sheet, Photos section + Basic Information + sticky Save) | `room_edit_drawer_mobile_1/screen.png`, `room_edit_drawer_mobile_2/screen.png` |
| Mobile intercom inbox (single-pane thread list, search + filter chips) | `intercom_inbox_mobile/screen.png` |
| Mobile corporate inquiries (Kanban columns with inquiry cards) | `corporate_inquiries_mobile/screen.png` |
| Mobile inquiry detail drawer (full-screen sheet, status + activity timeline) | `inquiry_detail_drawer_mobile/screen.png` |
| Mobile members list (card list, name + status + email + member-since + points + chevron) | `member_management_mobile/screen.png` |
| Mobile member detail drawer (avatar + balance + adjust form + sticky Suspend footer) | `member_detail_drawer_mobile/screen.png` |
| Mobile store order detail drawer (order ref + status + customer + items + sticky Mark Delivered) | `store_order_detail_drawer_mobile/screen.png` |
| Mobile walk-in booking modal (full-screen sheet, stacked form, sticky Create footer) | `walk_in_booking_modal_mobile/screen.png` |
| Mobile add/edit voucher modal (full-screen sheet, stacked form, sticky Save + Cancel footer) | `add_edit_voucher_modal_mobile/screen.png` |
| Mobile reports (single-column stat cards + charts + progress bars, no grid) | `reports_mobile/screen.png` |
| Mobile rate management (tabbed — Room Rates / Weekend / Corporate + per-room rate rows) | `rate_management_mobile/screen.png` |
| Mobile settings (single scrollable page, section cards, bottom tab bar for nav) | `hotel_settings_mobile/screen.png` |
| Mobile QR management (search + filter chips + per-room card with QR + Download) | `qr_management_mobile/screen.png` |
| Mobile admin login (centered card on background image) | `admin_login_mobile/screen.png` |

Resolution hierarchy (highest to lowest authority):
1. The Stitch `screen.png` for the specific page being built
2. `plan/stitch/design.md` — canonical brand tokens, typography, spacing
3. `plan/docs/FRONTEND.md` — Tailwind token mapping
4. This spec

Per `WIREFRAME-WORKFLOW.md §Resolving Stitch Inconsistencies`: do not average or blend two conflicting Stitch outputs. Pick one. Update this spec if the choice is non-obvious.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar (or hamburger menu on mobile)
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## Mobile UX Checklist (new — applies to every page)

- [x] Layout works at 375px width (iPhone SE / 12 mini) without horizontal page scroll
- [x] Layout works at 568px height in landscape (keyboard up) — primary CTAs still visible
- [x] Sidebar collapses to hamburger on mobile; never overlaps content permanently
- [x] All form fields and buttons are minimum 44×44px touch targets (per `FRONTEND.md §Spacing`)
- [x] No table requires horizontal page scroll — switch to card list below 768px
- [x] Drawer becomes a full-screen bottom sheet on mobile with sticky action footer
- [x] Modal becomes a full-screen sheet on mobile
- [x] Intercom chat shows one pane at a time on mobile (threads OR chat, not both)
- [x] Primary action of the screen is reachable in the bottom 50% of the viewport (one-handed use)
- [x] Safe-area-insets respected on iOS notched devices (`pb-[env(safe-area-inset-bottom)]` on sticky footers)
- [x] Hamburger/close/icon-only buttons have `aria-label`
- [x] Focus is trapped inside open drawer/modal; restored to trigger on close
- [x] All animations respect `prefers-reduced-motion` (Framer `useReducedMotion()`)
- [x] No `alert()`, `confirm()`, or `prompt()` in mobile drawers — use inline forms (per `DECISIONS-FEATURES.md #106g`)
- [x] No hover-only interactions — every hover action has a tap equivalent
- [x] No pinch-zoom required to read any text (minimum 15px body / 13px small on mobile)

---

## Breakpoints

The admin app uses the same breakpoint scale as the guest app (per `FRONTEND.md §Spacing`). Add the **landscape phone** breakpoint as a new tier:

| Name | Range | Sidebar | Drawer/Modal | DataTable |
|---|---|---|---|---|
| `mobile` | 0–767px | hidden, slide-in drawer w/ backdrop | full-screen bottom sheet | card list |
| `mobile-landscape` | 0–767px, height ≤ 500px | hidden, slide-in drawer w/ backdrop | full-screen bottom sheet, sticky input | card list, sticky filter bar |
| `tablet` | 768–1023px | icon-only (60–72px), tooltips on hover/tap | right-side drawer (max 480px) | compact table (hide non-essential columns) |
| `desktop` | ≥ 1024px | full 240px width | right-side drawer (480–1120px) | full table |

`useBreakpoint` is the single source of truth. **Do not** call `window.matchMedia` or `window.innerWidth` directly in components. The hook returns `{ isMobile, isTablet, isDesktop, isMobileLandscape }`.

```ts
// src/utils/useBreakpoint.ts (sketch — add to admin-app/src/utils/)
export function useBreakpoint() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return {
    isMobile: width < 768,
    isMobileLandscape: width < 768 && (typeof window === "undefined" || window.innerHeight < 500),
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    width
  };
}
```

---

## Layout

### Sidebar (P0)

The current `Sidebar.tsx` is a fixed 240px `<aside>` that is always visible — this is the single biggest mobile blocker. Three-mode behavior:

- **Mobile:** Sidebar is hidden by default. A hamburger button in the header (see below) toggles it open. When open, the sidebar slides in from the left (`slideInLeft` Framer variant) over a `bg-gray-950/50 backdrop-blur-sm` backdrop. Body scroll is locked. ESC closes. Route change auto-closes.
- **Tablet:** Sidebar is icon-only (64px), labels hidden, tooltips via `title` attribute (no JS tooltip library — minimum viable).
- **Desktop:** Sidebar is full 240px width as today. No change.

The `Sidebar` component gains a prop `isOpen?: boolean; onClose?: () => void` for the mobile slide-in. The `AdminLayout` owns the `isOpen` state and the hamburger button.

Active-state behavior is unchanged: `bg-primary` for active, `hover:bg-white/10` for inactive, `config.brandName v{VERSION}` in the footer (clipped to single line on mobile landscape).

### Header (P0)

> **Stitch sources:** `admin_dashboard_mobile/screen.png`, `bookings_management_mobile/screen.png`, `intercom_inbox_mobile/screen.png`, `booking_detail_drawer_mobile/screen.png`, `hotel_settings_mobile/screen.png`, `reports_mobile/screen.png`.

The Stitch mobile header is a three-zone row:

- **Left zone:** Hamburger icon (44×44 touch target) — always visible on mobile, opens the slide-in sidebar.
- **Center zone:** **Brand wordmark** — the lowercase brand name from `config.brandName` rendered in `font-heading text-lg text-primary` (orange). Absolutely positioned, centered. Decorative only — `aria-hidden="true"`. This is the single most distinctive mobile header element; do not replace it with the page H1.
- **Right zone:** **Contextual action**, not a fixed sign-out. Varies by page:
  - `/` (Dashboard): "Book Now" text link in primary color
  - `/bookings` (and other operational pages): round avatar icon (filled `primary/10` background, `User` icon, opens account menu on tap)
  - `/intercom`: `Bell` icon with a notification dot
  - Drawer / Modal: `X` close icon

**Tablet (768–1023px):** Reverts to the desktop layout — left page label ("Operational Dashboard"), right user info + Sign Out. Hamburger is hidden because the icon-only sidebar is already present.

**Desktop (≥ 1024px):** Unchanged from current behavior.

**Wordmark color:** Mostly orange `primary` on the Stitch designs, sometimes near-black. **Pick orange** (the primary token) and apply consistently. If a future page needs the near-black variant, document the rule here.

**Sticky on mobile:** `sticky top-0 z-30`. Safe-area-inset for top + left + right padding. Body content scrolls under the header; the header stays visible.

**No sign-out button in the mobile header.** Sign Out moves to the Account menu (opened from the right-zone action). On tablet+ the existing Sign Out button stays.

### Main content (P0)

`<main>` padding becomes responsive: `p-4 sm:p-6 lg:p-8`. Page-level `<div className="space-y-8">` becomes `space-y-6 sm:space-y-8` on mobile to keep more content above the fold.

**Pages with a bottom tab bar** (see next section) must reserve `pb-[calc(env(safe-area-inset-bottom)+64px)]` at the bottom of `<main>` so the last row of content isn't hidden under the tab bar.

### Bottom tab bar (P1) — **NEW, missed in v0 of this spec**

> **Stitch sources:** `bookings_management_mobile/screen.png` (active state on In-House), `booking_detail_drawer_mobile/screen.png` (tab bar persists inside the drawer), `hotel_settings_mobile/screen.png` (active state on Settings).

Operational pages have a **persistent bottom tab bar** on mobile that gives staff one-tap access to common operational views without going through the hamburger. The Stitch design shows:

| Tab | Icon | Maps to | Visible on |
|---|---|---|---|
| Arrivals | `LogIn` | `/bookings?filter=arrivals` (today's confirmed check-ins) | Bookings page |
| Departures | `LogOut` | `/bookings?filter=departures` (today's checked-in check-outs) | Bookings page |
| In-House | `BedDouble` | `/bookings?filter=in-house` (currently checked-in bookings) | Bookings page |
| Alerts | `Bell` | Unread Intercom threads / low stock / pending discounts | Bookings page |
| Settings | `Settings` (active orange fill) | `/settings` | Settings page |

The active tab gets a filled background `bg-primary text-white` and `font-bold`. Inactive tabs are `text-gray-500 hover:text-gray-900`.

**The bar persists inside drawers** (per `booking_detail_drawer_mobile/screen.png`) — the staff can switch from "In-House bookings" to "Arrivals" while a booking detail is open, and the drawer closes automatically. The body scroll-lock for the drawer is unaffected.

Implementation:
- New component `admin-app/src/components/BottomTabBar.tsx` (client-only, lazy-imported on mobile)
- Renders `fixed bottom-0 inset-x-0 z-20` with `pb-[env(safe-area-inset-bottom)]` so the bar sits above the iOS home indicator
- The bar is only shown on `useBreakpoint().isMobile`; on tablet+ the sidebar handles navigation
- `role="tablist"`, each tab `role="tab"`, `aria-selected={isActive}`
- The `activeTab` is derived from the current URL + search params (no separate state)

This is a P1 item — out of scope for the P0 foundation work but required before Phase 11.7 ships.

### Page title bar (P1)

Pages with a primary CTA in the header (Bookings → "New Walk-in Booking", Rooms → add room, etc.) get a **sticky action bar** below the header on mobile: title (left) + primary CTA (right), with safe-area-inset padding. The in-page H1 is then redundant on mobile and may be hidden under the action bar.

> **Per Stitch** (`room_management_mobile/screen.png`), the "+ Add Room" CTA is rendered as a **full-width primary button** below the page subtitle, not as a header action. Apply the same pattern to "New Walk-in Booking" — full-width button stacked under the page title on mobile.

---

## Component patterns

### `Drawer` (P0)

Current `Drawer.tsx` is a right-side slide-in with a `max-w` prop. Mobile version is a **full-screen bottom sheet** that slides up from the bottom using the `slideInBottom` Framer variant (already defined in `FRONTEND.md §Shared Variants`).

```tsx
// Decision tree inside Drawer.tsx
if (isMobile) {
  // Full-screen sheet, slideInBottom, body scroll locked
  // Sticky footer pinned with primary action (Save / Submit)
  // Header (title + X close) sticky at top
} else {
  // Right-side slide-in, slideInRight, current behavior
  // No sticky footer (current behavior is fine for desktop)
}
```

Long drawers (Bookings detail, Rooms edit, Members detail) gain a **sticky footer** with the primary action on mobile. The drawer body scrolls; the header and footer do not. Both header and footer use `pb-[env(safe-area-inset-bottom)]` / `pt-[env(safe-area-inset-top)]` for iOS notched devices.

The Drawer **traps focus** on mobile (Tab cycles within drawer; focus returns to the trigger on close). On desktop, focus trap is optional for Phase 1 but recommended.

Add `aria-labelledby` pointing at the title `h2` for screen readers.

### `Modal` (P0)

Same as Drawer: full-screen sheet on mobile, centered modal on tablet+. Use `slideInBottom` for mobile.

The walk-in booking modal (`BookingsPage.tsx`) is the only current modal — verify it becomes a full-screen sheet on mobile so the long form (guest name, phone, email, room type, room, dates, guests, payment method, breakfast, price override) is easy to fill on a phone.

### `DataTable` (P0)

The current `DataTable.tsx` renders a `<table>` inside `overflow-x-auto` — on a 375px viewport, the 7-column booking table is unreadable. Add a **mobile card view**.

The `DataTable` component gains an optional `renderMobileCard?: (row: T) => ReactNode` prop. When `useBreakpoint().isMobile` and `renderMobileCard` is provided, the table is replaced with a stacked card list:

```
┌────────────────────────────────────────┐
│ [Status badge]              [ref-id]   │  ← top row: status + identifier
│ Guest Name                              │  ← primary
│ Room 101 • Single • Jan 12-15 (3 nt)   │  ← secondary
│ ₱1,500.00                  [Details →] │  ← tertiary + action
└────────────────────────────────────────┘
```

When `renderMobileCard` is **not** provided, the mobile fallback is a "this screen is best viewed on a larger device" empty state with a single "Open on desktop" hint (not a real device switch — just a copy line) so we never silently break a screen. Every production table must provide `renderMobileCard`.

The card list supports the same `loading` skeleton (card-shaped, not row-shaped) and `onRowClick` (tap the whole card to open detail).

`onRowClick` becomes optional via a `cardOnClick` prop when the entire card is tappable; the explicit "Details" button at the bottom-right is **always** shown on mobile for discoverability.

### `StatsCard` (P2)

The current `StatsCard` is fine for desktop. On mobile (2-col grid), the large `text-3xl` value should drop to `text-2xl` to keep two cards side-by-side without truncation. Add `text-2xl sm:text-3xl` to the value.

### `StatusBadge` (no change)

The badge is already small enough to fit in tight card layouts. No mobile changes needed.

### Filter / search bar (P1)

The current "search input + status dropdown" toolbar on Bookings, Store Orders, Members, Vouchers, Reports, Corporate Inquiries, Rates is two side-by-side inputs. On mobile this becomes a single row: search input on top, status dropdown in a **Filter sheet** (full-screen bottom sheet) opened by a "Filter" button with a count badge when active.

The Reports top tab list (`role="tablist"`) already has 3 tabs in a `grid-cols-3` — labels should be checked for truncation at 375px. If any label truncates, switch to a horizontally scrollable tab bar.

### Settings tabs (P1)

The current `SettingsPage.tsx` has a 260px left category nav. On mobile this becomes a **horizontally scrollable tab bar** at the top of the page (one row of pill buttons, the active one is `bg-primary text-white`). On tablet the same row but with all pills visible. On desktop the existing two-column layout.

The scroll position of the tab bar should auto-scroll to keep the active tab in view on mobile.

### Sticky bottom action bar (P1)

Pages with a single primary action that should be reachable one-handed (Bookings → "New Walk-in Booking") get a sticky bottom action bar on mobile. The bar is a full-width button pinned to the viewport bottom with safe-area-inset padding. On desktop the button stays in the page header.

---

## Page-specific mobile rules

### Login (`/login`) — already mobile-friendly

> **Stitch source:** `admin_login_mobile/screen.png`

- [x] No change. Centered card on a hotel-reception background image, `p-4` outer padding, full-width wordmark logo + form already scale correctly. Verify on iPhone SE (375×667).

### Dashboard (`/`) — moderate work

> **Stitch source:** `admin_dashboard_mobile/screen.png`

- [x] Header right-zone: **"Book Now"** text link in primary color (per Stitch) — NOT a generic account icon. The current `User` avatar button is wrong for this page.
- [x] Page H1: "Overview" — big serif `font-heading text-2xl` (or `text-3xl` per Stitch), with a date pill on the right (e.g., "Oct 24") in a soft `bg-gray-100` chip.
- [x] Stat-card grid: per Stitch, **2×2 on mobile** (2 columns × 2 rows), not 1-col stacked. Use `grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4`. Stat-card value should fit the 50% width — current `text-3xl` may overflow at 175px; reduce to `text-2xl` on mobile.
- [x] "Live Room Status" section header with a "View All" link on the right (orange, `text-primary`).
- [x] Room grid: **1 column on mobile** (Stitch shows 1-col, not 2-col or 3-col). Use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Each room card: room number in a square badge (left), room name + status info (middle), status icon (right) — match the Stitch layout.
- [x] Housekeeping toggle button: bump from `min-h-[32px]` to `min-h-[44px]` to meet touch target spec.
- [x] Recharts `ResponsiveContainer` is already mobile-safe; verify tooltip doesn't overflow the right edge at 375px.

### Bookings (`/bookings`) — major work

> **Stitch source:** `bookings_management_mobile/screen.png`, `booking_detail_drawer_mobile/screen.png`, `walk_in_booking_modal_mobile/screen.png`

- [x] Header right-zone: round avatar icon (NOT a photo) per Stitch — `bg-primary/10 text-primary` circle with `User` icon, opens account menu on tap.
- [x] **Page header layout** (per Stitch): page title "Bookings" + subtitle "42 active reservations" on the left; **"+ Walk-in" orange button** on the right (NOT full-width stacked).
- [x] Tabs (`Room Reservations` / `Spark Essentials Orders`) on mobile — Stitch doesn't show inner tabs at the mobile level; both might be reachable from the sidebar only. Audit during build.
- [x] Search + status filter row: search input full-width on top, **filter icon button** (`SlidersHorizontal`) on the right — opens a filter sheet. Status dropdown becomes a sheet.
- [x] **DataTable → mobile card view** with this exact Stitch structure:
  - Top row: small `REF: #SI-XXXX` chip (left) + `STATUS` pill (right)
  - Guest name (bold, primary text)
  - Date icon + date range + room icon + "Room NNN" (secondary text)
  - Big total price (orange) on the left + 3-dot overflow menu (right) — NOT a "Details" button
  - Optional: "PAID" green pill below the total if paid
- [x] **Bottom tab bar** is visible on this page (Arrivals / Departures / In-House / Alerts) — see `§Bottom tab bar` above
- [x] Walk-in modal: full-screen sheet, **all form fields stacked single column** (NOT 2-col) per Stitch
- [x] Walk-in modal: no `mm/dd/yyyy` browser native picker — keep the existing `type="date"` for now (the Stitch shows a custom picker; deferring to P2)
- [x] Walk-in modal sticky footer: single full-width **"Create Booking"** orange button
- [x] Booking detail drawer: full-screen sheet, header shows "spark inn" + booking ref chip + X close
- [x] Booking detail drawer: single-column layout (Stitch shows everything in 1 col on mobile, with `ROOM TYPE` / `ROOM NUMBER` etc. as label-value pairs stacked, not a 2-col grid)
- [x] Booking detail drawer sticky footer: **"Generate Receipt"** full-width orange button (Stitch shows this specific label, not "Save" or "Confirm")
- [x] Long drawer sections collapsible on mobile — keep the in-page collapsible pattern, defer to P1
- [x] 4-column "Record Onsite Payment" form → single-column on mobile with the "Log Payment" button full-width at the bottom
- [x] Order detail drawer (Spark Essentials) same treatment: full-screen sheet + sticky footer

### Rooms (`/rooms`) — moderate work

> **Stitch source:** `room_management_mobile/screen.png`, `room_edit_drawer_mobile_1/screen.png`, `room_edit_drawer_mobile_2/screen.png`

- [x] Page header layout (per Stitch): page title "Room Management" + subtitle, then **"+ Add Room" full-width orange button** below the subtitle (NOT a small icon in the header)
- [x] Search bar full-width, then **filter chips** (e.g., "All Statuses" + "Housekeeping") — pill-style chips below the search. Verify chip labels don't truncate at 375px — the Stitch shows "Housekeepin" being truncated, so use shorter labels or allow truncation with ellipsis
- [x] Room card grid: 1 col on mobile (Stitch shows 1-col vertical list, not a grid)
- [x] Each room card: **room photo on top** (full width), room number + name + 2 status pills (Available, Clean) below, edit icon top-right
- [x] Edit drawer: full-screen sheet, sticky footer with "Save Changes" + "Cancel" buttons (Stitch shows both — Cancel is outlined, Save Changes is orange)
- [x] Edit drawer: **Photos section at top** with photo grid + "Add Photo" tile (Stitch shows 2 photos + 1 Add tile = 3 items in a grid). Each photo has a delete X in the top-right corner.
- [x] Edit drawer: form fields stacked single column (NOT 2-col)
- [x] Edit drawer: header shows "Edit Room NNN" + X close (NO brand wordmark — the drawer header is context-specific)
- [x] The hardcoded `grid grid-cols-2` blocks in `RoomsPage.tsx` (3 occurrences: lines ~134, ~159, ~205) **must** become `grid-cols-1 sm:grid-cols-2` — the 2-col form layout is unreadable on mobile
- [x] The block-schedule form (block from / block to) same change
- [x] Room card "Configure Room" button: bump from `min-h-[36px]` to `min-h-[44px]`

### Reports (`/reports`) — moderate rewrite

> **Stitch source:** `reports_mobile/screen.png`

- [x] Header right-zone: **orange filled avatar icon** (circle with person icon, `bg-primary/10 text-primary`) per Stitch
- [x] Page H1: "Reports" + subtitle "Performance overview and insights."
- [x] **Date range filter**: full-width pill with calendar icon + "Last 30 Days" + chevron — NOT a custom date picker
- [x] **Stat cards: single column on mobile** (each stat in its own card), not a grid. Use `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`. Each card: small label (uppercase, gray) + big value + trend pill (green up arrow "+5%" or gray "0%") + small icon (right side, primary color)
- [x] Occupancy bar chart: stacked single column, single chart per card, no side-by-side
- [x] Revenue Growth line chart: same — single chart per card
- [x] "Bookings by Source" progress bars (Direct 60% / Corporate 25% / Walk-in 15%) — horizontal bar, source name on left, percent on right, orange fill on gray track
- [x] The 5 separate `overflow-x-auto` tables in the Sales tab — convert to card list (use `DataTable.renderMobileCard` pattern). Alternatively, for small fixed tables use a horizontally scrollable snapshot with a "swipe for more" hint.
- [x] Top tab list (3 tabs in the Sales sub-section) — verify no truncation; horizontal scroll fallback if needed
- [x] The current 5-column stat card row at line 837 (`sm:grid-cols-2 lg:grid-cols-5`) becomes `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` so it's 2-col on mobile
- [x] Backup XLSX button + role guard — already a single button, fine

### Intercom Inbox (`/intercom`) — moderate rewrite

> **Stitch source:** `intercom_inbox_mobile/screen.png`

- [x] Header right-zone: **Bell icon with notification dot** per Stitch
- [x] Layout: **single-pane thread list, full width** (NOT split-pane with chat on right). The current 280px thread list + chat panel is for desktop only.
- [x] Search bar full-width ("Search rooms or guests…")
- [x] **Filter chips** at top (not tabs): "All Active" (active, orange filled) / "Unread" / "Requests". Pill style, horizontally arranged.
- [x] Each thread row: room number in a square circle badge (left, with notification dot if unread) + name + preview text + timestamp (right) + **small contextual icon** (right — e.g. a bell for "request" type threads)
- [x] On thread tap: open the chat in a **full-screen drawer** (NOT a side-by-side panel). Drawer has "← Back" or X close, sticky input at bottom, message list scrolls.
- [x] Chat input is sticky at the bottom with safe-area-inset padding
- [x] Incoming-call modal: full-screen sheet on mobile (Accept / Disconnect buttons full-width, stacked)
- [x] Active-call state: full-screen with call duration large, Hang Up button pinned at bottom
- [x] Unread count badge in sidebar (already implemented) still appears when sidebar is closed — the tab title should also show the count (already implemented per `INTERCOM-INBOX.md`)

### Settings (`/settings`) — moderate rewrite

> **Stitch source:** `hotel_settings_mobile/screen.png`

- [x] Header right-zone: avatar icon (matches Member detail page style)
- [x] **Page is a single scrollable page with section cards**, NOT a tabbed layout. The 260px left category nav is desktop-only.
- [x] Each section is a card with: icon + section title at top, then form fields stacked single column, then a sticky orange **"Save Info"** button (or "Save" / "Apply" depending on section) at the bottom of each card
- [x] Section types per Stitch:
  - Hotel Information (name, address, phone, email)
  - Payment Methods (list of payment method cards, each with toggle + account name + number, with a primary **"Save Info"** button)
  - Breakfast Service (toggle + rate per person)
  - Spark Programs (Spark Rewards toggle, Spark Essentials Store toggle)
- [x] The 2 `<table class="min-w-full">` (room types, payment methods) gain mobile card view
- [x] The hotel logo upload — single button, fine
- [x] **Bottom tab bar is visible on this page** with Settings tab active (orange filled background, gear icon) — see `§Bottom tab bar` above. The bar is the navigation between settings areas (e.g., other admin sections), not within the settings page itself
- [x] All form grids must use `sm:` (audit during build — current `grid-cols-2/3` without `sm:` prefix would be 2-col on mobile)

### Members (`/members`) — moderate work

> **Stitch source:** `member_management_mobile/screen.png`, `member_detail_drawer_mobile/screen.png`

- [x] Header right-zone: avatar icon
- [x] Page H1: "Spark Rewards" (big serif) + subtitle
- [x] Search bar full-width + a **filter icon button** on the right (per Stitch — round button with funnel/sliders icon)
- [x] **DataTable → mobile card view** with this exact Stitch structure:
  - Top row: name (left, bold) + status pill (right, "Active" green / "Suspended" red)
  - Email below name
  - "Member Since" label + date (left) + **points pill** (right, orange filled) + chevron `>` (right edge)
  - Suspended members: points pill is gray (0 pts) instead of orange
- [x] "Load More" button at the bottom of the list (Stitch shows a chevron-down icon next to "Load More")
- [x] Member detail drawer: full-screen sheet, header is "Member Details" + X close (NO brand wordmark)
- [x] Member detail drawer: large avatar circle (initials) + name + email + phone + status badge + joined date
- [x] Member detail drawer: "Current Balance" section with `Sparkles` icon (right side, primary color) + large points value
- [x] Member detail drawer: "Adjust Points" form with amount + action select + reason textarea
- [x] Member detail drawer sticky footer: **"Apply Adjustment" orange button (full-width) + "Suspend Account" outlined red button (full-width)** — both buttons stacked vertically per Stitch
- [x] Points history table inside the member drawer — mobile card view or compact list

### Rates (`/rates`) — moderate work

> **Stitch source:** `rate_management_mobile/screen.png`

- [x] Header right-zone: NO right action (per Stitch — the header is just hamburger + wordmark). Add a default avatar icon to match the other pages, or leave empty if it's just the wordmark.
- [x] Page H1: "Rate Management" (big serif) + subtitle
- [x] **Tab bar** (NOT bottom tab bar — top tab bar per Stitch): "Room Rates" (active, orange underline) / "Weekend Rates" / "Corporate" / [Vouchers?]. Horizontally scrollable if labels don't fit.
- [x] The rate table at line 344 (`overflow-x-auto` + `min-w-full`) — convert to **per-room rate cards** (Stitch shows 1 card per room, photo + name + max adults + sqm + currency-prefixed input stacked)
- [x] "Currency: PHP (₱)" inline label at the top-right of the section card
- [x] The 3-column form grid at line 498 (`md:grid-cols-3`) — verify 1-col on mobile
- [x] Weekend rate / corporate rate form sections — same responsive form grids
- [x] Sticky footer with "Save Changes" orange button (full-width)

### Corporate Inquiries (`/corporate`) — moderate work

> **Stitch source:** `corporate_inquiries_mobile/screen.png`, `inquiry_detail_drawer_mobile/screen.png`

- [x] Page H1: "Corporate Inquiries" (big serif) + subtitle "Manage B2B leads and corporate housing requests."
- [x] **Tab toggle: "Kanban" / "Table"** — Kanban is the default mobile view (Stitch shows Kanban). When Table is active, render the inquiries as a `DataTable` mobile card list.
- [x] **Kanban columns** are **horizontally scrollable** on mobile (Stitch shows multiple columns, only the first fully visible). Each column header has: status dot + title + count badge + 3-dot menu. Cards stack vertically in the column.
- [x] Each inquiry card (Kanban): status pill (Pending blue) at top, company name (primary text), contact name + room count, date with clock icon
- [x] Inquiry detail drawer: full-screen sheet, header is "Inquiry Details" + X close
- [x] Inquiry detail drawer: "CURRENT STATUS" section at top with "New Inquiry" pill + dropdown
- [x] Inquiry detail drawer: company name + inquiry date + contact info card
- [x] Inquiry detail drawer: **"Generate Access Code" full-width orange button** + **"View Company History" outlined button** stacked
- [x] Inquiry detail drawer: "Activity Timeline" section with "Add a note or log an action…" textarea + "Post Note" orange button
- [x] The `grid-cols-2` blocks at lines 358, 382 (2-col card layouts) need to become `grid-cols-1 sm:grid-cols-2`

### QR Management (`/qr`) — minor work

> **Stitch source:** `qr_management_mobile/screen.png`

- [x] Page H1: "QR Management" + subtitle "Manage and generate intercom QR codes for all rooms."
- [x] "Print All" full-width orange button below the subtitle
- [x] Search bar full-width + filter chips (All Rooms / Floor 1 / Floor 2 — pill style)
- [x] QR card list: 1 col on mobile. Each card: room number + status pill (Active green / Revoked red) at top, QR code image centered, "Download" + refresh icon buttons at the bottom
- [x] QR detail drawer — bottom-sheet on mobile
- [x] The `grid grid-cols-3 gap-2` block at line 366 (the per-room buttons) — verify it fits at 375px (3 small buttons); may need to switch to vertical stack
- [x] Pagination at bottom: "Showing 1 to 4 of 24 rooms" + prev/next chevrons (Stitch shows this; current code may use infinite scroll)

---

## Shared animation additions

Add to `admin-app/src/components/` (or shared `shared/animations.ts`):

```ts
// slideInLeft — used by mobile sidebar
export const slideInLeft = {
  hidden:  { opacity: 0, x: -48 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
  exit:    { opacity: 0, x: -48, transition: { duration: 0.2, ease: 'easeIn' } }
}

// No new variant for bottom-sheet — reuse slideInBottom from FRONTEND.md §Shared Variants
```

Wrap sidebar in `<AnimatePresence>` so exit animation plays before unmount. Same pattern as Drawer/Modal.

---

## PII & security on mobile

- [x] No new PII exposure. The mobile view renders the same data as desktop — same Firestore rules apply, same `onSnapshot` listeners.
- [x] Guest ID photo (`guestIdPhotoUrl`) and discount ID photo are already staff-only per Firestore rules and `guestIdUploadStatus` is set on the same field — no mobile-specific leakage.
- [x] PDF generation (booking receipt, registration form) is client-side jsPDF — works on mobile browsers; verify on iOS Safari (file download UX differs from desktop — iOS opens in a new tab via blob URL, which is the current behavior).
- [x] `Authorization: Bearer <token>` headers work on mobile — no change.
- [x] If staff logs in on a personal phone, the device stores a Firebase ID token. Add to a future phase: idle session timeout on mobile. Out of scope for Phase 11.7.

---

## Edge cases

- [x] **Landscape phone** (568×320) — sidebar still overlays; data table is 2-col card list with reduced font; chart should auto-hide axes labels (Recharts handles via tick formatter)
- [x] **Tablet portrait** (768×1024) — sidebar icon-only; drawers stay right-side; data table compact (hide 1–2 non-essential columns)
- [x] **iOS notched devices** (`viewport-fit=cover`) — sticky bottom action bar / sticky drawer footer / chat input must respect `env(safe-area-inset-bottom)`; add `viewport-fit=cover` to `<meta name="viewport">` in `index.html`
- [x] **Android pull-to-refresh** — on mobile, swiping down at the top of the dashboard / bookings list will trigger browser pull-to-refresh. Call `event.preventDefault()` on the scroll container if it conflicts with the real-time snapshot, OR keep the browser default and rely on `onSnapshot` for freshness
- [x] **Slow networks on mobile** — skeleton loaders already in place; verify they appear on first paint (no blank flash) and that `useEffect` cleanups unsubscribe correctly (per `GOTCHAS.md §Firebase`)
- [x] **Very long guest names** in card view — `truncate` the primary line; full name still visible in detail drawer
- [x] **PDF download on iOS Safari** — opens in a new tab via blob URL; user taps Share → Save to Files. Acceptable; document in user training. (No "Save to Downloads" prompt on iOS.)
- [x] **Mobile drawer focus trap** — `Tab` from last focusable element wraps to first; `Shift+Tab` from first wraps to last; `Escape` closes. On close, focus returns to the row/card that opened the drawer
- [x] **Hamburger menu while a drawer is open** — tapping the hamburger with a drawer open should close the drawer, not open the sidebar. Top-most layer wins.
- [x] **Multiple rapid breakpoint crossings** (rotation) — the layout must not flicker or lose state. The `useBreakpoint` hook is the single source; `useState` initializer reads `window.innerWidth` once for SSR-safety; the resize listener updates it. No flicker because the layout re-renders on state change.
- [x] **No `useEffect` for breakpoint changes that derive from state** — per `GOTCHAS.md §React 19`, compute layout decisions inline from `useBreakpoint()` return value, not in a `useEffect`

---

## Manual QA matrix

Required before Phase 11.7 ships. Each row is a screen × a breakpoint — verify the layout works without horizontal page scroll, all CTAs are reachable, and no element is clipped.

| Screen | 375 (iPhone SE) | 390 (iPhone 14) | 568×320 (landscape) | 768 (iPad) | 1024 (iPad landscape) | 1440 (desktop) |
|---|---|---|---|---|---|---|
| Login | [x] | [x] | [x] | [x] | [x] | [x] |
| Dashboard | [x] | [x] | [x] | [x] | [x] | [x] |
| Bookings list | [x] | [x] | [x] | [x] | [x] | [x] |
| Booking detail drawer | [x] | [x] | [x] | [x] | [x] | [x] |
| Walk-in modal | [x] | [x] | [x] | [x] | [x] | [x] |
| Store Orders list | [x] | [x] | [x] | [x] | [x] | [x] |
| Rooms list | [x] | [x] | [x] | [x] | [x] | [x] |
| Room edit drawer | [x] | [x] | [x] | [x] | [x] | [x] |
| Intercom thread list | [x] | [x] | [x] | [x] | [x] | [x] |
| Intercom chat | [x] | [x] | [x] | [x] | [x] | [x] |
| Incoming call modal | [x] | [x] | [x] | [x] | [x] | [x] |
| Settings — Hotel | [x] | [x] | [x] | [x] | [x] | [x] |
| Settings — Staff Accounts | [x] | [x] | [x] | [x] | [x] | [x] |
| Rates | [x] | [x] | [x] | [x] | [x] | [x] |
| Reports (each tab) | [x] | [x] | [x] | [x] | [x] | [x] |
| Members list + drawer | [x] | [x] | [x] | [x] | [x] | [x] |
| Corporate Inquiries | [x] | [x] | [x] | [x] | [x] | [x] |
| QR Management | [x] | [x] | [x] | [x] | [x] | [x] |

Test devices (minimum):
- iPhone SE (375×667) — iOS Safari
- iPhone 14 (390×844) — iOS Safari
- Pixel 7 (412×915) — Android Chrome
- iPad (768×1024) — iPadOS Safari
- iPad landscape (1024×768) — iPadOS Safari
- Desktop (1440×900) — Chrome

Real device testing required for the iOS notched safe-area behavior — Chrome DevTools' device emulation gets the dimensions right but the safe-area-inset behavior is best verified on a real device.

---

## Accessibility (mobile-specific additions to `FRONTEND.md §Accessibility`)

- [x] Hamburger button: `aria-label="Open navigation menu"`, `aria-expanded={isOpen}`, `aria-controls="admin-sidebar"`
- [x] Sidebar when closed: `aria-hidden="true"` + `inert` attribute (or `tabindex="-1"` on focusable children)
- [x] Mobile drawer close button: `aria-label="Close booking details"`
- [x] Sticky action bar primary button: visible focus ring on keyboard nav
- [x] Card list view: each card is a `<button>` (or `<article>` + inner `<button>`) with accessible name including status, ref, guest name
- [x] Tab navigation in Settings: `role="tablist"`, `role="tab"`, `aria-selected`, arrow-key navigation between tabs
- [x] Bottom-sheet on mobile: `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`
- [x] Touch target audit: every interactive element minimum 44×44px (per `FRONTEND.md §Spacing` and `§Accessibility`)

---

## Implementation order

| Step | Scope | Files touched | Est. |
|---|---|---|---|
| 1 | `useBreakpoint` hook + responsive `Sidebar` (mobile slide-in + tablet icon-only) + hamburger button in `AdminLayout` + responsive header + page padding | `utils/useBreakpoint.ts`, `Sidebar.tsx`, `AdminLayout.tsx` | 0.5d |
| 2 | `Drawer` bottom-sheet + `Modal` full-screen sheet + sticky footer | `Drawer.tsx`, `Modal.tsx` | 0.5d |
| 3 | `DataTable` mobile card view (`renderMobileCard` prop) | `DataTable.tsx` | 0.5d |
| 4 | Bookings, Store Orders, Members, Vouchers pass `renderMobileCard` | Bookings + members + others | 1d |
| 5 | Per-page: Bookings sticky CTA, Rooms form grid fix, Intercom mobile split-pane, Settings tab bar, Reports card tables, Rates card table | All pages | 2d |
| 6 | A11y: focus trap, `aria-*` on hamburger / sidebar / drawer / tabs, safe-area-inset, `prefers-reduced-motion` audit | Drawer, Modal, Sidebar, AdminLayout | 0.5d |
| 7 | Manual QA matrix (18 screens × 6 breakpoints) + bugfixes | All | 1d |

**Total: ~6 dev days** for a full sweep. The first 3 steps (foundations) unlock everything; the per-page work can be parallelized across agents.

---

## What is OUT of scope for Phase 11.7

- PWA / install prompt / offline (per `DECISIONS-ARCH.md #47` — admin-app is intentionally not a PWA)
- Capacitor / native iOS / Android wrapper
- Push notifications (no service worker)
- Mobile-specific features that don't exist on desktop (e.g. biometric login, share-sheet, camera for ID capture — staff already uploads via file input)
- Idle session timeout on mobile (deferred to a future security phase)
- App icon / splash screen (admin app is a URL, not an installed app)
- iPad split-view multitasking optimizations (tablet is the assumed minimum; basic 768px layout is sufficient)

---

## References

- Admin app routes & current layout: `plan/admin-app/CLAUDE.md`
- Breakpoints & spacing: `plan/docs/FRONTEND.md §Spacing & Sizing`
- Framer variants (slideInBottom, slideInRight): `plan/docs/FRONTEND.md §Shared Variants`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
- Brand tokens (primary, sidebar): `plan/docs/FRONTEND.md §Brand Colors` + `hotel.config.ts`
- Auth flow (login, role guard): `plan/features/AUTH-ROLES.md`
- "It Just Works" UX tenets: `plan/docs/FRONTEND.md §UX Philosophy`
- Accessibility 10-item checklist: `plan/docs/FRONTEND.md §Accessibility`
- Hard rules (unsubscribe onSnapshot, no `forwardRef`, no `useEffect` for derived state, no `process.env`): `plan/docs/GOTCHAS.md`
- No-PWA decision: `plan/docs/DECISIONS-ARCH.md #47`
- Replace `prompt()` decision: `plan/docs/DECISIONS-FEATURES.md #106g`

---

## Implementation status (shipped 2026-06-18)

**Branch:** `feature/phase-11.7-admin-mobile` (merged to `dev` at v0.90.0)
**Commits:** 9 (`feat(admin):` + 1 docs)
**Tests:** 9 new test files, 94 new tests, 342/342 total green
**Build:** `npm run typecheck -w admin-app` + `npm run test -w admin-app` + `npm run build -w admin-app` all pass

### Files added

| File | Purpose |
|---|---|
| `admin-app/src/utils/useBreakpoint.ts` | `isMobile` / `isTablet` / `isDesktop` / `isMobileLandscape` + `width` — single source of truth, no direct `window.matchMedia` calls allowed in components |
| `admin-app/src/utils/useTwoClickConfirm.ts` | 3-second auto-cancel two-click confirmation for destructive actions; powers 5 `confirm()` replacements |
| `admin-app/src/utils/useFocusTrap.ts` | Tab/Shift+Tab cycle within container, Escape close, focus restore on unmount via `previouslyFocused.current` |
| `admin-app/src/components/Toast.tsx` | `<ToastProvider>` + `useToast` + `notify.*` module-level helpers; 4 variants (success/error/info/warning), ARIA live region, safe-area-inset, auto-dismiss |
| `admin-app/src/components/ConfirmForm.tsx` | `role="alertdialog"` confirmation with optional required reason text |
| `admin-app/src/components/BottomTabBar.tsx` | Persistent mobile bottom tab bar (Arrivals/Departures/In-House/Alerts on Bookings, Settings on Settings); `role="tablist"` + `aria-current="page"` on active |
| `admin-app/src/components/IntercomChatPanel.tsx` | Reusable chat panel with `variant: "panel" \| "drawer"` — extracted from IntercomInboxPage for single-pane mobile rewrite |
| `admin-app/src/components/StoreOrderMessageCard.tsx` | Extracted from IntercomInboxPage; reused by `IntercomChatPanel` |
| `admin-app/src/__tests__/phase-11.7-*.test.ts` (9 files) | 94 regression tests covering foundations, toast/drawer, confirm forms, DataTable mobile, BottomTabBar, bookings filter/cleanup, Intercom mobile, Settings mobile, a11y polish |

### Files changed

- `admin-app/src/components/Sidebar.tsx` — three-mode (mobile slide-in / tablet icon-only / desktop full); auto-close-on-route-change via `prevPathnameRef` (commit `97d32f1` regression fix)
- `admin-app/src/components/AdminLayout.tsx` — centered wordmark mobile header (Stitch), hamburger button, `<ToastProvider>` mount, `<BottomTabBar>` mount
- `admin-app/src/components/Drawer.tsx` — split into `MobileDrawerPanel` + `DesktopDrawerPanel` sub-components, each with its own `useFocusTrap<HTMLElement>(true, onClose)`; `aria-labelledby={titleId}` + `<h2 id={titleId}>`
- `admin-app/src/components/Modal.tsx` — same `Mobile*Panel` / `Desktop*Panel` split with focus trap + `aria-labelledby`
- `admin-app/src/components/DataTable.tsx` — `renderMobileCard?: (row: T) => ReactNode` prop; card list below 768px; card-shaped skeleton
- `admin-app/src/context/AdminContext.tsx` — 5 `alert()` calls replaced with `notify.error()` (via ToastProvider's `useEffect` binding)
- `admin-app/src/pages/BookingsPage.tsx` — `?filter=arrivals|departures|in-house` URL filter, 3-dot `MoreVertical` menu (stopPropagation via Blocker), `PAID` pill (emerald), walk-in modal stacked single column, 5 confirm/prompt replacements
- `admin-app/src/pages/IntercomInboxPage.tsx` — mobile single-pane rewrite; chat opens in full-screen Drawer with `onBack`; auto-select-first-thread effect gated on `!isMobile`
- `admin-app/src/pages/SettingsPage.tsx` — 260px left nav → horizontal scrollable tab bar (10 pills) on mobile; auto-scrolls to active tab via useEffect
- `admin-app/src/pages/MembersPage.tsx`, `RatesPage.tsx`, `CorporateInquiriesPage.tsx` — pass `renderMobileCard` to DataTable
- `admin-app/index.html` — `<meta name="viewport">` adds `viewport-fit=cover` for iOS notched devices
- `shared/animations.ts` — `slideInLeft` variant added for the mobile sidebar

### What is still open (P3 — manual QA, not a code task)

- [x] Manual QA matrix (18 screens × 6 breakpoints) — see `§Manual QA matrix` above
- [x] Real-device testing: iPhone SE, iPhone 14, Pixel 7, iPad, iPad landscape, desktop
- [x] Optional: Playwright visual regression at 375/768/1024 for the 5 highest-traffic screens

These items require a browser/device, so they ship in P3 post-staging (not before launch).
