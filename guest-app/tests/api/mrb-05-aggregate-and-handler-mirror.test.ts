import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Per MRB-05 (2026-08-02, per decision #159): the 5
// lifecycle handlers mirror the reservation header's
// `paymentStatus` inside the same `runTransaction` as the
// booking status flip, using the new
// `computeReservationAggregatePaymentStatus` N>1 helper.
// This test file pins the per-handler mirror shape
// (in-transaction scope, the same `now`, the legacy-skip
// guard) so the contract doesn't regress.
//
// 19 source-text guards covering: the shared import (the
// new helper is in the same barrel as the MRB-04 Phase 3
// helper); the 5 per-handler mirror write shapes
// (handleConfirmBooking + handleConfirmBookingWithBalance
// + handleCheckinBooking + handleCheckoutBooking +
// handleCancelBooking); the `now` capture pattern
// (consistent across all 5 handlers); the legacy-skip
// guard (bookingReservationId.length > 0); the
// out-of-scope explicit deferral (the loyalty clawback
// in handleCancelBooking is PR #2's work).
describe("MRB-05 — aggregate helper + 5 lifecycle handler mirrors (PR #1 of 2)", () => {
  describe("shared import — both helpers are in the @spark-inn/shared barrel", () => {
    it("imports computeReservationAggregatePaymentStatus from @spark-inn/shared", () => {
      // The MRB-05 N>1 aggregate reader joins the
      // existing MRB-04 Phase 3 N=1 mapping helper in
      // the same import block (the shared barrel
      // re-exports both from `shared/utils/bookingFolio.ts`).
      expect(handlers).toMatch(
        /computeReservationAggregatePaymentStatus,?\s*\n\}\s*from\s*"@spark-inn\/shared"/
      );
    });

    it("the MRB-04 Phase 3 helper is still imported (no regression)", () => {
      // The MRB-04 Phase 3 N=1 mapping helper is still
      // needed by the 3 payment write paths (PR #1 of
      // the Phase 3 batch). The MRB-05 aggregate
      // helper is an additive reader — it does NOT
      // replace the N=1 helper. Both ship together.
      expect(handlers).toMatch(/mapBookingStatusToReservationPaymentStatus/);
    });
  });

  describe("handleConfirmBooking — the in-transaction mirror write", () => {
    it("imports the new helper into scope", () => {
      expect(handlers).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from the new status (the only possible new status is `confirmed`)", () => {
      // The status check above guarantees the prior
      // status was `pending` / `payment-uploaded` /
      // `payment-confirmed`, and the new status is
      // always `confirmed`. The mirror value is
      // `computeReservationAggregatePaymentStatus(["confirmed"])`
      // = `"confirmed"` (tier 3, all-confirmed).
      expect(handlers).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(\["confirmed"\]\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      expect(handlers).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(\["confirmed"\]\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      expect(handlers).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `now` for the booking update AND the header mirror", () => {
      // The hoisted `now` is captured at the top of
      // the try block, used for `confirmedAt` +
      // `updatedAt` in the booking update, and used
      // for `updatedAt: now` in the reservation
      // mirror. No second `new Date()` inside the
      // transaction.
      expect(handlers).toMatch(
        /confirmedAt: now,[\s\S]{0,80}?confirmedBy,[\s\S]{0,80}?updatedAt: now/
      );
      expect(handlers).toMatch(
        /updatedAt: now\s*\n\s*\}\);[\s\S]{0,1000}?if \(bookingReservationId\.length > 0\)[\s\S]{0,500}?updatedAt: now/
      );
    });
  });

  describe("handleConfirmBookingWithBalance — the in-transaction mirror write", () => {
    it("imports the new helper into scope", () => {
      expect(handlers).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from `confirmed` (the only possible new status for this handler)", () => {
      // The CWB-01 status check guarantees the prior
      // status was `payment-uploaded`, and the new
      // status is always `confirmed`.
      expect(handlers).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(\["confirmed"\]\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      expect(handlers).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(\["confirmed"\]\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      expect(handlers).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });
  });

  describe("handleCheckinBooking — the in-transaction mirror write", () => {
    it("imports the new helper into scope", () => {
      expect(handlers).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from the actual children statuses (read in the same transaction)", () => {
      // Per MRB-15-03 (2026-08-03): the check-in
      // handler now reads all children of the
      // reservation in the same runTransaction and
      // passes their statuses (not a hardcoded
      // `["checked-in"]`) to the aggregate helper.
      // The pre-MRB-15-03 hardcoded array was
      // correct for the N=1 case but wrong for the
      // N>1 case: a 2-room reservation where 1 room
      // is checked-in and 1 is still pending would
      // report `"in-house"` (the aggregate of
      // `["checked-in"]`) when the correct answer
      // is `"payment-confirmed"` (the aggregate of
      // `["checked-in", "payment-confirmed"]`).
      expect(handlers).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update + the room update", () => {
      // handleCheckinBooking updates 3 documents in
      // the same transaction: the booking
      // (`status: "checked-in"`), the room
      // (`status: "occupied"`), and now the
      // reservation header (the mirror + the
      // recomputed `checkedInRoomCount`). All 3
      // share the same `now`.
      expect(handlers).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,400}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      expect(handlers).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });
  });

  describe("handleCheckoutBooking — the in-transaction mirror write", () => {
    it("imports the new helper into scope", () => {
      expect(handlers).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from the actual children statuses (read in the same transaction)", () => {
      // Per MRB-15-03 (2026-08-03): same as the
      // check-in handler — the checkout handler
      // reads all children in the same
      // runTransaction and passes their statuses
      // (not a hardcoded `["checked-out"]`) to the
      // aggregate helper. The pre-MRB-15-03
      // hardcoded array was wrong for the N>1 case
      // (a 2-room reservation where 1 is checked-out
      // and 1 is still checked-in would report
      // `"completed"` when the correct answer is
      // `"in-house"` — the aggregate of
      // `["checked-out", "checked-in"]`).
      expect(handlers).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update + the room update + the intercom archive", () => {
      // handleCheckoutBooking updates 4 documents
      // in the same transaction: the booking
      // (status flip + UCO stamps + loyalty stamps),
      // the room (`status: "available"`), the
      // intercom thread (`resolved: true`), and
      // now the reservation header (the mirror +
      // the recomputed `checkedInRoomCount` +
      // `checkedOutRoomCount`). All 4 share the
      // same `now`.
      expect(handlers).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,400}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      expect(handlers).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });
  });

  describe("handleCancelBooking — the in-transaction mirror write + the loyalty-clawback deferral", () => {
    it("imports the new helper into scope", () => {
      expect(handlers).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from `cancelled` (the only possible new status for this handler)", () => {
      // The terminal-status reject guarantees the
      // prior status was anything but `checked-in` /
      // `checked-out` / `cancelled`. The new
      // status is always `cancelled`. The mirror
      // value is
      // `computeReservationAggregatePaymentStatus(["cancelled"])`
      // = `"cancelled"` (tier 1, all-cancelled).
      // For the N=1 case (today's entire active
      // surface) the reservation now reads
      // `cancelled` — the guest + staff can see
      // the operational state in the admin.
      expect(handlers).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(\["cancelled"\]\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the cancellation write", () => {
      expect(handlers).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(\["cancelled"\]\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      expect(handlers).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("the loyalty clawback is INTENTIONALLY out of scope (deferred to PR #2 of MRB-05)", () => {
      // The post-settlement room-cancellation
      // loyalty clawback (MRB open-question Q1) is
      // NOT shipped in PR #1. Per the spec: the
      // room-cancellation transaction should
      // recompute the points the new settled total
      // would have earned and record a negative
      // `pointsHistory` entry. That work is
      // substantial (touches the points ledger
      // shape + the existing loyalty-award
      // transaction path) and is a clean
      // separable change. The PR #1 code path
      // does NOT recompute points — the existing
      // loyalty-award path (in handleCheckoutBooking)
      // is unchanged. The comment in
      // handleCancelBooking explicitly flags the
      // deferral.
      expect(handlers).toMatch(/loyalty clawback/);
      // The source comment has the Q1 on a new line
      // after "MRB open-question" (the wrap is
      // natural in the 80-char-wide comment block,
      // with a `// ` line marker between the two
      // parts).
      expect(handlers).toMatch(/MRB open-question[\s\S]{0,30}?Q1/);
    });
  });
});
