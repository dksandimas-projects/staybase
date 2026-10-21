// Per BR-03-FIT-02 (QA pass 2026-10-21) — the guest booking flow's
// per-date label must not shift a day in the viewer's timezone.
//
// WHAT WAS BROKEN: `formatBreakfastDateLabel` parsed the `yyyy-mm-dd`
// value WITHOUT the `Z` suffix — `new Date("2026-11-05T00:00:00")` —
// which JavaScript reads in the BROWSER's local timezone, and then
// formatted the result with `timeZone: "UTC"`. Parse-local + format-UTC
// is a guaranteed one-day mismatch east of UTC.
//
// OBSERVED IN PRODUCTION (2026-10-21, guest booking Step 2, a
// Nov 5 -> Nov 7 stay): the breakfast date cards rendered
// "Nov 4 (Wed)" and "Nov 5 (Thu)" instead of "Nov 5 (Thu)" and
// "Nov 6 (Fri)". The Other add-ons date rows rendered the same two
// shifted dates — both surfaces render through this one formatter.
// The hotel is in Asia/Manila (UTC+8), so every guest booking from the
// Philippines saw breakfast dates one day early, including a first
// breakfast "on" a date before check-in.
//
// WHY A BEHAVIOURAL TEST: the defect only exists in a non-UTC
// timezone. A source-regex tripwire cannot see it — and the repo's
// own audit (H1) already records that ~99% of the suite is
// source-regex. This test imports the REAL shipped module and pins
// the real output, with the timezone explicitly pinned per case.

import { describe, it, expect, afterEach } from "vitest";
import { formatBreakfastDateLabel } from "../../src/utils/formatBreakfastDateLabel";

const ORIGINAL_TZ = process.env.TZ;

/** Run `fn` with the process timezone pinned to `tz`. */
function withTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("formatBreakfastDateLabel — BR-03-FIT-02", () => {
  it("renders the service date itself, not the previous day (Asia/Manila)", () => {
    // The hotel's own timezone — the case that shipped broken.
    // Nov 5, 2026 is a Thursday.
    const label = withTimeZone("Asia/Manila", () => formatBreakfastDateLabel("2026-11-05", "en-PH"));
    expect(label).toBe("Nov 5 (Thu)");
  });

  it("renders the service date itself, not the previous day (UTC)", () => {
    const label = withTimeZone("UTC", () => formatBreakfastDateLabel("2026-11-05", "en-PH"));
    expect(label).toBe("Nov 5 (Thu)");
  });

  it("renders the service date itself, not the previous day (America/New_York)", () => {
    const label = withTimeZone("America/New_York", () => formatBreakfastDateLabel("2026-11-05", "en-PH"));
    expect(label).toBe("Nov 5 (Thu)");
  });

  it("renders the service date itself, not the previous day (Pacific/Kiritimati, UTC+14)", () => {
    const label = withTimeZone("Pacific/Kiritimati", () => formatBreakfastDateLabel("2026-11-05", "en-PH"));
    expect(label).toBe("Nov 5 (Thu)");
  });

  it("is identical across every timezone — the output is viewer-independent", () => {
    const zones = ["UTC", "Asia/Manila", "Asia/Tokyo", "America/New_York", "America/Los_Angeles", "Pacific/Kiritimati"];
    const labels = zones.map((tz) => withTimeZone(tz, () => formatBreakfastDateLabel("2026-11-05", "en-PH")));
    expect(new Set(labels).size).toBe(1);
    expect(labels[0]).toBe("Nov 5 (Thu)");
  });

  it("renders the first date of a multi-night stay on the check-in date", () => {
    // The exact production case: check-in Nov 5, check-out Nov 7 ->
    // breakfast service dates Nov 5 + Nov 6.
    const first = withTimeZone("Asia/Manila", () => formatBreakfastDateLabel("2026-11-05", "en-PH"));
    const second = withTimeZone("Asia/Manila", () => formatBreakfastDateLabel("2026-11-06", "en-PH"));
    expect(first).toBe("Nov 5 (Thu)");
    expect(second).toBe("Nov 6 (Fri)");
  });

  it("renders a date that is a month boundary without rolling back a month", () => {
    // The old form produced "Oct 31" for a Nov 1 service date in Manila.
    const label = withTimeZone("Asia/Manila", () => formatBreakfastDateLabel("2026-11-01", "en-PH"));
    expect(label).toBe("Nov 1 (Sun)");
  });

  it("renders a date that is a year boundary without rolling back a year", () => {
    const label = withTimeZone("Asia/Manila", () => formatBreakfastDateLabel("2027-01-01", "en-PH"));
    expect(label).toBe("Jan 1 (Fri)");
  });

  it("returns the raw input for an unparseable date instead of throwing", () => {
    expect(formatBreakfastDateLabel("not-a-date", "en-PH")).toBe("not-a-date");
  });
});
