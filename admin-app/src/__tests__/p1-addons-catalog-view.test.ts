// P0-9 (2026-10-22) — the other-add-ons catalog surface.
//
// The owner reported, in the LIVE admin app, that the booking drawer's
// Add-Ons tab said:
//
//   "The add-on catalog is empty. Add a row in Settings → Other Add-Ons
//    to start selling add-ons."
//
// while the hotel's add-ons were ON and `GET /api/bookings/addons/config`
// was serving a row. The P0-8 fix (decision #313, v2.18.17) corrected the
// RESPONSE SHAPE the admin consumers read — the rows live under `addOns`,
// not under `data`.
//
// This suite covers the SECOND defect, the one that survived that fix and
// made the report impossible to act on:
//
//   **A FAILED READ WAS RENDERED AS AN EMPTY CATALOG.**
//
//   - A network error / non-200 / unparseable body left the catalog
//     `null`, which fell through to the empty branch. The staff were told
//     to go CREATE an add-on in Settings when the real problem was that
//     the REQUEST failed.
//   - The tab fetched ONCE on mount and never again, so a single
//     transient failure pinned that misleading copy until the whole page
//     was reloaded — clicking the tab again did nothing.
//
// The rule now lives in a PURE resolver
// (`admin-app/src/utils/addOnsCatalogView.ts`), so it is asserted
// behaviourally here instead of only observable in a running browser.
//
// Every behavioural test below FAILS against the pre-fix rendering
// (a failed read fell through to the empty branch).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADDONS_CATALOG_LOAD_ERROR,
  resolveAddOnsCatalogView
} from "../utils/addOnsCatalogView";
import type { OtherAddOnsCatalogRow } from "@spark-inn/shared";

const SRC = join(__dirname, "..");

const drawer = readFileSync(
  join(SRC, "components", "BookingDrawerWorkspace.tsx"),
  "utf8"
);
const walkinGrid = readFileSync(
  join(SRC, "components", "otherAddOns", "WalkinOtherAddOnGrid.tsx"),
  "utf8"
);
const handler = readFileSync(
  join(SRC, "..", "..", "guest-app", "server", "handlers", "addons-config.ts"),
  "utf8"
);

const ROW: OtherAddOnsCatalogRow = {
  id: "airport-transfer",
  name: "Airport transfer",
  description: "One-way airport pickup at TAG.",
  price: 500,
  unit: "per-person",
  cutoffHoursBeforeCheckIn: 24,
  displayOrder: 10
};

/** A window of source around the first occurrence of `needle`. */
function regionAround(src: string, needle: string, before = 800, after = 2200): string {
  const at = src.indexOf(needle);
  if (at === -1) throw new Error(`needle not found: ${needle}`);
  return src.slice(Math.max(0, at - before), at + after);
}

describe("P0-9 — a failed read is never rendered as an empty catalog", () => {
  it("a failed read resolves to the error state, not to empty", () => {
    const view = resolveAddOnsCatalogView({
      loading: false,
      error: ADDONS_CATALOG_LOAD_ERROR,
      catalog: null,
      enabled: true
    });

    expect(view.kind).toBe("error");
    expect(view.kind === "error" && view.message).toBe(ADDONS_CATALOG_LOAD_ERROR);
  });

  it("a failed read stays an error even when the switch says add-ons are on", () => {
    // This is the owner's exact case: the switch was ON, the request
    // failed, and the old code told the staff the catalog was empty.
    const view = resolveAddOnsCatalogView({
      loading: false,
      error: ADDONS_CATALOG_LOAD_ERROR,
      catalog: null,
      enabled: true
    });

    expect(view.kind).not.toBe("empty");
  });

  it("a failed read stays an error even when stale rows are on hand", () => {
    const view = resolveAddOnsCatalogView({
      loading: false,
      error: ADDONS_CATALOG_LOAD_ERROR,
      catalog: [ROW],
      enabled: true
    });

    expect(view.kind).toBe("error");
  });

  it("a successful read with no rows is empty — and says which empty it is", () => {
    const noRows = resolveAddOnsCatalogView({
      loading: false,
      error: null,
      catalog: [],
      enabled: true
    });
    expect(noRows.kind).toBe("empty");
    expect(noRows.kind === "empty" && noRows.reason).toBe("no-rows");

    const switchedOff = resolveAddOnsCatalogView({
      loading: false,
      error: null,
      catalog: [],
      enabled: false
    });
    expect(switchedOff.kind).toBe("empty");
    expect(switchedOff.kind === "empty" && switchedOff.reason).toBe("switched-off");
  });

  it("a successful read with rows renders the rows", () => {
    const view = resolveAddOnsCatalogView({
      loading: false,
      error: null,
      catalog: [ROW],
      enabled: true
    });

    expect(view.kind).toBe("rows");
    expect(view.kind === "rows" && view.rows).toHaveLength(1);
  });

  it("a read in flight resolves to loading, whatever the other fields say", () => {
    const view = resolveAddOnsCatalogView({
      loading: true,
      error: ADDONS_CATALOG_LOAD_ERROR,
      catalog: [ROW],
      enabled: true
    });

    expect(view.kind).toBe("loading");
  });
});

