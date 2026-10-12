# Breakfast — Meal-Based Add-On Model
> Requires: CLAUDE.md, `plan/docs/BACKEND.md`, `plan/docs/TYPES.md`, `plan/docs/API-ROUTES.md`, `plan/docs/FRONTEND.md`, `plan/features/BOOKING-FLOW.md`, `plan/features/BOOKINGS-MANAGEMENT.md`, `plan/features/SETTINGS.md`, `plan/features/EMAIL-PDF-STORAGE.md`
>
> **Status:** ⬜ Spec only. No code yet.
>
> **Spec author:** `feature/breakfast-redesign` — design conversation with the client closed 2026-10-12 (10 numbered decisions, see `§Decisions Locked`). Awaiting team review + ticket number assignment (proposed `BR-01..BR-08` below).

---

## Why

The current breakfast model is a **flat-rate toggle** with a per-date/per-guest **string map** of meal names. That model works for one rate and one menu but doesn't fit a boutique hotel that wants:

- **Per-meal pricing** (not a flat rate × guest × night)
- **Guest-side manageability** (add/change/remove a meal up to a deadline)
- **Kitchen pre-orders** with a daily cut-off and an audit trail
- **Refund liability** when a paid meal is removed before the cut-off
- **Staff override** for walk-ins and same-day requests after the cut-off

The redesign makes breakfast a first-class **optional, dated, per-guest line-item collection** with a configurable daily cut-off, a server-enforced deadline, and a kitchen handoff at the cut-off. It also creates a net-new refund-liability surface area (the first non-cancellation refund path in the system) and a net-new "Manage Breakfast" guest flow (the first post-booking edit surface for a non-room field).

The current data shape (`hasBreakfast: boolean`, `breakfastRate: number`, `breakfastSelections: Record<key, string>`, `breakfastServed: Record<key, boolean>`) is replaced with a richer shape that snapshots meal + price + audit metadata per line. The flat-rate toggle in Step 1 of the public booking flow is removed.

---

## Decisions Locked

Resolved in the 2026-10-12 design conversation. No further clarification needed for these:

1. **Migration:** none needed. Production has zero bookings; old `hasBreakfast` / `breakfastRate` / `breakfastIncludesChildren` are deleted from the create path, not migrated.
2. **Discounts on breakfast meals:** Senior/PWD, voucher, Spark Rewards, and corporate rate all apply per the existing **discount scope matrix** (`plan/features/SETTINGS.md §4`) and still respect the `allowOnlineSeniorPwdClaim` toggle (Senior/PWD only applies online if the toggle is on).
3. **Per-guest, per-date granularity:** exactly **one meal per guest per breakfast date**. No multi-meal-per-slot.
4. **Children + extra-bed occupants:** treated as **ordinary meal slots** — they get their own row in the date's grid with the same selectable meals and the same per-meal price. The previous `breakfastIncludesChildren` toggle is removed.
5. **Corporate + walk-in parity:** all three booking flows (public `/book`, corporate `/corporate/book`, admin walk-in) follow the same meal-per-guest-per-date model.
6. **Pre-pay vs. add-to-balance:** breakfast always **rolls into the running booking balance**. No separate online-payment moment for breakfast. The balance updates immediately when meals are added/changed/removed.
7. **Front-desk edit-after-checkin:** yes, with **required reason** and audit. Meals already marked `served` are **locked** (cannot be edited or removed; the only allowed action is to un-mark within a configurable grace window — see `§Open Items #5`).
8. **Pricing scope:** per-meal prices are **hotel-wide** (one global price for "Longsilog"). No per-room-type or per-season price differentiation.
9. **Deleted menu items on existing bookings:** yes, **snapshot is immutable** — `breakfastSelections[key].mealId` and `.mealName` and `.price` are frozen at the time of order. When a meal is later deactivated, all existing bookings still show it; views append a "(no longer offered)" tag next to the meal name.
10. **Kitchen list scope for v1:** ship a printable admin-page view first (option **c** in the design discussion). Build a dedicated real-time kitchen display (option **a**) in a follow-up if the hotel needs it after running on the printable view for a week.

**Refund behaviour:** removing a paid meal **before the cut-off** opens a refund liability (staff records the actual refund). Removing an unpaid meal simply reduces the amount due. **No automatic email is sent** for breakfast changes (per client decision 2026-10-12, 5:36 PM). The kitchen needs a finalized list at the cut-off time, with late changes shown in a separate column.

**Cutoff rule:** `cutoffForDate(date) = (date − 1 calendar day) at configured cutoffTime, in hotel timezone`. The cut-off is enforced **server-side** using the hotel's configured local timezone (not the device timezone, not UTC). The default is 8:00 PM. The cut-off applies to add, change, AND remove.

---

## Scope vs. non-goals

**In scope (v1):**
- Per-meal catalog with hotel-wide prices (admin Settings)
- Configurable cut-off time (admin Settings, default 8:00 PM, hotel timezone)
- Step 1 simplification (no more "Room + Breakfast" toggle)
- Step 2 breakfast add-on section (public flow)
- Per-guest, per-date meal selection with live price preview in the booking sidebar
- Discount application per the discount scope matrix
- "Manage Breakfast" page (guest post-booking flow at `/my-booking/breakfast`)
- Staff booking-drawer breakfast section with override, reason, audit
- Cutoff enforcement (server-side, 8 PM in hotel timezone)
- Refund liability on the existing refunds subcollection (new `category: 'breakfast'`)
- Printable kitchen list admin view (finalized at cut-off + late changes column)
- "Mark Served" per meal (existing BSP-01 surface, extended metadata)

