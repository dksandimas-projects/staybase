// Per MRB-15-07 (2026-08-03): the loyalty earn path
// audit. The earn is the positive side of the
// loyalty lifecycle — the guest earns points on
// checkout (or on the post-settlement payment that
// clears the folio), the points are then clawed
// back on a later cancel (the MRB-15-01 side). Both
// sides share the same invariants:
//
//   - The history doc id is `earn-${bookingId}` for
//     the earn and `clawback-${bookingId}` for the
//     clawback — paired + auditable.
//   - The earn INCREMENTS `rewardsPoints` in place
//     (the only place that does). The clawback
//     does NOT decrement `rewardsPoints` in place
//     — the negative-ledger pattern is the only
//     correct mechanism (per MRB-05 PR #2).
//   - The earn stamps
//     `loyaltyAwardStatus: "awarded"` +
//     `pointsAwardedAt: now`. The clawback stamps
//     `loyaltyAwardStatus: "clawback-recorded"` +
//     zeros `pointsAwarded`.
//   - The `loyaltyAwardStatus` enum is
//     `"pending-payment" | "awarded" | "ineligible"`
//     (per the schema's `Booking.loyaltyAwardStatus`
//     type). The clawback adds a 4th value
//     `"clawback-recorded"` that lives only in the
//     negative-ledger pattern.
//
// The two earn paths are byte-equivalent in shape:
// both use `earn-${bookingId}` as the history doc
// id, both increment `rewardsPoints` in place, both
// stamp `loyaltyAwardStatus: "awarded"`. The only
// difference is the trigger:
//   - Checkout path: stamps when the guest checks
//     out AND `checkedOutWithBalance === 0` AND
//     `memberId !== null` AND `eligiblePoints > 0`.
//     The `pending-payment` intermediate fires when
//     the guest checks out with a positive balance
//     — the points are held until the balance is
//     settled.
//   - Post-settlement path: stamps when the guest
//     pays the outstanding balance after checkout
//     AND `bookingData.loyaltyAwardStatus ===
//     "pending-payment"` AND `pendingLoyaltyPoints >
//     0` AND `totalPaid >= checkedOutFolioTotal`.
//     The amount awarded is the previously-stamped
//     `pendingLoyaltyPoints` (not a recompute).
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test
// (full create -> checkout -> cancel -> re-earn ->
// re-clawback) is the emulator follow-up.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

describe("MRB-15-07 — `Booking.loyaltyAwardStatus` is the canonical enum (3 states, plus the MRB-05 clawback 4th)", () => {
  it("the schema declares the 3-state earn enum", () => {
    // The earn path uses 3 values: "pending-payment"
    // (held until the folio is settled),
    // "awarded" (the earn is committed),
    // "ineligible" (no earn — non-member or no
    // eligible points). The 4th value
    // "clawback-recorded" lives only on the
    // clawback path (per MRB-05 PR #2).
    expect(sharedTypesSrc).toMatch(
      /loyaltyAwardStatus\?: "pending-payment" \| "awarded" \| "ineligible"/
    );
  });
});

