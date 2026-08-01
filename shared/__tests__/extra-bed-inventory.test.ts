import { describe, it, expect } from "vitest";
import {
  countExtraBedsInUse,
  checkExtraBedInventory,
  type InventoryBooking
} from "../utils/extraBedInventory";

describe("EXB-10 — countExtraBedsInUse (pure in-use computation)", () => {
  it("returns 0 when the candidate list is empty", () => {
    // The function is the pure calculation; the
    // Firestore query lives at the call site. An
    // empty list is the "first booking ever" edge
    // case — the in-use count is 0.
    const inUse = countExtraBedsInUse([], new Date("2026-09-01"), new Date("2026-09-03"));
    expect(inUse).toBe(0);
  });

  it("returns 0 when no candidate overlaps the requested range", () => {
    // A booking 1 week before + a booking 1 week
    // after — neither shares a night with the
    // 2-night range. The in-memory filter excludes
    // both.
    const bookings: InventoryBooking[] = [
      {
        id: "before",
        extraBedCount: 1,
        checkIn: new Date("2026-08-25"),
        checkOut: new Date("2026-08-26"),
        status: "confirmed"
      },
      {
        id: "after",
        extraBedCount: 1,
        checkIn: new Date("2026-09-10"),
        checkOut: new Date("2026-09-11"),
        status: "confirmed"
      }
    ];
    const inUse = countExtraBedsInUse(
      bookings,
      new Date("2026-09-01"),
      new Date("2026-09-03")
    );
    expect(inUse).toBe(0);
  });

  it("counts the extraBedCount of every overlapping occupying booking", () => {
    // 3 overlapping bookings: 1 + 2 + 0 = 3. The
    // 4th booking is the same night but cancelled
    // — must be excluded by `isBookingOccupyingRoom`.
    // The 5th is the same night but `pending` with
    // an expired hold — also excluded.
    const now = new Date("2026-09-01T12:00:00Z");
    const bookings: InventoryBooking[] = [
      {
        id: "b1",
        extraBedCount: 1,
        checkIn: new Date("2026-08-31"),
        checkOut: new Date("2026-09-02"),
        status: "confirmed"
      },
      {
        id: "b2",
        extraBedCount: 2,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-04"),
        status: "payment-confirmed"
      },
      {
        id: "b3",
        extraBedCount: 0,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-02"),
        status: "confirmed"
      },
      {
        id: "b4",
        extraBedCount: 1,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-03"),
        status: "cancelled"
      },
      {
        id: "b5",
        extraBedCount: 1,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-03"),
        status: "pending",
        holdExpiresAt: new Date("2026-08-31T00:00:00Z")
      }
    ];
    const inUse = countExtraBedsInUse(
      bookings,
      new Date("2026-09-01"),
      new Date("2026-09-03"),
      undefined,
      now
    );
    expect(inUse).toBe(3);
  });

  it("excludes the booking matching `excludeBookingId` (reschedule case)", () => {
    // Reschedule case: the booking being moved
    // already has an `extraBedCount`. Without the
    // exclude, the function would always reject
    // because the in-use count includes the booking's
    // own bed. The exclude must drop it.
    const bookings: InventoryBooking[] = [
      {
        id: "self",
        extraBedCount: 1,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-03"),
        status: "confirmed"
      }
    ];
    const inUse = countExtraBedsInUse(
      bookings,
      new Date("2026-09-01"),
      new Date("2026-09-03"),
      "self"
    );
    expect(inUse).toBe(0);
  });

  it("treats `checkOut` as not-a-stay-night (the canonical half-open overlap)", () => {
    // Existing booking: Sep 1 → Sep 2 (1 night:
    // Sep 1). New booking: Sep 2 → Sep 3 (1 night:
    // Sep 2). The two bookings share a calendar day
    // (Sep 2) but NOT a stay night. The existing
    // check-out IS the new check-in — the canonical
    // "checkout day doesn't count as a stay night"
    // rule. The half-open overlap test
    // (`existingEnd <= rangeStart`) excludes the
    // existing booking.
    const bookings: InventoryBooking[] = [
      {
        id: "checkout-day",
        extraBedCount: 1,
        checkIn: new Date("2026-09-01"),
        checkOut: new Date("2026-09-02"),
        status: "confirmed"
      }
    ];
    const inUse = countExtraBedsInUse(
      bookings,
      new Date("2026-09-02"),
      new Date("2026-09-03")
    );
    expect(inUse).toBe(0);
  });

  it("defensively coerces `extraBedCount` to a non-negative number (handles nullish / NaN)", () => {
    // Legacy pre-EXB-01 bookings may not have the
    // field. The defensive coercion treats
    // nullish / NaN / negative as 0 so the helper
    // never throws and never double-counts.
    const bookings: InventoryBooking[] = [
      { id: "legacy1", extraBedCount: null, checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"), status: "confirmed" },
      { id: "legacy2", extraBedCount: undefined, checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"), status: "confirmed" },
      { id: "legacy3", checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"), status: "confirmed" },
      { id: "nan", extraBedCount: NaN, checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"), status: "confirmed" }
    ];
    const inUse = countExtraBedsInUse(
      bookings,
      new Date("2026-09-01"),
      new Date("2026-09-03")
    );
    expect(inUse).toBe(0);
  });
});

describe("EXB-10 — checkExtraBedInventory (the pure decision)", () => {
  it("returns ok when inventory is 0 (the historical 'no constraint' default)", () => {
    // The hotel config's `extraBedInventory` defaults
    // to 0 (backfilled in `AdminContext.tsx` per
    // EXB-10). The helper treats 0 as "no
    // constraint" — every request is allowed, no
    // error message. The historical pre-EXB-10
    // behavior is preserved byte-equivalently.
    const result = checkExtraBedInventory(0, 0, 5);
    expect(result.ok).toBe(true);
    expect(result.available).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns ok when inventory > 0 and the request fits", () => {
    const result = checkExtraBedInventory(3, 1, 2);
    expect(result.ok).toBe(true);
    expect(result.inUse).toBe(1);
    expect(result.available).toBe(2);
  });

  it("returns not-ok when inventory > 0 and the request exceeds available", () => {
    // 3 beds total, 2 already in use, 2 requested.
    // `2 + 2 = 4 > 3` — reject.
    const result = checkExtraBedInventory(3, 2, 2);
    expect(result.ok).toBe(false);
    expect(result.inUse).toBe(2);
    expect(result.available).toBe(1);
  });

  it("returns ok when inventory > 0 and the request fits exactly", () => {
    // Boundary case: the request fills the inventory.
    // 3 - 1 = 2 available, 2 requested. `2 <= 2` is
    // true (not strictly less than). Accept.
    const result = checkExtraBedInventory(3, 1, 2);
    expect(result.ok).toBe(true);
    expect(result.available).toBe(2);
  });

  it("defensively coerces negative / non-finite inventory to 0 (treats as 'no constraint')", () => {
    // A hand-edited Firestore doc with a negative
    // inventory must not crash the helper. Treat as
    // "no constraint" (the historical behavior).
    expect(checkExtraBedInventory(-5, 0, 100).ok).toBe(true);
    expect(checkExtraBedInventory(NaN, 0, 100).ok).toBe(true);
    expect(checkExtraBedInventory(undefined as any, 0, 100).ok).toBe(true);
  });
});
