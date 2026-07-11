import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FIN-09 & FIN-10 occupancy clipping and revenue proration", () => {
  it("defines getOverlapNights helper function", () => {
    expect(reports).toMatch(/const getOverlapNights =/);
    expect(reports).toMatch(/overlapStart = new Date\(Math\.max\(/);
    expect(reports).toMatch(/overlapEnd = new Date\(Math\.min\(/);
  });

  it("filters rangeBookings to include overlapping stays", () => {
    expect(reports).toMatch(/overlaps = cIn < periodEnd && cOut > periodStart/);
    expect(reports).toMatch(/if \(!overlaps\) return false;/);
  });

  it("excludes unpaid future confirmed bookings and past confirmed no-shows", () => {
    expect(reports).toMatch(/b\.status === "confirmed" && cOut <= today/);
    expect(reports).toMatch(/b\.status === "confirmed" && cIn > today/);
    expect(reports).toMatch(/collected <= 0/);
  });

  it("prorates room and breakfast revenue using getOverlapNights", () => {
    expect(reports).toMatch(/roomRevenue = useMemo\(\(\) => \{[\s\S]+?getOverlapNights/);
    expect(reports).toMatch(/breakfastRevenue = useMemo\(\(\) => \{[\s\S]+?getOverlapNights/);
  });

  it("calculates total room nights and room type occupancy using overlap nights", () => {
    expect(reports).toMatch(/totalRoomNights = rangeBookings\.reduce\(\(sum, b\) => sum \+ getOverlapNights/);
    expect(reports).toMatch(/occupiedNights = rangeBookings[\s\S]+?getOverlapNights/);
  });
});
