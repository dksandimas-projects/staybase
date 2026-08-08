# Booking Unified — Denormalize Rooms into the Booking Doc

> Requires: CLAUDE.md, plan/docs/BACKEND.md, plan/docs/TYPES.md, plan/docs/API-ROUTES.md, plan/features/BOOKINGS-MANAGEMENT.md
>
> **Status:** ⏸ Deferred. Spec only. **Trigger conditions:** all three in `§Step 0` must hold — MRB-15 fully shipped (✅ 2026-08-03), team bandwidth for a 6-month solo / 2-month 3-engineer refactor with no P0 work in flight, and the next multi-room feature on the roadmap. Conditions 2 + 3 are the open ones.
>
> **Spec author:** FOL-05 follow-up conversation (2026-08-07). See `plan/docs/DECISIONS-FEATURES.md #201` (the FOL-05 decision record) for the immediate context — FOL-05 ships the right patch for the "one row for verification per room" bug; this doc captures the longer-term shape that would make the FOL-05 sibling-flip pass + the FOL-03 reads-before-writes complexity + the MRB-15-03 counter-proliferation go away entirely.
>
> **Companion:** the FOL-05 source-text tests in `guest-app/tests/api/fol-05-verify-reservation-scope.test.ts` + `admin-app/src/__tests__/fol-05-dashboard-pending-payments.test.ts` are the contract the refactor will retire. They will be deleted as part of step 6 below.

---

## Why

The post-MRB-01 reservation has been growing responsibilities across every subsequent MRB:

