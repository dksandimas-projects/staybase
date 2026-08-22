import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const calendarPage = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);
const drawerWorkspace = readFileSync(
  resolve(__dirname, "../components/BookingDrawerWorkspace.tsx"),
  "utf8"
);

describe("confirmed early check-in badges", () => {
  it("renders an approved early check-in badge on the calendar", () => {
    expect(calendarPage).toMatch(/data-testid="calendar-approved-early-checkin-badge"/);
    expect(calendarPage).toMatch(/earlyCheckIn\?\.status\s*===\s*["']approved["']/);
  });

  it("shows the calendar badge on the arrival-day cell only", () => {
    expect(calendarPage).toMatch(
      /left\s*&&\s*hasApprovedEarlyCheckIn\s*&&\s*\([\s\S]{0,500}?calendar-approved-early-checkin-badge/
    );
  });

  it("repeats the approved time in the calendar quick drawer", () => {
    expect(calendarPage).toMatch(/data-testid="calendar-drawer-approved-early-checkin-badge"/);
  });

  it("renders the approved badge in the full booking drawer header", () => {
    expect(drawerWorkspace).toMatch(/data-testid="booking-drawer-approved-early-checkin-badge"/);
    expect(drawerWorkspace).toMatch(/earlyCheckIn\?\.status\s*===\s*["']approved["']/);
  });

  it("uses the confirmed time before the originally requested time", () => {
    expect(calendarPage).toMatch(
      /earlyCheckIn\?\.confirmedTime\s*\|\|\s*booking\.earlyCheckIn\?\.requestedTime/
    );
    expect(drawerWorkspace).toMatch(
      /earlyCheckIn\?\.confirmedTime\s*\|\|\s*booking\.earlyCheckIn\?\.requestedTime/
    );
  });

  it("uses green success styling and a check icon on both primary surfaces", () => {
    expect(calendarPage).toMatch(
      /calendar-approved-early-checkin-badge[\s\S]{0,500}?bg-emerald-50[\s\S]{0,300}?<Check/
    );
    expect(drawerWorkspace).toMatch(
      /booking-drawer-approved-early-checkin-badge[\s\S]{0,500}?bg-emerald-50[\s\S]{0,300}?<Check/
    );
  });
});
