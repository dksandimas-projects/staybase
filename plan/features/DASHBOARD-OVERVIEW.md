# Dashboard Overview
> App: admin-app
> Phase: Phase 5 — Admin Bookings Management
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Dashboard Overview

## Overview

The main dashboard at `/` — the first screen staff see after login. Designed for rapid scanning: contextual stats, urgent operational alerts first, compact daily operations, live room status grid with housekeeping toggles, and today's arrivals/departures. No decorative elements — every element is actionable or informational.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [x] Most common action is reachable in ≤ 2 clicks from the sidebar
- [x] Loading state uses skeleton, not spinner
- [x] Drawers save without full page reload — optimistic update, toast on success
- [x] Every error state has a plain-language message and a next step — no dead ends
- [x] Destructive actions have a single confirmation step — not buried in menus
- [x] Empty states explain why data is missing and what to do

---

## UI Checklist

- [x] Stat cards row — Occupancy Rate (today), Bookings (this month), Revenue (this month), Pending Payments (count), Unread Messages (count); each card includes a leading icon, one line of available context, and state-aware tone so `0` alerts read muted. Occupancy, Bookings, and Revenue include info tooltips explaining their calculation.
- [x] `StatsCard.tsx` — label, large value, optional context/trend, optional help tooltip, optional header action; hidden revenue displays a masked peso figure rather than the word "Hidden"
- [x] Operational hierarchy — urgent/actionable cards lead the dashboard, daily ops sit in a compact middle band, guest chats sit below, and passive empty states are visually muted
- [x] Room status grid — one cell per room (all active rooms), shows room number, type, booking status badge, housekeeping status badge
- [x] Housekeeping status toggle per room — Clean / Dirty / In Progress — tap/click cycles through states, instant Firestore update
- [x] Pending payment alerts section — list of bookings with status `"payment-uploaded"`, guest name, room, date submitted, Confirm Payment CTA; warm attention styling when non-empty
- [x] New corporate inquiries section — shown only when `corporateInquiries` has `status: "new"` rows; each row shows company, contact, requested room count, opens `/corporate?inquiryId=...`, and includes a tooltip explaining that only fresh/new leads appear here
- [x] Today's check-ins list — bookings with `checkIn = today` and status `"confirmed"`; compact muted row when empty
- [x] Today's check-outs list — bookings with `checkOut = today` and status `"checked-in"`; compact muted row when empty
- [x] Overdue Check-outs warning section — shown only when at least one booking has status `"checked-in"` and either `checkOut` is before today's Manila date or `checkOut` is today and Manila current time is at/after configured checkout time; each row shows guest name, room number, overdue timing, and opens the booking drawer for checkout action
- [x] Recent bookings table — last 10 bookings regardless of status, clickable rows to booking detail
- [x] Intercom unread indicator — badge on sidebar nav item, count of unread messages across all rooms
- [x] **Today's Breakfast Prep section** — see §Implementation Plan — Today's Breakfast Prep below
- [x] All sections real-time via `onSnapshot`

## Data & Logic Checklist

- [x] Stat cards computed from Firestore queries — occupancy from room statuses; revenue from `payment-confirmed`, `confirmed`, `checked-in`, and `checked-out` bookings checking in this month, matching the Reports revenue basis
- [x] Room grid: `onSnapshot` on `rooms` collection — all rooms always shown regardless of status
- [x] Housekeeping toggle: `updateDoc` on `rooms/{roomId}` — update `housekeepingStatus` field
- [x] Pending payments: query `bookings` where `status == "payment-uploaded"`, ordered by `createdAt`
- [x] New corporate inquiries: use the existing `AdminContext.corporateInquiries` snapshot and filter `status == "new"` for dashboard action cards
- [x] Today's check-ins: query `bookings` where `checkIn` is today AND `status == "confirmed"`
- [x] Today's check-outs: query `bookings` where `checkOut` is today AND `status == "checked-in"`
- [x] Overdue check-outs: filter bookings where `status == "checked-in"` and (`checkOut < todayKey` OR `checkOut == todayKey` after `settings/hotelConfig.checkOutTime`, falling back to `hotel.config.ts`); `todayKey` and current time come from the shared Manila-date helper
- [x] Recent bookings: query `bookings` ordered by `createdAt desc`, limit 10
- [x] Intercom unread count: aggregate query across all `intercoms/{roomId}/messages` where `isRead: false` AND `sender: "guest"`
- [x] Confirm Payment CTA: updates booking status to `"payment-confirmed"` + triggers email

## Implementation Plan — Today's Breakfast Prep (raised by owner, 2026-07-09 — **shipped**: `DashboardPage.tsx` renders the Today's Breakfast section with per-guest Served toggles persisting to `booking.breakfastServed`, an unserved-count badge, and empty state)

### Goal

