import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Per MRB-05 PR #2 (2026-08-02, per decision #159, MRB
// open-question Q1): the loyalty clawback for post-
// settlement cancellation.
//
// Two changes ship in this PR (both inside
// `handleCancelBooking`):
//
//   1. POLICY: the terminal-status reject was relaxed
//      to allow `checked-out` (the post-settlement
//      cancellation path is the clawback scenario).
//      The remaining blocked states are `checked-in`
//      (in-house cancellation is a separate flow) +
//      `cancelled` (idempotent rejection).
//
//   2. CLAWBACK: when a `checked-out` booking with
//      `loyaltyAwardStatus === "awarded"` and a
//      positive `pointsAwarded` is cancelled, the
//      member's `pointsHistory` receives a new
//      NEGATIVE entry of `-(pointsAwarded)`. The
//      `rewardsPoints` field is NOT decremented in
//      place — the negative ledger entry is the
//      ONLY mechanism (preserves the invariant
//      `rewardsPoints == sum(pointsHistory.points)`).
//      The booking's `pointsAwarded` field IS reset
//      to 0 + `loyaltyAwardStatus` is set to
//      `"clawback-recorded"` (informational snapshot;
//      the ledger is the source of truth).
//
// 24 source-text guards covering: the policy change
// (pre-transaction + in-transaction); the clawback
// trigger conditions (awarded + pointsAwarded > 0 +
// memberId + member doc exists); the negative
// `pointsHistory` entry (type, points, doc id, scope);
// the post-cancellation stamp (bookingUpdate +
// transaction.update on the same doc, final write
// wins); the `rewardsPoints` non-decrement invariant
// (the literal `rewardsPoints` field is NEVER
// decremented in place — the comment block explicitly
// states this).
describe("MRB-05 — loyalty clawback + relaxed terminal-status reject (PR #2 of 2)", () => {
  // ============================================================
  // 1. POLICY: terminal-status reject (pre-transaction)
  // ============================================================
  describe("pre-transaction terminal-status reject (the new 2-state list)", () => {
    // The pre-transaction guard is uniquely identifiable
    // by the literal `bookingData.status === "checked-in"`
    // followed eventually by `return res.status(400)`.
    // The pre-transaction block is the ONLY block in the
    // file that uses `bookingData.status` (the in-
    // transaction mirror uses `freshBooking.status`),
    // so anchoring on the status literal is safe.
    const preTxMatch = handlers.match(
      /bookingData\.status\s*===\s*["']checked-in["'][\s\S]{0,2500}?return\s+res\.status\(400\)/
    );

    it("locates the pre-transaction guard block", () => {
      expect(preTxMatch, "expected the pre-transaction cancel guard").toBeTruthy();
    });

    it("rejects `checked-in` (in-house cancellation is a separate flow)", () => {
      expect(preTxMatch).toBeTruthy();
      expect(preTxMatch![0]).toMatch(/["']checked-in["']/);
    });

    it("rejects `cancelled` (idempotent rejection of an already-cancelled booking)", () => {
      expect(preTxMatch).toBeTruthy();
      expect(preTxMatch![0]).toMatch(/["']cancelled["']/);
    });

    it("no longer rejects `checked-out` (the new MRB-05 PR #2 policy)", () => {
      // The MRB-05 PR #2 change relaxes the policy:
      // `checked-out` is now allowed for staff-initiated
      // cancellation (the post-settlement cancellation
      // path is the clawback scenario). The status
      // literal `bookingData.status === "checked-out"`
      // is no longer in the actual `if (...)` clause.
      // The comment block uses backticks
      // (`` `checked-out` ``), not double quotes, so the
      // /["']...["']/ negation won't false-match the
      // comment.
      expect(preTxMatch).toBeTruthy();
      expect(preTxMatch![0]).not.toMatch(/["']checked-out["']/);
    });
  });

  // ============================================================
  // 2. POLICY: terminal-status reject (in-transaction mirror)
  // ============================================================
  describe("in-transaction terminal-status reject (mirrors the pre-transaction check)", () => {
    // The in-transaction guard is the ONLY block in the
    // file that combines `freshBooking.status` + `throw new Error`
    // for the terminal-status check (the in-transaction
    // guest-window check is a separate `throw` and uses
    // a different error message).
    const inTxMatch = handlers.match(
      /freshBooking\.status\s*===\s*["']checked-in["'][\s\S]{0,2500}?throw\s+new\s+Error/
    );

    it("locates the in-transaction guard block", () => {
      expect(inTxMatch, "expected the in-transaction cancel guard").toBeTruthy();
    });

    it("rejects `checked-in` (mirrors the pre-transaction check)", () => {
      expect(inTxMatch).toBeTruthy();
      expect(inTxMatch![0]).toMatch(/["']checked-in["']/);
    });

    it("rejects `cancelled` (mirrors the pre-transaction check)", () => {
      expect(inTxMatch).toBeTruthy();
      expect(inTxMatch![0]).toMatch(/["']cancelled["']/);
    });

    it("no longer rejects `checked-out` (mirrors the new MRB-05 PR #2 policy)", () => {
      // Same shape as the pre-transaction check: the
      // `|| freshBooking.status === "checked-out"` clause
      // was removed; the comment block uses backticks
      // (not double quotes), so the negation is safe.
      expect(inTxMatch).toBeTruthy();
      expect(inTxMatch![0]).not.toMatch(/["']checked-out["']/);
    });
  });

  // ============================================================
  // 3. CLAWBACK: trigger conditions
  // ============================================================
  describe("clawback trigger conditions (the if-guard)", () => {
    it("checks `loyaltyAwardStatus === \"awarded\"` (the only status that triggers a clawback)", () => {
      // The pre-cancellation status was `awarded` (the
      // booking's settled total earned the points at
      // checkout). A booking with `loyaltyAwardStatus`
      // of `pending-payment` or `not-eligible` (or any
      // future status) does NOT trigger a clawback.
      expect(handlers).toMatch(
        /freshBooking\.loyaltyAwardStatus\s*===\s*["']awarded["']/
      );
    });

    it("checks `Number(freshBooking.pointsAwarded || 0) > 0` (no clawback for zero-point awards)", () => {
      // A `loyaltyAwardStatus === "awarded"` booking
      // with `pointsAwarded: 0` (e.g. a free stay that
      // earned no points) does NOT trigger a clawback —
      // there's nothing to claw back. The defensive
      // `Number(... || 0)` handles missing/undefined
      // values.
      expect(handlers).toMatch(
        /&&\s*Number\(freshBooking\.pointsAwarded\s*\|\|\s*0\)\s*>\s*0/
      );
    });

    it("derives the memberId from `freshBooking.memberId` (the awarding member)", () => {
      // The memberId on the booking was stamped at
      // checkout when the points were awarded. The
      // clawback is recorded against the same member
      // (the original awarder's ledger gets the
      // negative entry — NOT a global "void" entry).
      expect(handlers).toMatch(
        /String\(freshBooking\.memberId\s*\|\|\s*""\)\.trim\(\)/
      );
    });

    it("reads the member doc to confirm the member still exists (no clawback for orphaned members)", () => {
      // If the awarding member was deleted between
      // checkout and cancellation, there's no member
      // doc to attach the negative entry to. The
      // clawback is silently skipped in that case
      // (the original award's `pointsHistory` entry
      // remains; the booking's `pointsAwarded` is
      // still zeroed below for the audit trail).
      expect(handlers).toMatch(
        /adminDb\.collection\(["']members["']\)\.doc\(memberIdForClawback\)/
      );
      expect(handlers).toMatch(/await transaction\.get\(clawbackMemberRef\)/);
      expect(handlers).toMatch(/clawbackMemberDoc\.exists/);
    });
  });

  // ============================================================
  // 4. CLAWBACK: the negative `pointsHistory` entry
  // ============================================================
  describe("the negative `pointsHistory` entry (the ledger shape)", () => {
    it("writes the doc to the member's `pointsHistory` subcollection", () => {
      // `clawbackMemberRef.collection("pointsHistory")` —
      // the negative entry is a sibling of the original
      // `earn-${bookingId}` entry, in the same
      // subcollection.
      expect(handlers).toMatch(
        /clawbackMemberRef\.collection\(["']pointsHistory["']\)\.doc\(`clawback-\$\{bookingId\}`\)/
      );
    });

    it("uses the `clawback-${bookingId}` doc id (paired with the original `earn-${bookingId}`)", () => {
      // The doc id shape matches the existing
      // `earn-${bookingId}` pattern from
      // handleCheckoutBooking. The two entries are
      // paired + auditable (a future report can sum
      // the ledger for a booking by grepping for the
      // bookingId in the doc id).
      expect(handlers).toMatch(
        /doc\(`clawback-\$\{bookingId\}`\)/
      );
    });

    it("writes `type: \"clawback\"` (the new ledger type, distinct from \"earn\")", () => {
      // The `type` field is the discriminator for
      // ledger entries. A future report can filter
      // by `type === "clawback"` to see all
      // post-settlement cancellations.
      expect(handlers).toMatch(/type:\s*["']clawback["']/);
    });

    it("writes `points: -Number(freshBooking.pointsAwarded || 0)` (the full negative award amount)", () => {
      // The delta is the FULL awarded amount (the
      // booking's settled total is now 0, so the
      // recomputed eligible points are 0, the delta
      // is the full award). The negative sign
      // cancels the original positive `earn` entry
      // when the ledger is summed.
      expect(handlers).toMatch(
        /points:\s*clawbackPoints/
      );
      expect(handlers).toMatch(
        /const\s+clawbackPoints\s*=\s*-Number\(freshBooking\.pointsAwarded\s*\|\|\s*0\)/
      );
    });

    it("includes `bookingId` + `bookingRef` for traceability back to the cancelled booking", () => {
      // The `bookingId` is the Firestore doc id; the
      // `bookingRef` is the human-readable business
      // id (e.g. `BK-2026-00123`). Both are on the
      // entry so a future audit can join the ledger
      // back to the booking.
      expect(handlers).toMatch(/bookingId,/);
      expect(handlers).toMatch(/bookingRef:\s*freshBooking\.bookingRef/);
    });

    it("includes `by: cancelledBy` (the staff/guest who triggered the cancellation)", () => {
      // The `by` field is the cancellation actor
      // (staff email for staff cancellations, guest
      // email for self-cancellations). The original
      // `earn` entry has `by: <staff who checked
      // out>`; the clawback has `by: <whoever
      // cancelled>` — the audit trail.
      expect(handlers).toMatch(/by:\s*cancelledBy/);
    });

    it("uses the same `now` as the cancellation write (atomic timestamp)", () => {
      // The clawback entry shares the `now` captured
      // at the top of the try block (BEFORE the
      // runTransaction). The booking's cancellation
      // write + the reservation header mirror + the
      // clawback entry all share the same timestamp.
      expect(handlers).toMatch(/createdAt:\s*now/);
    });
  });

  // ============================================================
  // 5. CLAWBACK: the post-cancellation stamp on the booking
  // ============================================================
  describe("the post-cancellation stamp on the booking (the informational snapshot)", () => {
    it("zeroes the booking's `pointsAwarded` field (informational; the ledger is the source of truth)", () => {
      // The `pointsAwarded` field on the booking is a
      // derived snapshot of the ledger sum. After the
      // clawback, the booking's snapshot reads 0 (the
      // ledger has the original `+N` + the new `-N`,
      // which sums to 0 for THIS booking's slice).
      // Future bookings that reference the same
      // member are unaffected.
      expect(handlers).toMatch(
        /bookingUpdate\.pointsAwarded\s*=\s*0/
      );
    });

    it("stamps the booking's `loyaltyAwardStatus` to `clawback-recorded` (the new status)", () => {
      // The booking's `loyaltyAwardStatus` transitions
      // from `"awarded"` to `"clawback-recorded"`. The
      // new status is a permanent marker that the
      // booking's award has been reversed (vs. an
      // active `"awarded"` booking whose points are
      // still in the member's wallet).
      expect(handlers).toMatch(
        /bookingUpdate\.loyaltyAwardStatus\s*=\s*["']clawback-recorded["']/
      );
    });

    it("nulls the booking's `pointsAwardedAt` timestamp (the original award-time is no longer the truth)", () => {
      // The `pointsAwardedAt` was stamped at checkout
      // (when the original award was recorded). After
      // the clawback, the field is nulled (the
      // informational snapshot is gone; the
      // `pointsHistory` ledger entry has the
      // `createdAt` for both the original + the
      // clawback).
      expect(handlers).toMatch(
        /bookingUpdate\.pointsAwardedAt\s*=\s*null/
      );
    });

    it("applies the post-cancellation stamp via `transaction.update(bookingDocumentRef, ...)` (second write, final write wins)", () => {
      // The earlier `transaction.update(bookingDocumentRef, ...)`
      // call at the top of the block (the cancellation
      // status flip) already fired. The post-cancellation
      // stamp is a SECOND write to the same doc in the
      // same transaction — Firestore allows multiple
      // writes to the same doc in a single transaction;
      // the final write wins. The stamp lands in the
      // same atomic write that flips `status` to
      // `cancelled`.
      expect(handlers).toMatch(
        /transaction\.update\(bookingDocumentRef, \{\s*pointsAwarded:\s*0,\s*loyaltyAwardStatus:\s*["']clawback-recorded["'],\s*pointsAwardedAt:\s*null\s*\}\)/s
      );
    });
  });

  // ============================================================
  // 6. INVARIANT: `rewardsPoints` is NEVER decremented in place
  // ============================================================
  describe("the `rewardsPoints == sum(pointsHistory.points)` invariant", () => {
    it("the negative `pointsHistory` entry is the ONLY mechanism (no direct `rewardsPoints` decrement)", () => {
      // The clawback transaction does NOT write to the
      // member's `rewardsPoints` field. The invariant
      // `rewardsPoints == sum(pointsHistory.points)`
      // is preserved because the negative ledger entry
      // is the only place the clawback is recorded. A
      // future change that ALSO decremented the
      // `rewardsPoints` field would be a silent
      // corruption (the field would no longer equal
      // the ledger sum).
      //
      // The assertion: the `clawbackMemberRef`
      // (which is the member doc) is NEVER updated
      // with `transaction.update(clawbackMemberRef, ...)`
      // in the clawback block. The only `transaction.update`
      // in the block targets `bookingDocumentRef`.
      //
      // The regex below asserts: there is NO
      // `transaction.update(clawbackMemberRef` in the
      // handlers file. If a future change adds such a
      // write, this test fails.
      expect(handlers).not.toMatch(
        /transaction\.update\(clawbackMemberRef/
      );
    });

    it("the source comment explicitly states the invariant (documentation anchor)", () => {
      // The comment block in the clawback code
      // explicitly documents the invariant. The test
      // anchors on the literal invariant statement
      // (the same string the comment uses). If a
      // future refactor removes the comment, the test
      // fails — the invariant is a load-bearing
      // promise and must be documented. The
      // "is NOT decremented in place" line wraps in
      // the source comment (the `is NOT` is on one
      // line, `decremented in place.` on the next),
      // so the regex uses [\s\S]{0,20}? to span the
      // line break.
      expect(handlers).toMatch(
        /rewardsPoints\s*==\s*sum\(pointsHistory\.points\)/
      );
      expect(handlers).toMatch(
        /rewardsPoints[\s\S]{0,20}?is\s+NOT[\s\S]{0,20}?decremented\s+in\s+place/i
      );
    });
  });
});
