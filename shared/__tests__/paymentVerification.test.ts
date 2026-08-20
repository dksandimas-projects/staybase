import { describe, expect, test } from "vitest";
import { isPaymentVerified } from "../utils/paymentVerification";

/**
 * Per FOL-01 (2026-08-06, decision #197): the single source
 * of truth for "was this booking's payment staff-verified".
 * The helper is OR'd across the two signals:
 *   - `status === "payment-confirmed"` (transient: verified
 *     right now, before the lifecycle moves on)
 *   - `paymentConfirmedAt` is set (durable: verified at
 *     some earlier point; survives the lifecycle)
 *
 * This suite pins every branch of the helper. The pre-fix
 * bug was a UI-side `status === "payment-confirmed"` check
 * that lost the verified state when the booking moved to
 * `confirmed` — so the most important assertion is
 * "verified booking that has since been confirmed" must
 * read as verified. If a future change accidentally drops
 * the `paymentConfirmedAt` axis from the helper, that
 * assertion fires immediately.
 */
describe("isPaymentVerified (FOL-01, decision #197)", () => {
  describe("null / undefined / empty input", () => {
    test("returns false for null booking", () => {
      expect(isPaymentVerified(null)).toBe(false);
    });

    test("returns false for undefined booking", () => {
      expect(isPaymentVerified(undefined)).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(isPaymentVerified({})).toBe(false);
    });
  });

  describe("status axis — `status === \"payment-confirmed\"` (transient)", () => {
    test("returns true for status === \"payment-confirmed\" with no timestamp", () => {
      expect(isPaymentVerified({ status: "payment-confirmed" })).toBe(true);
    });

    test("returns true for status === \"payment-confirmed\" with a null timestamp", () => {
      expect(isPaymentVerified({ status: "payment-confirmed", paymentConfirmedAt: null })).toBe(true);
    });

    test("returns true for status === \"payment-confirmed\" with an empty-string timestamp", () => {
      expect(isPaymentVerified({ status: "payment-confirmed", paymentConfirmedAt: "" })).toBe(true);
    });

    test("returns true for status === \"payment-confirmed\" with a Date timestamp", () => {
      expect(isPaymentVerified({ status: "payment-confirmed", paymentConfirmedAt: new Date("2026-08-06T10:00:00Z") })).toBe(true);
    });
  });

  describe("paymentConfirmedAt axis — durable \"verified at some point\"", () => {
    test("returns true when only the ISO-string timestamp is set (admin mapper shape)", () => {
      // This is the canonical post-fix shape: a booking that
      // went payment-uploaded → payment-confirmed → confirmed
      // has status: "confirmed" and paymentConfirmedAt as an
      // ISO string. The helper must return true.
      expect(isPaymentVerified({
        status: "confirmed",
        paymentConfirmedAt: "2026-08-06T10:00:00.000Z"
      })).toBe(true);
    });

    test("returns true when only the Date timestamp is set (guest lookup shape)", () => {
      expect(isPaymentVerified({
        status: "confirmed",
        paymentConfirmedAt: new Date("2026-08-06T10:00:00Z")
      })).toBe(true);
    });

    test("returns true for status \"checked-in\" with a timestamp (verified, now in-house)", () => {
      expect(isPaymentVerified({
        status: "checked-in",
        paymentConfirmedAt: "2026-08-06T10:00:00.000Z"
      })).toBe(true);
    });

    test("returns true for status \"checked-out\" with a timestamp (verified, completed stay)", () => {
      expect(isPaymentVerified({
        status: "checked-out",
        paymentConfirmedAt: "2026-08-06T10:00:00.000Z"
      })).toBe(true);
    });

    test("returns false for null timestamp", () => {
      expect(isPaymentVerified({ status: "confirmed", paymentConfirmedAt: null })).toBe(false);
    });

    test("returns false for undefined timestamp", () => {
      expect(isPaymentVerified({ status: "confirmed", paymentConfirmedAt: undefined })).toBe(false);
    });

    test("returns false for empty-string timestamp", () => {
      expect(isPaymentVerified({ status: "confirmed", paymentConfirmedAt: "" })).toBe(false);
    });

    test("returns false for whitespace-only timestamp", () => {
      // The string-trim guard catches "  " and similar
      // pad values that could otherwise slip through
      // a `length > 0` check.
      expect(isPaymentVerified({ status: "confirmed", paymentConfirmedAt: "   " })).toBe(false);
    });
  });

  describe("negative cases — not yet verified", () => {
    test("returns false for status \"pending\" with no timestamp", () => {
      expect(isPaymentVerified({ status: "pending" })).toBe(false);
    });

    test("returns false for status \"payment-uploaded\" with no timestamp", () => {
      // The "proof uploaded, awaiting verification" state —
      // the staff has not clicked Verify & Record Payment yet.
      expect(isPaymentVerified({ status: "payment-uploaded" })).toBe(false);
    });

    test("returns false for status \"confirmed\" with no timestamp (legacy confirm-without-verify shortcut)", () => {
      // The pre-FOL-01 path where staff went
      // payment-uploaded → confirmed without going through
      // verify-and-record. No payment was ever verified;
      // the helper must return false so the UI shows
      // "Pending" / the verify CTA stays open.
      expect(isPaymentVerified({ status: "confirmed" })).toBe(false);
    });

    test("returns false for status \"cancelled\" with no timestamp", () => {
      expect(isPaymentVerified({ status: "cancelled" })).toBe(false);
    });

    test("returns false for an unknown status with a timestamp (timestamp wins)", () => {
      // Even if status is some non-recognized value, a
      // present timestamp is the durable signal that
      // verification happened. Belt-and-suspenders.
      expect(isPaymentVerified({
        status: "weird-future-state",
        paymentConfirmedAt: "2026-08-06T10:00:00.000Z"
      })).toBe(true);
    });
  });

  describe("invalid Date input", () => {
    test("returns false for an invalid Date (NaN time)", () => {
      // The Date instance has the right type but is
      // actually Invalid Date (e.g. new Date("not a date")).
      // The Number.isNaN(stamp.getTime()) guard catches it.
      const invalid = new Date("not a date");
      expect(Number.isNaN(invalid.getTime())).toBe(true);
      expect(isPaymentVerified({ status: "confirmed", paymentConfirmedAt: invalid })).toBe(false);
    });
  });

  describe("post-fix canonical cases (FOL-01)", () => {
    test("the original bug: a confirmed booking whose payment was verified now reads as verified", () => {
      // The pre-FOL-01 UI checked `status === "payment-confirmed"`
      // directly. Once the staff clicked Confirm Booking, the
      // status moved to "confirmed" and the check returned false
      // — so the Folio + Overview sections showed "Pending" on
      // a booking the staff had already verified AND confirmed.
      // The post-FOL-01 fix: the helper ORs the timestamp axis,
      // so this returns true.
      const confirmedBooking = {
        status: "confirmed" as const,
        paymentConfirmedAt: "2026-08-06T10:00:00.000Z"
      };
      expect(isPaymentVerified(confirmedBooking)).toBe(true);
    });

    test("a confirmed booking whose payment was NEVER verified reads as not-verified", () => {
      // The legacy path where staff went payment-uploaded →
      // confirmed via the Confirm Booking shortcut (no
      // Verify & Record Payment in between). No timestamp,
      // and status is "confirmed" — the helper correctly
      // returns false so the verify CTA / "Pending" label
      // still appear in the UI.
      const notVerifiedBooking = {
        status: "confirmed" as const
        // paymentConfirmedAt: omitted — never stamped
      };
      expect(isPaymentVerified(notVerifiedBooking)).toBe(false);
    });

    test("a payment-uploaded booking reads as not-verified (staff hasn't clicked verify yet)", () => {
      const proofPendingBooking = {
        status: "payment-uploaded" as const,
        paymentProofUrl: "https://example.com/proof.jpg"
      };
      expect(isPaymentVerified(proofPendingBooking)).toBe(false);
    });
  });
});
