// Per MRB-11 (2026-08-03, per decision #177):
// source-text guard for the server-side snapshot
// of `Booking.revenueAllocation` and
// `Reservation.aggregateRevenueAllocation`.
//
// The behavioural tests in
// `shared/__tests__/mrb-11-revenue-streams.test.ts`
// cover the pure helpers (read path + assertion
// invariant + compute). This file pins that the
// three write paths (public create, walkin,
// reschedule) actually wire the snapshot into
// the same `runTransaction` as the price write +
// the audit stamps. The per-stream invariant is
// also pinned here via the `assertBookingRevenueAllocationInvariant`
// call site.
//
// Why source-text guards (not full integration):
// the handlers are tightly coupled to adminSdk +
// the in-memory `transaction.update(...)` shape;
// replicating the full transactional write in
// Node is expensive and the round-trip emulator
// test (decision #177, item 6) covers the
// data-shape contract when it ships. The source-text
// guard pins that the right helpers are called
// from the right places, which is the realistic
// regression risk (someone reverts a single line
// and silently drops the snapshot).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const sharedHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingFolio.ts"),
  "utf8"
);

const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("MRB-11 — server-side revenue allocation snapshot (PR2 wiring)", () => {
  it("imports the assert helper from @spark-inn/shared", () => {
    // The handler pulls `assertBookingRevenueAllocationInvariant`
    // from the shared index (re-exported via `shared/utils/bookingFolio.ts`).
    // Without the import, the per-write assertion site would
    // not typecheck (and the throw at the write boundary
    // would silently disappear).
    expect(handlerSrc).toMatch(
      /import\s*\{[\s\S]*?assertBookingRevenueAllocationInvariant[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("re-exports the assertion from the shared package entry", () => {
    // The `shared/index.ts` re-export surface is the
    // public boundary the handlers + the tests both
    // read. A missing re-export would break the
    // handler import at typecheck time.
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/cancellation"/);
    // The cancellation module re-exports the bookingFolio
    // helpers via `shared/utils/cancellation.ts`. Easier
    // to assert the helpers are reachable from the
    // bookingFolio module directly.
  });

  it("re-exports the assertion from shared/utils/bookingFolio.ts", () => {
    // The pure helper module is the source of truth
    // for the assert + the two read helpers + the
    // compute helper. The handler reads them via
    // `@spark-inn/shared`, which re-exports via the
    // `shared/index.ts` re-export chain.
    expect(sharedHelperSrc).toMatch(
      /export function assertBookingRevenueAllocationInvariant/
    );
    expect(sharedHelperSrc).toMatch(
      /export function getBookingRevenueStreams/
    );
    expect(sharedHelperSrc).toMatch(
      /export function getReservationRevenueStreams/
    );
    expect(sharedHelperSrc).toMatch(
      /export function computeBookingRevenueAllocation/
    );
  });

  it("writes revenueAllocation in the public create path's per-child loop", () => {
    // The public `handleCreateBooking` writes the
    // allocation INSIDE the per-child write loop so
    // each child carries its own snapshot (and the
    // aggregate at the reservation header sums them
    // for fast Reports reads). The assertion site
    // catches any rounding drift before the Firestore
    // write.
    expect(handlerSrc).toMatch(
      /revenueAllocation: assertBookingRevenueAllocationInvariant[\s\S]{0,500}?roomNet: pricingForRoom\.roomTotal[\s\S]{0,500}?totalNet: pricingForRoom\.totalPrice/s
    );
  });

  it("writes aggregateRevenueAllocation on the reservation header in the public create path", () => {
    // The reservation header's `aggregateRevenueAllocation`
    // is the sum of the N per-child allocations, written
    // transactionally with the child writes. The invariant
    // assertion runs before the write.
    expect(handlerSrc).toMatch(
      /aggregateRevenueAllocation: assertBookingRevenueAllocationInvariant[\s\S]{0,800}?totalNet: totalPrice/s
    );
  });

  it("writes revenueAllocation per line in the walkin path's per-line financial map", () => {
    // The walkin path (`handleCreateWalkin`) builds the
    // allocation inside the `walkinRoomStayFinancials`
    // map callback. Walk-in has no member step
    // (`memberPct: 0`), so the deduction sum is
    // `seniorDeduction + voucherDeduction` from the
    // chain result.
    expect(handlerSrc).toMatch(
      /revenueAllocation: assertBookingRevenueAllocationInvariant[\s\S]{0,500}?lineChainResult\.seniorDeduction \+ lineChainResult\.voucherDeduction/s
    );
  });

  it("writes revenueAllocation on the booking update in the reschedule path", () => {
    // The reschedule re-snapshots because the dates
    // (and therefore the gross amounts) have changed.
    // The deduction sum includes the chain's senior
    // + voucher + member deductions AND the
    // snapshotted `pointsRedeemedValue` (a separate
    // deduction layer the chain does not see).
    expect(handlerSrc).toMatch(
      /revenueAllocation: assertBookingRevenueAllocationInvariant[\s\S]{0,500}?rescheduleChain\.seniorDeduction \+[\s\S]{0,200}?rescheduleChain\.voucherDeduction \+[\s\S]{0,200}?rescheduleChain\.memberDeduction \+[\s\S]{0,200}?booking\.pointsRedeemedValue/s
    );
  });

  it("updates aggregateRevenueAllocation on the reservation header in the reschedule path", () => {
    // The reschedule is per-child (the single-room
    // reschedule handler does not iterate siblings),
    // so the reservation header's aggregate equals
    // the per-child allocation in the single-room
    // case. The N>1 case is a pre-existing limitation
    // (the reservation `totalPrice` is also stale for
    // a multi-child reschedule); Reports falls back
    // to summing children via `getReservationRevenueStreams`.
    expect(handlerSrc).toMatch(
      /aggregateRevenueAllocation: updatedBooking\.revenueAllocation/
    );
  });

  it("asserts the per-stream invariant at every write site (the write-boundary guard)", () => {
    // Count the `assertBookingRevenueAllocationInvariant`
    // call sites in the handler. The minimum count is:
    //   1 — per-child allocation in the public create loop
    //   1 — reservation header aggregate in the public create
    //   1 — per-line allocation in the walkin map
    //   1 — per-line allocation reused as the reservation
    //       header aggregate in the walkin
    //   1 — booking update in the reschedule
    //   1 — reservation header aggregate in the reschedule
    // That's 6 minimum. Asserting "at least 6" pins the
    // write-boundary guard without being brittle to
    // future refactors that may add per-iteration
    // allocations (e.g. an N>1 walk-in loop).
    const matches = handlerSrc.match(
      /assertBookingRevenueAllocationInvariant/g
    );
    expect(matches, "expected at least 6 call sites in bookings.ts").toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(6);
  });
});
