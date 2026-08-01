import { describe, expect, it } from "vitest";
import {
  normalizeMaxChildren,
  applyRoomTypeDefaults
} from "../utils/roomTypes";

describe("normalizeMaxChildren (CHD-02)", () => {
  it("returns a non-negative finite integer when the value is valid", () => {
    expect(normalizeMaxChildren(0)).toBe(0);
    expect(normalizeMaxChildren(1)).toBe(1);
    expect(normalizeMaxChildren(2)).toBe(2);
    expect(normalizeMaxChildren(99)).toBe(99);
  });

  it("floors fractional values to the next-lower integer", () => {
    expect(normalizeMaxChildren(1.7)).toBe(1);
    expect(normalizeMaxChildren(2.999)).toBe(2);
  });

  it("falls back to the per-capacity default when the value is invalid", () => {
    // 1 adult max (Single) → 0 children
    expect(normalizeMaxChildren(undefined, 1)).toBe(0);
    expect(normalizeMaxChildren(null, 1)).toBe(0);
    expect(normalizeMaxChildren(-5, 1)).toBe(0);
    expect(normalizeMaxChildren(Number.NaN, 1)).toBe(0);
    // 2 adult max → 1 child
    expect(normalizeMaxChildren(undefined, 2)).toBe(1);
    // 3+ adult max → 2 children
    expect(normalizeMaxChildren(undefined, 3)).toBe(2);
    expect(normalizeMaxChildren(undefined, 4)).toBe(2);
    expect(normalizeMaxChildren(undefined, 6)).toBe(2);
  });

  it("uses the safe fallback when the capacity is missing too", () => {
    expect(normalizeMaxChildren(undefined, undefined)).toBe(2);
    expect(normalizeMaxChildren(undefined, 0)).toBe(2);
    expect(normalizeMaxChildren(undefined, -1)).toBe(2);
  });
});

describe("applyRoomTypeDefaults (CHD-02 + EXB-01)", () => {
  it("normalizes a raw settings doc entry into a complete `RoomTypeEntry`", () => {
    const result = applyRoomTypeDefaults({
      value: "family",
      label: "Family",
      shortLabel: "Family",
      imageUrls: ["https://example.com/1.jpg"],
      bedDefinition: "2 double beds",
      description: "Spacious family room",
      amenities: ["WiFi", "AC"],
      maxCapacity: 4,
      pricePerNight: 4200,
      weekendRate: 4600,
      corporateRate: 3900
      // `maxChildren` deliberately absent → seed default 2
    });
    expect(result.value).toBe("family");
    expect(result.maxCapacity).toBe(4);
    expect(result.maxChildren).toBe(2);
    expect(result.maxExtraBeds).toBe(0);
    expect(result.extraBedRate).toBe(0);
  });

  it("respects the admin's choice when `maxChildren` is explicitly set", () => {
    const result = applyRoomTypeDefaults({
      value: "single",
      maxCapacity: 1,
      maxChildren: 0
    } as any);
    expect(result.maxChildren).toBe(0);
  });

  it("returns a safe default for null / undefined / non-object inputs", () => {
    const result = applyRoomTypeDefaults(null);
    expect(result.maxCapacity).toBe(0);
    expect(result.maxChildren).toBe(0);
    expect(result.maxExtraBeds).toBe(0);
  });
});
