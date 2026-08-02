import { describe, expect, it } from "vitest";
import {
  isBookingOccupyingRoom,
  computeHoldExpiresAt,
  normalizePaymentHoldWindowHours,
  BOOKING_OCCUPYING_STATUSES,
  EXPIRED_HOLD_CANCELLATION_REASON,
  CANCELLATION_SOURCES,
  GUEST_CANCELLABLE_STATUSES,
  STAFF_CANCELLABLE_STATUSES,
  TERMINAL_CANCELLATION_STATUSES,
  DEFAULT_PAYMENT_HOLD_WINDOW_HOURS,
  MIN_PAYMENT_HOLD_WINDOW_HOURS,
  MAX_PAYMENT_HOLD_WINDOW_HOURS
} from "../utils/bookingOccupancy";

describe("bookingOccupancy — isBookingOccupyingRoom (PEX-02)", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  it("returns false for cancelled / checked-out / null / undefined statuses", () => {
    expect(isBookingOccupyingRoom({ status: "cancelled" }, now)).toBe(false);
    expect(isBookingOccupyingRoom({ status: "checked-out" }, now)).toBe(false);
    expect(isBookingOccupyingRoom({ status: null }, now)).toBe(false);
    expect(isBookingOccupyingRoom({ status: undefined }, now)).toBe(false);
    expect(isBookingOccupyingRoom({}, now)).toBe(false);
  });

  it("returns true for `payment-uploaded` regardless of deadline (staff-review state, never auto-expired per PEX-04)", () => {
    // The snapshotted deadline is irrelevant for `payment-uploaded`:
    // staff is reviewing, the booking occupies until staff confirms
    // or rejects. A deadline in the past is fine.
    expect(isBookingOccupyingRoom({
      status: "payment-uploaded",
      holdExpiresAt: new Date("2020-01-01T00:00:00Z")
    }, now)).toBe(true);
    // Even with no deadline, payment-uploaded occupies.
    expect(isBookingOccupyingRoom({ status: "payment-uploaded" }, now)).toBe(true);
  });

  it("returns true for `payment-confirmed` / `confirmed` / `checked-in` regardless of deadline", () => {
    // These are real reservations — the deadline does not apply
    // once the room is committed.
    for (const status of ["payment-confirmed", "confirmed", "checked-in"] as const) {
      expect(isBookingOccupyingRoom({
        status,
        holdExpiresAt: new Date("2020-01-01T00:00:00Z")
      }, now)).toBe(true);
      expect(isBookingOccupyingRoom({ status }, now)).toBe(true);
    }
  });

  it("returns true for `pending` when no `holdExpiresAt` is set (legacy booking)", () => {
    // Per the spec: "legacy bookings without `holdExpiresAt` still
    // occupy". The field is null → occupies, not null → free.
    expect(isBookingOccupyingRoom({ status: "pending" }, now)).toBe(true);
    expect(isBookingOccupyingRoom({ status: "pending", holdExpiresAt: null }, now)).toBe(true);
  });

  it("returns true for `pending` when the deadline is strictly in the future", () => {
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: new Date("2026-08-01T12:00:00Z")
    }, now)).toBe(true);
  });

  it("returns false for `pending` when the deadline is at or before `now` (expired hold)", () => {
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: new Date("2026-08-01T10:00:00Z") // exactly now
    }, now)).toBe(false);
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: new Date("2026-08-01T09:59:59Z")
    }, now)).toBe(false);
  });

  it("accepts a string deadline (ISO) and parses it", () => {
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: "2026-08-01T11:00:00Z"
    }, now)).toBe(true);
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: "2026-08-01T09:00:00Z"
    }, now)).toBe(false);
  });

  it("treats an unparseable deadline as occupying (defensive default)", () => {
    // A bad deadline must not silently free the room.
    expect(isBookingOccupyingRoom({
      status: "pending",
      holdExpiresAt: "not-a-date"
    }, now)).toBe(true);
  });
});

