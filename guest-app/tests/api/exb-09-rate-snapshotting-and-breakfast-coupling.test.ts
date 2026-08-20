import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-09 (2026-08-01, per decision #145): source-text
// regression tests for the leftover EXB items — rate
// snapshotting + the EXB-04 breakfast-coupling guard.
// The other items on the EXB-09 list (overflow rule at
// boundaries, `extraBedCount > maxExtraBeds` rejected
// server-side, per-night math across multi-night stays)
// are already pinned by the prior EXB ship tests
// (`shared/__tests__/room-types.test.ts` for the
// boundary cases, `shared/__tests__/booking-addons.test.ts`
// for the per-night math, `guest-app/tests/api/exb-03-overflow-rule.test.ts`
// for the per-type cap rejection).
//
// Background (per `plan/project/ROADMAP.md §EXB-09`):
//   - **Rate snapshotting** — the booking doc persists a
//     snapshotted `extraBedRate` (frozen at create time
//     from the room type's `extraBedRate` field). A
//     later change to the room type's rate must never
//     rewrite the snapshotted value on an existing
//     booking. This is the same pattern CHD-01 used for
//     `breakfastRate` and DSC-01..05 used for
//     `discountScope` — admin-rate changes are
//     forward-only. EXB-01 ships the snapshot; this
//     test pins the contract so a future refactor that
//     re-reads the rate from the type at apply time
//     (e.g. "always use the current type rate") is
//     caught.
//   - **EXB-04 breakfast-coupling guard** — the
//     breakfast math uses `numGuests` (which already
//     includes the extra occupants), so a 2-adult +
//     1-child + 1-extra-bed booking has
//     `numGuests = 3` and `breakfastTotal = rate × 3 × nights`.
//     The extra bed line is a separate add-on
//     (`extraBedTotal = 1 × rate × nights`), NOT a
//     breakfast multiplier. The coupling looks obvious
//     and silently regresses if a future helper
//     decides to "add the extra bed count to the
//     breakfast occupancy" (a 4-guest breakfast total
//     for a 3-guest booking would be a 33% overcharge
//     on a single bed). The helper test pins the
//     helper-level contract; the source-text tests
//     pin the server-level wiring (the helper is
//     called with `numGuests`, not with
//     `numGuests + extraBedCount`).

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const bookingAddOnsHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingAddOns.ts"),
  "utf8"
);

