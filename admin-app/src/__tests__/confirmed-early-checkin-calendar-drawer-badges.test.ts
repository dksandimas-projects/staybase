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
  it("renders an approved early check-in icon on the calendar", () => {
    expect(calendarPage).toMatch(/data-testid="calendar-approved-early-checkin-icon"/);
    expect(calendarPage).toMatch(/earlyCheckIn\?\.status\s*===\s*["']approved["']/);
  });

  it("shows the calendar icon on the arrival-day cell only", () => {
    expect(calendarPage).toMatch(
      /left\s*&&\s*hasApprovedEarlyCheckIn\s*&&\s*\([\s\S]{0,500}?calendar-approved-early-checkin-icon/
    );
  });

  it("uses a compact green clock icon without time text in the calendar cell", () => {
    const icon = calendarPage.match(
      /data-testid="calendar-approved-early-checkin-icon"[\s\S]{0,800}?<\/span>/
    );
    expect(icon).toBeTruthy();
    expect(icon?.[0]).toMatch(/bg-emerald-100/);
    expect(icon?.[0]).toMatch(/<CalendarClock/);
    expect(icon?.[0]).not.toMatch(/earlyCheckInTime/);
  });

  it("groups early check-in and special-request indicators without separate click handlers", () => {
    expect(calendarPage).toMatch(/data-testid="calendar-booking-indicators"/);
    expect(calendarPage).toMatch(/data-testid="calendar-special-request-icon"/);
    expect(calendarPage).toMatch(
      /onClick=\{\(\)\s*=>\s*openBookingDrawer\(booking\)\}[\s\S]{0,1800}?calendar-booking-indicators/
    );
  });

  it("renders the approved badge in the full booking drawer header", () => {
    expect(drawerWorkspace).toMatch(/data-testid="booking-drawer-approved-early-checkin-badge"/);
    expect(drawerWorkspace).toMatch(/earlyCheckIn\?\.status\s*===\s*["']approved["']/);
  });

  it("shows both early check-in and special-request detail panels in the quick drawer", () => {
    expect(calendarPage).toMatch(/data-testid="calendar-drawer-early-checkin-details"/);
    expect(calendarPage).toMatch(/data-testid="calendar-drawer-special-request-details"/);
    expect(calendarPage).toMatch(/Guest note/);
    expect(calendarPage).toMatch(/Staff note/);
    expect(calendarPage).toMatch(/Originally requested/);
  });

  it("uses the confirmed time before the originally requested time in the quick drawer", () => {
    expect(calendarPage).toMatch(/confirmedTime\s*\|\|\s*earlyCheckIn\.requestedTime/);
    expect(drawerWorkspace).toMatch(
      /earlyCheckIn\?\.confirmedTime\s*\|\|\s*booking\.earlyCheckIn\?\.requestedTime/
    );
  });

  it("keeps the green approved badge in the full booking drawer header", () => {
    expect(drawerWorkspace).toMatch(
      /booking-drawer-approved-early-checkin-badge[\s\S]{0,500}?bg-emerald-50[\s\S]{0,300}?<Check/
    );
  });
});
