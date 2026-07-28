# Bug: Create Walk-in Booking Modal is Not Scrollable

## Status
- **Reported**: July 8, 2026
- **Shipped**: July 8, 2026 (code fix in `2d99946` / `a249a3e`)
- **App**: `admin-app`
- **Component**: Walk-in Booking Modal
- **Status**: ✅ Shipped — code fix is on `dev`; the bug MD is being kept in sync via `docs/phase-12-walkin-modal-bug-status` so the file no longer reads as open.

## Description
The "Create Walk-in Booking" modal (accessed by clicking "New Booking" on the Bookings page `/bookings`) did not support vertical scrolling. On smaller screens (e.g. 13-inch laptops) or when the viewport height was reduced, form inputs, pricing summaries, and action buttons at the bottom of the modal were clipped and inaccessible.

## Expected Behavior
The modal limits its maximum height relative to the viewport (`max-h-[90vh]` on desktop, `max-h-[95vh]` on the mobile bottom sheet) and renders a vertical scrollbar for the form body when the content exceeds that threshold. The Cancel + Confirm Reservation action row stays pinned at the bottom of the modal regardless of scroll position.

## Root Cause Analysis
The walk-in modal's wrapper had no `max-h` constraint, the desktop `motion.section` was set to `h-full max-h-full` (so it never collapsed below its natural content height), the scrollable body div was missing `min-h-0` (so the nested flex child refused to shrink and `overflow-y-auto` never fired), and the Cancel/Confirm action row lived **inside** the `<form>` body — so once the form scrolled past the viewport, the action row scrolled with it and became inaccessible.

## Fix (shipped 2026-07-08 in `2d99946` / `a249a3e`, branch `fix/walkin-booking-modal-scrollability` → `dev`)

1. **Desktop wrapper** (`admin-app/src/components/Modal.tsx`) — replaced the inline `style={{ maxHeight: "90vh" }}` with the Tailwind class `max-h-[90vh]` so the constraint is part of the layout flow.
2. **Desktop `motion.section`** — replaced the `flex h-full max-h-full w-full flex-col` shape with `flex min-h-0 w-full flex-1 flex-col` so flexbox can actually shrink the section below its content's intrinsic height. The `min-h-0` is the magic line; without it, the scrollable body would never collapse.
3. **Desktop body div** — added `min-h-0` to the existing `flex-1 overflow-y-auto p-5` so the scroll container can actually shrink to a height smaller than its content.
4. **Desktop footer** — wrapped in `<div class="shrink-0 border-t …">` so the action row stays pinned at the bottom regardless of the body's scroll position.
5. **Mobile panel** — the bottom-sheet variant already carried `max-h-[95vh]` + `flex-1 overflow-y-auto` from the prior bottom-sheet refactor; no change was needed on mobile, but the `min-h-0` discipline was extended to the desktop side for parity.
6. **Walk-in modal** (`admin-app/src/pages/BookingsPage.tsx`) — the Cancel button and the Confirm Reservation `PrimaryButton` were moved out of the scrollable `<form>` body into the Modal `footer` prop. The form gained `id="walkin-form"`; the buttons carry `form="walkin-form"` so the submit still wires up to the same handler.

## Regression coverage

`admin-app/src/__tests__/walkin-modal-scrollability.test.ts` (10 source-text tests) pins the contract so a future refactor that re-introduces the failure mode fails CI. The suite covers:

- Desktop wrapper carries `max-h-[90vh]` and no inline `style={{ maxHeight: … }}`.
- Desktop `motion.section` is `flex min-h-0 w-full flex-1 flex-col` and is not the pre-fix `flex h-full max-h-full w-full flex-col` shape.
- Desktop body div is `min-h-0 flex-1 overflow-y-auto p-5`.
- Desktop footer div is `shrink-0` (stays pinned).
- Mobile panel has `max-h-[95vh]` + `flex-1 overflow-y-auto` body.
- Walk-in form has `id="walkin-form"` and the Cancel/Confirm buttons live in the Modal `footer` prop with `form="walkin-form"` (not inside the scrollable form body).
- The pre-fix "Action Row" comment + inline Cancel/Confirm block is removed from inside the `<form>`.

## Manual QA follow-up

- [ ] Real-device verification on a 13-inch laptop at 1280×800 — open Create Walk-in Booking modal, scroll the form body, confirm the Cancel + Confirm Reservation buttons remain visible at the bottom.
- [ ] Same flow on a phone (iOS Safari, Android Chrome) at 375×667 — modal renders as a bottom sheet; the form scrolls; the action row stays visible.
- [ ] Tab-key reach: tab from the last form field and confirm focus lands on the Cancel button, not into the backdrop.

## References

- Code fix: `2d99946` / `a249a3e` on `dev` (same commit, two hashes).
- Pre-archive ROADMAP entry (moved to `plan/project/archive/ROADMAP-ARCHIVE-2026-07-17.md` on 2026-07-17 during the roadmap compaction).
- Regression test: `admin-app/src/__tests__/walkin-modal-scrollability.test.ts`.
- Modal component contract: `admin-app/src/components/Modal.tsx` + `plan/admin-app/CLAUDE.md §Z-Index Scale` (the two-tier z-index system sits on top of this scroll contract).
