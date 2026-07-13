import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FIN-01 and FIN-02 collections reporting", () => {
  it("loads actual append-only payment entries and filters by recorded date", () => {
    expect(reports).toMatch(/onSnapshot\(collectionGroup\(db, "payments"\)/);
    expect(reports).toMatch(/payment\.recordedAt >= periodStart && payment\.recordedAt <= periodEnd/);
    expect(reports).toMatch(/rangePayments\.filter\(\(payment\) => payment\.type === "payment"\)/);
    expect(reports).toMatch(/const collectedTotal = folioSnapshot\.collected/);
  });

  it("reconciles charge-inclusive billed totals against collections", () => {
    expect(reports).toMatch(/summarizeFolioSnapshot/);
    expect(reports).toMatch(/const billedTotal = folioSnapshot\.billed/);
    expect(reports).toMatch(/outstandingTotal = Math\.max\(billedTotal - collectedTotal, 0\)/);
    expect(reports).toMatch(/Collections Reconciliation/);
  });

  it("groups collections by day, method, and staff", () => {
    expect(reports).toMatch(/collectionsByDay = useMemo/);
    expect(reports).toMatch(/collectionsByStaff = useMemo/);
    expect(reports).toMatch(/Actual Payment Methods/);
    expect(reports).toMatch(/dataKey="total" nameKey="name"/);
    expect(reports).not.toMatch(/counts\[method\]\.total \+= b\.totalPrice/);
  });

  it("exports collection rows to CSV and XLSX", () => {
    expect(reports).toMatch(/sparkinn_collections_/);
    expect(reports).toMatch(/"Collections"\)/);
    expect(reports).toMatch(/collectionHeaders/);
  });

  it("separates unsettled Add-to-Bill folios from actual payment methods", () => {
    expect(reports).toMatch(/Add to Bill — Uncollected/);
    expect(reports).toMatch(/booking\.totalPrice \|\| 0\) \+ bookingCharges \+ bookingStoreTotal - bookingPayments/);
    expect(reports).toMatch(/isUncollected: true/);
  });
});
