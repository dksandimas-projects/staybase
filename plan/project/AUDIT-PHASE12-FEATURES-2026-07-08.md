# Phase 12 Features Audit — 2026-07-08

> Post-ship audit of the six features that landed on `dev` on 2026-07-08:
> booking calendar + room blocks + reschedule (`90607b6`), rate calendar +
> seasonal rate overrides (`ab180c5`), early check-in approval workflow
> (`a68e045`), dashboard intercom widget (`b5998e0`), email previews +
> breakfast silog CRUD (`9eb9c79`), and staff account editing (`d877ffe`).
> Read-only at audit time.
>
> Workspace: staybase
> Audited: 2026-07-08 (branch `dev`, HEAD `ab180c5`)
> Method: read-only — traced the feature commits end-to-end across
> `admin-app/src/pages/{CalendarPage,RatesPage,BookingsPage,DashboardPage,IntercomInboxPage,SettingsPage}.tsx`,
> `admin-app/src/context/AdminContext.tsx`,
> `guest-app/server/apiRouter.ts`,
> `guest-app/server/handlers/{bookings,room-blocks,rooms,email,admin}.ts`,
> `guest-app/src/pages/BookingPage.tsx`, `guest-app/src/hooks/useRoomTypes.ts`,
> `shared/utils/seasonalRates.ts`, `shared/types/index.ts`, and
> `firebase/firestore.rules`. Verified the committed API bundle is
> byte-identical to a fresh `esbuild` of `server/apiRouter.ts`. Ran all
> test suites (admin-app 618, shared 104, guest-app 298 — all green) and
> `tsc -b` in both apps (clean).
>
> **Convention:** findings are numbered `PF-<n>` (Phase-12 Features).
> Severity matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is
> `Open` until the remediation branch updates this doc with the fix and
> verification.

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | **0** |
| **SEV-2 (major)** | 3 | 0 | **3** |
| **SEV-3 (minor)** | 4 | 0 | **4** |
| **SEV-4 (nit / polish)** | 4 | 0 | **4** |
| **Total** | **11** | **0** | **11** |

No SEV-1s: every new endpoint is staff-authenticated and rate-limited,
all availability writes use Firestore transactions with cross-checks in
both directions (bookings ↔ room blocks), `roomBlocks` client writes are
denied by rules, and email templates escape all interpolated values.

The three SEV-2s each make a shipped UI control non-functional or produce
wrong money/wrong guest-facing information:

1. **Editing a room block always fails** (PF-01) — the client never sends
   `roomId`, which the server schema requires, so every "Update block"
   returns 400.
2. **The staff "Confirmed Check-In Time" is silently discarded** (PF-02) —
   the approval email always shows the guest's originally requested time,
   not the time staff actually approved.
3. **Rescheduling never re-prices the booking** (PF-03) — nights and even
   room type change but `totalPrice`/`ratePerNight`/breakfast totals stay
   stale; no capacity check against the target room; no guest notification.

### Fix order

1. PF-01 (block edit broken — one-line client or server schema fix)
2. PF-02 (guest told wrong approved time)
3. PF-03 (stale pricing after reschedule)
4. PF-04..PF-07 (SEV-3 batch)
5. PF-08..PF-11 (SEV-4 polish, fold into other work)

---

## SEV-2 — Major

### PF-01 — Editing a room block always fails with 400 · `Open`

**Feature:** Booking calendar (`90607b6`)
**Where:**
- `admin-app/src/pages/CalendarPage.tsx:299` (`handleUpdateBlock`)
- `admin-app/src/context/AdminContext.tsx:1198` (`updateRoomBlock`)
- `guest-app/server/handlers/room-blocks.ts:16` (`updateBlockSchema`)

`handleUpdateBlock` calls `updateRoomBlock({ blockId, startDate, endDate,
reason, notes })`. The `AdminContext.updateRoomBlock` input type does not
accept `roomId` at all, so it is never sent. But the server's
`updateBlockSchema` extends the create schema (`blockSchema.extend`), which
**requires** `roomId` (`z.string().trim().min(1)`). Zod parsing fails and
every block edit returns 400 *"Please provide valid block details."* The
Update Block drawer is fully non-functional; the only workaround is
cancel + recreate.

**Fix:** either pass `selectedBlock.roomId` through the context call, or
make `roomId` optional in `updateBlockSchema` and derive it from the
existing block doc inside the transaction (the handler already reads the
block doc first). Server-side derivation is safer — it prevents a client
from moving a block to a different room while skipping the room's
existence/active checks.

### PF-02 — Staff "Confirmed Check-In Time" never reaches the server or the guest · `Open`

**Feature:** Early check-in approval (`a68e045`)
**Where:**
- `admin-app/src/pages/BookingsPage.tsx:2387` (time `<select>`)
- `admin-app/src/pages/BookingsPage.tsx:2425` (submit call)
- `admin-app/src/context/AdminContext.tsx` (`resolveEarlyCheckin` — no time param)
- `guest-app/server/handlers/bookings.ts` (`handleResolveEarlyCheckin` — no time param)
- `guest-app/server/handlers/email.ts:508` (`earlyCheckinResolveEmail` renders `requestedTime`)

