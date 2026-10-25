// Per FIN-PAID-AMOUNT-FLOOR + FIN-PAID-AMOUNT-SOURCE (QA pass
// 2026-10-24): `booking.paidAmount` can never be negative, and the
// "was this meal paid for?" test must not trust a field that is.
//
// THE DEFECTS THIS SUITE PINS
// ---------------------------
// 1. `computeRefundPaidAmountDelta` decremented `paidAmount` from a base
//    that was never seeded, so `SI-20261021-00011` ended at **−₱1,000**:
//    a guest who paid ₱5,400 read as owing ₱1,000.
//
// 2. A negative OR ABSENT `paidAmount` reads as "nothing was paid", so
//    `shared/utils/bookingAddOnReschedule.ts` opened NO refund liability
//    for a PAID breakfast removed on those bookings — the guest was
//    never owed the money back. 14 further production bookings carry
//    ledger entries but no `paidAmount` field at all.
//
// THE FIX
// -------
//   * `computeRefundPaidAmountDelta` floors the result at 0 — a refund
//     larger than what was collected is a LIABILITY recorded by the
//     refund doc, not a negative paid amount;
//   * the cancel + reschedule paths resolve the paid amount through
//     `resolvePaidAmountForLiability`, which uses the denormalized field
//     when it is a POSITIVE number and otherwise falls back to the
//     ledger (the same source the folio and the admin's paid column
//     read).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeRefundPaidAmountDelta } from "../../server/lib/refunds";

describe("computeRefundPaidAmountDelta — the paid-amount floor", () => {
  it("decrements normally when there is enough paid", () => {
    expect(computeRefundPaidAmountDelta(2800, 100)).toBe(2700);
  });

  it("never returns a NEGATIVE paid amount", () => {
    // The production case: `SI-20261021-00011` had a `paidAmount` base
    // that was never seeded, and the refund drove it to −₱1,000.
    expect(computeRefundPaidAmountDelta(0, 1000)).toBe(0);
    expect(computeRefundPaidAmountDelta(500, 1000)).toBe(0);
  });

  it("treats a non-finite base as 0", () => {
    expect(computeRefundPaidAmountDelta(Number.NaN, 100)).toBe(0);
    expect(computeRefundPaidAmountDelta(Number.NaN, 0)).toBe(0);
  });

  it("ignores a negative refund amount (the magnitude is always positive)", () => {
    expect(computeRefundPaidAmountDelta(2800, -100)).toBe(2800);
  });
});

describe("the paid-amount source (tripwire)", () => {
  const bookingsSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );

  it("the cancel + reschedule paths resolve the paid amount from the ledger", () => {
    expect(
      bookingsSrc,
      "the ledger fallback helper must exist"
    ).toMatch(/async function resolvePaidAmountForLiability\(/);

    // Neither call site may read the raw denormalized field again.
    expect(
      bookingsSrc,
      "the raw `Number(booking.paidAmount) || 0` read must not come back"
    ).not.toMatch(/paidAmount:\s*Number\(booking\.paidAmount\)\s*\|\|\s*0/);

    const uses = bookingsSrc.match(/resolvePaidAmountForLiability\(\{/g) || [];
    // the cancel path + the reschedule path (breakfast + other add-ons)
    expect(uses.length).toBe(3);
  });

  it("the server folio excludes a pending refund from the collected total", () => {
    expect(
      bookingsSrc,
      "the refund subcollection must be summed with the pending-refund rule"
    ).toMatch(/\+ sumRefundAmounts\(reservationRefundsSnapshot\)/);
    expect(bookingsSrc).toMatch(/function sumRefundAmounts\(/);
  });
});
