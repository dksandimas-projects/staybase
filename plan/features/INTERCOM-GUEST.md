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

- [x] Guest name prompt — on first open, ask guest for their name (stored in local state only, not Firestore)
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
- [x] Spark Rewards early check-in requests keep their early check-in flag on the message for staff handling
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

## References

- Store guest panel: `plan/features/STORE-GUEST.md`
- Admin inbox counterpart: `plan/features/INTERCOM-INBOX.md`
- Quick request configuration: `plan/features/SETTINGS.md §Intercom`
- QR code generation: `plan/features/QR-MANAGEMENT.md`
- Intercom schema: `plan/docs/BACKEND.md §intercoms`
