// Per IDG (decision #227, 2026-08-20, owner option (a) —
// hard block on dashboard alert only): pure-derivation
// helper that gates the dashboard "Verify and record
// payment" + "Reject payment proof" buttons for any
// `PendingPaymentItem` whose rooms include an unverified
// Senior / PWD discount. The helper sits on the alert
// card and is the source of truth for the gate — the
// "open booking" deep-link CTA + the amber callout both
// read from it.
//
// Per the spec at `plan/project/ROADMAP.md §IDG-01` + the
// ROADMAP-archived proposal: pure (no React, no
// Firestore), takes the already-hydrated
// `PendingPaymentRoom` shape (FOL-05 declares it; IDG-02
// extends it with `discountType` + `discountVerified` +
// `discountRejected` + `originalTotalPrice`).
//
// Test-first (per `plan/docs/CONTRIBUTING.md §Testing`):
// RED — this file pins the contract at the runtime
// level. The source-text guard for the import + the
// file-declaration pins land in
// `fol-05-dashboard-discount-gate.test.ts` (IDG-03).

import { describe, expect, it } from "vitest";

import {
  hasUnverifiedDiscount,
  getDueAmountPreDiscount,
  type PendingPaymentItemLike,
  type PendingPaymentRoomLike,
} from "../utils/pendingPaymentDiscountGate";

const noDiscountRoom: PendingPaymentRoomLike = {
  bookingId: "b-1",
  roomNumber: "101",
  roomType: "single",
  totalPrice: 2000,
  status: "payment-uploaded",
  discountType: null,
  discountVerified: null,
  discountRejected: null,
  originalTotalPrice: null,
};

const seniorPendingVerifyRoom: PendingPaymentRoomLike = {
  ...noDiscountRoom,
  bookingId: "b-2",
  roomNumber: "102",
  totalPrice: 1800, // post-discount total
  originalTotalPrice: 2250, // pre-discount total (the verify amount is honest if staff rejects)
  discountType: "senior",
  discountVerified: false,
  discountRejected: false,
};

const seniorVerifiedRoom: PendingPaymentRoomLike = {
  ...seniorPendingVerifyRoom,
  bookingId: "b-3",
  discountVerified: true,
};

const seniorRejectedRoom: PendingPaymentRoomLike = {
  ...seniorPendingVerifyRoom,
  bookingId: "b-4",
  discountVerified: false,
  discountRejected: true,
};

function item(rooms: PendingPaymentRoomLike[]): PendingPaymentItemLike {
  return {
    id: "i-1",
    publicRef: "SI-20260820-00001",
    isReservation: false,
    rooms,
  };
}

