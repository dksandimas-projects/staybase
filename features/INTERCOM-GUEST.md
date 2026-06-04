# Guest Intercom
> App: guest-app
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, guest-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Guest Intercom

## Overview

A QR-code-activated browser chat at `/intercom/:roomId`. Guests scan the QR code in their room, which opens a browser-based chat with the front desk. No app download, no login, no account required. The room number is passed via the URL parameter. Guests can type freely or use a quick request panel for common one-tap requests.

---

## UI Checklist

- [ ] Guest name prompt — on first open, ask guest for their name (stored in local state only, not Firestore)
- [ ] Room identifier displayed — "Room 202 — You're connected to the front desk"
- [ ] Chat thread — messages from guest (right-aligned) and front desk (left-aligned)
- [ ] Quick Request panel — row of tap-able request chips above the text input
- [ ] Quick request items pulled from `settings/hotelConfig.intercomQuickRequests` (e.g. Extra Towels, Housekeeping, Extra Pillow, Do Not Disturb)
- [ ] Quick request chip tap — sends a styled badge message in the thread (visually distinct from typed messages)
- [ ] Text input + Send button — guests can type freely alongside or instead of quick requests
- [ ] Message timestamps
- [ ] Unread indicator — subtle pulse when new front desk message arrives
- [ ] Mobile-first layout — full-screen chat on mobile (375px)
- [ ] "spark inn" branding in chat header — warm, not clinical
- [ ] "Shop" tab alongside chat — switches to Spark Essentials store panel (see `features/STORE-GUEST.md`)
- [ ] Store tab hidden if `settings/storeConfig.isEnabled` is false
- [ ] **"Call Front Desk" button** — shown in chat header; initiates a WebRTC voice call to the front desk
  - [ ] Button label: "Call Front Desk" with a phone icon
  - [ ] On tap: requests microphone permission via `getUserMedia` — if denied, fall back to `tel:` link using `settings/hotelConfig.frontDeskPhone`
  - [ ] If permission granted: initiate WebRTC call flow (see §Voice Call below)
  - [ ] Active call UI: full-screen overlay showing "Calling Front Desk…" → "Connected" with a mute button and end call button
  - [ ] Call ended by either party: overlay dismisses, returns to chat

## Data & Logic Checklist

- [ ] Room ID from URL param `:roomId` — validate it exists in `rooms` collection
- [ ] Real-time messages via `onSnapshot` on `intercoms/{roomId}/messages` — always unsubscribe on cleanup
- [ ] Guest sends message: `addDoc` to `intercoms/{roomId}/messages` with `sender: "guest"`, `isRead: false`, `isQuickRequest: false`
- [ ] Quick request sends: same as above but `isQuickRequest: true`, `text` = quick request label
- [ ] Front desk messages with `isRead: false` — client marks `isRead: true` on view
- [ ] `settings/hotelConfig` fetched once on load for quick request items
- [ ] No auth required — `intercoms` collection is fully open (see `docs/BACKEND.md §security rules`)

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
- [ ] `RTCPeerConnection` created with public STUN servers (Google's free STUN: `stun:stun.l.google.com:19302`) — no TURN server needed for same-network/LAN use; add free TURN (Metered.ca free tier) for cross-network reliability
- [ ] Firestore signaling: `calls/{roomId}` document — offer, answer, status; `calls/{roomId}/iceCandidates/{id}` subcollection
- [ ] Guest side: creates offer → writes to Firestore → listens for answer → listens for ICE candidates
- [ ] Front desk side (admin-app): listens on `calls/{roomId}` for `status: "ringing"` → shows notification → on accept, creates answer → writes back
- [ ] Both sides: add ICE candidates as they arrive via `onSnapshot`
- [ ] Mute toggle: `audioTrack.enabled = false/true` — no renegotiation needed
- [ ] Hang up: `peerConnection.close()` + update `calls/{roomId}.status = "ended"` + stop all tracks
- [ ] Fallback: if `getUserMedia` throws (denied or not supported) → show "Call failed. Please call us directly: {phone}" with a `tel:` link
- [ ] Call timeout: if `status` stays `"ringing"` for 30 seconds with no answer → auto-cancel, show "No answer. Try again or send a message."
- [ ] Only one active call per room at a time — check `calls/{roomId}.status` before initiating

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

> See `docs/BACKEND.md` — add `calls` collection schema there.

---

## Edge Cases & States

- [ ] Invalid room ID in URL — show "This QR code is not valid. Please contact the front desk."
- [ ] No quick request items configured — hide quick request panel entirely, show text input only
- [ ] Front desk offline / no response — no typing indicator, no "online" status shown — keep it calm
- [ ] Network disconnected — show "You're offline. Reconnecting..." banner
- [ ] Long message thread — virtualize or paginate to avoid performance issues on mobile
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

- Store guest panel: `features/STORE-GUEST.md`
- Admin inbox counterpart: `features/INTERCOM-INBOX.md`
- Quick request configuration: `features/SETTINGS.md §Intercom`
- QR code generation: `features/QR-MANAGEMENT.md`
- Intercom schema: `docs/BACKEND.md §intercoms`
