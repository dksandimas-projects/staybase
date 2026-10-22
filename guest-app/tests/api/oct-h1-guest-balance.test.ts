// Per OCT-H1 (2026-10-20, decision #282): the guest-facing
// "Manage Breakfast" balance double-counted the breakfast.
//
// `booking.totalPrice` already CONTAINS the breakfast (per BR-01 /
// BR-03 the create transaction computes `subtotal = roomTotal +
// breakfastTotal + extraBedTotal`). The BR-04 manage path computed
// the balance as `totalPrice + recomputedTotal - paidAmount`, which
// added the breakfast a SECOND time — so a guest who had booked and
// paid for a ₱500 breakfast saw a ₱500 balance.
//
// The fix subtracts the breakfast already inside `totalPrice` before
// adding the current one. The anchor is the booking's
// `rateBreakdown.addOns[]` (snapshotted at create, preserved
// verbatim by `rebuildRateBreakdown`) — NOT `booking.breakfastTotal`,
// which the manage path overwrites on every write.
//
// The behavioural half of this regression (the helper itself) lives
// in `shared/__tests__/oct-h1-breakfast-rate-lines.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-manage.ts"),
  "utf8"
);

/** Strip comments so the pins match CODE only. */
function codeOnly(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = codeOnly(handlerSrc);

describe("OCT-H1 — the guest balance does not double-count the breakfast", () => {
  it("imports the shared breakfast-line helper", () => {
    expect(handlerSrc).toMatch(/sumBreakfastRateLines/);
  });

  it("the GET path subtracts the breakfast already inside `totalPrice`", () => {
    // The formula is
    //   (totalPrice - breakfastInTotalPrice + recomputedTotal) - paidAmount
    // and NOT `totalPrice + recomputedTotal - paidAmount`.
    //
    // Per the P1 revenue-reporting audit (2026-10-22) the
    // arithmetic was EXTRACTED into the shared helper
    // `computeBreakfastAdjustedTotalPrice` (in
    // `shared/utils/breakfastTotal.ts`) so the guest path and the
    // staff update path can never disagree about the same
    // booking. The helper's own behaviour is pinned in
    // `shared/__tests__/breakfast-adjusted-total-price.test.ts`.
    expect(code).toMatch(
      /computeBreakfastAdjustedTotalPrice\(\{[\s\S]{0,200}?breakfastInTotalPrice,[\s\S]{0,120}?breakfastTotal:\s*recomputedTotal/
    );
    expect(code).not.toMatch(
      /totalPrice\s*\+\s*recomputedTotal\s*-\s*paidAmount/
    );
  });

  it("the update path subtracts the breakfast already inside `totalPrice`", () => {
    expect(code).toMatch(
      /computeBreakfastAdjustedTotalPrice\(\{[\s\S]{0,200}?breakfastInTotalPrice,[\s\S]{0,120}?breakfastTotal:\s*newBreakfastTotal/
    );
  });

  it("anchors on the rate breakdown (not on `booking.breakfastTotal`)", () => {
    // `booking.breakfastTotal` is OVERWRITTEN by this very
    // handler on every write, so it cannot be the anchor for "the
    // breakfast that is already inside totalPrice".
    const anchorMatches = code.match(/sumBreakfastRateLines\(/g) || [];
    expect(anchorMatches.length).toBeGreaterThanOrEqual(2);
    expect(code).toMatch(/rateBreakdown/);
  });

  it("the shared folio does NOT subtract the breakfast twice", () => {
    // The shared folio (`shared/utils/bookingFolio.ts`) was
    // verified correct — it never re-adds the breakfast. This
    // pins that so a future change does not "fix" the same bug in
    // two places.
    const folioSrc = readFileSync(
      resolve(__dirname, "../../../shared/utils/bookingFolio.ts"),
      "utf8"
    );
    const folioCode = codeOnly(folioSrc);
    expect(folioCode).not.toMatch(/recomputeBreakfastTotal\([^)]*\)\s*\+/);
    expect(folioCode).not.toMatch(/breakfastTotal\s*\+\s*breakfastTotal/);
  });

  it("the other add-on balance is untouched (other add-ons are NOT inside `totalPrice`)", () => {
    // `guest-app/server/handlers/addons-manage.ts` adds the other
    // add-on total ON TOP of `totalPrice` — which is correct,
    // because the other add-ons are not part of the stored total.
    // This fix must not have changed that.
    const addonsSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/addons-manage.ts"),
      "utf8"
    );
    const addonsCode = codeOnly(addonsSrc);
    expect(addonsCode).toMatch(/totalPrice[^;]*\+\s*otherAddOnTotal/);
  });
});