Front desk currently has no single, guided place to see "who ordered breakfast today, what did they order, and has it gone out yet." Give them one.

### Current State

`ReportsPage.tsx` already has the core aggregation logic (`dailyKitchenPrep`, lines ~306-331): it walks every breakfast-enabled booking's `breakfastSelections` map (`plan/docs/BACKEND.md §bookings` — keyed `yyyy-mm-dd-guest-n` → selected silog item name) and produces a per-date, per-item count. This is a **report** — it's on the Reports page, not the Dashboard, isn't scoped to "today" by default, and has no notion of "served" at all; it's a static count for kitchen quantity planning, not a checklist staff can work through.

### Target Behavior

- ✅ New Dashboard section — "Today's Breakfast" — showing every guest with a breakfast selection for today (`checkIn ≤ today < checkOut`, `hasBreakfast: true`, per-guest-per-day entries from `breakfastSelections` for today's date key), each row: room number, guest name, selected silog item, and a Served / Not Served toggle.
- ✅ Toggling "Served" persists immediately (optimistic update + Firestore write, matching the rest of the dashboard's real-time pattern) so any staff member on shift sees the same up-to-date checklist — this is the "guided" part the owner asked for: front desk can tell at a glance what's left to go out this morning without cross-referencing the booking drawer per room.
- ✅ Section groups or badges by status — e.g. an unserved count badge ("3 remaining") so it's scannable without reading every row, and a "All served" empty/complete state once everything for today is checked off.
- ✅ Section is hidden (or shows "No breakfast orders today") when no bookings have breakfast selected for today — don't show an empty table.

### Data Model Addition

`breakfastSelections` stays as-is (`Record<string, string>`, key → item name) — do not change its shape, since Reports/exports/registration PDFs already depend on it. Add a **sibling** map on the booking document: `breakfastServed?: Record<string, boolean>`, using the identical `yyyy-mm-dd-guest-n` key format. A key present in `breakfastSelections` but absent (or `false`) in `breakfastServed` means "ordered, not yet served." This keeps the addition non-breaking and lets the Dashboard section and the existing Reports kitchen-prep view share the same keys.

### Implementation Steps

1. ✅ Add `breakfastServed` to the `Booking` type in `shared/types/index.ts` and document it in `plan/docs/TYPES.md` / `plan/docs/BACKEND.md §bookings` alongside `breakfastSelections`.
2. ✅ Build a `useTodayBreakfast()`-style selector (or extend `AdminContext`) that filters currently-active bookings down to today's `breakfastSelections` entries, joined with room number/guest name.
3. ✅ Build the Dashboard section UI — list/table with the Served toggle per row, unserved-count badge, empty state.
4. ✅ Wire the toggle to `updateDoc` on `bookings/{bookingId}`, setting `breakfastServed.{key} = true/false`.
5. ✅ Reuse the same data for the Reports kitchen-prep view where useful, so "today" in both places is always consistent.

## Edge Cases & States

- [x] Loading state — skeleton for each section independently (sections load as data arrives)
- [x] No pending payments — show a compact muted row, not an urgent card treatment
- [x] No check-ins/check-outs today — show compact muted rows so empty sections do not compete with urgent work
- [x] No breakfast orders today — show a compact muted row in the daily ops band
- [x] No overdue check-outs — hide the warning section entirely so the dashboard does not show an empty alert
- [x] No new corporate inquiries — hide the dashboard inquiry alert entirely; the full pipeline remains available from the sidebar
- [x] Overdue check-outs — keep the warning section usable on mobile with stacked rows and 44px minimum tap targets
- [x] Stat cards — handle zero values gracefully (0% occupancy, ₱0 revenue)
- [x] Room grid — all rooms always visible even if blocked or inactive

## Manual QA

- [x] All rooms appear in status grid
- [x] Housekeeping status cycles Clean → Dirty → In Progress → Clean on toggle
- [x] Housekeeping status change reflects immediately in grid
- [x] Pending payment alert appears when a guest uploads a screenshot
- [x] Confirm Payment CTA changes booking status and sends email
- [x] Today's check-ins/check-outs show correct bookings for today's date
- [x] Overdue check-outs appear only for still-checked-in bookings whose checkout date is before today, or whose checkout time has passed today, and each row opens the booking detail drawer
- [x] New corporate inquiries appear only for `status: "new"` and each row opens the corporate inquiry drawer
- [x] Intercom unread badge count matches actual unread messages
- [x] Dashboard loads in under 2s

## References

- Booking status transitions: `plan/docs/BACKEND.md §bookings`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
- Housekeeping status field: `plan/docs/BACKEND.md §rooms`
- Intercom unread: `plan/features/INTERCOM-INBOX.md`
- Payment confirmation email: `plan/features/EMAIL-PDF-STORAGE.md`
