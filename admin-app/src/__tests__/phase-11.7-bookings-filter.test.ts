import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — Bookings ?filter=... logic (bottom tab bar target)", () => {
  it("destructures the setSearchParams setter from useSearchParams", () => {
    expect(bookingsSrc).toMatch(/const\s+\[searchParams,\s*setSearchParams\]\s*=\s*useSearchParams/);
  });

  it("reads the operational filter from the URL search params", () => {
    expect(bookingsSrc).toMatch(/const\s+operationalFilter\s*=\s*searchParams\.get\(["']filter["']\)/);
  });

  it("filters arrivals: today's check-in + confirmed or checked-in status", () => {
    const block = bookingsSrc.match(
      /if\s*\(operationalFilter\s*===\s*["']arrivals["']\)\s*\{[\s\S]*?return\s+booking\.checkIn\s*===\s*today[\s\S]*?\}/m
    );
    expect(block, "expected arrivals filter block").toBeTruthy();
    expect(block![0]).toMatch(/status\s*===\s*["']confirmed["']/);
    expect(block![0]).toMatch(/status\s*===\s*["']checked-in["']/);
  });

  it("filters departures: today's check-out + checked-in status", () => {
    const block = bookingsSrc.match(
      /if\s*\(operationalFilter\s*===\s*["']departures["']\)\s*\{[\s\S]*?return\s+booking\.checkOut\s*===\s*today[\s\S]*?\}/m
    );
    expect(block, "expected departures filter block").toBeTruthy();
    expect(block![0]).toMatch(/status\s*===\s*["']checked-in["']/);
  });

  it("filters in-house: status === checked-in", () => {
    const block = bookingsSrc.match(
      /if\s*\(operationalFilter\s*===\s*["']in-house["']\)\s*\{[\s\S]*?return\s+booking\.status\s*===\s*["']checked-in["']/m
    );
    expect(block, "expected in-house filter block").toBeTruthy();
  });

  it("no filter means all bookings pass", () => {
    expect(bookingsSrc).toMatch(/if\s*\(!operationalFilter\)\s*return\s+true/);
  });

  it("passes the operational filter to the rows filter chain", () => {
    expect(bookingsSrc).toMatch(/const\s+matchesFilter\s*=\s*matchesOperationalFilter\(booking\)/);
    expect(bookingsSrc).toMatch(/return\s+matchesSearch\s*&&\s*matchesStatus\s*&&\s*matchesFilter/);
  });

  it("renders a clear-filter chip when an operational filter is active", () => {
    expect(bookingsSrc).toMatch(/activeFilterLabel/);
    expect(bookingsSrc).toMatch(/Filter:\s*\{operationalFilter\}/);
    expect(bookingsSrc).toMatch(/next\.delete\(["']filter["']\)/);
  });

  it("substitutes the page subtitle with the active filter label", () => {
    const subtitleBlock = bookingsSrc.match(
      /activeFilterLabel\s*\?\s*activeFilterLabel\s*:\s*["']Review active room check-ins/
    );
    expect(subtitleBlock, "expected subtitle to swap on active filter").toBeTruthy();
  });
});
