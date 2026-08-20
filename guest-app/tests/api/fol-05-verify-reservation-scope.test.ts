// Per FOL-05 (2026-08-07, per decision #201) +
// per BAR-03 (2026-08-08, per decision #204):
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
// Per BAR-03 (2026-08-08, per decision #204): the
// three handlers share the same FOL-03 pattern (pre-read
// children BEFORE any writes; build the post-update
// child status array from the pre-read; apply all
// writes after all reads; heartbeat the header's
// `updatedAt`). The pre-BAR-03 pass was open-coded in
// all three handlers. BAR-03 extracts the shared
// pattern into `applyReservationScopePaymentTransition`
// + `preReadSiblingChildren` in
// `guest-app/server/handlers/reservationScopeTransition.ts`.
// Each handler passes a per-handler `rule.decide`
// callback (the per-child decision — return a write
// payload + new status, or `null` to skip); the helper
// handles the per-sibling `transaction.update` +
// the post-update statuses array + the reservation
// header heartbeat.
//
// This test file is the post-BAR-03 source-text
// contract: the 3 handlers each call the shared
// helper (the per-handler status checks + the
// per-handler response shape + the per-handler rule
// are still handler-local). The pre-BAR-03 "open-coded
// pass" assertions are replaced with "the helper is
// called" assertions. The behavioural round-trip
// (a verify / add-payment / reject on a multi-room
// reservation flips N siblings + touches the header)
// is covered by the existing
// `bookings-payments-multi-room.test.ts` suite (when
// extended by a future follow-up); the source-text
// guards below pin the contract at the source level
// so a future "I'll just revert the helper" refactor
// breaks the test instead of silently regressing.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlersSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const helperSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/reservationScopeTransition.ts"),
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

