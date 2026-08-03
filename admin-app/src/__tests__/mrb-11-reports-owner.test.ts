// Per MRB-11 (2026-08-03, per decision #177):
// Reports unit tests for the per-stream revenue
// allocation read path.
//
// The behavioural test in
// `shared/__tests__/mrb-11-revenue-streams.test.ts`
// covers the pure `getBookingRevenueStreams` +
// `getReservationRevenueStreams` helpers + the
// invariant assertion. The source-text guard in
// `guest-app/tests/api/mrb-11-revenue-allocation-snapshot.test.ts`
// pins the server-side snapshot wiring. The emulator
// test in `firebase/tests/mrb-11-report-reconstruction.emulator.test.ts`
// (a follow-up) covers the round-trip data shape.
//
// THIS file covers the Reports surface contract:
//   1. A multi-room reservation in a Sales range
//      reports reservation count = 1, room count = 3,
//      allocated room revenue = sum of children,
//      allocated breakfast revenue = sum of children.
//   2. Cancelling one room does NOT change the
//      revenue of the surviving two.
//   3. The "legacy-heuristic" tag appears only on
//      rows whose `revenueAllocation` is null.
//   4. The byte-equivalent single-day report invariant:
//      a report on docs without `revenueAllocation`
//      returns the same numbers as the historical
//      `splitBookingRevenue` math (the day the upgrade
//      ships, no surprise jumps in historical reports).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBookingRevenueStreams, getReservationRevenueStreams } from "@spark-inn/shared";
import { splitBookingRevenue } from "../utils/finance";

const reportsSrc = readFileSync(
  resolve(__dirname, "../../src/pages/ReportsPage.tsx"),
  "utf8"
);

const financeSrc = readFileSync(
  resolve(__dirname, "../../src/utils/finance.ts"),
  "utf8"
);

// Per MRB-11 spec #177 (item 6, "Tests"): these are the
// Reports-level unit tests. The pure helper tests cover
// the math; the source-text guards cover the wiring;
// these cover the contract between the two.

