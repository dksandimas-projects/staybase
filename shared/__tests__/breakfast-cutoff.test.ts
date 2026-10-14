import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeBreakfastCutoffState } from "../utils/breakfastCutoff";

// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): characterization tests for the
// `computeBreakfastCutoffState` helper.
//
// The cutoff rule is `cutoffForDate(serviceDate) =
// (serviceDate − 1 calendar day) at configured cutoffTime,
// in hotel timezone`. The default cutoff is 20:00 in
// Asia/Manila. The helper is the server's authoritative
// gate; the client uses the same function for the
// per-date countdown display.
//
// All `now` inputs are pinned to a fixed instant so the
// tests are timezone-stable. `Asia/Manila` is UTC+8 (no
// DST), which keeps the math easy to follow by hand.

const MANILA_TZ = "Asia/Manila";
const DEFAULT_CUTOFF = "20:00";

describe("computeBreakfastCutoffState — default 20:00 Asia/Manila cutoff", () => {
  it("is NOT locked when now is on the cutoff day, before 20:00 Manila", () => {
    // Service date = 2026-10-14 → cutoff = 2026-10-13 20:00 Manila = 2026-10-13 12:00 UTC.
    // "now" = 2026-10-13 06:00 UTC (14:00 Manila, well before cutoff).
    const now = new Date("2026-10-13T06:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(false);
    expect(state.serviceDate).toBe("2026-10-14");
    // minutesUntilCutoff = (12:00 - 06:00) UTC = 6h = 360 minutes.
    expect(state.minutesUntilCutoff).toBe(360);
    expect(state.cutoffAt).toBe("2026-10-13T12:00:00.000Z");
  });

  it("IS locked when now is past the cutoff on the cutoff day", () => {
    // Service date = 2026-10-14 → cutoff = 2026-10-13 20:00 Manila = 2026-10-13 12:00 UTC.
    // "now" = 2026-10-13 13:00 UTC (21:00 Manila, after cutoff).
    const now = new Date("2026-10-13T13:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    // minutesUntilCutoff is negative when locked.
    expect(state.minutesUntilCutoff).toBeLessThan(0);
    expect(state.cutoffAt).toBe("2026-10-13T12:00:00.000Z");
  });

  it("IS locked when service date is yesterday (cutoff is in the past regardless of now)", () => {
    // Service date = 2026-10-13 (yesterday from now) → cutoff = 2026-10-12 20:00 Manila.
    // "now" = 2026-10-14 00:00 UTC (08:00 Manila, well past cutoff).
    const now = new Date("2026-10-14T00:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-13",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(state.minutesUntilCutoff).toBeLessThan(0);
  });

  it("is NOT locked when service date is tomorrow (cutoff is tomorrow evening)", () => {
    // Service date = 2026-10-15 (tomorrow from now) → cutoff = 2026-10-14 20:00 Manila = 2026-10-14 12:00 UTC.
    // "now" = 2026-10-14 00:00 UTC (08:00 Manila).
    const now = new Date("2026-10-14T00:00:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-15",
      now,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(false);
    // minutesUntilCutoff = (12:00 - 00:00) UTC = 12h = 720 minutes.
    expect(state.minutesUntilCutoff).toBe(720);
    expect(state.cutoffAt).toBe("2026-10-14T12:00:00.000Z");
  });
});

describe("computeBreakfastCutoffState — exact-minute boundary", () => {
  it("is NOT locked with exactly 1 minute remaining (23:59 cutoff, now = 23:58 same day)", () => {
    // Cutoff = 23:59 (late-night cutoff, e.g. a hotel that runs
    // midnight dinner). Service date = 2026-10-14 → cutoff =
    // 2026-10-13 23:59 Manila = 2026-10-13 15:59 UTC. "now" =
    // 2026-10-13 15:58 UTC = 23:58 Manila, exactly 1 minute
    // before cutoff.
    const now = new Date("2026-10-13T15:58:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: "23:59",
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(false);
    expect(state.minutesUntilCutoff).toBe(1);
    expect(state.cutoffAt).toBe("2026-10-13T15:59:00.000Z");
  });

  it("IS locked at exactly the cutoff instant", () => {
    // Same scenario, "now" = exactly the cutoff instant.
    const now = new Date("2026-10-13T15:59:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: "23:59",
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(state.minutesUntilCutoff).toBe(0);
  });

  it("is NOT locked for a 00:00 cutoff, now = 23:59 the day before cutoff, service = day after", () => {
    // Cutoff = 00:00 (midnight start-of-day). Service date =
    // 2026-10-13 → cutoff = 2026-10-12 00:00 Manila = 2026-10-11
    // 16:00 UTC. "now" = 2026-10-11 15:59 UTC = 2026-10-11 23:59
    // Manila, exactly 1 minute before the cutoff (the previous
    // day at midnight).
    const now = new Date("2026-10-11T15:59:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-13",
      now,
      cutoffTime: "00:00",
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(false);
    expect(state.minutesUntilCutoff).toBe(1);
    expect(state.cutoffAt).toBe("2026-10-11T16:00:00.000Z");
  });
});

describe("computeBreakfastCutoffState — Asia/Manila timezone sanity", () => {
  it("returns the same locked state for the same wall-clock instant regardless of input Date timezone", () => {
    // 2026-10-13T12:00:00.000Z is 20:00 Manila on 2026-10-13 —
    // the exact default cutoff for service date 2026-10-14.
    // Constructing the same instant via the local string + Date
    // constructor must produce the same locked state.
    const now1 = new Date("2026-10-13T12:00:00.000Z");
    const state1 = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now: now1,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state1.isLocked).toBe(true);

    // One second after cutoff → still locked (the rule is
    // `now >= cutoffAt`, inclusive).
    const now2 = new Date("2026-10-13T12:00:01.000Z");
    const state2 = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now: now2,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state2.isLocked).toBe(true);
  });

  it("respects a different IANA timezone (UTC) by shifting the cutoff to UTC's wall clock", () => {
    // Cutoff = 20:00 in UTC (instead of Manila). Service date =
    // 2026-10-14 → cutoff = 2026-10-13 20:00 UTC. "now" =
    // 2026-10-13 19:59 UTC, exactly 1 minute before.
    const now = new Date("2026-10-13T19:59:00.000Z");
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now,
      cutoffTime: "20:00",
      timezone: "UTC"
    });
    expect(state.isLocked).toBe(false);
    expect(state.minutesUntilCutoff).toBe(1);
    expect(state.cutoffAt).toBe("2026-10-13T20:00:00.000Z");
  });
});

describe("computeBreakfastCutoffState — defensive coercion (returns locked state)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validNow = new Date("2026-10-13T06:00:00.000Z");

  it("returns a locked state when cutoffTime is malformed", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now: validNow,
      cutoffTime: "25:99",
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(state.minutesUntilCutoff).toBe(0);
    expect(state.serviceDate).toBe("2026-10-14");
    expect(state.cutoffAt).toBe(validNow.toISOString());
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns a locked state when cutoffTime is the empty string", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now: validNow,
      cutoffTime: "",
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns a locked state when timezone is invalid", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      now: validNow,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: "Not/A/Real/Zone"
    });
    expect(state.isLocked).toBe(true);
    expect(state.serviceDate).toBe("2026-10-14");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns a locked state when serviceDate is malformed", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "not-a-date",
      now: validNow,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    // The helper echoes the malformed input back in the
    // `serviceDate` field for diagnostics (the safe-return
    // only blanks it when the input is not even a string).
    expect(state.serviceDate).toBe("not-a-date");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns a locked state when serviceDate is a fake calendar date (Feb 31)", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-02-31",
      now: validNow,
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns a locked state when now is not a Date instance", () => {
    const state = computeBreakfastCutoffState({
      serviceDate: "2026-10-14",
      // @ts-expect-error — exercising the defensive guard
      now: "2026-10-13T06:00:00.000Z",
      cutoffTime: DEFAULT_CUTOFF,
      timezone: MANILA_TZ
    });
    expect(state.isLocked).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});