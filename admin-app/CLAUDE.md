# admin-app — Agent Context
> Requires: CLAUDE.md, docs/FRONTEND.md, features/AUTH-ROLES.md

---

## Overview

The internal front desk dashboard at `admin.sparkinnbohol.com`. Staff-only — no public registration. Built with React 19 + TypeScript + Vite 6 + Tailwind CSS. All routes except `/login` are protected by Firebase Auth.

---

## Pages & Routes

| Route | Page | Auth Required | Feature MD |
|---|---|---|---|
| `/login` | `LoginPage.tsx` | None | `features/AUTH-ROLES.md` |
| `/` | `DashboardPage.tsx` | Front Desk+ | `features/DASHBOARD-OVERVIEW.md` |
| `/bookings` | `BookingsPage.tsx` | Front Desk+ | `features/BOOKINGS-MANAGEMENT.md` |
| `/rooms` | `RoomsPage.tsx` | Front Desk+ | `features/ROOM-MANAGEMENT.md` |
| `/rates` | `RatesPage.tsx` | Admin only | `features/RATE-MANAGEMENT.md` |
| `/reports` | `ReportsPage.tsx` | Front Desk+ | `features/REPORTS.md` |
| `/corporate` | `CorporateInquiriesPage.tsx` | Front Desk+ | `features/CORPORATE-INQUIRIES.md` |
| `/intercom` | `IntercomInboxPage.tsx` | Front Desk+ | `features/INTERCOM-INBOX.md` |
| `/qr` | `QRManagementPage.tsx` | Front Desk+ | `features/QR-MANAGEMENT.md` |
| `/members` | `MembersPage.tsx` | Admin only | `features/SPARK-REWARDS.md §Admin` |
| `/settings` | `SettingsPage.tsx` | Admin only | `features/SETTINGS.md` |

---

## Role-Based Access

| Role | Access |
|---|---|
| Front Desk | All pages except Rates, Members, and Settings |
| Admin | All pages including Rates, Members, and Settings |

Roles stored as Firebase Auth custom claims. Verified server-side for sensitive API calls. Client-side role check for UI rendering only — never for security enforcement.

See `features/AUTH-ROLES.md` for full implementation details.

---

## Layout

All authenticated pages share a persistent layout:
- **Sidebar** (`Sidebar.tsx`) — always `#111827` dark background, `spark-orange` active state, displays `spark inn v{VERSION}` at the bottom
- **Main content area** — `gray-50` background
- Sidebar collapses to icon-only on tablet (768px)

---

## Firebase Usage (admin-app)

| Collection | Operation | Notes |
|---|---|---|
| `rooms` | `onSnapshot` + `updateDoc` | Room management, status grid |
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
- Status badges use the color system from `docs/FRONTEND.md §Status Badge Colors`
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
