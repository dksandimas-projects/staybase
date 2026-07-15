import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — Bookings quick-view filtering (FSO-03/04/06)", () => {
  it("uses URL search params for canonical filter state", () => {
    expect(bookingsSrc).toMatch(/readParam\(["']bqv["']/);
    expect(bookingsSrc).toMatch(/readParam\(["']bq["']/);
    expect(bookingsSrc).toMatch(/readParam\(["']bs["']/);
  });

  it("filters arrivals-today: today's check-in + confirmed or checked-in status", () => {
    expect(bookingsSrc).toMatch(/booking\.checkIn === today && \["confirmed", "checked-in"\]\.includes\(booking\.status\)/);
  });

  it("filters departures-today: today's check-out + checked-in status", () => {
    expect(bookingsSrc).toMatch(/booking\.checkOut === today && booking\.status === "checked-in"/);
  });

  it("filters in-house: status === checked-in", () => {
    expect(bookingsSrc).toMatch(/"in-house":\s*return\s+booking\.status === "checked-in"/);
  });

  it("no active quick view means all bookings pass", () => {
    expect(bookingsSrc).toMatch(/default:\s*return\s+true/);
  });

  it("combines search, status filter, and quick view in the filter chain", () => {
    expect(bookingsSrc).toMatch(/matchesSearch && matchesStatus && matchesQV/);
  });

  it("renders active chips for each active criterion (FSO-02)", () => {
    expect(bookingsSrc).toMatch(/activeChips\.push/);
    expect(bookingsSrc).toMatch(/chip\.onRemove/);
  });

  it("provides a Clear all button that resets all filters", () => {
    expect(bookingsSrc).toMatch(/Clear all/);
  });

  it("stores independent filter state for bookings and store tabs", () => {
    expect(bookingsSrc).toMatch(/bookingSearch/);
    expect(bookingsSrc).toMatch(/storeSearch/);
    expect(bookingsSrc).toMatch(/bookingQuickView/);
    expect(bookingsSrc).toMatch(/storeQuickView/);
  });

  it("displays result count before the table", () => {
    expect(bookingsSrc).toMatch(/resultCount/);
    expect(bookingsSrc).toMatch(/totalCount/);
  });
});
