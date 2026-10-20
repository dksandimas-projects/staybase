# Other Add-Ons (Phase 14 — BR-12)

> Per-phase feature spec for the BR-12 add-on catalog. v1 ships **airport transfer** as the first non-breakfast add-on. The data model is intentionally flexible so the BR-13 refactor (when a second add-on **type** — e.g. seaport — lands) is a non-breaking refactor, not a rewrite.

**Owner-requested.** Shipped on `feature/br-12-other-add-ons`, v2.2.0 → v2.3.0 (`feat:` MINOR via Husky Conventional-Commits hook).

> Requires: `plan/docs/BACKEND.md` (Firestore schema for `bookings/{id}/otherAddOnSelections`, `bookings/{id}/otherAddOnServed`, `bookings/{id}/otherAddOnAudit`, `addOns/{addOnId}`); `plan/docs/TYPES.md` (`AddOn`, `OtherAddOnSelectionEntry`, `OtherAddOnAuditEntry`, `OtherAddOnRefundContext`, additive `Booking` extensions); `plan/docs/API-ROUTES.md` (catch-all dispatcher pattern for the 6 new routes — no new Vercel function); `plan/docs/SECURITY.md` (Turnstile + rate-limit + STAFF-Token gates); `plan/docs/VERCEL-FUNCTION-LIMIT.md` (Hobby-plan 12-function cap — all 6 new routes stay in the catch-all dispatcher); `plan/features/BREAKFAST.md` (the blueprint — every BR-12 helper + schema mirrors the BR-01/BR-04/BR-05 shape).

---

## Decisions Locked

1. **Per-add-on `cutoffHoursBeforeCheckIn`** — every add-on has its own lead window (default 24h). NO hotel-wide `otherAddOnCutoffsEnabled` toggle for v1 (BR-13 may add it). The per-add-on `isEnabled` switch is the only cut-off-adjacent toggle for now.

2. **Additive `Booking` fields** — `otherAddOnSelections`, `otherAddOnTotal`, `hasAnyOtherAddOns`. NO mutation of the BR-08 frozen breakfast fields.

