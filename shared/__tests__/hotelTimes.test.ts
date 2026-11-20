// Per HC-02 (decision #329, 2026-11-20): the hotel's CHECK-IN /
// CHECK-OUT TIMES have ONE source of truth — `settings/hotelConfig`.
//
// The house rules are free prose the admin typed, and they used to
// quote the times by hand ("Check-in time is 2:00 PM. Check-out time
// is 12:00 PM.") while the live `hotelConfig` said `checkInTime:
// "14:00"` / `checkOutTime: "11:00"`. The two already disagreed —
// the email told the guest 12:00 PM while the booking flow told them
// 11:00.
//
// This suite pins the shared half of the fix: the times are a
// VARIABLE the rules reference by token, resolved against the one
// source before they render.

import { describe, expect, it } from "vitest";
import {
  CHECK_IN_TIME_TOKEN,
  CHECK_OUT_TIME_TOKEN,
  formatHotelTimeLabel,
  interpolateHotelTimes,
  resolveHotelTimes
} from "../utils/hotelTimes";

describe("HC-02 — formatHotelTimeLabel", () => {
  it("renders a 24-hour value as a 12-hour label", () => {
    expect(formatHotelTimeLabel("14:00")).toBe("2:00 PM");
    expect(formatHotelTimeLabel("11:00")).toBe("11:00 AM");
    expect(formatHotelTimeLabel("09:30")).toBe("9:30 AM");
    expect(formatHotelTimeLabel("00:30")).toBe("12:30 AM");
    expect(formatHotelTimeLabel("12:00")).toBe("12:00 PM");
  });

  it("normalises an already-12-hour value to the same width", () => {
    expect(formatHotelTimeLabel("2:00 PM")).toBe("2:00 PM");
    expect(formatHotelTimeLabel("2 pm")).toBe("2:00 PM");
    expect(formatHotelTimeLabel("11:00 am")).toBe("11:00 AM");
  });

  it("returns a blank string for a blank value", () => {
    expect(formatHotelTimeLabel("")).toBe("");
    expect(formatHotelTimeLabel("   ")).toBe("");
    expect(formatHotelTimeLabel(undefined)).toBe("");
    expect(formatHotelTimeLabel(null)).toBe("");
  });

  it("returns a non-time value VERBATIM (the admin's wording wins)", () => {
    expect(formatHotelTimeLabel("Flexible")).toBe("Flexible");
    expect(formatHotelTimeLabel("On request")).toBe("On request");
  });

  it("renders the same label the booking Step 2 dropdown uses", () => {
    // The arrival-time dropdown is built from the same `checkInTime`
    // value, so the email and the dropdown must read identically.
    expect(formatHotelTimeLabel("14:00")).toBe("2:00 PM");
    expect(formatHotelTimeLabel("2:00 PM")).toBe("2:00 PM");
  });
});

describe("HC-02 — resolveHotelTimes", () => {
  const FALLBACK = { checkInTime: "14:00", checkOutTime: "12:00" };

  it("prefers the runtime values over the deploy-time ones", () => {
    const times = resolveHotelTimes(
      { checkInTime: "14:00", checkOutTime: "11:00" },
      FALLBACK
    );
    expect(times.checkInTime).toBe("2:00 PM");
    expect(times.checkOutTime).toBe("11:00 AM");
  });

  it("falls back per field when the runtime document does not carry it", () => {
    const times = resolveHotelTimes({ checkInTime: "14:00" }, FALLBACK);
    expect(times.checkInTime).toBe("2:00 PM");
    expect(times.checkOutTime).toBe("12:00 PM");
  });

  it("falls back when the runtime value is blank", () => {
    const times = resolveHotelTimes(
      { checkInTime: "  ", checkOutTime: "" },
      FALLBACK
    );
    expect(times.checkInTime).toBe("2:00 PM");
    expect(times.checkOutTime).toBe("12:00 PM");
  });

  it("returns empty strings (not undefined) when there is no source", () => {
    expect(resolveHotelTimes(null)).toEqual({ checkInTime: "", checkOutTime: "" });
    expect(resolveHotelTimes("not an object")).toEqual({
      checkInTime: "",
      checkOutTime: ""
    });
  });
});

describe("HC-02 — interpolateHotelTimes", () => {
  const TIMES = { checkInTime: "2:00 PM", checkOutTime: "11:00 AM" };

  it("substitutes both tokens", () => {
    const out = interpolateHotelTimes(
      `Check-in time is ${CHECK_IN_TIME_TOKEN}. Check-out time is ${CHECK_OUT_TIME_TOKEN}.`,
      TIMES
    );
    expect(out).toBe("Check-in time is 2:00 PM. Check-out time is 11:00 AM.");
  });

  it("leaves the rest of the prose untouched", () => {
    const out = interpolateHotelTimes(
      `No smoking inside rooms. Check-in time is ${CHECK_IN_TIME_TOKEN}.`,
      TIMES
    );
    expect(out).toBe("No smoking inside rooms. Check-in time is 2:00 PM.");
  });

  it("substitutes EVERY occurrence of a token", () => {
    const out = interpolateHotelTimes(
      `${CHECK_IN_TIME_TOKEN} and again ${CHECK_IN_TIME_TOKEN}`,
      TIMES
    );
    expect(out).toBe("2:00 PM and again 2:00 PM");
  });

  it("leaves a token in place when its time is blank (no broken sentence)", () => {
    const out = interpolateHotelTimes(
      `Check-in time is ${CHECK_IN_TIME_TOKEN}.`,
      { checkInTime: "", checkOutTime: "11:00 AM" }
    );
    expect(out).toBe(`Check-in time is ${CHECK_IN_TIME_TOKEN}.`);
  });

  it("returns the text unchanged when there is no token in it", () => {
    const text = "No smoking inside rooms.";
    expect(interpolateHotelTimes(text, TIMES)).toBe(text);
  });
});
