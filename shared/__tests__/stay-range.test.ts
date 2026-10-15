import { describe, expect, it } from "vitest";
import {
  normalizeStayRange,
  isValidStayRange,
  isValidIsoDate,
  addDaysToIsoDate,
  diffNightsBetweenIso,
  DEFAULT_MAX_STAY_NIGHTS,
  DEFAULT_BOOKING_HORIZON_DAYS,
  resolveRangeSelection,
  resolveMaxStayNights,
  describeMaxStayNights,
  isUnlimitedStay,
  MAX_MAX_STAY_NIGHTS
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

  it("caps an absurd night count at the stay-length cap, measured from check-in", () => {
    // DR-03 changed this test's premise. It used to assert the cap came
    // from the 30-day booking HORIZON, trimming a 30-night stay that
    // started 2 days after today down to 28 nights. The horizon is now a
    // YEAR, so it no longer binds here — the stay-LENGTH cap does, and it
    // is measured from the check-in rather than from today.
    const result = normalizeStayRange({
      checkIn: "2026-10-16",
      checkOut: "2026-10-09",
      minCheckIn: TODAY,
      previousNights: 4000,
      maxNights: 30
    });
    expect(result.nights).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(result.checkOut).toBe("2026-11-15");
    expect(result.nights).toBe(diffNightsBetweenIso(result.checkIn, result.checkOut));
    expect(result.adjustment).toBe("nights-preserved");
  });

  it("caps check-out at the booking horizon", () => {
    // `maxNights` is raised so the HORIZON is the binding constraint.
    // With the default 30-night cap the night clamp always wins first
    // (any range past a 365-day horizon is necessarily >30 nights),
    // so this test must opt out of the cap to exercise this branch.
    const result = normalizeStayRange({
      checkIn: "2026-11-01",
      checkOut: "2028-01-01",
      minCheckIn: TODAY,
      maxNights: 400
    });
    expect(result.adjustment).toBe("horizon-capped");
    expect(result.checkOut).toBe(addDaysToIsoDate(TODAY, DEFAULT_BOOKING_HORIZON_DAYS));
    expect(result.nights).toBe(diffNightsBetweenIso(result.checkIn, result.checkOut));
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
// ---------------------------------------------------------------------------
// DR-02 (2026-10-15): range-calendar selection resolution.
//
// This suite exists because the two-step contract is where the real
// bug was. A calendar's range mode reports the FIRST click of a new
// selection as `{ from: day, to: day }` — same day, not
// `to: undefined`. Treating any `to` as "complete" committed a
// 1-night range on a single click, which fired an availability refetch
// that swapped the booking page for a full-page loader and unmounted
// the picker. The guest's single click silently vanished.
// ---------------------------------------------------------------------------

describe("stayRange — resolveRangeSelection (DR-02)", () => {
  const TODAY = "2026-10-15";
  const HORIZON = "2026-11-14";
  const select = (from?: string | null, to?: string | null) =>
    resolveRangeSelection({ from, to, minCheckIn: TODAY, maxCheckOut: HORIZON });

  it("THE REGRESSION: a same-day click is pending, never complete", () => {
    // react-day-picker's first click returns from === to. Committing
    // here is what unmounted the picker mid-selection.
    expect(select("2026-10-20", "2026-10-20")).toEqual({
      status: "pending",
      checkIn: "2026-10-20"
    });
  });

  it("completes once a strictly later day is chosen", () => {
    expect(select("2026-10-20", "2026-10-23")).toEqual({
      status: "complete",
      checkIn: "2026-10-20",
      checkOut: "2026-10-23",
      nights: 3
    });
  });

  it("treats a first click with no `to` as pending", () => {
    expect(select("2026-10-20", null)).toEqual({ status: "pending", checkIn: "2026-10-20" });
    expect(select("2026-10-20", undefined)).toEqual({ status: "pending", checkIn: "2026-10-20" });
  });

  it("restarts the selection when the second click runs backwards", () => {
    // Clicking a day at or before the pending check-in starts a NEW
    // selection; it must never produce an inverted range.
    expect(select("2026-10-20", "2026-10-18")).toEqual({
      status: "pending",
      checkIn: "2026-10-20"
    });
  });

  it("clears when there is no usable check-in", () => {
    expect(select(null, "2026-10-20")).toEqual({ status: "cleared" });
    expect(select(undefined, undefined)).toEqual({ status: "cleared" });
    expect(select("garbage", "2026-10-20")).toEqual({ status: "cleared" });
  });

  it("floors a past check-in at today", () => {
    expect(select("2020-01-01", "2026-10-20")).toEqual({
      status: "complete",
      checkIn: TODAY,
      checkOut: "2026-10-20",
      nights: 5
    });
  });

  it("refuses to complete past the booking horizon", () => {
    expect(select("2026-11-01", "2027-06-01")).toEqual({
      status: "pending",
      checkIn: "2026-11-01"
    });
  });

  it("never completes a zero-night or inverted range, for ANY input pair", () => {
    const inputs = [
      ["2026-10-20", "2026-10-20"],
      ["2026-10-20", "2026-10-19"],
      ["2026-10-20", "2026-10-01"],
      ["2020-01-01", "2019-01-01"],
      ["2026-11-01", "2030-01-01"]
    ];
    for (const [from, to] of inputs) {
      const result = select(from, to);
      if (result.status === "complete") {
        expect(result.checkOut).not.toBe(result.checkIn);
        expect(result.nights).toBe(diffNightsBetweenIso(result.checkIn, result.checkOut));
        expect(result.nights).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("is idempotent for an already-complete range", () => {
    const a = select("2026-10-20", "2026-10-23");
    const b = select("2026-10-20", "2026-10-23");
    expect(a).toEqual(b);
  });
});

describe("stayRange — booking horizon vs. stay length (DR-03)", () => {
  // DR-03 (2026-10-15). `MAX_STAY_NIGHTS` doubled as the booking
  // horizon, so `maxCheckOut = today + 30` capped the calendar at
  // Nov 14 and December was unreachable — the owner read a working
  // pager as a broken one. These two limits are separate policies.

  it("reaches December with the default horizon", () => {
    const result = normalizeStayRange({
      checkIn: "2026-12-01",
      checkOut: "2026-12-05",
      minCheckIn: TODAY
    });
    expect(result.adjustment).toBeNull();
    expect(result.checkIn).toBe("2026-12-01");
    expect(result.checkOut).toBe("2026-12-05");
    expect(result.nights).toBe(4);
  });

  it("defaults the horizon to a year, not to maxNights", () => {
    const far = addDaysToIsoDate(TODAY, DEFAULT_BOOKING_HORIZON_DAYS);
    expect(far).toBe("2027-10-14");
    // The old bug: the horizon fell back to `today + maxNights`.
    expect(far).not.toBe(addDaysToIsoDate(TODAY, DEFAULT_MAX_STAY_NIGHTS));
    const result = normalizeStayRange({
      checkIn: "2027-10-13",
      checkOut: "2027-10-14",
      minCheckIn: TODAY
    });
    expect(result.checkOut).toBe("2027-10-14");
    expect(result.adjustment).toBeNull();
  });

  it("enforces the horizon when the night cap is not the binding limit", () => {
    const result = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2028-10-14",
      minCheckIn: TODAY,
      maxNights: 400
    });
    expect(result.checkOut).toBe(addDaysToIsoDate(TODAY, DEFAULT_BOOKING_HORIZON_DAYS));
    expect(result.adjustment).toBe("horizon-capped");
  });

  it("lets the horizon override the night clamp near the far edge", () => {
    // check-in sits 4 days before the horizon, so a 30-night stay
    // overshoots it and the horizon becomes the binding constraint.
    const checkIn = "2027-10-10";
    const result = normalizeStayRange({
      checkIn,
      checkOut: "2027-11-20",
      minCheckIn: TODAY
    });
    expect(result.checkIn).toBe(checkIn);
    expect(result.checkOut).toBe("2027-10-14");
    expect(result.adjustment).toBe("horizon-capped");
    expect(result.nights).toBe(4);
  });

  it("THE REGRESSION: clamps a long-but-valid stay to the night cap", () => {
    // Oct 1 + 60 nights is within the (now-year-wide) horizon, so
    // nothing else caught it: `stayCap` used to apply ONLY on the
    // inverted branch, letting an over-long stay through unchecked.
    const result = normalizeStayRange({
      checkIn: "2026-12-01",
      checkOut: "2027-01-30",
      minCheckIn: TODAY
    });
    expect(result.checkIn).toBe("2026-12-01");
    expect(result.checkOut).toBe("2026-12-31");
    expect(result.nights).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(result.adjustment).toBe("nights-clamped");
  });

  it("does not clamp a stay at exactly the cap", () => {
    const result = normalizeStayRange({
      checkIn: "2026-12-01",
      checkOut: "2026-12-31",
      minCheckIn: TODAY
    });
    expect(result.nights).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(result.adjustment).toBeNull();
  });

  it("resolveRangeSelection refuses an over-long stay beyond the horizon", () => {
    const resolved = resolveRangeSelection({
      from: "2027-10-01",
      to: "2027-10-20",
      minCheckIn: TODAY,
      maxCheckOut: "2027-10-14"
    });
    // The horizon check fires first for this pair.
    expect(resolved.status).toBe("pending");

    // Within the horizon but over the night cap: must stay pending.
    const overLong = resolveRangeSelection({
      from: "2026-12-01",
      to: "2027-01-30",
      minCheckIn: TODAY,
      maxCheckOut: "2027-10-14",
      maxNights: DEFAULT_MAX_STAY_NIGHTS
    });
    expect(overLong).toEqual({ status: "pending", checkIn: "2026-12-01" });
  });

  it("still completes a normal stay well past the old 30-day wall", () => {
    // Nov 20 is beyond `today + 30` — the exact date range the guest
    // reported as unreachable.
    expect(
      resolveRangeSelection({
        from: "2026-11-20",
        to: "2026-11-24",
        minCheckIn: TODAY,
        maxCheckOut: "2027-10-14",
        maxNights: DEFAULT_MAX_STAY_NIGHTS
      })
    ).toEqual({ status: "complete", checkIn: "2026-11-20", checkOut: "2026-11-24", nights: 4 });
  });
});

// ---------------------------------------------------------------------------
// MSL-01 (2026-10-15): the stay-length cap became a per-hotel setting
// (`settings/hotelConfig.maxStayNights`). The regression this suite
// pins is the `0` trap: `0` is the admin's "no limit" choice, but
// `Math.max(Math.min(0, horizon), 1) === 1` — passing it through raw
// would collapse EVERY stay to a single night.
// ---------------------------------------------------------------------------
describe("stayRange — resolveMaxStayNights", () => {
  it("treats an ABSENT field as the historical default, never as unlimited", () => {
    // `Number(undefined)` is NaN, so a resolver that only checked "is
    // it finite?" would read every un-migrated install as unlimited and
    // quietly open existing hotels to unbounded stays.
    expect(resolveMaxStayNights(undefined)).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights(null)).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights("")).toBe(DEFAULT_MAX_STAY_NIGHTS);
  });

  it("maps the admin's explicit 0 to Infinity (no limit)", () => {
    expect(resolveMaxStayNights(0)).toBe(Infinity);
    expect(resolveMaxStayNights("0")).toBe(Infinity);
    // -0 must not sneak past the `value < 0` guard as a negative.
    expect(resolveMaxStayNights(-0)).toBe(Infinity);
  });

  it("never floors a fractional value down to 0", () => {
    // THE subtle case. Flooring happens after the `0` test, so 0.5
    // floors to 0 and would re-enter as an UNLIMITED cap — the exact
    // inversion the admin did not ask for.
    expect(resolveMaxStayNights(0.5)).toBe(1);
    expect(resolveMaxStayNights(0.1)).toBe(1);
    expect(resolveMaxStayNights(1.9)).toBe(1);
  });

  it("fails CLOSED on garbage — never opens to unlimited", () => {
    expect(resolveMaxStayNights(-5)).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights(NaN)).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights("abc")).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights({})).toBe(DEFAULT_MAX_STAY_NIGHTS);
    expect(resolveMaxStayNights(Infinity)).toBe(DEFAULT_MAX_STAY_NIGHTS);
  });

  it("passes through a positive value and clamps to the reachable horizon", () => {
    expect(resolveMaxStayNights(14)).toBe(14);
    expect(resolveMaxStayNights("90")).toBe(90);
    expect(resolveMaxStayNights(45.7)).toBe(45);
    // A stay longer than the booking horizon is unreachable anyway —
    // store the horizon rather than a number it would override.
    expect(resolveMaxStayNights(9999)).toBe(MAX_MAX_STAY_NIGHTS);
    expect(MAX_MAX_STAY_NIGHTS).toBe(DEFAULT_BOOKING_HORIZON_DAYS);
  });
});

