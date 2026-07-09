# Guest Intercom
> App: guest-app
> Phase: Phase 8 — Intercom
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Guest Intercom

## Overview

A QR-code-activated browser chat at `/intercom/:roomId`. Guests scan the QR code in their room, which opens a browser-based chat with the front desk. No app download, no login, no account required. The room number is passed via the URL parameter. Guests can type freely or use a quick request panel for common one-tap requests.

---

## UX Checklist
> Apply `plan/docs/FRONTEND.md §UX Philosophy` to every screen in this feature.

- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Back navigation never loses user input
- [ ] Confirmation/success state feels celebratory, not just "OK"

---

## UI Checklist

- [x] ~~Guest name prompt — on first open, ask guest for their name (stored in local state only, not Firestore)~~ — **superseded by `QA-20` Layer 2** (see Implementation Plan below): the free-text "What is your name?" field is being replaced by a single last-name field that both greets the guest and verifies them against the booking, instead of two separate steps over time.
- [x] Room identifier displayed — "Room 202 — You're connected to the front desk"
- [x] Chat thread — messages from guest (right-aligned) and front desk (left-aligned)
- [x] Quick Request panel — row of tap-able request chips above the text input
- [x] Quick request items pulled from `settings/hotelConfig.intercomQuickRequests` (e.g. Extra Towels, Housekeeping, Extra Pillow, Do Not Disturb)
- [x] Quick request chip tap — sends a styled badge message in the thread (visually distinct from typed messages)
- [x] Text input + Send button — guests can type freely alongside or instead of quick requests
- [x] Message timestamps
- [ ] Unread indicator — subtle pulse when new front desk message arrives while the guest is not viewing the Chat tab (Phase 10 polish; not launch-blocking for Phase 8 because visible replies auto-scroll and mark read immediately)
- [x] Mobile-first layout — full-screen chat on mobile (375px)
- [x] "spark inn" branding in chat header — warm, not clinical
- [x] "Shop" tab alongside chat — tab label is `config.storeName`; switches to store panel (see `plan/features/STORE-GUEST.md`)
- [x] Store tab hidden if `settings/storeConfig.isEnabled` is false
- [x] **"Call Front Desk" button** — shown in chat header; initiates a WebRTC voice call to the front desk
  - [x] Button label: "Call Front Desk" with a phone icon
  - [x] On tap: requests microphone permission via `getUserMedia` — if denied, fall back to `tel:` link using `settings/hotelConfig.frontDeskPhone`
  - [x] If permission granted: initiate WebRTC call flow (see §Voice Call below)
  - [x] Active call UI: full-screen overlay showing "Calling Front Desk…" → "Connected" with a mute button and end call button
  - [x] Call ended by either party: overlay dismisses, returns to chat

## Data & Logic Checklist

- [x] Room ID from URL param `:roomId` — validate it exists in `rooms` collection
- [x] Real-time messages via `onSnapshot` on `intercoms/{roomId}/messages` — always unsubscribe on cleanup
- [x] Guest sends message: `addDoc` to `intercoms/{roomId}/messages` with `sender: "guest"`, `isRead: false`, `isQuickRequest: false`
- [x] Quick request sends: same as above but `isQuickRequest: true`, `text` = quick request label
- [x] Spark Rewards early check-in requests keep their early check-in flag (`isEarlyCheckInRequest`) on the message for staff handling — dormant plumbing today: early check-in delivery is email-only and nothing writes this flag yet (see `plan/features/SPARK-REWARDS.md §Early check-in perk`)
- [x] Front desk messages with `isRead: false` — client marks `isRead: true` on view
- [x] `settings/hotelConfig` fetched once on load for quick request items
- [x] No auth required — `intercoms` collection is fully open (see `plan/docs/BACKEND.md §security rules`)

## Voice Call (WebRTC)

Zero-cost peer-to-peer audio between guest browser and front desk browser. No third-party service.

### How it works
1. Guest taps "Call Front Desk" — guest creates an RTCPeerConnection and generates an SDP offer
2. Offer written to `calls/{roomId}` in Firestore: `{ offer: sdp, status: "ringing", guestName, timestamp }`
3. Admin Intercom Inbox shows incoming call notification — "Guest in Room {X} is calling"
4. Front desk accepts — writes SDP answer back to `calls/{roomId}.answer`
5. Both sides exchange ICE candidates via `calls/{roomId}/iceCandidates` subcollection
6. WebRTC connection established — audio flows peer-to-peer (never through Firestore)
7. On hang-up by either side: update `calls/{roomId}.status` to `"ended"` — both sides detect via `onSnapshot` and close the connection

