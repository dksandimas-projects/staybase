import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");

describe("Dashboard pending-payment actions", () => {
  it("declares payment verification hooks before the loading return", () => {
    const verifyStateIndex = dashboardSrc.indexOf("const [verifyTarget, setVerifyTarget] = useState");
    const loadingReturnIndex = dashboardSrc.indexOf("if (dashboardLoading)");

    expect(verifyStateIndex).toBeGreaterThan(-1);
    expect(loadingReturnIndex).toBeGreaterThan(-1);
    expect(verifyStateIndex).toBeLessThan(loadingReturnIndex);
  });

  it("uses a compact responsive action bar with a clear primary action", () => {
    expect(dashboardSrc).toMatch(/grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end/);
    expect(dashboardSrc).toMatch(/col-span-2 inline-flex min-h-\[44px\].*sm:col-auto/);
    expect(dashboardSrc).toMatch(/title="View payment proof"/);
    expect(dashboardSrc).toMatch(/title="Reject payment proof"/);
    expect(dashboardSrc).toMatch(/title="Verify and record payment"/);
  });
});
