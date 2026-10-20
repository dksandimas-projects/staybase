// Per OCT-C2 (2026-10-20, audit
// `plan/project/AUDIT-OCTOBER-2026.md`): the other-add-on
// snapshot fields must come from the LIVE catalog, never from
// the request.
//
// The pre-fix code was:
//   priceSnapshot: Math.max(0, Number(op.priceSnapshot ?? liveAddOn.price) || 0)
// The client ALWAYS sends `priceSnapshot`, so the `??` fallback
// could never fire and the CLIENT's price won. A guest could
// buy a ₱500 airport transfer for ₱1, and the tampered price
// was snapshotted permanently onto the booking (so a later
// "the catalog price changed after the order" check could not
// even detect it).
//
// The same anti-pattern also applied to `nameSnapshot`,
// `unitSnapshot` and — most importantly —
// `cutoffHoursBeforeCheckInSnapshot`, which is SECURITY
// relevant: it controls the lock window.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const guestSaveSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-manage-save.ts"),
  "utf8"
);
const staffUpdateSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-staff-update.ts"),
  "utf8"
);

const handlers: Array<[string, string]> = [
  ["addons-manage-save.ts", guestSaveSrc],
  ["addons-staff-update.ts", staffUpdateSrc]
];

/**
 * Strips line + block comments so the negative assertions below
 * match CODE only. The source files carry long explanatory
 * comments that quote the anti-pattern verbatim (e.g. "DO NOT
 * reintroduce `op.priceSnapshot ?? liveAddOn.price`") — matching
 * those would fail the tripwire for the wrong reason.
 */
function codeOnly(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("OCT-C2 — the other add-on price/name/unit/cutoff come from the catalog", () => {
  for (const [name, rawSrc] of handlers) {
    const src = codeOnly(rawSrc);

    describe(name, () => {
      it("never prefers the client's priceSnapshot over the catalog price", () => {
        // The exact anti-pattern. `op.priceSnapshot ?? liveAddOn.price`
        // looks defensive but is dead code: the client always sends
        // the field.
        expect(src).not.toMatch(/op\.priceSnapshot\s*\?\?/);
        expect(src).not.toMatch(/op\.priceSnapshot\s*\|\|/);
      });

      it("never prefers the client's nameSnapshot over the catalog name", () => {
        expect(src).not.toMatch(/op\.nameSnapshot\s*\|\|/);
      });

      it("never prefers the client's cutoff snapshot over the catalog cut-off", () => {
        // Security relevant: the cut-off is the lock window.
        expect(src).not.toMatch(/op\.cutoffHoursBeforeCheckInSnapshot\s*\?\?/);
        expect(src).not.toMatch(/op\.cutoffHoursBeforeCheckInSnapshot\s*\|\|/);
      });

      it("never prefers the client's unitSnapshot over the catalog unit", () => {
        expect(src).not.toMatch(/op\.unitSnapshot\s*\|\|/);
      });

      it("snapshots the live catalog price", () => {
        expect(src).toMatch(/priceSnapshot:\s*Math\.max\(0,\s*Number\(liveAddOn\.price\)\s*\|\|\s*0\)/);
      });

      it("snapshots the live catalog name", () => {
        expect(src).toMatch(/nameSnapshot:\s*liveAddOn\.name/);
      });

      it("snapshots the live catalog cut-off", () => {
        expect(src).toMatch(
          /cutoffHoursBeforeCheckInSnapshot:[\s\S]{0,200}Number\(liveAddOn\.cutoffHoursBeforeCheckIn\)/
        );
      });
    });
  }

  it("a CHANGE op keeps the entry's existing snapshot and only lets the quantity change", () => {
    // The guest may change the QUANTITY of an order they already
    // placed; they may not re-price it. The snapshot is
    // intentionally NOT re-read from the catalog on a change
    // (OTHER-ADD-ONS.md: the guest keeps the price they ordered
    // at, even if the admin changes the catalog price later).
    const guestCode = codeOnly(guestSaveSrc);
    expect(guestCode).toMatch(/nameSnapshot:\s*prior\.nameSnapshot/);
    expect(guestCode).toMatch(/priceSnapshot:\s*prior\.priceSnapshot/);
    expect(guestCode).toMatch(/unitSnapshot:\s*prior\.unitSnapshot/);
  });

  it("documents the advisory-only wire fields so the bug is not reintroduced", () => {
    expect(guestSaveSrc).toMatch(/ADVISORY ONLY/i);
    expect(staffUpdateSrc).toMatch(/ADVISORY ONLY/i);
  });
});
