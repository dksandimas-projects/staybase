import { describe, expect, it } from "vitest";
import {
  normalizeMaxChildren,
  applyRoomTypeDefaults,
  requiredExtraBedsFor,
  deriveRoomTypeCapacityFit
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

// Per CHD-11 (2026-08-04, per decision #184): the per-type
// capacity-fit indicator that drives the Fits / Tight / Doesn't
// fit chip on each room-type card on `/book` and (per CHD-12)
// the small capacity chip on each line of the cart summary.
// Single derivation point — both surfaces read from it.
describe("deriveRoomTypeCapacityFit (CHD-11)", () => {
  const family = { maxCapacity: 4, maxChildren: 2, maxExtraBeds: 1 };
  const single = { maxCapacity: 1, maxChildren: 0, maxExtraBeds: 1 };
  const standardDouble = { maxCapacity: 2, maxChildren: 1, maxExtraBeds: 0 };

  it("returns 'fits' when the group fits the cart with unused adult OR child slots", () => {
    // 2 adults + 1 child in 1 Family (maxCap 4, maxChildren 2):
    // 2 unused adult slots + 1 unused child slot. Fits.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 2,
      numChildren: 1,
      currentCartCount: 1
    });
    expect(r.state).toBe("fits");
    expect(r.roomsNeeded).toBe(1);
    expect(r.extraBedsNeeded).toBe(0);
  });

  it("returns 'tight' when the group is exactly at the cap (no unused slots)", () => {
    // 4 adults + 2 children in 1 Family (maxCap 4, maxChildren 2):
    // exactly at the cap. Tight.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 4,
      numChildren: 2,
      currentCartCount: 1
    });
    expect(r.state).toBe("tight");
    expect(r.roomsNeeded).toBe(1);
    expect(r.extraBedsNeeded).toBe(0);
  });

  it("returns 'tight' when overflow is covered by extra beds (no headroom left)", () => {
    // 5 adults in 1 Family (maxCap 4, maxChildren 2, maxExtraBeds 1):
    // 1 overflow adult, 1 extra bed covers it. Tight.
    // Per the spec: roomsNeeded does NOT count extra beds
    // toward the room count — it uses the bare per-type cap.
    // So 5 adults in Family (maxCap 4) → roomsNeeded = 2
    // (ceil(5/4)). The per-bed overflow is in extraBedsNeeded
    // = 1. The two outputs decompose.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 5,
      numChildren: 0,
      currentCartCount: 1
    });
    expect(r.state).toBe("tight");
    expect(r.roomsNeeded).toBe(2);
    expect(r.extraBedsNeeded).toBe(1);
  });

  it("returns 'doesnt-fit' when the cart's extra beds can't cover the overflow", () => {
    // 6 adults in 1 Family (maxCap 4, maxExtraBeds 1): 2 overflow,
    // 1 extra bed — doesn't fit.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 6,
      numChildren: 0,
      currentCartCount: 1
    });
    expect(r.state).toBe("doesnt-fit");
    expect(r.extraBedsNeeded).toBe(0);
  });

  it("returns 'doesnt-fit' for a Single with 1 adult + 1 child (no children allowed)", () => {
    // 1 adult + 1 child in 1 Single (maxChildren 0, no extra
    // beds configured for child overflow): 1 child overflow,
    // 0 extra beds → doesn't fit.
    const r = deriveRoomTypeCapacityFit({
      type: { maxCapacity: 1, maxChildren: 0, maxExtraBeds: 0 },
      numAdults: 1,
      numChildren: 1,
      currentCartCount: 1
    });
    expect(r.state).toBe("doesnt-fit");
  });

  it("computes roomsNeeded as the ceiling of the higher dimension", () => {
    // 6 adults + 1 child in Family: ceil(6/4)=2 rooms, ceil(1/2)=1
    // → max = 2 rooms.
    const r1 = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 6,
      numChildren: 1,
      currentCartCount: 0
    });
    expect(r1.roomsNeeded).toBe(2);
    // 4 adults + 5 children in Family: ceil(4/4)=1, ceil(5/2)=3 → 3.
    const r2 = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 4,
      numChildren: 5,
      currentCartCount: 0
    });
    expect(r2.roomsNeeded).toBe(3);
  });

  it("aggregates the cart count correctly — 2 Family fits 6 adults + 2 children with unused slots", () => {
    // 6 adults + 2 children in 2 Family rooms (maxCap 4 each,
    // total 8 adult slots, 4 child slots, 2 extra beds):
    // 0 overflow, 2 unused adult slots, 2 unused child slots.
    // "fits" (not "tight") because the cart has headroom.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 6,
      numChildren: 2,
      currentCartCount: 2
    });
    expect(r.state).toBe("fits");
    expect(r.roomsNeeded).toBe(2);
  });

  it("aggregates the cart count correctly — 2 Family fits 8 adults + 4 children exactly at cap", () => {
    // 8 adults + 4 children in 2 Family rooms: exactly at both
    // caps (8/8 adults, 4/4 children). Tight.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 8,
      numChildren: 4,
      currentCartCount: 2
    });
    expect(r.state).toBe("tight");
    expect(r.roomsNeeded).toBe(2);
  });

  it("returns 'fits' for an empty group (0 adults, 0 children)", () => {
    // Defensive — the /book page requires at least 1 adult, but
    // the helper should not throw on 0/0.
    const r = deriveRoomTypeCapacityFit({
      type: family,
      numAdults: 0,
      numChildren: 0,
      currentCartCount: 0
    });
    expect(r.state).toBe("fits");
    expect(r.roomsNeeded).toBe(1);
    expect(r.extraBedsNeeded).toBe(0);
  });

  it("handles a type with maxExtraBeds=0 and no overflow", () => {
    // Standard Double, 2 adults, 0 children, 1 in cart: fits.
    const r = deriveRoomTypeCapacityFit({
      type: standardDouble,
      numAdults: 2,
      numChildren: 0,
      currentCartCount: 1
    });
    expect(r.state).toBe("fits");
    expect(r.extraBedsNeeded).toBe(0);
  });

  it("handles a type with maxExtraBeds=0 and overflow → doesn't fit", () => {
    // Standard Double, 3 adults, 0 children, 1 in cart: 1 overflow
    // adult, 0 extra beds → doesn't fit.
    const r = deriveRoomTypeCapacityFit({
      type: standardDouble,
      numAdults: 3,
      numChildren: 0,
      currentCartCount: 1
    });
    expect(r.state).toBe("doesnt-fit");
  });

  it("normalises non-numeric / fractional / negative inputs to 0", () => {
    const r = deriveRoomTypeCapacityFit({
      type: { maxCapacity: 4, maxChildren: 2, maxExtraBeds: 1 },
      numAdults: -1,
      numChildren: 2.5,
      currentCartCount: undefined as any
    });
    // numAdults → 0, numChildren → 2, currentCartCount → 0
    // 0 adults + 2 children in 0 Family rooms: 2 children
    // overflow, 0 extra beds → doesn't fit.
    expect(r.state).toBe("doesnt-fit");
    expect(r.roomsNeeded).toBe(1);
  });

  it("the Single Room: 1 adult + 0 children in 1 Single fits at the cap → 'tight'", () => {
    // The single-edge case the spec calls out: 1 adult in a
    // Single (maxCap 1, maxChildren 0, maxExtraBeds 1) is
    // exactly at the adult cap. Tight.
    const r = deriveRoomTypeCapacityFit({
      type: single,
      numAdults: 1,
      numChildren: 0,
      currentCartCount: 1
    });
    expect(r.state).toBe("tight");
    expect(r.roomsNeeded).toBe(1);
    expect(r.extraBedsNeeded).toBe(0);
  });
});
