import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");
const statsCardSrc = readFileSync(resolve(__dirname, "../components/StatsCard.tsx"), "utf8");

describe("Dashboard revenue info controls", () => {
  it("explains the revenue calculation in a tooltip", () => {
    expect(dashboardSrc).toMatch(/revenueHelpText/);
    expect(dashboardSrc).toMatch(/sum of totalPrice/);
    expect(dashboardSrc).toMatch(/booking value, not cash collected/);
    expect(statsCardSrc).toMatch(/helpText/);
    expect(statsCardSrc).toMatch(/helpOpen/);
    expect(statsCardSrc).toMatch(/setHelpOpen/);
    expect(statsCardSrc).toMatch(/role="tooltip"/);
    expect(statsCardSrc).toMatch(/aria-expanded=\{helpOpen\}/);
  });

  it("hides revenue by default with bullets and lets staff reveal it", () => {
    expect(dashboardSrc).toMatch(/useState\(false\)/);
    expect(dashboardSrc).toMatch(/setShowRevenue/);
    expect(dashboardSrc).toMatch(/Hide dashboard revenue/);
    expect(dashboardSrc).toMatch(/Show dashboard revenue/);
    expect(dashboardSrc).toMatch(/showRevenue \? formatPrice\(monthlyRevenue\) : `\$\{config\.currencySymbol\}•••••`/);
  });
});
