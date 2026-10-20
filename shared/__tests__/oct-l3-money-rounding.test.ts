// Per OCT-L3 (2026-10-20, decision #299): the other-add-on money path
// now rounds to 2 decimal places — the same rule breakfast and the
// folio use.
//
// **The bug.** `recomputeOtherAddOnTotal` used `Math.round(total)` —
// whole pesos — while the refund liability for the SAME selection was
// computed at full precision (`price * quantity`). So a ₱499.99
// airport transfer billed ₱500 but refunded ₱499.99: the hotel asked
// for a peso it never charged, and the guest's bill and refund never
// reconciled.
//
// **What did NOT change.** Both apps' `formatPrice` uses
// `maximumFractionDigits: 0`, so the DISPLAYED amount is unchanged —
// a ₱499.99 total has always rendered as "₱500". Breakfast already
// stored 2dp and displayed 0dp; this makes the other add-ons behave
// the same way. The repo rule is **store at 2dp, display at 0dp**.

import { describe, expect, it } from "vitest";
import {
  otherAddOnBreakdownByDate,
  recomputeOtherAddOnTotal,
  roundToTwoDecimals,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";

function mkEntry(
  addOnId: string,
  priceSnapshot: number,
  quantity: number,
  removed = false
): OtherAddOnSelectionEntry {
  return {
    addOnId,
    nameSnapshot: addOnId,
    priceSnapshot,
    quantity,
    unitSnapshot: "per-person",
    addedAt: "2026-12-01T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-12-01T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: removed ? "2026-12-01T00:00:00.000Z" : null,
    removedBy: removed ? "guest" : null,
    cutoffHoursBeforeCheckInSnapshot: 24
  };
}

describe("OCT-L3 — the shared money-rounding rule", () => {
  it("rounds to 2dp", () => {
    expect(roundToTwoDecimals(499.99)).toBe(499.99);
    expect(roundToTwoDecimals(499.995)).toBe(500);
    expect(roundToTwoDecimals(0.1 + 0.2)).toBe(0.3);
    expect(roundToTwoDecimals(19.99 * 3)).toBe(59.97);
  });

  it("never returns NaN or Infinity for junk input", () => {
    // A money path must never write NaN into a booking doc.
    expect(roundToTwoDecimals(Number.NaN)).toBe(0);
    expect(roundToTwoDecimals(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundToTwoDecimals("not a number")).toBe(0);
    expect(roundToTwoDecimals(null)).toBe(0);
    expect(roundToTwoDecimals(undefined)).toBe(0);
  });

  it("is idempotent (rounding an already-rounded value changes nothing)", () => {
    const once = roundToTwoDecimals(1234.5678);
    expect(roundToTwoDecimals(once)).toBe(once);
  });
});

describe("OCT-L3 — recomputeOtherAddOnTotal rounds to 2dp, never to whole pesos", () => {
  it("keeps the centavo the guest was charged", () => {
    // The regression: 333.33 × 3 = 999.99 used to round UP to 1000.
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 333.33, 3)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(999.99);
  });

  it("keeps a ₱499.99 add-on at ₱499.99 so the refund can match it", () => {
    // The exact case from the audit: this used to bill ₱500 while the
    // refund liability for the same selection was ₱499.99.
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("airport-transfer", 499.99, 1)]
    };
    const billed = recomputeOtherAddOnTotal(sel);
    const refunded = roundToTwoDecimals(499.99 * 1);
    expect(billed).toBe(499.99);
    expect(refunded).toBe(billed);
  });

  it("the breakdown subtotal uses the SAME rule as the total", () => {
    // If the two rounded differently the receipt's per-date lines
    // would not add up to the total it is printed under.
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 333.33, 3)],
      "2026-12-02": [mkEntry("b", 19.99, 2)]
    };
    const rows = otherAddOnBreakdownByDate(sel);
    const rowSum = rows.reduce((sum, row) => sum + row.subtotal, 0);
    expect(rowSum).toBe(recomputeOtherAddOnTotal(sel));
  });

  it("still returns 0 for null / undefined / empty input", () => {
    expect(recomputeOtherAddOnTotal(null)).toBe(0);
    expect(recomputeOtherAddOnTotal(undefined)).toBe(0);
    expect(recomputeOtherAddOnTotal({})).toBe(0);
  });

  it("still clamps a negative price to 0 (defensive)", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", -100, 2)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(0);
  });

  it("still excludes removed entries", () => {
    const sel: Record<string, OtherAddOnSelectionEntry[]> = {
      "2026-12-01": [mkEntry("a", 500, 2), mkEntry("b", 300, 1, true)]
    };
    expect(recomputeOtherAddOnTotal(sel)).toBe(1000);
  });
});
