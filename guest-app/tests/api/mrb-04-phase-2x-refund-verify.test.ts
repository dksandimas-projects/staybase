import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const rules = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);

// Slice the handleAddRefund handler body out of the file
// so the guards below are scoped to the handleAddRefund
// refactor (the canonical-refund-source move to
// `reservations/{id}/refunds`). The slice starts at
// `export async function handleAddRefund` and ends at
// the next `export async function` (handleMarkPaymentConfirmed).
function extractHandleAddRefund(): string {
  const start = handlers.indexOf("export async function handleAddRefund");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf(
    "export async function handleMarkPaymentConfirmed",
    start
  );
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
const handleAddRefundBody = extractHandleAddRefund();

// Slice the handleVerifyAndRecordPayment handler body out
// of the file so the guards below are scoped to the
// handleVerifyAndRecordPayment refactor (the verified-payment
// move to `reservations/{id}/payments` for new reservations).
// The slice starts at `export async function handleVerifyAndRecordPayment`
// and ends at the next `export async function` (handleConfirmBooking).
function extractHandleVerifyAndRecordPayment(): string {
  const start = handlers.indexOf(
    "export async function handleVerifyAndRecordPayment"
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = handlers.indexOf("export async function handleConfirmBooking", start);
  expect(end).toBeGreaterThan(start);
  return handlers.slice(start, end);
}
const handleVerifyBody = extractHandleVerifyAndRecordPayment();

describe("MRB-04 Phase 2.x — handleAddRefund writes to reservations/{id}/refunds for new reservations", () => {
  describe("Subcollection selection — reservation refunds vs legacy booking payments", () => {
    it("reads bookingReservationId from bookingData.reservationId (the canonical MRB-01 linkage)", () => {
      // The refactor derives the booking's
      // reservation id from the stored field.
      // For new reservations (post-MRB-01) the
      // field is non-null; for legacy bookings
      // (pre-MRB-01) the field is null. The
      // `String(...).trim()` defensive coercion
      // collapses null / undefined / whitespace
      // to `""` (the empty-string sentinel the
      // ternary picks up).
      expect(handleAddRefundBody).toMatch(
        /const bookingReservationId = String\(\(bookingData as any\)\.reservationId \|\| ""\)\.trim\(\);/
      );
    });

    it("writes to reservations/{reservationId}/refunds for new reservations (the canonical source)", () => {
      // The reservation-owned refund subcollection
      // path: when `bookingReservationId` is
      // non-empty, the refund record goes to
      // `reservations/{reservationId}/refunds/{refundId}`.
      // This is the canonical source for refunds on
      // new reservations per MRB-04 Phase 2.x (per
      // decision #159). The fallback branch (legacy)
      // routes to `bookings/{bookingId}/payments/{refundId}`
      // — byte-equivalent to pre-MRB-04 behavior.
      expect(handleAddRefundBody).toMatch(
        /const refundsRef = bookingReservationId\.length > 0\s*\n\s*\? adminDb\.collection\("reservations"\)\.doc\(bookingReservationId\)\.collection\("refunds"\)\s*\n\s*: bookingRef\.collection\("payments"\);/
      );
    });

    it("falls back to bookings/{bookingId}/payments for legacy null-reservationId bookings", () => {
      // The legacy adapter: for null-`reservationId`
      // bookings (pre-MRB-01), the refund record
      // stays at
      // `bookings/{bookingId}/payments/{refundId}`
      // (the historical CRL-01 contract — refunds
      // are negative-amount entries on the booking's
      // payments subcollection). The `: bookingRef.collection("payments")`
      // ternary branch handles the legacy path.
      expect(handleAddRefundBody).toMatch(
        /: bookingRef\.collection\("payments"\);/
      );
    });

    it("reads BOTH reservations/{id}/payments + reservations/{id}/refunds for net-collected (the dual-read pattern)", () => {
      // Per MRB-04 Phase 2.x (Belt-and-suspenders):
      // the handler reads the reservation's
      // `payments/` subcollection (positive-amount
      // entries) AND the `refunds/` subcollection
      // (negative-amount entries) to compute net
      // collected. The two sums combine to the
      // sign-aware net (the same math the helper
      // `getReservationFolioSummary` uses).
      expect(handleAddRefundBody).toMatch(
        /const paymentsRef = adminDb\.collection\("reservations"\)\.doc\(bookingReservationId\)\.collection\("payments"\);\s*\n\s*const paymentsSnapshot = await transaction\.get\(paymentsRef\);/
      );
      expect(handleAddRefundBody).toMatch(
        /const netRefunds = refundsSnapshot\.docs\.reduce\(\s*\n\s*\(sum, refundDoc\) => sum \+ Number\(refundDoc\.data\(\)\.amount \|\| 0\),\s*\n\s*0\s*\n\s*\);/
      );
      expect(handleAddRefundBody).toMatch(
        /netCollected = netPositivePayments \+ netRefunds;/
      );
    });
  });

  describe("Refund record shape — new reservation fields", () => {
    it("includes `reservationId` + `bookingId` on the record when writing to the new subcollection", () => {
      // The MRB-04 `ReservationRefund` type
      // carries `reservationId` (canonical
      // linkage to the parent reservation) +
      // `bookingId` (per-room attribution). For
      // new reservations, the refund record
      // includes both fields so the new
      // subcollection is self-describing. The
      // legacy path leaves both fields off —
      // byte-equivalent to pre-MRB-04 Phase 2.x.
      expect(handleAddRefundBody).toMatch(
        /if \(bookingReservationId\.length > 0\) \{\s*\n\s*newRecord\.reservationId = bookingReservationId;\s*\n\s*newRecord\.bookingId = bookingId;\s*\n\s*\}/
      );
    });

    it("stamps the refund record on the new subcollection via transaction.create (no overwrite path)", () => {
      // The preallocated `refundId` is still the
      // doc id (CL-01 idempotency contract). The
      // `refundsRef.doc(refundId)` resolves to
      // `reservations/{id}/refunds/{refundId}` for
      // new reservations and
      // `bookings/{id}/payments/{refundId}` for
      // legacy. `transaction.create` (not `set`)
      // ensures a server-side race that lost the
      // existingRefund lookup still throws a clean
      // ALREADY_EXISTS rather than overwriting the
      // original ledger entry.
      expect(handleAddRefundBody).toMatch(
        /transaction\.create\(refundsRef\.doc\(refundId\), newRecord\);/
      );
    });
  });

  describe("Idempotency contract — preserved for both paths", () => {
    it("reads existing refunds/payments FIRST so the same-request replay returns idempotentReplay: true", () => {
      // The idempotency check is unchanged: the
      // same refundId + same |amount| + same method +
      // same reason + same transactionReference →
      // `idempotentReplay = true`. The new
      // subcollection path preserves the CRL-01
      // contract (the per-field compare is the
      // byte-equivalence check). For new
      // reservations the lookup is on the
      // reservation's `refunds/` subcollection;
      // for legacy it's on the booking's `payments/`
      // subcollection (where refunds are stored as
      // negative-amount entries).
      expect(handleAddRefundBody).toMatch(
        /const existingRefund = refundsSnapshot\.docs\.find\(\(docSnap: any\) => docSnap\.id === refundId\);/
      );
      expect(handleAddRefundBody).toMatch(
        /const sameRequest = Math\.abs\(Number\(existingData\.amount \|\| 0\)\) === numericAmount/
      );
      expect(handleAddRefundBody).toMatch(
        /if \(!sameRequest\) \{\s*\n\s*throw new Error\("Refund ID has already been used for a different refund\."\);/
      );
      expect(handleAddRefundBody).toMatch(/idempotentReplay = true;/);
    });

    it("preserves the 409 status mapping for the conflict case (same id, different request)", () => {
      // The catch block maps the
      // "Refund ID has already been used for
      // a different refund." error to 409 — the
      // same status code as the CRL-01 contract.
      expect(handleAddRefundBody).toMatch(
        /if \(error\.message === "Refund ID has already been used for a different refund\."\) \{\s*return res\.status\(409\)/
      );
    });

    it("preserves the 400 status mapping for the 'refund exceeds net collected' guard", () => {
      // The "Refund exceeds the net collected
      // amount of ${netCollected}." error is
      // mapped to 400 in the catch block. The
      // helper reads BOTH `payments/` and
      // `refunds/` for new reservations (the
      // dual-read pattern), so the net is
      // sign-aware — a refund that exceeds the
      // net is a client typo, not a server
      // invariant.
      expect(handleAddRefundBody).toMatch(
        /if \(numericAmount > netCollected\) \{\s*\n\s*throw new Error\(`Refund exceeds the net collected amount of \$\{netCollected\}\.\`\);/
      );
      expect(handleAddRefundBody).toMatch(
        /const status = String\(error\.message \|\| ""\)\.startsWith\("Refund exceeds"\) \? 400 : 500;/
      );
    });
  });

  describe("Admin gate — unchanged for both paths", () => {
    it("still gates on req.staff?.role !== 'admin'", () => {
      // The admin-only gate at the top of
      // `handleAddRefund` is unchanged. Refunds
      // are admin-only and require an approver
      // UID (`approvedBy: req.staff.uid || "admin"`).
      expect(handleAddRefundBody).toMatch(
        /if \(req\.staff\?\.role !== "admin"\) \{\s*\n\s*return res\.status\(403\)\.json\(\{ success: false, error: "Only an administrator can approve refunds\." \}\);/
      );
    });
  });
});

describe("MRB-04 Phase 2.x — handleVerifyAndRecordPayment writes to reservations/{id}/payments for new reservations", () => {
  describe("Subcollection selection — reservation vs legacy booking", () => {
    it("reads bookingReservationId from data.reservationId (the canonical MRB-01 linkage)", () => {
      // Same pattern as the Phase 2 `handleAddPayment`
      // refactor: the handler derives the booking's
      // reservation id from the stored `data.reservationId`
      // field. For new reservations the field is
      // non-null; for legacy bookings it's null. The
      // `String(...).trim()` defensive coercion
      // collapses null / undefined / whitespace to
      // `""` (the empty-string sentinel the ternary
      // picks up).
      expect(handleVerifyBody).toMatch(
        /const bookingReservationId = String\(\(data as any\)\.reservationId \|\| ""\)\.trim\(\);/
      );
    });

    it("writes to reservations/{reservationId}/payments for new reservations", () => {
      // The reservation-owned payment subcollection
      // path: when `bookingReservationId` is
      // non-empty, the verified payment record goes
      // to `reservations/{reservationId}/payments/{paymentId}`.
      // Same pattern as the Phase 2 `handleAddPayment`
      // refactor. For legacy null-`reservationId`
      // bookings, the record stays at
      // `bookings/{bookingId}/payments/{paymentId}`
      // (the historical contract).
      expect(handleVerifyBody).toMatch(
        /const paymentsRef = bookingReservationId\.length > 0\s*\n\s*\? adminDb\.collection\("reservations"\)\.doc\(bookingReservationId\)\.collection\("payments"\)\s*\n\s*: bookingRef\.collection\("payments"\);/
      );
    });
  });

  describe("Payment record shape — new reservation fields", () => {
    it("includes `reservationId` + `bookingId` on the record when writing to the new subcollection", () => {
      // The MRB-04 `ReservationPayment` type
      // carries `reservationId` (canonical
      // linkage to the parent reservation) +
      // `bookingId` (per-room attribution). For
      // new reservations, the verified payment
      // record includes both fields. The legacy
      // path leaves both fields off —
      // byte-equivalent to pre-MRB-04 Phase 2.x.
      expect(handleVerifyBody).toMatch(
        /const recordWithReservation = bookingReservationId\.length > 0\s*\n\s*\? \{ \.\.\.paymentRecord, reservationId: bookingReservationId, bookingId: bookingId \}\s*\n\s*: paymentRecord;/
      );
    });

    it("calls transaction.create with the right record shape for each path", () => {
      // The transactional write uses the
      // conditional record (legacy or new). A
      // future refactor that hard-codes one
      // shape breaks the contract.
      expect(handleVerifyBody).toMatch(
        /transaction\.create\(paymentsRef\.doc\(paymentId\), recordWithReservation\);/
      );
    });
  });

  describe("Idempotency contract — preserved for both paths", () => {
    it("reads existing payments FIRST so the same-request replay returns idempotentReplay: true", () => {
      // The idempotency check is unchanged: the
      // same paymentId + same amount + same method +
      // same note + same reference →
      // `idempotentReplay = true`. The new
      // subcollection path preserves the contract
      // (the per-field compare is the
      // byte-equivalence check). For new
      // reservations the lookup is on the
      // reservation's `payments/` subcollection;
      // for legacy it's on the booking's `payments/`.
      expect(handleVerifyBody).toMatch(
        /const existingPayment = paymentsSnapshot\.docs\.find\(\(docSnap: any\) => docSnap\.id === paymentId\);/
      );
      expect(handleVerifyBody).toMatch(
        /if \(!sameRequest\) throw new Error\("PAYMENT_ID_CONFLICT"\);/
      );
      expect(handleVerifyBody).toMatch(/idempotentReplay = true;/);
    });

    it("preserves the 409 status mapping for the conflict case (same id, different request)", () => {
      // The catch block maps the
      // "PAYMENT_ID_CONFLICT" error to 409 — the
      // same status code as the CRL-01 refund +
      // payment idempotency contract.
      expect(handleVerifyBody).toMatch(
        /if \(error\?\.message === "PAYMENT_ID_CONFLICT"\) \{\s*\n\s*return res\.status\(409\)/
      );
    });
  });

  describe("Status transitions on the booking doc — unchanged for both paths", () => {
    it("updates the booking doc to payment-confirmed when fully paid (single transaction)", () => {
      // The status transition stays on the
      // booking doc regardless of which
      // subcollection holds the verified
      // payment record. The booking's
      // `payment-confirmed` + `handledBy` +
      // `paymentConfirmedAt` are the canonical
      // signals; the verified payment record is
      // the money source. For new reservations
      // the reservation header also gets the
      // `paymentStatus` update in MRB-04 Phase 3
      // (a follow-up).
      expect(handleVerifyBody).toMatch(
        /if \(fullyPaid\) \{\s*\n\s*bookingUpdates\.status = "payment-confirmed";\s*\n\s*bookingUpdates\.handledBy = staffUid;\s*\n\s*bookingUpdates\.paymentConfirmedAt = (?:new Date\(\)|now);/
      );
    });
  });
});

describe("MRB-04 Phase 2.x — Firestore rules: reservations/{id}/refunds is server-authoritative", () => {
  it("declares match /reservations/{reservationId}/refunds/{refundId} (the canonical refund subcollection)", () => {
    // The new refunds subcollection rule mirrors
    // the `payments` subcollection rule shape:
    // server-only create + staff read + no client
    // update/delete. Refunds are admin-only and
    // require a client-preallocated refundId for
    // CRL-01 idempotency.
    expect(rules).toMatch(
      /match \/refunds\/\{refundId\} \{\s*\n\s*allow read: if isStaff\(\);\s*\n\s*allow create: if false;[\s\S]*?\n\s*allow update, delete: if false;\s*\n\s*\}/
    );
  });

  it("the reservations/{id}/refunds rule sits under the reservations/{id} match block (not a sibling)", () => {
    // The refund subcollection must be nested
    // inside the `match /reservations/{reservationId}`
    // block so the `reservationId` path segment
    // is bound for the rule. A sibling match
    // outside the reservations block would not
    // have access to the `reservationId` variable.
    const refundBlockMatch = rules.match(
      /match \/reservations\/\{reservationId\}\s*\{[\s\S]*?match \/refunds\/\{refundId\}/
    );
    expect(refundBlockMatch).not.toBeNull();
  });
});