// Section 1: the helper exists and is exported.
describe("BAR-03 — the shared FOL-05 sibling-flip helper exists + is exported", () => {
  it("`preReadSiblingChildren` is exported from `reservationScopeTransition.ts`", () => {
    // The pre-read is hoisted out of the post-write
    // block per FOL-03 (the Firestore `runTransaction`
    // requires all reads to complete before any
    // writes). The `bookingReservationId.length === 0`
    // guard (inside the helper) skips the pre-read
    // for legacy null-`reservationId` bookings.
    expect(helperSrc).toMatch(
      /export async function preReadSiblingChildren<[\s\S]{0,500}?\(\s*transaction:\s*Transaction,[\s\S]{0,500}?\)\s*:\s*Promise<TChild\[\]>/
    );
  });

  it("`applyReservationScopePaymentTransition` is exported from `reservationScopeTransition.ts`", () => {
    // The shared FOL-05 sibling-flip pass. Each
    // handler passes a per-handler `rule.decide`
    // callback; the helper handles the per-sibling
    // `transaction.update` + the post-update
    // statuses array + the reservation header
    // heartbeat.
    expect(helperSrc).toMatch(
      /export function applyReservationScopePaymentTransition<[\s\S]{0,500}?\(\s*transaction:\s*Transaction,[\s\S]{0,500}?rule:\s*SiblingFlipRule<TChild>,[\s\S]{0,500}?\):\s*SiblingFlipResult/
    );
  });

  it("`SiblingFlipRule` + `SiblingFlipResult` + `SiblingFlipDecision` are exported interfaces", () => {
    // The contract surface that the per-handler rule
    // callback + the helper's return value use.
    expect(helperSrc).toMatch(/export type SiblingFlipRule</);
    expect(helperSrc).toMatch(/export interface SiblingFlipResult/);
    expect(helperSrc).toMatch(/export interface SiblingFlipDecision/);
  });
});

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

    it("calls the shared `preReadSiblingChildren` helper for the FOL-03 pre-read (the open-coded pre-read loop is GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded pre-read
      // (`adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)`)
      // is replaced with the `preReadSiblingChildren`
      // helper call. The pre-read sits AFTER the
      // existing payments-snapshot `get()` and BEFORE
      // the `transaction.create(paymentsRef.doc(paymentId), ...)`
      // write — the same FOL-03 reads-before-writes
      // invariant is preserved.
      expect(verifyBody).toMatch(/preReadSiblingChildren\(\s*transaction,\s*adminDb,\s*bookingReservationId,/);
      // The open-coded pre-read loop is gone.
      expect(verifyBody).not.toMatch(
        /const childrenForFlip = await transaction\.get\(\s*adminDb\.collection\("bookings"\)\.where\("reservationId", "==", bookingReservationId\)/
      );
    });

    it("calls the shared `applyReservationScopePaymentTransition` helper for the flip pass (the open-coded post-update array + sibling loop are GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded
      // `const postUpdateChildStatuses: string[] = [];`
      // array + the per-sibling `for (const flip of
      // siblingFlips)` loop are replaced with the
      // `applyReservationScopePaymentTransition`
      // helper call. The per-handler `rule.decide`
      // callback computes the per-child decision +
      // the write payload (the `payment-confirmed`
      // flip rule + the
      // `{ status: "payment-confirmed",
      // paymentConfirmedAt, handledBy, updatedAt }`
      // payload).
      expect(verifyBody).toMatch(/applyReservationScopePaymentTransition\(\s*transaction,\s*adminDb,\s*bookingReservationId,\s*bookingId,\s*siblingChildBookings,/);
      // The open-coded post-update array init is gone.
      expect(verifyBody).not.toMatch(/const postUpdateChildStatuses: string\[\] = \[\];/);
      // The open-coded sibling flip loop is gone.
      expect(verifyBody).not.toMatch(/for \(const flip of siblingFlips\) \{/);
      // The verify handler's flip rule is still
      // hand-rolled in the `rule.decide` callback —
      // the per-child coverage check (cumulative
      // reservation payment covers child.totalPrice
      // AND status is flippable).
      expect(verifyBody).toMatch(/coversChild/);
      expect(verifyBody).toMatch(/isFlippableStatus/);
    });

    it("the per-handler write payload is correct (payment-confirmed + 3 stamps)", () => {
      // The verify handler's `rule.decide` callback
      // writes the canonical FOL-05 sibling-flip
      // payload: `{ status: "payment-confirmed",
      // paymentConfirmedAt: now, handledBy: staffUid,
      // updatedAt: now }`. The target's own update
      // (in the `bookingUpdates` block above) is
      // unchanged — the helper does NOT touch the
      // target (the helper skips the target by
      // id-matching the `targetBookingId` argument).
      expect(verifyBody).toMatch(/status:\s*"payment-confirmed",\s*\n\s*paymentConfirmedAt:\s*now,\s*\n\s*handledBy:\s*staffUid,\s*\n\s*updatedAt:\s*now/);
    });

    it("does NOT write `paymentStatus` to the reservation header (per BAR-02 / #203 — the mirror is gone)", () => {
      // Per BAR-02 (2026-08-08, per decision #203):
      // the `paymentStatus` mirror is no longer
      // written. Consumers derive it at read time
      // via `computeReservationAggregatePaymentStatus`
      // over the children. The FOL-05 sibling-flip
      // pass is unchanged — only the redundant
      // header mirror is gone. The post-BAR-02
      // shape still does the
      // `transaction.update(reservationRef, { updatedAt })`
      // heartbeat (now inside the helper) but skips
      // the `paymentStatus` field entirely.
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

    it("calls the shared `preReadSiblingChildren` helper for the FOL-03 pre-read (the open-coded pre-read loop is GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded pre-read
      // (`adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)`)
      // is replaced with the `preReadSiblingChildren`
      // helper call.
      expect(addPaymentBody).toMatch(/preReadSiblingChildren\(\s*transaction,\s*adminDb,\s*bookingReservationId,/);
      expect(addPaymentBody).not.toMatch(
        /const childrenForFlip = await transaction\.get\(\s*adminDb\.collection\("bookings"\)\.where\("reservationId", "==", bookingReservationId\)/
      );
    });

    it("calls the shared `applyReservationScopePaymentTransition` helper for the flip pass (the open-coded post-update array + sibling loop are GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded post-update array + the
      // per-sibling `for (const flip of
      // siblingFlips)` loop are replaced with the
      // `applyReservationScopePaymentTransition`
      // helper call. The per-handler `rule.decide`
      // callback computes the per-child decision +
      // the write payload (same shape as the verify
      // handler — `payment-confirmed` + 3 stamps).
      expect(addPaymentBody).toMatch(/applyReservationScopePaymentTransition\(\s*transaction,\s*adminDb,\s*bookingReservationId,\s*bookingId,\s*siblingChildBookings,/);
      // The open-coded post-update array init is gone.
      expect(addPaymentBody).not.toMatch(/const postUpdateChildStatuses: string\[\] = \[\];/);
      // The open-coded sibling flip loop is gone.
      expect(addPaymentBody).not.toMatch(/for \(const flip of siblingFlips\) \{/);
      // The add-payment handler's flip rule is the
      // same as the verify handler's.
      expect(addPaymentBody).toMatch(/coversChild/);
      expect(addPaymentBody).toMatch(/isFlippableStatus/);
    });

    it("the per-handler write payload is correct (payment-confirmed + 3 stamps)", () => {
      // Same as verify.
      expect(addPaymentBody).toMatch(/status:\s*"payment-confirmed",\s*\n\s*paymentConfirmedAt:\s*now,\s*\n\s*handledBy:\s*staffUid,\s*\n\s*updatedAt:\s*now/);
    });

    it("does NOT write `paymentStatus` to the reservation header (per BAR-02 / #203 — the mirror is gone)", () => {
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

    it("calls the shared `preReadSiblingChildren` helper for the FOL-03 pre-read (the open-coded pre-read loop is GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded pre-read is replaced with
      // the `preReadSiblingChildren` helper call.
      // The reject handler doesn't need
      // `totalPrice` (the rejection rule is
      // unconditional for `payment-uploaded`
      // children), so the mapper returns the
      // minimal `{ id, status }` shape.
      expect(rejectPaymentBody).toMatch(/preReadSiblingChildren\(\s*transaction,\s*adminDb,\s*bookingReservationId,/);
      expect(rejectPaymentBody).not.toMatch(
        /const childrenForReject = await transaction\.get\(\s*adminDb\.collection\("bookings"\)\.where\("reservationId", "==", bookingReservationId\)/
      );
    });

    it("calls the shared `applyReservationScopePaymentTransition` helper for the rejection pass (the open-coded rejectableChildIds + sibling loop are GONE)", () => {
      // Per BAR-03 (2026-08-08, per decision #204):
      // the open-coded `postUpdateChildStatuses`
      // array + the `rejectableChildIds` list +
      // the per-sibling `for (const sibId of
      // rejectableChildIds)` loop are replaced
      // with the `applyReservationScopePaymentTransition`
      // helper call. The per-handler `rule.decide`
      // callback computes the per-child rejection
      // decision + the write payload (the
      // `payment-uploaded → pending` rule + the
      // `{ status: "pending",
      // paymentRejectionReason,
      // paymentRejectedAt, paymentRejectedBy,
      // holdExpiresAt, updatedAt }` payload).
      expect(rejectPaymentBody).toMatch(/applyReservationScopePaymentTransition\(\s*transaction,\s*adminDb,\s*bookingReservationId,\s*bookingId,\s*siblingChildBookings,/);
      // The open-coded rejectableChildIds list is gone.
      expect(rejectPaymentBody).not.toMatch(/const rejectableChildIds: string\[\] = \[\];/);
      // The open-coded sibling rejection loop is gone.
      expect(rejectPaymentBody).not.toMatch(/for \(const sibId of rejectableChildIds\) \{/);
    });

    it("the per-handler write payload is correct (pending + 5 stamps)", () => {
      // The reject handler's `rule.decide` callback
      // writes the canonical FOL-05 rejection
      // payload: `{ status: "pending",
      // paymentRejectionReason: safeReason,
      // paymentRejectedAt: updatedAt,
      // paymentRejectedBy, holdExpiresAt: ...,
      // updatedAt }`. More fields than the verify
      // payload (5 stamps vs 3) because rejection
      // carries the rejection metadata.
      expect(rejectPaymentBody).toMatch(
        /status:\s*"pending",[\s\S]{0,300}?paymentRejectionReason:\s*safeReason,[\s\S]{0,300}?paymentRejectedAt:\s*updatedAt,[\s\S]{0,300}?paymentRejectedBy,[\s\S]{0,300}?holdExpiresAt:\s*newDeadline\s*\?\s*Timestamp\.fromDate\(newDeadline\)\s*:\s*null,[\s\S]{0,300}?updatedAt/
      );
    });

    it("does NOT write `paymentStatus` to the reservation header (per BAR-02 / #203 — the mirror is gone)", () => {
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
      expect(rejectPaymentBody).toMatch(/siblingRejectedCount/);
    });
  });

  describe("shared FOL-05 contract across all 3 handlers", () => {
    it("every handler's pre-read sits BEFORE its first write (FOL-03 invariant)", () => {
      // The pre-read sits AFTER the existing
      // payments-snapshot / hotelConfig / booking-doc
      // `get()`s and BEFORE the first
      // `transaction.update(bookingRef, ...)` /
      // `transaction.create(paymentsRef.doc(...), ...)`
      // write. The SDK's "all reads before all
      // writes" rule is satisfied structurally.
      //
      // Per BAR-03 (2026-08-08, per decision #204):
      // the pre-read is now the
      // `preReadSiblingChildren` helper call. The
      // helper call's `await` is the read's
      // "completion" point in the SDK's eyes.
      //
      // The "first write" pattern is per-handler
      // (the verify + add-payment handlers use
      // `transaction.update(bookingRef, bookingUpdates)`;
      // the reject handler uses
      // `transaction.update(bookingRef, {`).
      const handlers = [
        { name: "verify", slice: verifyBody, firstWritePattern: "transaction.update(bookingRef, bookingUpdates)" },
        { name: "addPayment", slice: addPaymentBody, firstWritePattern: "transaction.update(bookingRef, bookingUpdates)" },
        { name: "rejectPayment", slice: rejectPaymentBody, firstWritePattern: "transaction.update(bookingRef, {" }
      ];
      for (const { name, slice, firstWritePattern } of handlers) {
        const preReadIdx = slice.indexOf("preReadSiblingChildren(");
        const firstWriteIdx = slice.indexOf(firstWritePattern);
        expect(
          preReadIdx,
          `${name} handler: preReadSiblingChildren() call must come BEFORE the first transaction.update(bookingRef, ...) call`
        ).toBeGreaterThan(0);
        expect(
          firstWriteIdx,
          `${name} handler: first ${firstWritePattern} call must be locatable`
        ).toBeGreaterThan(0);
        expect(preReadIdx).toBeLessThan(firstWriteIdx);
      }
    });

    it("every handler's `applyReservationScopePaymentTransition` call is inside the same `runTransaction` as the booking update", () => {
      // The `runTransaction` requires all writes to
      // commit atomically. The helper's queued
      // `transaction.update(bookings/{id}, ...)`
      // calls (one per flipped sibling) + the
      // reservation header heartbeat MUST be
      // inside the same `runTransaction` as the
      // target's own status update. Pinned by the
      // helper's position relative to the
      // `adminDb.runTransaction` opener in each
      // handler.
      const handlers = [
        { name: "verify", slice: verifyBody },
        { name: "addPayment", slice: addPaymentBody },
        { name: "rejectPayment", slice: rejectPaymentBody }
      ];
      for (const { name, slice } of handlers) {
        const txStart = slice.indexOf("adminDb.runTransaction(");
        const helperCall = slice.indexOf("applyReservationScopePaymentTransition(");
        expect(
          txStart,
          `${name} handler: adminDb.runTransaction( call must be locatable`
        ).toBeGreaterThan(0);
        expect(
          helperCall,
          `${name} handler: applyReservationScopePaymentTransition( call must be locatable`
        ).toBeGreaterThan(0);
        expect(helperCall).toBeGreaterThan(txStart);
      }
    });

    it("every handler does NOT open-code the sibling `transaction.update` loop (per BAR-03 / #204 — the helper owns the loop)", () => {
      // The pre-BAR-03 verify / add handlers
      // open-coded `for (const flip of
      // siblingFlips) { transaction.update(...) }`;
      // the reject handler open-coded `for (const
      // sibId of rejectableChildIds) { ... }`. Per
      // BAR-03 (2026-08-08, per decision #204): the
      // sibling flip loop is the helper's job. None
      // of the 3 handlers open-codes the loop
      // anymore.
      const handlers = [
        { name: "verify", slice: verifyBody },
        { name: "addPayment", slice: addPaymentBody },
        { name: "rejectPayment", slice: rejectPaymentBody }
      ];
      for (const { name, slice } of handlers) {
        expect(
          slice,
          `${name} handler: must not open-code the sibling transaction.update loop (the helper owns it)`
        ).not.toMatch(/for \(const flip of siblingFlips\) \{/);
        expect(
          slice,
          `${name} handler: must not open-code the rejectable siblings loop (the helper owns it)`
        ).not.toMatch(/for \(const sibId of rejectableChildIds\) \{/);
      }
    });
  });
});