### Checklist
- [x] `Permissions-Policy` allows the microphone for the app's own origin — `microphone=(self)` in **all three** `vercel.json` files (root, guest-app, admin-app). `microphone=()` blocks `getUserMedia` outright and kills the call in production only (per BI-06, booking-intercom audit 2026-07-06; see `plan/docs/GOTCHAS.md §Intercom`)
- [x] `RTCPeerConnection` created with public STUN servers (Google's free STUN: `stun:stun.l.google.com:19302`) — no TURN server needed for same-network/LAN use; add free TURN (Metered.ca free tier) for cross-network reliability
- [x] Firestore signaling: `calls/{roomId}` document — offer, answer, status; `calls/{roomId}/iceCandidates/{id}` subcollection
- [x] Guest side: creates offer → writes to Firestore → listens for answer → listens for ICE candidates
- [x] Front desk side (admin-app): listens on `calls/{roomId}` for `status: "ringing"` → shows notification → on accept, creates answer → writes back
- [x] Both sides: add ICE candidates as they arrive via `onSnapshot`
- [x] Mute toggle: `audioTrack.enabled = false/true` — no renegotiation needed
- [x] Hang up: `peerConnection.close()` + update `calls/{roomId}.status = "ended"` + stop all tracks
- [x] Fallback: if `getUserMedia` throws (denied or not supported) → show "Call failed. Please call us directly: {phone}" with a `tel:` link
- [x] Call timeout: if `status` stays `"ringing"` for 30 seconds with no answer → auto-cancel, show "No answer. Try again or send a message."
- [x] Only one active call per room at a time — check `calls/{roomId}.status` before initiating

### Firestore schema addition
```
calls/{roomId}
  offer: RTCSessionDescriptionInit
  answer: RTCSessionDescriptionInit | null
  status: "ringing" | "active" | "ended"
  guestName: string
  startedAt: Timestamp
  endedAt: Timestamp | null

calls/{roomId}/iceCandidates/{id}
  candidate: RTCIceCandidateInit
  from: "guest" | "staff"
  createdAt: Timestamp
```

> See `plan/docs/BACKEND.md` — add `calls` collection schema there.

---

## Edge Cases & States

- [x] Invalid room ID in URL — show "This QR code is not valid. Please contact the front desk."
- [x] No quick request items configured — hide quick request panel entirely, show text input only
- [x] Front desk offline / no response — no typing indicator, no "online" status shown — keep it calm
- [x] Network disconnected — show "You're offline. Reconnecting..." banner
- [ ] Long message thread — virtualize or paginate after launch if real usage produces large room threads (Phase 10 polish; current launch scope keeps the full active stay thread in one real-time list)
- [ ] Guest refreshes page — name prompt shown again (local state only)

## Manual QA

- [ ] Scan QR code for Room 202 — opens chat correctly with room 202 context
- [ ] Guest name prompt appears on first load
- [ ] Type and send message — appears in thread and in admin Intercom Inbox simultaneously
- [ ] Front desk reply appears in real-time without page refresh
- [ ] Quick request chip sends styled badge message in thread
- [ ] Quick request badge appears distinctly in admin inbox thread
- [ ] Works on iOS Safari and Android Chrome without app install
- [ ] Full layout visible without horizontal scroll at 375px

## Implementation Plan — Current-Guest Access Guard

### Problem (raised by owner, confirmed in code, 2026-07-09)

Anyone who has ever had the `/intercom/:roomId` link (bookmarked it, screenshotted the QR, kept it open in a tab) can reopen the chat at any time — including after they've checked out — because there's no gate tied to whether they're the room's current occupant. This is intentional-by-design for the *no-login, no-friction* QR access model (`intercoms` collection is fully open per §Data & Logic Checklist above), but nothing currently distinguishes "the guest currently staying in this room" from "anyone who once had this link."

Investigating further surfaced a **more serious version of the same gap**: `intercoms/{roomId}` threads are keyed only by room number and persist indefinitely — checkout only sets `resolved: true` on the thread (`plan/features/BOOKINGS-MANAGEMENT.md`-adjacent checkout logic in `guest-app/server/handlers/bookings.ts`), it does not clear or archive the message history. So a checked-out guest reopening a bookmark doesn't just get an unwanted open door — if a new guest has since checked into that same room, the old guest could see the new guest's private conversation with front desk (and vice versa: a new guest scanning the room's QR code for the first time could scroll up and see the previous occupant's messages, complaints, or requests). Given `plan/docs/SECURITY.md` and the RA 10173 commitments in `LEGAL.md`, this is a data-exposure gap, not just a UX nicety.

### Recommended Approach (decided with owner 2026-07-09)

A static, print-once QR code stays the room's permanent link (no reprinting/turnover workflow change for housekeeping/front desk). Instead of rotating the link itself, access is gated by matching the guest's typed last name against the room's current booking record, server-side. Three layers, in order:

- ⬜ **Layer 1 — room occupancy gate.** `rooms/{roomId}.status` is already public-read and already flips to `"occupied"` on check-in / `"available"` on checkout (`guest-app/server/handlers/bookings.ts`). On `IntercomPage.tsx` mount, check the resolved room's `status`; if it isn't `"occupied"`, show a calm "This room isn't currently checked in — please contact the front desk directly" screen instead of the chat or the name/verification prompt. Cheapest filter, catches the vacant-gap case with zero guest friction.
- ⬜ **Layer 2 — single last-name field, replacing the old free-text name prompt entirely.** The current "What is your name?" free-text field (§UI Checklist above) is removed. In its place, one field: **"Last name"**, with a hint directly under it — *"This should match the last name used when the room was booked."* — so guests understand upfront why it might not just be "whatever you'd like to be called," instead of hitting a confusing rejection with no context. `bookings/{bookingId}` is staff-only read (`allow read: if isStaff()` in `firebase/firestore.rules`), so this **cannot** be a client-side Firestore check — it needs a small new server endpoint, e.g. `POST /api/intercom/verify-guest` with `{ roomId, lastName }`, using the Admin SDK to look up the room's currently `checked-in` booking and compare against `guestDetails.lastName` using a **normalized comparison**, not a raw string match: lowercase both sides, trim leading/trailing whitespace, collapse internal whitespace, and strip punctuation/symbols (apostrophes, hyphens, periods) before comparing — so "de la cruz", "DE LA CRUZ", and "De La Cruz" all match the booking's "De la Cruz", and "O'Brien" matches "obrien" or "o brien". The endpoint returns only `{ verified: true|false }` — it never echoes the real name back to the client, so a wrong guess can't be used to fish for the correct answer. On a mismatch, show a plain message ("We couldn't verify that against this room's booking — please ask the front desk for help") with the front desk phone number as a fallback, since a non-booker companion staying in the same room may not share the booker's last name. On success: the verified last name becomes the guest's display name too (used in the "Mabuhay, {lastName}!" greeting and shown in the admin Inbox thread, replacing what the old free-text field used to provide) — store a verified flag + the last name together in `localStorage` scoped to the **booking ID**, not just the room number (e.g. `intercomVerified:{bookingId}`), so the guest isn't asked again for the rest of their stay, but a different guest/booking in the same room later gets a fresh prompt. This fully replaces `QA-17` rather than sitting alongside it — there's no longer a separate "remember the display name" step, since the last name now serves both purposes.
- ⬜ **Layer 3 — scope message history per stay.** Layer 2 stops the *wrong person* from getting in, but doesn't by itself stop a newly-verified guest from seeing a *previous* guest's leftover conversation in the same `intercoms/{roomId}` thread (still keyed by bare room number today). Tag each check-in with a `stayId` (or reuse the `bookingId`) written onto `rooms/{roomId}.currentStayId`, stamp new intercom messages with it, and have the guest client only render/subscribe to messages matching the room's *current* `currentStayId`. Old messages stay in Firestore for staff/audit history (already visible in the admin Inbox regardless of resolved state) but never render for a new guest. Lower urgency than Layer 2 now that identity is verified, but still worth doing for a clean, uncluttered first-open experience and to keep prior guests' message content from lingering in view at all.

## Implementation Plan — Header & Tab UI Polish

### Problem (raised by owner, confirmed in code, 2026-07-09)

Two issues in `IntercomPage.tsx`'s `<header>` (the dark bar at the top of the chat):

- ⬜ **Room avatar badge shows the raw URL slug, overflowing its circle.** The `h-9 w-9` (36px) circle renders `{roomId || "G"}` directly — `roomId` is the raw route param (e.g. `room-301`, a full slug/token), not a short label. A long slug wrapped into a 36px circle overflows and wraps onto two lines outside the circle bounds (visible in the owner's screenshot: "room-" / "301" spilling past the badge). Fix: show something that always fits — the numeric room number only (`roomNumber` once resolved, not the raw `roomId`), a single initial, or swap to a fixed icon (e.g. a door/bed glyph) instead of variable-length text.
- ⬜ **"Chat Support" and "Spark Essentials" tabs read as an afterthought under the bold header above them.** Currently `text-xs font-bold` (12px) labels with `size={14}` icons, thin `pb-1.5` padding, and the only "selected" affordance is a 2px bottom border + color change — visually much lighter than the header content above them, even though they're the two primary destinations in the whole screen. Feature request: make both tabs noticeably larger/heavier — bump label text to `text-sm`/`text-base`, icons to `size={18}`–`20`, add more vertical padding, and consider a filled/pill-style active state (background fill, not just an underline) so the active tab reads as a clear, prominent selector rather than a subtle link — matching the "feels like an app" emphasis already requested elsewhere (see `QA-14`).

## References

- Store guest panel: `plan/features/STORE-GUEST.md`
- Admin inbox counterpart: `plan/features/INTERCOM-INBOX.md`
- Quick request configuration: `plan/features/SETTINGS.md §Intercom`
- QR code generation: `plan/features/QR-MANAGEMENT.md`
- Intercom schema: `plan/docs/BACKEND.md §intercoms`
