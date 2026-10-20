// Per OCT-M8 (2026-10-20, decision #294): the "use these choices for
// all remaining days" confirmation.
//
// The bug had TWO halves:
//
// 1. It never cleared. The source comment claimed a clearing effect
//    existed "further down" — it did not. The notice stayed for the
//    rest of the session, including after the guest edited a meal,
//    where it falsely implied the copy was still in effect.
// 2. It rendered ONCE PER DATE. The notice was a bare string rendered
//    inside the per-date map, so on a 3-night stay the guest read
//    "Applied these choices to 2 remaining days." three times, in
//    three different date cards.
//
// The fix makes the notice an object that carries the DATE it belongs
// to, so exactly one card can match it, plus an 8s auto-clear timer
// and a clear-on-edit.
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// helper) and, below it, the WIRING (source-text guards on
// BookingPage — the component itself cannot be mounted here because
// the guest app has no jsdom/RTL harness).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BREAKFAST_COPY_NOTICE_TIMEOUT_MS,
  buildBreakfastCopyNotice,
  shouldShowBreakfastCopyNotice
} from "../../src/utils/breakfastCopy";

const repoRoot = resolve(__dirname, "../../..");
const bookingPage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);

describe("OCT-M8 — the breakfast copy confirmation (runtime behaviour)", () => {
  it("the notice carries the date it belongs to, so it renders exactly once", () => {
    const notice = buildBreakfastCopyNotice("2026-11-02", 2);
    expect(notice.date).toBe("2026-11-02");
    // Only the card for the tapped date matches.
    expect(shouldShowBreakfastCopyNotice(notice, "2026-11-02")).toBe(true);
    expect(shouldShowBreakfastCopyNotice(notice, "2026-11-03")).toBe(false);
    expect(shouldShowBreakfastCopyNotice(notice, "2026-11-04")).toBe(false);
  });

  it("a 3-night stay renders the confirmation in exactly ONE of the three cards", () => {
    const dates = ["2026-11-02", "2026-11-03", "2026-11-04"];
    const notice = buildBreakfastCopyNotice(dates[0], 2);
    const renderedIn = dates.filter((date) => shouldShowBreakfastCopyNotice(notice, date));
    // The regression: the old bare-string notice rendered in all three.
    expect(renderedIn).toEqual(["2026-11-02"]);
  });

  it("the message reports the number of dates that ACTUALLY changed", () => {
    expect(buildBreakfastCopyNotice("2026-11-02", 2).message).toBe(
      "Applied these choices to 2 remaining days."
    );
  });

  it("the message is singular for exactly one day", () => {
    expect(buildBreakfastCopyNotice("2026-11-02", 1).message).toBe(
      "Applied these choices to 1 remaining day."
    );
  });

  it("a zero-change copy says so instead of claiming a change", () => {
    expect(buildBreakfastCopyNotice("2026-11-02", 0).message).toBe(
      "Those choices are already set on every remaining day."
    );
  });

  it("a null notice renders nowhere", () => {
    expect(shouldShowBreakfastCopyNotice(null, "2026-11-02")).toBe(false);
  });

  it("the auto-clear window is 8 seconds", () => {
    expect(BREAKFAST_COPY_NOTICE_TIMEOUT_MS).toBe(8000);
  });
});

describe("OCT-M8 — the BookingPage wiring (source-text guards)", () => {
  it("the notice state is an object that can hold a date, not a bare string", () => {
    expect(bookingPage).toContain("setBreakfastCopyNotice");
    // The old shape was `useState<string>("")` — a bare string could
    // never be anchored to a date.
    expect(bookingPage).not.toMatch(
      /useState<string>\(""\)\s*;?\s*\n\s*const/
    );
    expect(bookingPage).toMatch(
      /const \[breakfastCopyNotice, setBreakfastCopyNotice\] = useState<\s*BreakfastCopyNotice \| null\s*>\(null\)/
    );
  });

  it("the confirmation is built by the shared helper, not an inline template", () => {
    expect(bookingPage).toContain("buildBreakfastCopyNotice(date, result.updatedDates)");
  });

  it("the render is gated on the notice's date", () => {
    expect(bookingPage).toContain(
      "shouldShowBreakfastCopyNotice(breakfastCopyNotice, date)"
    );
  });

  it("the auto-clear effect exists and uses the shared timeout", () => {
    expect(bookingPage).toContain("BREAKFAST_COPY_NOTICE_TIMEOUT_MS");
    // The effect must clear the timer on cleanup, otherwise every tap
    // leaks a pending timeout.
    expect(bookingPage).toContain("window.clearTimeout(timer)");
  });

  it("editing a meal clears the confirmation", () => {
    // The meal <select>'s onChange must clear the notice — otherwise
    // the guest reads a stale "these choices were applied" line right
    // after changing one.
    const selectIdx = bookingPage.indexOf("breakfast-select-${key}");
    expect(selectIdx).toBeGreaterThan(-1);
    const onChangeIdx = bookingPage.indexOf("onChange={(event) => {", selectIdx);
    expect(onChangeIdx).toBeGreaterThan(-1);
    const clearIdx = bookingPage.indexOf("setBreakfastCopyNotice(null);", onChangeIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    // It must be inside the meal select's own onChange, not somewhere
    // unrelated further down the file.
    const nextSelectIdx = bookingPage.indexOf("breakfast-select-${key}", selectIdx + 1);
    expect(
      clearIdx < nextSelectIdx || nextSelectIdx === -1,
      "setBreakfastCopyNotice(null) must live inside the meal select's onChange"
    ).toBe(true);
  });
});
