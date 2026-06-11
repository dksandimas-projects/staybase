# Intercom Inbox
> App: admin-app
> Phase: Phase 8 — Intercom
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Intercom Inbox

## Overview

The `/intercom` dashboard page is the front desk's side of the guest chat system. Staff see a list of active room conversations, open threads to reply, and can mark conversations as resolved. Notification sound alerts staff to new messages when the inbox is not in focus. Quick request badges render distinctly from regular messages.

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

- [ ] Conversation list (left panel) — one row per room with active messages: room number, last message preview, timestamp, unread count badge
- [x] Active / Resolved tabs — filter conversations by resolution status
- [ ] Thread view (right panel) — full message thread for selected room
- [ ] Messages: guest messages (left-aligned), front desk messages (right-aligned)
- [ ] Quick request messages render as styled chip/badge — visually distinct from plain text (e.g. pill with icon, different background)
- [ ] Store order messages render as a distinct order card — shows items, total, payment method, with a "View Order" link to Store Management
- [ ] New store order notification sound — same Web Audio API pattern as intercom messages
- [ ] Reply input + Send button at bottom of thread
- [x] Mark as Resolved button — available on active conversations
- [x] Notification sound — plays on **every** incoming guest message when inbox tab is not focused (not just the first per conversation)
- [x] Tab title unread count — e.g. `(3) Intercom Inbox` when there are unread messages
- [x] Unread indicator badge on sidebar nav item
- [ ] Timestamps on all messages
- [ ] **Incoming call notification** — when `calls/{roomId}.status == "ringing"`, show a persistent banner at the top of the inbox: "📞 Room {X} — {guestName} is calling" with Accept and Decline buttons
  - [ ] Accept: creates WebRTC answer, writes to `calls/{roomId}.answer`, begins audio connection
  - [ ] Decline: updates `calls/{roomId}.status = "ended"`
  - [ ] Active call UI: banner changes to "🔴 On call — Room {X}" with a Hang Up button
  - [ ] Hang up: closes RTCPeerConnection, updates `calls/{roomId}.status = "ended"`
  - [ ] Notification sound plays on incoming call (same Web Audio API pattern as messages)

## Data & Logic Checklist

- [ ] `onSnapshot` on all `intercoms/{roomId}/messages` — or aggregate listener across rooms — real-time
- [ ] Mark messages as read: `updateDoc` on message documents where `isRead: false` AND `sender: "guest"` when thread is opened/viewed
- [ ] Reply: `addDoc` to `intercoms/{roomId}/messages` with `sender: "front-desk"`, `isRead: true`
- [ ] Preserve early check-in request metadata from guest messages so staff-specific actions can be layered in later
- [x] Resolved status: stored as a flag on the room-level intercom document or managed by filtering — conversations with no unread messages and manually resolved
- [x] Notification sound implementation:
  - Audio context unlocked on first user interaction after login (browser autoplay policy)
  - Sound plays on every incoming guest message — not just the first per conversation
  - Sound only plays when inbox route is not the active focused tab
  - Sound file URL from `settings/hotelConfig.notificationSoundUrl` (Firebase Storage)
  - Use Web Audio API — no extra library
- [x] Tab title: update `document.title` dynamically with unread count
- [ ] Unread count: count of messages where `sender: "guest"` AND `isRead: false` across all rooms

## Edge Cases & States

- [ ] No active conversations — "No active conversations" empty state
- [ ] Room has no messages yet — do not show in conversation list
- [ ] Notification sound file not configured — fail silently, no sound (not an error)
- [ ] Audio locked (no user interaction yet) — notification sound skipped silently until unlocked
- [ ] Guest sends message while staff is viewing thread — appears in real-time, marked read immediately
- [ ] Very long message thread — virtualize list for performance

## Manual QA

- [ ] Guest sends message from intercom page — appears in inbox conversation list immediately
- [ ] Open thread — guest messages marked as read, unread count clears
- [ ] Reply from inbox — appears in guest's chat view in real-time
- [ ] Quick request chip from guest renders as badge/chip (not plain text) in thread
- [ ] Notification sound plays when new message arrives on a different browser tab
- [ ] Notification sound does NOT play when inbox tab is active and focused
- [ ] Incoming call banner appears and notification sound plays regardless of which tab is focused
- [ ] Accept call → audio connects within 3 seconds on same network
- [ ] Tab title shows unread count when messages are unread
- [ ] Mark as Resolved moves conversation to Resolved tab
- [x] Sidebar nav badge shows correct unread count

## References

- Store order management: `plan/features/STORE-MANAGEMENT.md`
- Guest intercom counterpart: `plan/features/INTERCOM-GUEST.md`
- Intercom schema: `plan/docs/BACKEND.md §intercoms`
- Notification sound configuration: `plan/features/SETTINGS.md §Intercom`
- Quick request configuration: `plan/features/SETTINGS.md §Intercom`
- Unread count on dashboard: `plan/features/DASHBOARD-OVERVIEW.md`
