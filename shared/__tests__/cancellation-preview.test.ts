import { describe, expect, it } from "vitest";
import {
  evaluateCancelPreview,
  type CancelPreviewChild,
  type CancellationPolicySnapshot
} from "../utils/cancellation";

const fullRefundPolicy: CancellationPolicySnapshot = {
  cutoffHours: 48,
  refundPctBefore: 100,
  refundPctAfter: 0,
  policyText: "Full refund before cutoff.",
  scheduledCheckInTime: "2026-08-10T06:00:00.000Z",
  source: "settings"
};

function child(
  id: string,
  totalPrice: number,
  position: number
): CancelPreviewChild {
  return {
    id,
    bookingRef: `SI-${id}`,
    status: "confirmed",
    roomType: "room",
    totalPrice,
    reservationPosition: position,
    cancellationPolicySnapshot: fullRefundPolicy
  };
}

describe("evaluateCancelPreview", () => {
  it("never reports a policy refund above the amount collected", () => {
    const room = child("A", 10_000, 1);
    const preview = evaluateCancelPreview({
      scope: "room",
      now: new Date("2026-08-01T00:00:00.000Z"),
      lookedUpBooking: room,
      reservation: null,
      cancellableChildren: [room],
      reservationNetCollected: 2_500
    });

    expect(preview.subtotal).toBe(10_000);
    expect(preview.netCollected).toBe(2_500);
    expect(preview.policyRefund).toBe(2_500);
    expect(preview.retainedAmount).toBe(0);
    expect(preview.staffProcessingRequired).toBe(true);
  });

  it("allocates a shared folio to one room using all cancellable siblings", () => {
    const first = child("A", 6_000, 1);
    const second = child("B", 4_000, 2);
    const preview = evaluateCancelPreview({
      scope: "room",
      now: new Date("2026-08-01T00:00:00.000Z"),
      lookedUpBooking: first,
      reservation: {
        id: "reservation-1",
        reservationRef: "R-20260801-00001",
        totalPrice: 10_000
      },
      cancellableChildren: [first],
      reservationNetCollected: 5_000,
      allocationSubtotal: first.totalPrice + second.totalPrice
    });

    expect(preview.netCollected).toBe(3_000);
    expect(preview.policyRefund).toBe(3_000);
  });

  it("reports the collected amount retained inside the cutoff", () => {
    const noRefundPolicy: CancellationPolicySnapshot = {
      ...fullRefundPolicy,
      scheduledCheckInTime: "2026-08-02T06:00:00.000Z"
    };
    const room = {
      ...child("A", 10_000, 1),
      cancellationPolicySnapshot: noRefundPolicy
    };
    const preview = evaluateCancelPreview({
      scope: "room",
      now: new Date("2026-08-01T12:00:00.000Z"),
      lookedUpBooking: room,
      reservation: null,
      cancellableChildren: [room],
      reservationNetCollected: 4_000
    });

    expect(preview.refundPct).toBe(0);
    expect(preview.policyRefund).toBe(0);
    expect(preview.retainedAmount).toBe(4_000);
    expect(preview.staffProcessingRequired).toBe(false);
  });
});
