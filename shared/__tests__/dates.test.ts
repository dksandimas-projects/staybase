import { describe, expect, test } from "vitest";
import { getNumNights, isWeekendNight, datesOverlap, getWeekendNightCount } from "../utils/dates";

describe("date utilities", () => {
  test("calculates numNights from check-in and check-out", () => {
    // 1 night
    expect(getNumNights("2026-06-08", "2026-06-09")).toBe(1);
    // 3 nights
    expect(getNumNights("2026-06-08", "2026-06-11")).toBe(3);
    // Same day is 0 nights
    expect(getNumNights("2026-06-08", "2026-06-08")).toBe(0);
    // Out before in is 0 nights
    expect(getNumNights("2026-06-09", "2026-06-08")).toBe(0);
  });

  test("detects weekend nights", () => {
    // 2026-06-06 is Saturday (UTC weekend night)
    expect(isWeekendNight("2026-06-06")).toBe(true);
    // 2026-06-07 is Sunday (UTC weekend night)
    expect(isWeekendNight("2026-06-07")).toBe(true);
    // 2026-06-08 is Monday (not a weekend night)
    expect(isWeekendNight("2026-06-08")).toBe(false);
  });

  test("calculates weekend night count", () => {
    // Mon to Fri (4 nights: Mon, Tue, Wed, Thu) -> 0 weekend nights
    expect(getWeekendNightCount("2026-06-08", "2026-06-12")).toBe(0);
    // Fri to Mon (3 nights: Fri, Sat, Sun) -> Sat and Sun are weekend nights (2 count)
    expect(getWeekendNightCount("2026-06-05", "2026-06-08")).toBe(2);
  });

  test("detects overlapping booking ranges", () => {
    // Overlap: A starts before B ends, A ends after B starts
    // Stay A: June 8 - June 10, Stay B: June 9 - June 11
    expect(datesOverlap("2026-06-08", "2026-06-10", "2026-06-09", "2026-06-11")).toBe(true);
    // Stay A: June 8 - June 10, Stay B: June 10 - June 12 (adjacent, no overlap)
    expect(datesOverlap("2026-06-08", "2026-06-10", "2026-06-10", "2026-06-12")).toBe(false);
    // Stay A: June 10 - June 12, Stay B: June 8 - June 10 (adjacent, no overlap)
    expect(datesOverlap("2026-06-10", "2026-06-12", "2026-06-08", "2026-06-10")).toBe(false);
    // Complete overlap (A inside B)
    expect(datesOverlap("2026-06-09", "2026-06-10", "2026-06-08", "2026-06-11")).toBe(true);
  });
});
