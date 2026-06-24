# admin-app — Agent Context
> Requires: CLAUDE.md, docs/FRONTEND.md, features/AUTH-ROLES.md

---

## Overview

The internal front desk dashboard at `admin.sparkinnbohol.com`. Staff-only — no public registration. Built with React 19 + TypeScript + Vite 6 + Tailwind CSS. All routes except `/login` are protected by Firebase Auth.

---

## Pages & Routes

| Route | Page | Auth Required | Feature MD |
|---|---|---|---|
| `/login` | `LoginPage.tsx` | None | `plan/features/AUTH-ROLES.md` |
| `/` | `DashboardPage.tsx` | Front Desk+ | `plan/features/DASHBOARD-OVERVIEW.md` |
| `/bookings` | `BookingsPage.tsx` | Front Desk+ | `plan/features/BOOKINGS-MANAGEMENT.md` |
| `/rooms` | `RoomsPage.tsx` | Front Desk+ | `plan/features/ROOM-MANAGEMENT.md` |
| `/rates` | `RatesPage.tsx` | Admin only | `plan/features/RATE-MANAGEMENT.md` |
| `/reports` | `ReportsPage.tsx` | Front Desk+ | `plan/features/REPORTS.md` |
| `/corporate` | `CorporateInquiriesPage.tsx` | Front Desk+ | `plan/features/CORPORATE-INQUIRIES.md` |
| `/intercom` | `IntercomInboxPage.tsx` | Front Desk+ | `plan/features/INTERCOM-INBOX.md` |
| `/qr` | `QRManagementPage.tsx` | Front Desk+ | `plan/features/QR-MANAGEMENT.md` |
| `/members` | `MembersPage.tsx` | Admin only | `plan/features/SPARK-REWARDS.md §Admin` |
| `/settings` | `SettingsPage.tsx` | Admin only | `plan/features/SETTINGS.md` |

---

## Role-Based Access

| Role | Access |
|---|---|
| Front Desk | All pages except Rates, Members, and Settings |
| Admin | All pages including Rates, Members, and Settings |

Roles stored as Firebase Auth custom claims. Verified server-side for sensitive API calls. Client-side role check for UI rendering only — never for security enforcement.

See `plan/features/AUTH-ROLES.md` for full implementation details.

---

## Layout

All authenticated pages share a persistent layout:
- **Sidebar** (`Sidebar.tsx`) — always `#111827` dark background, `primary` active state, displays `spark inn v{VERSION}` at the bottom
- **Main content area** — `gray-50` background
- Sidebar is responsive — three modes per `plan/features/ADMIN-MOBILE.md §Sidebar`:
  - **Mobile (< 768px):** hidden by default, slides in from the left as a drawer with a backdrop when the hamburger button in the header is tapped. Body scroll locked. ESC closes. Route change auto-closes.
  - **Tablet (768–1023px):** icon-only (64px), labels hidden, `title` attribute tooltips.
  - **Desktop (≥ 1024px):** full 240px width, labels visible.
- **Header** is sticky on mobile (`sticky top-0 z-20`); compact layout per `ADMIN-MOBILE.md §Header` (hamburger + centered brand wordmark + contextual right zone).
- **Drawers** (`Drawer.tsx`) become full-screen bottom sheets on mobile (slide up, sticky header + sticky action footer). Right-side slide-in on tablet+. See `ADMIN-MOBILE.md §Drawer`.
- **Modals** (`Modal.tsx`) become full-screen sheets on mobile. Centered on tablet+. See `ADMIN-MOBILE.md §Modal`.
- **Page padding** in `<main>` is `p-4 sm:p-6 lg:p-8`.
- **Bottom tab bar** (`BottomTabBar.tsx`) — persistent on mobile only; appears on Bookings (Arrivals/Departures/In-House/Alerts) and Settings (Settings tab). `role="tablist"`, `aria-current="page"` on active, fixed bottom with safe-area-inset.

> Full responsive rules, breakpoints, component patterns, and per-page mobile requirements: see `plan/features/ADMIN-MOBILE.md`.

---

## Mobile UX building blocks (Phase 11.7)

The mobile responsive layout is built on the following hooks + components. **Do not** call `window.matchMedia` or `window.innerWidth` directly in components — always go through `useBreakpoint`.

| File | Export | Purpose |
|---|---|---|
| `admin-app/src/utils/useBreakpoint.ts` | `useBreakpoint(): { isMobile, isTablet, isDesktop, isMobileLandscape, width }` | Single source of truth for breakpoint state. Called once per component (rules of hooks). |
| `admin-app/src/utils/useTwoClickConfirm.ts` | `useTwoClickConfirm(label, onConfirm): { armed, arm, trigger, cancel }` | 3-second auto-cancel two-click confirmation for destructive actions. |
| `admin-app/src/utils/useFocusTrap.ts` | `useFocusTrap<T extends HTMLElement>(active, onEscape): MutableRefObject<T \| null>` | Tab/Shift+Tab cycle within container, Escape to close, focus restore on unmount. |
| `admin-app/src/components/Toast.tsx` | `<ToastProvider>`, `useToast()`, `notify.success/error/info/warning(message, opts?)` | Toast system. `notify.*` is module-level so non-React callers (e.g. `AdminContext`) can fire toasts. |
| `admin-app/src/components/ConfirmForm.tsx` | `<ConfirmForm open, onClose, onConfirm, danger?, requireReason?, title, message, confirmLabel, reasonLabel?>` | Inline confirmation; `role="alertdialog"`; optional required reason text. |
| `admin-app/src/components/BottomTabBar.tsx` | `<BottomTabBar />` | Mounted in `AdminLayout`. Renders nothing on tablet+. Tabs derive from `useLocation`. |
| `admin-app/src/components/IntercomChatPanel.tsx` | `<IntercomChatPanel variant: "panel" \| "drawer", thread, onBack?, ... />` | Reusable chat panel extracted from `IntercomInboxPage`. |
| `admin-app/src/components/StoreOrderMessageCard.tsx` | `<StoreOrderMessageCard order />` | Reused inside `IntercomChatPanel` and the IntercomInboxPage desktop view. |
| `admin-app/src/components/DataTable.tsx` | `<DataTable renderMobileCard?: (row) => ReactNode />` | Below 768px + `renderMobileCard` provided → card list. Card-shaped skeleton on mobile. |