describe("EXB-09 — rate snapshotting (later type rate change must not rewrite existing booking)", () => {
  it("handleCreateBooking writes the snapshotted `extraBedRate` (not the live type rate) onto the booking doc", () => {
    // The local `extraBedRate` variable is the snapshot
    // (read at line 1061: `const extraBedRate = extraBedCount > 0
    // ? typeExtraBedRate : 0;`). The booking doc write
    // must use the snapshot, not re-read the type's
    // current rate. Pin the doc write so a future
    // refactor that re-reads `typeEntry.extraBedRate` at
    // write time (which would couple the booking to
    // future rate changes) is caught.
    expect(bookingsHandlerSrc).toMatch(
      /extraBedRate:\s*extraBedRate,/
    );
  });

  it("handleCreateWalkin writes the snapshotted `walkinExtraBedRate` (not the live type rate) onto the booking doc", () => {
    // Same snapshotting pattern as handleCreateBooking.
    // The walk-in path uses `walkinExtraBedRate` (the
    // local variable, snapshotted from the room type at
    // line 2251: `const walkinExtraBedRate = walkinExtraBedCount > 0
    // ? walkinTypeExtraBedRate : 0;`). Pin the doc write.
    expect(bookingsHandlerSrc).toMatch(
      /extraBedRate:\s*walkinExtraBedRate,/
    );
  });

  it("handleRescheduleBooking reads the existing booking's `extraBedRate` (the snapshot, not the type's current rate)", () => {
    // The reschedule path is the load-bearing test for
    // rate snapshotting: when staff reschedules a
    // booking to a different room type, the EXTRA BED
    // rate must come from the existing booking doc
    // (frozen at original create time), NOT from the
    // new room type's `extraBedRate`. Pin the
    // `booking.extraBedRate` read so a refactor that
    // re-reads from `typeEntry.extraBedRate` is caught
    // — that refactor would silently let an admin rate
    // change alter an existing bill via a reschedule.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+preservedExtraBedRate\s*=\s*Number\(booking\.extraBedRate\)\s*\|\|\s*0/
    );
    expect(bookingsHandlerSrc).toMatch(
      /calculateExtraBedAddOn\(\{[\s\S]{0,200}extraBedRate:\s*preservedExtraBedRate/
    );
  });

  it("handleCreateBooking never re-reads `typeEntry.extraBedRate` at write time (the snapshot is the single source)", () => {
    // Belt-and-suspenders: the doc write must use the
    // local `extraBedRate` (the snapshot), not
    // `typeExtraBedRate` or `typeEntry.extraBedRate`.
    // A refactor that re-reads from the type doc at
    // write time (a common optimization for "always
    // use the latest config") would break the
    // snapshotting contract. The booking doc write
    // block (around line 1504) is the load-bearing
    // site. Pin the absence of `typeEntry.extraBedRate`
    // / `typeExtraBedRate` in the doc write vicinity.
    // The snapshot is established at line 1061; the
    // doc write is around line 1504 — between those
    // lines the local `extraBedRate` is the single
    // source. Test: a write near the snapshot must
    // use the local var, not the type field.
    expect(bookingsHandlerSrc).toMatch(
      /extraBedTotal,[\s\S]{0,200}extraBedCount:\s*extraBedCount,[\s\S]{0,200}extraBedRate:\s*extraBedRate,/
    );
  });
});

describe("EXB-09 — EXB-04 breakfast-coupling guard (extra bed is a separate add-on, not a breakfast multiplier)", () => {
  it("calculateBreakfastAddOn uses `numGuests` (which already includes the extra occupants)", () => {
    // The breakfast helper reads `numGuests` (the
    // total occupancy) and multiplies it by the rate +
    // nights. The extra bed is NOT a breakfast
    // multiplier — the guest in the extra bed is
    // already counted in `numGuests` (as either an
    // adult or a child). A 2-adult + 1-child + 1-extra-bed
    // booking has `numGuests = 3` and the breakfast
    // math is `rate × 3 × nights`. Pin the helper's
    // input field so a future refactor that adds
    // `extraBedCount` to the occupancy (a 4-guest
    // breakfast total for a 3-guest booking = 33%
    // overcharge) is caught.
    expect(bookingAddOnsHelperSrc).toMatch(
      /numGuests\?:\s*number\s*\|\s*null/
    );
    // The helper uses `numGuests` (or the split, when
    // present) — it does NOT add `extraBedCount`.
    expect(bookingAddOnsHelperSrc).not.toMatch(
      /numGuests\s*\+\s*extraBedCount/
    );
    expect(bookingAddOnsHelperSrc).not.toMatch(
      /numAdults\s*\+\s*numChildren\s*\+\s*extraBedCount/
    );
  });

  it("handleCreateBooking calls `calculateBreakfastAddOn` with `numGuests: guests` (the total occupancy)", () => {
    // The server wires the breakfast helper with the stay's own
    // occupancy (`numAdults + numChildren` per CHD-04). The extra bed
    // is a SEPARATE add-on line by default — computed by
    // `calculateExtraBedAddOn` — but per EXB-12 (2026-08-06, per
    // decision #199) the user can OPT IN to breakfast for the
    // extra-bed occupant(s) via the per-type `extraBedBreakfast`
    // toggle. The call site therefore passes `extraBedCount` +
    // `extraBedBreakfast` together; the helper has the gate
    // (`if (input.extraBedBreakfast) { effectiveOccupancy +=
    // extraBedCount }`) that respects the toggle.
    //
    // Per MRB-06 / MRB-07 (2026-08-02, per decision #159): a
    // reservation charges breakfast once per guest, so each room stay
    // passes ITS OWN guest count rather than the reservation total —
    // otherwise an N-room reservation would bill breakfast N times for
    // every guest. Both create paths are asserted, because a whole-file
    // search for `numGuests: guests` passed only by accident once one
    // path still used the reservation-wide total.
    expect(bookingsHandlerSrc).toMatch(
      /calculateBreakfastAddOn\(\{[\s\S]{0,400}numGuests:\s*assigned\.numAdults \+ assigned\.numChildren,[\s\S]{0,400}\}\)/m
    );
    expect(bookingsHandlerSrc).toMatch(/const stayBreakfastTotal = calculateBreakfastAddOn\(\{/);
    // Per EXB-12 (2026-08-06, per decision #199): every call site
    // that passes `extraBedCount` to the breakfast helper must
    // ALSO pass `extraBedBreakfast` (the opt-in toggle). The
    // helper gates on `extraBedBreakfast` — a call site that
    // passes `extraBedCount` without `extraBedBreakfast` would
    // inflate the breakfast total by phantom beds (a 4-guest
    // breakfast for a 3-guest booking). This is the v0.264.8
    // contract: the gate moves from "never pass extraBedCount"
    // (pre-EXB-12) to "always pass extraBedCount AND
    // extraBedBreakfast together" (post-EXB-12). Use a wider
    // regex window (5000 chars) so the full call body — not just
    // the first 800 chars — is in scope.
    const breakfastCallMatches = bookingsHandlerSrc.match(
      /calculateBreakfastAddOn\(\{[\s\S]{0,5000}?\}\)/gm
    );
    expect(breakfastCallMatches).toBeTruthy();
    // Every call site, not just the first — the handler now has one per
    // create + walkin + reschedule path.
    expect(breakfastCallMatches!.length).toBeGreaterThanOrEqual(3);
    for (const call of breakfastCallMatches!) {
      if (/extraBedCount/.test(call)) {
        // If the call site passes `extraBedCount`, it MUST also pass
        // `extraBedBreakfast` so the helper's gate is wired.
        // Otherwise the breakfast total silently includes the
        // extra beds without the user's opt-in.
        expect(call).toMatch(/extraBedBreakfast/);
      }
    }
  });

  it("handleCreateBooking's `subtotal` is `roomTotal + breakfastTotal + extraBedTotal` (3 additively independent terms)", () => {
    // The subtotal is the sum of 3 independent add-on
    // terms: the room rate, the breakfast add-on
    // (using `numGuests`), and the extra bed add-on
    // (using `extraBedCount`). The terms are
    // additively independent — a refactor that
    // "consolidates" them (e.g. adds `extraBedCount`
    // to the breakfast occupancy) would inflate the
    // subtotal. Pin the 3-term sum.
    expect(bookingsHandlerSrc).toMatch(
      /const\s+subtotal\s*=\s*roomTotal\s*\+\s*breakfastTotal\s*\+\s*extraBedTotal;/
    );
  });

  it("calculateExtraBedAddOn is `count × rate × nights` (NOT a breakfast multiplier, NOT a per-occupancy term)", () => {
    // The extra bed add-on is purely
    // `extraBedCount × extraBedRate × numNights` —
    // it does NOT multiply by `numGuests` or
    // `numAdults` or any occupancy term. The
    // physical bed is billed per night at the
    // snapshotted rate, independent of how many
    // guests are in the room. Pin the helper's body
    // so a refactor that adds an occupancy term is
    // caught.
    expect(bookingAddOnsHelperSrc).toMatch(
      /export\s+function\s+calculateExtraBedAddOn\([\s\S]{0,400}return\s+count\s*\*\s*rate\s*\*\s*nights;/
    );
  });
});
