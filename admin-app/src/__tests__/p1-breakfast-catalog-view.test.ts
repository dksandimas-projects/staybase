// P0-9 follow-on (2026-10-22) — the BREAKFAST catalog surface.
//
// The add-on surfaces got the "a failed read is never rendered as an
// empty catalog" treatment in v2.18.18 (decision #314). The drawer's
// **Breakfast** tab and the walk-in breakfast grid had the SAME defect
// and were not fixed at the time:
//
//   - A network error / non-200 / unparseable body left `config` null,
//     which fell through to the "Breakfast is not enabled" gate — so the
//     staff were told to go change a setting that was already correct.
//   - The grid fetched once on mount and never again, so one transient
//     failure pinned that message until the whole page was reloaded.
//
// The rule now lives in a PURE resolver
// (`admin-app/src/utils/breakfastCatalogView.ts`) and is asserted here
// behaviourally, so it cannot regress the way the silent catch did.
//
// Every behavioural test below FAILS against the pre-fix rendering
// (a failed read fell through to the "not enabled" branch).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BREAKFAST_CATALOG_LOAD_ERROR,
  resolveBreakfastCatalogView
} from "../utils/breakfastCatalogView";

const SRC = join(__dirname, "..");

const drawer = readFileSync(
  join(SRC, "components", "BookingDrawerWorkspace.tsx"),
  "utf8"
);
const walkinGrid = readFileSync(
  join(SRC, "components", "breakfast", "WalkinBreakfastGrid.tsx"),
  "utf8"
);

const ENABLED = { isEnabled: true, meals: [{ id: "tapsilog", name: "Tapsilog" }] };
const DISABLED = { isEnabled: false, meals: [] };

describe("P0-9 — a failed breakfast read is never rendered as 'not enabled'", () => {
  it("a failed read resolves to the error state, not to disabled", () => {
    const view = resolveBreakfastCatalogView({
      loading: false,
      error: BREAKFAST_CATALOG_LOAD_ERROR,
      config: null
    });

    expect(view.kind).toBe("error");
    expect(view.kind === "error" && view.message).toBe(BREAKFAST_CATALOG_LOAD_ERROR);
  });

  it("a successful read that says the service is off resolves to disabled", () => {
    const view = resolveBreakfastCatalogView({
      loading: false,
      error: null,
      config: DISABLED
    });

    expect(view.kind).toBe("disabled");
  });

  it("a successful read with the service on resolves to ready", () => {
    const view = resolveBreakfastCatalogView({
      loading: false,
      error: null,
      config: ENABLED
    });

    expect(view.kind).toBe("ready");
    expect(view.kind === "ready" && view.config.isEnabled).toBe(true);
  });

  it("a read in flight resolves to loading, whatever the other fields say", () => {
    const view = resolveBreakfastCatalogView({
      loading: true,
      error: BREAKFAST_CATALOG_LOAD_ERROR,
      config: ENABLED
    });

    expect(view.kind).toBe("loading");
  });

  it("a successful read with NO config is a failed read, not a disabled service", () => {
    // The endpoint answered, but without the expected `data` envelope.
    // That is not evidence that the hotel turned breakfast off.
    const view = resolveBreakfastCatalogView({
      loading: false,
      error: null,
      config: null
    });

    expect(view.kind).toBe("error");
  });

  it("a config with no `isEnabled` field is treated as ON, not off", () => {
    // The endpoint omits `isEnabled` only when the service is on; an
    // absent flag must never be read as "switched off".
    const noFlag = { meals: [] } as { isEnabled?: boolean; meals: unknown[] };
    const view = resolveBreakfastCatalogView({
      loading: false,
      error: null,
      config: noFlag
    });

    expect(view.kind).toBe("ready");
  });
});

describe("P0-9 — the breakfast surfaces wire the resolver and can retry", () => {
  it("the drawer resolves its view through the shared resolver", () => {
    expect(drawer).toMatch(/resolveBreakfastCatalogView\(/);
    expect(drawer).toMatch(/BREAKFAST_CATALOG_LOAD_ERROR/);
  });

  it("the drawer renders the error branch BEFORE the disabled branch", () => {
    // Order is the invariant: if the disabled branch came first, a
    // failed read would render "Breakfast is not enabled" again.
    const errorAt = drawer.indexOf('data-testid="booking-drawer-breakfast-error"');
    const disabledAt = drawer.indexOf('data-testid="booking-drawer-breakfast-disabled"');
    expect(errorAt).toBeGreaterThan(-1);
    expect(disabledAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(disabledAt);
  });

  it("the drawer's breakfast fetch re-runs on retry instead of only on mount", () => {
    expect(drawer).toMatch(/\}, \[configRetryToken\]\)/);
  });

  it("the drawer's breakfast catch sets an error instead of swallowing it", () => {
    // The FIRST occurrence of the URL in this file is in a comment; the
    // fetch is the LAST one.
    const at = drawer.lastIndexOf("/api/bookings/breakfast/config");
    const region = drawer.slice(at - 900, at + 2200);
    expect(region).not.toMatch(/catch \{\s*\/\/ silent/);
    expect(region).toMatch(/setConfigError\(BREAKFAST_CATALOG_LOAD_ERROR\)/);
  });

  it("the drawer reads the config from the `data` envelope, not `addOns`", () => {
    // The breakfast endpoint answers `{ success, data: {...} }`. The
    // add-on endpoint answers `{ success, addOns: [...] }`. Reading
    // `data.data` on the add-on endpoint is the P0-8 defect.
    const at = drawer.lastIndexOf("/api/bookings/breakfast/config");
    const region = drawer.slice(at - 300, at + 1600);
    expect(region).toMatch(/data\?\.data/);
    expect(region).not.toMatch(/data\?\.addOns/);
  });

  it("the walk-in grid resolves its view through the shared resolver", () => {
    expect(walkinGrid).toMatch(/resolveBreakfastCatalogView\(/);
    expect(walkinGrid).toMatch(/BREAKFAST_CATALOG_LOAD_ERROR/);
  });

  it("the walk-in grid re-runs on retry instead of only on mount", () => {
    expect(walkinGrid).toMatch(/\}, \[configRetryToken\]\)/);
  });

  it("the walk-in grid's catch sets an error instead of swallowing it", () => {
    expect(walkinGrid).not.toMatch(/catch \{\s*\/\/ Silent — keep null/);
    expect(walkinGrid).toMatch(/setConfigError\(BREAKFAST_CATALOG_LOAD_ERROR\)/);
  });
});
