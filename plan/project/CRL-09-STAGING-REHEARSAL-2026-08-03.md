# CRL-09 — Staging Rehearsal Walkthrough (2026-08-03)

> Owner-facing rehearsal script for the CRL-07 + CRL-08 + CRL-09 cancellation
> liability lifecycle. Run as **TEST DATA** on the staging project before the
> `dev → main` cutover. Documents the exact staff + guest flow that exercises
> the new surface end-to-end so a non-engineer can validate it.
>
> This is operational, not engineering. It assumes CRL-07 + CRL-08 are
> already deployed to staging.

## Status

| Scenario | Status | Notes |
|---|---|---|
| S1 — Cancel outside cutoff → full refund (state `processed`) | ⬜ Awaiting rehearsal | Auto-resolves once processedAmount ≥ approvedAmount |
| S2 — Cancel inside cutoff → partial retention (state `partially-processed`) | ⬜ Awaiting rehearsal | Admin records partial then completes |
| S3 — Admin exception → state `retained` (approved < policyRefund) | ⬜ Awaiting rehearsal | Audit row on the snapshot is the trail |
| S4 — Reservation-scope cancel (multi-room, all N rooms) | ⬜ Awaiting rehearsal | ONE snapshot on reservation header |
| S5 — Per-child cancel in multi-room (one of N rooms) | ⬜ Awaiting rehearsal | ONE snapshot on the cancelled child booking |
| S6 — Refund-id idempotency (same refundId, same body) | ⬜ Awaiting rehearsal | Replay returns the existing record, no double-write |
| S7 — Auth matrix: front-desk cancel OK, front-desk refund DENIED | ⬜ Awaiting rehearsal | Only `role === "admin"` can record refund or apply exception |
| S8 — Notification + email + Reports "Liability" tab trail | ⬜ Awaiting rehearsal | `cancellation-refund` bell, `booking-refund-processed` email |
| Owner sign-off | ⬜ Awaiting walkthrough | Sign-off section at the bottom |

CRL-09 stays **shipped** once the engine tests pass (the emulator test in
`firebase/tests/crl-09-lifecycle-state-machine.emulator.test.ts`). This
rehearsal is the human validation gate before the production cutover.

## 0. Pre-reqs (set up before starting)

1. Staging project on the latest `dev` deploy (post-CRL-08).
2. Two staff accounts created via the admin invite path:
   - **front-desk@staging.spark-inn.test** — `role: "front-desk"`
   - **admin@staging.spark-inn.test** — `role: "admin"`
3. A guest email registered for the booking — use `guest+rehearsal@staging.spark-inn.test`.
4. At least one room type with ≥3 physical rooms and a policy that has a clear cutoff (e.g. 48h). Verify the cutoff timestamp with the front desk in a single test booking before starting the matrix.
5. A payment method that supports a refund (GCash or bank transfer is fine — Cash is also OK because the recording step is what matters, not the actual money movement).

If any pre-req is missing, fix it before starting the matrix — a half-run leaves stale liability snapshots that pollute S2/S3.

## 1. Scenario S1 — Cancel outside cutoff → full refund (state `processed`)

This is the happy path: a guest cancels well in advance, pays in full, gets the
full refund back. After the cancel commits, the staff records the full
outstanding refund and the state moves to `processed`.

**Setup**
- Book a single room (N=1) for 7 days out at the standard rate.
- Pay in full via the payment-confirm flow. Net collected = room total.
- Verify: `/admin → Bookings → Folio` shows `paid: full`.

