# QR Code Management
> App: admin-app
> Phase: Phase 8 — Intercom
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §QR Management

## Overview

The `/qr` dashboard page manages QR codes that link to the guest intercom for each room. Staff can view all room QR codes, regenerate individual codes, and print single codes or all codes in a 4-up A4 layout for physical placement in rooms.

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

- [x] QR grid — one card per room (all rooms), shows room number, room name, and rendered QR code
- [x] QR code rendered using `qrcode.react` — links to `/intercom/{roomId}` on the env-aware base URL (see "QR URL env-awareness" below).
- [x] QR Target selector — dropdown to select the target destination (Front Desk Intercom / Spark Essentials Store). Adjusts the generated QR URL and print label dynamically.
- [x] Regenerate button per room — generates a new unique room QR token / QR value, updates Firestore
- [x] Regenerate confirmation modal — "This will invalidate the current QR code. Guests with the old QR code will not be able to chat."
- [x] Print single QR button — opens print dialog for that room's QR card
- [x] Print all QRs button — generates a printable page with 4-up A4 layout (4 QR cards per A4 page)
- [x] Print layout: each card shows room number, room name, spark inn logo, QR code, dynamic instruction ("Scan to chat with the front desk" or "Scan to order from Spark Essentials")
- [x] Download single QR as PNG option

## Data & Logic Checklist

- [x] QR code URL format: `${resolveApiBaseUrl()}/intercom/{roomId}` (env-aware — see "QR URL env-awareness" below)
- [x] QR code URL format for Spark Essentials: `${resolveApiBaseUrl()}/intercom/{roomId}?tab=shop`
- [x] `roomId` is the guest intercom route parameter; room numbers are accepted by the guest route and resolved against Firestore rooms
- [x] Regenerate: updates optional `rooms/{roomId}.qrToken`; QR falls back to room doc ID when no token exists
- [x] Guest route resolution: `/intercom/:roomId` accepts room doc ID, room number, or regenerated `qrToken`
- [x] Print all: renders selected QR codes in a print window, triggers `window.print()` — CSS `@media print` controls layout
- [x] `qrcode.react` renders SVG or canvas — use SVG for best print quality
- [x] Download as PNG: draw QR SVG to canvas, export as PNG via `canvas.toDataURL()`

## Edge Cases & States

- [x] Loading state — skeleton grid while rooms load
- [x] Room inactive — still show QR code (front desk may still want to print for future use)
- [x] Regenerated QR — old `/intercom/{oldQrToken}` URL shows "QR code no longer valid" on guest side
- [x] Print dialog blocked by browser — show instruction to allow popups

## Behavior notes

- **QR regen mid-stay** — when staff regenerates a room's QR code while the guest is already checked in, two things happen:
  1. Any **new** scans of the old printed QR / old qrToken URL show the guest "QR code no longer valid" message (guest route resolves the qrToken, finds no match, falls through to the room-number check, then surfaces a "no longer valid" notice).
  2. Any **in-flight intercom session** on the old qrToken continues unchanged. The intercom chat collection is keyed by `intercoms/{roomNumber}` (Firestore doc ID = the room's human-readable number), not by the qrToken. Once a guest has opened the intercom in their browser, the URL parameter is irrelevant for subsequent messages — only the room number matters. So existing chats stay open; only future QR scans of the old code fail.
  3. Practical guidance for staff: regenerate QR only when a card is physically damaged or compromised, not on guest turnover. The room number QR is sufficient for a new guest's first scan after check-in.

---

## Manual QA

- [x] All room QR codes render in grid
- [x] Scan QR code for Room 202 — opens `/intercom/room-202-id` correctly
- [x] Regenerate QR — new code renders, old QR link no longer works
- [x] Print single QR — print dialog opens with correct room card
- [x] Print all QRs — 4 cards per A4 page, correct room data on each card
- [x] spark inn logo appears on printed QR cards
- [x] Download as PNG — file downloads with QR code

## QR URL env-awareness (2026-07-24 fix)

The QR URL is **env-aware** so a scan during a test round-trips back to the same environment the staff is working in. The base URL is `resolveApiBaseUrl()` from `admin-app/src/utils/apiBaseUrl.ts`:

| Admin hostname | QR encodes | Notes |
|---|---|---|
| `stg-admin.sparkinnbohol.com` | `https://stg.sparkinnbohol.com/intercom/...` | Staging admin → staging QR |
| `localhost` / `127.0.0.1` | `http://localhost:3000/intercom/...` | Local dev |
| `admin.sparkinnbohol.com` | `https://www.sparkinnbohol.com/intercom/...` | Production admin → production QR |
| Vercel preview (any other) | `VITE_GUEST_APP_URL` if set, else production | Set `VITE_GUEST_APP_URL` to the matching stg preview URL |

**Operational rule:** real printable QRs that will be placed in physical rooms must be generated from the **production** admin (`admin.sparkinnbohol.com`), not from staging. The env-awareness exists so staff can test the full scan flow against staging without needing to swap their admin URL — QR codes generated in staging point at the staging guest app, so the test stays on the same environment.

## References

- Guest intercom (QR destination): `plan/features/INTERCOM-GUEST.md`
- Room IDs: `plan/docs/BACKEND.md §rooms`