3. **Per-day × per-add-on `quantity`** — NOT a per-day × per-guest slot (that's breakfast). Each entry's `quantity` defaults to the booking's total guest count, editable 0..guest count.

4. **Separate Firestore collection `addOns/{addOnId}`** — NOT a sub-field of `breakfastConfig`. The new admin Settings tab manages the catalog. Pre-seeded with "Airport transfer" on first load if empty.

5. **Unified `markRefundPaid` helper gains the `"otherAddOn"` category** — the BR-06 helper now handles three categories (`"cancellation"`, `"breakfast"`, `"otherAddOn"`), on the same UPDATE-existing-pending-entry path; the audit row lands in `otherAddOnAudit`.

6. **No generic-add-on abstract base class** — premature abstraction is rejected per design. The BR-13 refactor will pull common patterns from the two add-on paths when the second **type** lands, without forcing a v1 schema migration.

7. **Zero new Vercel functions** — the 6 new routes register in the existing catch-all `apiRouter.ts` (the Hobby-plan 12-function cap stays).

8. **No kitchen list for other add-ons** — add-ons are "served at check-in / by-arrival". The `mark-served` action stamps `otherAddOnServed` + `otherAddOnAudit` for the drawer badge + receipt, but no printable list view ships in v1.

---

## Data Model

### New collection `addOns/{addOnId}` (admin-managed catalog)

```ts
interface AddOn {
  id: string;                             // doc id; kebab-case
  name: string;                           // e.g. "Airport transfer"
  description: string;                    // marketing copy
  price: number;                          // PHP; >= 0; snapshotted at order time
  unit: "per-person" | "per-stay";        // v1 ships per-person only
  isEnabled: boolean;                     // per-add-on master switch
  cutoffHoursBeforeCheckIn: number;       // default 24
  displayOrder: number;                   // asc
  updatedAt: Timestamp | string;
  updatedBy: string;                      // staff UID
}
```

**Firestore rules (OCT-C3, 2026-10-20; decision #279) — REQUIRED.**
The admin Settings tab reads and writes this collection **directly from the browser** through the Firestore client SDK, so the collection is subject to the security rules. It MUST have a rule block:

```
match /addOns/{addOnId} {
  allow read: if isStaff();
  allow create, update, delete: if isAdmin();
}
```

The guest app never reads this collection directly — the public catalog goes through `GET /api/bookings/addons/config` (Admin SDK, rules not applied) — so **no public read** is granted.

The collection shipped in BR-12 (2026-10-15) **without** a rule block. Firestore denies unmatched paths by default, so every admin read + write failed with `PERMISSION_DENIED`, and because each error was swallowed the tab rendered its "No add-ons yet" empty state: the hotel could not see, price, enable/disable, create or delete any other add-on, while the guest path kept selling the read-only pre-seed. The same commit introduced the top-level `auditLogs` collection, which likewise needed a rule block (admin read, staff create, append-only).

**Price authority (OCT-C2, 2026-10-20; decision #278) — the SERVER owns the snapshot.**
`nameSnapshot`, `priceSnapshot`, `unitSnapshot` and `cutoffHoursBeforeCheckInSnapshot` on a selection entry are a snapshot of the **live `addOns` catalog** taken when the order is placed. They are **never** read from the request body. The wire fields are accepted-and-ignored (so a cached guest bundle keeps working) and are documented as ADVISORY ONLY.

Rationale: the add op read `op.priceSnapshot ?? liveAddOn.price` — the `??` fallback was DEAD CODE because the client always sends the field, so a guest could buy a ₱500 airport transfer for ₱1 and the tampered price was snapshotted permanently. The same op preferred the client's `cutoffHoursBeforeCheckInSnapshot` — the lock window — so a client could widen its own cut-off to 168 hours.

A **CHANGE** op may only alter the `quantity`. The name / price / unit stay the entry's EXISTING snapshot: the guest keeps the price they ordered at even if the admin changes the catalog price afterwards. A **NEW** order takes the current catalog price.

**Walk-in parity (OCT-C5, 2026-10-20; decision #281).** A walk-in booking rebuilds the desk's selected add-ons from the live catalog (read inside the transaction, before any write) and persists them + `otherAddOnTotal` + `hasAnyOtherAddOns` on the booking doc. The catalog falls back to the read-only `AIRPORT_TRANSFER_PRESEED` when the collection is empty, so the walk-in grid (which renders from the public config endpoint) and the server validation always agree. A disabled add-on is refused with a 400.

**Guest booking parity (OCT-M4, 2026-10-20; decision #297).** The GUEST booking flow now has the Step 2 grid this spec always described. Before it, `BookingPage.tsx` contained ZERO occurrences of "otherAddOn" — a guest could not order an airport transfer at booking time at all, so the headline BR-12 flow was unreachable and other add-ons were only purchasable post-booking at `/my-booking/addons`.

- **The grid** renders below `renderBreakfastSection`: one card per enabled add-on × one quantity input per service date, clamped to the guest count. The quantity is PER DAY × PER ADD-ON (decision 3 above) — NOT the per-guest × per-date slot shape breakfast uses. The catalog comes from the PUBLIC endpoint `GET /api/bookings/addons/config`; the guest app never reads the `addOns` collection directly. The section renders NOTHING when the catalog is empty or the hotel has taken other add-ons off sale (OCT-M1 below) — an empty grid under a heading reads as a broken page.
- **The BR-10 dual-button pattern covers the UNION.** The CTA's count is the breakfast slots + the other-add-on rows, the figure is `breakfastTotal + otherAddOnTotal`. The "without add-ons" branch means "without add-ons of ANY kind".
- **The create path rebuilds from the live catalog** (the OCT-C2 price authority), refuses an add-on that is not on sale with a 400, clamps the quantity, and writes `otherAddOnSelections` + `otherAddOnTotal` + `hasAnyOtherAddOns` — the SAME additive fields the walk-in path writes.
- **The other add-ons are NOT inside `totalPrice`** (decision 2 above) — they are added on top of it for the balance, exactly like the walk-in and the post-booking purchase. The grid says so in one line so the guest is not surprised the transfer is not on the online room bill.

**Hotel-wide master switch (OCT-M1, 2026-10-20; decision #295).** The Settings → Other Add-Ons tab's hotel-wide "Add-ons enabled" toggle is now REAL: it persists to `settings/hotelConfig.otherAddOnsEnabled` and is read by `guest-app/server/lib/otherAddOns-settings.ts` (the single reader). When off, the public catalog endpoint returns an EMPTY catalog + `otherAddOnsEnabled: false` (so the guest Step 2 grid disappears and the staff drawer has nothing to add from), the guest Manage page shows an empty catalog, and the guest save path refuses the order with a 400 — without that last gate the catalog would be hidden but a direct POST could still buy one. The STAFF path stays open on purpose: the front desk recording an add-on a guest asked for at the desk is an operational override.

**Only an explicit `false` disables the catalog.** A settings doc written before OCT-M1 has no `otherAddOnsEnabled` field and hydrates to `true`, so a hotel's revenue stream is never silently switched off by a missing field.

### Cut-off anchor (OCT-M5, 2026-10-20; decision #292)

The cut-off is `cutoffHoursBeforeCheckIn` hours before the **BOOKING's check-in date** — for EVERY service date, not the selection's own date. The old code anchored on the selection's service date, so the lock slid forward one day per row and the guest could buy a transfer a full day past the stated cut-off. The Manage page had the SAME wrong anchor, so it showed the same wrong lock state.

`AssertNotLockedInput.checkInDate` is now **REQUIRED** and the `checkInDate || parsed.date` fallback is deleted, so the compiler forces every caller to pass the booking's check-in. A booking with no usable check-in is refused (`BOOKING_CHECK_IN_MISSING`) rather than silently defaulted.

### Read-only bookings (OCT-M3, 2026-10-20; decision #291)

A `checked-out` or `cancelled` booking is NOT editable — the guest save path, the staff add/remove path and the mark-served path all refuse it through ONE shared rule (`isOtherAddOnBookingMutable`), so the three can never drift apart. `checked-in` stays mutable: a guest can still buy a transfer on arrival.

### The other add-ons are part of the BALANCE (OCT-FOL-01, 2026-10-20; decision #298)

Decision 2 above says the other add-ons are "added on top of it [the room bill] for the balance". The implementation now matches that sentence literally:

```
folio grand total = booking.totalPrice   // the room bill (breakfast + extra bed included)
                   + otherAddOnTotal     // ← BR-12 other add-ons (NOT inside totalPrice)
                   + storeTotal          // add-to-bill store orders
                   + chargesTotal        // incidental charges
folio balance     = grand total − paymentsTotal
```

`computeBookingFolio` (admin) + `computeServerFolioTotals` (server) both take an optional `otherAddOnTotal` and add the term. For a multi-room reservation the value is the SUM of the children's — the same shape as the reservation header's `totalPrice`.

**Before this the balance ignored the add-ons entirely.** A booking with a ₱2,000 airport transfer the guest had not paid for showed a **₱0 balance** — the hotel was owed the money and every balance surface said the guest was settled. The guest's own Manage page had always computed it correctly, so the guest and the desk disagreed about the same booking.

**What now includes them:** the admin drawer folio, the receipt PDF, the verify-payment / confirm-with-balance / checkout paths, the admin table's payment-state filter, and the Reports → Receivables + Collections balances.

**Two changes keep the numbers from contradicting each other:** the payment-state filter now uses the FOLIO's denominator (`folio.grandTotal`) instead of `booking.totalPrice` (already inconsistent about store + incidental charges; with the add-ons it would have called a booking with an unpaid transfer "paid" while the drawer showed a balance); and the folio breakdown + receipt PDF **itemise** an "Other add-ons" line so the lines add up to the total beneath them (the receipt's "Folio Charges" section now also prints for a booking that has only other add-ons).

**What deliberately still shows the ROOM BILL:** the bookings table's "Total" column + the reservation "due" pill (they show what was BOOKED online, and MRB-12 decision #179 pins the reservation row's balance to `header.totalPrice − paidAmount` so a filtered child cannot drop from the total); the `fullyPaid` transition in the payment handlers (that settles the ROOM bill, consistently with the store + incidental charges); and the guest booking email's "Total Amount Due" (the amount payable ONLINE — the other add-ons are settled at the property, and the guest's Manage page is where that balance lives).

### Booking extensions (additive — BR-08 breakfast fields FROZEN)

```ts
interface Booking {
  // ... existing fields (frozen from BR-08) ...

  /**
   * `yyyy-mm-dd` → `OtherAddOnSelectionEntry[]`. Absent on
   * pre-BR-12 bookings; reads as `null` per `normalizeBooking`.
   */
  otherAddOnSelections?: Record<string, OtherAddOnSelectionEntry[]> | null;
  /**
   * Denormalized sum, PHP. Recomputed by `recomputeOtherAddOnTotal`.
   *
   * Per OCT-L3 (2026-10-20, decision #301): stored at **2 decimal
   * places**, the same rule every other money path in the repo uses
   * (`roundToTwoDecimals`, `shared/utils/money.ts`). It previously
   * rounded to WHOLE PESOS while the refund liability for the same
   * selection was computed at full precision — so a ₱499.99 add-on
   * billed ₱500 but refunded ₱499.99.
   *
   * The repo rule is **store at 2dp, display at 0dp**: both apps'
   * `formatPrice` uses `maximumFractionDigits: 0`, so the rendered
   * amount is unchanged. Breakfast already worked this way.
   */
  otherAddOnTotal?: number;
  /** O(1) "is there any other add-on on this booking" flag. */
  hasAnyOtherAddOns?: boolean;
  /** Served map: `yyyy-mm-dd-{addOnId}` → `{ servedAt, servedBy }`. */
  otherAddOnServed?: Record<string, { servedAt: any; servedBy: string }>;
}
```

### Per-day × per-add-on selection entry

```ts
interface OtherAddOnSelectionEntry {
  addOnId: string;
  nameSnapshot: string;                  // frozen at order time
  priceSnapshot: number;                 // frozen at order time
  quantity: number;                      // 0..50 (server-clamped)
  unitSnapshot: "per-person" | "per-stay";  // frozen at order time
  addedAt: Timestamp | string;
  addedBy: string;                       // "guest" or staff UID
  lastModifiedAt: Timestamp | string;
  lastModifiedBy: string;
  removedAt: Timestamp | string | null;
  removedBy: string | null;
  cutoffHoursBeforeCheckInSnapshot: number; // frozen at first add
}
```

### Audit + refund context

```ts
interface OtherAddOnAuditEntry {
  action: "add" | "change" | "remove" | "mark-served" | "override-add" | "override-change" | "override-remove";
  selectionKey: string;                  // `yyyy-mm-dd-{addOnId}`
  addOnSnapshot: { addOnId: string; name: string; price: number; quantity: number } | null;
  actorUid: string;
  actorRole: "guest" | "front-desk" | "admin";
  reason: string | null;
  occurredAt: Timestamp | string;
  occurredAfterCutoff: boolean;
}

interface OtherAddOnRefundContext {
  addOnId: string;
  selectionKey: string;
  addOnName: string;
  priceSnapshot: number;
  quantitySnapshot: number;
}
```

---

## Cutoff Model

Per-add-on cut-off (NOT a hotel-wide setting). `cutoffHoursBeforeCheckIn` hours before each `checkIn` date. After that, the add-on is locked for that check-in date's selection.

`computeOtherAddOnCutoffState(checkInDate, addOn)` returns:

```ts
interface OtherAddOnCutoffState {
  isLocked: boolean;
  cutoffAt: string;
  minutesUntilCutoff: number;
  reasonOrCutoff?: "addons-disabled" | "cutoff-passed";
}
```

- `addOn.isEnabled === false` → `{ isLocked: true, reasonOrCutoff: "addons-disabled", minutesUntilCutoff: Number.MAX_SAFE_INTEGER }`.
- `now >= cutoffAt` → `{ isLocked: true, reasonOrCutoff: "cutoff-passed", minutesUntilCutoff: < 0 }`.
- Otherwise → unlocked.

The helper computes `cutoffAt` even when locked (so the UI can render a "would-be cutoff" hint).

---

## Server Contract (catch-all dispatcher, zero new Vercel functions)

6 new route handlers — all registered in `guest-app/server/apiRouter.ts`:

1. **`GET /api/bookings/addons/config`** — public; returns the hotel's enabled add-ons catalog (read through `addOns` where `isEnabled === true`), falling back to the pre-seed row if the collection is empty. Cached 60s. Also returns `otherAddOnsEnabled` — the hotel-wide master switch (OCT-M1, decision #295); when it is off the catalog is EMPTY. Rate-limited 60/min/IP.

2. **`GET /api/bookings/addons/manage?ref=…&token=…`** — guest manage read; returns booking + per-add-on lock states + the enabled catalog + the persisted `otherAddOnSelections` / `otherAddOnServed`. Lookup-token gated. Rate-limited 10/min/IP.

3. **`POST /api/bookings/addons/update`** — guest manage save. Body: `{ bookingRef, lookupToken, clientBatchId, add[], change[], remove[] }`. Lookup-token gated + Turnstile-gated. Idempotent on `clientBatchId` (60s window via `idempotencyLog`). Rate-limited 10/min/IP.

4. **`POST /api/bookings/addons/staff-update`** — staff save (booking-drawer). Body: `{ bookingId, selections, removedKeys, overrideReason? }`. STAFF-Token gated + Turnstile-gated. `overrideReason` required for late writes past a per-add-on cutoff. Rate-limited 30/min/IP.

5. **`POST /api/bookings/addons/mark-served`** — staff served action. Body: `{ bookingId, selectionKeys[] }`. STAFF-Token gated + Turnstile-gated. Rate-limited 60/min/IP.

6. **`POST /api/bookings/addons/mark-refund-paid`** — staff mark refund paid. Body: `{ bookingId, refundId, method, transactionReference?, note? }`. STAFF-Token gated + Turnstile-gated. Delegates to the unified `markRefundPaid` helper with `category: "otherAddOn"`. Rate-limited 30/min/IP.

---

## Shared Helpers

Mirrors each breakfast helper exactly:

- `shared/utils/otherAddOnCutoff.ts` — `computeOtherAddOnCutoffState`
- `shared/utils/otherAddOnTotal.ts` — `recomputeOtherAddOnTotal` + `otherAddOnBreakdownByDate` + `hasAnyOtherAddOns` + `buildOtherAddOnSelectionKey` + `parseOtherAddOnSelectionKey`
- `shared/utils/addOns.ts` — `normalizeAddOn` + `getEnabledAddOnsByHotel` + `sortAddOnsByDisplayOrder` + `AIRPORT_TRANSFER_PRESEED`
- `guest-app/server/lib/otherAddOn-selections.ts` — `assertAddOnExists` + `assertNotLocked` + `assertSelectionForAdd` + `assertSelectionForChange` + `auditOtherAddOnOp` + `createOtherAddOnRefundLiability` + `generateOtherAddOnRefundId`

---

## Shared Zod Schemas

Added to `shared/schemas/booking.ts`:

- `AddOnSchema` — admin catalog write payload
- `OtherAddOnSelectionEntrySchema` — booking write payload entry
- `OtherAddOnUpdateSchema` — guest manage POST payload
- `StaffOtherAddOnUpdateSchema` — staff POST payload
- `OtherAddOnAuditEntrySchema` — audit subcollection
- `OtherAddOnRefundContextSchema` — refund-context blob
- `OtherAddOnMarkServedSchema` — mark-served payload
- `OtherAddOnMarkRefundPaidSchema` — mark-refund-paid payload

---

## Guest UI

### Add-ons step (Step 2 of 5 — extends BR-09 / BR-10)

Below the existing `renderBreakfastSection`, the Step 2 grid now also renders the enabled add-ons catalog with per-day quantity inputs. The dual-button pattern (BR-10) covers both breakfast AND other add-ons — "No add-ons, continue" applies to the union.

### Guest Manage page at `/my-booking/addons`

Mirrors `ManageBreakfastPage.tsx`. Same cutoff countdown per date, same batched POST with 60s `clientBatchId` idempotency, same refund-due banner.

---

## Admin UI

### New Settings tab: "Other Add-Ons"

- CRUD list (table: name + price + unit + cutoff + enabled toggle + edit button)
- Pre-seed on first visit if no docs (writes the AIRPORT_TRANSFER_PRESEED row)
- "+ New add-on" button → modal: name + description + price + unit select (default per-person) + cutoffHoursBeforeCheckIn + displayOrder
- Per-row: edit + delete (with confirm)
- Save through the existing settings-save flow (admin writes to `addOns/{addOnId}` directly via Firestore — no separate admin route)

### Booking drawer — new "Other Add-Ons" tab (parallel to Breakfast tab)

Mirrors the breakfast tab's read pattern. Shows per-day selections + per-add-on quantity + per-add-on subtotal + served-stamp badges.

### Reports → Sales → Add-Ons sub-tab

4 metrics (count of selections, total revenue, top add-ons, pending refund liability total). Mirrors breakfast's sub-tab exactly.

---

## Email + PDF + Receipt

- `buildReservationEmailView` extends with an "Other Add-Ons" block below the breakfast block; the PDF receipt itemises an "Other add-ons" line in the Folio Charges section (OCT-FOL-01, decision #298)
- **No new email templates for v1** — the existing "Confirmation" / "Update" / "Refund paid" templates get an extra paragraph; a dedicated add-on template is a follow-up if needed

---

## Edge Cases

| Case | Behavior |
|---|---|
| Catalog empty | Pre-seed falls back to `AIRPORT_TRANSFER_PRESEED` (read-only). The admin's first Settings save promotes it to a real doc. |
| Booking checked-out / cancelled | Both guest + staff update endpoints reject with 400 "Booking is read-only." Per OCT-M3 (decision #291) ONE shared helper (`isOtherAddOnBookingMutable`) covers the guest save path, the staff path AND mark-served — the guest path previously had NO check. Case-insensitive. |
| Add-on disabled in catalog | `addons-disabled` reason — every date is locked. |
| Hotel-wide "Add-ons enabled" switch OFF | Per OCT-M1 (decision #295): empty catalog on the public endpoint + the guest Manage page; the guest save path refuses with a 400. The STAFF path stays open. |
| Guest books with an add-on, then the hotel disables it | Per OCT-M4 (decision #297): the create path rebuilds from the live catalog and refuses an add-on that is not on sale with a 400. The guest returns to Step 2, drops it and resubmits. |
| Cut-off passed | `cutoff-passed` reason — the lock is per ADD-ON (anchored on the booking's check-in for every date), not per date. Per OCT-M5 (decision #292); the old per-service-date anchor slid forward a day per row. |
| Past cut-off + staff write | Allowed only with `overrideReason` (≥8 chars). Audit row stamped with `action: "override-*"`. |
| Quantity > 50 | Zod schema rejects. |
| `clientBatchId` replay within 60s | Returns prior result without re-applying. |
| Missing `turnstileToken` in non-test mode | 400 from the apiRouter gate. |
| Same add-on id, multiple dates | Each date gets its own entry array in `otherAddOnSelections[date]`. |
| Catalog price change after order | Existing entries keep the snapshotted `priceSnapshot`. |
| Stay dates change (reschedule / extend) | Per OCT-H8 (decision #287): a selection whose service date falls outside the NEW window is auto-cancelled (marked `removedAt`, kept for audit). A PAID removal opens a `category: "otherAddOn"` refund liability; an UNPAID one comes off the bill. The add-ons are NOT inside `totalPrice`, so removing one does not change the room bill — the liability is the only money effect. `mode: "extend"` only GROWS the window, so nothing is cancelled there. |
| Booking cancelled | Per OCT-H8 (decision #287): future-date selections (service date ≥ today in the hotel timezone) are dropped; past-date selections are left alone and never refunded. The cancel path does NOT rewrite `totalPrice` (the CRL-07 policy liability is computed from the collected amount), and the add-on liability opens ONLY when the policy refunded NOTHING — the policy refund is a percentage of the collected money, which already includes the add-ons, so a second liability would refund them twice. |

---

## Migration

**No migration required.** BR-12 is purely additive:
- The `Booking` interface gains 4 new optional fields; existing bookings read with `otherAddOnTotal: 0`, `hasAnyOtherAddOns: false`.
- The `addOns` collection is brand new — pre-seed runs on first Settings load.
- The `markRefundPaid` helper adds the `"otherAddOn"` union member; existing callers are unaffected.

Back-compat: pre-BR-12 bookings have no `otherAddOnSelections` — the guest Manage page renders the catalog + zero selections + "Saved." and the drawer's tab shows "No add-ons ordered." Both reads are safe.

---

## Open Items

1. ✅ **Email template dedicated to other add-on refund paid** — BR-12 v1 piggy-backs on the existing breakfast `mark-refund-paid` copy. A dedicated `add-on-refund-paid` template is a follow-up if operations finds the conflation confusing. *(Intentionally deferred per the BR-12 spec.)*

2. ✅ **Walk-in modal + calendar-create modal mirror** — BR-12.1 (decision #247) ships the `WalkinOtherAddOnGrid` parallel to `WalkinBreakfastGrid` and mounts it in both the walk-in modal AND the calendar-create modal Step 2.

3. ✅ **Hotel-wide `otherAddOnCutoffsEnabled` toggle** — mirrors BR-10's `cutoffsEnabled`. Skipped for BR-12 v1 because the per-add-on `isEnabled` switch is operationally equivalent for v1; the BR-13 refactor may add it when a second add-on **type** (seaport) lands with its own semantics. *(The Settings tab's "Add-ons enabled" affordance shipped as a v1 placeholder in BR-12.1; **OCT-M1 (decision #295) made it real** — it persists to `settings/hotelConfig.otherAddOnsEnabled` and gates the public catalog endpoint, the guest Manage page and the guest save path.)*

4. ✅ **Reports → Sales → Add-Ons sub-tab** — BR-12.1 (decision #247) ships the new sub-tab with 5 metrics (total selections, total revenue, top add-ons, late-change count, pending refund liability) + a top-add-ons bar chart + the per-booking detail table.

5. ✅ **Admin edit UI for individual selections** — BR-12.1 (decision #247) replaces the BR-12 read-only booking-drawer tab with the full edit UI: per-day × per-add-on grid with quantity inputs + add row + remove + locked-date badges + override modal + Save changes button, writing through `/api/bookings/addons/staff-update`.

---

## Implementation Order

BR-12 shipped in a single `feat(breakfast): BR-12` commit: shared types + helpers + schemas → server lib (assertions / audit / refund-liability writer) → the **6** server handlers + apiRouter wiring → the guest Manage Other Add-Ons page + the booking-drawer tab → tests → this spec + decision entry #245 (the per-step file map is there). The BR-13 refactor (when a second add-on **type** — seaport — lands) will extract the common patterns into a shared abstraction: a non-breaking refactor, not a rewrite.

---

## Verification (mandatory, blocking the merge)

1. `npm run typecheck` from the worktree root → clean on both workspaces
2. `npm run test:fast` → no new failures (pre-existing baseline unchanged)
3. All NEW BR-12 tests pass (~108 tripwires)
4. BR-09 + BR-10 tripwires still pass — no regression on the 5-step layout, dual-button pattern, or `cutoffsEnabled` toggle

---

## Rejected Alternatives

**(A)** Generic-add-on abstract base class with a `breakfast` / `seaport` discriminated union on the `Booking` interface — premature abstraction. The BR-13 refactor pulls the common patterns when a second add-on TYPE lands, not before.

**(B)** Hotel-wide `otherAddOnCutoffsEnabled` toggle for v1 — operationally redundant with the per-add-on `isEnabled` switch; the BR-13 refactor may add it if operations asks.

**(C)** "Other add-ons" sub-tab inside the existing Breakfast Settings tab — mixed-purpose UI. The new tab mirrors the Breakfast tab exactly and gives the catalog its own visual identity.

**(D)** Add-on email template dedicated to `mark-refund-paid` — v1 piggy-backs on the existing breakfast refund-paid email copy, which is operationally acceptable. A dedicated template is a follow-up.

**(E)** Walk-in modal Step 2 mirror (`WalkinOtherAddOnGrid`) — out of scope for BR-12 v1 (the walk-in flow is staff-curated); BR-12.1 later shipped it in the walk-in + calendar-create modals.

**(F)** Generic add-on admin Settings tab with both breakfast + other add-ons — the two collections have different shapes (`breakfastConfig` is a single doc with a meals sub-array; `addOns` is a collection of independent docs). A unified tab would force a schema migration that BR-08 just closed out.

**(G)** New Vercel function per route — Hobby-plan 12-function cap (see `plan/docs/VERCEL-FUNCTION-LIMIT.md`). All 6 new routes register in the existing catch-all dispatcher.