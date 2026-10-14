import { describe, expect, it } from "vitest";
import {
  normalizeStayRange,
  isValidStayRange,
  isValidIsoDate,
  addDaysToIsoDate,
  diffNightsBetweenIso,
  DEFAULT_MAX_STAY_NIGHTS
} from "../utils/stayRange";

// DR-01 (2026-10-14). The regression this suite pins: a guest could
// set check-in Oct 16 with check-out Oct 9 because the picker only
// guarded the check-out direction, and the server silently turned the
// inverted range into a 0-night booking.
const TODAY = "2026-10-14";

describe("stayRange — primitives", () => {
  it("rejects malformed and calendar-impossible dates", () => {
    expect(isValidIsoDate("2026-10-16")).toBe(true);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-10-1")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate(20261016)).toBe(false);
  });

  it("adds and subtracts days across month and DST boundaries", () => {
    expect(addDaysToIsoDate("2026-10-16", 1)).toBe("2026-10-17");
    expect(addDaysToIsoDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    // 2027-03-14 — a DST-shifting date in most western zones.
    expect(addDaysToIsoDate("2027-03-13", 1)).toBe("2027-03-14");
    expect(addDaysToIsoDate("garbage", 1, "fallback")).toBe("fallback");
  });

  it("returns a negative night count for an inverted range", () => {
    expect(diffNightsBetweenIso("2026-10-09", "2026-10-16")).toBe(7);
    expect(diffNightsBetweenIso("2026-10-16", "2026-10-09")).toBe(-7);
    expect(diffNightsBetweenIso("2026-10-16", "2026-10-16")).toBe(0);
  });
});

describe("stayRange — normalizeStayRange (DR-01)", () => {
  it("leaves an already-valid range untouched", () => {
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-18",
      minCheckIn: TODAY
    });
    expect(result).toEqual({
      checkIn: "2026-10-16",
      checkOut: "2026-10-18",
      nights: 2,
      adjustment: null
    });
  });

  it("THE REGRESSION: preserves the night count when check-in moves past check-out", () => {
    // Guest had Oct 9 -> Oct 11 (2 nights), then moved check-in to Oct 16.
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-09",
      minCheckIn: TODAY,
      previousNights: 2
    });
    expect(result.checkIn).toBe("2026-10-16");
    expect(result.checkOut).toBe("2026-10-18");
    expect(result.nights).toBe(2);
    expect(result.adjustment).toBe("nights-preserved");
  });

  it("preserves the night count across a month boundary", () => {
    const result = normalizeStayRange({
      checkIn: "2026-11-02",
      checkOut: "2026-10-20",
      minCheckIn: TODAY,
      previousNights: 3
    });
    expect(result.checkOut).toBe("2026-11-05");
    expect(result.nights).toBe(3);
  });

  it("falls back to the default length when there is no prior valid range", () => {
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-09",
      minCheckIn: TODAY
    });
    expect(result.checkOut).toBe("2026-10-17");
    expect(result.nights).toBe(1);
    expect(result.adjustment).toBe("check-out-clamped-after-check-in");
  });

  it("treats a same-day check-in/check-out as at least one night", () => {
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-16",
      minCheckIn: TODAY,
      previousNights: 2
    });
    expect(result.checkOut).toBe("2026-10-18");
    expect(result.nights).toBe(2);
  });

  it("clamps a past check-in to today", () => {
    const result = normalizeStayRange({
      checkIn: "2020-01-01",
      checkOut: "2026-10-18",
      minCheckIn: TODAY
    });
    expect(result.checkIn).toBe(TODAY);
    expect(result.adjustment).toBe("check-in-clamped-to-today");
  });

  it("sanitizes a malformed URL-supplied pair", () => {
    const result = normalizeStayRange({
      checkIn: "not-a-date",
      checkOut: "",
      minCheckIn: TODAY
    });
    expect(result.checkIn).toBe(TODAY);
    expect(isValidIsoDate(result.checkOut)).toBe(true);
    expect(result.checkOut > result.checkIn).toBe(true);
    expect(result.nights).toBeGreaterThanOrEqual(1);
  });

  it("seeds a default range when both inputs are blank", () => {
    const result = normalizeStayRange({ checkIn: "", checkOut: "", minCheckIn: TODAY });
    expect(result.checkIn).toBe(TODAY);
    expect(result.checkOut).toBe("2026-10-15");
    expect(result.adjustment).toBe("empty");
  });

  it("accepts a check-out supplied without a check-in", () => {
    const result = normalizeStayRange({
      checkIn: "",
      checkOut: "2026-10-20",
      minCheckIn: TODAY,
      defaultNights: 2
    });
    expect(result.checkIn).toBe("2026-10-18");
    expect(result.checkOut).toBe("2026-10-20");
    expect(result.nights).toBe(2);
  });

  it("caps an absurd night count at the booking horizon", () => {
    // Check-in is 2 days after today, so the 30-night horizon only
    // accommodates 28 nights from that check-in. The cap must be
    // measured from the check-in, not from today.
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-09",
      minCheckIn: TODAY,
      previousNights: 4000,
      maxNights: 30
    });
    expect(result.nights).toBeLessThanOrEqual(DEFAULT_MAX_STAY_NIGHTS);
    expect(result.checkOut).toBe("2026-11-13");
    expect(result.nights).toBe(diffNightsBetweenIso(result.checkIn, result.checkOut));
  });

  it("caps check-out at the booking horizon", () => {
    const result = normalizeStayRange({
      checkIn: "2026-11-01",
      checkOut: "2027-06-01",
      minCheckIn: TODAY,
      maxNights: 30
    });
    expect(result.adjustment).toBe("horizon-capped");
    expect(result.checkOut).toBe("2026-11-13");
    expect(result.nights).toBe(12);
  });

  it("never returns an inverted or zero-night range for any input pair", () => {
    const inputs = [
      { checkIn: "2026-10-16", checkOut: "2026-10-09" },
      { checkIn: "2026-10-16", checkOut: "2026-10-16" },
      { checkIn: "2026-10-16", checkOut: "" },
      { checkIn: "", checkOut: "2026-10-16" },
      { checkIn: "1999-01-01", checkOut: "1998-01-01" },
      { checkIn: "junk", checkOut: "junk" },
      { checkIn: null, checkOut: null }
    ];
    for (const input of inputs) {
      const result = normalizeStayRange({ ...input, minCheckIn: TODAY, previousNights: 2 });
      expect(isValidIsoDate(result.checkIn)).toBe(true);
      expect(isValidIsoDate(result.checkOut)).toBe(true);
      expect(result.checkIn >= TODAY).toBe(true);
      expect(diffNightsBetweenIso(result.checkIn, result.checkOut)).toBeGreaterThanOrEqual(1);
      expect(result.nights).toBe(diffNightsBetweenIso(result.checkIn, result.checkOut));
    }
  });

  it("never invents a stay longer than the horizon allows", () => {
    const result = normalizeStayRange({
      checkIn: "2026-11-01",
      checkOut: "2026-11-01",
      minCheckIn: TODAY,
      previousNights: 30,
      maxNights: 30
    });
    expect(diffNightsBetweenIso(result.checkIn, result.checkOut)).toBeGreaterThanOrEqual(1);
  });
});

describe("stayRange — isValidStayRange", () => {
  it("accepts only real, bookable, non-past ranges", () => {
    expect(isValidStayRange("2026-10-16", "2026-10-18", TODAY)).toBe(true);
    expect(isValidStayRange("2026-10-16", "2026-10-09", TODAY)).toBe(false);
    expect(isValidStayRange("2026-10-16", "2026-10-16", TODAY)).toBe(false);
    expect(isValidStayRange("2020-01-01", "2026-10-18", TODAY)).toBe(false);
    expect(isValidStayRange("", "2026-10-18", TODAY)).toBe(false);
    expect(isValidStayRange(null, null, TODAY)).toBe(false);
  });
});