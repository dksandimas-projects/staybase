# Other Add-Ons (Phase 14 — BR-12)

> Per-phase feature spec for the BR-12 add-on catalog. v1 ships **airport transfer** as the first non-breakfast add-on. The data model is intentionally flexible so the BR-13 refactor (when a second add-on **type** — e.g. seaport — lands) is a non-breaking refactor, not a rewrite.

**Owner-requested.** Shipped on `feature/br-12-other-add-ons`, v2.2.0 → v2.3.0 (`feat:` MINOR via Husky Conventional-Commits hook).

> **Requires:** `plan/docs/BACKEND.md` (Firestore schema for `bookings/{id}/otherAddOnSelections`, `bookings/{id}/otherAddOnServed`, `bookings/{id}/otherAddOnAudit`, `addOns/{addOnId}`); `plan/docs/TYPES.md` (`AddOn`, `OtherAddOnSelectionEntry`, `OtherAddOnAuditEntry`, `OtherAddOnRefundContext`, additive `Booking` extensions); `plan/docs/API-ROUTES.md` (catch-all dispatcher pattern for the 5 new routes — no new Vercel function); `plan/docs/SECURITY.md` (Turnstile + rate-limit + STAFF-Token gates); `plan/docs/VERCEL-FUNCTION-LIMIT.md` (Hobby-plan 12-function cap — all 5 new routes stay in the catch-all dispatcher); `plan/features/BREAKFAST.md` (the blueprint — every BR-12 helper + schema mirrors the BR-01/BR-04/BR-05 shape).

---

## Decisions Locked

1. **Per-add-on `cutoffHoursBeforeCheckIn`** — every add-on has its own lead window (default 24h). NO hotel-wide `otherAddOnCutoffsEnabled` toggle for v1 (BR-13 may add it). The per-add-on `isEnabled` switch is the only cut-off-adjacent toggle for now.

2. **Additive `Booking` fields** — `otherAddOnSelections`, `otherAddOnTotal`, `hasAnyOtherAddOns`. NO mutation of the BR-08 frozen breakfast fields.