describe("MRB-15-07 — Checkout path stamps the earn atomically (status flip + earn + history entry)", () => {
  it("the checkout's `loyaltyAwardStatus` enum maps `awardNow ? \"awarded\" : \"pending-payment\" : \"ineligible\"`", () => {
    // The checkout's `awardNow` flag drives the
    // status stamp: `awarded` when the guest
    // checks out with no balance + a member
    // + eligible points, `pending-payment` when
    // there's a positive balance (the points
    // are held until settled), `ineligible`
    // when the booking has no member or no
    // eligible points. The three-way ternary
    // is the single source of truth for the
    // status stamp.
    expect(bookingsHandlerSrc).toMatch(
      /loyaltyAwardStatus: canAwardPoints \? \(awardNow \? "awarded" : "pending-payment"\) : "ineligible"/
    );
  });

  it("the checkout's `awardNow` flag is `canAwardPoints && checkedOutWithBalance <= 0`", () => {
    // The `awardNow` gate requires all three:
    // memberId + eligiblePoints > 0 + member
    // doc exists in transaction (the
    // `canAwardPoints` boolean) AND
    // `checkedOutWithBalance === 0` (the
    // folio is fully settled at checkout).
    // A balance > 0 routes the earn to the
    // pending-payment intermediate.
    expect(bookingsHandlerSrc).toMatch(
      /const awardNow = canAwardPoints && checkedOutWithBalance <= 0/
    );
  });

  it("the checkout's `awardNow` path increments `rewardsPoints` in place (the ONLY place that does)", () => {
    // The earn is the single source of in-place
    // `rewardsPoints` increments in the codebase.
    // The clawback does NOT decrement in place
    // (per MRB-05 PR #2 — the negative-ledger
    // pattern is the only correct mechanism). A
    // future refactor that adds a new in-place
    // increment elsewhere would silently
    // desync the field from the
    // `pointsHistory` sum invariant.
    expect(bookingsHandlerSrc).toMatch(
      /rewardsPoints: currentPoints \+ pointsAwarded,/
    );
  });

  it("the checkout's `awardNow` path writes an `earn-${bookingId}` `pointsHistory` entry (paired with the clawback's `clawback-${bookingId}` id)", () => {
    // The history doc id is `earn-${bookingId}`
    // — the canonical earn id paired with
    // `clawback-${bookingId}` (the clawback id
    // MRB-15-01 already pins). The two entries
    // are auditable as a pair: a future
    // `getMemberPointsHistory` reader can match
    // `earn-${id}` + `clawback-${id}` for a
    // single booking's net points.
    expect(bookingsHandlerSrc).toMatch(
      /\.collection\("pointsHistory"\)\.doc\(`earn-\$\{bookingId\}`\)/
    );
  });

  it("the checkout's `earn-${bookingId}` history entry carries `type: \"earn\"` + `points: pointsAwarded` + the booking ref + the staff UID", () => {
    // The history entry's shape is the canonical
    // earn record: `type: "earn"` (the
    // discriminator the pair-rider reads),
    // `points: pointsAwarded` (the amount the
    // guest earned), `bookingId` + `bookingRef`
    // (the audit trail), `description` (the
    // human-readable label), `by: checkedOutBy`
    // (the staff UID), `createdAt: new Date()`
    // (the canonical timestamp). The checkout
    // path is the line ~8580 block; the
    // post-settlement path (line ~6613) is the
    // other earn site — both share the same
    // shape but use different `points` values
    // (`pointsAwarded` vs `loyaltyPointsAwarded`)
    // and different `by` (`checkedOutBy` vs
    // `staffUid`).
    const earnEntryBlock = bookingsHandlerSrc.match(
      /transaction\.set\(historyRef, \{[\s\S]{0,500}?points: pointsAwarded[\s\S]{0,500}?\}\);/
    );
    expect(
      earnEntryBlock,
      "expected the checkout's earn history entry"
    ).toBeTruthy();
    if (earnEntryBlock) {
      expect(earnEntryBlock[0]).toMatch(/type: "earn"/);
      expect(earnEntryBlock[0]).toMatch(/points: pointsAwarded/);
      expect(earnEntryBlock[0]).toMatch(/bookingId,/);
      expect(earnEntryBlock[0]).toMatch(/bookingRef: bookingData\.bookingRef/);
      expect(earnEntryBlock[0]).toMatch(/by: checkedOutBy/);
    }
  });
});