describe("bookingOccupancy — computeHoldExpiresAt (PEX-01)", () => {
  it("returns a Date exactly windowHours in the future", () => {
    const now = new Date("2026-08-01T10:00:00Z");
    const expires = computeHoldExpiresAt(24, now);
    expect(expires).not.toBeNull();
    expect(expires!.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns null for missing / zero / negative / non-finite windows", () => {
    const now = new Date();
    expect(computeHoldExpiresAt(null, now)).toBeNull();
    expect(computeHoldExpiresAt(undefined, now)).toBeNull();
    expect(computeHoldExpiresAt(0, now)).toBeNull();
    expect(computeHoldExpiresAt(-5, now)).toBeNull();
    expect(computeHoldExpiresAt(Number.NaN, now)).toBeNull();
    expect(computeHoldExpiresAt(Number.POSITIVE_INFINITY, now)).toBeNull();
  });
});

describe("bookingOccupancy — normalizePaymentHoldWindowHours (PEX-01)", () => {
  it("returns the default for non-finite / zero / negative / null / undefined", () => {
    expect(normalizePaymentHoldWindowHours(null)).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(undefined)).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(0)).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(-5)).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(Number.NaN)).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours("not-a-number")).toBe(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS);
  });

  it("clamps to MIN..MAX inclusive", () => {
    expect(normalizePaymentHoldWindowHours(0.5)).toBe(MIN_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(1)).toBe(1);
    expect(normalizePaymentHoldWindowHours(24)).toBe(24);
    expect(normalizePaymentHoldWindowHours(MAX_PAYMENT_HOLD_WINDOW_HOURS)).toBe(MAX_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(MAX_PAYMENT_HOLD_WINDOW_HOURS + 1)).toBe(MAX_PAYMENT_HOLD_WINDOW_HOURS);
    expect(normalizePaymentHoldWindowHours(9999)).toBe(MAX_PAYMENT_HOLD_WINDOW_HOURS);
  });

  it("floors fractional values (a 23.7h window becomes 23h, not 24h)", () => {
    expect(normalizePaymentHoldWindowHours(23.7)).toBe(23);
    expect(normalizePaymentHoldWindowHours(23.999)).toBe(23);
  });

  it("exposes the documented constant values", () => {
    expect(DEFAULT_PAYMENT_HOLD_WINDOW_HOURS).toBe(24);
    expect(MIN_PAYMENT_HOLD_WINDOW_HOURS).toBe(1);
    expect(MAX_PAYMENT_HOLD_WINDOW_HOURS).toBe(72);
  });
});

describe("bookingOccupancy — constants (PEX-02 + PEX-03)", () => {
  it("BOOKING_OCCUPYING_STATUSES is the canonical 5-value list", () => {
    expect(BOOKING_OCCUPYING_STATUSES).toEqual([
      "pending",
      "payment-uploaded",
      "payment-confirmed",
      "confirmed",
      "checked-in"
    ]);
  });

  it("EXPIRED_HOLD_CANCELLATION_REASON is the documented string", () => {
    // Pinned by both the in-transaction retirement + the cron
    // handler. A typo would silently break Reports + guest lookup
    // filters that key off this string.
    expect(EXPIRED_HOLD_CANCELLATION_REASON).toBe("payment-hold-expired");
  });

  it("CANCELLATION_SOURCES is the three-source discriminator pinned by CRL-02", () => {
    // The list is the contract for every cancellation write path.
    // A typo on any stamp would break Reports / emails / future
    // refund-liability (CRL-07) which key off this string. Adding
    // a fourth value requires a coordinated type + every write
    // site + a test for the new value.
    expect(CANCELLATION_SOURCES).toEqual(["guest", "staff", "system"]);
  });

  it("CRL-06 status matrix: guest and staff can cancel every pre-arrival status", () => {
    // Pinned because handleCancelBooking reads the sets at runtime
    // via `.includes(...)`; a typo on any value would silently
    // shift the auth boundary. Guest + staff are disjoint for the
    // CRL-06 expands the guest path to the paid pre-arrival
    // statuses after adding the policy-derived preview.
    expect(GUEST_CANCELLABLE_STATUSES).toEqual([
      "pending",
      "payment-uploaded",
      "payment-confirmed",
      "confirmed"
    ]);
    expect(STAFF_CANCELLABLE_STATUSES).toEqual([
      "pending",
      "payment-uploaded",
      "payment-confirmed",
      "confirmed"
    ]);
    // Per MRB-05 PR #2 (2026-08-02, per decision #159):
    // `checked-out` moved out of the universal reject
    // list — staff-initiated cancellation is now
    // allowed for the post-settlement path (with a
    // loyalty clawback recorded in the awarding
    // member's `pointsHistory`).
    expect(TERMINAL_CANCELLATION_STATUSES).toEqual([
      "checked-in",
      "cancelled"
    ]);
  });
});
