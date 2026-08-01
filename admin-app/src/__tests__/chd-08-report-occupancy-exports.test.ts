import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getReportOccupancySplit } from "../utils/reportOccupancy";

const reportsPageSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);

describe("CHD-08 — report occupancy exports", () => {
  it("retains a valid stored adult/child split alongside the total", () => {
    expect(getReportOccupancySplit({
      numGuests: 4,
      numAdults: 2,
      numChildren: 2
    })).toEqual({ guests: 4, adults: 2, children: 2 });
  });

  it.each([
    { numGuests: 3 },
    { numGuests: 3, numAdults: 2 },
    { numGuests: 3, numAdults: 2, numChildren: 2 },
    { numGuests: 3, numAdults: -1, numChildren: 4 },
    { numGuests: 3, numAdults: 1.5, numChildren: 1.5 }
  ])("reports legacy or inconsistent data as all adults: %o", (booking) => {
    expect(getReportOccupancySplit(booking)).toEqual({
      guests: 3,
      adults: 3,
      children: 0
    });
  });

  it("adds Guests, Adults, and Children to the page CSV", () => {
    expect(reportsPageSrc).toContain(
      "Nights,Guests,Adults,Children,Total Price"
    );
    expect(reportsPageSrc).toMatch(
      /const occupancy = getReportOccupancySplit\(b\);[\s\S]{0,500}\$\{occupancy\.guests\},\$\{occupancy\.adults\},\$\{occupancy\.children\}/
    );
  });

  it("adds the split to the Full Backup Bookings sheet", () => {
    const backupRows = reportsPageSrc.match(
      /const bookingRows = bookings\.map[\s\S]*?XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.json_to_sheet\(bookingRows\), "Bookings"\)/
    );
    expect(backupRows).toBeTruthy();
    expect(backupRows![0]).toMatch(/Guests: occupancy\.guests/);
    expect(backupRows![0]).toMatch(/Adults: occupancy\.adults/);
    expect(backupRows![0]).toMatch(/Children: occupancy\.children/);
  });

  it("adds the split to the Sales Bookings and Breakfast sheets", () => {
    expect(reportsPageSrc).toMatch(
      /const bookingsHeaders = \[[\s\S]*?"Guests", "Adults", "Children"/
    );
    expect(reportsPageSrc).toMatch(
      /b\.numNights, occupancy\.guests, occupancy\.adults, occupancy\.children, b\.ratePerNight/
    );
    expect(reportsPageSrc).toMatch(
      /const breakfastHeaders = \[[\s\S]*?"Guests", "Adults", "Children"/
    );
    expect(reportsPageSrc).toMatch(
      /b\.numNights, occupancy\.guests, occupancy\.adults, occupancy\.children, b\.breakfastRate/
    );
  });

  it("keeps room-night performance metrics independent of the split", () => {
    expect(reportsPageSrc).toMatch(
      /const totalRoomNights = occupancyBookings\.reduce\(\(sum, b\) => sum \+ getOverlapNights/
    );
    expect(reportsPageSrc).toMatch(
      /Math\.round\(\(totalRoomNights \/ possibleRoomNights\) \* 100\)/
    );
    expect(reportsPageSrc).toMatch(
      /const adr = totalRoomNights > 0 \? roomRevenue \/ totalRoomNights : 0/
    );
  });
});
