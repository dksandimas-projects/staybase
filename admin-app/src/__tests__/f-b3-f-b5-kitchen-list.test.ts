// F-B3 + F-B5 (handoff-2026-10-23 §6, Wave 3): the kitchen list.
//
// F-B3 — Reports → "Daily Kitchen Prep" disagrees with the bookings it
// summarises.
//
//   The panel derived its dates from the booking's `checkIn + numNights`
// window and then kept only the slots whose service date fell inside
// it:
//
//     for (let i = 0; i < b.numNights; i++) {
//       const dateStr = checkIn + i;
//       if (!dateMap[dateStr]) dateMap[dateStr] = {};   // <- creates an EMPTY date
//       for (const slot of normalized.slots.values()) {
//         if (slot.serviceDate !== dateStr) continue;   // <- DROPS other slots
//         ...count the meal...                          // <- no removedAt filter
//       }
//     }
//
//   Three consequences, all measured against production on 2026-10-27:
//     * a slot dated OUTSIDE the stay was dropped — the guest had a
//       breakfast the kitchen never saw;
//     * a slot CANCELLED before the cut-off (`removedAt`) was still
//       counted — the kitchen cooked meals nobody would eat;
//     * a date with no matching slot was listed as an EMPTY row.
//
//   The old logic counted 28 meals across 15 dates; the slot-driven
//   logic counts 23 meals across 13 dates.
//
//   The server's own kitchen list (`/api/bookings/breakfast/kitchen-list`)
//   ALREADY filters `removedAt` and reads the slot keys, so the report
//   contradicted the list the kitchen actually works from.
//
// F-B5 — the kitchen list cannot tell guests apart.
//
//   `extractGuestNameFromSlotKey` resolves the slot's guest name from
//   the booking's `guests[]` array. **0 of 157** production bookings
//   carry one — they carry a single top-level `guestName` instead —
//   while **141** bookings have `numGuests > 1`. Every slot therefore
//   fell through to the same top-level name, so a 2-guest booking showed
//   the SAME name on both rows: the kitchen read one person who wanted
//   two meals.
//
// WHAT THIS TEST DOES
// -------------------
// It extracts the REAL report logic and the REAL guest-name resolver
// from the source and runs them against the production-shaped
// fixtures. A source-text regex alone would only prove a string is
// present.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveKitchenGuestName } from "@shared/utils/kitchenGuestNames";
import { buildDailyKitchenPrep } from "@shared/utils/kitchenPrep";

const reportsSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);
const kitchenSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/breakfast-kitchen-list.ts"),
  "utf8"
);
const kitchenPrepSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/kitchenPrep.ts"),
  "utf8"
);

// ── The report's counting ─────────────────────────────────────────
//
// The panel's counting lives in the SHARED helper
// `buildDailyKitchenPrep` (shared/utils/kitchenPrep.ts), so this test
// runs the SAME code the panel runs. A test that re-implements the
// logic would prove nothing about the product.
const reportCounts = (bookings: any[]) => buildDailyKitchenPrep(bookings).counts;

// ── The production-shaped fixtures ─────────────────────────────────
//
// Every fixture below is a real production shape, read from Firestore
// on 2026-10-27.
const meal = (name: string, extra: Record<string, any> = {}) => ({
  mealId: name.toLowerCase(),
  mealName: name,
  price: 100,
  addedBy: "guest",
  ...extra
});

