// QA-2026-10-23 §3.12 — the dashboard's "Pending refunds" card
// navigates to `/reports?tab=liability`, but the Reports page never
// read a `tab` parameter: `activeTab` was initialised from the role
// alone, so the deep link was silently dropped and the desk landed
// on the Performance tab instead of the money-to-process queue.
//
// The fix validates the parameter against the known tab ids and
// falls back to the role-based default for anything else. These
// guards pin the resolver's behaviour (unit) and its wiring into the
// page (source text, the style of the rest of this suite).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveReportTab } from "../pages/ReportsPage";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const dashboard = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");

describe("QA-2026-10-23 §3.12 — the Reports page honours a validated ?tab= parameter", () => {
  it("opens the tab a valid admin deep link names", () => {
    expect(resolveReportTab("liability", "admin")).toBe("liability");
    expect(resolveReportTab("performance", "admin")).toBe("performance");
    expect(resolveReportTab("sales", "admin")).toBe("sales");
    expect(resolveReportTab("daily-close", "admin")).toBe("daily-close");
  });

  it("ignores an unknown ?tab= value instead of breaking the page", () => {
    expect(resolveReportTab("liabilityy", "admin")).toBeNull();
    expect(resolveReportTab("liability ", "admin")).toBeNull();
    expect(resolveReportTab("", "admin")).toBeNull();
    expect(resolveReportTab(null, "admin")).toBeNull();
    expect(resolveReportTab(undefined, "admin")).toBeNull();
  });

  it("ignores a missing ?tab= value so the role default still applies", () => {
    expect(resolveReportTab(null, "admin")).toBeNull();
    expect(resolveReportTab(null, "front-desk")).toBeNull();
  });

  it("keeps the admin-only tabs out of reach for front-desk staff", () => {
    // RPT-04 keeps Performance / Sales / Liability admin-only, so a
    // front-desk deep link may only ever name Daily Close.
    expect(resolveReportTab("liability", "front-desk")).toBeNull();
    expect(resolveReportTab("performance", "front-desk")).toBeNull();
    expect(resolveReportTab("sales", "front-desk")).toBeNull();
    expect(resolveReportTab("daily-close", "front-desk")).toBe("daily-close");
  });

  it("reads the parameter with useSearchParams and keeps the role default as the fallback", () => {
    expect(reports).toMatch(/import\s*\{\s*useSearchParams\s*\}\s*from\s*["']react-router-dom["']/);
    expect(reports).toMatch(/searchParams\.get\(["']tab["']\)/);

    const initializer = reports.match(/useState<ReportTab>\(\s*[\s\S]*?\)\s*;/);
    expect(initializer, "expected useState<ReportTab>(...) initializer").toBeTruthy();
    // The validated parameter wins...
    expect(initializer![0]).toMatch(/resolveReportTab\(requestedTab,\s*currentUser\?\.role\)/);
    // ...and the role-based default is still the fallback (RPT-04).
    expect(initializer![0]).toMatch(/currentUser\?\.role\s*===\s*["']admin["']/);
    expect(initializer![0]).toMatch(/:\s*["']daily-close["']/);
  });

  it("re-applies the deep link when the parameter changes without a remount", () => {
    expect(reports).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*const resolvedTab = resolveReportTab\(requestedTab, currentUser\?\.role\);\s*if \(resolvedTab\) setActiveTab\(resolvedTab\);/
    );
  });

  it("still deep-links from the dashboard's Pending refunds card", () => {
    expect(dashboard).toMatch(/navigate\(["']\/reports\?tab=liability["']\)/);
    expect(dashboard).toMatch(/data-testid=["']dashboard-pending-refunds-card["']/);
  });
});