describe("MRB-15-07 — Post-settlement earn path stamps the pending points atomically", () => {
  it("the post-settlement path gates on `settlesCheckedOutFolio = status === \"checked-out\" && loyaltyAwardStatus === \"pending-payment\" && pendingLoyaltyPoints > 0 && totalPaid >= checkedOutFolioTotal`", () => {
    // The 4-condition gate ensures the post-
    // settlement earn fires only when:
    //   1. The booking is `checked-out` (not
    //      `pending` / `payment-uploaded` /
    //      `payment-confirmed` / `cancelled`).
    //   2. The earn was previously held in
    //      pending-payment (the guest checked
    //      out with a balance).
    //   3. There are pending points to award
    //      (a >0 amount — a booking with 0
    //      eligible points has no pending
    //      amount to settle).
    //   4. The total paid now meets / exceeds
    //      the folio total (the balance is
    //      settled).
    // The 4 conditions together prevent a
    // premature or double-earn.
    expect(bookingsHandlerSrc).toMatch(
      /const settlesCheckedOutFolio = bookingData\.status === "checked-out"[\s\S]{0,500}?loyaltyAwardStatus === "pending-payment"[\s\S]{0,300}?pendingLoyaltyPoints > 0[\s\S]{0,300}?totalPaid >= Number\(bookingData\.checkedOutFolioTotal \|\| 0\)/
    );
  });

  it("the post-settlement path awards the previously-stamped `pendingLoyaltyPoints` (not a recompute)", () => {
    // The amount awarded is
    // `pendingLoyaltyPoints` (the value the
    // checkout stamp at line 8486 stored when
    // the booking flipped to `pending-payment`).
    // A recompute here would silently drift the
    // amount from what the guest was promised
    // at checkout — a small "we'll re-evaluate
    // the earn when you settle" surprise that
    // no copy implies. The same `pendingLoyaltyPoints`
    // is the source of truth.
    expect(bookingsHandlerSrc).toMatch(
      /loyaltyPointsAwarded = pendingLoyaltyPoints/
    );
  });

  it("the post-settlement path increments `rewardsPoints` in place (same shape as the checkout's `awardNow` path)", () => {
    // The post-settlement path uses the same
    // in-place `rewardsPoints += loyaltyPointsAwarded`
    // pattern as the checkout's `awardNow`
    // path. Both paths increment in place; the
    // clawback does NOT decrement in place.
    expect(bookingsHandlerSrc).toMatch(
      /rewardsPoints: Number\(loyaltyMemberDoc\.data\(\)\?\.rewardsPoints \|\| 0\) \+ loyaltyPointsAwarded/
    );
  });

  it("the post-settlement path writes an `earn-${bookingId}` `pointsHistory` entry (the same id as the checkout path)", () => {
    // The history doc id is the canonical
    // `earn-${bookingId}` — the same id the
    // checkout's `awardNow` path uses. The two
    // earn paths are byte-equivalent in
    // shape; only the trigger differs
    // (checkout vs settle-after-checkout). A
    // future refactor that uses a different
    // id (e.g. `earn-settle-${bookingId}`)
    // would silently break the pair-rider
    // logic.
    const postSettleEarnBlock = bookingsHandlerSrc.match(
      /loyaltyMemberRef\.collection\("pointsHistory"\)\.doc\(`earn-\$\{bookingId\}`\)/
    );
    expect(
      postSettleEarnBlock,
      "expected the post-settlement earn to use the earn-${bookingId} id shape"
    ).toBeTruthy();
  });

  it("the post-settlement path stamps `loyaltyAwardStatus: \"awarded\"` + `pointsAwardedAt: awardedAt` (the same pattern as the checkout's `awardNow` path)", () => {
    // The post-settlement path stamps the same
    // 3 fields the checkout's `awardNow` path
    // stamps: `pointsAwarded: loyaltyPointsAwarded`
    // + `pendingLoyaltyPoints: 0` (the held
    // amount is now zero) + `loyaltyAwardStatus:
    // "awarded"` (the status flip) +
    // `pointsAwardedAt: awardedAt` (the canonical
    // timestamp). The same `now` is shared
    // across the booking update + the member
    // update + the history write.
    const postSettleStampBlock = bookingsHandlerSrc.match(
      /if \(settlesCheckedOutFolio && loyaltyMemberRef && loyaltyMemberDoc\?\.exists\) \{[\s\S]{0,1000}?loyaltyAwardStatus: "awarded"/
    );
    expect(
      postSettleStampBlock,
      "expected the post-settlement path to stamp loyaltyAwardStatus: 'awarded'"
    ).toBeTruthy();
  });
});

describe("MRB-15-07 — Earn + clawback are paired by `earn-${id}` / `clawback-${id}` (MRB-05 PR #2 contract)", () => {
  it("the JSDoc on the clawback path documents the `earn-${bookingId}` / `clawback-${bookingId}` pairing", () => {
    // The MRB-05 PR #2 (clawback) comment block
    // documents the pairing: "The
    // `pointsHistory` doc id uses the same
    // `clawback-${bookingId}` shape as the
    // existing `earn-${bookingId}` so the two
    // entries are paired + auditable." The
    // earn path uses `earn-${bookingId}`; the
    // clawback path uses `clawback-${bookingId}`;
    // a future reader that matches
    // `getMemberPointsHistory` can match the
    // pair to derive a single booking's net
    // points.
    expect(bookingsHandlerSrc).toMatch(
      /earn-\$\{bookingId\}[\s\S]*?paired \+ auditable/
    );
  });

  it("the earn path's `pointsHistory` write is the ONLY place `earn-${bookingId}` is constructed (no duplicates)", () => {
    // The `earn-${bookingId}` id is constructed
    // in 2 actual places (the checkout's
    // `awardNow` path and the post-settlement
    // path) + 1 JSDoc reference. Both
    // constructions are LEGITIMATE earn paths —
    // the checkout stamp awards points when
    // the guest checks out fully paid, the
    // post-settlement stamp awards the held
    // points when the guest settles the
    // balance after checkout. A future
    // refactor that adds a 3rd earn path (e.g.
    // a "backfill earned points" tool) would
    // need to use a different id (e.g.
    // `earn-backfill-${bookingId}`) so the
    // pair-rider doesn't count the same earn
    // twice.
    //
    // Count only the ACTUAL constructions
    // (the doc(`earn-${bookingId}`) call site,
    // not the JSDoc reference).
    const earnConstructionCount = (bookingsHandlerSrc.match(
      /\.doc\(`earn-\$\{bookingId\}`\)/g
    ) || []).length;
    expect(
      earnConstructionCount,
      "expected exactly 2 earn-${bookingId} constructions (checkout + post-settlement)"
    ).toBe(2);
  });
});
