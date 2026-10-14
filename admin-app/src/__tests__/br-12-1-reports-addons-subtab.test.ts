// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the new
// Reports → Sales → Add-Ons sub-tab on
// `admin-app/src/pages/ReportsPage.tsx`. Source-text
// tripwires that pin the implementation contracts:
//
//   1. The `SalesSubTab` type union gains "addons".
//   2. The sub-tab nav includes the "Add-Ons" button
//      with the BR-12.1 testid.
//   3. The new `addons` sub-tab renders 5 metric
//      cards (total selections, total revenue,
//      late-change count, pending refund liability,
//      booking count) + a top-add-ons bar chart +
//      the per-booking detail table.
//   4. The metrics subscribe to the right live data
//      sources: `bookings/*/otherAddOnAudit/*`
//      (late-change) + `bookings/*/refunds/*` with
//      `category: "otherAddOn"` (pending refund).
//   5. The metrics pre-compute top-add-ons by revenue
//      (the chart's data source).
//   6. The per-booking detail table is the
//      `SalesOtherAddOnsTable` component.
//   7. The `otherAddOnsBookingsInRange` filter +
//      `otherAddOnsMetrics` memo live in the same
//      scope as the breakfast metrics block.
//   8. The SalesTab prop interface + destructure +
//      call site all carry the new BR-12.1 props.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const reportsPage = read("admin-app/src/pages/ReportsPage.tsx");

describe("BR-12.1 — Reports → Sales → Add-Ons sub-tab (Surface 4)", () => {
  describe("wiring", () => {
    it("the SalesSubTab type union gains 'addons'", () => {
      expect(reportsPage).toMatch(/type SalesSubTab = "bookings" \| "breakfast" \| "addons" \| "store" \| "charges"/);
    });

    it("the Sales sub-tab nav includes the 'Add-Ons' button", () => {
      expect(reportsPage).toMatch(/sales-subtab-\$\{tab\}/);
      expect(reportsPage).toMatch(/"addons"\s*\?\s*"Add-Ons"/);
    });

    it("the tab nav uses a 5-column grid on sm+ screens", () => {
      expect(reportsPage).toMatch(/sm:grid-cols-5/);
    });
  });

  describe("metrics + chart + table", () => {
    it("the addons sub-tab block renders with the BR-12.1 testid", () => {
      expect(reportsPage).toContain('data-testid="sales-addons-subtab"');
    });

    it("the 5 metric cards each have a stable testid", () => {
      expect(reportsPage).toContain('data-testid="addons-metric-total-selections"');
      expect(reportsPage).toContain('data-testid="addons-metric-total-revenue"');
      expect(reportsPage).toContain('data-testid="addons-metric-late-change"');
      expect(reportsPage).toContain('data-testid="addons-metric-pending-refund"');
      expect(reportsPage).toContain('data-testid="addons-metric-booking-count"');
    });

    it("the top-add-ons bar chart renders through recharts", () => {
      expect(reportsPage).toMatch(/sales-addons-subtab[\s\S]{0,15000}BarChart/);
      expect(reportsPage).toMatch(/<Bar dataKey="revenue"/);
    });

    it("the per-booking detail table is the `SalesOtherAddOnsTable` component", () => {
      expect(reportsPage).toMatch(/function SalesOtherAddOnsTable\(/);
    });

    it("the empty-state has the BR-12.1 testid", () => {
      expect(reportsPage).toContain('data-testid="sales-addons-table-empty"');
    });
  });

  describe("live data sources", () => {
    it("the late-change count subscribes to the BR-12 `otherAddOnAudit` collectionGroup", () => {
      expect(reportsPage).toMatch(/collectionGroup\(db, "otherAddOnAudit"\)/);
      expect(reportsPage).toMatch(/occurredAfterCutoff\s*===\s*true/);
    });

    it("the pending refund total filters for `category: 'otherAddOn' + status: 'pending'`", () => {
      expect(reportsPage).toMatch(/category.*===.*"otherAddOn"[\s\S]{0,200}status.*===.*"pending"/);
    });

    it("the metric state lives in the main scope (otherAddOnLateChangeCount + otherAddOnPendingRefundTotal)", () => {
      expect(reportsPage).toMatch(/const \[otherAddOnLateChangeCount, setOtherAddOnLateChangeCount\] = useState\(0\)/);
      expect(reportsPage).toMatch(/const \[otherAddOnPendingRefundTotal, setOtherAddOnPendingRefundTotal\] = useState\(0\)/);
    });
  });

  describe("metric computation", () => {
    it("the `otherAddOnsBookingsInRange` filter targets `hasAnyOtherAddOns === true`", () => {
      expect(reportsPage).toMatch(/const otherAddOnsBookingsInRange = useMemo\(\s*\(\) => rangeBookings\.filter\(\(b: any\) => b\.hasAnyOtherAddOns === true\)/);
    });

    it("the `otherAddOnsMetrics` memo computes totalSelections + totalRevenue + topAddOns", () => {
      expect(reportsPage).toMatch(/const otherAddOnsMetrics = useMemo\(\(\) => \{/);
      expect(reportsPage).toContain("totalSelections");
      expect(reportsPage).toContain("totalRevenue");
      expect(reportsPage).toContain("topAddOns");
    });

    it("the top-5 add-on sort key is `revenue` desc", () => {
      expect(reportsPage).toMatch(/topAddOns = Array\.from\([\s\S]{0,200}\.sort\(\(a, b\) => b\.revenue - a\.revenue\)/);
      expect(reportsPage).toMatch(/\.slice\(0, 5\)/);
    });
  });

  describe("SalesTab prop + call-site wiring", () => {
    it("the SalesTab function props include the BR-12.1 metrics", () => {
      // The interface is the line right above the
      // function; we anchor on a couple of the unique
      // prop names.
      expect(reportsPage).toMatch(/otherAddOnsBookingsInRange:\s*Array<any>;/);
      expect(reportsPage).toMatch(/otherAddOnsMetrics:\s*\{/);
      expect(reportsPage).toMatch(/otherAddOnLateChangeCountValue:\s*number;/);
      expect(reportsPage).toMatch(/otherAddOnPendingRefundTotalValue:\s*number;/);
    });

    it("the SalesTab destructure includes the BR-12.1 props", () => {
      expect(reportsPage).toMatch(/otherAddOnsBookingsInRange,\s*otherAddOnsMetrics,\s*otherAddOnLateChangeCountValue,\s*otherAddOnPendingRefundTotalValue,/);
    });

    it("the <SalesTab /> call site passes the new props", () => {
      expect(reportsPage).toContain("otherAddOnsBookingsInRange={otherAddOnsBookingsInRange}");
      expect(reportsPage).toContain("otherAddOnsMetrics={otherAddOnsMetrics}");
      expect(reportsPage).toContain("otherAddOnLateChangeCountValue={otherAddOnLateChangeCountValue}");
      expect(reportsPage).toContain("otherAddOnPendingRefundTotalValue={otherAddOnPendingRefundTotalValue}");
    });
  });
});