describe("IDG-01 — hasUnverifiedDiscount + getDueAmountPreDiscount (pure helper)", () => {
  describe("hasUnverifiedDiscount — every N=1 non-discounted → false", () => {
    it("returns false for a 1-room non-discounted item", () => {
      expect(hasUnverifiedDiscount(item([noDiscountRoom]))).toBe(false);
    });

    it("returns false for a 2-room non-discounted group", () => {
      expect(
        hasUnverifiedDiscount(item([noDiscountRoom, { ...noDiscountRoom, bookingId: "b-1b" }]))
      ).toBe(false);
    });
  });

  describe("hasUnverifiedDiscount — unverified senior/pwd → true", () => {
    it("returns true for a 1-room senior pending verify", () => {
      expect(hasUnverifiedDiscount(item([seniorPendingVerifyRoom]))).toBe(true);
    });

    it("returns true for a 2-room group where ONE room has an unverified senior discount", () => {
      expect(
        hasUnverifiedDiscount(item([noDiscountRoom, seniorPendingVerifyRoom]))
      ).toBe(true);
    });

    it("returns true for a pwd room (sibling shape of senior — same VAT exemption under RA 9994/9442)", () => {
      const pwdPendingVerify: PendingPaymentRoomLike = {
        ...seniorPendingVerifyRoom,
        discountType: "pwd",
      };
      expect(hasUnverifiedDiscount(item([pwdPendingVerify]))).toBe(true);
    });

    it("returns true when a room carries `discountType: 'senior'` + `discountVerified: null` (defensive — null is unverified)", () => {
      const seniorNullVerified: PendingPaymentRoomLike = {
        ...seniorPendingVerifyRoom,
        discountVerified: null,
      };
      expect(hasUnverifiedDiscount(item([seniorNullVerified]))).toBe(true);
    });
  });

  describe("hasUnverifiedDiscount — verified OR rejected → false", () => {
    it("returns false when the senior room is `discountVerified: true`", () => {
      expect(hasUnverifiedDiscount(item([seniorVerifiedRoom]))).toBe(false);
    });

    it("returns false when the senior room is `discountRejected: true`", () => {
      expect(hasUnverifiedDiscount(item([seniorRejectedRoom]))).toBe(false);
    });

    it("returns false for a 2-room group where ONE senior is verified AND another is still unverified (defensive — ANY unverified still blocks)", () => {
      expect(
        hasUnverifiedDiscount(item([seniorVerifiedRoom, seniorPendingVerifyRoom]))
      ).toBe(true);
    });

    it("returns false for a 2-room group where BOTH senior rooms are verified", () => {
      const seniorVerifiedB: PendingPaymentRoomLike = {
        ...seniorVerifiedRoom,
        bookingId: "b-5",
      };
      expect(hasUnverifiedDiscount(item([seniorVerifiedRoom, seniorVerifiedB]))).toBe(false);
    });
  });

  describe("getDueAmountPreDiscount — pre-discount totals for the unverified rooms", () => {
    it("sums `originalTotalPrice` for the unverified senior rooms + `totalPrice` for the rest", () => {
      // 1 non-discounted room at ₱2,000 (totalPrice) + 1 unverified senior at
      // ₱2,250 originalTotalPrice. The pre-discount verify amount is ₱4,250.
      const result = getDueAmountPreDiscount(item([noDiscountRoom, seniorPendingVerifyRoom]));
      expect(result).toBe(2000 + 2250);
    });

    it("returns the normal `totalPrice` sum when no rooms are unverified (gate inactive)", () => {
      // Both rooms already verified → no need to read pre-discount totals.
      const seniorVerifiedB: PendingPaymentRoomLike = {
        ...seniorVerifiedRoom,
        bookingId: "b-5",
      };
      const result = getDueAmountPreDiscount(item([seniorVerifiedRoom, seniorVerifiedB]));
      expect(result).toBe(1800 + 1800);
    });

    it("returns the normal `totalPrice` sum when NO room has a discount (non-discounted case)", () => {
      const result = getDueAmountPreDiscount(item([noDiscountRoom]));
      expect(result).toBe(2000);
    });

    it("falls back to `totalPrice` for an unverified senior when `originalTotalPrice` is `null` (data-drift guard)", () => {
      const seniorNoOriginal: PendingPaymentRoomLike = {
        ...seniorPendingVerifyRoom,
        originalTotalPrice: null,
      };
      // No pre-discount value available — verify amount must still be a number.
      const result = getDueAmountPreDiscount(item([seniorNoOriginal]));
      expect(result).toBe(1800); // the post-discount totalPrice fallback
    });

    it("floors negative values at 0 (a verified payment might exceed the post-discount totalPrice)", () => {
      const seniorOverpaid: PendingPaymentRoomLike = {
        ...seniorPendingVerifyRoom,
        totalPrice: 1800,
        originalTotalPrice: 100, // data-drift guard; should never happen in practice
      };
      const result = getDueAmountPreDiscount(item([seniorOverpaid]));
      expect(result).toBe(100); // raw originalTotalPrice; the caller floors negative
    });
  });

  describe("defensive coercions", () => {
    it("treats a non-numeric `originalTotalPrice` as 0", () => {
      const badOriginal: PendingPaymentRoomLike = {
        ...seniorPendingVerifyRoom,
        originalTotalPrice: NaN,
      };
      const result = getDueAmountPreDiscount(item([badOriginal]));
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    });

    it("treats a non-numeric `totalPrice` as 0", () => {
      const badTotal: PendingPaymentRoomLike = {
        ...noDiscountRoom,
        totalPrice: NaN,
      };
      const result = getDueAmountPreDiscount(item([badTotal]));
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    });

    it("treats an empty `rooms[]` as gate-inactive + zero due", () => {
      const emptyItem: PendingPaymentItemLike = {
        id: "i-empty",
        publicRef: "SI-20260820-00002",
        isReservation: false,
        rooms: [],
      };
      expect(hasUnverifiedDiscount(emptyItem)).toBe(false);
      expect(getDueAmountPreDiscount(emptyItem)).toBe(0);
    });
  });
});