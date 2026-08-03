import { describe, expect, it } from "vitest";
import {
  normalizeMaxChildren,
  applyRoomTypeDefaults,
  requiredExtraBedsFor
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

describe("requiredExtraBedsFor (EXB-03)", () => {
  it("returns 0 overflow when the booking fits the per-type cap (no extra bed needed)", () => {
    // Standard Double (2 adult, 1 child cap) — 2 adults + 1 child
    // is at the cap, no extra bed needed.
    const r = requiredExtraBedsFor({
      numAdults: 2,
      numChildren: 1,
      maxCapacity: 2,
      maxChildren: 1
    });
    expect(r.overflowAdults).toBe(0);
    expect(r.overflowChildren).toBe(0);
    expect(r.requiredExtraBeds).toBe(0);
  });

  it("returns 1 overflow adult when the booking exceeds the adult cap by 1", () => {
    // Single (1 adult cap, 0 children, 1 extra bed) — 2 adults.
    // 1 overflow adult, 0 overflow children, 1 required extra bed.
    const r = requiredExtraBedsFor({
      numAdults: 2,
      numChildren: 0,
      maxCapacity: 1,
      maxChildren: 0
    });
    expect(r.overflowAdults).toBe(1);
    expect(r.overflowChildren).toBe(0);
    expect(r.requiredExtraBeds).toBe(1);
  });

  it("returns 1 overflow child when the booking exceeds the child cap by 1", () => {
    // Standard Double (2 adult, 1 child cap) — 2 adults + 2 children.
    // 0 overflow adults, 1 overflow child, 1 required extra bed.
    const r = requiredExtraBedsFor({
      numAdults: 2,
      numChildren: 2,
      maxCapacity: 2,
      maxChildren: 1
    });
    expect(r.overflowAdults).toBe(0);
    expect(r.overflowChildren).toBe(1);
    expect(r.requiredExtraBeds).toBe(1);
  });

  it("sums adult + child overflow into the required extra bed count", () => {
    // Single (1 adult, 0 children, 2 extra beds) — 2 adults + 1 child.
    // 1 overflow adult + 1 overflow child = 2 required extra beds.
    const r = requiredExtraBedsFor({
      numAdults: 2,
      numChildren: 1,
      maxCapacity: 1,
      maxChildren: 0
    });
    expect(r.overflowAdults).toBe(1);
    expect(r.overflowChildren).toBe(1);
    expect(r.requiredExtraBeds).toBe(2);
  });

  it("treats a negative overflow as 0 (defensive default for legacy / invalid inputs)", () => {
    const r = requiredExtraBedsFor({
      numAdults: 0,
      numChildren: 0,
      maxCapacity: 2,
      maxChildren: 1
    });
    expect(r.requiredExtraBeds).toBe(0);
  });

  it("returns the documented EXB-03 boundary cases", () => {
    // 2 adults in a Single (1 cap, 0 children) → 1 overflow
    const r1 = requiredExtraBedsFor({ numAdults: 2, numChildren: 0, maxCapacity: 1, maxChildren: 0 });
    expect(r1.requiredExtraBeds).toBe(1);
    // 2 adults in a Family (4 cap, 2 children) → 0 overflow
    const r2 = requiredExtraBedsFor({ numAdults: 2, numChildren: 0, maxCapacity: 4, maxChildren: 2 });
    expect(r2.requiredExtraBeds).toBe(0);
    // 6 adults in a Family → 2 overflow
    const r3 = requiredExtraBedsFor({ numAdults: 6, numChildren: 0, maxCapacity: 4, maxChildren: 2 });
    expect(r3.requiredExtraBeds).toBe(2);
  });
});
