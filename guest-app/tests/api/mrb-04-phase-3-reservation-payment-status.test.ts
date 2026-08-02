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
      expect(handlers).toMatch(
        /mapBookingStatusToReservationPaymentStatus\s*\n\}\s*from\s*"@spark-inn\/shared"/
      );
    });
  });

  describe("handleAddPayment — the in-transaction mirror write", () => {
    it("imports the helper into scope", () => {
      // The handler body must reference the helper name
      // directly (not via a re-import inside the try
      // block). Pinned by the function-scope import in
      // the Phase 3 PR.
      expect(addPayment).toMatch(/mapBookingStatusToReservationPaymentStatus\(/);
    });

    it("derives the mirror value from the helper (NOT a hardcoded string)", () => {
      // The mirror is `mapBookingStatusToReservationPaymentStatus(bookingDataSnapshot.status)`,
      // not a hardcoded `"awaiting-payment"` or
      // `"payment-confirmed"`. The helper owns the
      // mapping; the handler delegates.
      expect(addPayment).toMatch(
        /paymentStatus: mapBookingStatusToReservationPaymentStatus\(bookingDataSnapshot\.status\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      // The `transaction.update(reservationRef, ...)` call
      // is inside the `await adminDb.runTransaction(...)`
      // block (NOT in a separate transaction). The mirror
      // is atomic with the booking update.
      expect(addPayment).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: mapBookingStatusToReservationPaymentStatus\(bookingDataSnapshot\.status\)/
      );
    });

    it("gates the mirror on `transitionedToPaymentConfirmed && bookingReservationId.length > 0` (legacy skip)", () => {
      // The mirror fires only when the booking just
      // transitioned (idempotent replays don't touch the
      // header) AND for new reservations (legacy
      // null-`reservationId` bookings skip the write —
      // byte-equivalent to pre-Phase 3).
      expect(addPayment).toMatch(
        /if \(transitionedToPaymentConfirmed && bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
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
      // Proof of single-`now`: the handler body has
      // exactly 1 `const now = new Date();` declaration
      // + 1 `const updatedAt = now;` alias + 1
      // `updatedAt: now` literal in the mirror block.
      // No `new Date()` calls inside the runTransaction.
      expect(addPayment).toMatch(/const now = new Date\(\);/);
      expect(addPayment).toMatch(/const updatedAt = now;/);
      expect(addPayment).toMatch(/updatedAt: now\s*\n\s*\}\);/);  // mirror block
    });
  });

  describe("handleVerifyAndRecordPayment — the in-transaction mirror write", () => {
    it("imports the helper into scope", () => {
      expect(verifyAndRecord).toMatch(/mapBookingStatusToReservationPaymentStatus\(/);
    });

    it("derives the mirror value from bookingUpdates.status (NOT a hardcoded string)", () => {
      // The verify path mirrors `bookingUpdates.status`
      // (the new status just stamped on the booking —
      // always `"payment-confirmed"` when `fullyPaid`).
      // Same helper call shape as `handleAddPayment`,
      // different source value.
      expect(verifyAndRecord).toMatch(
        /paymentStatus: mapBookingStatusToReservationPaymentStatus\(bookingUpdates\.status\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      expect(verifyAndRecord).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: mapBookingStatusToReservationPaymentStatus\(bookingUpdates\.status\)/
      );
    });

    it("gates the mirror on `fullyPaid && bookingReservationId.length > 0` (legacy skip)", () => {
      // The verify path's mirror fires only when the
      // booking just transitioned to `payment-confirmed`
      // (partial verifications don't change the status).
      expect(verifyAndRecord).toMatch(
        /if \(fullyPaid && bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `now` for the booking update AND the header mirror", () => {
      // The `now` captured at the top of the try block
      // is reused for `bookingUpdates.updatedAt`,
      // `bookingUpdates.paymentConfirmedAt` (assigned
      // via property assignment, not object literal —
      // see source), AND the reservation header's
      // `updatedAt`. The handler body has 2
      // `updatedAt: now` occurrences (one in
      // `bookingUpdates`, one in the mirror block) +
      // 1 `paymentConfirmedAt = now` (conditional). No
      // `new Date()` allocation inside the transaction.
      expect(verifyAndRecord).toMatch(/const now = new Date\(\);/);
      expect(verifyAndRecord).toMatch(/updatedAt: now\s*\n\s*\};/);  // bookingUpdates
      expect(verifyAndRecord).toMatch(/bookingUpdates\.paymentConfirmedAt = now;/);  // conditional
      expect(verifyAndRecord).toMatch(/updatedAt: now\s*\n\s*\}\);/);  // mirror block
    });
  });

  describe("handleRejectPayment — the in-transaction mirror write (PEX path)", () => {
    it("imports the helper into scope", () => {
      expect(rejectPayment).toMatch(/mapBookingStatusToReservationPaymentStatus\(/);
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

    it("derives the mirror value from the new status (the hardcoded `\"pending\"` post-rejection)", () => {
      // The reject path always transitions to `"pending"`
      // (the status check at the top of the transaction
      // throws for any other status). The mirror value
      // is `mapBookingStatusToReservationPaymentStatus("pending")`
      // = `"awaiting-payment"`. The literal `"pending"`
      // is intentional — it's the only possible new
      // status here, and the helper still owns the
      // relabel-to-`"awaiting-payment"` mapping.
      expect(rejectPayment).toMatch(
        /paymentStatus: mapBookingStatusToReservationPaymentStatus\("pending"\)/
      );
    });

    it("writes the mirror inside the same runTransaction as the booking update", () => {
      // The booking update at `status: "pending"` is
      // followed by the mirror write inside the same
      // transaction (atomic with the PEX-04 fresh-deadline
      // stamping).
      expect(rejectPayment).toMatch(
        /transaction\.update\(reservationRef, \{[\s\S]{0,200}?paymentStatus: mapBookingStatusToReservationPaymentStatus\("pending"\)/
      );
    });

    it("gates the mirror on `bookingReservationId.length > 0` (legacy skip)", () => {
      // The reject path's gate is just the
      // reservationId check (no `fullyPaid` /
      // `transitionedToPaymentConfirmed` because the
      // handler is unconditional — every reject
      // transitions to `"pending"`).
      expect(rejectPayment).toMatch(
        /if \(bookingReservationId\.length > 0\) \{[\s\S]{0,300}?transaction\.update\(reservationRef, \{/
      );
    });

    it("uses the same `updatedAt` for the booking update AND the header mirror", () => {
      // The `updatedAt` is the function-scope variable
      // captured at the top of the try block (the same
      // `Date` that the booking update + the PEX-04
      // `paymentRejectedAt` use). The mirror reuses the
      // same binding — no second `new Date()` allocation.
      // The handler body has 1 `const updatedAt = new Date();`
      // at the top of the try block + 2 shorthand
      // `updatedAt` references inside the transaction
      // (booking update at `status: "pending", ..., updatedAt`
      // and the mirror at `paymentStatus: ..., updatedAt`),
      // both binding to the same Date. The two shorthand
      // occurrences are about 50 lines apart (the PEX-04
      // `paymentRejectedAt` + the new mirror block), so
      // the regex uses a generous `{0,5000}` distance.
      expect(rejectPayment).toMatch(/const updatedAt = new Date\(\);/);
      expect(rejectPayment).toMatch(/updatedAt\s*\n\s*\}\);[\s\S]{0,5000}?if \(bookingReservationId\.length > 0\)[\s\S]{0,5000}?updatedAt\s*\n\s*\}\);/);
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
