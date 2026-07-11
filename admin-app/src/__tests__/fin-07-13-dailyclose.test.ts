import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const rules = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

describe("FIN-07 & FIN-13 daily close and cash drawer variance", () => {
  it("defines dailyCloses collection rules as append-only", () => {
    expect(rules).toMatch(/match \/dailyCloses\/\{dateStr\}/);
    expect(rules).toMatch(/allow create: if isStaff\(\)/);
    expect(rules).toMatch(/allow update, delete: if false;/);
  });

  it("supports daily-close tab in ReportsPage state and markup", () => {
    expect(reports).toMatch(/type ReportTab = "performance" \| "sales" \| "daily-close";/);
    expect(reports).toMatch(/activeTab === "daily-close"/);
    expect(reports).toMatch(/aria-selected=\{activeTab === "daily-close"\}/);
  });

  it("registers dailyCloses snapshot listener and state", () => {
    expect(reports).toMatch(/const \[dailyCloses, setDailyCloses\] = useState/);
    expect(reports).toMatch(/collection\(db, "dailyCloses"\)/);
    expect(reports).toMatch(/orderBy\("closedAt", "desc"\)/);
  });

  it("defines DailyCloseTab component with variance inputs and submission", () => {
    expect(reports).toMatch(/function DailyCloseTab/);
    expect(reports).toMatch(/countedCash/);
    expect(reports).toMatch(/countedGCash/);
    expect(reports).toMatch(/countedBank/);
    expect(reports).toMatch(/countedCard/);
    expect(reports).toMatch(/countedPaypal/);
    expect(reports).toMatch(/varianceCash =/);
    expect(reports).toMatch(/varianceGCash =/);
    expect(reports).toMatch(/totalVariance =/);
    expect(reports).toMatch(/doc\(db, "dailyCloses", dateStr\)/);
  });
});
