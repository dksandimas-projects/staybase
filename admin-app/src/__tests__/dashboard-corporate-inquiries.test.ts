import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(resolve(__dirname, "../pages/DashboardPage.tsx"), "utf8");
const inquiriesSrc = readFileSync(resolve(__dirname, "../pages/CorporateInquiriesPage.tsx"), "utf8");

describe("Dashboard corporate inquiry updates", () => {
  it("surfaces new corporate inquiries from existing admin context", () => {
    expect(dashboardSrc).toMatch(/corporateInquiries/);
    expect(dashboardSrc).toMatch(/newCorporateInquiries/);
    expect(dashboardSrc).toMatch(/inquiry\.status === "new"/);
    expect(dashboardSrc).toMatch(/new corporate inquiries/);
    expect(dashboardSrc).toMatch(/\/corporate\?inquiryId=/);
    expect(dashboardSrc).toMatch(/corporateHelpText/);
    expect(dashboardSrc).toMatch(/fresh leads stay visible/);
    expect(dashboardSrc).toMatch(/About new corporate inquiries/);
  });

  it("opens the corporate inquiry drawer from the dashboard deep link", () => {
    expect(inquiriesSrc).toMatch(/useSearchParams/);
    expect(inquiriesSrc).toMatch(/searchParams\.get\("inquiryId"\)/);
    expect(inquiriesSrc).toMatch(/handleRowClick\(inquiry\)/);
    expect(inquiriesSrc).toMatch(/nextParams\.delete\("inquiryId"\)/);
  });
});