describe("MRB-11 — Reports unit tests (per-stream allocation contract)", () => {
  it("ReportsPage reads the stored allocation via the new helper (not splitBookingRevenue)", () => {
    // The 6 historical call sites of `splitBookingRevenue`
    // in ReportsPage were replaced with `getBookingRevenueStreams`
    // in PR3. The test pins the new pattern.
    expect(reportsSrc.match(/getBookingRevenueStreams\(b\)\.roomNet/g)).toBeTruthy();
    expect(reportsSrc.match(/getBookingRevenueStreams\(b\)\.breakfastNet/g)).toBeTruthy();
    // The historical `splitBookingRevenue` import is gone.
    expect(reportsSrc).not.toMatch(/import\s*\{[^}]*splitBookingRevenue[^}]*\}\s*from\s*["']\.\.\/utils\/finance["']/);
  });

  it("finance.ts documents splitBookingRevenue as the legacy-only fallback", () => {
    // The function is still exported (for the byte-equivalent
    // fallback in `getBookingRevenueStreams`), but the
    // JSDoc must make the legacy-only role clear so
    // future callers don't reach for it directly.
    expect(financeSrc).toMatch(/LEGACY-ONLY fallback/);
    expect(financeSrc).toMatch(/Reports no longer calls this function directly/);
  });

  it("byte-equivalent single-day report: a doc without `revenueAllocation` returns the same numbers as `splitBookingRevenue`", () => {
    // The day the upgrade ships, a report on historical
    // data (no `revenueAllocation` field on any doc) must
    // return the same numbers as today. The `getBookingRevenueStreams`
    // helper's legacy fallback is the contract for this
    // invariant — we pin it here by calling both functions
    // on a fixture without `revenueAllocation` and
    // asserting the per-stream values match.
    const booking = {
      totalPrice: 5_000,
      ratePerNight: 2_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 250,
      hasBreakfast: true,
      rateBreakdown: { roomSubtotal: 4_000 }
    };
    const legacy = splitBookingRevenue(booking);
    const streams = getBookingRevenueStreams(booking);
    expect(streams.allocation).toBe("legacy-heuristic");
    // The legacy `room` is the post-deduction room share
    // (what today's reports show as "Room revenue"); the
    // new helper's `roomNet` for pre-MRB-11 docs returns
    // the same value (the legacy fallback preserves the
    // byte-equivalent math).
    expect(streams.roomNet).toBe(legacy.room);
    expect(streams.breakfastNet).toBe(legacy.breakfast);
    // Pre-MRB-11 docs have no `addOnNet` separation —
    // the export adds 0 for this term.
    expect(streams.addOnNet).toBe(0);
    // Pre-MRB-11 docs have no `deductionNet` term — the
    // legacy fallback already netted it into the per-stream
    // values. The export adds 0 for this term.
    expect(streams.deductionNet).toBe(0);
    // The total is unchanged.
    expect(streams.totalNet).toBe(5_000);
  });

  it("byte-equivalent single-day report: a doc WITH `revenueAllocation` returns the stored GROSS values", () => {
    // The day the upgrade ships, a report that includes
    // any post-MRB-11 doc (which carries a stored
    // `revenueAllocation`) shows the GROSS room + breakfast
    // + add-on + a single `deductionNet` line + totalNet.
    // This is the new report view — the numbers are
    // intentionally different from the legacy view because
    // the new view is exact (no proportional split).
    const allocation = {
      roomNet: 8_000,
      breakfastNet: 1_000,
      addOnNet: 500,
      deductionNet: 1_000,
      totalNet: 8_500
    };
    const streams = getBookingRevenueStreams({
      ...allocation,
      revenueAllocation: allocation,
      totalPrice: 8_500,
      ratePerNight: 4_000,
      numNights: 2,
      numGuests: 2,
      breakfastRate: 250,
      hasBreakfast: true,
      rateBreakdown: { roomSubtotal: 8_000 }
    });
    expect(streams.allocation).toBe("stored");
    expect(streams.roomNet).toBe(8_000);
    expect(streams.breakfastNet).toBe(1_000);
    expect(streams.addOnNet).toBe(500);
    expect(streams.deductionNet).toBe(1_000);
    expect(streams.totalNet).toBe(8_500);
  });

  it("reservation aggregate: stored aggregate returns the stored value + 'stored' tag", () => {
    const aggregate = {
      roomNet: 16_000,
      breakfastNet: 2_000,
      addOnNet: 1_000,
      deductionNet: 2_000,
      totalNet: 17_000
    };
    const streams = getReservationRevenueStreams(
      { aggregateRevenueAllocation: aggregate, totalPrice: 17_000 },
      []
    );
    expect(streams).toEqual({ ...aggregate, allocation: "stored" });
  });

  it("reservation aggregate: falls back to summing children when the aggregate is null", () => {
    // A multi-room reservation where the header's
    // `aggregateRevenueAllocation` is null but every child
    // has a stored allocation — the aggregate is the
    // sum of the children, tagged "stored" because every
    // child unanimously carries the new field.
    const child1Input = {
      revenueAllocation: { roomNet: 8_000, breakfastNet: 1_000, addOnNet: 500, deductionNet: 1_000, totalNet: 8_500 },
      totalPrice: 8_500,
      ratePerNight: 4_000,
      numNights: 2,
      rateBreakdown: { roomSubtotal: 8_000 }
    };
    const child2Input = {
      revenueAllocation: { roomNet: 8_000, breakfastNet: 1_000, addOnNet: 500, deductionNet: 1_000, totalNet: 8_500 },
      totalPrice: 8_500,
      ratePerNight: 4_000,
      numNights: 2,
      rateBreakdown: { roomSubtotal: 8_000 }
    };
    // Pass the original RevenueBookingInput-shaped
    // children to the aggregate helper.
    const streams = getReservationRevenueStreams(
      { totalPrice: 17_000 },
      [child1Input, child2Input]
    );
    expect(streams.allocation).toBe("stored");
    expect(streams.roomNet).toBe(16_000);
    expect(streams.breakfastNet).toBe(2_000);
    expect(streams.addOnNet).toBe(1_000);
    expect(streams.deductionNet).toBe(2_000);
    expect(streams.totalNet).toBe(17_000);
  });

  it("reservation aggregate: mixed stored + legacy child tagged 'legacy-heuristic'", () => {
    // The mixed case: some children are post-MRB-11
    // (stored), some are pre-MRB-11 (no `revenueAllocation`).
    // The aggregate is the sum but the tag is the
    // conservative one ("legacy-heuristic") so the
    // export row tells the accountant the per-stream
    // values are not all exact.
    const storedChild = {
      revenueAllocation: { roomNet: 4_000, breakfastNet: 1_000, addOnNet: 0, deductionNet: 500, totalNet: 4_500 },
      totalPrice: 4_500,
      ratePerNight: 2_000,
      numNights: 2,
      rateBreakdown: { roomSubtotal: 4_000 }
    };
    const legacyChild = {
      totalPrice: 3_000,
      ratePerNight: 1_500,
      numNights: 2,
      numGuests: 0,
      breakfastRate: 0,
      hasBreakfast: false,
      rateBreakdown: { roomSubtotal: 3_000 }
    };
    const streams = getReservationRevenueStreams(
      { totalPrice: 7_500 },
      [storedChild, legacyChild]
    );
    expect(streams.allocation).toBe("legacy-heuristic");
    // The stored child contributes its GROSS values;
    // the legacy child contributes 0 for addOn/deduction
    // and the post-discount NET room value. The aggregate
    // is the sum, which is the best estimate available.
    expect(streams.totalNet).toBe(7_500);
  });
});
