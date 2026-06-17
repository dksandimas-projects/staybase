# Admin Mobile UX
> App: admin-app
> Phase: Phase 11.7 — Admin Mobile UX
> Requires: CLAUDE.md, docs/FRONTEND.md, plan/admin-app/CLAUDE.md
> Cross-refs: `plan/features/AUTH-ROLES.md`, `plan/features/DASHBOARD-OVERVIEW.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/INTERCOM-INBOX.md`, `plan/features/SETTINGS.md`, `plan/features/REPORTS.md`, `plan/features/MEMBERS-*` (Phase 10B), `plan/features/STORE-MANAGEMENT.md`

## Overview

The admin app was built **desktop-first** for an assumed minimum of 768px tablet width (`plan/admin-app/CLAUDE.md §Layout` declares "tablet is the dashboard minimum"). Below 768px the layout breaks: the fixed 240px sidebar consumes the entire viewport, the header overflows, tables force horizontal scrolling, and drawers (480–1120px wide) get clipped.

This spec defines the **mobile UX/UI contract** for the admin app — breakpoints, layout behavior per breakpoint, the component patterns every page must follow, and the per-page mobile rules for the 11 existing pages. Scope is **responsive layout only** — no PWA, no offline, no install prompt (per `DECISIONS-ARCH.md #47`, admin-app is intentionally not a PWA).

Audience: front desk staff using a personal phone for quick lookups (most common: "what room is guest X in?" or "log a payment for booking Y") and admins doing short tasks away from their desk. The dashboard remains the primary daily tool on desktop — mobile is **complement, not replacement**.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar (or hamburger menu on mobile)
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

---

## Mobile UX Checklist (new — applies to every page)

- [ ] Layout works at 375px width (iPhone SE / 12 mini) without horizontal page scroll
- [ ] Layout works at 568px height in landscape (keyboard up) — primary CTAs still visible
- [ ] Sidebar collapses to hamburger on mobile; never overlaps content permanently
- [ ] All form fields and buttons are minimum 44×44px touch targets (per `FRONTEND.md §Spacing`)
- [ ] No table requires horizontal page scroll — switch to card list below 768px
- [ ] Drawer becomes a full-screen bottom sheet on mobile with sticky action footer
- [ ] Modal becomes a full-screen sheet on mobile
- [ ] Intercom chat shows one pane at a time on mobile (threads OR chat, not both)
- [ ] Primary action of the screen is reachable in the bottom 50% of the viewport (one-handed use)
- [ ] Safe-area-insets respected on iOS notched devices (`pb-[env(safe-area-inset-bottom)]` on sticky footers)
- [ ] Hamburger/close/icon-only buttons have `aria-label`
- [ ] Focus is trapped inside open drawer/modal; restored to trigger on close
- [ ] All animations respect `prefers-reduced-motion` (Framer `useReducedMotion()`)
- [ ] No `alert()`, `confirm()`, or `prompt()` in mobile drawers — use inline forms (per `DECISIONS-FEATURES.md #106g`)
- [ ] No hover-only interactions — every hover action has a tap equivalent
- [ ] No pinch-zoom required to read any text (minimum 15px body / 13px small on mobile)

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

The current header is a single 64px row with: page label (left), user avatar + email + role chip + Sign Out (right). Mobile version is compact:

- **Mobile:** `[☰ hamburger] [page title — small text] [👤 avatar only]`. No email, no role chip, no Sign Out button in the header — these move into the sidebar (sign out at the bottom, role chip near the user avatar).
- **Tablet:** Same as desktop but tighten the padding.
- **Desktop:** Unchanged.

The header becomes **sticky** on mobile (`sticky top-0 z-20`) so it stays accessible when staff scroll long tables. Reduce `px-8 py-4` to `px-4 py-3` on mobile. The page H1 is **not** moved into the header — the in-page H1 stays at `text-2xl sm:text-3xl` (down from the current `text-3xl` everywhere).

### Main content (P0)

`<main>` padding becomes responsive: `p-4 sm:p-6 lg:p-8`. Page-level `<div className="space-y-8">` becomes `space-y-6 sm:space-y-8` on mobile to keep more content above the fold.

### Page title bar (P1)

Pages with a primary CTA in the header (Bookings → "New Walk-in Booking", Rooms → add room, etc.) get a **sticky action bar** below the header on mobile: title (left) + primary CTA (right), with safe-area-inset padding. The in-page H1 is then redundant on mobile and may be hidden under the action bar.

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

- [ ] No change. Centered card layout, `p-4` outer padding, logo + form already scale correctly. Verify on iPhone SE (375×667).

### Dashboard (`/`) — minor changes

- [ ] H1 `text-3xl` → `text-2xl sm:text-3xl` (page-level H1)
- [ ] Stat-card grid: already `1 → 2 → 4` (mobile → sm → lg) — fine
- [ ] Room grid: already `1 → 2 → 3` (mobile → sm → lg) — fine
- [ ] Reduce card padding: `p-5` → `p-4 sm:p-5` (room cards), `p-6` → `p-4 sm:p-6` (chart card)
- [ ] Recharts `ResponsiveContainer` already mobile-safe — verify tooltip does not overflow the right edge on a 375px screen
- [ ] Housekeeping toggle button (`min-h-[32px]`) is below the 44px touch target — bump to `min-h-[44px]`

