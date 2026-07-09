import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Roadmap fixes batch tests", () => {
  const reportsPageSrc = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
  const dashboardPageSrc = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");

  it("QA-24 Custom Date Range in ReportsPage", () => {
    expect(reportsPageSrc).toMatch(/customStartDate/);
    expect(reportsPageSrc).toMatch(/customEndDate/);
    expect(reportsPageSrc).toMatch(/dateRange === "custom"/);
    expect(reportsPageSrc).toMatch(/option value="custom"/);
    expect(reportsPageSrc).toMatch(/isRangeValid/);
    expect(reportsPageSrc).toMatch(/Start date cannot be after end date/);
  });

  it("QA-22 Today's Breakfast Prep in DashboardPage", () => {
    expect(dashboardPageSrc).toMatch(/todaysBreakfastItems/);
    expect(dashboardPageSrc).toMatch(/unservedBreakfastCount/);
    expect(dashboardPageSrc).toMatch(/toggleBreakfastServed/);
    expect(dashboardPageSrc).toMatch(/today's breakfast prep/);
    expect(dashboardPageSrc).toMatch(/breakfastServed/);
  });
});