describe("stayRange — unlimited stays survive every clamp site", () => {
  it("does NOT collapse to one night (the Math.max(..., 1) trap)", () => {
    // The trap, demonstrated: passing the RAW 0 makes
    // `stayCap = Math.max(Math.min(0, horizon), 1)` === 1, and the
    // length clamp becomes `addDaysToIsoDate(checkIn, 0)` — a
    // zero-night range the final guard then bumps to 1 night.
    const raw = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2026-10-19", // 5 nights
      minCheckIn: TODAY,
      maxNights: 0,
      maxCheckOut: "2027-10-14"
    });
    // The reason label is then overwritten by the final inversion
    // guard, so assert the outcome that matters: the 5 nights are gone.
    expect(raw.nights).toBe(1);
    expect(raw.checkOut).not.toBe("2026-10-19");

    // The resolved value keeps the guest's 5 nights intact.
    const resolved = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2026-10-19",
      minCheckIn: TODAY,
      maxNights: resolveMaxStayNights(0),
      maxCheckOut: "2027-10-14"
    });
    expect(resolved.nights).toBe(5);
    expect(resolved.adjustment).toBeNull();
    expect(resolved.checkOut).toBe("2026-10-19");
  });

  it("accepts a long stay that a capped hotel would refuse", () => {
    const ninety = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2026-12-31",
      minCheckIn: TODAY,
      maxNights: resolveMaxStayNights(0),
      maxCheckOut: "2027-10-14"
    });
    expect(ninety.adjustment).toBeNull();
    expect(ninety.nights).toBe(diffNightsBetweenIso(TODAY, "2026-12-31"));

    // Same input against the default cap is refused.
    const capped = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2026-12-31",
      minCheckIn: TODAY,
      maxNights: resolveMaxStayNights(undefined),
      maxCheckOut: "2027-10-14"
    });
    expect(capped.adjustment).toBe("nights-clamped");
    expect(capped.nights).toBe(DEFAULT_MAX_STAY_NIGHTS);
  });

  it("still enforces the horizon when the stay cap is unlimited", () => {
    // Unlimited nights must not mean unlimited dates.
    const result = normalizeStayRange({
      checkIn: TODAY,
      checkOut: "2028-01-01",
      minCheckIn: TODAY,
      maxNights: resolveMaxStayNights(0),
      maxCheckOut: "2027-10-14"
    });
    expect(result.adjustment).toBe("horizon-capped");
    expect(result.checkOut).toBe("2027-10-14");
  });

  it("completes a long range in the calendar resolver", () => {
    expect(
      resolveRangeSelection({
        from: TODAY,
        to: "2026-12-31",
        minCheckIn: TODAY,
        maxCheckOut: "2027-10-14",
        maxNights: resolveMaxStayNights(0)
      })
    ).toEqual({ status: "complete", checkIn: TODAY, checkOut: "2026-12-31", nights: 78 });
  });

  it("keeps refusing the same range at the default cap", () => {
    expect(
      resolveRangeSelection({
        from: TODAY,
        to: "2026-12-31",
        minCheckIn: TODAY,
        maxCheckOut: "2027-10-14",
        maxNights: resolveMaxStayNights(undefined)
      })
    ).toEqual({ status: "pending", checkIn: TODAY });
  });
});

describe("stayRange — describeMaxStayNights", () => {
  it("reads the same way in the server 400 and the picker banner", () => {
    expect(describeMaxStayNights(30)).toBe("30 nights");
    expect(describeMaxStayNights(Infinity)).toBe("no maximum");
    expect(isUnlimitedStay(Infinity)).toBe(true);
    expect(isUnlimitedStay(30)).toBe(false);
  });
});
