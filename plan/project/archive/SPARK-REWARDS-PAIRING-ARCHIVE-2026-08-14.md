# HISTORICAL ARCHIVE — Spark Rewards Loyalty Ledger Pairing Detail (2026-08-14)

> **HISTORICAL ARCHIVE** — This document contains the full pairing-contract detail for the Spark Rewards `pointsHistory` ledger (earn+clawback + redeem+restore). The active spec file `plan/features/SPARK-REWARDS.md` has been compacted to a one-paragraph reference pointer per CONTRIBUTING.md §Move out rule. The detail moved here without any summarization. The active spec still names the contract entry points (the `guest-app/tests/api/mrb-15-*.test.ts` file path + the relevant decision number) so future audits can find the source.

For the active spec, see [`plan/features/SPARK-REWARDS.md`](../features/SPARK-REWARDS.md).

---

## Earn + Clawback Pairing (MRB-15-07)

> **Original location:** `plan/features/SPARK-REWARDS.md §Earn + Clawback Pairing (MRB-15-07)`. **Decision:** `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-07 sub-item, shipped v0.254.0). The `pointsHistory` ledger uses paired doc ids: `earn-${bookingId}` for the positive earn entry (written on check-out) and `clawback-${bookingId}` for the negative clawback entry (written on cancel). The pairing is the deterministic link between an earn and its subsequent clawback.

### Pairing contract (the "exactly-once" guarantees)

- `earn-${bookingId}` is written **exactly once** per booking on a successful check-out. There are **2 constructions** of this id in the codebase: the check-out's `awardNow` flag (the standard path) and the post-settlement path (the deferred award, used when the check-out runs without a confirmed payment). A re-check-out of the same booking is forbidden by the status matrix (`status === "checked-out"` is terminal), so a second `earn-${bookingId}` write is impossible.
- `clawback-${bookingId}` is written **exactly once** per cancelled booking. There is **1 construction** of this id in the codebase: `handleCancelBooking`'s per-child CRL-02 + MRB-05 audit stamp block. A re-cancel of the same booking is forbidden by the status matrix (`status === "cancelled"` is terminal).
- The `pointsHistory.points` map-based invariant `rewardsPoints == sum(pointsHistory.points)` is preserved end-to-end: an `earn-${bookingId}` entry of `+100` is balanced by a `clawback-${bookingId}` entry of `-100` if a check-out is followed by a cancel.

### Why the pairing matters

The pairing is the source-text guard for the cross-cutting "no duplicate earn" + "no duplicate clawback" + "balanced ledger" invariants MRB-15-01 pins. A future refactor that adds a second `earn-${bookingId}` write (e.g. on a "reissue loyalty points" feature) would silently break the invariant and double-credit the member. The MRB-15-07 audit pins the exact count of constructions so the test fails on a new construction.

### Test coverage

`guest-app/tests/api/mrb-15-07-checkout-loyalty-earn.test.ts` (13 tests) — pins the earn/clawback pairing + the construction count. `mrb-15-01-lifecycle-invariants.test.ts` (14 tests) — pins the no-duplicate-earn + no-duplicate-clawback invariants across the full lifecycle.

---

## Redeem + Restore-Redemption Pairing (Spark Rewards re-audit 2026-08-14)

> **Original location:** `plan/features/SPARK-REWARDS.md §Redeem + Restore-Redemption Pairing (Spark Rewards re-audit 2026-08-14)`. **Closes:** the re-audit finding NEW-MED-1. Mirrors the earn+clawback pairing above: the `pointsHistory` ledger uses paired doc ids for the redemption lifecycle too. `redeem-${bookingId}` is the negative entry written on a staff-initiated redemption, and `restore-redemption-${bookingId}` is the positive entry written on the subsequent cancel. The pairing is the deterministic link between a redemption and its restore.

### Pairing contract (the "balanced ledger" guarantee)

- `redeem-${bookingId}` is written **exactly once** per booking on a successful staff redemption. There is **1 construction** of this id in the codebase: `handleRedeemMemberPoints` in `guest-app/server/handlers/members.ts`. The handler is idempotent (`booking.pointsRedeemed > 0` guard re-read inside the transaction), so a second `redeem-${bookingId}` write is impossible.
- `restore-redemption-${bookingId}` is written **exactly once** per cancelled booking that had a redemption applied. There are **2 constructions** of this id in the codebase (matching the two cancel scopes): `handleCancelBooking`'s **N=1** `freshBooking`-based block (the single-booking cancel path) and its **per-child** `for (const child of children)` loop (the MRB-13 reservation-scope cancel path — only the cancelled child with `pointsRedeemed > 0` triggers a restore, so a per-child cancel of an unredeemed sibling in a multi-room reservation never over-restores).
- The `pointsHistory.points` map-based invariant `rewardsPoints == sum(pointsHistory.points)` is preserved end-to-end: a `redeem-${bookingId}` entry of `-N` is balanced by a `restore-redemption-${bookingId}` entry of `+N` if the booking is subsequently cancelled. The member's `rewardsPoints` field is NOT touched by the cancel handler (the redeem handler is the only place that decrements it; the restore is ledger-only). Same posture as the clawback's negative-ledger pattern.
- The booking's `pointsRedeemed*` fields are zeroed in the same transaction (via the `bookingUpdate` object + a second `transaction.update` second-write-wins stamp, mirroring the clawback's pattern). A subsequent re-redeem mints a fresh `redeem-${bookingId}` entry — `transaction.set` is an upsert, so the reapply is safe and the ledger reflects the new state cleanly.

### Why the pairing matters

The pairing is the source-text guard for the "redeemed points are not lost on cancel" invariant NEW-MED-1 introduced. Before this fix, a member who redeemed 1000 pts against a booking and then had it cancelled permanently lost the points — the cancel handler's clawback only fired on `loyaltyAwardStatus === "awarded"`, and the undo-redemption handler rejected cancelled bookings. The pairing makes the cancellation lifecycle symmetric: a member who redeems then cancels gets their points back without staff intervention, and the ledger stays balanced without an in-place `rewardsPoints` mutation.

### Auto-link-on-redeem (documented behavior, pre-existing)

`handleRedeemMemberPoints` silently auto-links an anonymous booking when staff pass `requestedMemberId` in the body — the transaction sets `booking.memberId = requestedMemberId` as a side effect of the redemption. This is intentional (the staff-mediated "redemption while looking at an unlinked anonymous booking" flow) and the spec only documents the auth guard, not the auto-link. A future spec amendment could add an explicit `linkFirst: boolean` to the schema to make the intent explicit; the current behavior is the right thing, just hidden.

### Test coverage

`guest-app/tests/api/mrb-15-09-redeem-cancel-pairing.test.ts` (20 tests) — pins the redeem+restore pairing contract end-to-end: the deterministic `redeem-${bookingId}` id, the `restore-redemption-${bookingId}` doc id in both the N=1 and per-child cancel paths, the three-condition `pointsRedeemed > 0 && pointsRedeemedValue > 0 && pointsRedeemedBy` guard, the `type: "redeem-restore"` ledger type, the positive `points` value (mirrors the negative clawback), the booking's `pointsRedeemed*` zeroing in the same transaction, the invariant `rewardsPoints == sum(pointsHistory.points)` (the restore path does NOT increment `rewardsPoints` in place), and the NEW-LOW-1 dropdown removal in the admin member drawer.

### Known issues (Audit 2026-08-14 re-audit)

- ✅ **NEW-MED-1 — Cancellation of a points-redeemed booking does not refund the redeemed points** — **Closed** (this section). The redeem+restore pairing ships in the same PR (decision TBD, commit TBD). `guest-app/tests/api/mrb-15-09-redeem-cancel-pairing.test.ts` pins the contract.
- ✅ **NEW-LOW-1 — Dead "Transaction Classification" dropdown on the manual points adjustment form** — **Closed** (this PR). The 4-option `earn` / `redeem` / `manual` / `expire` select was removed from `admin-app/src/pages/MembersPage.tsx`; the server hardcoded `type: "manual"` regardless of the selection (per MED-1 closure, decision #134, commit b62182c). The dropdown is replaced with the `reason` field as the sole audit-trail input.
- ✅ **Minor note — Auto-link-on-redeem undocumented** — **Closed** (this section). The "Auto-link-on-redeem" subsection above documents the behavior.

---

## Re-activation rule

If a future audit needs to reference the pairing detail inline (e.g. a new MRB-15-xx sub-item tests the same pattern), the relevant section should be restored to `SPARK-REWARDS.md` with the decision number pinned. Otherwise this archive is the canonical home.