The approval form renders a "Confirmed Check-In Time" picker
(`earlyCheckInTimeOverride`, options 08:00 AM–01:00 PM), but the submit
only sends `(bookingId, status, staffNote)`. The context function and the
server handler have no time parameter, and the resolution email renders
`booking.earlyCheckIn.requestedTime`. If a guest requests 8:00 AM and
staff approve for 12:00 PM, the guest's email says their 8:00 AM request
was approved.

**Fix:** thread a `confirmedTime` field through
`resolveEarlyCheckin` → `POST /api/bookings/early-checkin-resolve` →
`handleResolveEarlyCheckin` (validate against a whitelist or `HH:MM AM/PM`
regex), persist it on the `earlyCheckIn` map, and prefer it over
`requestedTime` in `earlyCheckinResolveEmail` + the guest-side status
display in `RewardsPage.tsx`. Update
`plan/features/SPARK-REWARDS.md §Early Check-In Approval Workflow` and
`plan/docs/TYPES.md` (`EarlyCheckInDetails`) with the new field.

### PF-03 — Reschedule never re-prices; no capacity check; no guest notification · `Open`

**Feature:** Booking calendar (`90607b6`)
**Where:** `guest-app/server/handlers/bookings.ts` (`handleRescheduleBooking`)

`handleRescheduleBooking` updates `checkIn`, `checkOut`, `numNights`,
`roomId`, `roomNumber`, and `roomType` — a booking can be moved to more
nights *and* a different room class — but leaves `totalPrice`,
`ratePerNight`, `originalTotalPrice`, and breakfast totals untouched. A
2-night booking moved to 4 nights keeps the 2-night price, and the
`numNights` field no longer agrees with the stored totals. The move
drawer in `CalendarPage.tsx` gives no warning either way. Two adjacent
gaps in the same handler:

- **No capacity check** — `numGuests` is never validated against the
  target room type's `maxCapacity`, so a 4-guest booking can be moved
  into a 2-person room.
- **No guest email** — the guest is not notified that their dates/room
  changed (every other guest-affecting mutation sends a trigger).

**Fix (decide first):** if keep-the-original-price is the intended
business rule (staff goodwill moves), state it in
`plan/features/BOOKINGS-MANAGEMENT.md`, show the stale-price note in the
move drawer, and still add the capacity check. Otherwise recompute totals
server-side with `calculateSeasonalAwareRoomTotal` (as create/walk-in
already do) and store the delta in `rescheduleHistory`. Either way,
consider a `booking-rescheduled` email trigger (or reuse
`booking-confirmed` with updated dates).

---

## SEV-3 — Minor

### PF-04 — Guest availability endpoint ignores room blocks · `Open`

**Feature:** Booking calendar (`90607b6`)
**Where:** `guest-app/server/handlers/rooms.ts:81` (`handleRoomAvailability`)

The guest-side availability endpoint returns only booking ranges. Active
`roomBlocks` are invisible to it, so when all rooms of a type are blocked
(e.g. maintenance week), guests can still select those dates, complete
Steps 1–3, and only fail at Confirm ("no rooms available"). The
transaction safety net holds — this is a dead-end-UX gap, not a
double-booking risk. **Fix:** merge active blocks into the returned
`bookedRanges` (roomId + start + end; no PII involved). Update
`plan/features/AVAILABILITY-LOCKING.md` when done.

### PF-05 — Walk-in placeholder emails hard-bounce through Resend · `Open`

**Feature:** Booking calendar (`90607b6`) — pre-existing pattern extended
**Where:**
- `admin-app/src/pages/CalendarPage.tsx:202` (`calendar-<ts>@example.invalid`)
- `admin-app/src/pages/BookingsPage.tsx:1457` (`walkin-<ts>@example.invalid`)
- `guest-app/server/handlers/bookings.ts:1288` (walk-in confirmed → `sendBookingTrigger`)

Both walk-in creation paths substitute `@example.invalid` when staff leave
the email blank, and the walk-in handler fires a real `booking-confirmed`
email whenever the resolved status is `confirmed` (the calendar path
always creates as `confirmed`). `.invalid` never resolves, so every such
send is a guaranteed hard bounce through Resend — repeated bounces degrade
sender reputation for all guest email. **Fix:** add a guard in
`sendEmail` (or `sendBookingTrigger`) that skips recipients ending in
`@example.invalid`. One shared guard fixes both call sites and any future
placeholder use.

### PF-06 — Early check-in inputs are unvalidated · `Open`

**Feature:** Early check-in approval (`a68e045`)
**Where:**
- `guest-app/server/handlers/email.ts:963` (`early-checkin-request` — `requestedCheckInTime`, `notes`)
- `guest-app/server/handlers/bookings.ts` (`handleResolveEarlyCheckin` — `staffNote`)