### Bookings (`/bookings`) — major work

- [ ] Page header collapses to sticky title + sticky "New Walk-in Booking" CTA on mobile
- [ ] Tabs (`Room Reservations` / `Spark Essentials Orders`) — ensure they don't truncate at 375px; switch to horizontally scrollable tab bar if needed
- [ ] Search + status filter row becomes "search on top + Filter button (opens sheet)" pattern
- [ ] **DataTable → mobile card view** (renderMobileCard provided by BookingsPage)
- [ ] Walk-in modal becomes full-screen sheet on mobile
- [ ] Booking detail drawer (the long one) becomes full-screen sheet on mobile with **sticky footer** for the status-transition action (Confirm / Check In / Check Out / Cancel)
- [ ] Long drawer sections (Check-in Registration, Guest ID Attachment, Stay & Accommodation, Financial Breakdown, Onsite Payments Ledger, Checkout Folio Review) are collapsible on mobile to reduce scroll depth — use `<details>` or a small expand toggle
- [ ] The 4-column "Record Onsite Payment" form (amount / method / note / Log button) — `sm:grid-cols-[1fr_1fr_1.6fr_auto]` becomes single-column on mobile with the button full-width at the bottom of the form
- [ ] Order detail drawer (Spark Essentials) same treatment: full-screen sheet + sticky footer

### Rooms (`/rooms`) — moderate work

- [ ] Room card grid: already `1 → 2 → 3` — fine
- [ ] Edit drawer: full-screen sheet on mobile with sticky "Save Room Configurations" footer
- [ ] The hardcoded `grid grid-cols-2` blocks in `RoomsPage.tsx` (3 occurrences: lines ~134, ~159, ~205) **must** become `grid-cols-1 sm:grid-cols-2` — the 2-col form layout is unreadable on mobile
- [ ] The block-schedule form (block from / block to) same change
- [ ] Room card "Configure Room" button: bump from `min-h-[36px]` to `min-h-[44px]`

### Reports (`/reports`) — moderate work

- [ ] 5 separate `overflow-x-auto` tables (kitchen prep, occupancy, bookings, payments, etc.) — apply the DataTable mobile card view pattern, or for small fixed tables use a horizontally scrollable snapshot with a "swipe for more" hint
- [ ] Top tab list (3 tabs) — verify no truncation; horizontal scroll fallback if needed
- [ ] The 5-column stat card row at line 837 (`sm:grid-cols-2 lg:grid-cols-5`) becomes `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` so it's 2-col on mobile, not 1-col
- [ ] Backup XLSX button + role guard — already a single button, fine

### Intercom Inbox (`/intercom`) — biggest rewrite

- [ ] 280px thread list + chat panel `lg:grid-cols-[280px_1fr]` does **not** work on mobile
- [ ] Mobile layout: thread list full-width by default. On thread tap, chat takes full-width with a sticky "← Back to threads" button in the chat header
- [ ] Chat input is sticky at the bottom with safe-area-inset padding
- [ ] Incoming-call banner: full-screen modal on mobile (Accept / Disconnect buttons full-width, stacked)
- [ ] Active-call state: full-screen with call duration large, Hang Up button pinned at bottom
- [ ] Unread count badge in sidebar (already implemented) still appears when sidebar is closed — the tab title should also show the count (already implemented per `INTERCOM-INBOX.md`)

### Settings (`/settings`) — moderate work

- [ ] 260px left category nav becomes a horizontally scrollable tab bar at the top of the page
- [ ] The two `<table class="min-w-full">` (room types, payment methods) gain mobile card view
- [ ] All `sm:grid-cols-2/3` form grids — verify they actually use `sm:` (some look like they may be unprefixed — audit during build)
- [ ] Long textareas (mission, vision, hotel story) — no change needed
- [ ] Hotel logo upload — single button, fine

### Members (`/members`) — moderate work

- [ ] Member list drawer — same bottom-sheet treatment as Bookings
- [ ] DataTable → mobile card view
- [ ] Points history table inside the member drawer — mobile card view or compact list

### Rates (`/rates`) — moderate work

- [ ] The rate table at line 344 (`overflow-x-auto` + `min-w-full`) — mobile card view
- [ ] The 3-column form grid at line 498 (`md:grid-cols-3`) — verify 1-col on mobile
- [ ] Weekend rate / corporate rate form sections — same responsive form grids

### Corporate Inquiries (`/corporate`) — minor work

- [ ] The `grid-cols-2` blocks at lines 358, 382 (2-col card layouts) need to become `grid-cols-1 sm:grid-cols-2`
- [ ] Inquiry detail drawer — same bottom-sheet treatment
- [ ] Notes log — already a stacked list, no change

