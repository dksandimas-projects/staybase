// Per MRB-11 (2026-08-03, per decision #177): every booking write
// path snapshots the per-stream revenue allocation the Reports
// revenue streams read.
//
// The CORPORATE conversion path (`/api/corporate/convert-inquiry`)
// was the one write path that did NOT: it wrote `totalPrice` with
// no `revenueAllocation` at all. The Reports revenue streams then
// fell back to the legacy proportional split, so a corporate
// booking was mis-attributed to the room stream and carried no
// MRB-11 revenue identity. The production QA fixtures
// `QAA4ACME202600001`, `QAA4CO07NEG00001`, `QAA4FLATRATE000001`
// and `QAA4FRONTDESK0001` are instances of that defect.
//
// The handler is tightly coupled to the admin SDK, so the
// write-site contract is pinned with a source-text guard (the
// repo's existing pattern — see `batch-9-convert-inquiry.test.ts`
// and `mrb-11-revenue-allocation-snapshot.test.ts`) and the
// helper's behaviour is pinned with a runtime assertion.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertBookingRevenueAllocationInvariant,
  computeBookingRevenueAllocation
} from "@spark-inn/shared";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/corporate-inquiries.ts"),
  "utf8"
);

describe("MRB-11 — corporate conversion writes the revenue allocation", () => {
  it("snapshots the allocation with the SHARED helper (not a hand-rolled computation)", () => {
    // The snapshot must come from `computeBookingRevenueAllocation`
    // — the same helper the create / walk-in / reschedule paths
    // use — so the streams and the total can never be computed
    // from two different sets of figures.
    expect(handlerSrc).toMatch(
      /revenueAllocation:\s*computeBookingRevenueAllocation\(\{[\s\S]{0,300}?totalPrice:\s*finalTotalPrice/
    );
    expect(handlerSrc).toMatch(
      /import\s*\{[\s\S]*?computeBookingRevenueAllocation[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("feeds the helper the same figures the booking's totalPrice is built from", () => {
    // The helper is fed the negotiated nightly rate + the number
    // of nights + a zero breakfast (per BR-08 a corporate
    // conversion carries no breakfast) + the same `finalTotalPrice`
    // the booking doc persists.
    const allocationBlock = handlerSrc.match(
      /revenueAllocation:\s*computeBookingRevenueAllocation\(\{[\s\S]{0,400}?\}\)/
    );
    expect(allocationBlock, "expected to find the allocation block").toBeTruthy();
    expect(allocationBlock![0]).toMatch(/ratePerNight/);
    expect(allocationBlock![0]).toMatch(/numNights/);
    expect(allocationBlock![0]).toMatch(/breakfastTotal:\s*0/);
    expect(allocationBlock![0]).toMatch(/extraBedTotal:\s*0/);
    expect(allocationBlock![0]).toMatch(/totalPrice:\s*finalTotalPrice/);
  });

  it("persists the allocation inside the booking document write", () => {
    // The allocation must be part of the `newBooking` object that
    // the transaction writes to `bookings/{id}`.
    const newBookingBlock = handlerSrc.match(
      /newBooking\s*=\s*\{[\s\S]*?linkedInquiryId:\s*inquiryId/
    );
    expect(newBookingBlock, "expected to find the newBooking block").toBeTruthy();
    expect(newBookingBlock![0]).toMatch(/revenueAllocation:\s*computeBookingRevenueAllocation/);
  });

  describe("RUNTIME — the shared helper on the corporate shape", () => {
    it("produces an allocation whose total IS the billed total", () => {
      // A 2-night corporate stay at a negotiated ₱2,300/night
      // rate = ₱4,600 — the shape of the production fixtures.
      const allocation = computeBookingRevenueAllocation({
        ratePerNight: 2_300,
        numNights: 2,
        breakfastTotal: 0,
        extraBedTotal: 0,
        totalPrice: 4_600
      });

      expect(allocation).toEqual({
        roomNet: 4_600,
        breakfastNet: 0,
        addOnNet: 0,
        deductionNet: 0,
        totalNet: 4_600
      });
      // The write-boundary guard accepts it (the total IS the
      // billed total).
      expect(() =>
        assertBookingRevenueAllocationInvariant(allocation, 4_600)
      ).not.toThrow();
    });

    it("is rejected by the write-boundary guard when the total drifts", () => {
      // The guard is the safety net: an allocation whose total is
      // not the billed total must never reach Firestore.
      const allocation = computeBookingRevenueAllocation({
        ratePerNight: 2_300,
        numNights: 2,
        breakfastTotal: 0,
        extraBedTotal: 0,
        totalPrice: 4_600
      });
      expect(() =>
        assertBookingRevenueAllocationInvariant(
          { ...allocation, totalNet: 4_800 },
          4_600
        )
      ).toThrow(/revenue allocation total mismatch/);
    });
  });
});