describe("P0-9 — the drawer wires the resolver and can retry", () => {
  it("the drawer resolves its view through the shared resolver", () => {
    expect(drawer).toMatch(/resolveAddOnsCatalogView\(/);
    expect(drawer).toMatch(/ADDONS_CATALOG_LOAD_ERROR/);
  });

  it("the drawer renders the error branch BEFORE the empty branch", () => {
    // Order is the invariant: if the empty branch came first, a failed
    // read would render "the catalog is empty" again.
    const errorAt = drawer.indexOf('data-testid="booking-drawer-addons-error"');
    const emptyAt = drawer.indexOf('data-testid="booking-drawer-addons-empty"');
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(emptyAt);
  });

  it("the drawer's catalog fetch re-runs on retry instead of only on mount", () => {
    // Pre-fix the effect deps were `[]` — one fetch, ever.
    expect(drawer).toMatch(/\}, \[catalogRetryToken\]\)/);
  });

  it("the drawer's catch sets an error instead of swallowing it", () => {
    // Scoped to the ADD-ONS fetch. The BREAKFAST tab's own fetch has the
    // same silent-catch pattern (a different feature, reported separately
    // as a follow-up), so a file-wide assertion would fail on that
    // unrelated block.
    const addOnsFetch = regionAround(drawer, "/api/bookings/addons/config");
    expect(addOnsFetch).not.toMatch(/catch \{\s*\/\/ silent/);
    expect(addOnsFetch).toMatch(/setCatalogError\(ADDONS_CATALOG_LOAD_ERROR\)/);
  });

  it("the drawer offers a retry that bumps the retry token", () => {
    expect(drawer).toMatch(/setCatalogRetryToken\(\(n\) => n \+ 1\)/);
    expect(drawer).toMatch(/Try again/);
  });

  it("the drawer no longer casts the public rows to the internal AddOn shape", () => {
    // The public payload carries no `isEnabled` / `updatedAt` /
    // `updatedBy`, so `as AddOn[]` was a lie that hid the fact that
    // `isEnabled` was `undefined` at runtime.
    expect(drawer).not.toMatch(/as AddOn\[\]/);
    expect(drawer).not.toMatch(/\} as AddOn,/);
  });
});

describe("P0-9 — the walk-in grid gets the same treatment", () => {
  it("the walk-in grid resolves its view through the shared resolver", () => {
    expect(walkinGrid).toMatch(/resolveAddOnsCatalogView\(/);
    expect(walkinGrid).toMatch(/ADDONS_CATALOG_LOAD_ERROR/);
  });

  it("the walk-in grid renders the error branch BEFORE the empty branch", () => {
    const errorAt = walkinGrid.indexOf('data-testid="walkin-addons-error"');
    const emptyAt = walkinGrid.indexOf('data-testid="walkin-addons-empty"');
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(emptyAt);
  });

  it("the walk-in grid re-runs on retry instead of only on mount", () => {
    expect(walkinGrid).toMatch(/\}, \[catalogRetryToken\]\)/);
  });

  it("the walk-in grid no longer casts the public rows to the internal AddOn shape", () => {
    expect(walkinGrid).not.toMatch(/as AddOn\[\]/);
  });
});

describe("P0-9 — the endpoint builds the payload through the shared contract", () => {
  it("the endpoint delegates the payload to the pure builder", () => {
    expect(handler).toMatch(/buildPublicAddOnsCatalog\(/);
  });

  it("the endpoint no longer derives preSeeded from the row's id", () => {
    // The pre-fix test (`length === 1 && id === "airport-transfer"`)
    // was ALSO true for a hotel that saved a real airport-transfer row.
    expect(handler).not.toMatch(/preSeeded:\s*rawAddOns\.length === 1/);
  });

  it("the endpoint tracks whether the fallback row was actually used", () => {
    expect(handler).toMatch(/const usedFallback = rawAddOns\.length === 0;/);
    expect(handler).toMatch(/usedFallback/);
  });
});
