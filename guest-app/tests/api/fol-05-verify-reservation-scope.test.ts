// Per FOL-05 (2026-08-07, per decision #201):
// reservation-scope verify-payment + add-payment +
// reject-payment — the "one click = whole reservation"
// sibling-flip pass that closes the operator-reported
// "I see 1 row for verification per room" bug on the
// dashboard's pending-payments list. The fix is a
// three-handler change to
// `guest-app/server/handlers/bookings.ts`:
//   1. `handleVerifyAndRecordPayment` — pre-read
//      sibling children (FOL-03 reads-before-writes
//      rule), compute per-child post-update status,
//      flip every sibling whose `totalPrice` is now
//      covered by the new cumulative reservation
//      payment, update the reservation header's
//      `paymentStatus` via the N>1 aggregate helper.
//   2. `handleAddPayment` — same sibling-flip pass.
//      The handler was already reservation-aware for
//      the subcollection path (MRB-04 Phase 2); the
//      FOL-05 work adds the N>1 sibling logic.
//   3. `handleRejectPayment` — pre-read sibling
//      children, reject every rejectable sibling
//      (`payment-uploaded` → `pending`),
//      update the reservation header aggregate.
//
// All three changes share the same FOL-03 pattern
// (pre-read children BEFORE any writes; build the
// post-update child status array from the pre-read;
// apply all writes after all reads; aggregate the
// post-update array for the header mirror). The
// pre-FOL-05 `fullyPaid` / `transitionedToPaymentConfirmed`
// gates on the header mirror were removed because a
// partial verify / add that flips zero siblings
// still leaves the header's aggregate unchanged,
// and a partial that flips N siblings correctly
// surfaces the new aggregate.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s. The
// behavioural round-trip (a verify / add-payment /
// reject on a multi-room reservation flips N
// siblings + updates the header) is covered by the
// existing `bookings-payments-multi-room.test.ts`
// suite (when extended by a future follow-up); the
// source-text guards below pin the contract at the
// source level so a future "I'll just revert the
// sibling-flip pass" refactor breaks the test
// instead of silently regressing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlersSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice each handler's FULL function body (from the
// `export async function` opener to the next
// `export async function` closer) so the ordering
// assertions target the right scope. The slices are
// generous (the whole function) so any future re-shape
// keeps the test targeting just the relevant handler.
function sliceHandler(opener: string, closer: string): string {
  const start = handlersSrc.indexOf(opener);
  const end = handlersSrc.indexOf(closer, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return handlersSrc.slice(start, end);
}

const verifyBody = sliceHandler(
  "export async function handleVerifyAndRecordPayment",
  "export async function handleConfirmBooking"
);
const addPaymentBody = sliceHandler(
  "export async function handleAddPayment",
  "export async function handleAddRefund"
);
const rejectPaymentBody = sliceHandler(
  "export async function handleRejectPayment",
  "export async function handleCancelBooking"
);

describe("FOL-05 — verify-payment + add-payment + reject-payment are reservation-scope", () => {
  describe("handleVerifyAndRecordPayment — sibling-flip pass", () => {
    it("the function body is locatable", () => {
      // Sanity: the slice exists. If a future refactor
      // re-shapes the function (e.g. extracts it to a
      // helper), the regex matchers below still pass on
      // the wider file scope — the slice is just a
      // guard against "the handler was deleted entirely".
      expect(verifyBody.length).toBeGreaterThan(0);
    });

    it("pre-reads sibling children BEFORE any writes (FOL-03 reads-before-writes)", () => {
      // The sibling pre-read sits AFTER the existing
      // payments-snapshot `get()` and BEFORE the
      // `transaction.create(paymentsRef.doc(paymentId), ...)`
      // write. The pre-read's `get()` MUST land before
      // the first `transaction.create` / `transaction.update`
      // to satisfy the SDK's "all reads before all writes"
      // rule (the same shape FOL-03 fixed in
      // `handleCheckinBooking` + `handleCheckoutBooking`).
      const preReadIndex = verifyBody.indexOf(
        'where("reservationId", "==", bookingReservationId)'
      );
      const firstWriteIndex = verifyBody.indexOf("transaction.create(paymentsRef.doc(paymentId)");
      expect(preReadIndex).toBeGreaterThan(-1);
      expect(firstWriteIndex).toBeGreaterThan(-1);
      expect(preReadIndex).toBeLessThan(firstWriteIndex);
    });

    it("builds the post-update child status array (the flip rule)", () => {
      // The post-update child status array is built
      // from the pre-read's docs. The flip rule is:
      // a child flips to `payment-confirmed` if its
      // current status is `pending` /
      // `payment-uploaded` AND `totalCollected >=
      // child.totalPrice`. The array's name
      // (`postUpdateChildStatuses`) is the FOL-05
      // contract — pinned so a future
      // "let me just rename it" refactor breaks the
      // test instead of silently regressing.
      expect(verifyBody).toMatch(/const postUpdateChildStatuses: string\[\] = \[\];/);
      expect(verifyBody).toMatch(
        /const postStatus = isFlippableStatus && coversChild \? "payment-confirmed" : child\.status;/
      );
    });

    it("queues per-sibling `transaction.update` calls (the flip writes)", () => {
      // Every sibling that flipped gets a
      // `transaction.update(bookings/{id}, { status:
      // "payment-confirmed", paymentConfirmedAt: now,
      // handledBy: staffUid, updatedAt: now })`. The
      // loop iterates over `siblingFlips` (the
      // non-target children that just transitioned).
      // The target's own update is queued separately
      // above (the `bookingUpdates` block).
      expect(verifyBody).toMatch(
        /for \(const flip of siblingFlips\) \{[\s\S]{0,300}?transaction\.update\(adminDb\.collection\("bookings"\)\.doc\(flip\.id\), \{[\s\S]{0,200}?status: "payment-confirmed",[\s\S]{0,200}?paymentConfirmedAt: now,[\s\S]{0,200}?handledBy: staffUid,[\s\S]{0,200}?updatedAt: now/
      );
    });

    it("does NOT write `paymentStatus` to the reservation header (per BAR-02 / #203 — the mirror is gone)", () => {
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written. Consumers derive it at read time
      // via `computeReservationAggregatePaymentStatus`
      // over the children. The FOL-05 sibling-flip
      // pass is unchanged — only the redundant
      // header mirror is gone. The pre-BAR-02
      // shape wrote the mirror inside the same
      // `runTransaction` as the sibling flip; the
      // post-BAR-02 shape still does the
      // `transaction.update(reservationRef, { updatedAt })`
      // heartbeat but skips the `paymentStatus`
      // field entirely.
      expect(verifyBody).not.toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("the status check is reservation-aware (N>1 relaxed: target already past money gate + flippable siblings → proceed)", () => {
      // The pre-FOL-05 status check threw
      // ALREADY_CONFIRMED whenever the TARGET booking
      // was `payment-confirmed` or `confirmed`. The
      // FOL-05 status check RELAXES this: a target
      // already past the money gate is allowed when
      // at least one sibling is flippable (the
      // sibling-flip pass proceeds; the target's own
      // status update is skipped because its
      // post-update status equals its pre-update
      // status). N=1 + no flippable siblings throws
      // ALREADY_CONFIRMED (preserves the pre-FOL-05
      // contract for the legacy surface).
      expect(verifyBody).toMatch(
        /const hasFlippableSiblings = siblingChildBookings\.some\(\s*\(c\) => c\.id !== bookingId && \(c\.status === "pending" \|\| c\.status === "payment-uploaded"\)\s*\);/
      );
      expect(verifyBody).toMatch(
        /if \(!hasFlippableSiblings && targetAlreadyPastMoneyGate\) \{[\s\S]{0,200}?throw new Error\("ALREADY_CONFIRMED"\);/
      );
    });

    it("surfaces the sibling-flip count in the response (the `siblingFlippedCount` field)", () => {
      // The 200 OK response body carries
      // `siblingFlippedCount` so the admin UI can
      // render a "X rooms cleared" breadcrumb in the
      // post-verify success modal. The field is `0`
      // for the N=1 case + the ALREADY_CONFIRMED
      // short-circuit + the idempotent-replay
      // short-circuit. The verify handler has THREE
      // siblingFlippedCount sites: the data object in
      // the 200 OK (the main response), the
      // idempotentReplay short-circuit's data object,
      // and the ALREADY_CONFIRMED short-circuit's
      // data object (`siblingFlippedCount: 0`).
      expect(verifyBody).toMatch(/siblingFlippedCount/);
      // The main 200 OK path's `data` object carries
      // the count (after the comment block that
      // documents the FOL-05 contract).
      expect(verifyBody).toMatch(/fullyPaid,[\s\S]{0,500}?siblingFlippedCount\s*\n\s*\}[\s\S]{0,500}?return res\.status\(200\)/);
    });
  });

  describe("handleAddPayment — sibling-flip pass", () => {
    it("the function body is locatable", () => {
      expect(addPaymentBody.length).toBeGreaterThan(0);
    });

    it("pre-reads sibling children BEFORE any writes (FOL-03 reads-before-writes)", () => {
      // Same shape as the verify handler: the
      // sibling pre-read sits AFTER the
      // payments-snapshot `get()` and BEFORE the
      // first `transaction.update(bookingRef, ...)`
      // / `transaction.create(paymentsRef.doc(...))`
      // write.
      const preReadIndex = addPaymentBody.indexOf(
        'where("reservationId", "==", bookingReservationId)'
      );
      const firstWriteIndex = addPaymentBody.indexOf("transaction.update(bookingRef, bookingUpdates)");
      expect(preReadIndex).toBeGreaterThan(-1);
      expect(firstWriteIndex).toBeGreaterThan(-1);
      expect(preReadIndex).toBeLessThan(firstWriteIndex);
    });

    it("builds the post-update child status array (the flip rule)", () => {
      // Same rule as the verify handler: a child
      // flips to `payment-confirmed` if its current
      // status is `pending` / `payment-uploaded` AND
      // `totalPaid >= child.totalPrice`. The array's
      // name is `postUpdateChildStatuses`.
      expect(addPaymentBody).toMatch(/const postUpdateChildStatuses: string\[\] = \[\];/);
      expect(addPaymentBody).toMatch(
        /const postStatus = isFlippableStatus && coversChild \? "payment-confirmed" : child\.status;/
      );
    });

    it("queues per-sibling `transaction.update` calls (the flip writes)", () => {
      expect(addPaymentBody).toMatch(
        /for \(const flip of siblingFlips\) \{[\s\S]{0,300}?transaction\.update\(adminDb\.collection\("bookings"\)\.doc\(flip\.id\), \{[\s\S]{0,200}?status: "payment-confirmed",[\s\S]{0,200}?paymentConfirmedAt: now,[\s\S]{0,200}?handledBy: staffUid,[\s\S]{0,200}?updatedAt: now/
      );
    });

    it("updates the reservation header's `paymentStatus` via the N>1 aggregate (no `transitionedToPaymentConfirmed` gate)", () => {
      // The pre-FOL-05 `transitionedToPaymentConfirmed`
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written. The pre-BAR-02 mirror (the
      // reservation-id + sibling-children count
      // guard around the `paymentStatus:
      // computeReservationAggregatePaymentStatus(postUpdateChildStatuses)`
      // write) is gone. The FOL-05 sibling-flip
      // pass is unchanged.
      expect(addPaymentBody).not.toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
      // The pre-FOL-05 gate is GONE — the new mirror
      // is not gated on the target's transition flag.
      expect(addPaymentBody).not.toMatch(
        /if \(transitionedToPaymentConfirmed && bookingReservationId\.length > 0\) \{[\s\S]{0,300}?paymentStatus: /
      );
    });

    it("surfaces the sibling-flip count in the response (the `siblingFlippedCount` field)", () => {
      expect(addPaymentBody).toMatch(
        /idempotentReplay,[\s\S]{0,200}?siblingFlippedCount\s*\n\s*\}/
      );
    });
  });

  describe("handleRejectPayment — sibling-rejection pass", () => {
    it("the function body is locatable", () => {
      expect(rejectPaymentBody.length).toBeGreaterThan(0);
    });

    it("pre-reads sibling children BEFORE any writes (FOL-03 reads-before-writes)", () => {
      // Same shape as the verify + add-payment
      // handlers: the sibling pre-read sits AFTER
      // the booking-doc `get()` + the hotelConfig
      // `get()` and BEFORE the first
      // `transaction.update(bookingRef, ...)`.
      const preReadIndex = rejectPaymentBody.indexOf(
        'where("reservationId", "==", bookingReservationId)'
      );
      const firstWriteIndex = rejectPaymentBody.indexOf("transaction.update(bookingRef, {");
      expect(preReadIndex).toBeGreaterThan(-1);
      expect(firstWriteIndex).toBeGreaterThan(-1);
      expect(preReadIndex).toBeLessThan(firstWriteIndex);
    });

    it("builds the post-update child status array (the reject rule)", () => {
      // The reject rule is the inverse of the flip
      // rule: every child currently in
      // `payment-uploaded` flips to `pending` (the
      // lead + every rejectable sibling). The
      // array's name is `postUpdateChildStatuses`.
      expect(rejectPaymentBody).toMatch(/const postUpdateChildStatuses: string\[\] = \[\];/);
      expect(rejectPaymentBody).toMatch(
        /if \(child\.status === "payment-uploaded"\) \{[\s\S]{0,200}?postUpdateChildStatuses\.push\("pending"\);/
      );
    });

    it("queues per-sibling `transaction.update` calls (the reject writes)", () => {
      // Every rejectable sibling gets a
      // `transaction.update(bookings/{id}, { status:
      // "pending", paymentRejectionReason: ..., ... })`
      // with the same `paymentRejectionReason` +
      // `paymentRejectedAt` + `paymentRejectedBy` +
      // `holdExpiresAt` + `updatedAt` stamps the
      // target booking gets.
      expect(rejectPaymentBody).toMatch(
        /for \(const sibId of rejectableChildIds\) \{[\s\S]{0,300}?if \(sibId === bookingId\) continue;[\s\S]{0,300}?transaction\.update\(adminDb\.collection\("bookings"\)\.doc\(sibId\), \{[\s\S]{0,300}?status: "pending",[\s\S]{0,200}?paymentRejectionReason: safeReason,[\s\S]{0,200}?paymentRejectedAt: updatedAt,[\s\S]{0,200}?holdExpiresAt: newDeadline \? Timestamp\.fromDate\(newDeadline\) : null/
      );
    });

    it("updates the reservation header's `paymentStatus` via the N>1 aggregate (no `isTargetInPaymentUploaded` gate)", () => {
      // The pre-FOL-05 reject handler gated the
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written. The pre-BAR-02 mirror (the
      // reservation-id + sibling-children count
      // guard around the
      // `paymentStatus: computeReservationAggregatePaymentStatus(postUpdateChildStatuses)`
      // write) is gone. The FOL-05 sibling-rejection
      // pass is unchanged.
      expect(rejectPaymentBody).not.toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("the status check is reservation-aware (N>1 relaxed: target already past money gate + rejectable siblings → proceed)", () => {
      // The pre-FOL-05 status check threw for any
      // status other than `payment-uploaded`. The
      // FOL-05 status check RELAXES this: a target
      // already past the money gate is allowed when
      // at least one sibling is rejectable. The
      // `hasRejectableSiblings` pre-read is the
      // decision input. N=1 + no rejectable
      // siblings throws (preserves the pre-FOL-05
      // contract for the legacy surface).
      expect(rejectPaymentBody).toMatch(
        /const hasRejectableSiblings = siblingChildBookings\.some\(\s*\(c\) => c\.id !== bookingId && c\.status === "payment-uploaded"\s*\);/
      );
      expect(rejectPaymentBody).toMatch(
        /if \(!isTargetInPaymentUploaded && !hasRejectableSiblings\) \{[\s\S]{0,200}?throw new Error\(`Only a booking in 'payment-uploaded' status can be rejected/
      );
    });

    it("surfaces the sibling-rejection count in the response (the `siblingRejectedCount` field)", () => {
      // The 200 OK response body carries
      // `siblingRejectedCount` so the admin UI can
      // render a "X rooms rejected" breadcrumb in the
      // post-reject success flow.
      expect(rejectPaymentBody).toMatch(
        /holdExpiresAt: freshHoldExpiresAt,[\s\S]{0,500}?siblingRejectedCount\s*\n\s*\}/
      );
    });
  });

  describe("shared FOL-05 contract across all 3 handlers", () => {
    it("every handler's pre-read sits BEFORE its first write (FOL-03 invariant)", () => {
      // The 3 handlers share the same FOL-05 shape
      // (pre-read → flip pass → writes). The FOL-03
      // "all reads before all writes" rule is the
      // SDK's hard requirement. A future refactor
      // that adds a `transaction.get()` after a
      // `transaction.update()` would surface the
      // FOL-03 error in prod; this test pins the
      // invariant at the source level.
      const bodies: Array<{ name: string; body: string; preReadMarker: string; firstWriteMarker: string }> = [
        { name: "verify", body: verifyBody, preReadMarker: 'where("reservationId", "==", bookingReservationId)', firstWriteMarker: "transaction.create(paymentsRef.doc(paymentId)" },
        { name: "add-payment", body: addPaymentBody, preReadMarker: 'where("reservationId", "==", bookingReservationId)', firstWriteMarker: "transaction.update(bookingRef, bookingUpdates)" },
        { name: "reject", body: rejectPaymentBody, preReadMarker: 'where("reservationId", "==", bookingReservationId)', firstWriteMarker: "transaction.update(bookingRef, {" }
      ];
      for (const { name, body, preReadMarker, firstWriteMarker } of bodies) {
        const preReadIndex = body.indexOf(preReadMarker);
        const firstWriteIndex = body.indexOf(firstWriteMarker);
        expect(preReadIndex, `${name}: pre-read marker not found`).toBeGreaterThan(-1);
        expect(firstWriteIndex, `${name}: first-write marker not found`).toBeGreaterThan(-1);
        expect(preReadIndex, `${name}: pre-read must come before first write (FOL-03 reads-before-writes)`).toBeLessThan(firstWriteIndex);
      }
    });

    it("every handler uses the N>1 aggregate helper for the header mirror", () => {
      // The pre-FOL-05 single-child mapper
      // (`mapBookingStatusToReservationPaymentStatus(status)`)
      // was the N=1 mapping. The FOL-05 mirror is
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written. The aggregate helper is still
      // available (consumers call it at read time
      // via `deriveReservationCounters` +
      // `computeReservationAggregatePaymentStatus`)
      // — but the WRITE of the aggregate to the
      // reservation header is gone. None of the 3
      // handlers call the helper as a write value
      // anymore; a future refactor that
      // re-introduces the mirror write is a
      // contract regression. The pre-BAR-02 test
      // shape (the helper is called as a write
      // value) is replaced with the BAR-02
      // assertion: the helper is NOT called in
      // the FOL-05 handlers anymore.
      expect(verifyBody).not.toMatch(/computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/);
      expect(addPaymentBody).not.toMatch(/computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/);
      expect(rejectPaymentBody).not.toMatch(/computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/);
    });

    it("every handler's pre-FOL-05 `fullyPaid` / `transitionedToPaymentConfirmed` gate is GONE", () => {
      // The pre-FOL-05 verify gate was
      // `if (fullyPaid && bookingReservationId.length > 0)`.
      // The pre-FOL-05 add-payment gate was
      // `if (transitionedToPaymentConfirmed && bookingReservationId.length > 0)`.
      // Both are gone — the FOL-05 mirror fires on
      // EVERY verify / add for new reservations.
      expect(verifyBody).not.toMatch(
        /if \(fullyPaid && bookingReservationId\.length > 0\) \{[\s\S]{0,300}?paymentStatus: /
      );
      expect(addPaymentBody).not.toMatch(
        /if \(transitionedToPaymentConfirmed && bookingReservationId\.length > 0\) \{[\s\S]{0,300}?paymentStatus: /
      );
    });
  });
});
