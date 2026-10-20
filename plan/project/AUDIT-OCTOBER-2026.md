# October 2026 Feature Audit — Bugs & Gaps
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** This audit ran 2026-10-19 against `dev` at the October feature boundary. **All findings below are OPEN and not yet triaged into `plan/project/ROADMAP.md`** — the 5 Critical and 11 High findings need scheduling before the next release. Read this file to plan the fixes; read the canonical spec MDs to implement them.
> Started: 2026-10-19 · Scope: every feature shipped in October 2026 (branch `dev`, 2026-10-01 → 2026-10-19, 158 commits / 90 feature commits / ~200 files)
> Method: static code-path tracing + targeted runtime repro (Node) + the repo's own audit scripts. Every finding cites a real `file:line` that was read or executed.

---

## Executive Summary

October shipped nine feature blocks: the breakfast redesign (BR-01..BR-10), Other Add-Ons (BR-12 / BR-12.1), special requests (SR-01..05), the date-range calendar (DR-01..04), the stay-length cap (MSL-01), the mobile booking UX refresh (MBUX-01..19), the in-flow hold + extension (IFH-01 / IMT-01..06), the VAT toggle (VAT-01), the settings sidebar grouping (SET-SBG-01), plus the calendar bulk blocks + staff inventory holds.

**The green suite is not evidence of correctness.** Typecheck passes and **5,130 tests pass** (shared 798 · guest-api 2,437 · admin 1,889 · infra 6), but the suite is overwhelmingly *source-text assertion* — it reads files and regex-matches strings. There is no jsdom/RTL harness, so no DOM behaviour is ever executed. Every one of the 30+ findings below survives a fully green suite.

**The five Critical findings are all money or availability:**

1. A guest can set their own breakfast price at booking time → free breakfasts.
2. A guest can set their own add-on price → an ₱500 airport transfer for ₱1.
3. `addOns` + `auditLogs` have **no Firestore rules** → the admin's entire Other Add-Ons management surface is dead, with a *misleading* "No add-ons yet" empty state.
4. The date picker books the **wrong dates** for every guest whose browser clock is ahead of Asia/Manila.
5. Walk-in bookings silently discard the front desk's breakfast and add-ons → no revenue, no meals, no charge.

**Plus two more that quietly cost money every day:** the guest balance double-counts breakfast, and the admin's "Maximum stay length" field never round-trips, so saving an unrelated setting silently rewrites an "unlimited" policy to 30.