Unlike the other handlers (which use Zod), the request handler persists
`req.body.request.requestedCheckInTime` and `notes` with no type or
length check, and the resolve handler does the same for `staffNote`. An
authenticated member/staff caller can write arbitrarily large or
non-string payloads onto the booking doc. All values are HTML-escaped in
emails, so this is data hygiene, not injection. **Fix:** Zod schema —
`requestedCheckInTime` max ~20 chars, `notes`/`staffNote` `string().max(500)`.

### PF-07 — `npm test --workspaces` silently skips guest-app's 298 tests · `Open`

**Where:** `guest-app/package.json` (no `test` script)

`guest-app` has `test:api` but no `test` script, so the workspace-wide
test run covers only admin-app (618) and shared (104). The 298 guest-app
tests pass when run directly with `npx vitest run`, but any CI habit or
pre-merge checklist built on `npm test --workspaces` is blind to them.
**Fix:** add `"test": "vitest run"` to `guest-app/package.json`.

---

## SEV-4 — Nit / Polish

### PF-08 — Calendar "today" uses UTC, not `config.timezone` · `Open`

**Where:** `admin-app/src/pages/CalendarPage.tsx:78`

`todayKey = toDateKey(new Date())` takes the UTC date, so before
8:00 AM Manila the 14-day window starts on yesterday. `DashboardPage.tsx`
already has a `config.timezone`-aware `toLocalDateKey` helper worth
extracting and reusing.

### PF-09 — Seasonal overrides: whole-array writes clobber concurrent edits; toggle/delete unhandled on failure · `Open`

**Where:** `admin-app/src/pages/RatesPage.tsx:222` (`saveSeasonalOverrides`), `:280` (`toggleSeasonalActive`), `:287` (`deleteSeasonalOverride`)

Every save writes the full `seasonalRateOverrides` array to
`settings/hotelConfig`, so two admins editing concurrently lose each
other's changes (last write wins). `toggleSeasonalActive` and
`deleteSeasonalOverride` also lack the try/catch + toast that the add
path has — a failed write rejects silently. Low urgency for a
single-admin boutique hotel; note it before white-label deployments.

### PF-10 — New `earlyCheckinResolveEmail` template is not previewable · `Open`

**Where:** `guest-app/server/handlers/email.ts` (`handleEmailPreview` switch)

The email preview endpoint (`9eb9c79`) predates the resolve template
(`a68e045`) and its switch was never extended, so approve/decline is the
one guest email staff cannot preview from Settings. **Fix:** add an
`early-checkin-resolve` case with mock booking + `status`/`staffNote`
mock args, and the matching entry in the SettingsPage preview list.

### PF-11 — Intercom deep-link can race the threads snapshot · `Open`

**Where:** `admin-app/src/pages/IntercomInboxPage.tsx:41`

The `?room=` deep-link effect (from the dashboard widget, `b5998e0`)
deletes the query param on its first run. If `intercomThreads` has not
loaded yet, `thread` is `undefined`, the auto-switch to the "resolved"
filter never happens, and a deep-link to a resolved thread lands on an
empty-looking list. **Fix:** don't clear the param until
`intercomThreads` contains the room (or gate the effect on a
threads-loaded flag).

---

## Verified clean

Checked and found correct — no action needed:

- **Transactions everywhere** — block create/update, booking auto-assign,
  walk-in, and reschedule all run in `runTransaction` and cross-check
  bookings ↔ active blocks in both directions with consistent half-open
  date ranges (`start < bEnd && end > bStart`). No read-after-write
  ordering violations (the BR-01 pattern) in any new transaction.
- **Auth + rate limits** — `bookings/reschedule` (30/min),
  `room-blocks/*` (60/min), `email/preview` (30/min),
  `bookings/early-checkin-resolve` (30/min) all require staff tokens;
  `admin/update-staff` (10/min) additionally requires `role === "admin"`.
- **Firestore rules** — `roomBlocks` allows staff reads only; all client
  writes denied (API-only via Admin SDK). `settings` writes remain
  admin-only, covering the seasonal-override and breakfast-menu saves.
- **Early check-in request hardening** — tokenless fallback removed;
  member requests enforce guest-email match, `confirmed` status, and
  future check-in date; re-request blocked after approval.
- **Staff editing** — last-active-admin protection, self-demotion guard,
  Auth + Firestore updated together, email preview endpoint uses mock
  data only.
- **Email HTML escaping** — every interpolated value in the new and
  existing templates passes through `escapeHtml`.
- **Seasonal rate math** — guest BookingPage, admin CalendarPage/RatesPage,
  and both server booking paths all use the shared
  `calculateSeasonalAwareRoomTotal`; corporate bookings intentionally keep
  contract pricing.
- **API bundle** — committed `guest-app/api/[...route].js` is
  byte-identical to a fresh esbuild of `server/apiRouter.ts`.
- **Tests / types** — admin-app 618, shared 104, guest-app 298 all
  passing; `tsc -b` clean in both apps.
