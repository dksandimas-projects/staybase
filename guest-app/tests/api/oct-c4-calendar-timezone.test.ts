// Per OCT-C4 (2026-10-20, audit
// `plan/project/AUDIT-OCTOBER-2026.md`): the booking calendar
// must build its dates in the HOTEL's timezone, not the
// browser's.
//
// The pre-fix `isoToTzDate` was:
//   new TZDate(`${iso}T00:00:00`, config.timezone)
// `@date-fns/tz`'s TZDate constructor pops the timezone string
// and, when the REMAINING argument is a single date STRING,
// parses it with the native `Date` constructor — i.e. in the
// BROWSER's timezone — and only then re-projects the instant
// into `config.timezone`. For any browser whose clock is ahead
// of Asia/Manila (UTC+8) the re-projection lands on the
// PREVIOUS day.
//
// `react-day-picker` re-exports the SAME `TZDate` class and
// builds its day cells with `DateLib.newDate(year, monthIndex,
// date)` → `new TZDate(year, monthIndex, date, timeZone)` — the
// 3-number COMPONENTS form, which constructs the wall-clock in
// the TARGET zone. So the library's cells were correctly
// Manila-anchored while every value WE built was not, and the
// two disagreed.
//
// The consequence: the guest clicked Oct 25 and the booking
// committed Oct 24 — one night longer, priced, queried, booked
// and receipted for the wrong dates.
//
// The runtime assertions below REPRODUCE the bug against the
// old construction and prove the new one is correct in every
// browser timezone.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TZDate } from "react-day-picker";

const pickerSrc = readFileSync(
  resolve(__dirname, "../../src/components/DateRangePicker.tsx"),
  "utf8"
);

const HOTEL_TZ = "Asia/Manila";
const ISO = "2026-10-25";

/** The FIXED construction: components, pinned to the hotel zone. */
function fixedIsoToTzDate(iso: string): TZDate {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  return new TZDate(year, month - 1, day, HOTEL_TZ);
}

/** The PRE-FIX construction: a date string parsed in the browser zone. */
function preFixIsoToTzDate(iso: string): TZDate {
  return new TZDate(`${iso}T00:00:00`, HOTEL_TZ);
}

/** Reads the target-zone wall-clock parts (the picker does this). */
function tzDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const BROWSER_TIMEZONES = [
  "Asia/Manila", // the hotel's own zone (UTC+8) — was already correct
  "Asia/Tokyo", // UTC+9 — was WRONG
  "Asia/Seoul", // UTC+9 — was WRONG
  "Australia/Sydney", // UTC+10/+11 — was WRONG
  "Pacific/Auckland", // UTC+12 — was WRONG
  "Europe/Berlin", // UTC+1/+2 — was correct
  "America/New_York", // UTC-5/-4 — was correct
  "UTC"
];

describe("OCT-C4 — the calendar builds its dates in the hotel's timezone", () => {
  describe("runtime: the round-trip is correct in every browser timezone", () => {
    const originalTz = process.env.TZ;

    for (const tz of BROWSER_TIMEZONES) {
      it(`round-trips ${ISO} unchanged with the browser in ${tz}`, () => {
        process.env.TZ = tz;
        try {
          expect(tzDateToIso(fixedIsoToTzDate(ISO))).toBe(ISO);
        } finally {
          process.env.TZ = originalTz;
        }
      });
    }

    it("the pre-fix construction WAS wrong east of Manila (the regression this test guards)", () => {
      process.env.TZ = "Asia/Tokyo";
      try {
        expect(tzDateToIso(preFixIsoToTzDate(ISO))).not.toBe(ISO);
      } finally {
        process.env.TZ = originalTz;
      }
    });
  });

  describe("source pins", () => {
    // Strip comments so the pins match CODE only — the fix's
    // explanatory comment quotes the old construction verbatim.
    const code = pickerSrc
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    it("does not build a TZDate from a date-time STRING", () => {
      // The string form is parsed in the browser's zone.
      expect(code).not.toMatch(/new TZDate\(\s*`\$\{[^}]*\}T00:00:00`/);
      expect(code).not.toMatch(/new TZDate\(\s*iso\s*\+\s*"T00:00:00"/);
    });

    it("builds the TZDate from its Y / M / D components, pinned to the hotel zone", () => {
      expect(code).toMatch(
        /new TZDate\(year,\s*month\s*-\s*1,\s*day,\s*config\.timezone\)/
      );
    });

    it("still pins the DayPicker to the hotel timezone", () => {
      expect(code).toMatch(/timeZone=\{config\.timezone\}/);
    });
  });
});

describe("OCT-H2 — the booking flow's breakfast dates use the UTC anchor", () => {
  const bookingCode = readFileSync(
    resolve(__dirname, "../../src/pages/BookingPage.tsx"),
    "utf8"
  )
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("parses the stay dates with a `Z` anchor", () => {
    // A local-time parse + a UTC format shifts the list back one
    // day in any UTC+ zone — the last breakfast morning was never
    // offered, so it was never charged.
    expect(bookingCode).toMatch(/new Date\(`\$\{checkIn\}T00:00:00Z`\)/);
    expect(bookingCode).toMatch(/new Date\(`\$\{checkOut\}T00:00:00Z`\)/);
  });

  it("does not parse the stay dates in the browser's local zone", () => {
    expect(bookingCode).not.toMatch(/new Date\(`\$\{checkIn\}T00:00:00`\)/);
    expect(bookingCode).not.toMatch(/new Date\(`\$\{checkOut\}T00:00:00`\)/);
  });
});