**Rehearsal**
1. As the **guest**, open `/my-booking`, find the booking, click **Cancel**.
2. The preview modal should show: `refundPct: 100%`, `policyRefund: full net collected`, `retainedAmount: 0`, `staffProcessingRequired: true`.
3. Confirm. Verify: booking status flips to `cancelled`, `cancelledAt` is set, the guest receives the `booking-cancelled` email with a "We received your cancellation. Refund of ₱X will be processed separately." line.
4. As the **front-desk** staff, open `/admin → Bookings`, click the cancelled booking → drawer. Verify the new `CancellationLiabilityPanel` is visible in the Folio section. Verify the state badge reads `pending-processing` and the **outstanding** row equals the policy refund. Verify the **Record processed refund** button is visible BUT you (front-desk) will be denied if you click it (this is S7 — confirm now and move on).
5. As the **admin**, click **Record processed refund**, enter the full outstanding amount + a method (e.g. "GCash") + a reference (e.g. `REHEARSAL-S1`). Submit.
6. Verify: the panel re-projects. State badge → `processed`. The "outstanding" row → ₱0. The "processed" row → full refund.
7. Verify: guest receives a `booking-refund-processed` email with "Your refund is now complete" headline.
8. Verify: `/admin → Reports → Liability` shows this booking as a row in the "Full liability" table with `state: processed` + the `cancelledAt` date. It should NOT show in "Pending" (pending count = 0 at the end of S1).
9. Verify: the admin `NotificationBell` shows a `cancellation-refund` entry: "Refund processed — `<ref>` (pending-processing → processed)". The post-cancel `cancellation-refund` entry is also still in the bell history.

**Pass criteria**: state ends at `processed`; outstanding = 0; guest got one cancel email + one refund-processed email; bell has two `cancellation-refund` entries; Reports row matches.

**Reset**: leave this booking in the database (it is real test data, do not delete). Note the booking ref + reservation ref in the sign-off section.

## 2. Scenario S2 — Cancel inside cutoff → partial retention (state `partially-processed` then `processed`)

This is the money path the desk uses daily: the guest cancels last-minute, the
policy retains a percentage, the desk records the refund in two partial
installments.

**Setup**
- Book a single room for **tomorrow** (inside the 48h cutoff). Use a fresh guest email.
- Pay in full.

**Rehearsal**
1. As the **guest**, cancel via `/my-booking`.
2. Preview should show `refundPct: <e.g. 50%>` (whatever the policy says for inside-cutoff), `policyRefund: <half>`, `retainedAmount: <half>`, `staffProcessingRequired: true`.
3. Confirm. Snapshot lands: `approvedAmount: <half>`, `state: pending-processing`.
4. As **admin**, click **Record processed refund**, enter **half** the outstanding (e.g. ₱2,000 of a ₱4,000 outstanding). Submit.
5. Verify: state badge → `partially-processed`. "Processed" row → ₱2,000. "Outstanding" row → ₱2,000.
6. Verify: guest receives `booking-refund-processed` email with headline "Your refund is partially processed".
7. Verify: Reports → Liability now counts this as a **partial** (1 partial, pending amount = ₱2,000).
8. Wait a few seconds, then **Record processed refund** again with the remaining ₱2,000.
9. Verify: state → `processed`. Outstanding → ₱0.
10. Verify: guest gets a second `booking-refund-processed` email with "Your refund is now complete".
11. Verify: Reports → Liability now has `pending count` decremented by 1 and `processed total in range` incremented by the full amount.

**Pass criteria**: state progression `pending-processing` → `partially-processed` → `processed` is visible in the panel + the bell history. Two `booking-refund-processed` emails sent (one per state change). Reports reflects both partials.

## 3. Scenario S3 — Admin exception → state `retained`

This is the goodwill path: the admin reduces the approved amount (the
exception). State goes to `retained` because `approvedAmount < policyRefund`.
The exception audit row is the trail.

**Setup**
- Book a single room for 7 days out. Pay in full.

**Rehearsal**
1. Cancel as guest (preview shows 100% refund).
2. Confirm. Snapshot: `approvedAmount: <full>`, `state: pending-processing`.
3. As **admin**, click **Apply exception** in the panel.
4. Modal: enter `approvedAmount: 0` (full retention — goodwill case) + a reason in the box (e.g. "Late cancellation after check-in window — full retention per discretion"). Submit.
5. Verify: state → `retained`. `retentionAmount` row → the full policy refund. The retention callout appears below the breakdown card with the reason + the admin's name + the timestamp.
6. Try to record a processed refund of any amount. Verify: the panel still allows it (the `approvedAmount === 0` path is valid), and once recorded, the state stays `retained` because the `approvedAmount < policyRefund` branch takes precedence (per `computeCancellationLiabilityState`).
7. Verify: Reports → Liability shows this as `retained` (it is NOT counted in pending), and `retained cancellation revenue in range` increments by the full policy refund.

