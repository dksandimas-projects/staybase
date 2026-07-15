import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");

describe("Dashboard pending-payment actions", () => {
  it("uses a compact responsive action bar with a clear primary action", () => {
    expect(dashboardSrc).toMatch(/grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end/);
    expect(dashboardSrc).toMatch(/col-span-2 inline-flex min-h-\[44px\].*sm:col-auto/);
    expect(dashboardSrc).toMatch(/title="View payment proof"/);
    expect(dashboardSrc).toMatch(/title="Reject payment proof"/);
    expect(dashboardSrc).toMatch(/title="Confirm payment"/);
  });
});
