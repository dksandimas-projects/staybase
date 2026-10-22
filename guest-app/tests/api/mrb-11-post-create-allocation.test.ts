// Per the P1 revenue-reporting audit (2026-10-22): every path that
// moves a booking's BILL must re-snapshot the MRB-11 revenue
// allocation, because the Reports revenue streams read that
// snapshot.
//
// The four post-create money paths (a discount / voucher applied,
// a voucher removed, a government discount rejected) recomputed
// `booking.totalPrice` and left the create-time allocation
// untouched. The result was the production shape the QA pass
// found: a walk-in whose `revenueAllocation.totalNet` was the
// pre-discount gross while `totalPrice` was the discounted bill
// (e.g. `A3SD05Walkin0001` — allocation 4,800 vs bill 3,840).
//
// The handlers are tightly coupled to the admin SDK, so the
// write-site contract is pinned with source-text guards — the
// repo's existing pattern for these handlers (see
// `mrb-11-revenue-allocation-snapshot.test.ts`).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

/** Extract the body of a named exported handler. */
function handlerBody(name: string): string {
  const start = handlerSrc.indexOf(`export async function ${name}(`);
  expect(start, `expected to find ${name}`).toBeGreaterThan(-1);
  // The handler ends at the next top-level `export async function`.
  const next = handlerSrc.indexOf("\nexport async function ", start + 1);
  return handlerSrc.slice(start, next === -1 ? handlerSrc.length : next);
}

describe("MRB-11 — post-create money paths re-snapshot the revenue allocation", () => {
  it("imports the shared rebuild helper", () => {
    expect(handlerSrc).toMatch(
      /import\s*\{[\s\S]*?rebuildBookingRevenueAllocation[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("handleApplyBookingDiscount re-snapshots the allocation it moves the bill with", () => {
    const body = handlerBody("handleApplyBookingDiscount");
    expect(body).toMatch(
      /revenueAllocation:\s*rebuildBookingRevenueAllocation\(\{[\s\S]{0,300}?totalPrice[\s\S]{0,40}?\}\)/
    );
    // The helper is fed the SAME total the booking doc persists.
    expect(body).toMatch(/revenueAllocation:[\s\S]{0,300}?totalPrice[\s\S]{0,40}?\}\)/);
  });

  it("handleApplyReservationDiscount re-snapshots the allocation for every eligible child", () => {
    const body = handlerBody("handleApplyReservationDiscount");
    expect(body).toMatch(
      /revenueAllocation:\s*rebuildBookingRevenueAllocation\(\{[\s\S]{0,300}?totalPrice[\s\S]{0,40}?\}\)/
    );
  });

  it("handleRemoveVoucher re-snapshots the allocation when the bill goes back up", () => {
    const body = handlerBody("handleRemoveVoucher");
    expect(body).toMatch(
      /revenueAllocation:\s*rebuildBookingRevenueAllocation\(\{[\s\S]{0,300}?totalPrice:\s*restoredTotalPrice/
    );
  });

  it("handleRejectDiscount re-snapshots the allocation when the bill goes back up", () => {
    const body = handlerBody("handleRejectDiscount");
    expect(body).toMatch(
      /revenueAllocation:\s*rebuildBookingRevenueAllocation\(\{[\s\S]{0,300}?totalPrice:\s*restoredTotalPrice/
    );
  });

  it("every post-create money path writes a revenueAllocation next to its totalPrice", () => {
    // The invariant that matters: no path may move `totalPrice`
    // without moving the allocation with it.
    for (const name of [
      "handleApplyBookingDiscount",
      "handleApplyReservationDiscount",
      "handleRemoveVoucher",
      "handleRejectDiscount"
    ]) {
      const body = handlerBody(name);
      const totalPriceWrites = (body.match(/totalPrice[,:]/g) || []).length;
      expect(totalPriceWrites, `${name} should write a totalPrice`).toBeGreaterThan(0);
      expect(
        body,
        `${name} must re-snapshot the revenue allocation`
      ).toMatch(/revenueAllocation:\s*rebuildBookingRevenueAllocation\(/);
    }
  });
});

describe("MRB-11 — the walk-in create path keeps the bill and the allocation in agreement", () => {
  it("persists the SAME per-line figure as both the child's totalPrice and its allocation total", () => {
    // The walk-in per-line financial map computes ONE figure
    // (`lineTotal`) and it is used for BOTH the child's
    // `totalPrice` and the allocation's `totalNet` — so a
    // senior discount or a voucher is inside the same number
    // the guest is billed.
    expect(handlerSrc).toMatch(
      /totalPrice:\s*lineFinancials\.totalPrice,/
    );
    expect(handlerSrc).toMatch(
      /revenueAllocation:\s*lineFinancials\.revenueAllocation,/
    );
    expect(handlerSrc).toMatch(
      /revenueAllocation:\s*assertBookingRevenueAllocationInvariant\([\s\S]{0,600}?totalNet:\s*lineTotal[\s\S]{0,200}?\}\s*,\s*\n\s*lineTotal/
    );
  });

  it("keeps the BR-12 other add-ons OUTSIDE the room bill (OCT-FOL-01, decision #298)", () => {
    // The other add-ons are NOT inside `totalPrice` — they are
    // added on top of it for the balance. So the walk-in's
    // `subtotal` (the room bill the chain runs on) must NOT
    // include `walkinOtherAddOnTotal`, and the add-ons are
    // persisted as their own fields.
    //
    // The add-on revenue is NOT lost: the Reports BR-12.1
    // "Add-Ons" sub-tab sums `otherAddOnTotal` directly, and
    // every folio surface (`computeServerFolioTotals`,
    // `computeBookingFolio`, `getReservationFolioSummary`) adds
    // the term on top of `totalPrice`.
    const walkinSubtotal = handlerSrc.match(
      /const subtotal = roomTotal \+ breakfastTotal \+ walkinExtraBedTotal;/
    );
    expect(
      walkinSubtotal,
      "the walk-in room bill must not include the BR-12 other add-ons"
    ).toBeTruthy();
    expect(handlerSrc).toMatch(
      /otherAddOnSelections:\s*walkinOtherAddOnSelections,[\s\S]{0,80}?otherAddOnTotal:\s*walkinOtherAddOnTotal,/
    );
  });
});
