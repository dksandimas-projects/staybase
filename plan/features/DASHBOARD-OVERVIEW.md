# Dashboard Overview
> App: admin-app
> Phase: Phase 5 — Admin Bookings Management
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Dashboard Overview

## Overview

The main dashboard at `/` — the first screen staff see after login. Designed for rapid scanning: glanceable stats, live room status grid with housekeeping toggles, pending payment alerts, and today's arrivals/departures. No decorative elements — every element is actionable or informational.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

---

## UI Checklist

- [ ] Stat cards row — Occupancy Rate (today), Total Bookings (this month), Revenue (this month), Pending Payments (count)
- [ ] `StatsCard.tsx` — label, large value, optional trend vs. yesterday/last month
- [ ] Room status grid — one cell per room (all active rooms), shows room number, type, booking status badge, housekeeping status badge
- [ ] Housekeeping status toggle per room — Clean / Dirty / In Progress — tap/click cycles through states, instant Firestore update
- [ ] Pending payment alerts section — list of bookings with status `"payment-uploaded"`, guest name, room, date submitted, Confirm Payment CTA
- [ ] Today's check-ins list — bookings with `checkIn = today` and status `"confirmed"`
- [ ] Today's check-outs list — bookings with `checkOut = today` and status `"checked-in"`
- [ ] Recent bookings table — last 10 bookings regardless of status, clickable rows to booking detail
- [ ] Intercom unread indicator — badge on sidebar nav item, count of unread messages across all rooms
- [ ] All sections real-time via `onSnapshot`

## Data & Logic Checklist

- [ ] Stat cards computed from Firestore queries — occupancy from room statuses, revenue from confirmed bookings this month
- [ ] Room grid: `onSnapshot` on `rooms` collection — all rooms always shown regardless of status
- [ ] Housekeeping toggle: `updateDoc` on `rooms/{roomId}` — update `housekeepingStatus` field
- [ ] Pending payments: query `bookings` where `status == "payment-uploaded"`, ordered by `createdAt`
- [ ] Today's check-ins: query `bookings` where `checkIn` is today AND `status == "confirmed"`
- [ ] Today's check-outs: query `bookings` where `checkOut` is today AND `status == "checked-in"`
- [ ] Recent bookings: query `bookings` ordered by `createdAt desc`, limit 10
- [ ] Intercom unread count: aggregate query across all `intercoms/{roomId}/messages` where `isRead: false` AND `sender: "guest"`
- [ ] Confirm Payment CTA: updates booking status to `"payment-confirmed"` + triggers email

## Edge Cases & States

- [ ] Loading state — skeleton for each section independently (sections load as data arrives)
- [ ] No pending payments — hide section or show "No pending payments"
- [ ] No check-ins/check-outs today — show "No arrivals today" / "No departures today"
- [ ] Stat cards — handle zero values gracefully (0% occupancy, ₱0 revenue)
- [ ] Room grid — all rooms always visible even if blocked or inactive

## Manual QA

- [ ] All rooms appear in status grid
- [ ] Housekeeping status cycles Clean → Dirty → In Progress → Clean on toggle
- [ ] Housekeeping status change reflects immediately in grid
- [ ] Pending payment alert appears when a guest uploads a screenshot
- [ ] Confirm Payment CTA changes booking status and sends email
- [ ] Today's check-ins/check-outs show correct bookings for today's date
- [ ] Intercom unread badge count matches actual unread messages
- [ ] Dashboard loads in under 2s

## References

- Booking status transitions: `plan/docs/BACKEND.md §bookings`
- Status badge colors: `plan/docs/FRONTEND.md §Status Badge Colors`
- Housekeeping status field: `plan/docs/BACKEND.md §rooms`
- Intercom unread: `plan/features/INTERCOM-INBOX.md`
- Payment confirmation email: `plan/features/EMAIL-PDF-STORAGE.md`
