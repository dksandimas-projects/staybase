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
    expect(reportsPageSrc).toMatch(/"custom".*Custom|Custom.*"custom"/s);
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

  it("QA-Email-Resend: Resend Transactional Email per booking", () => {
    const adminContextSrc = readFileSync(resolve(__dirname, "../context/AdminContext.tsx"), "utf8");
    const bookingsPageSrc = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
    const emailActionsSrc = readFileSync(resolve(__dirname, "../components/BookingEmailActions.tsx"), "utf8");
    const allSrc = `${bookingsPageSrc}\n${emailActionsSrc}`;

    // Verify AdminContext exposes resendBookingEmail and calls the backend correctly
    expect(adminContextSrc).toMatch(/resendBookingEmail/);
    expect(adminContextSrc).toMatch(/\/api\/email\/\$\{action\}/);
    expect(adminContextSrc).toMatch(/Bearer/);
    expect(adminContextSrc).toMatch(/bookingId/);

    // Verify BookingsPage incorporates resendBookingEmail and displays the interface
    expect(bookingsPageSrc).toMatch(/resendBookingEmail/);
    expect(allSrc).toMatch(/Resend Transactional Email/);
    expect(bookingsPageSrc).toMatch(/handleResendEmail/);
    expect(emailActionsSrc).toMatch(/getRecommendedEmailAction/);
  });
});
