// Per EXB-10 + EXB-12 (2026-08-06, per decision #157 + #199) hotfix
// (v0.264.8): regression tests for the 4 booking-flow gaps the
// post-v0.264.5 audit surfaced. Each patch has TWO layers of
// coverage — a runtime helper test (catches the math bug) and a
// source-text regex test on the handler call site (catches the
// v0.264.5 class of "field dropped from the call site" bug).
//
// The four patches:
//
//   PATCH 1 (reschedule breakfastTotal):
//     handleRescheduleBooking's calculateBreakfastAddOn call
//     must pass `extraBedCount` + `extraBedBreakfast` so a
//     reschedule of a booking with the EXB-12 toggle on
//     doesn't silently drop the extra-bed breakfast charge.
//
//   PATCH 2 (reschedule rate breakdown):
//     handleRescheduleBooking's buildRateBreakdown call must
//     pass `extraBedTotal` + `extraBedCount` + `extraBedRate`
//     so the receipt PDF + email + admin drawer show the
//     "Extra bed add-on" line for rescheduled bookings.
//
//   PATCH 3 (add-room inventory check):
//     handleAddRoomToReservation must call
//     `checkExtraBedInventory` to enforce the hotel-wide
//     rollaway cap (the check exists in create + walkin +
//     reschedule; the add-room path silently skipped it).
//
//   PATCH 4 (add-room doc snapshots):
//     handleAddRoomToReservation's newBookingDoc composition
//     must write `breakfastIncludesChildren` + `extraBedBreakfast`
//     (the create + walkin paths write both; the add-room
//     path silently dropped both).
//
// Reference IDs: TEST-EXB-10-12-RESYNC-001..006. See
// `plan/docs/DECISIONS-FEATURES.md` decision #199 (EXB-12) +
// decision #157 (EXB-10) + the v0.264.8 ROADMAP entry.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateBreakfastAddOn,
  calculateExtraBedAddOn
} from "@spark-inn/shared";
import { buildRateBreakdown } from "../../server/lib/rate-breakdown";
import {
  checkExtraBedInventory,
  countExtraBedsInUse,
  type InventoryBooking
} from "@spark-inn/shared";

const serverHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// ────────────────────────────────────────────────────────────────────
// PATCH 1 — RUNTIME: the helper math must reward the extraBedBreakfast
// toggle. Pre-v0.264.8 the reschedule's calculateBreakfastAddOn call
// did NOT pass `extraBedCount` / `extraBedBreakfast`, so the helper
// returned the same value as the no-toggle case (silently under-
// charging the guest by `rate × extraBedCount × nights`).
// ────────────────────────────────────────────────────────────────────
describe("PATCH 1 — calculateBreakfastAddOn with extraBedBreakfast", () => {
  it("TEST-EXB-10-12-RESYNC-001: extraBedBreakfast=true with extraBedCount=1 increases the total by rate×1×nights", () => {
    // Same booking, two helper calls. The only difference is
    // `extraBedBreakfast: true` + `extraBedCount: 1`. The
    // post-fix total must be `rate × (numGuests + 1) × nights`
    // = 250 × (2 + 1) × 3 = 2250. Pre-fix the helper call
    // would not pass the extra-bed fields and the total
    // would be `rate × 2 × 3` = 1500. The delta is the
    // charge the reschedule silently lost.
    const baseline = calculateBreakfastAddOn({
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2,
      numNights: 3,
      breakfastIncludesChildren: true
    });
    const withExtraBedBreakfast = calculateBreakfastAddOn({
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2,
      numNights: 3,
      breakfastIncludesChildren: true,
      extraBedCount: 1,
      extraBedBreakfast: true
    });
    expect(baseline).toBe(1500);
    expect(withExtraBedBreakfast).toBe(2250);
    expect(withExtraBedBreakfast - baseline).toBe(750);
  });

  it("extraBedBreakfast=true with extraBedCount=0 does NOT increase the total (invariant enforcement)", () => {
    // The `extraBedBreakfast` toggle is meaningless when
    // `extraBedCount === 0` — the helper should still
    // short-circuit to the baseline. The server-side
    // invariant (`extraBedBreakfast implies extraBedCount
    // > 0`) is enforced in the `validatedRoomStays` loop
    // at create time; the helper is forgiving.
    const total = calculateBreakfastAddOn({
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2,
      numNights: 3,
      breakfastIncludesChildren: true,
      extraBedCount: 0,
      extraBedBreakfast: true
    });
    expect(total).toBe(1500);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 1 — SOURCE-TEXT: the reschedule handler's
// calculateBreakfastAddOn call must pass the two new fields.
// This is the v0.264.5 class of bug — a "drop a field from the
// call site" regression. Regex matches the specific call-site
// shape so a future refactor that drops the fields fails loud.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 1 — handleRescheduleBooking call site wires the EXB-12 fields", () => {
  it("the calculateBreakfastAddOn call passes `extraBedCount: preservedExtraBedCount`", () => {
    expect(serverHandlerSrc).toMatch(
      /calculateBreakfastAddOn\(\{[\s\S]*?extraBedCount:\s*preservedExtraBedCount[\s\S]*?\}\)\s*:\s*0/
    );
  });

  it("the calculateBreakfastAddOn call passes `extraBedBreakfast: preservedExtraBedBreakfast`", () => {
    expect(serverHandlerSrc).toMatch(
      /calculateBreakfastAddOn\(\{[\s\S]*?extraBedBreakfast:\s*preservedExtraBedBreakfast[\s\S]*?\}\)\s*:\s*0/
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 2 — RUNTIME: buildRateBreakdown must include the
// "Extra bed add-on" line when extraBedTotal > 0. Pre-v0.264.8
// the reschedule's buildRateBreakdown call did NOT pass the
// three extra-bed fields, so the addOns array was missing the
// line — the extra bed was invisible on every downstream
// surface even though the `extraBedTotal` was correctly
// computed by `calculateExtraBedAddOn`.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 2 — buildRateBreakdown includes the extra-bed line", () => {
  it("TEST-EXB-10-12-RESYNC-002: with extraBedTotal=600 the addOns array includes a non-zero 'Extra bed add-on' line", () => {
    // The post-fix rate breakdown must include BOTH the
    // breakfast term AND the extra-bed term. Pre-fix the
    // reschedule's call dropped the three extra-bed fields
    // and the addOns array contained only the breakfast
    // line — the extra-bed term was silently invisible.
    const breakdown = buildRateBreakdown({
      roomLines: [{
        source: "standard",
        label: "Standard",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
        nights: 3,
        nightlyRate: 2000,
        subtotal: 6000
      }],
      roomSubtotal: 6000,
      breakfastTotal: 1500,
      extraBedTotal: 600,
      extraBedCount: 1,
      extraBedRate: 200,
      discountType: "",
      discountPct: 0,
      voucherDiscount: 0,
      memberDiscountPct: 0,
      finalTotal: 8100
    });
    const labels = breakdown.addOns.map((line) => line.label);
    expect(labels).toContain("Breakfast add-on");
    expect(labels).toContain("Extra bed add-on");
    const extraBedLine = breakdown.addOns.find((line) => line.label === "Extra bed add-on");
    expect(extraBedLine?.amount).toBe(600);
  });

  it("without extraBedTotal (the pre-fix shape) the addOns array would only have the breakfast line", () => {
    // Documents the failure mode: if a future refactor
    // drops the three extra-bed fields from the reschedule
    // call, the addOns array silently becomes
    // `[{ label: "Breakfast add-on", amount: 1500 }]` —
    // the extra bed is gone. This test makes the failure
    // mode explicit so a refactor reviewer can see it.
    const breakdown = buildRateBreakdown({
      roomLines: [{
        source: "standard",
        label: "Standard",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
        nights: 3,
        nightlyRate: 2000,
        subtotal: 6000
      }],
      roomSubtotal: 6000,
      breakfastTotal: 1500,
      discountType: "",
      discountPct: 0,
      voucherDiscount: 0,
      memberDiscountPct: 0,
      finalTotal: 7500
    });
    const labels = breakdown.addOns.map((line) => line.label);
    expect(labels).toEqual(["Breakfast add-on"]);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 2 — SOURCE-TEXT: the reschedule handler's
// buildRateBreakdown call must pass the three new fields.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 2 — handleRescheduleBooking call site wires the extra-bed fields to buildRateBreakdown", () => {
  it("the buildRateBreakdown call passes `extraBedTotal`", () => {
    expect(serverHandlerSrc).toMatch(
      /buildRateBreakdown\(\{[\s\S]*?extraBedTotal,[\s\S]*?\}\);/
    );
  });

  it("the buildRateBreakdown call passes `extraBedCount: preservedExtraBedCount`", () => {
    expect(serverHandlerSrc).toMatch(
      /buildRateBreakdown\(\{[\s\S]*?extraBedCount:\s*preservedExtraBedCount,[\s\S]*?\}\);/
    );
  });

  it("the buildRateBreakdown call passes `extraBedRate: preservedExtraBedRate`", () => {
    expect(serverHandlerSrc).toMatch(
      /buildRateBreakdown\(\{[\s\S]*?extraBedRate:\s*preservedExtraBedRate,[\s\S]*?\}\);/
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 3 — RUNTIME: checkExtraBedInventory correctly rejects
// when in-use + requested > inventory. Pre-v0.264.8 the add-room
// path silently skipped this check, so the desk could over-
// commit the hotel's rollaway inventory. The helper is the
// pure function; the test pins the over-capacity rejection.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 3 — checkExtraBedInventory over-capacity rejection", () => {
  it("TEST-EXB-10-12-RESYNC-003: inUse=2 + requested=1 with inventory=2 returns ok=false (over by 1)", () => {
    // The hotel has 2 rollaways. 2 are already booked across
    // overlapping stays. The add-room wants 1 more.
    // `2 + 1 = 3 > 2` → reject. Pre-v0.264.8 the add-room
    // path skipped this check entirely; the desk would have
    // over-committed and the 3rd rollaway wouldn't exist at
    // check-in.
    const result = checkExtraBedInventory(2, 2, 1);
    expect(result.ok).toBe(false);
    expect(result.inUse).toBe(2);
    expect(result.available).toBe(0);
  });

  it("inUse=1 + requested=1 with inventory=2 returns ok=true (fits exactly)", () => {
    // Boundary case: 1 in-use + 1 requested = 2 inventory.
    // Should accept. The helper's `<=` comparison is
    // inclusive (a 2-bed inventory holds 2 bookings).
    const result = checkExtraBedInventory(2, 1, 1);
    expect(result.ok).toBe(true);
    expect(result.available).toBe(1);
  });

  it("inventory=0 short-circuits to ok=true (the 'no constraint' default)", () => {
    // The historical "any number" behavior — absent or 0
    // inventory means no cap. Pre-EXB-10 behavior. The
    // add-room's check must respect this so a freshly
    // bootstrapped project (no inventory configured)
    // doesn't reject every extra-bed add.
    const result = checkExtraBedInventory(0, 100, 50);
    expect(result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 3 — SOURCE-TEXT: the add-room handler must call
// checkExtraBedInventory. The pre-v0.264.8 handler did not.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 3 — handleAddRoomToReservation call site invokes the EXB-10 inventory check", () => {
  it("the handler reads the rollaway inventory from hotelConfig.extraBedInventory", () => {
    // Same shape as the create + walkin + reschedule
    // paths: `Math.max(0, Number(hotelConfig.extraBedInventory) || 0)`.
    expect(serverHandlerSrc).toMatch(
      /checkExtraBedInventory\([\s\S]*?Math\.max\(0,\s*Number\(hotelConfig\.extraBedInventory\)\s*\|\|\s*0\)/
    );
  });

  it("the handler calls countExtraBedsInUse for the add-room range", () => {
    // The new child's range is the header's range
    // (the new room inherits the shared dates), so
    // the overlap test uses `headerCheckIn` /
    // `headerCheckOut`. Pre-v0.264.8 the add-room
    // handler did not call this helper at all.
    expect(serverHandlerSrc).toMatch(
      /countExtraBedsInUse\([\s\S]*?headerCheckIn,[\s\S]*?headerCheckOut[\s\S]*?\)/
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// PATCH 4 — RUNTIME: the new child doc must carry the
// breakfastIncludesChildren + extraBedBreakfast snapshots. The
// rate-breakdown rebuild is back-compat with undefined values,
// so the math is correct today — but any future read site that
// does `booking.breakfastIncludesChildren === true` or
// `booking.extraBedBreakfast === true` would see `undefined`
// for add-room children. The test pins the snapshot pattern
// at the doc-build boundary.
// ────────────────────────────────────────────────────────────────────
describe("PATCH 4 — add-room child doc snapshots", () => {
  it("TEST-EXB-10-12-RESYNC-004: the add-room newBookingDoc writes `breakfastIncludesChildren` from the header", () => {
    // Pin the exact shape so a future refactor can't drop
    // the field. The default `true` matches the
    // historical "children pay the full rate" math.
    expect(serverHandlerSrc).toMatch(
      /newBookingDoc\s*=\s*\{[\s\S]*?breakfastIncludesChildren:\s*Boolean\(\(reservation\s+as\s+any\)\.breakfastIncludesChildren\s*\?\?\s*true\)/
    );
  });

  it("TEST-EXB-10-12-RESYNC-005: the add-room newBookingDoc writes `extraBedBreakfast: false` (admin UI not yet exposed)", () => {
    // Pin the exact shape. The add-room admin surface
    // doesn't expose the EXB-12 toggle yet (consistent
    // with the walkin admin surface per the EXB-12 spec
    // — a future UX work item), so the value is `false`
    // for every new child created via add-room until the
    // UI is updated.
    expect(serverHandlerSrc).toMatch(
      /newBookingDoc\s*=\s*\{[\s\S]*?extraBedBreakfast:\s*false/
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Cross-feature sanity: the helper math + the inventory check +
// the rate breakdown all compose correctly. This is the
// "end-to-end shape" test — the four patches together must
// produce a consistent post-reschedule + add-room pricing
// pipeline.
// ────────────────────────────────────────────────────────────────────
describe("Cross-feature sanity — helper composition", () => {
  it("TEST-EXB-10-12-RESYNC-006: a reschedule of a 2-guest booking with 1 extra bed + breakfast keeps the extra-bed breakfast", () => {
    // The create-time inputs (used to seed the booking):
    //   hasBreakfast=true, breakfastRate=250, numGuests=2,
    //   numNights=3, extraBedCount=1, extraBedBreakfast=true
    //   → breakfastTotal = 250 × 3 × 3 = 2250
    //   → extraBedTotal  = 1 × 200 × 3   = 600
    // The reschedule recomputes with the same shape:
    //   breakfastTotal = calculateBreakfastAddOn({
    //     hasBreakfast, breakfastRate, numGuests, numNights,
    //     breakfastIncludesChildren,
    //     extraBedCount: preservedExtraBedCount,   // <-- PATCH 1
    //     extraBedBreakfast: preservedExtraBedBreakfast   // <-- PATCH 1
    //   })
    //   → must be 2250 (same as create-time)
    const createTimeBreakfast = calculateBreakfastAddOn({
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2,
      numNights: 3,
      breakfastIncludesChildren: true,
      extraBedCount: 1,
      extraBedBreakfast: true
    });
    // The reschedule helper call uses `booking.numGuests`
    // (the snapshotted value), not the split — same shape
    // as the create path's "before CHD-10" back-compat.
    // The numGuests path still respects extraBedBreakfast.
    const rescheduleBreakfast = calculateBreakfastAddOn({
      hasBreakfast: true,
      breakfastRate: 250,
      numGuests: 2,
      numNights: 3,
      breakfastIncludesChildren: true,
      extraBedCount: 1,
      extraBedBreakfast: true
    });
    expect(createTimeBreakfast).toBe(2250);
    expect(rescheduleBreakfast).toBe(2250);

    // The extra-bed total is independent (separate helper).
    const extraBed = calculateExtraBedAddOn({
      extraBedCount: 1,
      extraBedRate: 200,
      numNights: 3
    });
    expect(extraBed).toBe(600);

    // The rate breakdown composes both. PATCH 2 ensures
    // the reschedule's call site passes all three fields.
    const breakdown = buildRateBreakdown({
      roomLines: [{
        source: "standard",
        label: "Standard",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
        nights: 3,
        nightlyRate: 2000,
        subtotal: 6000
      }],
      roomSubtotal: 6000,
      breakfastTotal: 2250,
      extraBedTotal: 600,
      extraBedCount: 1,
      extraBedRate: 200,
      discountType: "",
      discountPct: 0,
      voucherDiscount: 0,
      memberDiscountPct: 0,
      finalTotal: 8850
    });
    const labels = breakdown.addOns.map((line) => line.label);
    expect(labels).toContain("Breakfast add-on");
    expect(labels).toContain("Extra bed add-on");
  });

  it("PATCH 3 sanity: countExtraBedsInUse over the new range + inventory check rejects over-capacity", () => {
    // The new child wants 1 extra bed, header range is
    // 2026-09-01..04. Two other bookings already consume
    // 2 rollaways across the same range. Hotel inventory
    // is 2. The add-room must reject.
    const now = new Date("2026-08-25T12:00:00Z");
    const candidates: InventoryBooking[] = [
      {
        id: "b1",
        extraBedCount: 1,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-03"),
        status: "confirmed"
      },
      {
        id: "b2",
        extraBedCount: 1,
        checkIn: new Date("2026-09-02"),
        checkOut: new Date("2026-09-04"),
        status: "confirmed"
      }
    ];
    const inUse = countExtraBedsInUse(
      candidates,
      new Date("2026-09-01"),
      new Date("2026-09-04"),
      undefined,
      now
    );
    expect(inUse).toBe(2);
    const result = checkExtraBedInventory(2, inUse, 1);
    expect(result.ok).toBe(false);
  });
});
