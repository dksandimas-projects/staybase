# Room Management
> App: admin-app
> Phase: Phase 3 — Room System (CRUD: Phase 11.8)
> Requires: CLAUDE.md, docs/FRONTEND.md, docs/BACKEND.md, plan/admin-app/CLAUDE.md
> Design ref: spark-inn-design-spec.md §Room Management

## Overview

The `/rooms` dashboard page for the full room lifecycle — **create**, read, edit, and **delete** rooms. Staff can add new rooms, update room details, upload and manage photos, change availability status, set block reasons, toggle rooms active/inactive, and permanently remove rooms that are no longer in inventory. Room deletion is admin-gated (Firestore rule + UI hint) and blocked while any active bookings reference the room.

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

- [ ] **Add Room** button — full-width orange on mobile (below the subtitle), inline right-aligned on tablet+. Opens a Modal with the create form.
- [ ] Room list — card grid of all rooms with name, type, status badge, housekeeping badge, active/inactive toggle, and an "active bookings" count
- [ ] Edit room — click/tap opens edit drawer
- [ ] **Create room form** — Modal with fields: display name, room number, type (dropdown), max capacity, bed definition, base rate, weekend rate, corporate rate, initial status, initial housekeeping status, description, internal remarks, visible-on-guest-site checkbox. Photos are added later via the edit drawer.
- [ ] Room edit form fields: name, type (dropdown), description, max capacity, bed definition, status (Available/Occupied/Blocked), block reason (if Blocked), remarks (internal notes)
- [ ] Block reason selector — shown only when status = Blocked: Maintenance / Hold / Other
- [ ] Active/inactive toggle — inactive = hidden from guest site
- [ ] Save button — explicit save, not auto-save
- [ ] Housekeeping status shown per room (read-only here — toggled from dashboard)
- [ ] **Photo management** — **not** on this screen. Per `plan/features/SETTINGS.md §Room Type Photos`, all rooms of a type share the same gallery managed in Settings → Room Types. The create modal links to that section.
- [ ] **Delete Room** — destructive action in the edit drawer footer (red outlined button). Disabled when active bookings > 0. Opens a confirmation Modal with a required reason field and clear "cannot be undone" copy.
- [ ] **Delete blocked** state — when the room has active bookings, the confirmation Modal swaps to an informational ConfirmForm that explains how many bookings need to be resolved first.

## Data & Logic Checklist

- [ ] `onSnapshot` on `rooms` collection — all rooms real-time
- [ ] **Create room**: `addDoc(collection(db, "rooms"), { ... })` with `serverTimestamp()` for `createdAt`/`updatedAt`. Reject if `roomNumber` already exists (case-insensitive trim compare). Form validation via `CreateRoomSchema` (Zod) in `@spark-inn/shared/schemas/room`.
- [ ] Room edit: `updateDoc` on `rooms/{roomId}` — update all edited fields + `updatedAt`
- [ ] Photo upload: `uploadBytes` to Firebase Storage at `rooms/{roomId}/{filename}`, then `getDownloadURL`, then `updateDoc` to append URL to `imageUrls[]`
- [ ] Photo delete: remove URL from `imageUrls[]` via `updateDoc`, optionally delete from Storage
- [ ] Active toggle: `updateDoc` sets `isActive: true/false`
- [ ] Status change to Blocked: require `blockReason` — do not allow save without it
- [ ] **Block a room for a date range**: write `blockedFrom: Timestamp`, `blockedTo: Timestamp`, `blockReason: string` to the room doc *(Per `DECISIONS-FEATURES.md #78`)*. The booking creation transaction iterates the room's active block ranges and rejects any booking whose dates overlap. The previous lossy approach (string-encoding the date range into `blockReason`) is replaced.
- [ ] **Delete room (admin-only)**: hard delete `rooms/{roomId}` plus cascade cleanup of:
  - `rooms/{roomId}/*` photos in Storage (best-effort, `listAll` + `deleteObject` each)
  - `intercoms/{roomNumber}` thread document
  - `intercoms/{roomNumber}/messages/*` subcollection (via `getDocs` + `deleteDoc` each)
  - `calls/{roomNumber}` document
  - `calls/{roomNumber}/iceCandidates/*` subcollection
