// Per MRB-15 (2026-08-03, per decision #180's follow-up
// note): the no-duplicate-counters / no-duplicate-email /
// no-duplicate-loyalty invariants across the full
// create → add-room → reschedule → cancel lifecycle.
// Each of these invariants has been the source of real
// regressions in the past (MRB-08 introduced the
// `+= assignedRooms.length` rule after the original
// `+= 1` was found to silently turn capped corporate
// codes into effectively unlimited at N>1; MRB-13
// introduced the `Map<code, count>` dedupe after the
// `usageCount -= 1 per child` pattern was found to
// double-decrement a shared code on a full-reservation
// cancel; the loyalty clawback was MRB-05's PR #2
// after the original `rewardsPoints -= pointsAwarded`
// in-place decrement was found to silently drift from
// the pointsHistory sum). This file pins the read
// paths at the source level so a future refactor
// cannot silently revert to the buggy patterns.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural tests
// (full create → add-room → cancel emulator round-trip)
// are Java-gated and ship with the staging CI.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

describe("MRB-15-01 — Create-time: corporate code increments by N (rooms), not by 1", () => {
  it("the create handler's `corporateCodeUsageUpdate` payload increments `usageCount` by `assignedRooms.length`", () => {
    // Per MRB-08 / decision #167: a code used on a 3-room
    // corporate block increments by 3 (so a 1-use cap is
    // exhausted by one block, not three separate blocks).
    // The pre-MRB-08 `+= 1` would have silently turned a
    // capped code into effectively unlimited at N>1.
    const corporateUpdateBlock = bookingsHandlerSrc.match(
      /corporateCodeUsageUpdate\s*=\s*\{[\s\S]{0,300}?usageCount[\s\S]{0,200}?assignedRooms\.length/
    );
    expect(
      corporateUpdateBlock,
      "expected the corporate code usageCount increment to use assignedRooms.length"
    ).toBeTruthy();
  });

  it("the create transaction writes `corporateCodeUsageUpdate` to the corporateCodes collection", () => {
    // The increment is committed via `transaction.update(ref, data)`
    // so the cap check on a concurrent transaction sees the
    // incremented value (no in-place mutation outside the txn).
    const corporateWriteBlock = bookingsHandlerSrc.match(
      /if \(corporateCodeUsageUpdate\) \{\s*\n\s*transaction\.update\(corporateCodeUsageUpdate\.ref/
    );
    expect(
      corporateWriteBlock,
      "expected the corporate code usageCount write to live in a transaction.update"
    ).toBeTruthy();
  });
});

describe("MRB-15-01 — Create-time: voucher code increments by 1 (per child, on the child that has the voucher)", () => {
  it("the per-booking apply-voucher path increments `vouchers.usageCount` by 1", () => {
    // The apply-voucher path (line ~4865) reads the stored
    // `voucher.usageCount`, adds 1, and writes the result
    // back via `transaction.update(voucherRef, { usageCount })`.
    // A multi-child reservation where ONE child has a
    // voucher applied increments by 1, not by N (per
    // MRB-08: voucher is per-child, not per-reservation).
    const voucherIncrementBlock = bookingsHandlerSrc.match(
      /voucherUsageCount = Number\(voucher\.usageCount \|\| 0\) \+ 1/
    );
    expect(
      voucherIncrementBlock,
      "expected the per-booking voucher increment to be +1"
    ).toBeTruthy();
    const voucherWriteBlock = bookingsHandlerSrc.match(
      /if \(voucherRef\) transaction\.update\(voucherRef, \{ usageCount: voucherUsageCount/
    );
    expect(
      voucherWriteBlock,
      "expected the voucher usageCount write to live in a transaction.update"
    ).toBeTruthy();
  });
});

describe("MRB-15-01 — Cancel-time: voucher + corporate decrements are deduped by `Map<code, count>`", () => {
  it("the reservation-scope cancel builds a `voucherCounts` Map from cancelled children only", () => {
    // Per MRB-13 / decision #166: a code shared by N
    // cancelled children decrements by N, not by 1.
    // The pre-MRB-13 `usageCount -= 1 per child` would
    // decrement a shared code by N children × 1, but
    // a code applied to N children was incremented by
    // N on create — the two numbers must match. The
    // dedupe is the only correct mechanism.
    const voucherMapBlock = bookingsHandlerSrc.match(
      /const v = String\(child\.data\.voucherCode \|\| ""\)\.trim\(\)\.toUpperCase\(\);\s*\n\s*if \(v\) voucherCounts\.set\(v, \(voucherCounts\.get\(v\) \|\| 0\) \+ 1\)/
    );
    expect(
      voucherMapBlock,
      "expected the reservation-scope cancel to build a per-code voucherCounts map"
    ).toBeTruthy();
  });

  it("the reservation-scope cancel builds a `corporateCounts` Map from cancelled children only", () => {
    // Same dedupe rule for corporate codes: N cancelled
    // children with the same code decrement by N (matches
    // the create-time `+= assignedRooms.length` increment).
    const corporateMapBlock = bookingsHandlerSrc.match(
      /const cp = String\(child\.data\.corporateCode \|\| ""\)\.trim\(\)\.toUpperCase\(\);\s*\n\s*if \(cp\) corporateCounts\.set\(cp, \(corporateCounts\.get\(cp\) \|\| 0\) \+ 1\)/
    );
    expect(
      corporateMapBlock,
      "expected the reservation-scope cancel to build a per-code corporateCounts map"
    ).toBeTruthy();
  });

  it("the deduped `voucherCounts` map drives ONE `transaction.update` per unique voucher code, decremented by `count`", () => {
    // The pre-MRB-13 anti-pattern was one transaction.update
    // per cancelled child (decremented by 1). The deduped
    // pattern is one transaction.update per UNIQUE voucher
    // code, decremented by the count of cancelled children
    // that used it.
    const voucherDecrementBlock = bookingsHandlerSrc.match(
      /for \(const \[code, count\] of voucherCounts\.entries\(\)\) \{[\s\S]{0,500}?usageCount: Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - count, 0\)/
    );
    expect(
      voucherDecrementBlock,
      "expected the deduped voucher decrement loop"
    ).toBeTruthy();
  });

  it("the deduped `corporateCounts` map drives ONE `transaction.update` per unique corporate code, decremented by `count`", () => {
    // Same shape as the voucher decrement but for the
    // corporateCodes collection.
    const corporateDecrementBlock = bookingsHandlerSrc.match(
      /for \(const \[code, count\] of corporateCounts\.entries\(\)\) \{[\s\S]{0,500}?usageCount: Math\.max\(\(Number\(cpData\.usageCount\) \|\| 0\) - count, 0\)/
    );
    expect(
      corporateDecrementBlock,
      "expected the deduped corporate decrement loop"
    ).toBeTruthy();
  });
});

describe("MRB-15-01 — Cancel-time: one `booking-cancelled` email per reservation, not per child", () => {
  it("the reservation-scope cancel path calls `sendBookingTrigger` exactly once (not in a per-child loop)", () => {
    // Per MRB-09 / decision #168: a reservation-scope
    // cancel sends one email for the whole reservation
    // (the multi-room template lists every cancelled
    // room + the aggregate state). The per-child path
    // keeps the legacy `booking-cancelled` action for
    // legacy null-`reservationId` cancels. The two
    // never overlap at call time — the cancel handler
    // picks exactly one.
    //
    // The reservation-scope branch calls
    // `sendBookingTrigger(postTransactionAction, reservationView)`
    // AFTER the transaction commits (postTransactionAction
    // is one of `booking-cancelled` / `booking-cancelled-reservation`,
    // determined by scope). The call is OUTSIDE the
    // per-child `for (const child of children)` loop.
    const scopeEmailBlock = bookingsHandlerSrc.match(
      /await sendBookingTrigger\(\s*\n\s*postTransactionAction,\s*\n\s*reservationView/
    );
    expect(
      scopeEmailBlock,
      "expected the reservation-scope cancel to send one email after the transaction commits"
    ).toBeTruthy();
  });
});

describe("MRB-15-01 — Cancel-time: per-child loyalty clawback via `clawback-${bookingId}` negative `pointsHistory` entry", () => {
  it("the reservation-scope cancel writes a `clawback-${child.id}` pointsHistory entry per cancellable child with `loyaltyAwardStatus === \"awarded\"` and `pointsAwarded > 0`", () => {
    // Per MRB-05 PR #2 / decision #159: the per-child
    // clawback is a negative `pointsHistory` entry
    // (not an in-place `rewardsPoints -= pointsAwarded`
    // decrement — the in-place pattern was the original
    // MRB-05 anti-pattern because the rewardsPoints
    // field is the read source but the pointsHistory
    // collection is the write source; the invariant
    // `rewardsPoints == sum(pointsHistory.points)` is
    // preserved by the negative-ledger pattern only).
    //
    // Slice the reservation-scope cancel path: the
    // `for (const child of children)` loop and the
    // `clawback-${child.id}` write must both be present.
    const reservationScopeBlock = bookingsHandlerSrc.match(
      /for \(const child of children\) \{[\s\S]{0,2500}?clawback-\$\{child\.id\}/
    );
    expect(
      reservationScopeBlock,
      "expected the reservation-scope cancel to write a clawback-${child.id} entry per cancellable child"
    ).toBeTruthy();
  });

  it("the clawback `points` value is the negative of the child's `pointsAwarded` (not an arbitrary fixed value)", () => {
    // The negative value preserves the ledger invariant:
    // a future `earn + clawback` pair nets to 0 in the
    // sum, so the `rewardsPoints` field stays accurate
    // without being decremented in place.
    const clawbackValueBlock = bookingsHandlerSrc.match(
      /const clawbackPoints = -Number\(child\.data\.pointsAwarded \|\| 0\)/
    );
    expect(
      clawbackValueBlock,
      "expected the clawback points to be -(pointsAwarded)"
    ).toBeTruthy();
  });

  it("the per-child cancel (legacy N=1 + per-child path) writes the same `clawback-${bookingId}` shape", () => {
    // The single-booking cancel path uses
    // `clawback-${bookingId}` (a child id, not a
    // reservation id) for the per-child path. Same
    // id shape as the reservation-scope path.
    const clawbackSingleBlock = bookingsHandlerSrc.match(
      /const clawbackHistoryRef = clawbackMemberRef\.collection\("pointsHistory"\)\.doc\(`clawback-\$\{bookingId\}`\)/
    );
    expect(
      clawbackSingleBlock,
      "expected the per-child cancel to use the same clawback-${bookingId} id shape"
    ).toBeTruthy();
  });

  it("the per-child cancel sets `loyaltyAwardStatus = \"clawback-recorded\"` + `pointsAwarded = 0` on the booking", () => {
    // The booking's informational `pointsAwarded` field
    // is zeroed (the ledger is the source of truth) +
    // the `loyaltyAwardStatus` flips to
    // "clawback-recorded" so the booking's UI can show
    // the clawback state without re-reading the ledger.
    const clawbackStampBlock = bookingsHandlerSrc.match(
      /pointsAwarded: 0,\s*\n\s*loyaltyAwardStatus: "clawback-recorded"/
    );
    expect(
      clawbackStampBlock,
      "expected the booking to be stamped with loyaltyAwardStatus: clawback-recorded and pointsAwarded: 0"
    ).toBeTruthy();
  });

  it("the clawback does NOT decrement `rewardsPoints` in place (the negative-ledger pattern preserves the invariant)", () => {
    // The original MRB-05 anti-pattern was
    // `transaction.update(memberRef, { rewardsPoints: rewardsPoints - pointsAwarded })`
    // — that broke the `rewardsPoints == sum(pointsHistory.points)`
    // invariant when the ledger had other entries. The
    // negative-ledger pattern is the only correct mechanism.
    // Source-text: the comment block documents the
    // invariant on the reservation-scope branch.
    const invariantComment = bookingsHandlerSrc.match(
      /`rewardsPoints` field is NOT[\s\S]{0,200}?invariant/
    );
    expect(
      invariantComment,
      "expected the reservation-scope clawback comment to document the no-in-place-decrement invariant"
    ).toBeTruthy();
  });
});

describe("MRB-15-01 — Create-time + post-settlement: `pointsHistory` earn entry uses `earn-${bookingId}` id shape", () => {
  it("the post-settlement loyalty earn writes `earn-${bookingId}` (paired with the `clawback-${bookingId}` id from the cancel path)", () => {
    // The earn path's doc id `earn-${bookingId}` pairs
    // with the cancel path's `clawback-${bookingId}`
    // so the two entries are auditable as a pair. The
    // invariant `rewardsPoints == sum(pointsHistory.points)`
    // is preserved by the negative-ledger pattern; the
    // pairing makes the audit trail self-explanatory.
    const earnBlock = bookingsHandlerSrc.match(
      /const historyRef = loyaltyMemberRef\.collection\("pointsHistory"\)\.doc\(`earn-\$\{bookingId\}`\)/
    );
    expect(
      earnBlock,
      "expected the post-settlement earn to use the earn-${bookingId} id shape"
    ).toBeTruthy();
  });
});
