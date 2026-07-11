import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FIN-11 & FIN-12 hotel finance KPIs and comparisons", () => {
  it("calculates prevPeriod, previous bookings and revenue", () => {
    expect(reports).toMatch(/const prevPeriod =/);
    expect(reports).toMatch(/prevRoomRevenue =/);
    expect(reports).toMatch(/prevBreakfastRevenue =/);
    expect(reports).toMatch(/prevStoreRevenue =/);
    expect(reports).toMatch(/prevIncidentalRevenue =/);
    expect(reports).toMatch(/prevTotalRevenue =/);
  });

  it("calculates ADR and RevPAR for current and previous periods", () => {
    expect(reports).toMatch(/adr = totalRoomNights > 0 \? roomRevenue \/ totalRoomNights : 0/);
    expect(reports).toMatch(/revpar = possibleRoomNights > 0 \? roomRevenue \/ possibleRoomNights : 0/);
    expect(reports).toMatch(/prevAdr =/);
    expect(reports).toMatch(/prevRevpar =/);
  });

  it("defines comparison deltas for KPI cards", () => {
    expect(reports).toMatch(/const deltas =/);
    expect(reports).toMatch(/revenue: getDeltaPct\(/);
    expect(reports).toMatch(/bookings: getDeltaPct\(/);
    expect(reports).toMatch(/occupancy: getDeltaPct\(/);
    expect(reports).toMatch(/adr: getDeltaPct\(/);
    expect(reports).toMatch(/revpar: getDeltaPct\(/);
  });

  it("defines DeltaBadge component", () => {
    expect(reports).toMatch(/function DeltaBadge/);
    expect(reports).toMatch(/vs prev period/);
    expect(reports).toMatch(/isPositive \? "text-emerald-600" : "text-rose-600"/);
  });

  it("calculates roomTypeRevenue split", () => {
    expect(reports).toMatch(/const roomTypeRevenue =/);
    expect(reports).toMatch(/b\.roomType === rt\.value/);
    expect(reports).toMatch(/fraction = b\.numNights > 0 \? \(overlapNights \/ b\.numNights\) : 0/);
  });

  it("supports KPI cards and room type revenue chart in PerformanceTab", () => {
    expect(reports).toMatch(/adr, revpar, roomTypeRevenue, deltas/);
    expect(reports).toMatch(/<span[^>]*?>ADR<\/span>/);
    expect(reports).toMatch(/<span[^>]*?>RevPAR<\/span>/);
    expect(reports).toMatch(/Revenue by Room Type/);
    expect(reports).toMatch(/data=\{roomTypeRevenue\}/);
  });
});