**Top 5 to fix first** — **all 5 are now FIXED (2026-10-20, branch `fix/october-audit-criticals`, decisions #277–#281).**

| # | ID | Why | Anchor | Status |
|---|---|---|---|---|
| 1 | **OCT-C1** | Guest sets their own breakfast price — free breakfasts on every booking | `guest-app/server/lib/breakfast-selections.ts:205` | **FIXED** (#277) |
| 2 | **OCT-C2** | Guest sets their own add-on price — ₱500 transfer sells for ₱1 | `guest-app/server/handlers/addons-manage-save.ts:327` | **FIXED** (#278) |
| 3 | **OCT-C3** | `addOns` has no Firestore rules → admin can't manage add-ons at all, silently | `firebase/firestore.rules` (no `match /addOns/`) | **FIXED** (#279) |
| 4 | **OCT-C4** | Date picker commits a stay one day early for every guest ahead of Manila | `guest-app/src/components/DateRangePicker.tsx:87` | **FIXED** (#280) |
| 5 | **OCT-C5** | Walk-in bookings silently discard breakfast + add-ons → no revenue, no meals | `guest-app/server/handlers/bookings.ts:5553` | **FIXED** (#281) |

### What the 5 fixes changed

| ID | Fix | Regression test |
|---|---|---|
| OCT-C1 | The server snapshots the **catalog** price + name on every path; the wire `price`/`mealName` are accepted and ignored. | `guest-app/tests/api/oct-c1-breakfast-price-authority.test.ts` — 8 real unit tests of the validator; 6 fail against the pre-fix code |
| OCT-C2 | `nameSnapshot` / `priceSnapshot` / `unitSnapshot` / `cutoffHoursBeforeCheckInSnapshot` all come from the live catalog. A **change** op may only alter the quantity. | `guest-app/tests/api/oct-c2-addon-price-authority.test.ts` — 14 guards |
| OCT-C3 | `match /addOns/{addOnId}` + `match /auditLogs/{auditId}` added to the rules; the admin tab now renders a `role="alert"` error panel instead of a misleading empty state. **OCT-H6 also fixed here** — the two missing `collectionGroup` rules for `breakfastAudit` / `otherAddOnAudit`. | `guest-app/tests/api/oct-c3-firestore-rules.test.ts` — 16 guards |
| OCT-C4 | `isoToTzDate` builds the `TZDate` from its **Y/M/D components** (`new TZDate(year, month - 1, day, config.timezone)`) — the exact construction rdp uses. **OCT-H2 also fixed here** — the breakfast date list now uses the `Z` anchor. | `guest-app/tests/api/oct-c4-calendar-timezone.test.ts` — 14 guards, incl. a runtime round-trip across 8 browser timezones |
| OCT-C5 | The walk-in validates + persists the breakfast selections and rebuilds the other add-ons from the live catalog. A walk-in skips the per-date cut-off (a new booking has no prior selection to lock). | `guest-app/tests/api/oct-c5-walkin-addons.test.ts` — 16 guards; 12 fail against the pre-fix code |

**Not fixed here, on purpose:** `handleAddRoomToReservation` also writes `breakfastSelections: {}` while inheriting the **reservation's** `breakfastTotal` onto the new room's subtotal — a separate double-charge defect (the new room is billed for the existing guests' breakfast and has no meal slots of its own). It is a different bug from OCT-C5 and changing that billing behaviour is a separate decision. **The 11 High findings are now also FIXED (2026-10-20, branch `fix/october-audit-highs`, decisions #282–#289) — see §What the 11 High fixes changed below. Still open: the 8 Medium and 6 Low findings below.**

---

## CRITICAL (5)

### OCT-C1 — A guest sets their own breakfast price at booking time
**Severity:** Critical · **Anchor:** `guest-app/server/lib/breakfast-selections.ts:205` (persisted at `:215`), schema `:53`, catalog check `:193` · called from `guest-app/server/handlers/bookings.ts:2481`

The server loads the live meal catalog into `mealLookup`, but only checks **membership**:

```ts
if (!mealLookup.has(entry.mealId)) { throw new BreakfastSelectionValidationError(...); }   // :193
const price = Number(entry.price);                                                           // :205  ← client wire value
if (!Number.isFinite(price) || price < 0) { throw ... }
validatedEntries[key] = { mealId: entry.mealId, mealName: entry.mealName, price, ... };      // :212-215
```

The wire schema explicitly accepts both fields from the client (`entryShape`, `:50-53`): `mealName: z.string()`, `price: z.number().finite().min(0)`. The catalog's real price sits right there in `mealLookup` and is never consulted. The tampered value flows into `subtotal = roomTotal + breakfastTotal + extraBedTotal` (`bookings.ts:2902`) → `totalPrice` (`:3105`) → VAT → folio → receipt → email.

**Impact:** `POST /api/bookings` with `breakfastSelections: {"2026-10-14-guest-0": {mealId:"tapsilog", mealName:"Tapsilog", price: 0}}` books three breakfasts for ₱0. `breakfastTotal` and `totalPrice` are both computed from the tampered price. `mealName` is client-controlled too, so the receipt PDF and the confirmation email can be made to name a meal the hotel never offered.

**Why the manage path doesn't save you:** `breakfast-manage.ts:689` *does* re-read `serverPrice`. Only the **create** path trusts the client. A guest therefore books at ₱0 and can never be retro-corrected.

---

### OCT-C2 — Same client-price trust on the other-add-on paths
**Severity:** Critical · **Anchor:** `guest-app/server/handlers/addons-manage-save.ts:327` (guest), `:284` (staff) · `guest-app/server/handlers/addons-staff-update.ts:243`, `:284`

```ts
nameSnapshot:  op.nameSnapshot  || liveAddOn.name,                                    // :326
priceSnapshot: Math.max(0, Number(op.priceSnapshot ?? liveAddOn.price) || 0),          // :327
```

`op.priceSnapshot` is **always** present — the client always sends it (`ManageOtherAddOnsPage.tsx:199, 280`) — so the `?? liveAddOn.price` fallback can never fire. The server persists the client's `priceSnapshot` and `nameSnapshot` and computes `otherAddOnTotal` from it (`addons-manage-save.ts:418`).

**Impact:** a guest buys a ₱500 airport transfer for ₱1. Because the price is snapshotted permanently, a later "the catalog price changed after the order" check cannot even detect it. The staff path has the identical hole, which defeats the `priceSnapshot` audit trail (`otherAddOnAudit.addOnSnapshot.price`).

---

### OCT-C3 — `addOns` and `auditLogs` have no Firestore rules → the admin's Other Add-Ons surface is dead
**Severity:** Critical · **Anchor:** `firebase/firestore.rules` (39 `match` blocks, **0** matching `addOns` or `auditLogs`) · `admin-app/src/pages/SettingsPage.tsx:2849`, `:2912`, `:2920`, `:2988`, `:3028`, `:3057`, `:2947`

The BR-12.1 Settings tab reads and writes the catalog with the **browser client SDK** (`admin-app/src/firebase/config.ts:17` → `db = getFirestore(firebaseApp)`), so every call is subject to the rules:

```ts
query(collection(db, "addOns"))            // :2849  read
setDoc(doc(db, "addOns", "airport-transfer"), seed)   // :2920  pre-seed
setDoc(doc(db, "addOns", row.id), …)       // :2988 / :3028
deleteDoc(doc(db, "addOns", target.id))    // :3057
addDoc(collection(db, "auditLogs"), {…})   // :2947
```

Firestore denies unmatched paths by default, so all six are `PERMISSION_DENIED`. **Every failure is swallowed:**

- the `onSnapshot` error handler (`:2892-2894`) only sets `loading = false` — no error, no toast;
- the pre-seed `catch` (`:2921-2927`) only `console.warn`s;
- the audit-log `catch` (`:2957-2964`) only `console.warn`s.

The admin therefore sees the catalog table render its **empty state** (`:6915`):

> "No add-ons yet. Use the "Add add-on" button above to create the first row."

…and clicking that button produces a raw permissions error. The catalog may not be empty at all — the admin simply cannot read it.

**Impact:**
- The hotel can never see, seed, create, edit, price, enable/disable or delete an other add-on.
- The BR-12.1 audit trail (`addons.create` / `addons.update` / `addons.delete`) never records a single row.
- The guest path still works — the server reads the catalog through the Admin SDK and falls back to the read-only pre-seed (`guest-app/server/handlers/addons-config.ts:51-59`) — so **guests are being sold an add-on the hotel cannot manage**. The airport transfer is live at ₱500/person (`shared/utils/addOns.ts:30-39`), with no way to change the price or turn it off through the UI.

**Why it shipped:** the rules file was touched once in October (commit `6d5c969`, which added `staffInventoryHolds` for the bulk-blocks feature) but `addOns` was never added. `git log -S "addOns" -- firebase/firestore.rules` returns nothing — the collection has **never** had a rule. Of the 24 collections the admin app touches from the browser, `addOns` and `auditLogs` are the only two with no block, and both were introduced by the same October commit (`d7ae12f`).

**Missing tripwire:** of the October test files, only `staff-special-requests-capture.test.ts` asserts anything against `firestore.rules`. The BR-12.1 tests assert source text (`expect(addOnsState).toContain("addDoc(collection(db, \"auditLogs\")")`) — they can never catch a missing rule.

---

### OCT-C4 — The date picker commits a stay one day early for every guest ahead of Manila
**Severity:** Critical · **Anchor:** `guest-app/src/components/DateRangePicker.tsx:86-88`, commit path `:262` + `:298`, display `:329` + `:97-106`

```ts
function isoToTzDate(iso: string): TZDate {
  return new TZDate(`${iso}T00:00:00`, config.timezone);   // :87
}
```

`@date-fns/tz`'s `TZDate` string branch does `this.setTime(+new Date(args[0]))` — a date-time string with **no offset** is parsed in the *host's* (browser's) zone, then re-projected to `config.timezone`. The hotel is `Asia/Manila` (UTC+8). Verified against the installed package:

```
browser TZ: Asia/Manila       isoToTzDate(Oct 25) -> 2026-10-25   ✅
browser TZ: Asia/Tokyo         isoToTzDate(Oct 25) -> 2026-10-24   ❌
browser TZ: Australia/Sydney   isoToTzDate(Oct 25) -> 2026-10-24   ❌
browser TZ: Europe/Berlin      isoToTzDate(Oct 25) -> 2026-10-25   ✅
```

`react-day-picker` re-exports the *same* `TZDate` class, so the library's day cells are correctly Manila-anchored while **every value we build is not** — the two disagree, which is exactly the invariant `BOOKING-FLOW.md:72` / GOTCHAS 10(e) says must never happen.

**Impact:**
- **On screen:** `draft.from = isoToTzDate(checkIn)` → the boxes render one day early, and `formatStayDate` (`:97-106`) re-applies the same shift → the picker shows dates **two days early**. `StaySummaryStrip.formatStayDate` (`guest-app/src/components/StaySummaryStrip.tsx:45-51`) parses the ISO key as browser-local and formats with no `timeZone`, so the strip shows the *correct* dates. The picker and the strip disagree by two days on the same phone screen.
- **In the booking:** the first click stores `isoToTzDate(selection.checkIn)` (`:298`) — already shifted — so the second click commits `nextFrom = draft!.from!` (`:262`) at **one day before the day the guest clicked**. The stay is one night longer, priced, queried, booked, emailed and receipted for the wrong dates. The guest checks into a day they did not choose.

Bohol's guest mix is exactly the affected profile (Japan, Korea, Australia, NZ). A correct helper is `new TZDate(y, m, d, config.timezone)` — the same construction rdp's `DateLib.newDate` uses.

---

### OCT-C5 — Walk-in bookings silently discard the front desk's breakfast and add-ons
**Severity:** Critical · **Anchor:** `guest-app/server/handlers/bookings.ts:5553` (`breakfastSelections: {}`), `:5335` / `:6414` / `:6541` (`breakfastTotal: 0`) · `grep -c otherAddOn bookings.ts` → **0**

The admin walk-in modal builds and sends the full payload — `admin-app/src/pages/BookingsPage.tsx:4654-4659` (breakfast) and `:4669-4675` (`otherAddOnSelections` / `otherAddOnTotal` / `hasAnyOtherAddOns`). The server ignores all of it:

```ts
// handleCreateWalkin
breakfastSelections: {},      // :5553
```

`handleCreateWalkin` never reads the walkin body's `breakfastSelections` (the only read in the file is `:2481`, the online-create path), and the string `otherAddOn` appears **zero times** in `bookings.ts`.

**Impact:** the desk selects three breakfasts and an airport transfer in the walk-in modal, the modal shows a total, the booking is created — and the guest receives no breakfast, no transfer, `breakfastTotal: 0`, and no add-ons. The kitchen never sees the meals, the guest is never charged, and the add-on revenue is a total loss. **Every walk-in add-on is worth ₱0 to the hotel.** The same gap exists in `handleAddRoomToReservation` (`:13421` writes `breakfastSelections: {}` while inheriting `breakfastTotal` at `:13411`).

---

## What the 11 High fixes changed

**All 11 are FIXED (2026-10-20, branch `fix/october-audit-highs`, decisions #282–#289).**

| ID | Fix | Decision | Regression test |
|---|---|---|---|
| **OCT-H1** | The guest balance subtracts the breakfast already inside `totalPrice` before adding the current one. The anchor is the booking's `rateBreakdown.addOns[]` (snapshotted at create, preserved by `rebuildRateBreakdown`) — **not** `booking.breakfastTotal`, which the manage path overwrites on every write. A booking with no rate breakdown has an unknown breakfast component, so the fallback never over-charges. | #282 | `shared/__tests__/oct-h1-breakfast-rate-lines.test.ts` (11, real behavioural) + `guest-app/tests/api/oct-h1-guest-balance.test.ts` (6 pins) |
| **OCT-H2** | The booking flow's breakfast date list uses the `Z` anchor (shipped with OCT-C4). | #280 | `guest-app/tests/api/oct-c4-calendar-timezone.test.ts` |
| **OCT-H3** | The "Booking & Holds" form re-syncs from the snapshot — each field only when its SOURCE value actually changed, so a snapshot can no longer clobber an in-progress edit. "No limit" (`Infinity`) renders back as the literal `0`. The two hold-window fields shared the defect and are fixed too. | #284 | `admin-app/src/__tests__/oct-h3-max-stay-sync.test.ts` (8) |
| **OCT-H4** | The admin booking mapper hydrates `breakfastTotal` / `hasAnyBreakfast` / `revenueAllocation` / `otherAddOnSelections` / `otherAddOnTotal` / `hasAnyOtherAddOns` / `otherAddOnServed`, DERIVING the mirrors with the server's own helpers when the doc carries no explicit flag. | #285 | `admin-app/src/__tests__/oct-h4-admin-booking-mapper.test.ts` (9) |
| **OCT-H5** | A cleared optional meal field is REMOVED from the object (not left `undefined`), and every settings write strips `undefined`-valued keys as a safety net (`stripUndefinedValues`). | #288 | `shared/__tests__/oct-h5-firestore-payload.test.ts` (12, real behavioural) + `admin-app/src/__tests__/oct-h5-h10-meal-photo.test.ts` (10) |
| **OCT-H6** | The two missing `collectionGroup` Firestore rules (shipped with OCT-C3). | #279 | `guest-app/tests/api/oct-c3-firestore-rules.test.ts` |
| **OCT-H7** | The audit helper can now carry a reason AND the cut-off flag; every override path stamps both, so the kitchen list's "Late changes" column counts the case it exists for. | #286 | `guest-app/tests/api/oct-h7-occurred-after-cutoff.test.ts` (8) |
| **OCT-H8** | The reschedule / cancel paths re-date the add-on selections: out-of-window selections are auto-cancelled, the totals are recomputed, and the refund liabilities the spec requires are opened — with a double-refund guard against the CRL-07 policy refund (the policy refund is a percentage of the COLLECTED money, which already includes the add-ons). | #287 | `shared/__tests__/oct-h8-addon-redate.test.ts` (26, real behavioural) + `guest-app/tests/api/oct-h8-server-wiring.test.ts` (12) |
| **OCT-H9** | The guest booking page's live VAT preview is gated on the admin's Tax toggle with the same shared helper `PriceBreakdown.tsx` uses. | #283 | `guest-app/tests/api/oct-h9-vat-gate.test.ts` (6) |
| **OCT-H10** | The meal-photo upload / removal persists the `meals` array immediately, through the same schema validation the Save button uses. The success toast fires only after the row is in Firestore, and the Storage object is deleted only after the row stops referencing it. | #288 | `admin-app/src/__tests__/oct-h5-h10-meal-photo.test.ts` (10) |
| **OCT-H11** | The MBUX-18 edit sheet traps focus, closes on Escape, restores focus and locks the body scroll. The guest app gains the same primitive the admin app has had since decision #107. | #289 | `guest-app/src/__tests__/oct-h11-edit-stay-sheet-a11y.test.ts` (12) |

**Not fixed here, on purpose:** the add-room / remove-room paths (`handleAddRoomToReservation`) are still not re-dated, and the same double-charge noted above applies. The late-serve flag (`breakfast-mark-served.ts`) is stamped on every serve — the BR-08 late-served email behaviour was left UNCHANGED because changing it would alter when the guest email fires. Both are recorded as open items in `plan/features/BREAKFAST.md`.

**Observed while fixing OCT-H8, NOT fixed (out of the audit's scope):** `handleCancelBooking` has a PRE-EXISTING read-after-write inside its transactions — the loyalty-clawback member read (`transaction.get(clawbackMemberRef)`) and the voucher / corporate-code reads run AFTER the booking's status flip, which contradicts `GOTCHAS.md §Firebase` ("all reads before any writes"). The OCT-H8 re-dating was deliberately placed at the END of each branch so it adds no new read-after-write. Hoisting the clawback read would be a small, safe change, but it would move a shipped MRB-05 contract (`guest-app/tests/api/mrb-05-pr2-loyalty-clawback.test.ts` pins the exact source shape of that read) and touches the rewards path — a separate decision, flagged here for the owner.

---

## HIGH (11)

### OCT-H1 — The guest balance double-counts breakfast  
**Status: FIXED (2026-10-20, decision #282).**
**Anchor:** `guest-app/server/handlers/breakfast-manage.ts:401`

```ts
const balance = Math.max(0, totalPrice + recomputedTotal - paidAmount);   // :401
```

`totalPrice` **already includes** breakfast: `subtotal = roomTotal + breakfastTotal + extraBedTotal` (`bookings.ts:2902`) → `calculateDiscountChain(...)` → `totalPrice` (`:3105`). The shared revenue helper agrees — `computeBookingRevenueAllocation` treats `breakfastTotal` as a *component* of `totalPrice` (`shared/utils/bookingFolio.ts:976-979`).

The add-on counterpart (`addons-manage.ts:192`) is correct because `otherAddOnTotal` *is* additive to `totalPrice`; the breakfast formula was copied from it without noticing the difference.

**Impact:** every booking with breakfast shows an inflated balance, inflated by exactly the breakfast amount. A 2-night stay with ₱700 of breakfast shows a balance ₱700 too high (`guest-app/src/pages/ManageBreakfastPage.tsx:845`). The guest overpays or disputes the bill.

---

### OCT-H2 — Booking Step 2 shows the wrong breakfast dates in every timezone east of UTC  
**Status: FIXED (2026-10-20, decision #280).**
**Anchor:** `guest-app/src/pages/BookingPage.tsx:257-264`

```ts
const start = new Date(`${checkIn}T00:00:00`);   // :257  local-time parse
…
const iso = cursor.toISOString().slice(0, 10);    // :264  UTC output
```

The comment at `:253-254` claims `+ 'T00:00:00'` "keeps the parse timezone-stable" — it does the opposite. Local-parse + UTC-format shifts the date back one day in any UTC+ zone. The two sibling implementations get it right (`ManageBreakfastPage.tsx:148` and `WalkinBreakfastGrid.tsx:119` both use the `Z` anchor).

**Reproduced:**
```
TZ=Asia/Manila       -> ["2026-10-13","2026-10-14","2026-10-15"]   ❌
TZ=UTC               -> ["2026-10-14","2026-10-15","2026-10-16"]   ✅ (the Z-anchored version, every TZ)
```

**Impact:** the hotel's own guests and the front desk are on UTC+8. A 3-night stay (Oct 14→17) offers breakfast rows for Oct 13, 14 and 15 — **the actual last breakfast morning (Oct 16) is never offered, so it is never charged.** The row reading "Oct 12" is keyed `2026-10-13`. The wrong date is also what the server's cut-off check runs against (`breakfast-selections.ts:171-182` uses the key's date prefix), and `validateBreakfastSelections` never verifies the service date falls inside `[checkIn, checkOut-1]` — so the out-of-range dates are persisted.

---

### OCT-H3 — The admin "Maximum stay length" field never round-trips, so a save silently rewrites "unlimited" to 30  
**Status: FIXED (2026-10-20, decision #284).**
**Anchor:** `admin-app/src/pages/SettingsPage.tsx:2564-2568` (initializer), `:4200` (the write) · `admin-app/src/context/AdminContext.tsx:5957` (default) vs `:6345` (hydration)

```ts
const [maxStayNightsInput, setMaxStayNightsInput] = useState<string>(() =>
  Number.isFinite(hotelConfig.maxStayNights) ? String(hotelConfig.maxStayNights) : "0"
);
```

`AdminContext` hydrates the field correctly — but the hydration lands **after** SettingsPage mounts, and `useState`'s initializer only runs on the first render. The only two `setMaxStayNightsInput` call sites in the whole file are the initializer and the input's `onChange` — **there is no re-sync effect**.

**Impact:** on a direct load of `/settings` (F5, bookmark, shared URL) the initializer sees the pre-snapshot default `30` and the field is stuck at `"30"`. The Booking & Holds save writes all three fields together, including `maxStayNights: maxStayNightsValid!` (`:4200`). A hotel that set `0` (no limit) and then edits *only* the payment hold window has its unlimited policy silently replaced with 30 — with the field still displaying "30", so there is no signal that anything changed. The guest site then starts refusing 31+ night stays it previously accepted.

---

### OCT-H4 — The admin booking mapper drops `breakfastTotal`, `hasAnyBreakfast`, `revenueAllocation` and every `otherAddOn*` field  
**Status: FIXED (2026-10-20, decision #285).**
**Anchor:** `admin-app/src/context/AdminContext.tsx:1733-2047` (the mapper) · type declarations at `:489-503`

The `Booking` type declares `breakfastTotal`, `otherAddOnSelections`, `otherAddOnTotal`, `hasAnyOtherAddOns`, `otherAddOnServed` — and the mapper (an explicit-field object with no `...data` spread) hydrates **none** of them. `breakfastTotal` appears in the mapper range only inside a *comment* (`:1865`); `hasAnyBreakfast`, `revenueAllocation` and every `otherAddOn*` field appear nowhere in it.

This is the exact bug class the mapper's own comment (`:1900-1935`) documents for `reservationId` — reintroduced for the October add-on fields.

**Impact:**
- `ReportsPage.tsx:843` — `rangeBookings.filter(b => b.hasAnyOtherAddOns === true)` → **always empty** → the whole BR-12.1 Add-Ons sub-tab (selections, revenue, top add-ons, booking count, bar chart) shows zero for every booking.
- `ReportsPage.tsx:1528` / `:1914` / `:2258` — `booking.breakfastTotal` → `0` → "total breakfast revenue ₱0" and ₱0 in the CSV export, while "Top meals" (computed from `entry.price`, `:1532`) shows real money — an internally inconsistent report.
- `ReportsPage.tsx:851` + `bookingFolio.ts:814-821` — with `revenueAllocation` also dropped, the revenue-stream split falls into the legacy heuristic with `breakfastGross = 0`, so the room KPI silently absorbs breakfast revenue.
- `BookingDrawerWorkspace.tsx:2051` (`booking.otherAddOnSelections || {}`) → the drawer's Other Add-Ons tab shows "no add-ons" for a booking that has them; `:2303` shows `Total: ₱0`.

The write path is field-scoped (`updateBookingStatus` writes `...details`, `:2719`), so this is read-side misreporting rather than data destruction — but the numbers the hotel reports are wrong.

---

### OCT-H5 — "Remove image" on a breakfast meal makes every Dining settings save fail  
**Status: FIXED (2026-10-20, decision #288).**
**Anchor:** `admin-app/src/pages/SettingsPage.tsx:4498` → `:4510` → `admin-app/src/context/AdminContext.tsx:6381`

```ts
handleUpdateBreakfastMeal(mealId, { imageUrl: undefined });          // :4498
… { ...meal, ...patch, updatedAt: … }                                // :4510  ← own key, undefined value
```

Object spread copies own enumerable keys **including undefined-valued ones**, so the meal object owns `imageUrl` with the value `undefined`. `BreakfastConfigSchema.safeParse` (`shared/schemas/booking.ts:402` — `imageUrl: z.string().url().max(2000).optional()`) accepts it. Verified with the repo's zod:

```
has own imageUrl key : true
value                : undefined
zod parse success    : true
parsed keeps key     : true
```

`updateSettings` then calls `setDoc(docRef, data, { merge: true })` (`AdminContext.tsx:6381`). The admin app never sets `ignoreUndefinedProperties` (0 hits repo-wide), so the SDK default is `false` and `parseScalarValue` throws `Unsupported field value: undefined` (`node_modules/@firebase/firestore/dist/index.node.cjs.js:30485`).

**Impact:** after removing one meal photo the admin **cannot save any Dining setting** — cut-off time, breakfast on/off, meal name, price — until they reload the page. Meanwhile the Storage object was already deleted (`AdminContext.tsx:6950-6962`) while the Firestore row still points at the old URL, so the guest's Step-2 menu strip falls back to the placeholder tile and the admin's own table shows a broken `<img>` (`SettingsPage.tsx:6669`).

---

### OCT-H6 — `breakfastAudit` / `otherAddOnAudit` have no rules, so the client-side audit reads in Reports are denied  
**Status: FIXED (2026-10-20, decision #279).**
**Anchor:** `admin-app/src/pages/ReportsPage.tsx:497` and `:520` vs `firebase/firestore.rules` (0 blocks)

```ts
onSnapshot(collectionGroup(db, "breakfastAudit"), …)     // :497
onSnapshot(collectionGroup(db, "otherAddOnAudit"), …)    // :520
```

The rules file **already documents this exact failure and fixes it for a sibling collection** (`firebase/firestore.rules:542-553`): "Firestore requires an explicit collectionGroup rule … Without this, staff got 'Missing or insufficient permissions' the moment the Liability tab mounted." The equivalent rule was never added for the two new audit subcollections, although `BREAKFAST.md:558` explicitly requires it ("add `bookings/*/breakfastAudit/*` rules").

**Impact:** both listeners fail with `PERMISSION_DENIED` (the error callback only `console.error`s, `:507`, `:530`). The Reports late-change metrics are permanently 0 — *independently* of OCT-H7, so fixing the flag alone would not fix the metric.

---

### OCT-H7 — `occurredAfterCutoff` is never `true` on any override path, so "Late changes" is always empty  
**Status: FIXED (2026-10-20, decision #286).**
**Anchor:** `guest-app/server/handlers/breakfast-staff-update.ts:471` · `guest-app/server/lib/breakfast-selections.ts:326-330`

`auditBreakfastOp` / `auditOtherAddOnOp` overload one parameter:

```ts
if (typeof reasonOrCutoff === "string") { reason = reasonOrCutoff; }
else if (typeof reasonOrCutoff === "boolean") { occurredAfterCutoff = reasonOrCutoff; }
```

A string can never carry the flag. The staff override passes the reason string (`reasonOrCutoff: isOverride ? reason : false`, `:471`) — so an override writes `reason: "<text>"` and `occurredAfterCutoff: false`. The comment at `:464-470` asserts the flag "is already implied" — it is explicitly `false`. Every add-on call site has the same shape. Only `breakfast-mark-served.ts:374` passes a boolean.

**Impact:** `breakfast-kitchen-list.ts:427` queries `collectionGroup("breakfastAudit").where("occurredAfterCutoff","==",true)` → the "Late changes" column is empty for precisely the case it exists for: a staff member overriding a locked date after cut-off. The add-on late-change counter (`ReportsPage.tsx:520-524`) is 0 for the same reason.

---

### OCT-H8 — Reschedule, cancel and extend never re-date or auto-cancel add-on selections  
**Status: FIXED (2026-10-20, decision #287).**
**Anchor:** `guest-app/server/handlers/bookings.ts` — `handleCancelBooking` (7031-8023), `handleRescheduleBooking` (11872-12793), `handleExtendStay` (12794-12877) contain **zero** references to `breakfastSelections` / `otherAddOnSelections`

`BREAKFAST.md:418-419` requires both: reschedule "must add a step: any `breakfastSelections[date-*]` whose date falls outside the new date range is auto-cancelled; for paid removals, a refund liability is opened"; cancel "must add a step: any unpaid `breakfastSelections` for future dates is dropped; any paid selections for future dates generate refund liabilities with `category: "breakfast"`."

**Impact:** a guest books Oct 14–17 with three paid breakfasts, then reschedules to Oct 20–23. `breakfastTotal` carries forward (still charged), the selection keys still say `2026-10-14…`, and the kitchen list for Oct 20 shows nothing — **the guest is charged for three breakfasts that are never served.** Cancelling leaves the meals on the doc with no `category: "breakfast"` liability, so the Liability tab under-reports the refund owed.

---

### OCT-H9 — The guest booking page shows an ungated 12% VAT breakdown  
**Status: FIXED (2026-10-20, decision #283).**
**Anchor:** `guest-app/src/pages/BookingPage.tsx:5555-5576` vs `guest-app/src/components/PriceBreakdown.tsx:102`

The PriceBreakdown component is correctly gated on `isVatEnabled(vatConfig)` (`:102`) — but `BookingPage.tsx` renders a **second, ungated** copy of the same breakdown in its own price-summary aside:

```ts
const vat = calculateVatBreakdown({ totalPrice: total, seniorDiscountAmount: … });   // :5556  ← no vatRate, no gate
```

`calculateVatBreakdown` defaults to `vatRate = 0.12` (`shared/utils/bookingVat.ts:95`), and the block is rendered in the `rateBreakdown ? <PriceBreakdown/> : <fallback/>` branch (`:5486`) — the **fallback is the pre-submission case**, i.e. the common one on the live booking page. The aside renders at all viewports (`order-1 lg:order-2`, `:5443`).

**Impact:** with the admin Tax (VAT) toggle OFF, the guest's `/book` sidebar still shows "VATable Sales / VAT-Exempt Sales / VAT Amount (12% × VATable)". The owner's requirement for VAT-01 was explicit: the breakdown "should not display on any bill surface." The guest, the email and the PDF are clean — only this one surface was missed.

---

### OCT-H10 — The admin meal-photo upload is not persisted until the admin separately presses Save  
**Status: FIXED (2026-10-20, decision #288).**
**Anchor:** `admin-app/src/pages/SettingsPage.tsx:4478` (upload) vs `:4066-4080` (the only writer)

`handleUploadBreakfastMealImage` only mutates local state (`handleUpdateBreakfastMeal(mealId, { imageUrl: result.url })`) and toasts "Meal image uploaded" (`AdminContext.tsx:6935`). The catalog row is written only by the Dining form's own Save button.

**Impact:** after a successful upload the admin sees a success toast and a preview, but the guest-facing catalog still has no photo until Save is pressed. Navigating away orphans the Storage object and the upload appears lost.

---

### OCT-H11 — The MBUX-18 edit sheet declares `aria-modal` with no focus trap, no Escape, no scroll lock  
**Status: FIXED (2026-10-20, decision #289).**
**Anchor:** `guest-app/src/components/EditStayDetailsSheet.tsx:93-95`, `:105-107`

The backdrop comment states: *"the guest can hit Escape via the document keydown listener below."* There is **no** document keydown listener in the file, and a repo-wide grep for `keydown`/`Escape` in `guest-app/src` finds only `HomePage.tsx:94-100` (a popover) and a comment in `ManageBreakfastPage.tsx:599`. The panel declares `role="dialog" aria-modal="true"` but has no focus trap, no initial focus, no focus restore, and there is no `document.body.style.overflow` anywhere in the guest app (0 hits).

The admin app already ships the correct pattern — `admin-app/src/utils/useFocusTrap.ts:17` (initial focus + Escape close + Tab wrap + focus restore, decision #107). The guest sheet did not adopt it.

**Impact:** a keyboard or screen-reader guest tabs straight out of the sheet into a page that `aria-modal` has hidden from the AT tree, so focus lands on an invisible target. Escape does nothing. On a phone, dragging the dimmed backdrop scrolls the page behind the sheet.

---

## MEDIUM (8)

### OCT-M1 — The "Add-ons enabled" master toggle is a no-op, but its on-screen copy says it disables add-ons for guests
**Status: FIXED (2026-10-20, decision #295).**
**Anchor:** `admin-app/src/pages/SettingsPage.tsx:2838`, `:6852`, `:6866-6870` · `shared/utils/addOns.ts:81` · `guest-app/server/handlers/addons-config.ts:51-59`

`addOnsEnabled` is a plain `useState(true)`. There is no localStorage mirror (despite the code comment claiming one), no Firestore read, and no Firestore write. The copy under the switch tells the admin:

> "When off, every `getEnabledAddOnsByHotel` call returns an empty list and the booking flow's Add-ons section shows the 'Add-ons are currently disabled' placeholder."

`getEnabledAddOnsByHotel(addOns)` (`shared/utils/addOns.ts:81`) takes **only** the catalog array and filters on each row's own `isEnabled` — there is no hotel-level flag input, and the server calls it with the Firestore catalog plus the read-only pre-seed, which has `isEnabled: true` (`shared/utils/addOns.ts:36`).

**Impact:** the admin flips the switch off, believes add-ons are off, and guests keep buying the airport transfer at ₱500/person. The code comment (`:6838-6847`) admits it is "a client-side local state … Persisted as part of the hotelConfig in a follow-up ticket" — but the *user-facing* copy claims full effect, and the comment's claim of a localStorage mirror is false.

### OCT-M2 — `bedSetupValues` is the one field where the guest client and the server disagree
**Status: FIXED (2026-10-20, decision #290).**
**Anchor:** `guest-app/src/hooks/useRoomTypes.ts:112-114` vs `shared/utils/roomTypes.ts:159-163`, `admin-app/src/context/AdminContext.tsx:7102-7104`, `guest-app/server/handlers/bookings.ts:2209-2212`

| Surface | Field absent → |
|---|---|
| Guest `useRoomTypes` | **seed** `DEFAULT_ROOM_TYPES[].bedSetupValues` |
| Shared normalizer | `[]` |
| Admin mapper | `[]` |
| Server | `[]` |

The guest is the only surface that invents bed-setup choices. The comment at `useRoomTypes.ts:107-111` claims the local mapping and `applyRoomTypeDefaults` "agree on the wire shape" — they do not.

**Impact:** for a room type stored without the field (any type not re-saved since 2026-10-12, or a hand-edited doc), the guest sees the bed-setup radio group seeded with the default options, picks one, and the server rejects the booking with `Selected bed set-up "large-bed" is not offered for room type standard-double.` Because the radio group has no "no preference" option, **every** option 400s and the guest is stuck — the only way out is a page reload. It also burns attempts on a rate-limited public endpoint.

### OCT-M3 — Staff can add/remove add-ons on cancelled and checked-out bookings
**Status: FIXED (2026-10-20, decision #291).**
**Anchor:** `guest-app/server/handlers/addons-staff-update.ts:111-118` vs the guest path `addons-manage-save.ts:170-171`

The guest path rejects with 400 "Booking is read-only."; the staff path never inspects `status`. `OTHER-ADD-ONS.md:226` requires **both** endpoints to reject. `addons-mark-served.ts` has the same gap (it never reads booking status at all).

**Impact:** the front desk can add an airport transfer to a checked-out booking; if `paidAmount > 0` it writes a `category: "otherAddOn"` pending refund liability against a closed booking (`:220-222`), inflating the Liability tab and creating a refund for something already served.

### OCT-M4 — BR-12's guest Step 2 Other Add-Ons UI does not exist
**Status: FIXED (2026-10-20, decision #297).**
**Anchor:** `guest-app/src/pages/BookingPage.tsx` — `grep -c "otherAddOn\|OtherAddOn"` → **0**; the Step 2 branch at `:2707-2751` renders only `renderBreakfastSection()`

`OTHER-ADD-ONS.md:183-186` requires: "Below the existing `renderBreakfastSection`, the Step 2 grid now also renders the enabled add-ons catalog with per-day quantity inputs. The dual-button pattern (BR-10) covers both breakfast AND other add-ons — 'No add-ons, continue' applies to the union."

**Impact:** a guest cannot order an airport transfer at booking time at all. Combined with OCT-C5 (the create path never persists `otherAddOnSelections` even if it did), other add-ons are only purchasable post-booking at `/my-booking/addons` — the spec's headline BR-12 flow is unreachable, and the "No add-ons, continue" ghost button covers breakfast only.

### OCT-M5 — Other-add-on cut-off is measured from the service date, not the booking's check-in
**Status: FIXED (2026-10-20, decision #292).**
**Anchor:** `guest-app/server/lib/otherAddOn-selections.ts:114` (fallback) · callers `addons-manage-save.ts:244-248`, `addons-staff-update.ts:180-184`

`assertNotLocked` accepts an optional `checkInDate` and falls back to the selection's own date: `const date = checkInDate || parsed.date;`. **No caller ever passes it**, so the lock slides forward one day per service date. The same pattern is in the display paths (`addons-manage.ts:152`, `BookingDrawerWorkspace.tsx:2065`).

`OTHER-ADD-ONS.md:116` states the rule as "`cutoffHoursBeforeCheckIn` hours before each **`checkIn`** date", and the field is literally named `cutoffHoursBeforeCheckIn`.

**Impact:** for an Oct 20 check-in with `cutoffHoursBeforeCheckIn: 24`, the policy lock is Oct 19 00:00Z, but the Oct 21 selection locks at Oct 20 00:00Z and the Oct 22 selection at Oct 21 00:00Z — the guest can add transfers a full day past the hotel's stated cut-off.

### OCT-M6 — The SET-SBG-01 tripwire does not enforce what it claims, and its tab count is stale
**Status: FIXED (2026-10-20, decision #293).**
**Anchor:** `admin-app/src/__tests__/set-sbg-01-settings-sidebar-grouping.test.ts:72` · render sites `admin-app/src/pages/SettingsPage.tsx:4760-4761`, `:4853-4854`

```ts
expect(union.length, "group union must cover all 18 tabs").toBe(18);
```

`union` is built from the test's **own hardcoded** `EXPECTED_GROUP_TABS`, not from the source, so it can never detect a source-side omission. The test's docstring (`:33-37`) claims "Every TabId currently registered in `VALID_TAB_IDS` must appear in exactly one group" — it never reads `VALID_TAB_IDS`. The count is also wrong: there are now **19** tabs (BR-12.1 added `addons`).

The render sites do `const tab = tabs.find((entry) => entry.id === tabId); if (!tab) return null;` — a tab id present in a group but missing from the flat `tabs` metadata renders as **nothing**. That exact bug shipped once already: the `addons` tab was invisible in the sidebar until the decision-#251 follow-up.

**Impact:** the general invariant remains unenforced, and the one-off `br-12-1` test only pins the current literal string.

### OCT-M7 — The in-flow hold is never re-stamped, so the banner promises a hold for a stay the guest abandoned
**Status: FIXED (2026-10-20, decision #296).**
**Anchor:** `guest-app/server/handlers/in-flow-hold.ts:188-201` · `guest-app/src/pages/BookingPage.tsx:1241`, `:1434-1441`

`handleStartInFlowHold` is idempotent by `holdId` and returns the existing doc unchanged, so the hold's stamped `roomType` / `checkIn` / `checkOut` are never refreshed. The hold id lives in the URL and `updateDateParams` copies the whole `searchParams` object, so the stale `hold` param survives a date change.

**Impact:** the Step 2/3 banner reads "Your room is held for you until 8:45 PM" for the *original* dates while the guest is booking different ones. Because `bookingHolds` is consulted by neither the availability query nor the booking transaction, nothing is actually reserved — the guest completes the whole flow and only finds out at submit that the new dates are unavailable. MBUX-18's edit sheet widens this path.

### OCT-M8 — The breakfast copy-to-remaining-days confirmation never clears and renders once per date
**Status: FIXED (2026-10-20, decision #294).**
**Anchor:** `guest-app/src/pages/BookingPage.tsx:2263`, `:2561`, `:2572-2581`; false comment at `:2260-2262`

`setBreakfastCopyNotice` is called in exactly two places: the `useState` and the setter. There is **no** `setBreakfastCopyNotice("")` anywhere, and the file's `useEffect` list (616, 688, 849, 892, 919, 1325, 1359, 1420, 2115) contains none that clears it. The comment at `:2260-2262` claims the clearing effect "lives further down but is gated on a render-path that only exists past the early return" — it does not exist.

Worse, the notice `<p>` sits **inside the `dates.map` body**, so it renders once per date (its `data-testid` is even date-scoped).

**Impact:** on a 3-night stay, tapping "Use these choices for all remaining days" prints "Applied these choices to 2 remaining days." **three times**, in three different date cards, and it persists for the rest of the session — including after the guest edits a meal, where it falsely implies the copy was applied.

---

## What the 8 Medium fixes changed

**All 8 are FIXED (2026-10-20, branch `fix/october-audit-medium`, decisions #290–#297).**

| ID | Fix | Decision | Regression test |
|---|---|---|---|
| **OCT-M1** | The "Add-ons enabled" master switch is REAL. It persists to `settings/hotelConfig.otherAddOnsEnabled`, the shared normalizer only treats an explicit `false` as "off" (a legacy doc hydrates to `true`), and the public catalog endpoint + the guest Manage page + the guest save path all honour it. The staff path stays open on purpose — the front desk override is deliberate. | #295 | `guest-app/tests/api/oct-m1-addons-master-switch.test.ts` |
| **OCT-M2** | The guest's bed-setup options now match the server's accepted set (`[]`, the same as the shared normalizer and the admin mapper), and the radio group gained an explicit "No preference" option so a guest can never be trapped on a 400. | #290 | `guest-app/tests/api/oct-m2-bed-setup-options.test.ts` |
| **OCT-M3** | ONE shared rule (`isOtherAddOnBookingMutable`) decides whether an other-add-on booking is editable, and all three endpoints call it — the guest path had no check at all. `checked-in` stays mutable. | #291 | `guest-app/tests/api/oct-m3-other-addon-mutable.test.ts` |
| **OCT-M4** | The guest booking flow HAS an Other Add-Ons grid: the enabled catalog below the breakfast section, one quantity input per service date, clamped to the guest count, cut-off honoured. The Step 2 CTA now covers the UNION of breakfast + other add-ons, and the create path rebuilds every selection from the live catalog and persists `otherAddOnSelections` + `otherAddOnTotal` + `hasAnyOtherAddOns`. | #297 | `guest-app/tests/api/oct-m4-guest-other-addons.test.ts` |
| **OCT-M5** | The cut-off is anchored on the BOOKING's check-in in both the write path and the display path, and `AssertNotLockedInput.checkInDate` is now REQUIRED — the `checkInDate \|\| parsed.date` fallback is deleted, so the compiler forces every caller to pass the right anchor. | #292 | `guest-app/tests/api/oct-m5-cutoff-anchor.test.ts` |
| **OCT-M6** | The SET-SBG-01 tripwire now parses `VALID_TAB_IDS`, `SETTINGS_GROUPS` and the flat `tabs` metadata OUT OF the source, so it compares the real union instead of a hardcoded copy with itself. The count is derived (19, not 18) and a tab with no group is caught. | #293 | `admin-app/src/__tests__/set-sbg-01-settings-sidebar-grouping.test.ts` |
| **OCT-M7** | The in-flow hold follows the guest's CURRENT stay: the client detects the mismatch and re-stamps, the server refreshes the stay details — and the DEADLINE does not restart, so a date change can never be used to reset the window the extension cap exists to bound. | #296 | `guest-app/tests/api/oct-m7-in-flow-hold-restamp.test.ts` |
| **OCT-M8** | The breakfast copy confirmation carries the date it belongs to (so it renders exactly ONCE), auto-clears after 8s, and clears the moment the guest edits a meal. | #294 | `guest-app/tests/api/oct-m8-breakfast-copy-notice.test.ts` |

**Deliberately NOT done here:** OCT-M4 does **not** fold the other add-ons into `totalPrice`. `plan/features/OTHER-ADD-ONS.md` decision 2 pins them as additive `Booking` fields that are "added on top of it for the balance" — the same shape the walk-in path (OCT-C5) and the post-booking guest path already write. The Step 2 grid says so in one line, so the guest is not surprised that the transfer is not on the online room bill.

**Observed while fixing OCT-M4, NOT fixed (outside the audit's scope):** the folio balance (`shared/utils/bookingFolio.ts`) reads `addOnNet` from the room-type extra-bed rate only — the other-add-on total is NOT part of the computed balance. That is pre-existing BR-12 v1 behaviour (it is the same for the walk-in and the post-booking purchase), but it means the add-on line is visible in the admin drawer, the Reports → Add-Ons sub-tab and the guest's Manage page, and not in the folio balance. Worth a separate pass.

---

## LOW (6)

- **OCT-L1 — The mobile cart tray is in the page body, not the action area.** `guest-app/src/pages/BookingPage.tsx:4985` renders it as the last element of the Step 1 flow while the footer is `fixed` (`BookingStickyFooter.tsx:58`). Both the call-site comment (`:4981-4984`) and the component docstring (`RoomCartTray.tsx:27-30`) describe a fixed placement the code does not implement. On a phone with 4+ room types, tapping "+" gives no aggregate feedback near the thumb — the MBUX-01 scroll regression re-introduced on Step 1, and MBUX-03's "above the footer **or as part of the action area**" is unmet.
- **OCT-L2 — `setSearchParams` is called inside a `setRoomCart` state updater.** `guest-app/src/pages/BookingPage.tsx:1571` (and `:1602`) dispatches a router update from a React render-phase updater. React 19 warns; the app runs `<React.StrictMode>` (`guest-app/src/main.tsx:15`) so the updater is double-invoked in dev. No data corruption (the write is idempotent), but it sits on the hot quantity-change path.
- **OCT-L3 — The other-add-on total rounds to whole pesos while every other money path uses 2dp.** `shared/utils/otherAddOnTotal.ts:43` → `Math.round(total)`, while breakfast uses `round2` (`shared/utils/breakfastTotal.ts:73`) and the refund-liability amount is computed unrounded (`addons-staff-update.ts:209`). A ₱499.99 add-on bills ₱500 but refunds ₱499.99.
- **OCT-L4 — A guest remove-op on a missing add-on returns 500 instead of 400.** `guest-app/server/handlers/addons-manage-save.ts:257` — `assertSelectionForChange(next, op.selectionKey)` is not wrapped, so the throw escapes the transaction and the outer catch returns a generic 500. The staff handler wraps the same call and returns the correct 400.
- **OCT-L5 — The guest's `breakfastConfig` type omits `imageUrl`.** `guest-app/src/pages/BookingPage.tsx:439` declares the meal shape without `imageUrl`, yet `BreakfastMenuStrip.tsx:9` reads it. It survives only via the `as any` cast at `:1330` — a typed/normalized read path would compile cleanly and silently drop the MBUX-04 thumbnails.
- **OCT-L6 — The committed API bundle is one VERSION behind.** `guest-app/api/[...route].js` carries `VERSION2 = "2.17.0"` vs `shared/VERSION.ts` `"2.17.1"`. Rebuilt and diffed: the **only** difference is that constant, so no server fix is missing from production — but the artifact should be regenerated.

---

## Spec gaps (MD requirement → what the code does)

| Spec requirement | Actual behaviour |
|---|---|
| `BREAKFAST.md:558` — "add `bookings/*/breakfastAudit/*` rules" | No such rule block (0 of 39). The client-side `collectionGroup` read at `ReportsPage.tsx:497` is denied. **OCT-H6** |
| `BREAKFAST.md:411` / BR-12.1 — late-change count = audit entries with `occurredAfterCutoff: true` | The flag is `false` on every override path (`breakfast-staff-update.ts:471`) **and** the read is denied. The metric is 0 twice over. **OCT-H7 + OCT-H6** |
| `BREAKFAST.md:418` — reschedule must auto-cancel out-of-range selections and open refund liabilities | `handleRescheduleBooking` has zero add-on references; keys keep the old dates, `breakfastTotal` carries forward. **OCT-H8** |
| `BREAKFAST.md:419` — cancel must drop unpaid future breakfasts and create `category:"breakfast"` liabilities | `handleCancelBooking` has zero add-on references. **OCT-H8** |
| `BREAKFAST.md` BR-01 — "the `price` is snapshotted" from the catalog | The create path snapshots the **client's** price; only the manage path re-reads `serverPrice` (`breakfast-manage.ts:689`). **OCT-C1** |
| `BREAKFAST.md` BR-08 — refund liability when a paid meal is removed | The predicate is a **per-meal** comparison (`mealPrice > 0 && currentPaidAmount >= mealPrice`, `breakfast-manage.ts:778`) — removing 3 meals from a booking that paid for 1 opens 3 × ₱350 of liability against a ₱350 collection. **OCT-H1 (adjacent)** |
| `BREAKFAST.md` BR-03 — "N dates for N nights" | ✅ in `ManageBreakfastPage.tsx:146` and `WalkinBreakfastGrid.tsx:118`; ✗ in the booking flow. **OCT-H2** |
| `OTHER-ADD-ONS.md:183-186` — Step 2 renders the add-on catalog with per-day quantities; "No add-ons, continue" covers the union | Not implemented — 0 references to `otherAddOn` in `BookingPage.tsx`. **OCT-M4** |
| `OTHER-ADD-ONS.md:226` — "**Both** guest and staff update endpoints reject" read-only bookings | Guest ✅ (`addons-manage-save.ts:170`); staff ✗ (`addons-staff-update.ts:111-118`). **OCT-M3** |
| `OTHER-ADD-ONS.md:116` — cut-off is N hours before the **check-in** date | Falls back to the selection's own date (`otherAddOn-selections.ts:114`); no caller passes `checkInDate`. **OCT-M5** |
| `OTHER-ADD-ONS.md:225` — catalog empty → pre-seed `AIRPORT_TRANSFER_PRESEED` (read-only) | ✅ the constant exists and the public endpoint returns it — but the admin-side pre-seed **write** is blocked by the rules gap. **OCT-C3** |
| `BOOKING-FLOW.md:72` / GOTCHAS 10(e) — every date handed to the calendar is a `TZDate` pinned to the hotel zone | `timeZone` is pinned on `<DayPicker>`, but `isoToTzDate` builds our values in the **browser's** zone, so the cells and our values still disagree — for every guest ahead of Manila. **OCT-C4** |
| `BOOKING-FLOW.md:66` — each adjustment names the limit that actually bound ("horizon-capped" / "nights-clamped") | The reasons exist in the resolver, but the URL seed (`BookingPage.tsx:471-476`) discards them, so neither hint is reachable from a deep link — a >30-night link is silently truncated with no explanation. **OCT-M1 (adjacent)** |
| `BOOKING-FLOW.md:69` (MSL-01) — the cap is admin-editable | Server side fully correct on all three write paths. **Admin side broken** — the editor does not round-trip and a save rewrites the stored policy. **OCT-H3** |
| `BOOKING-FLOW.md:76` — the create endpoint returns 400 for a non-ISO date | Rejects malformed strings; accepts calendar-impossible ones — `new Date("2026-02-31T00:00:00Z")` rolls over to Mar 3, so a booking is stored for a date the caller never sent. `stayRange.ts:35-40` documents this exact trap and the server doesn't use the helper. **LOW** |
| `BOOKING-MOBILE-UX.md` MBUX-03 — "a compact cart tray above the footer **or as part of the action area**" | Tray is the last element of the page flow. **OCT-L1** |
| `BOOKING-MOBILE-UX.md` MBUX-05 — the copy confirmation is a transient `role="status"` message | Never cleared; rendered once per date card. **OCT-M8** |
| `BOOKING-MOBILE-UX.md` MBUX-04 — upload/remove is a working round-trip | Remove produces a Firestore-unwritable payload; upload is local-state-only until a separate Save. **OCT-H5 + OCT-H10** |
| MBUX-18/19 + `FRONTEND.md §Modals` — a dismissible, focus-managed modal surface | `aria-modal="true"` with no focus trap / Escape / scroll lock; the file's own comment cites a keydown listener that does not exist. **OCT-H11** |
| MBUX-09 refusals (corporate audit declaration + vacuum add-on step) | ✅ **Honoured** — declaration intact (`CorporateBookingPage.tsx:2927`), the add-on step is still the deliberate placeholder (`:2305-2330`), no guest-only component imported. |
| FCH-01 (`recordCallHistory` raises a toast on failure) | ✅ **Honoured** — `notify.error(...)` on the failure branch in `AdminContext.tsx`. |
| The consent checkbox (hard rule: Step 2, blocks submission) | ✅ Survived the renumbering — one checkbox at Step 3 (`BookingPage.tsx:3049-3056`, links to `/privacy` + `/terms`); `canContinueToReview` (`:1282`) and `canConfirm` (`:3207`) both require it. Not dropped, not duplicated, not on the wrong step. |

---

## Documentation & process gaps

### Step numbers are stale after the BR-09 renumbering
BR-09 turned the flow into 5 explicit steps (1 Rooms · 2 Add-ons · 3 Guest details · 4 Review · 5 Confirmation — `BookingPage.tsx:152-158`, `:2722`, `:2879`, `:3228`). The October feature MDs written before it were never renumbered:

- `plan/features/SPECIAL-REQUESTS.md` — 7 references to "Step 2" for the special-requests block. In code the block lives in the **guest-details** branch (`BookingPage.tsx:2874` opens it; `SpecialRequestsBlock` at `:3004`) = **Step 3**.
- `plan/features/BREAKFAST.md:299` — "**Step 4 (confirmation):** the confirmation page + email render the breakfast section." Confirmation is now **Step 5**.
- `plan/features/BREAKFAST.md:474` — "Step 3 review + Step 4 confirmation". Review is now Step 4, confirmation Step 5.

`plan/features/OTHER-ADD-ONS.md` is correct (it was written post-BR-09 and says "Step 2 of 5").

### Other October doc defects
- `plan/features/OTHER-ADD-ONS.md` — says "5 new route handlers" in two places; there are **6** (`apiRouter.ts:1353, 1368, 1387, 1411, 1435, 1460` and six `addons-*.ts` handler files).
- `plan/docs/BACKEND.md:308` — a broken link pointing at the Spark Rewards audit report under `plan/project/`; the file actually lives in `plan/docs/`. (`npm run docs:audit` reports it as a broken reference.)
- `plan/features/OTHER-ADD-ONS.md` — missing the `> Requires:` header the repo's MD convention requires.
- `admin-app/src/pages/SettingsPage.tsx:2936-2939` — the comment claims "The Reports late-change metric reads the same collection (via collectionGroup on a top-level `targetCollection: "addOns"` filter)". There is **no** `auditLogs` read anywhere in the admin app; the Reports late-change metric actually reads `bookings/*/otherAddOnAudit/*` (`ReportsPage.tsx:1560-1562`). `auditLogs` is a write-only collection — and one the rules deny.
- `admin-app/src/pages/SettingsPage.tsx:6838-6847` — the comment claims the add-ons toggle has "a localStorage mirror"; it has none.

### 21 decision records are cited but missing from `DECISIONS-FEATURES.md`
The repo's workflow requires every decision to be filed as a numbered entry. **21 decision numbers cited in the October feature docs and the ROADMAP have no entry** in `plan/docs/DECISIONS-FEATURES.md`:

`#135 #175 #181 #199 #200 #201 #203 #204 #208 #211 #212 #221 #222 #223 #224 #225 #237 #252 #254 #256 #257 #262`

(#199–#204 and #135 predate October but are cited from the October MDs; the rest are October's own.)

### The doc system is 19–24× over its own ceilings
`npm run docs:audit` → **20 errors, 1 warning**:

| File | Tokens | Ceiling | Over |
|---|---|---|---|
| `plan/docs/DECISIONS-FEATURES.md` | ~194,378 | 10,000 | **19×** |
| `plan/project/ROADMAP.md` | ~146,270 | 6,000 | **24×** |
| `plan/features/BOOKING-FLOW.md` | ~72,553 | 8,000 | 9× |
| `plan/features/SPARK-REWARDS.md` | ~22,499 | 8,000 | 2.8× |
| `plan/features/BOOKINGS-MANAGEMENT.md` | ~24,152 | 8,000 | 3× |
| `plan/docs/TYPES.md` | ~12,989 | 10,000 | 1.3× |
| `plan/features/BREAKFAST.md` | ~13,251 | 8,000 | 1.7× |
| `plan/features/BOOKING-MOBILE-UX.md` | ~9,660 | 8,000 | 1.2× |
| always-read bundle (CLAUDE.md + GOTCHAS.md) | ~20,907 | 10,000 | 2.1× |

The whole active MD system is ~775,925 tokens. Every agent task pays this at the always-read stage. October's verbose "Recently shipped" ROADMAP entries and 40+ new decision entries drove the growth.

---

## Areas checked and clean

These October areas were audited and found sound — listed so the coverage is known.

- **Transaction read-before-write ordering** — every `runTransaction` body in `guest-app/server` and the admin app was mechanically scanned (47 files): **0** write-before-read violations. No "Firestore transactions require all reads to be executed before all writes" aborts.
- **`onSnapshot` cleanup** — 304 files scanned; **0** listeners without an unsubscribe in `useEffect` cleanup.
- **The committed API bundle** — rebuilt with the repo's own esbuild command and byte-diffed against `guest-app/api/[...route].js`: the only difference is the `VERSION` constant. **No server fix is missing from production.** (OCT-L6 covers the stale constant.)
- **The stay-length cap, server side** — enforced on **all three** write paths before any Firestore work: create (`bookings.ts:1743-1747`), walk-in (`:4580-4584`), reschedule (`:11904-11916`); `handleExtendStay` delegates to reschedule. The server **fails closed** (`loadMaxStayNights`, `:1487-1495` — read errors resolve to the 30-night default, never unlimited). `resolveMaxStayNights` implements the full mapping table correctly: absent → 30, `0` → unlimited, fractional → floored, garbage/negative → 30.
- **Horizon vs. night cap** — kept separate, and the night clamp uses `maxNights` (not `stayCap`). A stay of exactly the cap is allowed on both client and server.
- **Nights arithmetic** — 1 night = check-in D → check-out D+1, consistent across `diffNightsBetweenIso`, `getNumNights`, the picker's summary and the server's `numNights`. No off-by-one, no DST drift.
- **The `classNames` shallow-merge trap** — handled: `classNames={{ root: "rdp-root spark-range-root" }}` keeps `rdp-root`, and the `--rdp-*` → `--spark-primary` mapping lives on the root itself (`guest-app/src/styles.css:60-90`).
- **The calendar is genuinely controlled** — `selected={draft}` + `onSelect={handleSelect}`; rdp's `useControlledValue` takes the controlled branch, so the phantom band cannot recur.
- **The over-cap refusal keeps the check-in, never clamps, and explains itself in both surfaces** — the `role="alert"` renders in the page flow (`:385-389`) *and* in the mobile sheet (`:434-441`).
- **The `EditStayDetailsSheet` does not discard edits** — it wires `onRangeChange`/`onCheckInChange`/`onCheckOutChange`/occupancy straight to the parent (`EditStayDetailsSheet.tsx:126-133` → `BookingPage.tsx:4102-4112`), same `maxStayNights` prop, same rules. The two mounted pickers share the parent's state and neither writes a private copy.
- **The consent gate** — survived the step renumbering; required by both `canContinueToReview` and `canConfirm`.
- **The scroll guard (MBUX-11)** — `App.tsx` tracks previous pathname + previous `step`; a cart mutation changes `search` but not `step`/`pathname`, so it does not scroll, while a genuine step or route change does. Not too narrow.
- **One editable surface on mobile (MBUX-19)** — the aside's picker + steppers are wrapped in `<div className="hidden lg:contents">` (`:4203`), a true `display:none` below `lg`.
- **The hold countdown cannot drift from the server** — derived from the server's `expiresAt` vs `Date.now()` (`useInFlowHold.ts:230-236`), with a 30s resync; `isExpired` honours `status !== "active"`.
- **The savings disclosure (MBUX-13/14)** — sits above the Payment Method card and is open by default; the total chain (subtotal → senior/PWD → voucher → member → points) is correct and the applied voucher really does reduce the amount due.
- **Breakfast thumbnails (MBUX-04)** — a responsive grid (not a carousel), `loading="lazy"`, and a `failedIds` → placeholder fallback on `onError`; a missing photo never breaks the grid.
- **Cart maths** — `rebalanceGuestDistribution` enforces one adult per room, `cartDistributionComplete` catches unassigned guests, `cartFitsGroup` enforces per-type extra-bed caps, `cartHasAvailability` is date-aware.
- **The cut-off boundary** — `now >= cutoffAt` (locked exactly at the cut-off instant) is consistent across the shared helper, the validator and the mark-served handler; `zonedWallClockToUtc` in `breakfastCutoff.ts` is correct.
- **The meal-count model** — a 2-guest 3-night stay produces 6 slots (2 per date × 3 dates) via `enumerateGuestSlots` + `enumerateBreakfastDates`; the walk-in grid agrees.
- **Rate limiting + Turnstile on the new public routes** — all 12 new endpoints are limited in `apiRouter.ts` *before* the handler runs, with distinct keys and 10–120/min per IP; the guest write paths are Turnstile-gated. `POST /api/holds/start` kept a rate limit (30/min) after Turnstile was removed, and `/api/holds/extend` is limited to 10/min.
- **The in-flow hold extension (IMT-02)** — `ExtendBookingHoldSchema` is `.strict()` with exactly two fields (`holdId` + `reservationId`, `shared/schemas/booking.ts:799-804`), so the new window can only come from the hold doc's own `holdMinutes` snapshot (`in-flow-hold.ts:414-418`). `canExtendInFlowHold` (`shared/utils/bookingInFlowHold.ts:161-177`) fails closed on a non-finite or negative counter, rejects disallowed statuses, and caps at `MAX_IN_FLOW_HOLD_EXTENSIONS`.
- **The Janitor sweep's cron** — `guest-app/vercel.json` schedules `/api/holds/expire` at `0 1 * * *` and `/api/holds/sweep` at `0 2 * * *` — both **daily**, matching the Hobby-plan change the handler documents (`in-flow-hold.ts:503-505`). Three crons total, well inside the 12-function cap.
- **Calendar bulk blocks + staff inventory holds (the 2026-10-19 commit)** — every create path uses `runTransaction` and checks **all three** conflict sources before writing: active bookings, active blocks, and active staff holds (`room-blocks.ts:65-97`, `staff-inventory-holds.ts:109-153`). A block is enforced in the **booking transaction**, not just the availability search (`bookings.ts:946-971` → `transaction.get`), so it cannot be raced. The walk-in path passes the staff's own hold as an exemption (`bookings.ts:5021` → `allowedStaffHoldId`) while still verifying the hold belongs to the requesting staff member, is unexpired, and matches the exact dates and room set (`:4716-4741`). The new `staffInventoryHolds` rule is staff-read-only with no client writes.
- **Staff auth on the new write endpoints** — `authenticateStaff` precedes every staff handler; the new `room-blocks` and `staff-inventory-holds` routes are admin-gated with rate limits.
- **Route ordering** — the specific `breakfast-*`/`addons-*` blocks precede the generic `breakfast-config`/`addons-config` catch-alls; no shadowing. All 6 `addons-*` handlers are wired.
- **The SR server validation** — `bedSetup` is validated against the **live** `hotelConfig.roomTypes[i].bedSetupValues` (not a client-supplied list), `additionalPreferences` against the live catalog, `expectedArrivalTime` against the generated options; the corporate path mirrors `bedSetup` onto every child booking. No client trust in the catalog.
- **PII** — the new guest breakfast/add-on endpoints strip `guestName`/`guestEmail` and never echo the lookup token; no PII in the new log statements; no payment-proof URL is exposed in the guest app.
- **Brand rules** — no hardcoded hex colours and no hardcoded brand names in October-touched UI files (the only matches are a canvas fill and a Tailwind arbitrary shadow value).
- **`spec:audit`** — 163 handler mentions across 36 spec files, all resolved. **`check:api-bundle`** — clean.
- **MBUX-09's two refusals** and **FCH-01** — both honoured.

---

## Method & limits

**Verified by execution (Node):** the `enumerateBreakfastDates` timezone shift (OCT-H2), the `TZDate` round-trip shift (OCT-C4), the Zod retention of an `undefined`-valued key (OCT-H5), the Firestore SDK's `Unsupported field value: undefined` throw path, and the 5,130-test / typecheck baseline.

**Verified by reading every cited line:** all other findings.

**Limits.**
- No jsdom/RTL harness exists in the repo, so DOM-level findings (OCT-H11, OCT-M8, OCT-L1, and the mobile sheet layering) are derived from source + CSS reasoning, not observed rendering. Confirm on a device before scheduling.
- The Firestore emulator cannot start in this environment (no Java runtime), so the rules findings (OCT-C3, OCT-H6) are derived from the rules file's semantics. `git log -S` confirms the collections have never had a rule block, and the rules file's own comments document the same denial for a sibling collection.
- No live Firebase/Vercel deployment was exercised.
- The `verify` scripts in `tmp/` (`tx-audit.mjs`, `unsub-audit.mjs`) are throwaway audit helpers, not part of the repo's test suite.

**Scope coverage.** Four feature blocks were audited line-by-line (breakfast + other add-ons, date range + stay cap, mobile booking UX, special requests / VAT / settings grouping). The fifth — the in-flow hold, the extension flow, the staff inventory holds and the calendar bulk blocks — was audited directly by the parent with the same invariants; the results are in "Areas checked and clean". The mechanical sweeps (transaction ordering, `onSnapshot` cleanup) ran across every server and app file, not just the October diff.
