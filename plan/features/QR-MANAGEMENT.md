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

- [ ] Most common action is reachable in ≤ 2 clicks from the sidebar
- [ ] Loading state uses skeleton, not spinner
- [ ] Drawers save without full page reload — optimistic update, toast on success
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a single confirmation step — not buried in menus
- [ ] Empty states explain why data is missing and what to do

---

## UI Checklist

- [ ] QR grid — one card per room (all rooms), shows room number, room name, and rendered QR code
- [ ] QR code rendered using `qrcode.react` — links to `/intercom/{roomId}` on `www.sparkinnbohol.com`
- [ ] Regenerate button per room — generates a new unique room ID / QR value, updates Firestore
- [ ] Regenerate confirmation modal — "This will invalidate the current QR code. Guests with the old QR code will not be able to chat."
- [ ] Print single QR button — opens print dialog for that room's QR card
- [ ] Print all QRs button — generates a printable page with 4-up A4 layout (4 QR cards per A4 page, blank cells on last page if room count is not a multiple of 4)
- [ ] Print layout: each card shows room number, room name, spark inn logo, QR code, brief instruction ("Scan to chat with the front desk")
- [ ] Download single QR as PNG option

## Data & Logic Checklist

- [ ] QR code URL format: `https://www.sparkinnbohol.com/intercom/{roomId}`
- [ ] `roomId` is the Firestore document ID — used as the QR parameter
- [ ] Regenerate: if using a separate QR token (not the Firestore doc ID), update the token field on the room and regenerate the QR; if using doc ID, generate a new intercom channel by creating a new sub-path
- [ ] Print all: renders all 14 QR codes in a hidden printable div, triggers `window.print()` — CSS `@media print` controls layout
- [ ] `qrcode.react` renders SVG or canvas — use SVG for best print quality
- [ ] Download as PNG: draw QR SVG to canvas, export as PNG via `canvas.toDataURL()`

## Edge Cases & States

- [ ] Loading state — skeleton grid while rooms load
- [ ] Room inactive — still show QR code (front desk may still want to print for future use)
- [ ] Regenerated QR — old `/intercom/{oldRoomId}` URL shows "QR code no longer valid" on guest side (if roomId-based approach is used)
- [ ] Print dialog blocked by browser — show instruction to allow popups

## Manual QA

- [ ] All room QR codes render in grid
- [ ] Scan QR code for Room 202 — opens `/intercom/room-202-id` correctly
- [ ] Regenerate QR — new code renders, old QR link no longer works
- [ ] Print single QR — print dialog opens with correct room card
- [ ] Print all QRs — 4 cards per A4 page, correct room data on each card
- [ ] spark inn logo appears on printed QR cards
- [ ] Download as PNG — file downloads with QR code

## References

- Guest intercom (QR destination): `plan/features/INTERCOM-GUEST.md`
- Room IDs: `plan/docs/BACKEND.md §rooms`
