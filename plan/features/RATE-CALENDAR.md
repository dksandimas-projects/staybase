# Rate Calendar
> App: admin-app
> Phase: Phase 12 — Post-Launch
> Status: Planned
> Requires: `plan/features/RATE-MANAGEMENT.md`, `plan/docs/BACKEND.md`, `plan/docs/TYPES.md`
> Related UI: `/rates`

## Overview

Add an Airbnb-style rate calendar inside the admin Rates area. The purpose is to let admins and front desk staff inspect and update nightly public pricing by date, without editing base room-type rates one row at a time.

The rate calendar is a rate-management surface, not an occupancy surface. Booking blocks, guest names, and room-level availability belong in the booking calendar. This view focuses on:

- Room type by date rate visibility
- Seasonal/holiday label visibility
- Multi-select bulk seasonal rate editing
- Fast edits to existing seasonal rate overrides

Existing bookings must keep their locked price. Rate calendar edits affect only new bookings created after the change.

---

## Pricing Hierarchy

The calendar should display the effective public nightly rate for each room type and date using this order:

1. **Seasonal override** — if an active override applies to the date and room type.
2. **Weekend rate** — if no seasonal override applies and the date is Saturday or Sunday.
3. **Regular base rate** — fallback for normal weekdays.

Corporate rates are not mixed into the default public rate view. Corporate pricing uses negotiated/flat corporate rates and should be available through a separate preview toggle so staff can check it without confusing the public calendar.

Full booking pricing still applies add-ons and discounts after the nightly room rate is chosen:

- Breakfast
- Vouchers
- Spark Rewards points/member discount
- Senior/PWD mandated discounts

---

## View Model

Default layout:

- One calendar month visible at a time.
- Rows represent active room types from `settings/hotelConfig.roomTypes[]`.
- Columns/cells represent dates in the visible month.
- Each cell shows:
  - Day number
  - Effective nightly public rate
  - Rate source indicator: regular, weekend, or seasonal
  - Seasonal override label when applicable

Navigation:

- Previous month
- Next month
- Today / current month shortcut

Optional future controls:

- 90-day view
- Corporate preview toggle
- Room type filter

---

## Multi-Select / Unselect

Staff should be able to select multiple rate cells before applying an edit.

Selection behavior:

- Click an unselected cell to select it.
- Click another date in the same room type to expand to a continuous range.
- Click cells in another room type to add that room type to the same date range.
- Click an already-selected cell to unselect/clear the current selection.
- Show selected cells with a clear active border/background.

Version 1 should prefer click-to-range selection over drag-select. Drag-select can be added later if the current interaction feels too slow in daily use.

Selection summary panel:

- Selected room type(s)
- Selected start/end date
- Count of affected dates
- Proposed nightly rate input
- Optional seasonal label/name input
- Save action
- Clear selection action

For version 1, disconnected date selections can be rejected with clear copy asking the user to choose one continuous range. This avoids silently creating many fragmented overrides.

---

## Edit Rates

Bulk editing from the rate calendar should create or update seasonal rate overrides. It should not overwrite base, weekend, or corporate room-type rates.

Create flow:

- User selects one continuous date range.
- User selects one or more room types through cell selection.
- User enters:
  - Override name, such as "Holy Week" or "Christmas Peak"
  - Nightly rate
- Save writes one `SeasonalRateOverride` to `settings/hotelConfig.seasonalRateOverrides[]`.

Update flow:

- Clicking a seasonal-rate cell opens a drawer for that existing override.
- Drawer fields:
  - Name / holiday label
  - Start date
  - End date
  - Nightly rate
  - Room type scope
  - Active toggle
- Drawer actions:
  - Save changes
  - Delete override

If the override applies to multiple room types, the drawer should make that scope visible so staff do not accidentally edit a hotel-wide holiday rate while thinking they are editing one room type.

---

## Holiday Labels

Seasonal override names become the holiday/event labels on the calendar.

Examples:

- Holy Week
- Christmas Peak
- Sinulog
- Long Weekend

Cells affected by an active seasonal override should show the override name as a compact label below or beside the rate.

Overlapping seasonal overrides should be avoided. If overlaps exist, the calendar should display the override selected by the shared seasonal-rate calculator and should warn admins when saving a new override that overlaps an existing active override for the same room type/date range.

---

## Data Contract

Reuse the existing seasonal override model:

- `settings/hotelConfig.seasonalRateOverrides[]`
- Shared type: `SeasonalRateOverride`
- Shared utility: `calculateSeasonalAwareRoomTotal`

The rate calendar should not introduce a new per-date rate collection for version 1. Seasonal overrides already model:

- Name/label
- Date range
- Nightly rate
- Room-type scope
- Active/inactive state

A dedicated per-date rate collection can be revisited only if the hotel later needs revenue-management features like daily demand pricing, inventory-derived rates, or audit history per date edit.

---

## UX Checklist

- [x] Rate calendar lives inside `/rates` as the "Rate Calendar" tab next to base rate configuration.
- [x] Month view is the default, matching the Airbnb-style mental model.
- [x] Cells are generated from active dynamic room types, never hardcoded room names.
- [x] Effective public rate matches the guest booking flow.
- [x] Seasonal labels come from `seasonalRateOverrides[].name`.
- [x] Multi-select supports one continuous date range across one or more room types.
- [x] Clicking selected cells clears the selection.
- [x] Existing seasonal cells can be clicked to edit/delete the override.
- [x] Corporate pricing is managed separately through explicit partner codes cards, avoiding public calendar confusion.
- [x] Existing bookings are not repriced.

## Testing Notes

Add coverage for:

- Month grid renders active room types and date cells.
- Rate hierarchy: seasonal beats weekend, weekend beats regular.
- Corporate preview does not affect the default public rate display.
- Seasonal override label appears on matching cells.
- Multi-select, multi-room selection, and unselect behavior.
- Bulk save writes `seasonalRateOverrides` through `updateSettings("hotelConfig", ...)`.
- Existing override drawer edits name, dates, rate, active state, and room-type scope.

## References

- Rate management: `plan/features/RATE-MANAGEMENT.md`
- Backend settings schema: `plan/docs/BACKEND.md §settings/hotelConfig`
- Types: `plan/docs/TYPES.md §SeasonalRateOverride`
- Booking pricing: `plan/features/BOOKING-FLOW.md`