describe("F-B3 — the Daily Kitchen Prep panel must agree with the bookings it summarises", () => {
  it("the panel is driven by the SLOTS, not by the `checkIn + numNights` window", () => {
    const memoStart = reportsSrc.indexOf("const dailyKitchenPrep = useMemo(");
    expect(memoStart).toBeGreaterThan(-1);
    // The memo runs to the next section comment — a robust end marker,
    // so a change to the memo's shape cannot silently widen the slice
    // to the whole file.
    const memoEnd = reportsSrc.indexOf("\n  // ── ", memoStart);
    expect(memoEnd).toBeGreaterThan(memoStart);
    const body = reportsSrc.slice(memoStart, memoEnd);

    // No date window is derived from numNights any more. (The word
    // appears in the explanatory comment; the CODE must not read it.)
    expect(body).not.toMatch(/\bb\.numNights\b/);
    expect(body).not.toMatch(/for \(let i = 0; i < b\.numNights/);
    // The counting is delegated to the shared helper, which is driven
    // by the slots and filters `removedAt`.
    expect(body).toMatch(/buildDailyKitchenPrep\(breakfastBookings\)/);
    expect(kitchenPrepSrc).toMatch(/slot\.serviceDate/);
    expect(kitchenPrepSrc).toMatch(/removedAt/);
    // The helper must not derive its dates from the stay window: that
    // is the defect. The word appears in the helper's EXPLANATORY
    // comment, so the pin is on its CODE — the comments are stripped
    // first.
    const kitchenPrepCode = kitchenPrepSrc
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("//"))
      .join("\n");
    expect(kitchenPrepCode).not.toMatch(/numNights/);
  });

  it("counts a meal whose slot date is OUTSIDE the booking's stay window", () => {
    // SI-20261021-00056: checkIn 2026-11-12, numNights 2, with a slot
    // dated 2026-10-21. The old panel dropped it.
    const booking = {
      bookingRef: "SI-20261021-00056",
      checkIn: "2026-11-12",
      numNights: 2,
      numGuests: 1,
      breakfastSelections: {
        "2026-10-21-0": meal("Tapsilog"),
        "2026-11-12-0": meal("Longsilog")
      }
    };
    const counts = reportCounts([booking]);
    expect(counts["2026-10-21"]).toEqual({ Tapsilog: 1 });
    expect(counts["2026-11-12"]).toEqual({ Longsilog: 1 });
  });

  it("does NOT count a meal cancelled before the cut-off", () => {
    // SI-20261021-00058: both slots carry `removedAt`.
    const booking = {
      bookingRef: "SI-20261021-00058",
      checkIn: "2026-10-22",
      numNights: 1,
      numGuests: 2,
      breakfastSelections: {
        "2026-10-22-0": meal("Tapsilog", { removedAt: { _seconds: 1792578912 } }),
        "2026-10-22-1": meal("Longsilog", { removedAt: { _seconds: 1792578863 } })
      }
    };
    expect(reportCounts([booking])).toEqual({});
  });

  it("does not emit an EMPTY date row for a stay with no matching slot", () => {
    const booking = {
      bookingRef: "SI-20261021-00037",
      checkIn: "2026-11-03",
      numNights: 3,
      numGuests: 1,
      breakfastSelections: { "2026-11-03-0": meal("Tapsilog") }
    };
    const counts = reportCounts([booking]);
    expect(Object.keys(counts)).toEqual(["2026-11-03"]);
    expect(counts["2026-11-04"]).toBeUndefined();
  });

  it("counts a BARE `<date>-N` slot key", () => {
    // The bare form is 0-based by construction and the shared
    // normaliser resolves it to the canonical space.
    const booking = {
      bookingRef: "SI-20261021-00061",
      checkIn: "2026-10-23",
      numNights: 1,
      numGuests: 2,
      breakfastSelections: { "2026-10-23-0": meal("Tapsilog") }
    };
    expect(reportCounts([booking])).toEqual({ "2026-10-23": { Tapsilog: 1 } });
  });

  it("the server's kitchen list uses the SAME shared guest resolver", () => {
    // One resolver, two surfaces: the panel and the list must not
    // drift apart again.
    expect(kitchenSrc).toMatch(/const extractGuestNameFromSlotKey = resolveKitchenGuestName;/);
    expect(kitchenSrc).toMatch(/resolveKitchenGuestName/);
  });

  it("agrees with the server's kitchen list, which already filters `removedAt`", () => {
    // The server's list is the one the kitchen works from. It skips a
    // slot whose `removedAt` is set — the panel must skip it too.
    expect(kitchenSrc).toMatch(/entry\.removedAt !== null && entry\.removedAt !== undefined/);
  });
});

describe("F-B5 — the kitchen list must be able to tell the guests apart", () => {
  const resolveName = resolveKitchenGuestName;

  it("uses the slot's own guest when the booking has a `guests[]` array", () => {
    const booking = {
      guests: [
        { firstName: "Juan", lastName: "Dela Cruz" },
        { firstName: "Maria", lastName: "Santos" }
      ],
      guestName: "Juan Dela Cruz"
    };
    expect(resolveName(booking, 0).guestName).toBe("Juan Dela Cruz");
    expect(resolveName(booking, 1).guestName).toBe("Maria Santos");
  });

  it("does NOT show the lead guest's name on every row", () => {
    // The production shape: NO `guests[]` array, one top-level
    // `guestName`, numGuests = 2.
    const booking = {
      guests: undefined,
      guestName: "QA Browser Flow",
      numGuests: 2
    };
    const first = resolveName(booking, 0);
    const second = resolveName(booking, 1);
    expect(first.guestName).toBe("QA Browser Flow");
    expect(second.guestName).not.toBe(first.guestName);
  });

  it("labels the other slots by their position", () => {
    const booking = { guests: undefined, guestName: "QA Browser Flow", numGuests: 3 };
    expect(resolveName(booking, 1).guestName).toBe("Guest 2");
    expect(resolveName(booking, 2).guestName).toBe("Guest 3");
  });

  it("keeps the real name on the lead slot even when there is no `guests[]`", () => {
    const booking = { guestName: "Ana Reyes", numGuests: 2 };
    expect(resolveName(booking, 0).guestName).toBe("Ana Reyes");
  });

  it("still produces a label when nothing at all is known", () => {
    const booking = { numGuests: 2 };
    expect(resolveName(booking, 0).guestName).toBeTruthy();
    expect(resolveName(booking, 1).guestName).toBeTruthy();
  });
});
