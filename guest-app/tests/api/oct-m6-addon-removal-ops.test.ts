// Per AI-BROWSER-QA (2026-10-25, scenario AO-08): a guest who LOWERS an
// other add-on's quantity to zero must get a clean removal — not a false
// failure.
//
// The bug: the guest Manage Other Add-Ons page assembled its save batch
// inline and emitted BOTH a `change` op with quantity 0 AND a `remove` op
// for the same line. The server processes REMOVEs first and CHANGEs
// second, so the change op landed on a selection the remove had already
// taken away and failed with SELECTION_NOT_ORDERED. The guest saw "Nothing
// to change — add the add-on first." — for a removal that HAD been
// applied.
//
// This file pins the BEHAVIOUR (runtime assertions against the shared
// helper) and the WIRING (source-text guards — the guest page and the
// server handler cannot be mounted here, the repo has no jsdom/RTL
// harness for them).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOtherAddOnManageOps, type OtherAddOnDraftCatalogRow } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const managePageSrc = read("guest-app/src/pages/ManageOtherAddOnsPage.tsx");
const manageSaveSrc = read("guest-app/server/handlers/addons-manage-save.ts");

const CATALOG: OtherAddOnDraftCatalogRow[] = [
  {
    id: "airport-transfer",
    name: "Airport transfer",
    description: "One way airport pickup.",
    price: 500,
    unit: "per-person",
    isEnabled: true,
    cutoffHoursBeforeCheckIn: 24
  }
];

const DATE = "2027-01-25";

function entry(overrides: Record<string, any> = {}) {
  return {
    addOnId: "airport-transfer",
    nameSnapshot: "Airport transfer",
    priceSnapshot: 500,
    quantity: 1,
    unitSnapshot: "per-person",
    addedAt: "2026-10-25T00:00:00.000Z",
    addedBy: "guest",
    lastModifiedAt: "2026-10-25T00:00:00.000Z",
    lastModifiedBy: "guest",
    removedAt: null,
    removedBy: null,
    cutoffHoursBeforeCheckInSnapshot: 24,
    ...overrides
  } as any;
}

describe("AO-08 — the guest add-on save batch (runtime behaviour)", () => {
  it("a quantity of 0 produces a REMOVE and NO change op", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 1 })] },
      draft: { [DATE]: [entry({ quantity: 0 })] },
      catalog: CATALOG
    });

    expect(ops.remove.map((o) => o.selectionKey)).toEqual([`${DATE}-airport-transfer`]);
    expect(ops.change, "a removal must never also be sent as a change").toEqual([]);
    expect(ops.add).toEqual([]);
  });

  it("a lowered quantity produces a CHANGE op and no remove op", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 2 })] },
      draft: { [DATE]: [entry({ quantity: 1 })] },
      catalog: CATALOG
    });

    expect(ops.change).toHaveLength(1);
    expect(ops.change[0].quantity).toBe(1);
    expect(ops.remove).toEqual([]);
    expect(ops.add).toEqual([]);
  });

  it("an unchanged line produces no op at all", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 1 })] },
      draft: { [DATE]: [entry({ quantity: 1 })] },
      catalog: CATALOG
    });

    expect(ops.add).toEqual([]);
    expect(ops.change).toEqual([]);
    expect(ops.remove).toEqual([]);
  });

  it("a line the server does not hold produces an ADD op", () => {
    const ops = buildOtherAddOnManageOps({
      original: {},
      draft: { [DATE]: [entry({ quantity: 1 })] },
      catalog: CATALOG
    });

    expect(ops.add).toHaveLength(1);
    expect(ops.add[0].priceSnapshot).toBe(500);
    expect(ops.add[0].unitSnapshot).toBe("per-person");
    expect(ops.change).toEqual([]);
    expect(ops.remove).toEqual([]);
  });

  it("a line the draft dropped entirely produces a REMOVE op", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 1 })] },
      draft: { [DATE]: [] },
      catalog: CATALOG
    });

    expect(ops.remove).toHaveLength(1);
    expect(ops.change).toEqual([]);
  });

  it("a line the guest removed in the draft produces a REMOVE op and no change op", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 1 })] },
      draft: { [DATE]: [entry({ quantity: 1, removedAt: "2026-10-25T01:00:00.000Z" })] },
      catalog: CATALOG
    });

    expect(ops.remove).toHaveLength(1);
    expect(ops.change).toEqual([]);
  });

  it("a line already removed on the server can be ordered again", () => {
    const ops = buildOtherAddOnManageOps({
      original: { [DATE]: [entry({ quantity: 1, removedAt: "2026-10-01T00:00:00.000Z" })] },
      draft: { [DATE]: [entry({ quantity: 1 })] },
      catalog: CATALOG
    });

    expect(ops.add).toHaveLength(1);
    expect(ops.remove).toEqual([]);
    expect(ops.change).toEqual([]);
  });
});

describe("AO-08 — the wiring (source-text tripwires)", () => {
  it("the guest page assembles its batch with the shared helper", () => {
    expect(managePageSrc).toMatch(/buildOtherAddOnManageOps/);
  });

  it("the guest page no longer assembles the batch inline", () => {
    expect(managePageSrc).not.toMatch(/changeOps\.push\(/);
    expect(managePageSrc).not.toMatch(/addOps\.push\(/);
    expect(managePageSrc).not.toMatch(/removeOps\.push\(/);
  });

  it("the server skips a redundant quantity-0 change op on a removed selection", () => {
    expect(manageSaveSrc).toMatch(/changeQuantity === 0/);
    expect(manageSaveSrc).toMatch(/existingSelection\.removedAt/);
  });

  it("the server still processes removals before changes", () => {
    expect(manageSaveSrc.indexOf("// 1) REMOVEs first.")).toBeLessThan(
      manageSaveSrc.indexOf("// 3) CHANGEs.")
    );
  });
});
