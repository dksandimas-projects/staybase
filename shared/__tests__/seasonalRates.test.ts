import { describe, expect, test } from "vitest";
import {
  calculateSeasonalAwareRoomBreakdown,
  calculateSeasonalAwareRoomTotal,
  getSeasonalRateForNight,
  normalizeSeasonalRateOverrides
} from "../utils/seasonalRates";

describe("seasonal rate utilities", () => {
  const overrides = normalizeSeasonalRateOverrides([
    {
      id: "all-summer",
      name: "Summer",
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      rate: 3500,
      roomTypeValues: [],
      isActive: true
    },
    {
      id: "family-summer",
      name: "Family Summer",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      rate: 5200,
      roomTypeValues: ["family"],
      isActive: true
    }
  ]);

  test("normalizes valid overrides and drops malformed entries", () => {
    const normalized = normalizeSeasonalRateOverrides([
      { id: "bad", name: "", startDate: "2026-01-01", endDate: "2026-01-02", rate: 1000 },
      { id: "ok", name: "Peak", startDate: "2026-01-01", endDate: "2026-01-02", rate: 2500 }
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("ok");
  });

  test("prefers room-type specific overrides over all-type overrides", () => {
    const match = getSeasonalRateForNight("2026-04-12T00:00:00Z", "family", overrides);
    expect(match?.id).toBe("family-summer");
    expect(match?.rate).toBe(5200);
  });

  test("seasonal rates override weekend rates for matching nights only", () => {
    const total = calculateSeasonalAwareRoomTotal({
      checkIn: "2026-04-11T00:00:00Z",
      checkOut: "2026-04-13T00:00:00Z",
      roomType: "standard-double",
      baseRate: 2400,
      weekendRate: 2800,
      seasonalRateOverrides: overrides
    });

    expect(total).toBe(7000);
  });

  test("falls back to weekend/base rates outside seasonal windows", () => {
    const total = calculateSeasonalAwareRoomTotal({
      checkIn: "2026-05-02T00:00:00Z",
      checkOut: "2026-05-04T00:00:00Z",
      roomType: "standard-double",
      baseRate: 2400,
      weekendRate: 2800,
      seasonalRateOverrides: overrides
    });

    expect(total).toBe(5600);
  });

  test("returns grouped regular, weekend, and seasonal rate lines", () => {
    const breakdown = calculateSeasonalAwareRoomBreakdown({
      checkIn: "2026-03-27T00:00:00Z",
      checkOut: "2026-04-02T00:00:00Z",
      roomType: "standard-double",
      baseRate: 2400,
      weekendRate: 2800,
      seasonalRateOverrides: overrides
    });

    expect(breakdown.roomSubtotal).toBe(16300);
    expect(breakdown.roomLines).toEqual([
      {
        source: "regular",
        label: "Regular nights",
        startDate: "2026-03-27",
        endDate: "2026-03-27",
        nights: 1,
        nightlyRate: 2400,
        subtotal: 2400
      },
      {
        source: "weekend",
        label: "Weekend nights",
        startDate: "2026-03-28",
        endDate: "2026-03-29",
        nights: 2,
        nightlyRate: 2800,
        subtotal: 5600
      },
      {
        source: "regular",
        label: "Regular nights",
        startDate: "2026-03-30",
        endDate: "2026-03-31",
        nights: 2,
        nightlyRate: 2400,
        subtotal: 4800
      },
      {
        source: "seasonal",
        label: "Summer",
        startDate: "2026-04-01",
        endDate: "2026-04-01",
        nights: 1,
        nightlyRate: 3500,
        subtotal: 3500
      }
    ]);
  });
});
