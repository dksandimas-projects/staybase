// Per OCT-H8 (2026-10-20, decision #288): the reschedule / cancel
// paths never re-dated the add-on selections.
//
// THE BUG
//
// `handleRescheduleBooking` (and the `mode: "extend"` wrapper) and
// `handleCancelBooking` contained ZERO references to
// `breakfastSelections` / `otherAddOnSelections`. The breakfast
// total carried forward verbatim and the selection keys kept the OLD
// dates.
//
// A guest booked Oct 14–17 with three paid breakfasts, then
// rescheduled to Oct 20–23: `breakfastTotal` carried forward (still
// charged), the selection keys still said `2026-10-14…`, and the
// kitchen list for Oct 20 showed nothing — the guest was charged
// for three breakfasts that were never served.
//
// THE FIX
//
// `shared/utils/bookingAddOnReschedule.ts` holds the pure re-dating
// logic (behaviourally tested in
// `shared/__tests__/oct-h8-addon-redate.test.ts`). This file pins
// the SERVER WIRING: the reschedule + cancel paths call it, persist
// the re-dated selections, and open the refund liabilities the spec
// requires.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const code = codeOnly(handlerSrc);

const reschedule = code.slice(
  code.indexOf("export async function handleRescheduleBooking"),
  code.indexOf("export async function handleExtendStay")
);

const cancel = code.slice(
  code.indexOf("export async function handleCancelBooking"),
  code.indexOf("export async function handleAddRoomToReservation")
);

describe("OCT-H8 — the reschedule re-dates the add-on selections", () => {
  it("calls the shared re-dating helpers", () => {
    expect(handlerSrc).toMatch(/redateBreakfastSelections/);
    expect(handlerSrc).toMatch(/redateOtherAddOnSelections/);
  });

  it("re-dates in `reschedule` mode against the NEW window", () => {
    expect(reschedule).toMatch(
      /redateBreakfastSelections\(\{\s*mode:\s*"reschedule"[\s\S]{0,300}?window:\s*\{\s*checkIn,\s*checkOut\s*\}/
    );
    expect(reschedule).toMatch(
      /redateOtherAddOnSelections\(\{\s*mode:\s*"reschedule"[\s\S]{0,300}?window:\s*\{\s*checkIn,\s*checkOut\s*\}/
    );
  });

  it("persists the re-dated selections + totals on the booking doc", () => {
    expect(reschedule).toMatch(/breakfastSelections:\s*redatedBreakfast\.selections/);
    expect(reschedule).toMatch(/breakfastTotal:\s*redatedBreakfast\.total/);
    expect(reschedule).toMatch(/hasAnyBreakfast:\s*redatedBreakfast\.total\s*>\s*0/);
    expect(reschedule).toMatch(/otherAddOnSelections:\s*redatedOtherAddOns\.selections/);
    expect(reschedule).toMatch(/otherAddOnTotal:\s*redatedOtherAddOns\.total/);
    expect(reschedule).toMatch(/hasAnyOtherAddOns:\s*redatedOtherAddOns\.total\s*>\s*0/);
  });

  it("the pricing total uses the RE-DATED breakfast total (not the carried-forward one)", () => {
    // The audit's core complaint: "the guest is charged for three
    // breakfasts that are never served."
    expect(reschedule).toMatch(
      /const breakfastTotal = manualNightlyRate === null\s*\n\s*\?\s*redatedBreakfast\.total\s*\n\s*:\s*0;/
    );
    expect(reschedule).not.toMatch(
      /const breakfastTotal = manualNightlyRate === null\s*\n\s*\?\s*Number\(booking\.breakfastTotal\)/
    );
  });

  it("writes an audit entry + a refund liability for each removed selection", () => {
    expect(reschedule).toMatch(
      /for \(const removed of redatedBreakfast\.removed\) \{[\s\S]{0,2000}?auditBreakfastOp\(/
    );
    expect(reschedule).toMatch(
      /for \(const removed of redatedBreakfast\.removed\) \{[\s\S]{0,4000}?createBreakfastRefundLiability\(/
    );
    expect(reschedule).toMatch(
      /for \(const removed of redatedOtherAddOns\.removed\) \{[\s\S]{0,2000}?auditOtherAddOnOp\(/
    );
    expect(reschedule).toMatch(
      /for \(const removed of redatedOtherAddOns\.removed\) \{[\s\S]{0,4000}?createOtherAddOnRefundLiability\(/
    );
  });

  it("the liability is opened only for the PAID removals", () => {
    expect(reschedule).toMatch(/if \(removed\.wasPaid\) \{[\s\S]{0,400}?createBreakfastRefundLiability\(/);
  });
});

describe("OCT-H8 — the cancel path drops the future selections", () => {
  it("has a dedicated cancel re-dating helper", () => {
    expect(handlerSrc).toMatch(/function redateAddOnsForCancel\(/);
    expect(code).toMatch(
      /redateBreakfastSelections\(\{\s*mode:\s*"cancel"/
    );
    expect(code).toMatch(
      /redateOtherAddOnSelections\(\{\s*mode:\s*"cancel"/
    );
  });

  it("is called from BOTH cancel branches (reservation scope + per-booking)", () => {
    const calls = cancel.match(/redateAddOnsForCancel\(\{/g) || [];
    // One in the reservation-scope branch + one in the per-booking
    // branch.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("persists the re-dated selections on the cancelled booking", () => {
    expect(cancel).toMatch(/bookingUpdate\.breakfastSelections = perChildRedated\.breakfastSelections/);
    expect(cancel).toMatch(/bookingUpdate\.breakfastTotal = perChildRedated\.breakfastTotal/);
    expect(cancel).toMatch(/bookingUpdate\.otherAddOnSelections = perChildRedated\.otherAddOnSelections/);
    expect(cancel).toMatch(/bookingUpdate\.otherAddOnTotal = perChildRedated\.otherAddOnTotal/);
  });

  it("the reservation-scope branch re-dates each cancelled child", () => {
    expect(cancel).toMatch(
      /for \(const child of children\) \{[\s\S]{0,400}?if \(!cancellableIds\.has\(child\.id\)\) continue;[\s\S]{0,800}?redateAddOnsForCancel\(/
    );
  });

  it("the liability is guarded against the policy refund double-count", () => {
    // The CRL-07 policy refund is a PERCENTAGE OF THE COLLECTED
    // MONEY, and the collected money already includes the add-ons —
    // so a second add-on liability would refund the same meal
    // twice. The liability is opened only when the policy refunded
    // nothing.
    expect(handlerSrc).toMatch(
      /policyRefunded:\s*cancelPolicyRefunded/
    );
    expect(handlerSrc).toMatch(
      /const cancelPolicyRefunded = Boolean\(\s*liabilitySnapshot && Number\(liabilitySnapshot\.policyResult\?\.policyRefund\) > 0\s*\)/
    );
    expect(code).toMatch(
      /if \(removed\.wasPaid && !input\.policyRefunded\) \{[\s\S]{0,400}?createBreakfastRefundLiability\(/
    );
  });

  it("the cancel path does NOT rewrite `totalPrice` (the policy liability covers the bill)", () => {
    // The cancel path never rewrote the total — the CRL-07 policy
    // liability is computed from the collected amount. Rewriting it
    // would shrink the policy refund.
    const cancelBookingUpdate = cancel.slice(
      cancel.indexOf("const bookingUpdate: Record<string, any> = {"),
      cancel.indexOf("transaction.update(bookingDocumentRef, bookingUpdate)")
    );
    expect(cancelBookingUpdate).not.toMatch(/totalPrice:/);
  });
});