### QR Management (`/qr`) — minor work

- [ ] QR card grid: already responsive (`sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`) — fine
- [ ] QR detail drawer — bottom-sheet on mobile
- [ ] The `grid grid-cols-3 gap-2` block at line 366 (the per-room buttons) — verify it fits at 375px (3 small buttons); may need to switch to vertical stack

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

- [ ] No new PII exposure. The mobile view renders the same data as desktop — same Firestore rules apply, same `onSnapshot` listeners.
- [ ] Guest ID photo (`guestIdPhotoUrl`) and discount ID photo are already staff-only per Firestore rules and `guestIdUploadStatus` is set on the same field — no mobile-specific leakage.
- [ ] PDF generation (booking receipt, registration form) is client-side jsPDF — works on mobile browsers; verify on iOS Safari (file download UX differs from desktop — iOS opens in a new tab via blob URL, which is the current behavior).
- [ ] `Authorization: Bearer <token>` headers work on mobile — no change.
- [ ] If staff logs in on a personal phone, the device stores a Firebase ID token. Add to a future phase: idle session timeout on mobile. Out of scope for Phase 11.7.

---

## Edge cases

- [ ] **Landscape phone** (568×320) — sidebar still overlays; data table is 2-col card list with reduced font; chart should auto-hide axes labels (Recharts handles via tick formatter)
- [ ] **Tablet portrait** (768×1024) — sidebar icon-only; drawers stay right-side; data table compact (hide 1–2 non-essential columns)
- [ ] **iOS notched devices** (`viewport-fit=cover`) — sticky bottom action bar / sticky drawer footer / chat input must respect `env(safe-area-inset-bottom)`; add `viewport-fit=cover` to `<meta name="viewport">` in `index.html`
- [ ] **Android pull-to-refresh** — on mobile, swiping down at the top of the dashboard / bookings list will trigger browser pull-to-refresh. Call `event.preventDefault()` on the scroll container if it conflicts with the real-time snapshot, OR keep the browser default and rely on `onSnapshot` for freshness
- [ ] **Slow networks on mobile** — skeleton loaders already in place; verify they appear on first paint (no blank flash) and that `useEffect` cleanups unsubscribe correctly (per `GOTCHAS.md §Firebase`)
- [ ] **Very long guest names** in card view — `truncate` the primary line; full name still visible in detail drawer
- [ ] **PDF download on iOS Safari** — opens in a new tab via blob URL; user taps Share → Save to Files. Acceptable; document in user training. (No "Save to Downloads" prompt on iOS.)
- [ ] **Mobile drawer focus trap** — `Tab` from last focusable element wraps to first; `Shift+Tab` from first wraps to last; `Escape` closes. On close, focus returns to the row/card that opened the drawer
- [ ] **Hamburger menu while a drawer is open** — tapping the hamburger with a drawer open should close the drawer, not open the sidebar. Top-most layer wins.
- [ ] **Multiple rapid breakpoint crossings** (rotation) — the layout must not flicker or lose state. The `useBreakpoint` hook is the single source; `useState` initializer reads `window.innerWidth` once for SSR-safety; the resize listener updates it. No flicker because the layout re-renders on state change.
- [ ] **No `useEffect` for breakpoint changes that derive from state** — per `GOTCHAS.md §React 19`, compute layout decisions inline from `useBreakpoint()` return value, not in a `useEffect`

---

## Manual QA matrix

Required before Phase 11.7 ships. Each row is a screen × a breakpoint — verify the layout works without horizontal page scroll, all CTAs are reachable, and no element is clipped.

| Screen | 375 (iPhone SE) | 390 (iPhone 14) | 568×320 (landscape) | 768 (iPad) | 1024 (iPad landscape) | 1440 (desktop) |
|---|---|---|---|---|---|---|
| Login | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Dashboard | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Bookings list | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Booking detail drawer | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Walk-in modal | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Store Orders list | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Rooms list | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Room edit drawer | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Intercom thread list | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Intercom chat | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Incoming call modal | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Settings — Hotel | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Settings — Staff Accounts | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Rates | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Reports (each tab) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Members list + drawer | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Corporate Inquiries | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| QR Management | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

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

- [ ] Hamburger button: `aria-label="Open navigation menu"`, `aria-expanded={isOpen}`, `aria-controls="admin-sidebar"`
- [ ] Sidebar when closed: `aria-hidden="true"` + `inert` attribute (or `tabindex="-1"` on focusable children)
- [ ] Mobile drawer close button: `aria-label="Close booking details"`
- [ ] Sticky action bar primary button: visible focus ring on keyboard nav
- [ ] Card list view: each card is a `<button>` (or `<article>` + inner `<button>`) with accessible name including status, ref, guest name
- [ ] Tab navigation in Settings: `role="tablist"`, `role="tab"`, `aria-selected`, arrow-key navigation between tabs
- [ ] Bottom-sheet on mobile: `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`
- [ ] Touch target audit: every interactive element minimum 44×44px (per `FRONTEND.md §Spacing` and `§Accessibility`)

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