**Pass criteria**: state ends at `retained`; `retentionAmount` matches `policyRefund - approvedAmount`; the reason + admin name are visible on the panel; the exception is NOT a separate "exception-applied" notification (per decision #174 — the audit row on the snapshot is the trail; the staff sees it on the panel).

## 4. Scenario S4 — Reservation-scope cancel (multi-room, all N rooms)

**Setup**
- Book a 3-room reservation (one transaction, `reservationRef: R-YYYYMMDD-NNNNN`).
- Pay in full on every room.

**Rehearsal**
1. As **admin**, open `/admin → Bookings`, find the reservation row. Click into the reservation drawer.
2. Click **Cancel** → the modal shows the `This room / All 3 rooms` segmented control (per MRB-13). Select **All 3 rooms**.
3. Preview should show: 3 per-room rows, aggregate `policyRefund: <sum>`, `retainedAmount: <0 or sum>`, `staffProcessingRequired: true`.
4. Confirm. Verify: all 3 child bookings flip to `cancelled` in the same transaction. The `reservations/{id}` header carries ONE `cancellationLiability` snapshot (the aggregate). Each child booking does NOT carry a `cancellationLiability` field (only the cancelled entity in the per-child path carries one; the header is the source of truth in the reservation-scope path).
5. Verify: ONE `booking-cancelled-reservation` email is sent to the guest (one email, all 3 rooms listed). No per-child `booking-cancelled` emails fire.
6. As **admin**, open the reservation drawer → Folio section. Verify the `CancellationLiabilityPanel` renders on the **reservation header** (not on each child).
7. Record a partial refund. Verify: state → `partially-processed`. The `processedAmount` is summed across `reservations/{id}/refunds/` (the new dual-write subcollection).
8. Verify: the desk's `/admin → Reports → Liability` shows the **reservation ref** (not a child ref) in the row.

**Pass criteria**: ONE email; ONE snapshot on the header; per-child docs do NOT carry liability; the refund writes go to `reservations/{id}/refunds/`.

## 5. Scenario S5 — Per-child cancel in multi-room (one of N rooms)

**Setup**
- Same reservation as S4 (or a new 3-room reservation if S4 was cleaned).

**Rehearsal**
1. As **admin**, open the reservation drawer. Click **Cancel** on ONE child (use the per-child cancel from the room-stay card, not the reservation header). The modal should default to scope `room` (per MRB-13).
2. Preview should show a single-room breakdown.
3. Confirm. Verify: ONLY that child flips to `cancelled`. The reservation header `activeRoomCount` decrements (floored at 0). `cancelledRoomCount` increments.
4. Verify: that one child booking now carries its own `cancellationLiability` snapshot. The reservation header does NOT carry a liability field (only the cancelled entity in the per-child path carries one; the surviving children's status is unchanged).
5. Verify: one `booking-cancelled` email fires for the cancelled child (per-child template, even though the guest sees the reservation view). The two surviving rooms do not get any cancellation email.
6. As **admin**, open the cancelled child's drawer → Folio section. Verify the `CancellationLiabilityPanel` renders on the child booking. Record a refund. State progresses normally.

**Pass criteria**: ONE child cancelled; ONE snapshot on that child; reservation header untouched on liability; one cancel email; surviving children un-touched.

## 6. Scenario S6 — Refund-id idempotency

This is the contract CRL-01 promised and CRL-07 inherits. Same `refundId` +
same body → existing record, no double-count.

**Setup**
- Use the booking from S1 (still cancelled, state `processed` is fine — this scenario writes a NEW refund to test idempotency on a fresh row).

**Rehearsal**
1. Pick a fresh `refundId` (e.g. `rehearsal-s6-001`).
2. As **admin**, call `POST /api/bookings/add-refund` with the standard refund body + `refundId: "rehearsal-s6-001"` + `amount: 100`. Verify: 200 OK, new record visible.
3. Immediately call the same endpoint again with the SAME `refundId` + SAME body. Verify: 200 OK, response body says `idempotentReplay: true` and `processedAmount` does NOT increment.
4. Call again with the SAME `refundId` but a DIFFERENT amount. Verify: 200 OK, still `idempotentReplay: true` (the contract is on the `refundId`, not the full body — the second value is ignored, the first one wins).
5. Call with a NEW `refundId` but the same booking. Verify: 200 OK, new record created, `processedAmount` increments by the new amount.

**Pass criteria**: `idempotentReplay: true` on the duplicates; `processedAmount` only increments on the unique `refundId`. (The emulator test pins this contract — the rehearsal confirms the staging handler matches.)

## 7. Scenario S7 — Auth matrix

The single most important guard: front-desk can cancel + see the panel; only
admin can record a refund or apply an exception. The destructive cancel
itself stays front-desk-allowed (per the existing CRL-04 + CRL-06 surface).

**Rehearsal**
1. As **front-desk**, open the cancelled booking from S1 (state is `processed` after S1). Verify the `CancellationLiabilityPanel` is visible AND the **Record processed refund** + **Apply exception** buttons are visible (so the desk can see the state) BUT …
2. Click **Record processed refund**. Submit any amount. Verify: response is `403 Forbidden` (or the UI shows the same "Admins only" guard from `add-refund`). The refund is NOT written.
3. Click **Apply exception**. Submit. Verify: same `403` / "Admins only" guard.
4. Verify: the panel still re-projects correctly — front-desk is a **read-only** viewer of the panel.
5. Switch to **admin**. Repeat the refund + exception attempts. Both succeed (assuming the underlying state contract permits — S2/S3 already covered the full paths).

**Pass criteria**: front-desk reads the panel; only admin writes.

## 8. Scenario S8 — Notification + email + Reports trail

End-to-end audit trail check. Use a fresh booking (book → pay → cancel →
partial refund) and walk through every consumer surface to confirm the
lifecycle is visible everywhere.

**Rehearsal**
1. Book a single room for tomorrow. Pay in full. Cancel as guest. Record a partial refund as admin. Record a final refund as admin.
2. **Guest email** (sent to the rehearsal guest mailbox): verify exactly TWO emails — the cancel email + the refund-processed email. NO email on the first partial (the state-change gate skips it — `pending-processing` → `partially-processed` does fire; `partially-processed` → `processed` does fire). Wait, this is two state changes, so two emails. Verify: subject lines match `cancellation-refund`/`refund-processed` exactly.
3. **Admin bell** (`/admin → NotificationBell`): verify the bell has THREE entries for this booking:
   - `cancellation-refund` — "Refund pending-processing — `<ref>`" (from the destructive cancel)
   - `cancellation-refund` — "Refund partially-processed — `<ref>` (pending-processing → partially-processed)"
   - `cancellation-refund` — "Refund processed — `<ref>` (partially-processed → processed)"
4. **Reports → Liability** (default 30-day range): verify the booking is in the "Pending" tab... wait, after step 1 the state is `processed`, so it is in the "Full liability" table with `state: processed` and the cumulative processed amount. Verify the cumulative matches the SUM of the two refund records.
5. **Reports → Daily Close**: verify the day's Daily Close derives the cash movement from the **payment ledger** (`reservations/{id}/refunds/` or `bookings/{id}/payments/` for legacy), NOT from `approvedAmount`. Cross-check: the refund total in Daily Close = the sum of the two refund records.

**Pass criteria**: two guest emails; three bell entries; Reports row matches; Daily Close derives from the ledger.

## 9. Owner sign-off

Once all eight scenarios pass, the rehearsal is complete. Record sign-off
below.

- Date rehearsed: ____________
- Tester: ____________
- All 8 scenarios pass: ⬜
- Staging booking refs that were created: ____________
- Notes / deviations: ____________

Once signed off, mark this document "✅ Rehearsal complete" in the status
table at the top. The CRL-09 → `main` cutover can proceed.

## 10. Rollback plan if any scenario fails

A failed scenario does NOT block the engine ship (the emulator test is the
real contract). It blocks the **production cutover**.

1. If a scenario fails, file a `fix:` PR against `dev` with the failure note in the body.
2. Re-run the scenario on staging after the fix lands.
3. Repeat until all 8 pass.
4. The cutover proceeds only after the sign-off section is filled.

The decisions in `plan/docs/DECISIONS-FEATURES.md #175` + `#176` are the
implementation record; this rehearsal is the human gate. They are independent
gates.
