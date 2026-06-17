import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 (Phase 2 W2.4 #92): the Early Check-In
// button on RewardsPage was a fake "open the intercom chat or call
// the desk" hint. Per W2.4 / decision #92, it should:
// 1. Find the next upcoming confirmed/checked-in booking for the member
// 2. Show the request (auto-pick if only 1, picker if >1, error if 0)
// 3. POST to /api/email/early-checkin-request with the bookingId
// 4. Show a success confirmation

describe("RewardsPage.tsx — early check-in real submission (decision #92)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/RewardsPage.tsx"),
    "utf8"
  );

  it("uses the where import from firebase/firestore (needed for the booking query)", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bwhere\b[^}]*\}\s*from\s*["']firebase\/firestore["']/);
  });

  it("has an UpcomingBooking interface that matches the booking query shape", () => {
    expect(src).toMatch(/interface UpcomingBooking/);
    expect(src).toMatch(/bookingRef:\s*string/);
    expect(src).toMatch(/checkIn:\s*any/);
  });

  it("defines a useEffect that loads bookings when the modal opens", () => {
    expect(src).toMatch(/useEffect/);
    expect(src).toMatch(/setShowEarlyCheckIn/);
    expect(src).toMatch(/getDocs\(/);
  });

  it("filters the query to memberId == user.uid, status in [confirmed, checked-in]", () => {
    expect(src).toMatch(/where\(['"]memberId['"]/);
    expect(src).toMatch(/where\(['"]status['"].*?['"]in['"]/);
  });

  it("filters to bookings with checkIn >= today and sorts ascending", () => {
    expect(src).toMatch(/checkIn\.getTime\(\)\s*>=\s*today/);
    expect(src).toMatch(/sort\(\(a, b\) => a\.checkIn\.getTime\(\) - b\.checkIn\.getTime\(\)\)/);
  });

  it("shows an error when there are no upcoming bookings", () => {
    expect(src).toMatch(/No upcoming booking found/);
  });

  it("auto-picks when there is exactly 1 upcoming booking", () => {
    expect(src).toMatch(/upcomingBookings\.length\s*===\s*1/);
  });

  it("shows a picker when there are multiple upcoming bookings", () => {
    expect(src).toMatch(/upcomingBookings\.length/);
    expect(src).toMatch(/Pick the one/);
  });

  it("POSTs to /api/email/early-checkin-request with the bookingId", () => {
    expect(src).toMatch(/fetch\(["']\/api\/email\/early-checkin-request["']/);
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*bookingId/);
  });

  it("shows a success confirmation after submission", () => {
    expect(src).toMatch(/Request sent/);
  });

  it("no longer shows the old fake 'open the intercom' hint", () => {
    expect(src).not.toMatch(/open the Intercom chat for your room \(scan the QR code in your room\)/);
  });
});
