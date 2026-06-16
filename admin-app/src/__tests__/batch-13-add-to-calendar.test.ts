import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 13 — BookingConfirmPage
// "Add to Calendar" (audit launch gate SEV-2: "BookingConfirmPage
// 'Add to Calendar' is a stub alert() — the spec requires ICS or
// Google Calendar deep link").
//
// Closes the last remaining launch gate from the Top 5 audit list.
// The page now offers BOTH an ICS file download (works with Apple
// Calendar / Outlook / desktop clients) AND a Google Calendar deep
// link (per RFC 5545 + Google Calendar's action=TEMPLATE contract).
//
// This is a source-pattern test. The behavioral contract of the
// helpers lives in `shared/utils/calendar.ts`; the wiring assertion
// is that the page no longer calls `alert()` and that both buttons
// are present.

const confirmSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);
const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const calendarHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/calendar.ts"),
  "utf8"
);

describe("Phase 11.6 Batch 13 — Add to Calendar is wired to real ICS + Google Calendar", () => {
  describe("shared/calendar helper is exported and is RFC 5545 compliant", () => {
    it("is exported from the shared barrel", () => {
      expect(sharedIndexSrc).toMatch(/export\s+\*\s+from\s+["']\.\/utils\/calendar["']/);
    });

    it("exports buildIcsContent, buildGoogleCalendarUrl, and downloadIcsFile", () => {
      expect(calendarHelperSrc).toMatch(/export\s+function\s+buildIcsContent\(/);
      expect(calendarHelperSrc).toMatch(/export\s+function\s+buildGoogleCalendarUrl\(/);
      expect(calendarHelperSrc).toMatch(/export\s+function\s+downloadIcsFile\(/);
    });

    it("ICS content starts with BEGIN:VCALENDAR + VERSION:2.0 + PRODID", () => {
      // Minimal RFC 5545 smoke check the wiring relies on.
      expect(calendarHelperSrc).toMatch(/["']BEGIN:VCALENDAR["']/);
      expect(calendarHelperSrc).toMatch(/["']VERSION:2\.0["']/);
      expect(calendarHelperSrc).toMatch(/PRODID:/);
    });

    it("Google Calendar URL points to calendar.google.com with action=TEMPLATE", () => {
      expect(calendarHelperSrc).toMatch(/https:\/\/calendar\.google\.com\/calendar\/render/);
      expect(calendarHelperSrc).toMatch(/params\.set\(["']action["'],\s*["']TEMPLATE["']\)/);
    });
  });

  describe("BookingConfirmPage no longer ships a stub alert()", () => {
    it("does not call alert() in the Add to Calendar handler", () => {
      // The previous handler was a single-line `alert("Adding reservation
      // to your local calendar...")`. The string must be gone, and no
      // call to the global `alert(` should survive in this file.
      expect(confirmSrc).not.toMatch(/alert\(["']Adding reservation to your local calendar/);
      expect(confirmSrc).not.toMatch(/\balert\(/);
    });

    it("imports buildIcsContent, buildGoogleCalendarUrl, and downloadIcsFile from @spark-inn/shared", () => {
      expect(confirmSrc).toMatch(/buildIcsContent/);
      expect(confirmSrc).toMatch(/buildGoogleCalendarUrl/);
      expect(confirmSrc).toMatch(/downloadIcsFile/);
      expect(confirmSrc).toMatch(/from\s+["']@spark-inn\/shared["']/);
    });
  });

  describe("BookingConfirmPage renders both calendar actions", () => {
    it("renders a Download .ics button that calls handleAddToCalendar", () => {
      // The previous "Add to Calendar" button is now the .ics download.
      expect(confirmSrc).toMatch(/Download\s+\.ics/);
      expect(confirmSrc).toMatch(/onClick=\{handleAddToCalendar\}/);
    });

    it("renders an Add to Google Calendar link that points at the deep-link URL", () => {
      // Use a literal href={googleCalendarUrl} (computed from the
      // buildGoogleCalendarUrl helper) so the page opens the user's
      // default Google Calendar in a new tab.
      expect(confirmSrc).toMatch(/href=\{googleCalendarUrl\}/);
      expect(confirmSrc).toMatch(/Add to Google Calendar/);
      expect(confirmSrc).toMatch(/target=["']_blank["']/);
      expect(confirmSrc).toMatch(/rel=["']noopener noreferrer["']/);
    });
  });

  describe("handleAddToCalendar passes the right shape to buildIcsContent", () => {
    it("uses an all-day event (VALUE=DATE) keyed off checkIn/checkOut", () => {
      const handleMatch = confirmSrc.match(
        /function\s+handleAddToCalendar\s*\(\s*\)\s*\{[\s\S]*?downloadIcsFile\(/
      );
      expect(handleMatch, "expected to find handleAddToCalendar").toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/start:\s*checkIn/);
      expect(body).toMatch(/end:\s*checkOut/);
      expect(body).toMatch(/allDay:\s*true/);
    });

    it("includes the booking ref, room name, and brand in the title/description", () => {
      const handleMatch = confirmSrc.match(
        /function\s+handleAddToCalendar\s*\(\s*\)\s*\{[\s\S]*?downloadIcsFile\(/
      );
      expect(handleMatch).toBeTruthy();
      const body = handleMatch![0];
      expect(body).toMatch(/title:\s*`Stay at \$\{config\.brandName\}\s*\(/);
      expect(body).toMatch(/Booking reference:\s*\$\{bookingRef\}/);
      expect(body).toMatch(/Room:\s*\$\{selectedRoom\.name\}/);
      expect(body).toMatch(/location:\s*address/);
    });
  });
});
