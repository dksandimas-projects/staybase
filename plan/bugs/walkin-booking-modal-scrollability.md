# Bug: Create Walk-in Booking Modal is Not Scrollable

## Status
- **Reported**: July 8, 2026
- **App**: `admin-app`
- **Component**: Walk-in Booking Modal
- **Status**: ⬜ Open

## Description
The "Create Walk-in Booking" modal (accessed by clicking "New Booking" on the Bookings page `/bookings`) does not support vertical scrolling. On screens with smaller resolutions (e.g. 13-inch laptops) or when the viewport height is reduced, form inputs, pricing summaries, and action buttons at the bottom of the modal are clipped and inaccessible.

## Expected Behavior
The modal should limit its maximum height relative to the viewport (e.g., `max-h-[90vh]` or `max-h-[calc(100vh-4rem)]`) and render a vertical scrollbar for the form body when the content exceeds this threshold.

## Root Cause Analysis
The walk-in booking modal wrapper or the generic `Modal` container in `admin-app` restricts sizing without enabling overflow scroll capabilities on its scrollable content area.

## Proposed Fix
Ensure the modal body uses a layout that constraints height and handles scroll:
- Add a scroll container inside the modal form using CSS classes like `max-h-[calc(100vh-200px)] overflow-y-auto px-1`.
- Review the generic `<Modal>` wrapper definition in `admin-app/src/components/Modal.tsx` to verify if scrolling properties can be enabled globally or via a prop.
