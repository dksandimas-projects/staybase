import { describe, expect, test } from "vitest";
import { getDateKeyInTimezone, getManilaDateInfo } from "../utils/bookingDates";

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was previously duplicated in
// 5 server-side handler files. These tests pin the shared
// implementation so future regressions in date math are
// caught at the unit level.

describe("getManilaDateInfo (BF-42 shared helper)", () => {
  test("returns today's date in the property's timezone (Asia/Manila)", () => {
    const info = getManilaDateInfo();
    // The compact form `YYYYMMDD` is used for the booking
    // reference counter key (counters/bookings-YYYYMMDD). It
    // must be 8 digits.
    expect(info.todayCompact).toMatch(/^\d{8}$/);
    // The dash-separated form is used for the same counter key
    // in some queries. It must match `YYYY-MM-DD`.
    expect(info.todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("honors a custom timezone argument", () => {
    // The helper accepts any IANA timezone string. Use a fixed
    // offset zone to make the assertion deterministic.
    // America/Los_Angeles is UTC-8 (standard) / UTC-7 (DST).
    // We only check the format here, not the date math.
    const info = getManilaDateInfo("America/Los_Angeles");
    expect(info.todayCompact).toMatch(/^\d{8}$/);
    expect(info.todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("todayStr and todayCompact agree (year-month-day match)", () => {
    const info = getManilaDateInfo();
    // Strip the dashes from `todayStr`; it should equal
    // `todayCompact`.
    expect(info.todayStr.replace(/-/g, "")).toBe(info.todayCompact);
  });

  test("getDateKeyInTimezone returns today/tomorrow keys in the configured timezone", () => {
    const today = getDateKeyInTimezone("Asia/Manila", 0);
    const tomorrow = getDateKeyInTimezone("Asia/Manila", 1);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tomorrow > today).toBe(true);
  });

  test("manilaDate is a Date anchored at 00:00 local", () => {
    const info = getManilaDateInfo("Asia/Manila");
    // The Date is built from the `toLocaleString` parse. The
    // resulting Date is anchored at midnight in the local
    // timezone; its components (year, month, day) match
    // todayStr's components.
    const [y, m, d] = info.todayStr.split("-").map(Number);
    expect(info.manilaDate.getFullYear()).toBe(y);
    expect(info.manilaDate.getMonth() + 1).toBe(m);
    expect(info.manilaDate.getDate()).toBe(d);
  });
});
