import { describe, expect, test } from "vitest";
// Per F-D3 (2026-10-27): the test imports the PURE half of the
// scanner (`scripts/finance-scan-core.ts`), NOT the script itself.
//
// WHY: the script imports `firebase-admin` and `dotenv`. The guest
// app declares `firebase-admin` but NOT `dotenv`, and the guest
// Vercel project installs only the `guest-app` workspace
// (rootDirectory=guest-app), so `dotenv` is absent there. A static
// import of the script would put the script into the guest app's
// TypeScript program and break the guest build the same way it broke
// the admin build.
//
// The pure core has NO imports, so it can never drag an undeclared
// package into an app build.
import {
  findingsFromCsv,
  findingsToCsv,
  scanBookingRecord,
  scanStoreOrderRecord
} from "../../../scripts/finance-scan-core";

describe("FLR-01 finance integrity scanner", () => {
  test("flags a zeroed legacy booking with a reviewable breakdown repair", () => {
    const findings = scanBookingRecord("booking_1", {
      totalPrice: 0,
      originalTotalPrice: 0,
      rateBreakdown: {
        roomLines: [{ subtotal: 5000 }],
        finalTotal: 4000
      }
    });

    expect(findings).toEqual([expect.objectContaining({
      cohort: "FL-03",
      proposedAction: "set-booking-total",
      proposedValue: "4000.00",
      approved: "NO"
    })]);
  });

  test("flags a rejected-points mismatch as the FL-02 cohort", () => {
    const findings = scanBookingRecord("booking_2", {
      totalPrice: 4500,
      discountRejected: true,
      pointsRedeemedValue: 500,
      rateBreakdown: { roomLines: [{ subtotal: 5000 }], finalTotal: 4000 }
    });

    expect(findings[0]).toMatchObject({
      cohort: "FL-02",
      observedValue: "4500.00",
      expectedValue: "4000.00",
      proposedAction: "set-booking-total"
    });
  });

  test("treats missing totals as non-finite instead of coercing them to zero", () => {
    expect(scanBookingRecord("booking_missing", {
      totalPrice: null,
      rateBreakdown: { roomLines: [], finalTotal: 1000 }
    })[0]).toMatchObject({ cohort: "non-finite", proposedAction: "manual-review" });
  });

  test("flags tenderless delivered direct store orders but not add-to-bill orders", () => {
    expect(scanStoreOrderRecord("order_1", {
      status: "delivered",
      paymentMethod: "cod",
      totalAmount: 800
    }, false)[0]).toMatchObject({
      cohort: "pre-FL-05",
      proposedAction: "append-store-delivery-tender",
      proposedValue: "800.00"
    });
    expect(scanStoreOrderRecord("order_2", {
      status: "delivered",
      paymentMethod: "add-to-bill",
      totalAmount: 800
    }, false)).toEqual([]);
  });

  test("round-trips quoted review notes through the CSV", () => {
    const finding = scanBookingRecord("booking_3", {
      totalPrice: 1000,
      rateBreakdown: { roomLines: [{ subtotal: 1200 }], finalTotal: 1200 }
    })[0];
    finding.reviewNotes = 'Approved after checking "receipt", folio';
    const parsed = findingsFromCsv(findingsToCsv([finding]));
    expect(parsed).toEqual([finding]);
  });

  // Per MRB-11 (decision #177): the Reports revenue streams read
  // the stored per-stream allocation. The allocation's own
  // `totalNet` MUST be the booking's billed `totalPrice`. The
  // scanner did not implement that identity, so a booking whose
  // allocation went stale (a discount applied / removed /
  // rejected after the create write) reported ZERO findings.
  describe("MRB-11 allocation identity", () => {
    test("flags an allocation whose totalNet does not match totalPrice", () => {
      const findings = scanBookingRecord("booking_alloc", {
        totalPrice: 3840,
        source: "walk-in",
        revenueAllocation: {
          roomNet: 4800,
          breakfastNet: 0,
          addOnNet: 0,
          deductionNet: 0,
          totalNet: 4800
        }
      });

      expect(findings[0]).toMatchObject({
        findingId: "bookings/booking_alloc:allocation-total-mismatch",
        cohort: "pricing-drift",
        observedValue: "3840.00",
        expectedValue: "4800.00",
        proposedAction: "manual-review",
        approved: "NO"
      });
    });

    test("does not flag a booking whose allocation matches its totalPrice", () => {
      expect(scanBookingRecord("booking_alloc_ok", {
        totalPrice: 5000,
        source: "online",
        revenueAllocation: {
          roomNet: 4000,
          breakfastNet: 1000,
          addOnNet: 0,
          deductionNet: 0,
          totalNet: 5000
        }
      })).toEqual([]);
    });

    test("flags a corporate-source booking with no allocation at all", () => {
      const findings = scanBookingRecord("booking_corp", {
        totalPrice: 4600,
        source: "corporate"
      });

      expect(findings[0]).toMatchObject({
        findingId: "bookings/booking_corp:corporate-missing-allocation",
        cohort: "pricing-drift",
        observedValue: "absent",
        proposedAction: "manual-review",
        approved: "NO"
      });
    });

    test("does not flag a legacy non-corporate booking with no allocation", () => {
      // A pre-MRB-11 booking legitimately has no allocation —
      // the read path falls back to the legacy heuristic. Only
      // the corporate write path (which must snapshot one) is
      // a defect.
      expect(scanBookingRecord("booking_legacy", {
        totalPrice: 4600,
        source: "online"
      })).toEqual([]);
    });

    test("flags BR-12 other add-ons that sit on top of totalPrice", () => {
      // Per MRB-11b (QA pass 2026-10-25): the allocation's total is
      // the booking's WHOLE bill — the room bill PLUS the BR-12 other
      // add-ons (per OCT-FOL-01 they are not inside `totalPrice`). An
      // allocation that still describes only the room bill is a REAL
      // mismatch — it is the defect the scanner was built to catch.
      const stale = scanBookingRecord("booking_addon", {
        totalPrice: 8100,
        source: "online",
        otherAddOnTotal: 1500,
        hasAnyOtherAddOns: true,
        revenueAllocation: {
          roomNet: 8100,
          breakfastNet: 0,
          addOnNet: 0,
          deductionNet: 0,
          totalNet: 8100
        }
      });

      expect(stale[0]).toMatchObject({
        findingId: "bookings/booking_addon:allocation-total-mismatch",
        cohort: "pricing-drift",
        observedValue: "9600.00",
        proposedAction: "manual-review",
        approved: "NO"
      });

      // And once the allocation DOES carry the other add-ons, only the
      // review reminder is left — the scanner stops claiming a mismatch.
      const correct = scanBookingRecord("booking_addon", {
        totalPrice: 8100,
        source: "online",
        otherAddOnTotal: 1500,
        hasAnyOtherAddOns: true,
        revenueAllocation: {
          roomNet: 8100,
          breakfastNet: 0,
          addOnNet: 1500,
          deductionNet: 0,
          totalNet: 9600
        }
      });

      expect(correct[0]).toMatchObject({
        findingId: "bookings/booking_addon:other-addon-outside-room-bill",
        cohort: "pricing-drift",
        observedValue: "1500.00",
        proposedAction: "manual-review",
        approved: "NO"
      });
    });
  });
});