3. **Per-day × per-add-on `quantity`** — NOT a per-day × per-guest slot (that's breakfast). Each entry's `quantity` defaults to the booking's total guest count, editable 0..guest count.

4. **Separate Firestore collection `addOns/{addOnId}`** — NOT a sub-field of `breakfastConfig`. The new admin Settings tab manages the catalog. Pre-seeded with "Airport transfer" on first load if empty.

5. **Unified `markRefundPaid` helper gains the `"otherAddOn"` category** — the BR-06 helper now handles three categories (`"cancellation"`, `"breakfast"`, `"otherAddOn"`). The same UPDATE-existing-pending-entry path applies; the audit row lands in `otherAddOnAudit`.

6. **No generic-add-on abstract base class** — premature abstraction is rejected per design. The BR-13 refactor will pull common patterns from the two add-on paths (breakfast + other add-on) when the second **type** lands, without forcing a v1 schema migration.

7. **Zero new Vercel functions** — the 5 new routes register in the existing catch-all `apiRouter.ts` (the Hobby-plan 12-function cap stays).

8. **No kitchen list for other add-ons** — add-ons are "served at check-in / by-arrival". The `mark-served` action stamps `otherAddOnServed` + `otherAddOnAudit` for the booking-drawer "Served at HH:MM" badge + receipt, but no printable list view ships in v1.

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

### Booking extensions (additive — BR-08 breakfast fields FROZEN)

```ts
interface Booking {
  // ... existing fields (frozen from BR-08) ...

  /**
   * `yyyy-mm-dd` → `OtherAddOnSelectionEntry[]`. Absent on
   * pre-BR-12 bookings; reads as `null` per `normalizeBooking`.
   */
  otherAddOnSelections?: Record<string, OtherAddOnSelectionEntry[]> | null;
  /** Denormalized sum, PHP. Recomputed by `recomputeOtherAddOnTotal`. */
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

5 new route handlers — all registered in `guest-app/server/apiRouter.ts`:

1. **`GET /api/bookings/addons/config`** — public; returns the hotel's enabled add-ons catalog (read through `addOns` where `isEnabled === true`). Falls back to the pre-seed row if the collection is empty. Cached 60s. Rate-limited 60/min/IP.

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

- `buildReservationEmailView` extends with an "Other Add-Ons" block below the breakfast block
- PDF receipt mirrors the breakfast per-day × per-guest breakdown
- **No new email templates for v1** — the existing "Confirmation" / "Update" / "Refund paid" templates get an additional paragraph; the dedicated add-on email template is a follow-up if needed

---

## Edge Cases

| Case | Behavior |
|---|---|
| Catalog empty | Pre-seed falls back to `AIRPORT_TRANSFER_PRESEED` (read-only). The admin's first Settings save promotes it to a real doc. |
| Booking checked-out / cancelled | Both guest and staff update endpoints reject with 400 "Booking is read-only." |
| Add-on disabled in catalog | `addons-disabled` reason — every date is locked. |
| Cut-off passed | `cutoff-passed` reason — date-specific lock. |
| Past cut-off + staff write | Allowed only with `overrideReason` (≥8 chars). Audit row stamped with `action: "override-*"`. |
| Quantity > 50 | Zod schema rejects. |
| `clientBatchId` replay within 60s | Returns prior result without re-applying. |
| Missing `turnstileToken` in non-test mode | 400 from the apiRouter gate. |
| Same add-on id, multiple dates | Each date gets its own entry array in `otherAddOnSelections[date]`. |
| Catalog price change after order | Existing entries keep the snapshotted `priceSnapshot`. |

---

## Migration

**No migration required.** BR-12 is purely additive:
- The `Booking` interface gains 4 new optional fields; existing bookings read with `otherAddOnTotal: 0`, `hasAnyOtherAddOns: false`.
- The `addOns` collection is brand new — pre-seed runs on first Settings load.
- The `markRefundPaid` helper adds the `"otherAddOn"` union member; existing callers are unaffected.

Back-compat: pre-BR-12 bookings have no `otherAddOnSelections`. The guest Manage Other Add-Ons page renders the catalog + zero selections + "Saved." The booking drawer's Other Add-Ons tab shows "No add-ons ordered." Both reads are safe.

---

## Open Items

1. ✅ **Email template dedicated to other add-on refund paid** — the BR-12 v1 piggy-backs on the existing breakfast `mark-refund-paid` email copy. A dedicated `add-on-refund-paid` template is a follow-up if operations finds the conflation confusing. *(Follow-up unchanged; intentionally deferred per the BR-12 spec.)*

2. ✅ **Walk-in modal + calendar-create modal mirror** — BR-12.1 (2026-10-15, decision #247) ships the `WalkinOtherAddOnGrid` parallel to `WalkinBreakfastGrid` and mounts it in both the walk-in modal AND the calendar-create modal Step 2. BR-13.x extends this grid to handle the `unit: "per-stay"` rendering path (the seaport transfer renders ONE quantity input at the `checkIn` date, not the per-day × per-guest grid the airport transfer uses).

3. ✅ **Hotel-wide `otherAddOnCutoffsEnabled` toggle** — mirrors BR-10's `cutoffsEnabled`. Skipped for BR-12 v1 because the per-add-on `isEnabled` switch is operationally equivalent for v1. The BR-13 refactor may add the toggle when a second add-on **type** (seaport) lands with its own semantics. **BR-13.x lands seaport at 48h cut-off vs the airport 24h — the divergent per-add-on semantics now exist, but the hotel-wide toggle stays deferred per the BR-13 trigger evaluation (decision #250): the divergent surfaces (cut-off + unit rendering + qty cap) are small enough that the per-add-on `isEnabled` switch is still operationally equivalent for the operator. Add the toggle only if operations asks.** *(BR-12.1 ships the Settings tab's "Add-ons enabled" UI affordance as a v1 placeholder; the underlying helper still returns `[]` on an empty catalog. Persisting the toggle to `settings/hotelConfig` is a follow-up.)*

4. ✅ **Reports → Sales → Add-Ons sub-tab** — BR-12.1 (2026-10-15, decision #247) ships the new sub-tab with 5 metrics (total selections, total revenue, top add-ons, late-change count, pending refund liability) + a top-add-ons bar chart + the per-booking detail table. **BR-13.x lands: the chart is data-driven over the catalog (no per-type code), so the seaport row slots into the existing metric cards + top-add-ons chart without a follow-up.**

5. ✅ **Admin edit UI for individual selections** — BR-12.1 (2026-10-15, decision #247) replaces the BR-12 read-only booking-drawer tab with the full edit UI: per-day × per-add-on grid with quantity inputs + add row + remove + locked-date badges + override modal + Save changes button. The drawer now writes through `/api/bookings/addons/staff-update`. **BR-13.x extends this UI to handle per-stay entries: the rendering loop filters the per-date "Add Row" by the add-on's key set (per-stay = `[checkIn]` only), so the operator cannot queue a seaport transfer on a non-check-in night; the per-row `max` caps at 1 for per-stay (one transfer per booking).**

---

## Seaport Transfer (BR-13.x, v2.5.0, 2026-10-15)

> **Owner-requested second non-breakfast add-on type.** The whole point of v1 is to validate or invalidate the BR-13 generic-add-on refactor trigger by introducing a real second type with at least one meaningful structural difference. Lives on `feature/br-13-x-seaport` (decision **#250**); not yet merged to dev — parent decides after reviewing the decision entry.

### Why seaport is structurally different

Airport transfer (BR-12 v1) is **per-person × per-day** — each booking night is its own selection slot, quantity defaults to total guests, the operator can opt a date in or out independently. Cruise arrivals are spikier (one ferry = one transfer, regardless of guest count or night), so seaport transfer is **per-stay** — one quantity, one entry attached to `checkIn`, no per-day grid.

Three dimensions that diverge from airport:

| Dimension | Airport (per-person) | Seaport (per-stay) |
|---|---|---|
| `unit` | `"per-person"` | `"per-stay"` |
| `cutoffHoursBeforeCheckIn` | 24h | 48h (cruise ferries book further in advance) |
| Row quantity input | `max={maxGuests}` | `max={1}` |
| Per-day render | N nights × N rows | 1 row at `checkIn` only |

The data model (`Record<dateKey, OtherAddOnSelectionEntry[]>`) is **unchanged** — the divergence lives entirely in the rendering path + the per-add-on input cap. Per-day keys that aren't in the add-on's key set are simply not rendered.

### Shared helper

The single new shared function — `getSelectionKeysForAddOn(addOn, checkIn, checkOut)` in `shared/utils/otherAddOnTotal.ts` — returns the date keys a booking should render for ONE add-on:

- `unit === "per-stay"` → `[checkIn]` only
- otherwise (per-person + defensive null/unit fallback) → `[checkIn, checkIn+1, …, checkOut-1]`

Both `WalkinOtherAddOnGrid` + `BookingDrawerOtherAddOnsTab` call this helper. The booking-drawer's "Add Row" sub-component (`OtherAddOnAddRow`) takes an `allowedAddOnIdsForDate` prop that filters the catalog down to the add-ons whose key set includes that date — so a per-stay add-on never appears in the "add" select on a non-check-in night.

### Pre-seed

`ADDON_PRESEEDS` (in `shared/utils/addOns.ts`) is the load-bearing list. Today: airport + seaport. The admin `Settings → Other Add-Ons` tab pre-seed writes BOTH rows in a single `writeBatch` when `addOns/` is empty (gated on `getDocs(addOns).empty`). The public `/api/bookings/addons/config` endpoint's read-time fallback iterates the same array. Adding a third add-on type = adding one entry to the array (one preset + the array row); the spec author touches no other file.

### Decision entry

See `plan/docs/DECISIONS-FEATURES.md #250` for the empirical evaluation of the BR-13 refactor trigger — short version: **the divergent surfaces are small enough (a ~10-line helper + a per-row render branch) that the cost of duplication is low and BR-13's added abstraction has only marginal value at this scale. Defer BR-13 until a third add-on type, or a meaningfully different rendering rule, lands.**

### Tripwires

**50 new BR-13.x `it()` blocks across 3 files:**

- `shared/__tests__/br-13-x-addons-preseed.test.ts` — `SEAPORT_TRANSFER_PRESEED` + `ADDON_PRESEEDS` + the atomic `writeBatch` + the read-time fallback (14 `it()`s).
- `shared/__tests__/br-13-x-unit-rendering.test.ts` — `getSelectionKeysForAddOn` math + WalkinOtherAddOnGrid / BookingDrawerOtherAddOnsTab render branches (20 `it()`s).
- `guest-app/tests/api/br-13-x-seaport-cutoff.test.ts` — `computeOtherAddOnCutoffState` for per-stay at 48h + `ADDON_PRESEEDS` exposure + add-on-enabled filter (16 `it()`s).

Plus **1 BR-12.1 tripwire rewritten** in `admin-app/src/__tests__/br-12-1-other-addons-settings.test.ts` to assert the new `ADDON_PRESEEDS` loop instead of the legacy `"airport-transfer"` literal.

Total project it-block count after the merge: 51 → 53 shared test files (771 → 797 = +26); 175 → 176 guest-app api test files (2049 → 2063 = +14); 152 → 152 admin-app test files (1846 → 1846 — the rewritten BR-12.1 tripwire is a no-op count-wise). Pre-existing test failures unchanged: `br-06-refunds-extension` (`BR-06/BR-08` frozen, out of scope) + `dashboard-overdue-checkouts` (Firebase emulator infra, unrelated).

---

## Implementation Order

The BR-12 build ships in a single `feat(breakfast): BR-12` commit. The following implementation order was followed:

| Step | Description | Files |
|---|---|---|
| BR-12a | Shared types + Booking interface | `shared/types/index.ts` |
| BR-12b | Shared helpers (cutoff, total, normalize) | `shared/utils/otherAddOn*.ts`, `shared/utils/addOns.ts` |
| BR-12c | Shared Zod schemas | `shared/schemas/booking.ts` |
| BR-12d | Server lib (assertions, audit, refund-liability writer) | `guest-app/server/lib/otherAddOn-selections.ts` |
| BR-12e | Unified refunds helper extension | `guest-app/server/lib/refunds.ts` |
| BR-12f | Server handlers (5 routes) | `guest-app/server/handlers/addons-*.ts` |
| BR-12g | apiRouter wiring | `guest-app/server/apiRouter.ts` |
| BR-12h | Guest Manage Other Add-Ons page + App route | `guest-app/src/pages/ManageOtherAddOnsPage.tsx`, `guest-app/src/App.tsx` |
| BR-12i | Booking drawer Other Add-Ons tab + AdminContext extension | `admin-app/src/components/BookingDrawerWorkspace.tsx`, `admin-app/src/context/AdminContext.tsx`, `admin-app/src/pages/BookingsPage.tsx` |
| BR-12j | Tests (5 files, ~108 tripwires) | `shared/__tests__/br-12-*.test.ts`, `guest-app/tests/api/br-12-*.test.ts` |
| BR-12k | Spec MD + decision entry + ROADMAP update | `plan/features/OTHER-ADD-ONS.md`, `plan/docs/DECISIONS-FEATURES.md` (#245), `plan/project/ROADMAP.md` |

The BR-13 refactor (when a second add-on **type** — seaport — lands) will extract the common patterns into a shared abstraction. This is the day BR-12's flexible-enough catalog pays off — the BR-13 refactor is a non-breaking refactor, not a rewrite.

---

## Verification (mandatory, blocking the merge)

1. `npm run typecheck` from the worktree root → clean on both workspaces
2. `npm run test:fast` → no new failures (pre-existing baseline unchanged)
3. All NEW BR-12 tests pass (~108 tripwires)
4. BR-09 + BR-10 tripwires still pass — no regression on the 5-step layout, dual-button pattern, or `cutoffsEnabled` toggle

---

## Rejected Alternatives

**(A)** Generic-add-on abstract base class with `breakfast: BreakfastSelections` + `seaport: OtherAddOnSelections` discriminated union on the `Booking` interface — premature abstraction. The BR-13 refactor will pull the common patterns when a second add-on TYPE (seaport) lands, not before.

**(B)** Hotel-wide `otherAddOnCutoffsEnabled` toggle for v1 — operationally redundant with the per-add-on `isEnabled` switch. The BR-13 refactor may add the toggle if operations asks for it.

**(C)** "Other add-ons" sub-tab inside the existing Breakfast Settings tab — mixed-purpose UI. The new "Other Add-Ons" Settings tab mirrors the existing Breakfast tab exactly and gives the add-on catalog its own visual identity.

**(D)** Add-on email template dedicated to the `mark-refund-paid` action — the v1 piggy-back on the existing breakfast refund-paid email copy is operationally acceptable. A dedicated template is a follow-up.

**(E)** Walk-in modal Step 2 mirror (`WalkinOtherAddOnGrid`) — out of scope for v1. The walk-in flow has a different UX (staff-curated, not guest-curated) and the BR-12 v1 focuses on the public + guest-manage + staff-drawer surfaces.

**(F)** Generic add-on admin Settings tab with both breakfast + other add-ons — the two collections have different shapes (`breakfastConfig` is a single doc with a meals sub-array; `addOns` is a collection of independent docs). A unified tab would force a schema migration that BR-08 just closed out.

**(G)** New Vercel function per route — Hobby-plan 12-function cap (see `plan/docs/VERCEL-FUNCTION-LIMIT.md`). All 5 new routes register in the existing catch-all dispatcher.