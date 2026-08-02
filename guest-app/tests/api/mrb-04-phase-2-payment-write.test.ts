import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice the handleAddPayment handler body out of
// the file so the guards below are scoped to the
// handleAddPayment refactor (the refund +
// verifyAndRecordPayment handlers follow the same
// pattern as a follow-up commit). The slice starts at
// `export async function handleAddPayment` and ends at
// the next `export async function` (handleAddRefund).
function extractHandleAddPayment(): string {
  const start = handlers.indexOf("export async function handleAddPayment");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleAddRefund", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
const handler = extractHandleAddPayment();

describe("MRB-04 Phase 2 — handleAddPayment writes to reservations/{id}/payments for new reservations", () => {
  describe("Subcollection selection — reservation vs legacy booking", () => {
    it("reads bookingReservationId from bookingData.reservationId (the canonical MRB-01 linkage)", () => {
      // The refactor derives the booking's
      // reservation id from the stored field.
      // For new reservations (post-MRB-01) the
      // field is non-null; for legacy bookings
      // (pre-MRB-01) the field is null. The
      // refactor uses a `String(...).trim()`
      // defensive coercion so legacy null values
      // normalize to `""` (the empty-string
      // sentinel that the conditional payment
      // ref picks up).
      expect(handler).toMatch(
        /const bookingReservationId = String\(\(bookingData as any\)\.reservationId \|\| ""\)\.trim\(\);/
      );
    });

    it("writes to reservations/{reservationId}/payments for new reservations", () => {
      // The reservation-owned payment
      // subcollection path: when
      // `bookingReservationId` is non-empty, the
      // payment record goes to
      // `reservations/{reservationId}/payments/{paymentId}`.
      // The status transitions on the booking
      // doc (`payment-confirmed` + the loyalty
      // award) stay the same for both paths --
      // only the payment RECORD moves to the
      // new subcollection.
      expect(handler).toMatch(
        /const paymentsRef = bookingReservationId\.length > 0\s*\n\s*\? adminDb\.collection\("reservations"\)\.doc\(bookingReservationId\)\.collection\("payments"\)\s*\n\s*: bookingRef\.collection\("payments"\);/
      );
    });

    it("falls back to bookings/{bookingId}/payments for legacy null-reservationId bookings", () => {
      // The legacy adapter: for null-`reservationId`
      // bookings (pre-MRB-01), the payment
      // record stays at
      // `bookings/{bookingId}/payments/{paymentId}`
      // (the historical contract). The
      // `: bookingRef.collection("payments")`
      // ternary branch handles the legacy path.
      // Byte-equivalent to pre-MRB-04 Phase 2.
      expect(handler).toMatch(
        /: bookingRef\.collection\("payments"\);/
      );
    });
  });

  describe("Payment record shape — new reservation fields", () => {
    it("includes `reservationId` on the record when writing to the new subcollection", () => {
      // The MRB-04 `ReservationPayment` type
      // carries `reservationId` (canonical
      // linkage to the parent reservation). For
      // new reservations, the record is
      // `paymentRecord` + `reservationId: bookingReservationId`
      // + `bookingId: bookingId`. The
      // `bookingId` is the per-room attribution
      // field (`null` for reservation-level
      // payments; non-null when the staff ties
      // a payment to a specific room's add-on).
      expect(handler).toMatch(
        /const recordWithReservation = bookingReservationId\.length > 0\s*\n\s*\? \{ \.\.\.paymentRecord, reservationId: bookingReservationId, bookingId: bookingId \}\s*\n\s*: paymentRecord;/
      );
    });

    it("omits the reservationId + bookingId fields for legacy null-reservationId bookings (byte-equivalent to pre-MRB-04)", () => {
      // For legacy bookings, the record is the
      // historical `paymentRecord` (no
      // `reservationId` field). Byte-equivalent
      // to pre-MRB-04 Phase 2 behavior. The
      // legacy `OnsitePayment` shape stays the
      // same.
      expect(handler).toMatch(
        /: paymentRecord;/
      );
    });

    it("calls transaction.create with the right record shape for each path", () => {
      // The transactional write uses the
      // conditional record (legacy or new). A
      // future refactor that hard-codes one
      // shape breaks the contract.
      expect(handler).toMatch(
        /transaction\.create\(newPaymentRef, recordWithReservation\);/
      );
    });
  });

  describe("Idempotency contract — preserved for both paths", () => {
    it("reads existing payments FIRST so the same-request replay returns idempotentReplay: true", () => {
      // The idempotency check is unchanged: the
      // same paymentId + same amount + same
      // method + same note + same reference →
      // `idempotentReplay = true`. The new
      // subcollection path preserves the
      // contract (the CRL-01 fingerprint shape
      // is the same: `id === paymentId` is the
      // canonical key; the per-field compare
      // is the byte-equivalence check).
      expect(handler).toMatch(
        /const existingPayment = paymentsSnapshot\.docs\.find\(\(docSnap: any\) => docSnap\.id === paymentId\);/
      );
      expect(handler).toMatch(
        /if \(!sameRequest\) throw new Error\("Payment ID has already been used for a different payment\."\);/
      );
      expect(handler).toMatch(/idempotentReplay = true;/);
    });

    it("preserves the 409 status mapping for the conflict case (same id, different request)", () => {
      // The catch block maps the
      // "Payment ID has already been used for
      // a different payment." error to 409.
      // This is the same status code as the
      // CRL-01 refund-idempotency contract.
      expect(handler).toMatch(
        /if \(error\.message === "Payment ID has already been used for a different payment\."\) \{\s*return res\.status\(409\)/
      );
    });
  });

  describe("Status transitions on the booking doc — unchanged for both paths", () => {
    it("updates the booking doc to payment-confirmed when fullyPaid (single transaction)", () => {
      // The status transition stays on the
      // booking doc regardless of which
      // subcollection holds the payment
      // record. The booking's `paymentStatus`
      // + `handledBy` + `updatedAt` are the
      // canonical signals; the payment record
      // is the money source. For new
      // reservations the reservation header
      // also gets the `paymentStatus` update
      // in MRB-04 Phase 3 (a follow-up).
      expect(handler).toMatch(
        /if \(fullyPaid && isConfirmableStatus\) \{\s*\n\s*const updatedAt = new Date\(\);\s*\n\s*Object\.assign\(bookingUpdates, \{\s*\n\s*status: "payment-confirmed",/
      );
    });

    it("awards loyalty points for settled checked-out folios (loyalty award logic unchanged)", () => {
      // The loyalty award logic stays the
      // same for both paths. The
      // `settlesCheckedOutFolio` flag is
      // computed from the booking doc's
      // snapshotted `pendingLoyaltyPoints` +
      // the `totalPaid >= checkedOutFolioTotal`
      // check. The award is written to the
      // loyalty member's `rewardsPoints` +
      // `pointsHistory` collection (the
      // existing per-member ledger).
      expect(handler).toMatch(
        /if \(settlesCheckedOutFolio && loyaltyMemberRef && loyaltyMemberDoc\?\.exists\)/
      );
    });
  });
});