| Step | What got added to the reservation | Source |
|---|---|---|
| MRB-01 | `reservations/{id}` header with `reservationRef`, lead guest, dates, money, `paymentStatus` aggregate | `guest-app/server/handlers/bookings.ts` |
| MRB-04 Phase 2 | `reservations/{id}/payments/{paymentId}` subcollection (canonical money path) | `handleVerifyAndRecordPayment` + `handleAddPayment` |
| MRB-04 Phase 2.x | `reservations/{id}/refunds/{refundId}` subcollection | `handleAddRefund` |
| MRB-05 | Aggregate `paymentStatus` mirror (N>1 helper) | `shared/utils/bookingFolio.ts` |
| MRB-07 | Reservation-aware BookingsPage row + admin creation | `admin-app/src/pages/BookingsPage.tsx` |
| MRB-08 | `usageCount += N` corporate / voucher counter on reservation | `handleCreateBooking` + `handleCreateWalkin` |
| MRB-09 | `buildReservationEmailView` — emails render from the reservation | `shared/utils/emailView.ts` |
| MRB-12 | `subscribeToReservations` listener + `collectionGroup("payments")` aggregate for `reservationPaidAmount` | `admin-app/src/context/AdminContext.tsx` |
| MRB-13 | Reservation-scope cancel (`scope: "reservation"`) — one transaction, N children | `handleCancelBooking` |
| MRB-14 | `actualDateRange` (MIN/MAX children's dates), `add-room` endpoint, per-child dates UI | `handleRescheduleBooking` + `handleAddRoomToReservation` |
| MRB-15-03 | Transactional counters (`roomCount` / `activeRoomCount` / `cancelledRoomCount` / `checkedInRoomCount` / `checkedOutRoomCount`) | All 5 lifecycle handlers |
| CRL-07 | `cancellationLiability` snapshot on the header | `handleCancelBooking` |
| CRL-08 | Refund-state emails + Notifications + Reports Liability tab | `handleAddRefund` + `handleCancelBooking` |
| **FOL-05** | **Sibling-flip pass in verify / add-payment / reject (the "one click = whole reservation" fix)** | **All 3 payment handlers** |
| **FOL-03** | **Reads-before-writes ordering in check-in / check-out** | **`handleCheckinBooking` + `handleCheckoutBooking`** |

That's 16 separate steps where the "reservation" went from "thin wrapper over children" (the MRB-01 marketing) to "full first-class entity with its own subcollections, denormalized counters, and derived status projection." Every "what does this action do for N>1?" question now needs the same shape of fix: pre-read children, build a per-child post-update status array, queue N `transaction.update` calls, write a header mirror. FOL-03 + FOL-05 are the two surface-level examples; the same shape will need to apply to every future multi-room action (apply discount, partial refund, etc.).

The deeper smell: **two sources of truth for the same thing**. Money lives at the reservation scope (`reservations/{id}/payments/{paymentId}`). Per-child `status` flips are per-booking-doc. The header's `paymentStatus` is a derived projection of the children. FOL-05 made the projection correct, but the indirection is real — every payment handler now has ~70 lines of "iterate N children" boilerplate that does nothing for the N=1 case.

**The refactor: one booking, one lifecycle, one payment path, N rooms in an array.** The reservation IS the booking; the wrapper goes away.

---

## Target shape (post-refactor)

### Firestore

```
bookings/{bookingId}                     # ONE doc per customer-facing reservation
  - id: string
  - bookingRef: "R-20260807-00012"        # Renamed from "SI-..." to the reservation ref; same wire
  - leadGuestName, leadGuestEmail, leadGuestPhone
  - checkIn, checkOut, numNights         # Shared dates (immutable snapshot per MRB-14)
  - originalSubtotal, subtotal, totalPrice
  - source, isCorporate, corporateCode, companyName, voucherCode, memberDiscountPct
  - paymentStatus, paymentMethod
  - paymentProofUrl, paymentProofPath
  - termsAccepted, termsAcceptedAt, termsVersion
  - privacyAccepted, privacyAcceptedAt, privacyVersion
  - holdExpiresAt
  - fingerprint                           # Per MRB-02 idempotency
  - memberId
  - createdAt, updatedAt
  - actualDateRange                       # Per MRB-14
  - cancellationLiability                 # Per CRL-07
  - rooms: [                              # NEW — the per-room lines
    {
      roomId: string
      roomNumber: string
      roomType: string
      numAdults: number
      numChildren: number
      extraBedCount: number
      hasBreakfast: boolean
      totalPrice: number
      status: "pending" | "payment-uploaded" | "payment-confirmed" | "confirmed" | "checked-in" | "checked-out" | "cancelled"
      position: number                    # 1-indexed; the original MRB-07 ordinal
      rateBreakdown: ...                  # Per MRB-11
      revenueAllocation: ...              # Per MRB-11
    },
    ...
  ]

bookings/{bookingId}/payments/{paymentId}      # MOVED from reservations/{id}/payments/
bookings/{bookingId}/refunds/{refundId}        # MOVED from reservations/{id}/refunds/
bookings/{bookingId}/charges/{chargeId}        # MOVED from reservations/{id}/charges/
                                               # (the folio incidental/store charges; the
                                               #  `bookings/{id}/charges/` path already exists
                                               #  for legacy null-`reservationId` bookings —
                                               #  post-refactor it is the only path)

# GONE
# reservations/{id}                              # The wrapper doc
# reservations/{id}/payments/                    # Moved
# reservations/{id}/refunds/                     # Moved
# reservations/{id}/charges/                     # Moved
# reservations/{id}.cancellationLiability        # Moved
# reservations/{id}.roomCount, .activeRoomCount,
#   .cancelledRoomCount, .checkedInRoomCount,
#   .checkedOutRoomCount                          # Derived from rooms[] on-read
# reservations/{id}.paymentStatus                # Derived from rooms[].status on-read
```

### Wire contract

- `Booking.rooms: BookingRoomLine[]` is the source of truth for per-room state. **Name it `BookingRoomLine`, not `RoomLine`** — the codebase already has `WalkinRoomLineInput` (`shared/schemas/booking.ts`, a create-payload line) and `FingerprintableRoomLine` (`shared/utils/reservationFingerprint.ts`, an idempotency-hash line). A bare `RoomLine` reads as a fourth synonym for three different things; the persisted per-room state deserves its own unambiguous name.
- The booking's effective `status` = derived from `rooms[]`:
  - All `cancelled` → `"cancelled"`
  - Any `pending` or `payment-uploaded` → `"awaiting-payment"` (read-side "Awaiting" pill)
  - All `payment-confirmed` or `confirmed` → `"confirmed"`
  - Any `checked-out` → `"completed"`
  - Mixed `confirmed` / `checked-in` → `"in-house"`
  - Default fall-through → `"in-house"` (per MRB-05's defensive posture)
- Counter fields (`roomCount` etc.) are derived on-read: `rooms.length`, `rooms.filter(r => r.status === "cancelled").length`, etc. **No denormalized counter fields anywhere.**

---

## Migration steps

Each step is independently shippable. Don't batch. **Reversibility is not uniform — only step 3 is flag-gated:**

| Steps | Reversal mechanism |
|---|---|
| 1-2 | Additive only — revert the commit; the `rooms` field is unread. |
| 3 | Feature flag `BOOKING_UNIFIED_READ_ROOMS_ENABLED` (see step 3 — the flag mechanism does not exist yet and must be built in this step). |
| 4-5 | Dual-source reads — the legacy `reservations/{id}/…` paths still hold the data; revert the write path. |
| 6 | **No flag.** Recovery is the `reservations_archive/` 90-day window + the pre-step production backup. |

### Step 0 — Spec sign-off (no code)

**Owner:** TBD. **Gate:** approved plan + assigned MRB number.

- Review this spec with the team.
- Decide: do we keep the `reservations/{id}` doc for the migration window as a read-through fallback, or delete it in step 6?
- ✅ Done 2026-08-08: decision record `#202` filed in `plan/docs/DECISIONS-FEATURES.md`; roadmap row + BAR-01-00..07 task breakdown in `plan/project/ROADMAP.md`.
- Still open: team review, the read-through-fallback decision above, the MRB ticket number (e.g. **MRB-16**), the `plan/docs/GOTCHAS.md` "two sources of truth" entry, and pointing `plan/features/BOOKINGS-MANAGEMENT.md` at this spec.

**Trigger conditions for starting the migration:**
- MRB-15 has fully shipped (the lifecycle invariants + counters work is the natural milestone). ✅ 2026-08-03.
- The team has bandwidth for a multi-week refactor (no other P0 work in flight).
- The next "multi-room" feature (apply-discount, partial refund, etc.) is on the roadmap — refactor first, then the new feature ships on the new shape.
- **Availability has moved off per-room-doc conflict checks** *(added by the 2026-08-08 audit)*. Today the double-booking transaction queries `bookings where roomId == X and status in ROOM_OCCUPYING_STATUSES` and filters date overlap in memory; there are 9 `where("roomId", …)` call sites across booking creation, room blocks, and corporate inquiries. Collapsing the children into `rooms[]` removes the queryable per-room row — `roomId` needs a denormalized `roomIds: string[]` for `array-contains`, per-room `status` can no longer be filtered server-side, and per-room date divergence (MRB-14 `actualDateRange`) can't be indexed. This shape only pays off once availability is room-type inventory (free units per type per night) rather than per-room conflict checks. **Until then, BAR-01 makes the system's most safety-critical transaction harder.**
- **BAR-02 + BAR-03 have shipped and the pain persists.** See `plan/project/ROADMAP.md §BAR` — deriving the counters and extracting the sibling-flip helper capture most of the day-to-day relief with no data migration. Start BAR-01 only on evidence from real multi-room features after those land, not on the −1,200-line estimate.

### Step 1 — Add `rooms: BookingRoomLine[]` to the Booking type (dual-write, no read change)

**Branch:** `feature/booking-unified-step-1-rooms-array`. **Migration risk:** zero (purely additive).

- Define `BookingRoomLine` in `shared/types/index.ts` (see the shape above; the name avoids colliding with the existing `WalkinRoomLineInput` + `FingerprintableRoomLine`).
- Add `rooms?: BookingRoomLine[]` to the `Booking` interface (optional for back-compat; the field is missing for legacy bookings).
- Update every create / write path to populate `rooms` on the "primary" booking (the first child, picked by `reservationPosition === 1`):
  - `handleCreateBooking` — `rooms: assignedRooms.map((r, i) => ({ roomId: r.roomId, position: i + 1, status: "pending", ... }))`
  - `handleCreateWalkin` — same shape
  - `handleRescheduleBooking` — mutate the corresponding `rooms[i]` entry's `checkIn` / `checkOut` (the per-child dates)
  - `handleAddRoomToReservation` — push a new entry into `rooms[]`
  - `handleCancelBooking` — set the cancelled children's `status: "cancelled"` in `rooms[]`
  - `handleCheckinBooking` + `handleCheckoutBooking` — flip the target child's `status`
- Reads are unchanged. The `rooms` field is written but never read yet.
- **Tests:** new `shared/__tests__/booking-unified-step-1.test.ts` — the new field is in the type, the create paths populate it, the reschedule / cancel / checkin / checkout paths update it. The 4 lifecycle paths write the field even for N=1 (zero behavioural diff).

**Ship when:** every booking doc has `rooms` populated for new creates.

### Step 2 — Backfill existing reservations

**Branch:** `feature/booking-unified-step-2-backfill`. **Migration risk:** low (one-shot script, reversible).

- One-shot script (admin endpoint or `scripts/backfill-rooms-array.mjs` — the repo's one-shot scripts live in top-level `scripts/`, e.g. `scripts/seed-firestore.ts` + `scripts/finance-integrity-scan.ts`; `firebase/` holds rules, indexes, and emulator tests only):
  - For every `reservations/{id}` doc, read the children via `where("reservationId", "==", id)`.
  - Build the `rooms[]` array from the children, sorted by `reservationPosition`.
  - Write `rooms` to the primary child's doc (`reservationPosition === 1`).
- Run in dry-run mode first (log the planned writes, don't actually write).
- Schedule a one-time staging run, then production.
- **Tests:** the backfill is correct (the rooms array matches the children), idempotent (running twice produces the same result), and handles edge cases (no children, all cancelled, mixed statuses).

**Ship when:** every existing booking has `rooms` populated.

### Step 3 — Switch payment reads to prefer `rooms[]` over children

**Branch:** `feature/booking-unified-step-3-read-rooms`. **Migration risk:** low (read-only, behind a feature flag).

- The `getReservationFolioSummary` helper (or whatever the read path is) reads `booking.rooms[]` first, falls back to the children list.
- The BookingsPage reservation row reads the room count from `rooms.length` (or derived counter).
- The dashboard's `pendingPaymentItems` useMemo reads from `rooms[]` directly (no `pendingPayments = bookings.filter(...)` + sibling grouping).
- Wrap in a feature flag: `BOOKING_UNIFIED_READ_ROOMS_ENABLED` (default off, then on, then never off again). **There is no feature-flag mechanism in the codebase today** — no `*_ENABLED` flag exists in any app. Build the smallest one that works in this step: a server-side env var read once in `guest-app/server/handlers/bookings.ts` (Vercel project env, mirrored in `plan/docs/ENV-SETUP.md`) plus a `VITE_`-prefixed mirror for the admin read paths. Do not invent a per-doc or Firestore-config flag — a global env var is sufficient for a 7-step migration.
- **Tests:** the new read path is byte-equivalent to the old path for the N=1 + legacy null-`reservationId` cases. The N>1 case reads the per-room status from `rooms[]` and computes the same totals as the current `collectionGroup("payments")` aggregate.

**Ship when:** the read flag has been on for 1 week with no rollbacks.

### Step 4 — Move payments subcollection from reservations to bookings

**Branch:** `feature/booking-unified-step-4-payments-path`. **Migration risk:** medium (write path moves, but reads dual-source).

- New verify / add-payment writes go to `bookings/{primaryId}/payments/`.
- The canonical path is now `bookings/{id}/payments/`. The legacy `reservations/{id}/payments/` path is deprecated but readable (for the migration window).
- The sibling-flip pass (FOL-05's ~200 lines) STAYS until step 6 (the rooms[] is local now but the FOL-05 pattern is still in use). Step 4 is "where do the payment records live", not "how do we flip the children".
- The new `siblingFlippedCount` is now a `roomsFlippedCount` (or just `flippedCount`) — the count of `rooms[]` entries that transitioned.
- **Security rules (`firebase/firestore.rules`) ship in the same PR.** The `match /reservations/{reservationId}/payments/{paymentId}` block is mirrored onto `bookings/{bookingId}/payments/{paymentId}` — the existing legacy `bookings/{id}/payments/` block is narrower than the reservation-scoped one (see the negative-amount filter note at the bottom of the rules file) and must be widened to the full canonical contract before the first write lands. Keep the reservation block readable until step 6. Check `firebase/firestore.indexes.json` for any `payments` collection-group index that assumes the reservation parent.
- **Tests:** the new write path is correct (the payment record lives under the booking), the read path reads from the booking's payments (with the legacy `reservations/{id}/payments/` as fallback), the MRB-04 Phase 2 / Phase 2.x tests still pass, and the `firebase/tests` emulator suite covers write-allow / write-deny on the new path.

**Ship when:** every new payment lives under the booking.

### Step 5 — Move refunds, charges, liability, email view

**Branch:** `feature/booking-unified-step-5-ancillary-paths`. **Migration risk:** medium (multiple write paths move, reads dual-source).

- Refunds: `reservations/{id}/refunds/` → `bookings/{id}/refunds/`
- **Charges: `reservations/{id}/charges/` → `bookings/{id}/charges/`.** The folio charge path is reservation-scoped for N>1 and booking-scoped for legacy null-`reservationId` bookings — the dual-source read is in `admin-app/src/pages/BookingsPage.tsx` (the folio charge reads + the void/reversal write), the transactional read is in `guest-app/server/handlers/bookings.ts`, and `admin-app/src/pages/ReportsPage.tsx` reads them through `collectionGroup("charges")` for the Sales → Charges tab. Post-move, `bookings/{id}/charges/` is the only path and the collection-group read still works unchanged (same subcollection name, new parent). `guest-app/server/handlers/test-runs.ts` enumerates the charge subcollections for TEST DATA cleanup + verification — update its path list in the same PR or the reset sweep will miss rows.
- Liability: `reservations/{id}.cancellationLiability` → `bookings/{id}.cancellationLiability`
- Email view: read from booking + rooms[] instead of reservation + children.
- The BookingsPage reservation row reads counters + payments from the booking doc + the booking's payments subcollection.
- **Security rules ship in the same PR** — mirror the `reservations/{id}/refunds/` + `reservations/{id}/charges/` blocks onto the booking parent, including the charge-void guard that currently `get()`s `reservations/$(reservationId)/charges/$(voidOf)` (the `get()` path must follow the charge to its new parent, or every void is denied).
- **Tests:** the new paths are correct (refunds + charges live under the booking, the liability is on the booking, the email renders from the booking's rooms[]), the reports Liability tab + Sales → Charges tab read from the new path, the charge-void guard allows a legitimate reversal and denies a mismatched one, and the ETR test-run cleanup still finds every charge row.

**Ship when:** every new refund, charge, and liability lives under the booking.

### Step 6 — Delete the sibling-flip pass + the reservation doc

**Branch:** `feature/booking-unified-step-6-remove-siblings`. **Migration risk:** high (irreversible).

- The FOL-05 sibling-flip pass is deleted. The verify / add-payment / reject handlers are now ~30 lines each (no `siblingChildBookings` pre-read, no `postUpdateChildStatuses` array, no per-child `transaction.update` calls). The handler writes:
  1. The payment record under `bookings/{id}/payments/`.
  2. The status update on the target `rooms[i]` entry (a single `transaction.update(bookingsRef, { \`rooms.${i}.status\`: "payment-confirmed", ... })`).
  3. The derived `paymentStatus` on the booking (computed from the new `rooms[]`).
- The FOL-03 reads-before-writes ordering is preserved (the pre-read is just the booking doc + the payments snapshot now, no children query).
- The reservation docs are deleted (or archived to a `reservations_archive/` collection for a 90-day safety window). **Nothing may remain under them** — payments (step 4), refunds + charges (step 5) must all have migrated first, or deleting the parent orphans live subcollection data.
- The `reservations` listener + the `collectionGroup("payments")` aggregate are removed (the admin reads from the booking's payments subcollection directly). The listener is an inline `onSnapshot(collection(db, "reservations"), …)` effect in `admin-app/src/context/AdminContext.tsx` — there is no `subscribeToReservations` function to delete, despite the name used in MRB-15-09's test. The second reservations reader is the full-collection `getDocs(collection(db, "reservations"))` in `admin-app/src/components/LiabilityTab.tsx`, which reads from the booking doc after step 5.
- **Security rules + indexes (`firebase/firestore.rules`, `firebase/firestore.indexes.json`) ship in the same PR** — the whole `match /reservations/{reservationId}` block and its three subcollection blocks are deleted (or narrowed to read-only for the archive window), and any index whose parent is the reservation is dropped.
- The `MRB-13 reservation-scope cancel` is just "cancel the booking" (one transaction, mutates `rooms[]`).
- The `MRB-14 add-room` is just "push a new entry into `rooms[]`" (one transaction, no separate endpoint).
- The FOL-05 source-text tests are deleted (the sibling-flip contract is gone).
- The MRB-15-03 transactional-counters tests are deleted (the counter derivation is on-read, no transactional write).
- **Tests:** the new write path is correct, the reservations collection is empty, the admin surfaces read from the booking + rooms[] correctly, every email renders from the new shape.

**Ship when:** every read + write is on the new shape, the reservations collection is empty, the FOL-05 + MRB-15-03 sibling-flip contracts are gone, the staging rehearsal is green.

### Step 7 — MDs + audit

**Branch:** `feature/booking-unified-step-7-docs`. **Migration risk:** zero.

- Delete the FOL-05 entry in `plan/docs/DECISIONS-FEATURES.md` (the sibling-flip contract is gone).
- Delete the MRB-15-03 entry (the counter-proliferation is gone).
- Update the MRB-01 entry to point to the new shape ("the reservation is the booking; the wrapper is gone").
- Update `plan/features/BOOKINGS-MANAGEMENT.md` to reflect the new data model.
- Update `plan/docs/TYPES.md` to drop the `Reservation` interface (or keep it as a deprecated alias for back-compat reads during the migration window).
- Update `plan/docs/BACKEND.md` + `plan/docs/API-ROUTES.md` to point to the new paths, and `plan/docs/SECURITY.md` for the rewritten rules blocks.
- Remove the `BOOKING_UNIFIED_READ_ROOMS_ENABLED` flag + its `plan/docs/ENV-SETUP.md` entry (the read path is permanent by then).
- Update `plan/docs/GOTCHAS.md` to remove the "Firestore `runTransaction` requires all reads before all writes" entry as a critical concern (still a good practice, but no longer load-bearing for the payment handlers).
- Update this spec's status to ✅ shipped.

**Ship when:** the migration is fully on production.

---

## Risks + rollback

| Step | Risk | Rollback |
|---|---|---|
| 1 | Low — purely additive write, no read change | Revert the commit; the `rooms` field is unused. |
| 2 | Low — backfill script can re-run safely; idempotent. | Re-run with the `dryRun: true` flag to verify the next run. |
| 3 | Medium — read path is wrong = wrong totals in the UI. | Flip the feature flag back; the children list is still there as the source of truth. |
| 4 | Medium — payment record path is wrong = money in the wrong place. | Flip the dual-source read back; the `reservations/{id}/payments/` collection still exists for reads. |
| 5 | Medium — refunds / liability / email path is wrong = wrong reports + wrong emails. | Flip the dual-source read back; the `reservations/{id}/refunds/` + `reservations/{id}.cancellationLiability` still exist. |
| 6 | **High** — once the reservation docs are deleted, they're gone. | The 90-day archive window gives you a recovery path. Before this step, do a production backup of every `reservations/{id}` doc. |
| 7 | Zero — docs only. | Revert the docs. |

---

## What gets deleted (the simplification)

After step 6:

- **FOL-05 sibling-flip pass** — ~200 lines of `siblingChildBookings` pre-read + `postUpdateChildStatuses` array + per-child `transaction.update` calls across 3 handlers. Gone.
- **FOL-03 reads-before-writes ordering** — still good practice, but no longer load-bearing for the payment handlers. The check-in / check-out handlers still need it (the room status update is on a separate doc).
- **MRB-15-03 transactional counters** — ~5 denormalized counter fields (`roomCount` / `activeRoomCount` / `cancelledRoomCount` / `checkedInRoomCount` / `checkedOutRoomCount`) + the `computeReservationAggregatePaymentStatus` helper usage. Gone. Counters are derived on-read.
- **MRB-13 reservation-scope cancel** — the `Map<code, count>` dedup + the `cancelledRoomCount` increment + the `paymentStatus` aggregate mirror. Gone. Just "cancel the booking, mutate `rooms[]`."
- **MRB-14 add-room** — the new endpoint + the separate room-line derivation. Gone. Just "push a new entry into `rooms[]`."
- **CRL-07 liability snapshot** — the dual-source read (reservation header for N>1, booking doc for legacy). Gone. Always on the booking now.
- **The `reservations` collection** — empty. The inline `onSnapshot(collection(db, "reservations"))` effect in `AdminContext.tsx` and the `getDocs(collection(db, "reservations"))` in `LiabilityTab.tsx` are removed. The `collectionGroup("payments")` aggregate is removed.
- **The `reservations` security-rules block** — the top-level match + its `payments` / `refunds` / `charges` subcollection blocks, and any reservation-parented index.
- **The folio dual-source branches** — every `reservationId ? collection(db, "reservations", …) : collection(db, "bookings", …)` ternary in `BookingsPage.tsx` collapses to the booking path.

**Lines removed (estimate):** ~1,500-2,000 across the server handlers + the admin + the shared helpers.
**Lines added (estimate):** ~300-500 for the `rooms[]` array plumbing + the new derived computations.
**Net:** ~-1,200 lines.

---

## What this enables (the future)

Once the booking is one doc with one lifecycle, the next round of features is much smaller:

- **Apply discount to whole reservation** — one doc write, no scope picker.
- **Partial refund** — one entry into the refunds subcollection with a per-room allocation array; the booking's `rooms[].paidAmount` updates in the same transaction.
- **Per-room check-in** (one guest checks in, others don't yet) — the `rooms[i].status` flip is local; no child-doc write needed.
- **Multi-night add-on (per-room, not per-reservation)** — push a new entry into the room's `addOns: []` array.
- **Cancellation policy per room** — the `rooms[i].cancellationPolicySnapshot` is local; no `cancellableChildren` set derivation.

The common shape across all of these: **mutate `rooms[i]`, no N-doc iteration, no header mirror.** That's the simplification FOL-05 is paying the down payment on.

---

## Open questions for the team

1. **Wire contract for the booking's `id`.** Today the booking has a `bookingRef` (e.g. `SI-XXXXX`) AND a `reservationRef` (e.g. `R-YYYYMMDD-NNNNN`). Post-refactor, the wire is one ref. Rename `bookingRef` → `reservationRef` everywhere? Or keep both? (Keep both is back-compat; rename is cleaner but a bigger blast radius.)
2. **Counter derivation on-read vs. small denormalized snapshot.** The spec says "derived on-read" (no denormalized counter fields). For the BookingsPage reservation row, `rooms.filter(r => r.status === "cancelled").length` is O(N) on every render. With N=1-3 (the current ceiling), this is fine. If the hotel ever has N=10+ rooms in a single reservation, consider a 2-field denormalized snapshot (`cancelledRoomCount`, `activeRoomCount`) computed transactionally. Not a problem today.
3. **The `rooms` array size cap.** A 14-room property with one guest booking all 14 rooms = `rooms.length === 14`. Firestore doc size limit is 1 MiB; with ~14 `BookingRoomLine` entries, we're well under. But for a hotel with 100+ rooms (future white-label), the array grows. Consider a `rooms` subcollection instead of an array when `rooms.length > 20`. Defer to that future.
4. **The `roomId` + `roomNumber` + `roomType` denormalization in the room line.** These are denormalized from the `rooms/{id}` doc at create time. If a room is renamed or re-typed later, the booking's `rooms[i]` is stale. Today the same staleness exists (the booking doc has `roomNumber` / `roomType` denormalized). Post-refactor, the array denormalization is the same shape. Same drift risk. Not a new problem.

---

## How to start the migration

When the trigger conditions in step 0 are met:

1. File the MRB ticket (e.g. **MRB-16 — Booking Unified (rooms denormalize into the booking doc)**).
2. ~~Create the decision record entry~~ — done: **`#202`** in `plan/docs/DECISIONS-FEATURES.md` (filed 2026-08-08). Cross-reference the MRB number onto it once step 1 starts.
3. Create the spec for the first step (a sub-spec under `BOOKING-UNIFIED.md` or a separate `BOOKING-UNIFIED-STEP-1.md`).
4. Ship the steps in order, one PR per step, one decision record per step.
5. The FOL-05 entry in `DECISIONS-FEATURES.md` should be marked as "superseded by #202" at the start of step 1 (the FOL-05 contract is the patch; the new contract is the destination).
6. The MRB-15-03 entry should be marked as "superseded by #202" at the start of step 6 (the counter-proliferation goes away when the rooms[] array is local).

The migration is a 6-month project for a solo-dev shop. It's a 2-month project for a 3-engineer team. Don't start it unless the trigger conditions are met.

---

## Status

- ⏸ **Deferred, and the 2026-08-08 audit recommends against starting it as written.** The diagnosis in `#202` is sound; the destination shape trades the money path's ergonomics for the availability path's queryability (trigger condition 4). Near-term path is **BAR-02** (derive the counters) + **BAR-03** (extract the sibling-flip helper) in `plan/project/ROADMAP.md §BAR` — most of the relief, no data migration, no irreversible step.
- Task breakdown (BAR-01-00..07) lives in `plan/project/ROADMAP.md §Booking Architecture Refactor (BAR)`. Visual tour: `plan/project/BAR-01-booking-flow-tour.html`.
- Audited 2026-08-08 against the codebase: handler names, helper names, the GOTCHAS reads-before-writes entry, and the FOL-05 38-test count all verified; the `charges` subcollection, the security-rules/index work, and the feature-flag mechanism were added to the steps as a result.
- **Related FOL entries to be marked "superseded by #202" when the migration starts:** FOL-01 (FOL-05 says), FOL-03, FOL-05.
- **Related MRB entries to be marked "superseded by #202" when the migration completes:** MRB-01 (the wrapper doc is gone), MRB-05 (the N>1 aggregate is gone, computed on-read), MRB-13 (the reservation-scope cancel is "cancel the booking"), MRB-14 (add-room is "push a room"), MRB-15-03 (the counter-proliferation is gone).