- [ ] **Active-booking guard**: a room with any booking in `pending`, `payment-uploaded`, `payment-confirmed`, `confirmed`, or `checked-in` status cannot be deleted. The UI surfaces the count and the user must cancel or check out the bookings first.
- [ ] **Firestore security**: room delete is admin-only (`allow delete: if isAdmin()`). Front-desk and admin can still create, update, and toggle.
- [ ] **Historical booking integrity**: bookings keep their denormalized `roomNumber` / `roomType` after a room is deleted. The `roomId` pointer becomes orphaned but the human-readable fields survive for receipts and audit logs.

## Edge Cases & States

- [ ] Loading state — skeleton for room list
- [ ] Photo upload failure — show error per image, allow retry
- [ ] Unsaved changes — warn staff before navigating away ("You have unsaved changes")
- [ ] Room with active bookings being blocked — allow block but note active bookings may be affected (do not auto-cancel)
- [ ] Image reorder: optimistic UI update, sync to Firestore on save
- [ ] Max photos per room: set a reasonable limit (e.g. 10) — enforce in upload UI
- [ ] **Create room — duplicate room number** — show inline error on the room-number field; do not write to Firestore.
- [ ] **Create room — invalid Zod payload** — surface per-field error messages, focus the first invalid field.
- [ ] **Delete — partial cascade failure** — Storage or subcollection cleanup errors are logged and surfaced via a warning toast, but the room document is still removed (the live record is the source of truth).
- [ ] **Delete — concurrent booking** — if a booking flips to an active status between the guard check and the `deleteDoc`, the next listener snapshot reveals the orphan. A future enhancement may add a transaction-based check; not required for Phase 11.8.

## Manual QA

- [ ] All rooms appear in the list with active-bookings count
- [ ] Create a room — appears in the list immediately, configured rates and status save correctly
- [ ] Create with an existing room number — inline error, no document written
- [ ] Edit room name, description, capacity — changes save and reflect in room list
- [ ] Block a room — block reason required, status badge updates
- [ ] Unblock a room — status returns to Available
- [ ] Deactivate room — room disappears from guest-app `/rooms` page
- [ ] Upload 2 photos — both appear in photo list with preview
- [ ] Delete a photo — removed from list and no longer visible on guest site
- [ ] **Delete a room with no bookings** — confirmation modal requires a reason, room disappears, toast confirms
- [ ] **Delete a room with active bookings** — button disabled, modal shows booking count, deletion blocked
- [ ] **Front-desk user attempts delete** — Firestore rule rejects, UI surfaces error toast
- [ ] Firebase Storage CORS configured — uploads don't fail silently
- [ ] After delete, the room's `intercoms/{roomNumber}` thread and any `calls/{roomNumber}` doc are gone
- [ ] After delete, historical bookings still show the room number on the Bookings page and on receipts

## References

- Room schema: `plan/docs/BACKEND.md §rooms`
- Create-room form schema: `shared/schemas/room.ts` (Zod)
- Firebase Storage upload pattern: `plan/docs/BACKEND.md §Firebase SDK Usage`
- Storage CORS requirement: `plan/docs/GOTCHAS.md`
- Rate management (prices): `plan/features/RATE-MANAGEMENT.md`
- Room status on dashboard grid: `plan/features/DASHBOARD-OVERVIEW.md`
- Mobile responsive patterns: `plan/features/ADMIN-MOBILE.md §Rooms`
- Active booking status list: `shared/schemas/room.ts` (`ACTIVE_BOOKING_STATUSES`)