### Hard rules for mobile components

- **No `alert()` / `confirm()` / `prompt()` in the admin app** — use `<Toast>`, `<ConfirmForm>`, `useTwoClickConfirm`, or inline forms (per `DECISIONS-FEATURES.md #107` extending #106g).
- **44×44px minimum touch targets** on all buttons/inputs (already in root `CLAUDE.md` Hard Rules, restated for the mobile path).
- **Safe-area-inset on every sticky bottom element** — `pb-[env(safe-area-inset-bottom)]` on the bottom tab bar, drawer/modal sticky footers, chat input.
- **`prefers-reduced-motion` is mandatory** — wrap any `slideInBottom` / `slideInRight` / `scaleIn` variant usage in `!!useReducedMotion()` and fall through to a no-transform variant.
- **Focus trap is mandatory on all drawers and modals** — split your component into a `Mobile*Panel` and a `Desktop*Panel` sub-component, each calling `useFocusTrap<HTMLElement>(true, onClose)` with its own ref. Do not pass a single trap across both — the `useEffect` listener attaches to `document`, and the trap should match the actual open DOM.
- **`aria-labelledby` + `<h2 id={titleId}>`** on every drawer/modal — never use static `aria-label`.
- **3-dot menus on mobile cards** must use a `Blocker` on `onClick` to stop propagation (the card itself is tappable for "open detail" on the desktop table view).

### Testing

- 9 `admin-app/src/__tests__/phase-11.7-*.test.ts` files cover the full mobile surface (foundations, toast/drawer, confirm forms, DataTable mobile, BottomTabBar, bookings filter/cleanup, Intercom mobile, Settings mobile, a11y polish) — 94 new tests, 342/342 total green.
- New mobile components or changes to existing ones must add a regression test under `admin-app/src/__tests__/phase-11.7-*.test.ts` (or a new test file in that pattern) before merge to `dev`.

---

## Firebase Usage (admin-app)

| Collection | Operation | Notes |
|---|---|---|
| `rooms` | `onSnapshot` + `addDoc` + `updateDoc` + `deleteDoc` | Room management, status grid, create + delete (admin-gated, Phase 11.8) |
| `bookings` | `onSnapshot` + `updateDoc` | Bookings table, status transitions |
| `bookings/{id}/payments` | `onSnapshot` + `addDoc` | Onsite payment log in booking drawer |
| `guests` | `getDoc` | Staff profile lookup |
| `members` | `onSnapshot` + `updateDoc` | Member management page, points adjustment |
| `members/{uid}/pointsHistory` | `onSnapshot` + `addDoc` | Points history in member detail drawer |
| `corporateInquiries` | `onSnapshot` + `addDoc` + `updateDoc` | Inquiry pipeline |
| `corporateCodes` | `addDoc` + `updateDoc` | Access code management |
| `vouchers` | `addDoc` + `updateDoc` + `onSnapshot` | Voucher management |
| `intercoms` | `onSnapshot` + `addDoc` + `updateDoc` | Chat inbox |
| `calls` | `onSnapshot` + `updateDoc` | Incoming WebRTC voice call signaling |
| `storeItems` | `onSnapshot` + `addDoc` + `updateDoc` | Store catalog management |
| `storeOrders` | `onSnapshot` + `updateDoc` | Store order management |
| `breakfastSelections` | `onSnapshot` + `addDoc` + `updateDoc` | Silog selections in booking drawer |
| `settings/hotelConfig` | `getDoc` + `setDoc` | Settings management |
| `settings/websiteContent` | `getDoc` + `setDoc` | Website content editing |
| `settings/rewardsConfig` | `getDoc` + `setDoc` | Spark Rewards settings tab |
| `settings/breakfastConfig` | `getDoc` + `setDoc` | Breakfast settings tab |
| `settings/storeConfig` | `getDoc` + `setDoc` | Store settings tab |

---

## Key Conventions

- Dashboard philosophy: scan, not read — data density over decoration
- Sidebar always `#111827`, orange active state, never collapses fully below 768px
- Status badges use the color system from `plan/docs/FRONTEND.md §Status Badge Colors`
- All tables have loading skeletons — never blank white on data load
- Booking status transitions are actions, not just display — each status has explicit allowed next states
- Walk-in bookings created from a modal/drawer within `BookingsPage.tsx` — not a separate page
- Housekeeping status toggle per room is on the dashboard grid — quick tap/click, no modal

---

## Component Notes

- `Sidebar.tsx` — role-aware nav links, active state, version in footer
- `BookingTable.tsx` — filterable, sortable, opens detail drawer on row click
- `RoomForm.tsx` — edit room details, upload photos, set status/block reason
- `StatsCard.tsx` — reusable stat card with label, value, optional trend indicator
- `OccupancyChart.tsx` — Recharts bar chart, used on Dashboard and Reports pages
