// Per OCT-H1 (2026-10-20, decision #282): the guest Manage path
// and the STAFF update path must compute the balance the same way.
//
// The staff path still used the pre-OCT-H1 formula
// (`totalPrice + newBreakfastTotal - paidAmount`), which charges
// the guest for the breakfast TWICE: per BR-01 / BR-03 the
// booking's `totalPrice` already contains the original breakfast.
//
// Both paths now route through the shared helper
// `computeBreakfastAdjustedTotalPrice` — the single source of
// truth for that arithmetic.
//
// The BR-12 other add-ons are a separate concern: per
// OCT-FOL-01 (2026-10-20, decision #298) they are NOT inside
// `totalPrice` — they sit on top of the room bill for the balance,
// so the staff add-on path must NOT move `totalPrice` (and must
// not re-snapshot the MRB-11 allocation, which covers the room
// bill only).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const staffBreakfastSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-staff-update.ts"),
  "utf8"
);
const guestBreakfastSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-manage.ts"),
  "utf8"
);
const staffAddOnsSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-staff-update.ts"),
  "utf8"
);

describe("OCT-H1 — the staff and the guest compute the balance the same way", () => {
  it("the staff path uses the shared helper (not the pre-OCT-H1 double-count formula)", () => {
    expect(staffBreakfastSrc).toMatch(
      /computeBreakfastAdjustedTotalPrice\(\{[\s\S]{0,200}?breakfastInTotalPrice,[\s\S]{0,120}?breakfastTotal:\s*newBreakfastTotal/
    );
    // The pre-fix double-counting formula must be gone.
    expect(staffBreakfastSrc).not.toMatch(
      /totalPriceNum \+ newBreakfastTotal - paidAmountNum/
    );
    expect(staffBreakfastSrc).toMatch(
      /import\s*\{[\s\S]*?computeBreakfastAdjustedTotalPrice[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("the guest path uses the same shared helper", () => {
    expect(guestBreakfastSrc).toMatch(
      /computeBreakfastAdjustedTotalPrice\(\{[\s\S]{0,200}?breakfastInTotalPrice,[\s\S]{0,120}?breakfastTotal:/
    );
    expect(guestBreakfastSrc).toMatch(
      /import\s*\{[\s\S]*?computeBreakfastAdjustedTotalPrice[\s\S]*?\}\s*from\s*["']@spark-inn\/shared["']/
    );
  });

  it("both paths anchor on the create-time rate breakdown", () => {
    for (const [name, src] of [
      ["staff", staffBreakfastSrc],
      ["guest", guestBreakfastSrc]
    ] as const) {
      expect(src, `${name} path must read the anchor`).toMatch(
        /sumBreakfastRateLines\(\s*\(booking as any\)\.rateBreakdown/
      );
    }
  });
});

describe("BR-12 — the staff add-on path does not move the room bill", () => {
  it("does not write totalPrice (decision #298: the add-ons sit on top of the room bill)", () => {
    // The other add-ons are NOT inside `totalPrice` — they are
    // added on top of it for the balance. The MRB-11 revenue
    // allocation covers the ROOM BILL only, so the allocation must
    // not be re-snapshotted either (its `totalNet` is the room
    // bill's `totalPrice`).
    expect(staffAddOnsSrc).not.toMatch(/transaction\.update\(bookingRef,\s*\{[\s\S]{0,400}?totalPrice:/);
    expect(staffAddOnsSrc).not.toMatch(/transaction\.update\(bookingRef,\s*\{[\s\S]{0,400}?revenueAllocation:/);
  });

  it("persists the selections + the add-on total (the BR-12 fields)", () => {
    expect(staffAddOnsSrc).toMatch(
      /transaction\.update\(bookingRef,\s*\{\s*otherAddOnSelections:\s*next,[\s\S]{0,200}?otherAddOnTotal:\s*newTotal,[\s\S]{0,200}?hasAnyOtherAddOns:\s*newHasAny,/
    );
  });
});
