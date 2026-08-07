import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice each handler body out of the file so the guards
// below are scoped to the MRB-04 Phase 3 PR #2 changes (the
// 3 status-changing payment write paths). The slices start
// at the `export async function` declaration and end at the
// next `export async function` declaration (the next handler
// in the file). Same pattern as the MRB-04 Phase 2 +
// Phase 2.x source-text test files.
function extractHandleAddPayment(): string {
  const start = handlers.indexOf("export async function handleAddPayment");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleAddRefund", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
function extractHandleVerifyAndRecordPayment(): string {
  const start = handlers.indexOf("export async function handleVerifyAndRecordPayment");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleConfirmBooking", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
function extractHandleRejectPayment(): string {
  const start = handlers.indexOf("export async function handleRejectPayment");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleCancelBooking", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
function extractHandleAddRefund(): string {
  const start = handlers.indexOf("export async function handleAddRefund");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleMarkPaymentConfirmed", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}

const addPayment = extractHandleAddPayment();
const verifyAndRecord = extractHandleVerifyAndRecordPayment();
const rejectPayment = extractHandleRejectPayment();
const addRefund = extractHandleAddRefund();

// Per MRB-04 Phase 3 (2026-08-02, per decision #159): the
// reservation header's `paymentStatus` must mirror the
// per-room money state. The 3 status-changing payment write
// paths (handleAddPayment, handleVerifyAndRecordPayment,
// handleRejectPayment) write the mirror inside the same
// `runTransaction` as the booking update, gated on
// `bookingReservationId.length > 0` (legacy null-`reservationId`
// bookings skip the write). `handleAddRefund` is the
// explicit exclusion — it doesn't change `booking.status`,
// so the refund ledger carries the money state, not the
// lifecycle status.
//
// 18 source-text guards covering: the helper import, the
// per-handler mirror write shape, the in-transaction scope,
// the legacy-skip guard, the `now` reuse, and the
// `handleAddRefund` exclusion.
describe("MRB-04 Phase 3 — reservation paymentStatus mirror (PR #2 of 2)", () => {
  describe("shared import — the helper is in the @spark-inn/shared barrel", () => {
    it("imports mapBookingStatusToReservationPaymentStatus from @spark-inn/shared", () => {
      // The Phase 3 helper lives in
      // `shared/utils/bookingFolio.ts` (PR #1). The guest
      // server's import block in `bookings.ts` pulls it
      // from the shared barrel, the same way it pulls
      // `countExtraBedsInUse` + `checkExtraBedInventory`.
      //
      // Per MRB-05: the import block now also pulls the
      // N>1 aggregate reader
      // (`computeReservationAggregatePaymentStatus`),
      // added in the same import block. The regex
      // below checks for the Phase 3 helper anywhere in
      // the shared barrel import (not just as the
      // trailing symbol — the aggregate reader is now
      // the trailing symbol, same alternation pattern
      // as the MRB-04 Phase 2 commit's collateral
      // fix on `finance-lifecycle-polish.test.ts`).
      expect(handlers).toMatch(
        /mapBookingStatusToReservationPaymentStatus,?\s*\n[\s\S]{0,3000}?\}\s*from\s*"@spark-inn\/shared"/
      );
    });
  });

  describe("handleAddPayment — the in-transaction mirror write", () => {
    // Per FOL-05 (2026-08-07, per decision #201): the
    // add-payment mirror is now aggregate-sourced (the
    // post-update child statuses, fed through
    // `computeReservationAggregatePaymentStatus`), not
    // the pre-FOL-05 N=1
    // `mapBookingStatusToReservationPaymentStatus(bookingDataSnapshot.status)`
    // mapping. The pre-FOL-05 `transitionedToPaymentConfirmed`
    // gate was removed because a partial add-payment
    // that flips zero siblings still leaves the header's
    // aggregate unchanged, and a partial add-payment
    // that flips N siblings correctly surfaces the new
    // aggregate. The contract is now:
    //   `if (bookingReservationId.length > 0 && siblingChildBookings.length > 0) { ... }`
    it("imports the aggregate helper into scope", () => {
      // The handler body must reference the aggregate
      // helper name directly. Pinned by the
      // sibling-flip pass's per-handler call site.
      expect(addPayment).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from the aggregate (NOT a hardcoded string or the N=1 mapper)", () => {
      // The mirror is
      // `paymentStatus: computeReservationAggregatePaymentStatus(postUpdateChildStatuses)`,
      // not the pre-FOL-05 single-child mapper.
      // FOL-05's whole point: a single verify / add
      // can flip N siblings, and the header must read
      // the post-update AGGREGATE, not a single mapped
      // status. The pre-update child array is
      // pre-read inside the transaction (per FOL-03)
      // and the per-child status replacement is
      // computed before any write.
      expect(addPayment).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      // The `transaction.update(reservationRef, ...)`
      // call is inside the
      // `await adminDb.runTransaction(...)` block
      // (NOT in a separate transaction). The mirror
      // is atomic with the booking update + every
      // sibling flip.
      expect(addPayment).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0 && siblingChildBookings.length > 0` (FOL-05 legacy skip)", () => {
      // The pre-FOL-05 `transitionedToPaymentConfirmed`
      // guard was removed. The post-FOL-05 guard is
      // the reservation-id check + the pre-read
      // children count (a legacy null-`reservationId`
      // booking skips BOTH branches because
      // `siblingChildBookings` is `[]` when
      // `bookingReservationId.length === 0`).
      // byte-equivalent to pre-Phase 3 behavior for
      // legacy records; the N=1 case is
      // byte-equivalent to the pre-FOL-05 mirror
      // (one-element array → aggregate =
      // `mapBookingStatusToReservationPaymentStatus` of
      // the single element).
      expect(addPayment).toMatch(
        /if \(bookingReservationId\.length > 0 && siblingChildBookings\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `now` for the booking update AND the header mirror (no second new Date())", () => {
      // The mirror block uses `updatedAt: now` (the
      // hoisted `now` from the top of the try block).
      // The conditional booking update uses the same
      // `now` via `const updatedAt = now; ... updatedAt`
      // (shorthand). Both reference the same value.
      // The `now` is captured ONCE at the top of the try
      // block, stable across transaction retries.
      expect(addPayment).toMatch(/const now = new Date\(\);/);
      expect(addPayment).toMatch(/const updatedAt = now;/);
      expect(addPayment).toMatch(/updatedAt: now\s*\n\s*\}\);/);  // mirror block
    });
  });

  describe("handleVerifyAndRecordPayment — the in-transaction mirror write", () => {
    // Per FOL-05 (2026-08-07, per decision #201): the
    // verify mirror is also aggregate-sourced now, with
    // the pre-FOL-05 `fullyPaid` gate removed. The
    // contract is now:
    //   `if (bookingReservationId.length > 0 && siblingChildBookings.length > 0) { ... }`
    // with `paymentStatus: computeReservationAggregatePaymentStatus(postUpdateChildStatuses)`.
    it("imports the aggregate helper into scope", () => {
      expect(verifyAndRecord).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives the mirror value from the aggregate (NOT the pre-FOL-05 N=1 mapper)", () => {
      // The verify path's mirror is now aggregate-sourced
      // — same helper call shape as `handleAddPayment`,
      // different sibling-pre-read result. FOL-05's
      // sibling-flip pass means a single verify can flip
      // N siblings, and the header must read the
      // post-update AGGREGATE.
      expect(verifyAndRecord).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      expect(verifyAndRecord).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0 && siblingChildBookings.length > 0` (FOL-05 legacy skip)", () => {
      // The pre-FOL-05 `fullyPaid` guard was removed.
      // The post-FOL-05 guard is the reservation-id
      // check + the pre-read children count.
      // byte-equivalent to pre-Phase 3 for legacy
      // records; the N=1 case is byte-equivalent to
      // the pre-FOL-05 mirror.
      expect(verifyAndRecord).toMatch(
        /if \(bookingReservationId\.length > 0 && siblingChildBookings\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `now` for the booking update AND the header mirror", () => {
      // The `now` captured at the top of the try block
      // is reused for `bookingUpdates.updatedAt`,
      // `bookingUpdates.paymentConfirmedAt` (assigned
      // via property assignment, not object literal —
      // see source), the per-sibling `update` writes,
      // AND the reservation header's `updatedAt`. No
      // `new Date()` allocation inside the transaction.
      expect(verifyAndRecord).toMatch(/const now = new Date\(\);/);
      expect(verifyAndRecord).toMatch(/updatedAt: now\s*\n\s*\};/);  // bookingUpdates
      expect(verifyAndRecord).toMatch(/bookingUpdates\.paymentConfirmedAt = now;/);  // conditional
      expect(verifyAndRecord).toMatch(/updatedAt: now\s*\n\s*\}\);/);  // mirror block
    });
  });

  describe("handleRejectPayment — the in-transaction mirror write (PEX path)", () => {
    // Per FOL-05 (2026-08-07, per decision #201): the
    // reject mirror is now aggregate-sourced (every
    // rejectable child flips, so the post-update
    // aggregate is the new "everything in the
    // reservation is `pending`" or "mixed" state).
    // The pre-FOL-05 single-child mapper call is gone
    // — the aggregate is the right shape for N>1
    // sibling rejection.
    it("imports the aggregate helper into scope", () => {
      expect(rejectPayment).toMatch(/computeReservationAggregatePaymentStatus\(/);
    });

    it("derives `bookingReservationId` from `data.reservationId` (the canonical MRB-01 linkage)", () => {
      // The reject path did NOT previously have the
      // `bookingReservationId` coercion (no
      // reservation-scoped writes before Phase 3). Phase 3
      // adds the same `String(...).trim()` defensive
      // coercion the other handlers use, so legacy null
      // values normalize to `""` and the length check
      // below is a clean skip.
      expect(rejectPayment).toMatch(
        /const bookingReservationId = String\(\(data as any\)\.reservationId \|\| ""\)\.trim\(\);/
      );
    });

    it("derives the mirror value from the post-update child statuses (FOL-05 aggregate, NOT the pre-FOL-05 single-child mapper)", () => {
      // FOL-05: the reject path's mirror value
      // comes from the per-child post-update
      // statuses — every rejectable child
      // transitioned to `"pending"`, the rest keep
      // their pre-update status. The aggregate
      // reader computes the new header value (e.g.
      // all-siblings-`payment-uploaded`-flipped →
      // `"awaiting-payment"`, or a mix
      // → `"payment-uploaded"` / `"confirmed"` /
      // whatever the remaining children's statuses
      // are). The pre-FOL-05 hardcoded
      // `mapBookingStatusToReservationPaymentStatus("pending")`
      // was correct for N=1 but wrong for N>1 (a
      // partial reject needs the aggregate).
      expect(rejectPayment).toMatch(
        /paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      // The booking update at `status: "pending"` is
      // followed by the mirror write inside the same
      // transaction (atomic with the PEX-04 fresh-deadline
      // stamping + the FOL-05 sibling-rejection
      // `transaction.update` calls).
      expect(rejectPayment).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: computeReservationAggregatePaymentStatus\(postUpdateChildStatuses\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0 && siblingChildBookings.length > 0` (FOL-05 legacy skip)", () => {
      // Same gate as the verify + add-payment paths.
      // The pre-FOL-05 `bookingReservationId.length > 0`
      // guard (no `siblingChildBookings.length > 0`
      // companion because pre-FOL-05 didn't pre-read
      // children) was sufficient for the N=1 case
      // (a legacy booking has no `reservationId` so
      // `bookingReservationId.length === 0`); the
      // post-FOL-05 guard adds the explicit
      // `siblingChildBookings.length > 0` check to
      // document the "we have children to
      // aggregate over" pre-condition.
      expect(rejectPayment).toMatch(
        /if \(bookingReservationId\.length > 0 && siblingChildBookings\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `updatedAt` for the booking update AND the header mirror", () => {
      // The `updatedAt` is the function-scope variable
      // captured at the top of the try block (the same
      // `Date` that the booking update + the PEX-04
      // `paymentRejectedAt` use). The mirror reuses the
      // same binding — no second `new Date()` allocation.
      expect(rejectPayment).toMatch(/const updatedAt = new Date\(\);/);
      expect(rejectPayment).toMatch(/updatedAt\s*\n\s*\}\);[\s\S]{0,5000}?if \(bookingReservationId\.length > 0 && siblingChildBookings\.length > 0\)[\s\S]{0,5000}?updatedAt\s*\n\s*\}\);/);
    });
  });

  describe("handleAddRefund — UNCHANGED (the explicit exclusion)", () => {
    it("does NOT have a reservation header update in its body", () => {
      // Per the spec body: `handleAddRefund` is the
      // explicit exclusion. It appends a negative-amount
      // refund entry; the booking's `status` is unchanged
      // (refunds do not move a `payment-confirmed` booking
      // back to `pending`, by design — the money state
      // moves through the refund ledger, the lifecycle
      // status is the lifecycle).
      expect(addRefund).not.toMatch(/transaction\.update\(reservationRef,/);
    });

    it("does NOT call the helper (the refund path has no money-state mirror)", () => {
      // The helper is in scope (it's a file-level
      // import), but the handler body never calls it.
      // This guards against a future change that
      // accidentally mirrors the refund on the header.
      // (Note: the function-scope `import { ... } from
      // "@spark-inn/shared"` block is at the top of the
      // file, BEFORE `handleAddPayment`; the helper
      // symbol IS in the closure. This test confirms the
      // handler body doesn't use it.)
      expect(addRefund).not.toMatch(/mapBookingStatusToReservationPaymentStatus\(/);
    });
  });
});