**Out of scope for v1 (follow-ups):**
- Dedicated real-time kitchen display (option a) — punted, use printable view first
- Per-meal dietary flags / allergen tagging (open item #2 below)
- Per-meal special instructions (open item #3 below)
- Per-meal child pricing (open item #4 below)
- Per-room breakfast totals when rooms have different guest counts (already supported — see `§Open Items #1`)
- In-room intercom ordering of breakfast (separate quick-request entry, filed but not in this feature)

---

## Data Model

### Settings: `settings/breakfastConfig`

The existing config is extended. New fields are additive; legacy fields (`ratePerPersonPerNight`, `breakfastIncludesChildrenDefault`) are removed at the same time as the create-path cleanup.

```
BreakfastConfig {
  isEnabled: boolean                       // kills the entire feature when false
  cutoffTime: string                       // "HH:MM" 24h, default "20:00"
  cutoffTimezone: string                   // IANA, defaults to hotel config timezone
  frontDeskOverrideEnabled: boolean        // if false, staff cannot override the cut-off
  defaultMealInstructions: string          // shown in Step 2 + Manage Booking + booking review
  meals: BreakfastMeal[]                   // replaces `silogItems`
  updatedAt: Timestamp
  updatedBy: string                        // staff UID
}

BreakfastMeal {
  id: string                               // kebab-case key, unique, immutable once used
  name: string                             // display name
  description: string                      // optional marketing copy, max 200 chars
  price: number                            // PHP, >= 0; "no longer offered" still shows the price as snapshot
  isActive: boolean                        // false = hidden from new orders, still shown on existing bookings
  displayOrder: number                     // asc, for the meal picker
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**Delete rule:** a meal with `isActive: false` cannot be reactivated to a different `price` if any `bookings/*` snapshot references it (the snapshot keeps the original price). A meal can be `isActive: false`'d but not deleted; the meal is hidden from new order UIs and stays visible in the meal catalog as "(inactive)".

**Snapshotting rule (per decision 9):** the meal `id`, `name`, AND `price` are snapshotted onto every order at the moment the guest (or staff) saves the order. The booking never re-reads the catalog for the price.

### Booking: `bookings/{id}`

The current breakfast fields are **replaced** with a richer shape. The `breakfastSelections` key format is preserved (`yyyy-mm-dd-guest-n`) so existing views keep rendering until they migrate.

**Removed fields:**
- `Booking.hasBreakfast: boolean` — gone. Selection is per-guest per-date, not a boolean.
- `Booking.breakfastRate: number` — gone. No flat rate. The meal-level price is in the snapshot.
- `PublicRoomSelection.hasBreakfast: boolean` — gone from Step 1.
- `PublicRoomSelection.breakfastIncludesChildren: boolean` — gone. Children are ordinary slots.

**New + changed fields:**

```
Booking {
  // ... existing fields ...

  // Per breakfast date × guest slot, the snapshotted meal + audit metadata.
  // Same key format as the legacy Record<key, string>: "yyyy-mm-dd-guest-n".
  // Absent on bookings that never had breakfast ordered. Empty `{}` after a full remove.
  breakfastSelections: Record<BreakfastSlotKey, BreakfastSelectionEntry>

  // Per breakfast date × guest slot, the served record. Existing
  // Record<key, boolean> is migrated to Record<key, ServedEntry> at
  // first read. New shape carries audit metadata.
  breakfastServed: Record<BreakfastSlotKey, BreakfastServedEntry>

  // Total breakfast amount (sum of every selection's snapshot price).
  // Mirrors `breakfastSelections` but denormalized for fast total
  // computation in the sidebar + receipt. Always recomputed by the
  // server when `breakfastSelections` is mutated; never written by
  // the client.
  breakfastTotal: number

  // True if at least one breakfast selection exists. Replaces the
  // deleted `hasBreakfast` boolean for read sites that just need "is
  // there any breakfast on this booking".
  hasAnyBreakfast: boolean

  // ... existing fields ...
}

BreakfastSlotKey = `${string}-${number}`   // "2026-10-14-0" — service date (yyyy-mm-dd) + guestIndex

BreakfastSelectionEntry {
  mealId: string                           // snapshot reference
  mealName: string                         // snapshot, may end with " (no longer offered)" when meal is now inactive
  price: number                            // snapshot, PHP
  addedAt: Timestamp
  addedBy: string                          // staff UID or "guest"
  lastModifiedAt: Timestamp
  lastModifiedBy: string
  removedAt: Timestamp | null
  removedBy: string | null
  overrideCutoff: boolean                  // true if added/changed/removed after cut-off (staff only)
  overrideReason: string | null            // required when overrideCutoff = true
}

BreakfastServedEntry {
  servedAt: Timestamp
  servedBy: string                         // staff UID
  unservedAt: Timestamp | null             // grace-period un-mark; null if never un-marked
  unservedBy: string | null
}
```

**Guest index convention:** `guestIndex` is `0..numGuests-1` of the booking. For per-room bookings (multi-room reservations), the index is over the **reservation's aggregate guest list** (lead + companions + per-room occupancy), not per-room. See `§Open Items #1` for the cross-room edge case.

**Audit subcollection:** `bookings/{id}/breakfastAudit/{auditId}` — every add/change/remove/serve/unserve/override action writes one entry. The `Array.fanOutWrite` gotcha (`GOTCHAS.md §Firebase`) is avoided by using a subcollection, not an array on the booking doc. The subcollection is read by:
- The booking drawer's "Breakfast" tab (last 20 entries, infinite scroll for older)
- The kitchen list's "Late changes" column (entries with `occurredAfterCutoff: true`)
- Admin Reports → Breakfast (per-action counts per day)

```
BreakfastAuditEntry {
  id: string                               // auto
  action: "add" | "change" | "remove" | "serve" | "unserve" | "override-add" | "override-change" | "override-remove"
  slotKey: BreakfastSlotKey
  mealSnapshot: { mealId, mealName, price } | null   // null on remove/unserve
  actorUid: string                         // staff UID or "guest"
  actorRole: "guest" | "front-desk" | "admin"
  reason: string | null                    // required for any `override-*` action
  occurredAt: Timestamp
  occurredAfterCutoff: boolean             // true if now > cutoffForDate(slotKey.date)
}
```

### Refund subcollection: `bookings/{id}/refunds/{refundId}`

The existing refunds subcollection (CRL-01) is extended with a new `category` field. Existing cancellation refunds carry `category: "cancellation"`. Breakfast-driven refunds carry `category: "breakfast"`. The new `category` is required on all new refund writes; legacy `null` reads default to `"cancellation"` for back-compat.

```
OnsitePayment {
  // ... existing fields ...
  category: "cancellation" | "breakfast"  // NEW — required on new writes, defaults to "cancellation" on legacy null reads
  breakfastRefundContext: {                // NEW — present only when category = "breakfast"
    mealId: string
    slotKey: BreakfastSlotKey
    mealName: string                       // snapshot
    priceSnapshot: number
  } | null
}
```

**No new collection.** The same `OnsitePayment` table carries both cancellation refunds and breakfast refunds. The Reports → Liability tab and the existing Refunds admin view gain a `category` filter.

### Kitchen list: no new collection

The kitchen list is a **derived view** over `bookings/*` + `bookings/*/breakfastAudit/*`. No new Firestore collection. The cut-off "finalized" list is just "every booking with a `breakfastSelections[key]` whose `serviceDate` matches and whose `lastModifiedAt <= cutoffForDate(serviceDate)`". The "late changes" list is "every `breakfastAudit` entry with `occurredAfterCutoff: true` and `slotKey.date = X`". See `§Kitchen List` for the read query.

---

## Admin Settings: `Breakfast & Dining` tab

The existing tab (`admin-app/src/pages/SettingsPage.tsx:2658+`) is extended. No new tab — same `breakfast` Settings entry under the **Guest Experience** sidebar group (per `plan/features/SETTINGS.md §0` SET-SBG-01).

**Existing fields kept:**
- `isEnabled` (master toggle)
- `meals` table (was `silogItems`) — extended with `price`, `description`, `displayOrder` columns. `id` is editable only when no booking references it (lock after first use).

**New fields:**
- `cutoffTime` — HH:MM input, default `20:00`. Inline validation via the shared `clampIntegerInRange` pattern (used for IFH-01.3).
- `cutoffTimezone` — read-only display sourced from `hotel.config.ts` (the existing property timezone). If no timezone is set in `hotel.config.ts`, fall back to `Asia/Manila` and show an inline warning.
- `frontDeskOverrideEnabled` — boolean. When false, staff cannot override the cut-off (defensive setting for hotels that want a strict policy).
- `defaultMealInstructions` — multi-line text shown to guests in Step 2, Manage Booking, and the booking review ("Order by 8:00 PM the evening before your breakfast date.").

**New table columns on `meals`:**
- `price` (PHP, 0..10,000, two decimal places)
- `description` (optional, 200-char max)
- `displayOrder` (numeric, asc, drag-to-reorder)
- `isActive` toggle (existing) — deactivating hides from new orders but keeps existing snapshots visible
- Status pill for `isActive: false`: "Inactive" (red), with a tooltip showing how many bookings still reference this meal

**Cutoff-change audit:** when an admin changes `cutoffTime`, write a `breakfastConfigChangeLog` subcollection entry (or reuse the existing settings audit pattern). The new cut-off applies to breakfast dates that have not yet been finalized; already-finalized dates (i.e. the current local-time `now > cutoffForDate(date)`) are NOT auto-reopened. Staff can manually reopen a date via the kitchen list page if needed.

**Save flow:** uses the existing `SaveActionFooter` + `SaveActionButton` pattern. Save is disabled when the cut-off time is malformed or any meal row fails inline validation. Server is the authoritative gate (per GOTCHAS — client-side validation is a UX hint only).

---

## Guest flow — Initial booking (Step 2)

**Step 1 changes** (the public flow at `guest-app/src/pages/BookingPage.tsx`):
- The "Room + Breakfast" toggle is **removed**.
- The `PublicRoomSelection.hasBreakfast` and `breakfastIncludesChildren` fields are removed from the create payload.
- The Step 1 sidebar shows only the room subtotal + tax + (existing) discounts; no breakfast line.

**Step 2 changes:**
- A new **"Breakfast"** section is appended after the existing room-and-dates section, before the "Guest details" section.
- The section renders **only when** `settings/breakfastConfig.isEnabled` is true.
- For each breakfast date in the stay (auto-derived from `checkIn → checkOut` — see `§Open Items #1` for the date count rule), the section shows a row of guest slots:
  ```
  Oct 14 (Tue) — Order by Oct 13, 8:00 PM
    Guest 1 (Adult)        [ Select meal ▾ ]
    Guest 2 (Adult)        [ Select meal ▾ ]
    Child 1 (age 7)        [ Select meal ▾ ]
  Oct 15 (Wed) — Order by Oct 14, 8:00 PM
    ...
  ```
- Each slot is a dropdown of `meals[]` where `isActive = true`, sorted by `displayOrder`. The dropdown placeholder reads "No meal — skip breakfast for this guest on this day". Selecting "skip" leaves the slot empty (no `breakfastSelections[key]` entry).
- The cut-off countdown per date: if `now > cutoffForDate(date)`, the row is rendered as locked ("Ordering closed") and the dropdown is disabled. The lock state is computed by the server-rendered `bookingConfig.publicView` payload, not by the client clock.
- The sidebar updates live:
  ```
  Room subtotal                          ₱ 6,000.00
  Extra bed (1 × ₱500 × 2 nights)        ₱ 1,000.00
  ─────────────────────────────────────────────────
  Breakfast (Oct 14, 2 meals)            ₱   700.00
  Breakfast (Oct 15, 1 meal)             ₱   350.00
  Breakfast (Oct 16, 3 meals)            ₱ 1,050.00
  ─────────────────────────────────────────────────
  Subtotal                               ₱ 9,100.00
  Senior/PWD (20% off room + breakfast)  −₱ 1,500.00
  Voucher (WELCOME10, 10% off subtotal)  −₱   910.00
  Total                                  ₱ 6,690.00
  ```
- Discounts apply per the **discount scope matrix** (`plan/features/SETTINGS.md §4`): if "Senior/PWD includes breakfast" is on (the default), the 20% off applies to the breakfast subtotal too; if off, only the room subtotal gets the discount. Same for voucher + member + corporate.
- The "No meal — skip" choice is FREE and explicit in the dropdown (placeholder text), but the underlying data is "no entry" — not a ₱0 entry.

**Step 3 (review):** the existing review page gains the breakfast section, rendered from `breakfastSelections`. Total matches the sidebar exactly. The cutoff countdown per date is also shown here.

**Step 4 (confirmation):** the confirmation page + email render the breakfast section. See `§Email / PDF / Receipt`.

**Walk-in flow parity:** the admin walk-in modal at `BookingsPage.tsx` (and `CalendarPage.tsx`'s create modal) gains the same breakfast section, populated from the same `meals` catalog. The staff entry is `addedBy: staffUid`, `actorRole: "front-desk"`, and never needs the "override" reason at creation time (it's not yet a cut-off violation at the moment of walk-in creation).

**Corporate flow parity:** the corporate flow at `guest-app/src/pages/CorporateBookingPage.tsx` follows the same Step 2 + Step 3 shape. The corporate rate + access-code flow is unchanged; only the breakfast add-on is added.

---

## Guest flow — Manage Booking

**Entry point:** a "Manage Breakfast" link on the existing `/my-booking` (lookup) result card, below the existing booking summary. The link is gated on `booking.status` being one of `confirmed | payment-confirmed | checked-in` (a checked-out booking cannot have its breakfast edited; see `§Open Items #6`).

**Route:** `guest-app/src/pages/ManageBreakfastPage.tsx` (new file) at `/my-booking/breakfast?ref={bookingRef}&token={lookupToken}`. Reuses the same magic-link auth as the lookup page (decision H2, `lookupToken`).

**Layout:**
- Header: booking ref, check-in / check-out, current balance
- Per-date sections (same shape as Step 2 — date label, cut-off countdown, per-guest meal dropdown)
- Locked dates show the "Ordering closed" label and disable the dropdown
- Removed/served meals show a struck-through "Served" or "Removed" badge and are not editable
- The current balance updates live in the header (`balance = originalTotalPrice + breakfastTotal - paidAmount` — see `§Open Items #7` for the exact formula)
- A "Save changes" button at the bottom is disabled when nothing changed; on click, the page sends a single batched `POST /api/bookings/breakfast/update` (or `PATCH` — TBD) with the new selections

**Locking rules:**
- A date is locked when `now > cutoffForDate(date)` (server-side check, server returns the cutoff state on page render)
- A slot is locked when its `breakfastServed[key]` is present
- A slot is locked when the booking is `checked-out` (caller is redirected to the lookup page)

**Removal semantics:**
- Removing an unpaid meal: the `breakfastTotal` decreases; the balance updates immediately
- Removing a paid meal: the meal is removed from `breakfastSelections`; a `bookings/{id}/refunds/{refundId}` entry is created with `category: "breakfast"`, `status: "pending"`, `type: "refund"`, `amount: -priceSnapshot`; the booking's `paidAmount` is unchanged (the refund is a liability, not a debit). The guest sees "Refund due: ₱350" in the manage page header and on the lookup page.

**Save batch:** a single update call sends `{ add: [...], change: [...], remove: [...] }`. The server validates each entry against the cut-off + served state, then writes `breakfastSelections` + `breakfastTotal` + audit entries + (if any) refund liability entries in a single Firestore transaction.

**Email:** no email is sent on save (per client decision). The guest sees the change reflected on the page + on the next lookup.

**Cutoff-countdown copy** (per the design discussion):
- `> 24h` away: "Order by Oct 13, 8:00 PM"
- `< 24h` away: "Ordering closes in X hours Y minutes"
- `= 0` (locked): "Ordering closed"

---

## Staff flow

### Booking drawer (admin)

The "Breakfast" tab in `BookingDrawerWorkspace.tsx` (existing section, currently a list of selections + the served toggle) is rewritten. New shape:

- **Header:** total breakfast amount, count of selections, last-modified timestamp, "Manage meals" button
- **Per-date section** (same layout as the guest manage page): date label, cut-off countdown, per-guest meal dropdown
- **Override affordance:** when the date is locked (cutoff passed), the dropdowns are still enabled but show a red warning banner: "Cut-off has passed. Continuing will mark this as a late order/change for the kitchen and is logged."
- **Override modal:** when a staff member changes a meal on a locked date, a confirmation modal requires a **reason** (free text, required, min 5 chars). The reason is written to the audit entry and the kitchen list's "Late changes" column.
- **Served toggle:** existing BSP-01 toggle per slot. New: served entries record `servedBy` + `servedAt`. A "Un-mark served" action exists for the configurable grace window (see `§Open Items #5`); after the grace window, the toggle is disabled and the only way to "un-serve" is via a new "Override serve" action that requires a reason.
- **Refunds action:** when removing a paid meal, the staff sees a "Refund liability" panel: "₱350 refund due — recorded by {staff} on {date} — [Mark as paid]". "Mark as paid" records the actual refund against the existing refunds subcollection with the same idempotency rules as the existing `handleAddRefund`.

### Walk-in / calendar-create

The existing walk-in modal at `BookingsPage.tsx` and the calendar-create modal at `CalendarPage.tsx` gain the breakfast section, identical to the booking drawer's per-date section. Cut-off warnings still apply (a walk-in for "tonight" with "breakfast tomorrow" will show the cut-off as passed; staff adds with override).

### Refunds page (admin)

The existing refunds view (rendered from `bookings/*/refunds/*` and `reservations/*/refunds/*`) gains a `category` filter chip ("Cancellation" / "Breakfast" / "All"). The default is "All". A new pending-refunds badge on the dashboard's left nav shows the count of `category: "breakfast"` refunds with `status: "pending"`. "Mark as paid" is the same action as for cancellation refunds.

### Kitchen list (admin)

A new admin page at `admin-app/src/pages/KitchenListPage.tsx`, route `/admin/kitchen-list` (under the dashboard's "Operations" section). Two views, accessible via a tab toggle:

**View 1: "Tomorrow's prep" (default)**
- Default date = `tomorrow` in hotel timezone
- Date selector (date picker, can pick any future date with non-empty `breakfastSelections` for that date)
- Two-column layout:
  - Left: "Finalized at 8 PM" — all `breakfastSelections[date-*]` whose `lastModifiedAt <= cutoffForDate(date)`, grouped by meal name with total count + per-guest detail (room number, guest name). Click a meal to expand the per-guest list.
  - Right: "Late changes" — all `breakfastAudit` entries with `slotKey.date = date` AND `occurredAfterCutoff: true`, sorted by `occurredAt` desc. Each entry shows: room number, guest name, action (added/changed/removed), meal snapshot. An "Acknowledge" button per entry; clicking marks the entry as acknowledged by the kitchen (writes a `breakfastAudit/{id}.acknowledgedAt` field — same doc, not a new entry).
- Print button: opens a printable view (`/admin/kitchen-list/print?date=...`) that renders the same data in a printer-friendly layout with no nav.
- The "Finalized at 8 PM" count is preserved as a `finalizedAt` snapshot on the audit entry when the cut-off passes; the count is recomputed live from `breakfastSelections` so any change after the cut-off is reflected in the "Late changes" column, not in the "Finalized" count.

**View 2: "Today"**
- Same shape as View 1 but `date = today` in hotel timezone. Cut-off is always passed; everything is "Late changes".

**Permissions:** `front-desk` and `admin` roles can view + acknowledge. No "kitchen" role today; the page is shared with the front desk.

---

## Server API surface

All new routes go through the existing catch-all (`guest-app/api/[...route].js` per `GOTCHAS.md §npm Workspaces`). The Hobby plan's 12-function cap is unchanged — every new route is a new handler in the existing `apiRouter.ts` dispatch, not a new Vercel function. See `plan/docs/VERCEL-FUNCTION-LIMIT.md`.

| Method | Route | Purpose | Auth | Notes |
|---|---|---|---|---|
| `GET` | `/api/bookings/breakfast/config` | Public breakfast config (meals, cut-off, instructions) for the Step 2 + Manage Booking UI | None | Rate-limited per IP; cached 60s |
| `GET` | `/api/bookings/breakfast/manage?ref=...&token=...` | Load the booking's current breakfast state for the Manage Breakfast page | Lookup token (H2) | Returns `breakfastSelections` + `breakfastServed` + `breakfastTotal` + per-date cutoff state |
| `POST` | `/api/bookings/breakfast/update` | Save add/change/remove batch from Manage Breakfast | Lookup token | Validates cutoff server-side; creates refund liabilities for paid removals; writes audit entries; updates `breakfastTotal`; idempotent on `clientBatchId` |
| `POST` | `/api/bookings/breakfast/staff-update` | Staff add/change/remove with optional override | Staff (front-desk or admin) | Same body as guest update; adds `overrideCutoff: bool` + `overrideReason: string`; if `overrideCutoff = true`, `overrideReason` is required and `min length 5`; if `frontDeskOverrideEnabled` is false, override is rejected with 403 |
| `POST` | `/api/bookings/breakfast/mark-served` | Mark a meal as served or un-served | Staff | Un-serve is allowed only within the grace window (see `§Open Items #5`); beyond the window, requires an override reason |
| `GET` | `/api/bookings/breakfast/kitchen-list?date=YYYY-MM-DD` | Kitchen list view data | Staff | Returns finalized + late-changes per `§Kitchen List`; cached 30s |

All routes are **Turnstile-gated** where they mutate state (per `plan/docs/SECURITY.md` — booking creation already Turnstile-gated; breakfast updates are sub-actions of an existing booking, so the same gate applies to the lookup-token and staff-token paths). The `mark-served` and `kitchen-list` read-only routes are not Turnstile-gated (rate-limited only).

**Idempotency:** every write route accepts an optional `clientBatchId: string` and rejects re-fires within a 60-second window with the same response. Same pattern as the existing booking-create idempotency.

**Cutoff calculation helper:** a new shared helper `computeBreakfastCutoffState({ serviceDate, now, cutoffTime, timezone })` in `shared/utils/breakfastCutoff.ts` returns `{ isLocked, minutesUntilCutoff, countdownCopy }`. The server uses this on every breakfast write to decide whether to accept. The client uses the same helper (exported from `@spark-inn/shared`) for the per-date countdown display, but the server is the authoritative gate.

---

## Email / PDF / Receipt

The 8 W4.4 audit-extension email templates (per `plan/features/EMAIL-AUDIT-EXTENSIONS.md`) and the existing `buildReservationEmailView` (`shared/utils/emailView.ts`) are extended to render the new breakfast model. The shape of the existing `breakfastSelections: Record<key, string>` view becomes a `breakfastSelections: Record<key, { mealName, price, ... }>` view. Email templates that previously rendered the meal name from the string value now render `mealName` from the entry object.

**No new email templates.** The `staff-new-booking` + `staff-new-payment` + `guest-booking-confirmed` + `guest-booking-lookup` templates all render the same `breakfast` block; the block is the only thing that changes shape.

**PDF receipt:** the print-to-PDF receipt at `BookingDrawerWorkspace.tsx` (the "Print receipt" action) gains the same breakfast block, rendered from the new shape.

**Reports:** `ReportsPage.tsx` gains a "Breakfast" tab under the Sales section. Counts: total breakfast selections, total breakfast revenue, top meals (by count), late-change count (audit entries with `occurredAfterCutoff: true`), pending-refund liability total.

---

## Edge cases

1. **A multi-room reservation with different per-room guest counts** — the `guestIndex` in the `BreakfastSlotKey` is over the **reservation's aggregate guest list** (lead + companions + per-room occupancy, in MRB-07's order). Step 2 + Manage Booking show the same per-slot grid regardless of which room the guest is assigned to. The kitchen list prints one row per guest, not per room.
2. **Booking modification that changes dates (reschedule / add-room / remove-room)** — per `MRB-10..14`. The existing `handleRescheduleBooking` recomputes the rate breakdown; the breakfast logic must add a step: any `breakfastSelections[date-*]` whose date falls outside the new date range is auto-cancelled; for paid removals, a refund liability is opened; for unpaid removals, the `breakfastTotal` decreases. New dates in the range get a fresh date block in the manage page (the guest can order).
3. **Cancellation of a confirmed booking** — per `CRL-02`. The existing cancel handler must add a step: any unpaid `breakfastSelections` for future dates is dropped; any paid selections for future dates generate refund liabilities with `category: "breakfast"`. Past-date selections are not refunded.
4. **Walk-in at 9 PM for a 1-night stay** — the front desk can add breakfast for tomorrow's date (it IS the next day, so the cutoff is `tonight 8 PM` — already passed) with an override reason. The kitchen list picks up the late change. Same-day (tonight) breakfast is technically allowed if the staff adds it before tonight's actual breakfast service; the cut-off rule applies to **tomorrow's** date, not tonight's.
5. **Same-day walk-in via staff** — the staff UI allows this; the guest Manage Booking page does not. The Step 2 form is rendered only for future-dated bookings; a walk-in for tonight does not get a breakfast section in the create flow (the cut-off is already past); staff can add breakfast from the booking drawer after creation.
6. **Pre-paid booking from a voucher / promo** — the breakfast total reduces the voucher-eligible subtotal per the discount scope matrix. The voucher is applied to the post-breakfast subtotal. The discount scope matrix (`plan/features/SETTINGS.md §4`) is the single source of truth.
7. **Children sharing a meal with an adult** — not supported. Each guest/date slot is a single meal; two children cannot share one meal. The dropdown is per-guest, not per-meal.
8. **A meal that's now `isActive: false` but is snapshotted on existing bookings** — the booking view appends "(no longer offered)" to the meal name. The price is the snapshot price. The guest can still see the meal on the manage page, can remove it, but cannot change it to a different meal that's also inactive (only to active meals or skip).
9. **Cutoff timezone change after a guest has ordered** — the guest's existing `cutoffForDate` was computed at order time using the THEN-current cut-off; the new timezone applies to all FUTURE cuts for the same booking. (No re-stamping of historical cut-offs.)
10. **A booking that was `confirmed` but the payment is reversed (chargeback)** — the existing LOU flag at `booking.louReceived` is set; the breakfast order is not auto-cancelled (the kitchen still has to feed the guest); the refund liability from any prior remove is unchanged. If the operator wants to cancel the breakfast too, they remove the meals manually with an override reason.
11. **Rate breakdown (`BookingRateBreakdown`)** — the existing rate breakdown helper in `guest-app/server/lib/rate-breakdown.ts` gains a `breakfast` sub-block carrying `{ selections: BreakfastSelectionEntry[], total: number }`. The per-room `rateBreakdown` mirrors this for display in the room's own line; the reservation aggregate uses the same.
12. **The Step 1 / Step 2 split in production today** — Step 1 collects dates + rooms + occupancy; Step 2 collects guest details + extras. The breakfast section goes in Step 2 (per the design discussion). The Step 1 sidebar that previously showed a "Room + Breakfast" total now shows just the room total; the Step 2 sidebar shows the room total + breakfast + discounts.

---

## Open items (still to clarify before implementation)

1. **Breakfast date count for a stay** — confirmed: **N dates for N nights**, breakfast on day of arrival through day of departure morning. Example: check-in Oct 14, check-out Oct 17 (3 nights) → breakfast dates are Oct 14, 15, 16. The cut-off for Oct 14 breakfast is Oct 13 8 PM; the cut-off for Oct 16 is Oct 15 8 PM. **Confirmed by client** but not yet written into the spec — flagging here so it's not lost.
2. **Per-meal dietary flags / allergen tagging** — not in v1. The `description` field on `BreakfastMeal` is free-text; the operator can put "contains nuts" in there. A proper allergen taxonomy is a follow-up.
3. **Per-meal special instructions** — not in v1. A guest who needs "no spicy" puts it in the existing `specialRequests` field on the booking (staff captures it; see `Booking.specialRequests` in TYPES.md). Per-meal special instructions would be a separate field on `BreakfastSelectionEntry`; defer.
4. **Per-meal child pricing** — not in v1. Children pay the same per-meal price as adults. The hotel can add a `childPrice` field on `BreakfastMeal` in a follow-up if needed; out of scope for this feature.
5. **Served-grace window** — how long after a meal is marked served can staff un-mark it? Recommend **15 minutes** (long enough to correct a mistake, short enough to be a real audit trail). Configurable in `BreakfastConfig.servedGraceMinutes` (default 15). If a guest orders a meal, it's marked served, the kitchen hands it to the wrong table, the staff un-serve within 15 minutes — no audit. After 15 minutes, un-serve requires an override reason. **To confirm.**
6. **Editing after checked-out** — recommend: no, the booking is closed. Lookup page shows the breakfast section read-only. A "View only" pill on the manage page if the guest navigates there. **To confirm.**
7. **Balance formula** — the current booking balance is computed from `totalPrice` (rooms + add-ons) + `breakfastTotal` (the new field) - `paidAmount`. The exact formula should live in the existing `computeServerFolioTotals` helper in `shared/utils/bookingFolio.ts` (or a new sibling helper for breakfast). **To confirm during implementation** — should be a one-line change to the existing helper.
8. **The new `breakfastTotal` field is denormalized from `breakfastSelections`** — recomputed by the server on every write. The client never writes it. The server-side recompute happens inside the same Firestore transaction as the `breakfastSelections` update. (Per `GOTCHAS.md §Firebase` — no client-side recompute.)
9. **What if the booking was created before this feature shipped** — there are no such bookings (production is empty per decision 1). If any test data exists, the read path needs to handle the absence of `breakfastSelections` (default to `{}`), `breakfastServed` (default to `{}`), and `breakfastTotal` (default to 0). The legacy `hasBreakfast: boolean` is read as `false`, the legacy `breakfastRate: number` is ignored.
10. **Vercel function budget** — every new route is a handler in the existing catch-all (no new function), per `plan/docs/VERCEL-FUNCTION-LIMIT.md`. The Hobby 12-function cap is unchanged.

---

## Implementation order (proposed tickets)

- **BR-01** — Data model + shared types
  - `BreakfastConfig` (replace `breakfastConfig`), `BreakfastMeal`, `BreakfastSelectionEntry`, `BreakfastServedEntry`, `BreakfastAuditEntry`
  - Update `Booking.breakfast*` shape, remove `hasBreakfast` + `breakfastRate` from `Booking`, remove `hasBreakfast` + `breakfastIncludesChildren` from `PublicRoomSelection`
  - Extend `OnsitePayment.category` + `breakfastRefundContext`
  - New shared helper `computeBreakfastCutoffState` in `shared/utils/breakfastCutoff.ts`
  - New shared helper `recomputeBreakfastTotal` in `shared/utils/breakfastTotal.ts`
  - New Zod schemas in `shared/schemas/booking.ts`
  - Zod-validated `BreakfastConfigSchema`, `BreakfastMealSchema`, `BreakfastSelectionEntrySchema`

- **BR-02** — Admin Settings: extend the existing `breakfast` tab
  - `cutoffTime` + `cutoffTimezone` + `frontDeskOverrideEnabled` + `defaultMealInstructions` inputs
  - Extend `meals` table with `price`, `description`, `displayOrder`, status pill
  - Delete `ratePerPersonPerNight` + `breakfastIncludesChildrenDefault` from the save payload
  - `servedGraceMinutes` input (open item #5)
  - Cutoff-change audit entry writer
  - Server-side validation (the `cutoffTime` HH:MM format + the meal-row validation)

- **BR-03** — Step 1 cleanup + Step 2 breakfast section (public flow)
  - Remove the "Room + Breakfast" toggle from Step 1 of `BookingPage.tsx`
  - Remove `hasBreakfast` + `breakfastIncludesChildren` from `PublicRoomSelection` + the Step 1 create payload
  - New "Breakfast" section in Step 2 with per-date × per-guest meal grid
  - Live sidebar update with breakfast subtotal + per-date breakdown
  - Discount application per the scope matrix
  - Step 3 review + Step 4 confirmation render the new shape
  - Server-side `handleCreateBooking` writes the new `breakfastSelections` + `breakfastTotal`

- **BR-04** — Guest Manage Breakfast page
  - New `ManageBreakfastPage.tsx` at `/my-booking/breakfast`
  - "Manage Breakfast" link on the existing `/my-booking` lookup result
  - Per-date × per-guest meal grid (read + edit)
  - Cutoff countdown per date (locked / countdown / order-by copy)
  - Served badge for already-served slots
  - "Save changes" with batched `POST /api/bookings/breakfast/update`
  - Refund-due banner when removing a paid meal
  - `GET /api/bookings/breakfast/manage` + `POST /api/bookings/breakfast/update` routes
  - Rate-limited + idempotent (clientBatchId)

- **BR-05** — Staff booking-drawer breakfast section
  - Rewrite the existing "Breakfast" tab in `BookingDrawerWorkspace.tsx`
  - Cutoff override modal with required reason
  - Served / un-served actions with the grace-window rule
  - `POST /api/bookings/breakfast/staff-update` + `POST /api/bookings/breakfast/mark-served` routes
  - Walk-in modal + calendar-create modal parity

- **BR-06** — Refund liability + refunds subcollection extension
  - Extend `OnsitePayment` writes with `category: "breakfast"` + `breakfastRefundContext`
  - Server-side refund liability creation on paid-meal removal
  - Refunds page gains `category` filter chip + pending-refunds badge
  - Reports → Liability tab counts pending breakfast refunds
  - Idempotency matches the existing CRL-01 pattern

- **BR-07** — Kitchen list page
  - New `KitchenListPage.tsx` at `/admin/kitchen-list`
  - Date selector + "Finalized" + "Late changes" two-column view
  - Per-meal expand with per-guest detail (room, guest name)
  - Acknowledge button per late change
  - Print-friendly route at `/admin/kitchen-list/print?date=...`
  - `GET /api/bookings/breakfast/kitchen-list?date=...` route
  - Document the follow-up decision: a dedicated real-time kitchen display (option a) ships as a separate ticket only if the printable view is insufficient after a week of use

- **BR-08** — Email / PDF / Receipt / Reports updates
  - Extend `buildReservationEmailView` for the new `breakfastSelections` shape
  - Extend `BookingRateBreakdown.breakfast` sub-block
  - Update the 8 W4.4 audit-extension email templates
  - Update the print-to-PDF receipt
  - Reports → Sales → Breakfast tab (counts, revenue, top meals, late changes, pending refund total)

---

## Files touched (estimate, for ticket sizing)

**Shared:**
- `shared/types/index.ts` — type updates (~50 lines)
- `shared/schemas/booking.ts` — new Zod schemas (~120 lines)
- `shared/utils/breakfastCutoff.ts` — new helper (~60 lines)
- `shared/utils/breakfastTotal.ts` — new helper (~30 lines)
- `shared/utils/bookingAddOns.ts` — replace `calculateBreakfastAddOn` with a per-meal pricing path (~80 lines net)
- `shared/utils/emailView.ts` — extend breakfast block (~30 lines)
- `shared/utils/bookingFolio.ts` — extend balance formula (~20 lines)
- `shared/constants/index.ts` — remove `DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT`, add `DEFAULT_BREAKFAST_CUTOFF_TIME = "20:00"`, `DEFAULT_SERVED_GRACE_MINUTES = 15`

**Guest app:**
- `src/pages/BookingPage.tsx` — remove Step 1 toggle, add Step 2 section (~200 lines net)
- `src/pages/BookingConfirmPage.tsx` — render new shape (~30 lines)
- `src/pages/BookingLookupPage.tsx` — add "Manage Breakfast" link, render new shape (~50 lines)
- `src/pages/ManageBreakfastPage.tsx` — NEW (~400 lines)
- `src/pages/CorporateBookingPage.tsx` — Step 2 parity (~150 lines)
- `server/apiRouter.ts` — register 6 new routes (~50 lines)
- `server/handlers/bookings.ts` — `handleCreateBooking` writes new shape; add `handleUpdateBreakfast` + `handleStaffUpdateBreakfast` + `handleMarkBreakfastServed` + `handleGetBreakfastManage` + `handleGetKitchenList` (~600 lines net)
- `server/handlers/email.ts` — extend email view (~20 lines)
- `server/lib/rate-breakdown.ts` — extend breakdown helper (~30 lines)
- New tests: `tests/api/breakfast-*.test.ts` (8 files, ~1200 lines)

**Admin app:**
- `src/pages/SettingsPage.tsx` — extend the `breakfast` tab (~400 lines)
- `src/pages/BookingDrawerWorkspace.tsx` — rewrite the breakfast section (~300 lines)
- `src/pages/BookingsPage.tsx` — extend walk-in modal (~100 lines)
- `src/pages/CalendarPage.tsx` — extend calendar-create modal (~100 lines)
- `src/pages/KitchenListPage.tsx` — NEW (~400 lines)
- `src/pages/ReportsPage.tsx` — new "Breakfast" tab (~150 lines)
- `src/context/AdminContext.tsx` — extend settings hydration + new subscriptions (~80 lines)
- New tests: `src/__tests__/breakfast-*.test.ts` (6 files, ~800 lines)

**Firebase:**
- `firebase/firestore.rules` — extend `settings/breakfastConfig` write allow + add `bookings/*/breakfastAudit/*` rules + extend `bookings/*/refunds/*` rules to allow `category: "breakfast"` writes (already allow all, but pin the new fields)
- `firebase/firestore.indexes.json` — add a composite index for the kitchen list query (`bookings where status in (...) and hasAnyBreakfast == true` + a `breakfastAudit where occurredAfterCutoff == true and slotKey.date == X` index)

**MDs (this PR):**
- `plan/features/BREAKFAST.md` — THIS SPEC
- `plan/project/ROADMAP.md` — BR-01..BR-08 row under a new "Phase 13 — Breakfast Redesign" section
- `plan/docs/DECISIONS-FEATURES.md` — single decision record for the redesign (the 10 client decisions + the 10 design-decisions are condensed to a "Phase 13 brief" decision entry)
- `plan/features/SETTINGS.md` — extend §Breakfast & Dining
- `plan/features/BOOKING-FLOW.md` — note the Step 1 simplification + the Step 2 new section
- `plan/features/EMAIL-PDF-STORAGE.md` — note the breakfast-shape change in the view
- `plan/features/BOOKINGS-MANAGEMENT.md` — note the breakfast-drawer rewrite

**Estimated scope:** ~3,500–4,500 lines of new code + ~2,000 lines of new tests + 8 tickets of ~3–5 days each (sequential, with the shared types + Settings first). Realistic solo-dev timeline: **6–8 weeks** end-to-end, with the printable kitchen list as the v1 cut-off and the dedicated kitchen display as a follow-up.

---

## Migration

**No migration needed** (per decision 1 — production has zero bookings). The legacy fields (`hasBreakfast`, `breakfastRate`, `breakfastIncludesChildren`, `ratePerPersonPerNight`, `breakfastIncludesChildrenDefault`) are **deleted** from the create path + the Settings save payload + the type definitions in the same PR that introduces the new shape. Test data created under the old shape in the staging env is recreated from scratch under the new shape on the next reset (the ETR sweep already drops + reseeds `bookings/*`).

The client should confirm at deploy time that no production bookings predate this PR. If any do, the read paths must default the new fields to `{}` / `0` / `false` (the open item #9 fallback).

---

## Open decisions pending client

(All non-blocking for the spec; the implementation team will need answers before the corresponding ticket ships.)

| # | Decision | Default if no answer |
|---|---|---|
| 1 | Breakfast date count for a stay | N nights → N dates (Oct 14–16 for an Oct 14–17 stay) |
| 2 | Per-meal dietary / allergen flags | Free-text `description` field only |
| 3 | Per-meal special instructions | Use the existing `booking.specialRequests` field |
| 4 | Per-meal child pricing | Same as adult |
| 5 | Served-grace window | 15 minutes, configurable |
| 6 | Editing after checked-out | Read-only |
| 7 | Balance formula | `totalPrice + breakfastTotal - paidAmount` (extend the existing `computeServerFolioTotals`) |
| 8 | `breakfastTotal` is server-recomputed | Yes, never client-written |
| 9 | Legacy booking fallback | `{}` / `0` / `false` defaults; no data |
| 10 | New routes are handlers in the catch-all | Yes, per `VERCEL-FUNCTION-LIMIT.md` |
