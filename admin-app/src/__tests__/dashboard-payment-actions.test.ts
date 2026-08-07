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
    // Per FOL-05 (2026-08-07, per decision #201): the
    // Reject + Verify tooltips are now dynamic
    // (`title={rejectTooltip}` + `title={verifyTooltip}`),
    // toggled between the per-room and the
    // reservation-scope wording depending on
    // `item.isReservation`. The literal title strings
    // are still present (defined as local consts
    // inside the card's `pendingPayments.map`
    // closure), so the test can match against them.
    expect(dashboardSrc).toMatch(/grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end/);
    expect(dashboardSrc).toMatch(/col-span-2 inline-flex min-h-\[44px\].*sm:col-auto/);
    expect(dashboardSrc).toMatch(/View payment proof/);
    expect(dashboardSrc).toMatch(/Reject payment proof/);
    expect(dashboardSrc).toMatch(/Verify and record payment/);
    // The reservation-scope variants are also
    // declared so the per-room / reservation toggle
    // can swap the tooltip.
    expect(dashboardSrc).toMatch(/Verify and record payment \(covers all rooms covered by the amount\)/);
    expect(dashboardSrc).toMatch(/Reject payment proof \(rejects all rooms in the reservation\)/);
  });
});
