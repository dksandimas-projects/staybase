# Room Management
> App: admin-app
> Phase: Phase 3 — Room System
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Room Management

## Overview

The `/rooms` dashboard page for editing all rooms. Staff can update room details, upload and manage photos, change availability status, set block reasons, and toggle rooms active/inactive. All rooms are always displayed — rooms cannot be deleted, only deactivated.

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

- [ ] Room list — table or card grid of all rooms with name, type, status badge, housekeeping badge, active/inactive toggle
- [ ] Edit room — click/tap opens edit form (inline or drawer)
- [ ] Room edit form fields: name, type (dropdown), description, max capacity, bed definition, status (Available/Occupied/Blocked), block reason (if Blocked), remarks (internal notes)
- [ ] Block reason selector — shown only when status = Blocked: Maintenance / Hold / Other
- [ ] Active/inactive toggle — inactive = hidden from guest site
- [ ] Photo management — upload multiple photos, reorder (drag or up/down arrows), delete individual photos
- [ ] Photo upload: drag-and-drop or file picker, accepts image files only, max 5MB per image
- [ ] Upload progress indicator per image
- [ ] Save button — explicit save, not auto-save
- [ ] Housekeeping status shown per room (read-only here — toggled from dashboard)

## Data & Logic Checklist

- [ ] `onSnapshot` on `rooms` collection — all rooms real-time
- [ ] Room edit: `updateDoc` on `rooms/{roomId}` — update all edited fields + `updatedAt`
- [ ] Photo upload: `uploadBytes` to Firebase Storage at `rooms/{roomId}/{filename}`, then `getDownloadURL`, then `updateDoc` to append URL to `imageUrls[]`
- [ ] Photo delete: remove URL from `imageUrls[]` via `updateDoc`, optionally delete from Storage
- [ ] Active toggle: `updateDoc` sets `isActive: true/false`
- [ ] Status change to Blocked: require `blockReason` — do not allow save without it
- [ ] Never delete a room document — only deactivate

## Edge Cases & States

- [ ] Loading state — skeleton for room list
- [ ] Photo upload failure — show error per image, allow retry
- [ ] Unsaved changes — warn staff before navigating away ("You have unsaved changes")
- [ ] Room with active bookings being blocked — allow block but note active bookings may be affected (do not auto-cancel)
- [ ] Image reorder: optimistic UI update, sync to Firestore on save
- [ ] Max photos per room: set a reasonable limit (e.g. 10) — enforce in upload UI

## Manual QA

- [ ] All rooms appear in the list
- [ ] Edit room name, description, capacity — changes save and reflect in room list
- [ ] Block a room — block reason required, status badge updates
- [ ] Unblock a room — status returns to Available
- [ ] Deactivate room — room disappears from guest-app `/rooms` page
- [ ] Upload 2 photos — both appear in photo list with preview
- [ ] Delete a photo — removed from list and no longer visible on guest site
- [ ] Firebase Storage CORS configured — uploads don't fail silently

## References

- Room schema: `plan/docs/BACKEND.md §rooms`
- Firebase Storage upload pattern: `plan/docs/BACKEND.md §Firebase SDK Usage`
- Storage CORS requirement: `plan/docs/GOTCHAS.md`
- Rate management (prices): `plan/features/RATE-MANAGEMENT.md`
- Room status on dashboard grid: `plan/features/DASHBOARD-OVERVIEW.md`
