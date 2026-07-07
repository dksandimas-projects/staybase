import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 (Phase 2 W2.4 #92): the Early Check-In
// button on RewardsPage was a fake "open the intercom chat or call
// the desk" hint. Per W2.4 / decision #92, it should:
// 1. Ask the authenticated member stays endpoint for guest-safe bookings
// 2. Show the request (auto-pick if only 1, picker if >1, error if 0)
// 3. POST to /api/email/early-checkin-request with the bookingId + member token
// 4. Show a success confirmation

describe("RewardsPage.tsx — early check-in real submission (decision #92)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/RewardsPage.tsx"),
    "utf8"
  );

  it("does not query the staff-only bookings collection from the guest client", () => {
    expect(src).not.toMatch(/collection\(db,\s*["']bookings["']\)/);
    expect(src).not.toMatch(/where\(['"]memberId['"]/);
  });

  it("has an UpcomingBooking interface that matches the member stays response shape", () => {
    expect(src).toMatch(/interface UpcomingBooking/);
    expect(src).toMatch(/bookingRef:\s*string/);
    expect(src).toMatch(/checkIn:\s*string/);
  });

  it("defines a useEffect that loads member stays when the modal opens", () => {
    expect(src).toMatch(/useEffect/);
    expect(src).toMatch(/setShowEarlyCheckIn/);
    expect(src).toMatch(/fetch\(["']\/api\/members\/stays["']/);
    expect(src).toMatch(/Authorization:\s*`Bearer \$\{idToken\}`/);
  });

  it("filters the member stays response to confirmed/checked-in upcoming bookings", () => {
    expect(src).toMatch(/\["confirmed",\s*"checked-in"\]\.includes\(stay\.status\)/);
    expect(src).toMatch(/stay\.checkIn\s*>=\s*todayStr/);
  });

  it("sorts upcoming bookings ascending by check-in", () => {
    expect(src).toMatch(/sort\(\(a: UpcomingBooking, b: UpcomingBooking\) => a\.checkIn\.localeCompare\(b\.checkIn\)\)/);
  });

  it("shows an error when there are no upcoming bookings", () => {
    expect(src).toMatch(/No upcoming booking found/);
  });

  it("auto-picks when there is exactly 1 upcoming booking", () => {
    // The new unified UI handles both 1 and N bookings with a dropdown;
    // when there's only one, the select is hidden and the active booking
    // is used directly. The selectedBookingId state is used to pick it.
    expect(src).toMatch(/selectedBookingId/);
    expect(src).toMatch(/upcomingBookings\.find/);
  });

  it("shows a picker when there are multiple upcoming bookings", () => {
    // A <select> dropdown renders when upcomingBookings.length > 1
    expect(src).toMatch(/upcomingBookings\.length/);
    expect(src).toMatch(/Select Booking/);
  });

  it("POSTs to /api/email/early-checkin-request with the bookingId and member token", () => {
    expect(src).toMatch(/fetch\(["']\/api\/email\/early-checkin-request["']/);
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*bookingId/);
    expect(src).toMatch(/Authorization:\s*`Bearer \$\{await user!\.getIdToken\(\)\}`/);
  });

  it("shows a success confirmation after submission", () => {
    expect(src).toMatch(/Request sent/);
  });

  it("no longer shows the old fake 'open the intercom' hint", () => {
    expect(src).not.toMatch(/open the Intercom chat for your room \(scan the QR code in your room\)/);
  });
});
