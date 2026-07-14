import type { BookingRateBreakdown } from "../types";

const CENTS_TOLERANCE = 0.005;

export interface BookingPricingSnapshot {
  totalPrice: number;
  rateBreakdown: BookingRateBreakdown | null | undefined;
}

export interface RevenueFinanceSnapshot {
  roomRevenue: number;
  breakfastRevenue: number;
  storeRevenue: number;
  incidentalRevenue: number;
  totalRevenue: number;
  streamEntryIds: Record<string, readonly string[]>;
}

function assertFiniteAmount(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Finance invariant failed: ${label} must be a finite number.`);
  }
}

function assertMoneyEqual(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) >= CENTS_TOLERANCE) {
    throw new Error(
      `Finance invariant failed: ${label} (${actual.toFixed(2)}) does not reconcile to ${expected.toFixed(2)}.`
    );
  }
}

/**
 * Test assertion for every server writer that creates or reprices a booking.
 * It deliberately requires the canonical breakdown so new writes cannot fall
 * back to the legacy no-breakdown shape unnoticed.
 */
export function assertBookingFinanceInvariant(snapshot: BookingPricingSnapshot): void {
  assertFiniteAmount(snapshot.totalPrice, "booking.totalPrice");
  const breakdown = snapshot.rateBreakdown;
  if (!breakdown) {
    throw new Error("Finance invariant failed: booking.rateBreakdown is required.");
  }

  assertFiniteAmount(breakdown.roomSubtotal, "rateBreakdown.roomSubtotal");
  assertFiniteAmount(breakdown.finalTotal, "rateBreakdown.finalTotal");

  const roomLinesTotal = breakdown.roomLines.reduce((sum, line, index) => {
    assertFiniteAmount(line.nightlyRate, `rateBreakdown.roomLines[${index}].nightlyRate`);
    assertFiniteAmount(line.subtotal, `rateBreakdown.roomLines[${index}].subtotal`);
    return sum + line.subtotal;
  }, 0);
  assertMoneyEqual(roomLinesTotal, breakdown.roomSubtotal, "room line total");

  const addOnTotal = breakdown.addOns.reduce((sum, line, index) => {
    assertFiniteAmount(line.amount, `rateBreakdown.addOns[${index}].amount`);
    return sum + line.amount;
  }, 0);
  const deductionTotal = breakdown.deductions.reduce((sum, line, index) => {
    assertFiniteAmount(line.amount, `rateBreakdown.deductions[${index}].amount`);
    return sum + line.amount;
  }, 0);
  const visibleTotal = breakdown.roomSubtotal + addOnTotal - deductionTotal;

  assertMoneyEqual(breakdown.finalTotal, visibleTotal, "rateBreakdown.finalTotal");
  assertMoneyEqual(snapshot.totalPrice, breakdown.finalTotal, "booking.totalPrice");
}

/**
 * Test assertion for report fixtures. Revenue categories must sum exactly to
 * Total Revenue, and a ledger entry ID may belong to only one stream (for
 * example revenue, tenders, or receivables), preventing double-counting.
 */
export function assertRevenueFinanceInvariant(snapshot: RevenueFinanceSnapshot): void {
  const revenueFields = [
    ["roomRevenue", snapshot.roomRevenue],
    ["breakfastRevenue", snapshot.breakfastRevenue],
    ["storeRevenue", snapshot.storeRevenue],
    ["incidentalRevenue", snapshot.incidentalRevenue],
    ["totalRevenue", snapshot.totalRevenue]
  ] as const;
  revenueFields.forEach(([label, value]) => assertFiniteAmount(value, label));

  const componentTotal = snapshot.roomRevenue
    + snapshot.breakfastRevenue
    + snapshot.storeRevenue
    + snapshot.incidentalRevenue;
  assertMoneyEqual(snapshot.totalRevenue, componentTotal, "totalRevenue");

  const ownerByEntryId = new Map<string, string>();
  for (const [stream, entryIds] of Object.entries(snapshot.streamEntryIds)) {
    for (const entryId of entryIds) {
      if (!entryId) throw new Error(`Finance invariant failed: ${stream} contains an empty entry ID.`);
      const existingOwner = ownerByEntryId.get(entryId);
      if (existingOwner) {
        throw new Error(
          `Finance invariant failed: ledger entry ${entryId} appears in both ${existingOwner} and ${stream}.`
        );
      }
      ownerByEntryId.set(entryId, stream);
    }
  }
}
