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

  // Per CRL-06 fix (2026-08-11, decision #184): the
  // helper must use the snapshot's `scheduledCheckInTime`
  // for the time math (NOT `Date.now()`). This is the
  // regression guard — if a future caller drops the
  // snapshot on the floor, the helper's
  // `fallbackContext.checkInDateKey: ""` will fall
  // through to `Date.now()` and the cancel preview
  // will silently report "0.0 hours before check-in"
  // for any future-dated booking. The handler fix
  // populates the snapshot from the reservation
  // header when the child booking's own snapshot is
  // null; the helper test below proves that the
  // helper itself honours the snapshot when it IS
  // provided.
  it("uses the snapshot's scheduledCheckInTime, not Date.now(), for the cutoff math", () => {
    // Check-in is 5 days from `now` — well beyond the
    // 48h cutoff, so the policy says 100% refund.
    // Without the snapshot, the helper would set
    // `checkInMs = Date.now()` and the preview would
    // show `refundPct: 0` (inside the 48h window).
    const futureCheckIn = new Date("2026-08-15T06:00:00.000Z");
    const now = new Date("2026-08-10T06:00:00.000Z");
    const futurePolicy: CancellationPolicySnapshot = {
      ...fullRefundPolicy,
      scheduledCheckInTime: futureCheckIn.toISOString()
    };
    const room = {
      ...child("A", 10_000, 1),
      cancellationPolicySnapshot: futurePolicy
    };
    const preview = evaluateCancelPreview({
      scope: "room",
      now,
      lookedUpBooking: room,
      reservation: null,
      cancellableChildren: [room],
      reservationNetCollected: 5_000
    });

    // Hours remaining must be ~120 (5 days), not 0.
    // If this assertion ever flips to ~0, the helper
    // has stopped honouring the snapshot and every
    // beyond-cutoff cancel will silently report 0%
    // refund.
    expect(preview.hoursRemaining).toBeGreaterThan(100);
    expect(preview.hoursRemaining).toBeLessThan(130);
    expect(preview.isBeforeCutoff).toBe(true);
    expect(preview.refundPct).toBe(100);
    expect(preview.policyRefund).toBe(5_000);
    expect(preview.retainedAmount).toBe(0);
    expect(preview.staffProcessingRequired).toBe(true);
  });
});
