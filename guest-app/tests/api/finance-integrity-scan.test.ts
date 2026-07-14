import { describe, expect, test } from "vitest";
import {
  findingsFromCsv,
  findingsToCsv,
  scanBookingRecord,
  scanStoreOrderRecord
} from "../../../scripts/finance-integrity-scan";

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
});
